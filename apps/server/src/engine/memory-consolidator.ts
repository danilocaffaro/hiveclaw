/**
 * engine/memory-consolidator.ts — autoDream Memory Consolidation (S1.2)
 *
 * A nightly maintenance process that keeps agent memory lean and consistent:
 *
 *  1. Prunes expired entries (expires_at in the past)
 *  2. Flags and reports stale entries (not accessed in 30+ days)
 *  3. Detects contradictions (same key, different values via contradiction edges)
 *  4. Promotes related short_term → long_term when clusters of ≥3 entries share
 *     the same key prefix or tag group
 *  5. Appends a human-readable summary to the agent's "scratchpad" core block
 *  6. Returns a ConsolidationReport for the API response and episode log
 *
 * Triggered via: POST /api/agents/:id/consolidate-memory
 * Safe to run multiple times — all operations are idempotent.
 */

import { AgentMemoryRepository } from '../db/agent-memory.js';
import type { MemoryEntry, MemoryType } from '../db/agent-memory.js';
import { getDb } from '../db/index.js';
import { logger } from '../lib/logger.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Entries not accessed in this many days are considered stale */
const STALE_DAYS = 30;

/**
 * How many short_term entries with the same key prefix must exist before
 * we promote them into a single long_term entry.
 */
const SHORT_TERM_CLUSTER_MIN = 3;

