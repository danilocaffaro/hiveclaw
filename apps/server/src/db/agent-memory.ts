import { v4 as uuid } from 'uuid';
import type Database from 'better-sqlite3';

export type MemoryType = 'short_term' | 'long_term' | 'entity' | 'preference' | 'fact' | 'decision' | 'goal' | 'event' | 'procedure' | 'correction';
export type EdgeRelation = 'related_to' | 'updates' | 'contradicts' | 'supports' | 'caused_by' | 'part_of';

export interface MemoryEntry {
  id: string;
  agent_id: string;
  type: MemoryType;
  key: string;
  value: string;
  relevance: number;
  source?: string | null;
  tags?: string;
  access_count?: number;
  last_accessed?: string | null;
  event_at?: string | null;
  valid_until?: string | null;
  created_at: string;
  expires_at: string | null;
}

export interface MemoryEdge {
  id: string;
  source_id: string;
  target_id: string;
  relation: EdgeRelation;
  weight: number;
  created_at: string;
}

export interface MemoryGraph {
  nodes: MemoryEntry[];
  edges: MemoryEdge[];
}

/** Create a typed error Fastify can serialise */
function dbError(err: unknown): never {
  const msg = err instanceof Error ? err.message : 'Database error';
  throw Object.assign(new Error(msg), { statusCode: 500, code: 'DB_ERROR' });
}

export class AgentMemoryRepository {
  constructor(private db: Database.Database) {}

  /** Ensure a stub agent row exists so FK constraint is satisfied for Bridge agents */
  private ensureAgent(agentId: string): void {
    const exists = this.db.prepare('SELECT id FROM agents WHERE id = ?').get(agentId);
    if (!exists) {
      try {
        this.db
          .prepare(`INSERT OR IGNORE INTO agents (id, name, emoji, role, type, system_prompt, color, skills, model_preference, created_at, updated_at)
                    VALUES (?, ?, '🤖', 'assistant', 'specialist', '', NULL, '[]', '', datetime('now'), datetime('now'))`)
          .run(agentId, agentId);
      } catch { /* ignore — may fail if schema differs */ }
    }
  }

