import { v4 as uuid } from 'uuid';
import type Database from 'better-sqlite3';

export type MemoryType = 'short_term' | 'long_term' | 'entity' | 'preference' | 'fact' | 'decision' | 'goal' | 'event';
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
    opts?: { source?: string; tags?: string[] },
  ): MemoryEntry {
    try {
      this.ensureAgent(agentId); // auto-create stub if Bridge agent
      const id = uuid();
      const now = new Date().toISOString();
      const tagsJson = opts?.tags ? JSON.stringify(opts.tags) : '[]';

      // Upsert: if same agent+type+key exists, update it
      const existing = this.db
        .prepare('SELECT id FROM agent_memory WHERE agent_id = ? AND type = ? AND key = ?')
        .get(agentId, type, key) as { id: string } | undefined;

      if (existing) {
        this.db
          .prepare('UPDATE agent_memory SET value = ?, relevance = ?, expires_at = ?, source = ?, tags = ? WHERE id = ?')
          .run(value, relevance, expiresAt ?? null, opts?.source ?? null, tagsJson, existing.id);
        return this.get(existing.id)!;
      }

      this.db
        .prepare(
          `INSERT INTO agent_memory (id, agent_id, type, key, value, relevance, source, tags, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, agentId, type, key, value, relevance, opts?.source ?? null, tagsJson, now, expiresAt ?? null);

      return {
        id,
        agent_id: agentId,
        type,
        key,
        value,
        relevance,
        source: opts?.source ?? null,
        tags: tagsJson,
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
}
