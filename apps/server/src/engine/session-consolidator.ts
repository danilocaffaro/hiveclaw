/**
 * engine/session-consolidator.ts — Session-end LLM consolidation
 *
 * Sprint 76: When a session goes idle for INACTIVITY_THRESHOLD_MS (10 min),
 * fires an LLM extraction: "What was important in this conversation?"
 * Persists the extracted facts directly into agent_memory.
 *
 * Design decisions:
 * - One timer per (agentId + sessionId) pair — deduped via Map key
 * - Resets the timer on every new message (touch())
 * - Uses llmCompact() from llm-compactor — same LLM + same JSON schema
 * - Non-blocking, non-fatal: failure logs and exits silently
 * - Only runs when there are ≥ MIN_MESSAGES_FOR_CONSOLIDATION messages
 */

import { logger, safeFire } from '../lib/logger.js';
import { getSessionManager } from './session-manager.js';
import { llmCompact } from './llm-compactor.js';
import { AgentMemoryRepository } from '../db/agent-memory.js';
import { ProviderRepository } from '../db/providers.js';
import { getDb } from '../db/index.js';

// ─── Config ──────────────────────────────────────────────────────────────────

/** 10 minutes of inactivity triggers consolidation */
const INACTIVITY_THRESHOLD_MS = 10 * 60 * 1000;

/** Minimum messages in session before consolidation is worth running */
const MIN_MESSAGES_FOR_CONSOLIDATION = 4;

// ─── State ────────────────────────────────────────────────────────────────────

/** Key: `${agentId}:${sessionId}` → active timer handle */
const activeTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Key: `${agentId}:${sessionId}` → timestamp of last consolidation */
const lastConsolidated = new Map<string, number>();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * touch — Called after every message in a session.
 * Resets the inactivity timer for this (agent, session) pair.
 */
export function touchSession(agentId: string, sessionId: string): void {
  const key = `${agentId}:${sessionId}`;

  // Clear any existing timer
  const existing = activeTimers.get(key);
  if (existing) clearTimeout(existing);

  // Set a new timer
  const timer = setTimeout(() => {
    activeTimers.delete(key);
    safeFire(runConsolidation(agentId, sessionId, key), 'consolidator:run');
  }, INACTIVITY_THRESHOLD_MS);

  activeTimers.set(key, timer);
}

/**
 * cancelSession — Called when a session is deleted or agent stops.
 * Cleans up any pending timers.
 */
export function cancelSession(agentId: string, sessionId: string): void {
  const key = `${agentId}:${sessionId}`;
  const timer = activeTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    activeTimers.delete(key);
  }
  lastConsolidated.delete(key);
}

// ─── Core Logic ───────────────────────────────────────────────────────────────

async function runConsolidation(agentId: string, sessionId: string, key: string): Promise<void> {
  try {
    logger.info('[SessionConsolidator] Session %s (agent %s) went idle — starting consolidation', sessionId, agentId);

    const sm = getSessionManager();
    const messages = sm.getMessages(sessionId);

    // Guard: too few messages to be worth consolidating
    if (messages.length < MIN_MESSAGES_FOR_CONSOLIDATION) {
      logger.debug('[SessionConsolidator] Skipping — only %d messages (min: %d)', messages.length, MIN_MESSAGES_FOR_CONSOLIDATION);
      return;
    }

    // Guard: avoid double-consolidation within 5 minutes
    const last = lastConsolidated.get(key) ?? 0;
    if (Date.now() - last < 5 * 60 * 1000) {
      logger.debug('[SessionConsolidator] Skipping — consolidated recently (%dmin ago)', Math.round((Date.now() - last) / 60_000));
      return;
    }

    // Build message list for LLM (skip system compaction notices)
    const relevantMessages = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content }));

    if (relevantMessages.length < 2) return;

    // Run LLM extraction
    const db = getDb();
    const providers = new ProviderRepository(db);
    const result = await llmCompact(relevantMessages, providers);

    if (!result || result.facts.length === 0) {
      logger.info('[SessionConsolidator] LLM returned no facts for session %s', sessionId);
      return;
    }

    // Persist extracted facts
    const memRepo = new AgentMemoryRepository(db);
    let stored = 0;
    for (const fact of result.facts) {
      memRepo.set(
        agentId,
        `${fact.type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        fact.value,
        (fact.type ?? 'fact') as import('../db/agent-memory.js').MemoryType,
        0.85,
        undefined,
        { source: 'session_consolidation' },
      );
      stored++;
    }

    // Log episode
    memRepo.logEpisode({
      sessionId,
      agentId,
      type: 'extraction',
      content: `Session-end consolidation: ${stored} facts extracted via ${result.model ?? 'heuristic'}. Summary: ${result.summary.slice(0, 300)}`,
      eventAt: new Date().toISOString(),
      metadata: {
        factsExtracted: stored,
        model: result.model,
        method: result.method,
        tokensUsed: result.tokensUsed,
      },
    });

    lastConsolidated.set(key, Date.now());

    logger.info('[SessionConsolidator] Session %s: stored %d facts from session-end consolidation (model: %s)',
      sessionId, stored, result.model ?? 'heuristic');

  } catch (err) {
    logger.warn('[SessionConsolidator] Consolidation failed for session %s: %s', sessionId, (err as Error).message);
  }
}