  /** Store a memory (upsert by agent+type+key) */
  set(
    agentId: string,
    key: string,
    value: string,
    type: MemoryType = 'short_term',
    relevance = 1.0,
    expiresAt?: string,
    opts?: { source?: string; tags?: string[]; eventAt?: string; validUntil?: string },
  ): MemoryEntry {
    try {
      this.ensureAgent(agentId); // auto-create stub if Bridge agent
      const id = uuid();
      const now = new Date().toISOString();
      const tagsJson = opts?.tags ? JSON.stringify(opts.tags) : '[]';
      const eventAt = opts?.eventAt ?? null;
      const validUntil = opts?.validUntil ?? null;

      // Upsert: if same agent+type+key exists, update it
      const existing = this.db
        .prepare('SELECT id FROM agent_memory WHERE agent_id = ? AND type = ? AND key = ?')
        .get(agentId, type, key) as { id: string } | undefined;

      if (existing) {
        this.db
          .prepare('UPDATE agent_memory SET value = ?, relevance = ?, expires_at = ?, source = ?, tags = ?, event_at = ?, valid_until = ? WHERE id = ?')
          .run(value, relevance, expiresAt ?? null, opts?.source ?? null, tagsJson, eventAt, validUntil, existing.id);
        return this.get(existing.id)!;
      }

      this.db
        .prepare(
          `INSERT INTO agent_memory (id, agent_id, type, key, value, relevance, source, tags, event_at, valid_until, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, agentId, type, key, value, relevance, opts?.source ?? null, tagsJson, eventAt, validUntil, now, expiresAt ?? null);

      return {
        id,
        agent_id: agentId,
        type,
        key,
        value,
        relevance,
        source: opts?.source ?? null,
        tags: tagsJson,
        event_at: eventAt,
        valid_until: validUntil,
        created_at: now,
        expires_at: expiresAt ?? null,
      };
    } catch (err) {
      dbError(err);
    }
  }

  /** Get by ID */
  get(id: string): MemoryEntry | undefined {
    try {
      return this.db
        .prepare('SELECT * FROM agent_memory WHERE id = ?')
        .get(id) as MemoryEntry | undefined;
    } catch (err) {
      dbError(err);
    }
  }

  /** List memories for an agent */
  list(
    agentId: string,
    opts?: { type?: MemoryType; limit?: number; search?: string },
  ): MemoryEntry[] {
    try {
      let sql = 'SELECT * FROM agent_memory WHERE agent_id = ?';
      const params: unknown[] = [agentId];

      // Filter out expired
      sql += " AND (expires_at IS NULL OR expires_at > datetime('now'))";

      if (opts?.type) {
        sql += ' AND type = ?';
        params.push(opts.type);
      }
      if (opts?.search) {
        sql += ' AND (key LIKE ? OR value LIKE ?)';
        params.push(`%${opts.search}%`, `%${opts.search}%`);
      }

      sql += ' ORDER BY relevance DESC, created_at DESC';

      if (opts?.limit) {
        sql += ' LIMIT ?';
        params.push(opts.limit);
      }

      return this.db.prepare(sql).all(...params) as MemoryEntry[];
    } catch (err) {
      dbError(err);
    }
  }

  /** Delete a memory */
  delete(id: string): boolean {
    try {
      const result = this.db.prepare('DELETE FROM agent_memory WHERE id = ?').run(id);
      return result.changes > 0;
    } catch (err) {
      dbError(err);
    }
  }

  /** Clear all memories for an agent */
  clearAgent(agentId: string, type?: MemoryType): number {
    try {
      if (type) {
        return this.db
          .prepare('DELETE FROM agent_memory WHERE agent_id = ? AND type = ?')
          .run(agentId, type).changes;
      }
      return this.db
        .prepare('DELETE FROM agent_memory WHERE agent_id = ?')
        .run(agentId).changes;
    } catch (err) {
      dbError(err);
    }
  }

  /** Prune expired entries */
  prune(): number {
    try {
      return this.db
        .prepare(
          "DELETE FROM agent_memory WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')",
        )
        .run().changes;
    } catch (err) {
      dbError(err);
    }
  }

  /** Search memories across all agents by query string */
  search(query: string, limit = 20): MemoryEntry[] {
    try {
      const pattern = `%${query}%`;
      return this.db
        .prepare(
          `SELECT * FROM agent_memory
           WHERE (value LIKE ? OR key LIKE ?)
             AND (expires_at IS NULL OR expires_at > datetime('now'))
           ORDER BY relevance DESC, created_at DESC
           LIMIT ?`,
        )
        .all(pattern, pattern, limit) as MemoryEntry[];
    } catch (err) {
      dbError(err);
    }
  }

  /** Get memory context string for injection into agent prompt */
  getContextString(agentId: string, maxEntries = 20): string {
    try {
      const memories = this.list(agentId, { limit: maxEntries });
      if (memories.length === 0) return '';

      const grouped: Record<string, MemoryEntry[]> = {};
      for (const m of memories) {
        (grouped[m.type] ??= []).push(m);
      }

      let context = '\n\n--- Agent Memory ---\n';
      for (const [type, entries] of Object.entries(grouped)) {
        context += `\n[${type}]\n`;
        for (const e of entries) {
          context += `- ${e.key}: ${e.value}\n`;
        }
      }

      // Add graph relationships for high-relevance items
      const topMemories = memories.filter((m) => m.relevance >= 0.7).slice(0, 10);
      if (topMemories.length > 0) {
        const edges = this.getEdgesForMemories(topMemories.map((m) => m.id));
        if (edges.length > 0) {
          context += '\n[relationships]\n';
          const memoryMap = new Map(memories.map((m) => [m.id, m]));
          for (const edge of edges.slice(0, 15)) {
            const src = memoryMap.get(edge.source_id);
            const tgt = memoryMap.get(edge.target_id);
            if (src && tgt) {
              context += `- "${src.key}" ${edge.relation} "${tgt.key}"\n`;
            }
          }
        }
      }

      return context;
    } catch (err) {
      dbError(err);
    }
  }

  // ─── Graph Edge Operations ──────────────────────────────────────────────────

  /** Create an edge between two memory entries */
  addEdge(
    sourceId: string,
    targetId: string,
    relation: EdgeRelation,
    weight = 1.0,
  ): MemoryEdge {
    try {
      const id = uuid();
      const now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT OR REPLACE INTO memory_edges (id, source_id, target_id, relation, weight, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, sourceId, targetId, relation, weight, now);
      return { id, source_id: sourceId, target_id: targetId, relation, weight, created_at: now };
    } catch (err) {
      dbError(err);
    }
  }

  /** Get all edges connected to a memory entry */
  getEdges(memoryId: string): MemoryEdge[] {
    try {
      return this.db
        .prepare(
          `SELECT * FROM memory_edges WHERE source_id = ? OR target_id = ? ORDER BY weight DESC`,
        )
        .all(memoryId, memoryId) as MemoryEdge[];
    } catch (err) {
      dbError(err);
    }
  }

  /** Get edges for multiple memory IDs (batch lookup for context building) */
  getEdgesForMemories(memoryIds: string[]): MemoryEdge[] {
    if (memoryIds.length === 0) return [];
    try {
      const placeholders = memoryIds.map(() => '?').join(',');
      return this.db
        .prepare(
          `SELECT * FROM memory_edges
           WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})
           ORDER BY weight DESC LIMIT 30`,
        )
        .all(...memoryIds, ...memoryIds) as MemoryEdge[];
    } catch (err) {
      dbError(err);
    }
  }

  /** Remove an edge */
  removeEdge(edgeId: string): boolean {
    try {
      return this.db.prepare('DELETE FROM memory_edges WHERE id = ?').run(edgeId).changes > 0;
    } catch (err) {
      dbError(err);
    }
  }

  /** Get the full memory graph for an agent (nodes + edges) */
  getGraph(agentId: string, opts?: { type?: MemoryType; limit?: number }): MemoryGraph {
    try {
      const nodes = this.list(agentId, { limit: opts?.limit ?? 50, type: opts?.type });
      if (nodes.length === 0) return { nodes, edges: [] };
      const nodeIds = nodes.map((n) => n.id);
      const edges = this.getEdgesForMemories(nodeIds);
      return { nodes, edges };
    } catch (err) {
      dbError(err);
    }
  }

  /** Track memory access (for relevance decay / recency boosting) */
  touch(memoryId: string): void {
    try {
      this.db
        .prepare(
          `UPDATE agent_memory SET access_count = access_count + 1, last_accessed = datetime('now') WHERE id = ?`,
        )
        .run(memoryId);
    } catch {
      // Non-fatal
    }
  }

  /** Find related memories by following edges (1 hop) */
  findRelated(memoryId: string, relation?: EdgeRelation): MemoryEntry[] {
    try {
      let sql = `
        SELECT m.* FROM agent_memory m
        INNER JOIN memory_edges e ON (
          (e.source_id = ? AND e.target_id = m.id) OR
          (e.target_id = ? AND e.source_id = m.id)
        )`;
      const params: unknown[] = [memoryId, memoryId];

      if (relation) {
        sql += ' WHERE e.relation = ?';
        params.push(relation);
      }
      sql += ' ORDER BY e.weight DESC LIMIT 20';

      return this.db.prepare(sql).all(...params) as MemoryEntry[];
    } catch (err) {
      dbError(err);
    }
  }

  /** Find memories that contradict a given memory */
  findContradictions(memoryId: string): MemoryEntry[] {
    return this.findRelated(memoryId, 'contradicts');
  }

  /** Auto-detect and create 'updates' edges when new memory overwrites old */
  detectUpdates(agentId: string, key: string, newMemoryId: string): void {
    try {
      // Find older memories with the same key
      const older = this.db
        .prepare(
          `SELECT id FROM agent_memory
           WHERE agent_id = ? AND key = ? AND id != ?
           ORDER BY created_at DESC LIMIT 3`,
        )
        .all(agentId, key, newMemoryId) as { id: string }[];

      for (const old of older) {
        this.addEdge(newMemoryId, old.id, 'updates');
      }
    } catch {
      // Non-fatal
    }
  }

  // ─── Sprint 65: Eidetic Memory Layer ──────────────────────────────────────

  // ── FTS5 Archival Search ──────────────────────────────────────────────────

  /** Full-text search across ALL message history (FTS5 BM25 ranking) */
  archivalSearch(query: string, opts?: { sessionId?: string; limit?: number }): Array<{
    content: string;
    session_id: string;
    agent_id: string;
    role: string;
    created_at: string;
    bm25_score: number;
  }> {
    try {
      const limit = opts?.limit ?? 20;
      // Escape FTS5 special chars
      const safeQuery = query.replace(/['"*()]/g, ' ').trim();
      if (!safeQuery) return [];

      if (opts?.sessionId) {
        return this.db.prepare(`
          SELECT content, session_id, agent_id, role, created_at, rank AS bm25_score
          FROM messages_fts
          WHERE messages_fts MATCH ?
            AND session_id = ?
          ORDER BY rank
          LIMIT ?
        `).all(safeQuery, opts.sessionId, limit) as Array<{
          content: string; session_id: string; agent_id: string;
          role: string; created_at: string; bm25_score: number;
        }>;
      }

      return this.db.prepare(`
        SELECT content, session_id, agent_id, role, created_at, rank AS bm25_score
        FROM messages_fts
        WHERE messages_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(safeQuery, limit) as Array<{
        content: string; session_id: string; agent_id: string;
        role: string; created_at: string; bm25_score: number;
      }>;
    } catch {
      // FTS5 table may not exist yet
      return [];
    }
  }

  /** FTS5 search with snippet extraction (context around match) */
  archivalSearchWithSnippets(query: string, opts?: { sessionId?: string; limit?: number }): Array<{
    snippet: string;
    session_id: string;
    created_at: string;
    bm25_score: number;
  }> {
    try {
      const limit = opts?.limit ?? 10;
      const safeQuery = query.replace(/['"*()]/g, ' ').trim();
      if (!safeQuery) return [];

      let sql = `
        SELECT snippet(messages_fts, 0, '>>>', '<<<', '...', 40) AS snippet,
               session_id, created_at, rank AS bm25_score
        FROM messages_fts
        WHERE messages_fts MATCH ?`;
      const params: unknown[] = [safeQuery];

      if (opts?.sessionId) {
        sql += ' AND session_id = ?';
        params.push(opts.sessionId);
      }
      sql += ' ORDER BY rank LIMIT ?';
      params.push(limit);

      return this.db.prepare(sql).all(...params) as Array<{
        snippet: string; session_id: string; created_at: string; bm25_score: number;
      }>;
    } catch {
      return [];
    }
  }

  // ── Temporal Queries (Zep-inspired bi-temporal) ───────────────────────────

  /** Get memories that were valid at a specific point in time */
  getValidAt(agentId: string, date: string, opts?: { type?: MemoryType; limit?: number }): MemoryEntry[] {
    try {
      let sql = `
        SELECT * FROM agent_memory
        WHERE agent_id = ?
          AND (event_at IS NULL OR event_at <= ?)
          AND (valid_until IS NULL OR valid_until > ?)
          AND (expires_at IS NULL OR expires_at > datetime('now'))`;
      const params: unknown[] = [agentId, date, date];

      if (opts?.type) {
        sql += ' AND type = ?';
        params.push(opts.type);
      }
      sql += ' ORDER BY relevance DESC, created_at DESC';
      if (opts?.limit) {
        sql += ' LIMIT ?';
        params.push(opts.limit);
      }

      return this.db.prepare(sql).all(...params) as MemoryEntry[];
    } catch (err) {
      dbError(err);
    }
  }

  /** Invalidate a memory (set valid_until to now) */
  invalidate(memoryId: string): void {
    try {
      this.db.prepare(
        "UPDATE agent_memory SET valid_until = datetime('now') WHERE id = ?"
      ).run(memoryId);
    } catch { /* non-fatal */ }
  }

  /** Set with temporal contradiction detection */
  setWithContradictionCheck(
    agentId: string,
    key: string,
    value: string,
    type: MemoryType = 'fact',
    opts?: { source?: string; tags?: string[]; eventAt?: string; relevance?: number },
  ): { memory: MemoryEntry; contradicted: MemoryEntry[] } {
    // Find existing valid memories with the same key
    const existing = this.db.prepare(
      `SELECT * FROM agent_memory
       WHERE agent_id = ? AND key = ? AND (valid_until IS NULL)
       ORDER BY created_at DESC`
    ).all(agentId, key) as MemoryEntry[];

    // Create new memory
    const memory = this.set(agentId, key, value, type, opts?.relevance ?? 1.0, undefined, {
      source: opts?.source,
      tags: opts?.tags,
      eventAt: opts?.eventAt,
    });

    // Invalidate old ones and create contradiction edges
    const contradicted: MemoryEntry[] = [];
    for (const old of existing) {
      if (old.id === memory.id) continue; // skip self (upsert case)
      if (old.value !== value) {
        this.invalidate(old.id);
        this.addEdge(memory.id, old.id, 'contradicts');
        contradicted.push(old);
      }
    }

    // Detect updates (same key, old values)
    this.detectUpdates(agentId, key, memory.id);

    return { memory, contradicted };
  }

  // ── Core Memory Blocks ────────────────────────────────────────────────────

  /** Get all core memory blocks for an agent */
  getCoreBlocks(agentId: string): Array<{ block_name: string; content: string; max_tokens: number }> {
    try {
      return this.db.prepare(
        'SELECT block_name, content, max_tokens FROM core_memory_blocks WHERE agent_id = ? ORDER BY block_name'
      ).all(agentId) as Array<{ block_name: string; content: string; max_tokens: number }>;
    } catch {
      return [];
    }
  }

  /** Get a specific core memory block */
  getCoreBlock(agentId: string, blockName: string): string {
    try {
      const row = this.db.prepare(
        'SELECT content FROM core_memory_blocks WHERE agent_id = ? AND block_name = ?'
      ).get(agentId, blockName) as { content: string } | undefined;
      return row?.content ?? '';
    } catch {
      return '';
    }
  }

  /** Set/create a core memory block */
  setCoreBlock(agentId: string, blockName: string, content: string, maxTokens = 500): void {
    try {
      this.ensureAgent(agentId);
      const id = uuid();
      const now = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO core_memory_blocks (id, agent_id, block_name, content, max_tokens, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(agent_id, block_name) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
      `).run(id, agentId, blockName, content, maxTokens, now, now);
    } catch { /* non-fatal */ }
  }

  /** Replace text within a core memory block (surgical edit) */
  coreBlockReplace(agentId: string, blockName: string, oldText: string, newText: string): boolean {
    try {
      const current = this.getCoreBlock(agentId, blockName);
      if (!current.includes(oldText)) return false;
      const updated = current.replace(oldText, newText);
      this.setCoreBlock(agentId, blockName, updated);
      return true;
    } catch {
      return false;
    }
  }

  /** Append text to a core memory block */
  coreBlockAppend(agentId: string, blockName: string, text: string): void {
    try {
      const current = this.getCoreBlock(agentId, blockName);
      this.setCoreBlock(agentId, blockName, current ? `${current}\n${text}` : text);
    } catch { /* non-fatal */ }
  }

  /** Get core memory formatted for system prompt injection */
  getCoreMemoryPrompt(agentId: string): string {
    const blocks = this.getCoreBlocks(agentId);
    if (blocks.length === 0) return '';

    let prompt = '\n\n## Core Memory\n';
    for (const block of blocks) {
      prompt += `\n### ${block.block_name}\n${block.content}\n`;
    }
    return prompt;
  }

  // ── Working Memory ────────────────────────────────────────────────────────

  /** Save working memory (task continuation state) for a session */
  saveWorkingMemory(sessionId: string, agentId: string, state: {
    activeGoals?: string[];
    currentPlan?: string;
    completedSteps?: string[];
    nextActions?: string[];
    pendingContext?: string;
    openQuestions?: string[];
    toolState?: Record<string, unknown>;
  }): void {
    try {
      const id = uuid();
      const now = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO working_memory (id, session_id, agent_id, active_goals, current_plan, completed_steps, next_actions, pending_context, open_questions, tool_state, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          agent_id = excluded.agent_id,
          active_goals = excluded.active_goals,
          current_plan = excluded.current_plan,
          completed_steps = excluded.completed_steps,
          next_actions = excluded.next_actions,
          pending_context = excluded.pending_context,
          open_questions = excluded.open_questions,
          tool_state = excluded.tool_state,
          updated_at = excluded.updated_at
      `).run(
        id, sessionId, agentId,
        JSON.stringify(state.activeGoals ?? []),
        state.currentPlan ?? '',
        JSON.stringify(state.completedSteps ?? []),
        JSON.stringify(state.nextActions ?? []),
        state.pendingContext ?? '',
        JSON.stringify(state.openQuestions ?? []),
        JSON.stringify(state.toolState ?? {}),
        now, now,
      );
    } catch { /* non-fatal */ }
  }

  /** Get working memory for a session */
  getWorkingMemory(sessionId: string): {
    activeGoals: string[];
    currentPlan: string;
    completedSteps: string[];
    nextActions: string[];
    pendingContext: string;
    openQuestions: string[];
  } | null {
    try {
      const row = this.db.prepare(
        'SELECT * FROM working_memory WHERE session_id = ?'
      ).get(sessionId) as Record<string, unknown> | undefined;
      if (!row) return null;

      return {
        activeGoals: JSON.parse(row.active_goals as string || '[]'),
        currentPlan: row.current_plan as string || '',
        completedSteps: JSON.parse(row.completed_steps as string || '[]'),
        nextActions: JSON.parse(row.next_actions as string || '[]'),
        pendingContext: row.pending_context as string || '',
        openQuestions: JSON.parse(row.open_questions as string || '[]'),
      };
    } catch {
      return null;
    }
  }

  /** Format working memory for prompt injection */
  getWorkingMemoryPrompt(sessionId: string): string {
    const wm = this.getWorkingMemory(sessionId);
    if (!wm) return '';

    const parts: string[] = ['\n\n## Working Memory (auto-saved task state)'];
    if (wm.activeGoals.length > 0) parts.push(`**Goals:** ${wm.activeGoals.join('; ')}`);
    if (wm.currentPlan) parts.push(`**Plan:** ${wm.currentPlan}`);
    if (wm.completedSteps.length > 0) parts.push(`**Done:** ${wm.completedSteps.join('; ')}`);
    if (wm.nextActions.length > 0) parts.push(`**Next:** ${wm.nextActions.join('; ')}`);
    if (wm.pendingContext) parts.push(`**Context:** ${wm.pendingContext}`);
    if (wm.openQuestions.length > 0) parts.push(`**Open questions:** ${wm.openQuestions.join('; ')}`);

    return parts.length > 1 ? parts.join('\n') : '';
  }

  // ── Episodes ──────────────────────────────────────────────────────────────

  /** Log an episode event */
  logEpisode(opts: {
    sessionId?: string;
    agentId?: string;
    type: 'message' | 'compaction' | 'extraction' | 'decision' | 'event';
    content: string;
    eventAt?: string;
    metadata?: Record<string, unknown>;
  }): void {
    try {
      const id = uuid();
      this.db.prepare(`
        INSERT INTO episodes (id, session_id, agent_id, type, content, event_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        opts.sessionId ?? null,
        opts.agentId ?? '',
        opts.type,
        opts.content,
        opts.eventAt ?? new Date().toISOString(),
        JSON.stringify(opts.metadata ?? {}),
      );
    } catch { /* non-fatal */ }
  }

  /** Log a compaction event */
  logCompaction(sessionId: string, summary: string, stats: {
    extractedFacts?: number;
    messagesCompacted?: number;
    tokensBefore?: number;
    tokensAfter?: number;
    workingMemorySaved?: boolean;
  }): void {
    try {
      const id = uuid();
      this.db.prepare(`
        INSERT INTO compaction_log (id, session_id, summary, extracted_facts, messages_compacted, tokens_before, tokens_after, working_memory_saved)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, sessionId, summary,
        stats.extractedFacts ?? 0,
        stats.messagesCompacted ?? 0,
        stats.tokensBefore ?? 0,
        stats.tokensAfter ?? 0,
        stats.workingMemorySaved ? 1 : 0,
      );
    } catch { /* non-fatal */ }
  }

  // ── Enhanced Context String (budget-aware) ────────────────────────────────

  /** Get memory context string with token budget management */
  getContextStringBudgeted(agentId: string, sessionId: string, tokenBudget = 6000): string {
    try {
      const parts: string[] = [];
      let tokensUsed = 0;

      // 1. Core memory blocks (always included, ~2K budget)
      const corePrompt = this.getCoreMemoryPrompt(agentId);
      if (corePrompt) {
        const coreTokens = Math.ceil(corePrompt.length / 4);
        parts.push(corePrompt);
        tokensUsed += coreTokens;
      }

      // 2. Working memory (always included if exists, ~500 tokens)
      const wmPrompt = this.getWorkingMemoryPrompt(sessionId);
      if (wmPrompt) {
        const wmTokens = Math.ceil(wmPrompt.length / 4);
        parts.push(wmPrompt);
        tokensUsed += wmTokens;
      }

      // 3. Active goals and decisions (pinned, always included)
      const pinned = this.list(agentId, { type: 'goal', limit: 5 });
      const decisions = this.list(agentId, { type: 'decision', limit: 5 });
      const pinnedAll = [...pinned, ...decisions].filter(m => !m.valid_until); // only currently valid

      if (pinnedAll.length > 0) {
        let pinnedStr = '\n\n## Active Goals & Decisions\n';
        for (const m of pinnedAll) {
          const line = `- [${m.type}] ${m.key}: ${m.value}\n`;
          const lineTokens = Math.ceil(line.length / 4);
          if (tokensUsed + lineTokens > tokenBudget) break;
          pinnedStr += line;
          tokensUsed += lineTokens;
        }
        parts.push(pinnedStr);
      }

      // 4. Remaining budget → top-K relevance-scored memories
      const remaining = tokenBudget - tokensUsed;
      if (remaining > 200) {
        const topK = this.list(agentId, { limit: 30 });
        // Exclude already-included pinned items
        const pinnedIds = new Set(pinnedAll.map(m => m.id));
        const candidates = topK.filter(m => !pinnedIds.has(m.id) && !m.valid_until);

        if (candidates.length > 0) {
          let memStr = '\n\n## Agent Memory\n';
          for (const m of candidates) {
            const line = `- [${m.type}] ${m.key}: ${m.value}\n`;
            const lineTokens = Math.ceil(line.length / 4);
            if (tokensUsed + lineTokens > tokenBudget) break;
            memStr += line;
            tokensUsed += lineTokens;
          }
          parts.push(memStr);
        }
      }

      return parts.join('');
    } catch {
      // Fallback to legacy method
      return this.getContextString(agentId);
    }
  }
}