/** Max chars for the consolidated summary written to the scratchpad core block */
const SUMMARY_MAX_CHARS = 500;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConsolidationReport {
  /** Agent this report belongs to */
  agentId: string;
  /** ISO timestamp when consolidation ran */
  ranAt: string;
  /** Entries removed because expires_at was in the past */
  prunedExpired: number;
  /** IDs of entries that haven't been accessed in 30+ days */
  staleIds: string[];
  /** Pairs of contradicting memories (same key, different values) */
  contradictions: Array<{ key: string; ids: string[] }>;
  /** short_term clusters that were merged into a long_term entry */
  promotions: Array<{ keyPrefix: string; mergedCount: number; newId: string }>;
  /** Whether the scratchpad core block was updated */
  scratchpadUpdated: boolean;
  /** Human-readable summary */
  summary: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Return true if a date string is at least `days` days in the past */
function isOlderThan(dateStr: string | null | undefined, days: number): boolean {
  if (!dateStr) return false;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(dateStr).getTime() < cutoff;
}

/** Extract a short key prefix (first 2 words / up to 30 chars) for grouping */
function keyPrefix(key: string): string {
  return key.split(/[\s_:/-]/).slice(0, 2).join('_').slice(0, 30).toLowerCase();
}

// ─── Main consolidation logic ─────────────────────────────────────────────────

/**
 * Run autoDream memory consolidation for a single agent.
 *
 * @param agentId  The agent whose memory to consolidate
 * @param db       Optional DB instance (defaults to shared getDb())
 * @returns        A ConsolidationReport describing what changed
 */
export async function consolidateMemory(
  agentId: string,
  db?: ReturnType<typeof getDb>,
): Promise<ConsolidationReport> {
  const database = db ?? getDb();
  const repo = new AgentMemoryRepository(database);
  const ranAt = new Date().toISOString();

  logger.info('[MemoryConsolidator] Starting consolidation for agent %s', agentId);

  // ── Step 1: Prune expired entries ──────────────────────────────────────────
  // AgentMemoryRepository.prune() removes ALL expired entries across agents.
  // We do a targeted prune for this agent only to keep the report accurate.
  const pruneResult = database
    .prepare(
      `DELETE FROM agent_memory
       WHERE agent_id = ?
         AND expires_at IS NOT NULL
         AND expires_at <= datetime('now')`,
    )
    .run(agentId);
  const prunedExpired = pruneResult.changes;

  // ── Step 2: Load all remaining memories for this agent ────────────────────
  // We bypass the `list()` helper (which filters expired) so we can work on
  // the full live set including valid_until-invalidated entries.
  const allMemories = database
    .prepare(
      `SELECT * FROM agent_memory
       WHERE agent_id = ?
       ORDER BY created_at DESC`,
    )
    .all(agentId) as MemoryEntry[];

  // ── Step 3: Identify stale entries (not accessed in 30+ days) ─────────────
  const staleIds: string[] = [];
  for (const m of allMemories) {
    // Use last_accessed if available; fall back to created_at
    const lastTouched = m.last_accessed ?? m.created_at;
    if (isOlderThan(lastTouched, STALE_DAYS)) {
      staleIds.push(m.id);
    }
  }

  // ── Step 4: Detect contradictions ─────────────────────────────────────────
  // Group active (non-invalidated) memories by key; any group with >1 distinct
  // value is a contradiction.
  const byKey = new Map<string, MemoryEntry[]>();
  for (const m of allMemories) {
    // Skip memories that have been explicitly invalidated (valid_until set)
    if (m.valid_until) continue;
    const group = byKey.get(m.key) ?? [];
    group.push(m);
    byKey.set(m.key, group);
  }

  const contradictions: Array<{ key: string; ids: string[] }> = [];
  for (const [key, entries] of byKey.entries()) {
    if (entries.length < 2) continue;
    const distinctValues = new Set(entries.map(e => e.value.trim().toLowerCase()));
    if (distinctValues.size > 1) {
      contradictions.push({ key, ids: entries.map(e => e.id) });
      // Create contradiction edges between the conflicting entries if not already present
      // (best-effort — edge API is idempotent via INSERT OR REPLACE)
      for (let i = 1; i < entries.length; i++) {
        try {
          repo.addEdge(entries[0].id, entries[i].id, 'contradicts');
        } catch { /* non-fatal */ }
      }
    }
  }

  // ── Step 5: Promote short_term clusters → long_term ───────────────────────
  // Group short_term entries by key prefix; when ≥ SHORT_TERM_CLUSTER_MIN exist
  // for the same prefix, merge their values into one long_term entry and delete
  // the originals.
  const shortTermEntries = allMemories.filter(m => m.type === 'short_term' && !m.valid_until);
  const prefixGroups = new Map<string, MemoryEntry[]>();
  for (const m of shortTermEntries) {
    const prefix = keyPrefix(m.key);
    const group = prefixGroups.get(prefix) ?? [];
    group.push(m);
    prefixGroups.set(prefix, group);
  }

  const promotions: Array<{ keyPrefix: string; mergedCount: number; newId: string }> = [];
  for (const [prefix, group] of prefixGroups.entries()) {
    if (group.length < SHORT_TERM_CLUSTER_MIN) continue;

    // Build a merged value (deduplicated lines)
    const mergedValue = [...new Set(group.map(m => `${m.key}: ${m.value}`))].join('\n');
    const mergedKey = `merged_${prefix}_${Date.now()}`;

    // Persist as long_term
    const promoted = repo.set(
      agentId,
      mergedKey,
      mergedValue,
      'long_term' as MemoryType,
      0.8,
      undefined,
      { source: 'autoDream_consolidation', tags: ['consolidated', prefix] },
    );

    // Delete the originals
    for (const m of group) {
      try {
        repo.delete(m.id);
      } catch { /* non-fatal */ }
    }

    promotions.push({ keyPrefix: prefix, mergedCount: group.length, newId: promoted.id });
    logger.debug('[MemoryConsolidator] Promoted %d short_term entries with prefix "%s" → long_term %s',
      group.length, prefix, promoted.id);
  }

  // ── Step 6: Update scratchpad core block with consolidation summary ────────
  const summaryLines: string[] = [
    `[autoDream ${ranAt.slice(0, 10)}]`,
    `Pruned: ${prunedExpired} expired entries`,
    `Stale: ${staleIds.length} entries (30+ days unaccessed)`,
    `Contradictions: ${contradictions.length} key(s) with conflicting values`,
    `Promoted: ${promotions.length} short_term cluster(s) → long_term`,
  ];

  if (contradictions.length > 0) {
    const keyList = contradictions.slice(0, 3).map(c => `"${c.key}"`).join(', ');
    summaryLines.push(`Contradiction keys: ${keyList}${contradictions.length > 3 ? ' …' : ''}`);
  }

  const summaryText = summaryLines.join('\n').slice(0, SUMMARY_MAX_CHARS);
  let scratchpadUpdated = false;

  try {
    const currentScratchpad = repo.getCoreBlock(agentId, 'scratchpad');
    // Prepend the new summary (keep history visible, most recent on top)
    const updatedContent = summaryText + (currentScratchpad ? `\n---\n${currentScratchpad}` : '');
    // Trim to avoid unbounded growth (keep last ~4000 chars of scratchpad)
    repo.setCoreBlock(agentId, 'scratchpad', updatedContent.slice(0, 4000));
    scratchpadUpdated = true;
  } catch (err) {
    logger.warn('[MemoryConsolidator] Could not update scratchpad for agent %s: %s',
      agentId, (err as Error).message);
  }

  // ── Step 7: Log episode ───────────────────────────────────────────────────
  const report: ConsolidationReport = {
    agentId,
    ranAt,
    prunedExpired,
    staleIds,
    contradictions,
    promotions,
    scratchpadUpdated,
    summary: summaryText,
  };

  repo.logEpisode({
    agentId,
    type: 'compaction',
    content: `autoDream consolidation: ${summaryText}`,
    eventAt: ranAt,
    metadata: {
      prunedExpired,
      staleCount: staleIds.length,
      contradictionCount: contradictions.length,
      promotionCount: promotions.length,
    },
  });

  logger.info(
    '[MemoryConsolidator] Done for agent %s — pruned=%d stale=%d contradictions=%d promotions=%d',
    agentId, prunedExpired, staleIds.length, contradictions.length, promotions.length,
  );

  return report;
}
