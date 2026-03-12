import type { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { homedir } from 'os';
import { AgentMemoryRepository, type MemoryType, type EdgeRelation } from '../db/agent-memory.js';

interface MemoryRow {
  id: string;
  type: string;
  content: string;
  tags: string;
  created_at: string;
}

export async function memoryRoutes(app: FastifyInstance) {
  const db = new Database(join(homedir(), '.superclaw', 'superclaw.db'));

  // Ensure legacy memories table exists (used by MemoryPanel)
  db.exec(`CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'fact',
    content TEXT NOT NULL,
    tags TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const agentMemRepo = new AgentMemoryRepository(db);

  const parseMemory = (row: MemoryRow) => ({
    ...row,
    tags: (() => { try { return JSON.parse(row.tags); } catch { return []; } })(),
  });

  // GET /memory — list all, with optional ?type= and ?search= filters
  app.get<{
    Querystring: { type?: string; search?: string };
  }>('/memory', async (req, reply) => {
    try {
      const { type, search } = req.query;
      let query = 'SELECT * FROM memories';
      const params: string[] = [];
      const conditions: string[] = [];

      if (type) {
        conditions.push('type = ?');
        params.push(type);
      }
      if (search) {
        conditions.push('(content LIKE ? OR tags LIKE ?)');
        params.push(`%${search}%`, `%${search}%`);
      }
      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }
      query += ' ORDER BY created_at DESC';

      const rows = db.prepare(query).all(...params) as MemoryRow[];
      return { data: rows.map(parseMemory) };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // GET /memory/types — return {types: {fact: N, decision: N, ...}, total: N}
  app.get('/memory/types', async (_req, reply) => {
    try {
      const rows = db.prepare('SELECT type, COUNT(*) as count FROM memories GROUP BY type').all() as { type: string; count: number }[];
      const types: Record<string, number> = {};
      let total = 0;
      for (const row of rows) {
        types[row.type] = row.count;
        total += row.count;
      }
      return { data: { types, total } };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // POST /memory — create {type, content, tags?} → memory object
  app.post<{
    Body: { type?: string; content: string; tags?: string[] };
  }>('/memory', async (req, reply) => {
    try {
      const { type = 'fact', content, tags = [] } = req.body;
      if (!content) {
        return reply.status(400).send({ error: { code: 'VALIDATION', message: 'content is required' } });
      }
      const id = randomUUID();
      const tagsJson = JSON.stringify(tags);
      db.prepare(
        'INSERT INTO memories (id, type, content, tags) VALUES (?, ?, ?, ?)'
      ).run(id, type, content, tagsJson);

      const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow;
      return reply.status(201).send({ data: parseMemory(row) });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // DELETE /memory/:id — delete by id → {success: true}
  app.delete<{ Params: { id: string } }>('/memory/:id', async (req, reply) => {
    try {
      const { id } = req.params;
      const existing = db.prepare('SELECT id FROM memories WHERE id = ?').get(id);
      if (!existing) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Memory not found' } });
      }
      db.prepare('DELETE FROM memories WHERE id = ?').run(id);
      return { data: { success: true } };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // ── Agent Memory Graph API ───────────────────────────────────────────────────

  // GET /memory/agents/:agentId — list memories for a specific agent
  app.get<{
    Params: { agentId: string };
    Querystring: { type?: MemoryType; search?: string; limit?: string };
  }>('/memory/agents/:agentId', async (req, reply) => {
    try {
      const { agentId } = req.params;
      const { type, search, limit } = req.query;
      const entries = agentMemRepo.list(agentId, {
        type,
        search,
        limit: limit ? parseInt(limit, 10) : undefined,
      });
      return { data: entries };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // GET /memory/agents/:agentId/graph — full graph (nodes + edges)
  app.get<{
    Params: { agentId: string };
    Querystring: { type?: MemoryType; limit?: string };
  }>('/memory/agents/:agentId/graph', async (req, reply) => {
    try {
      const { agentId } = req.params;
      const { type, limit } = req.query;
      const graph = agentMemRepo.getGraph(agentId, {
        type,
        limit: limit ? parseInt(limit, 10) : 50,
      });
      return { data: graph };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // POST /memory/agents/:agentId — create/upsert agent memory
  app.post<{
    Params: { agentId: string };
    Body: {
      key: string;
      value: string;
      type?: MemoryType;
      relevance?: number;
      expiresAt?: string;
      source?: string;
      tags?: string[];
    };
  }>('/memory/agents/:agentId', async (req, reply) => {
    try {
      const { agentId } = req.params;
      const { key, value, type = 'long_term', relevance = 1.0, expiresAt, source, tags } = req.body ?? {};
      if (!key || !value) {
        return reply.status(400).send({ error: { code: 'VALIDATION', message: 'key and value required' } });
      }
      const entry = agentMemRepo.set(agentId, key, value, type, relevance, expiresAt, { source, tags });
      // Auto-detect update edges
      agentMemRepo.detectUpdates(agentId, key, entry.id);
      return reply.status(201).send({ data: entry });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // DELETE /memory/agents/:agentId/:memoryId — delete specific agent memory
  app.delete<{
    Params: { agentId: string; memoryId: string };
  }>('/memory/agents/:agentId/:memoryId', async (req, reply) => {
    try {
      const deleted = agentMemRepo.delete(req.params.memoryId);
      if (!deleted) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Memory not found' } });
      }
      return { data: { success: true } };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // POST /memory/edges — create edge between two memory nodes
  app.post<{
    Body: { sourceId: string; targetId: string; relation: EdgeRelation; weight?: number };
  }>('/memory/edges', async (req, reply) => {
    try {
      const { sourceId, targetId, relation, weight = 1.0 } = req.body ?? {};
      if (!sourceId || !targetId || !relation) {
        return reply.status(400).send({ error: { code: 'VALIDATION', message: 'sourceId, targetId, relation required' } });
      }
      const edge = agentMemRepo.addEdge(sourceId, targetId, relation, weight);
      return reply.status(201).send({ data: edge });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // GET /memory/:memoryId/related — find related memories via graph traversal
  app.get<{
    Params: { memoryId: string };
    Querystring: { relation?: EdgeRelation };
  }>('/memory/:memoryId/related', async (req, reply) => {
    try {
      const related = agentMemRepo.findRelated(req.params.memoryId, req.query.relation);
      // Track access
      agentMemRepo.touch(req.params.memoryId);
      return { data: related };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // DELETE /memory/edges/:edgeId — remove edge
  app.delete<{ Params: { edgeId: string } }>('/memory/edges/:edgeId', async (req, reply) => {
    try {
      const deleted = agentMemRepo.removeEdge(req.params.edgeId);
      if (!deleted) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Edge not found' } });
      }
      return { data: { success: true } };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // ── Sprint 65: Eidetic Memory Layer APIs ──────────────────────────────────

  // GET /memory/search/fts — Full-text search across ALL message history
  app.get<{
    Querystring: { q: string; session_id?: string; limit?: string; snippets?: string };
  }>('/memory/search/fts', async (req, reply) => {
    try {
      const { q, session_id, limit, snippets } = req.query;
      if (!q) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'q (query) is required' } });

      const maxResults = limit ? parseInt(limit, 10) : 20;

      if (snippets === 'true') {
        const results = agentMemRepo.archivalSearchWithSnippets(q, { sessionId: session_id, limit: maxResults });
        return { data: results };
      }

      const results = agentMemRepo.archivalSearch(q, { sessionId: session_id, limit: maxResults });
      return { data: results };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // GET /memory/agents/:agentId/core — Get core memory blocks
  app.get<{
    Params: { agentId: string };
  }>('/memory/agents/:agentId/core', async (req, reply) => {
    try {
      const blocks = agentMemRepo.getCoreBlocks(req.params.agentId);
      return { data: blocks };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // PUT /memory/agents/:agentId/core/:blockName — Set core memory block
  app.put<{
    Params: { agentId: string; blockName: string };
    Body: { content: string; max_tokens?: number };
  }>('/memory/agents/:agentId/core/:blockName', async (req, reply) => {
    try {
      const { agentId, blockName } = req.params;
      const { content, max_tokens } = req.body ?? {};
      if (content === undefined) {
        return reply.status(400).send({ error: { code: 'VALIDATION', message: 'content is required' } });
      }
      agentMemRepo.setCoreBlock(agentId, blockName, content, max_tokens);
      return { data: { success: true, block: blockName } };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // GET /memory/agents/:agentId/temporal — Get memories valid at a specific date
  app.get<{
    Params: { agentId: string };
    Querystring: { date: string; type?: MemoryType; limit?: string };
  }>('/memory/agents/:agentId/temporal', async (req, reply) => {
    try {
      const { agentId } = req.params;
      const { date, type, limit } = req.query;
      if (!date) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'date is required' } });

      const entries = agentMemRepo.getValidAt(agentId, date, {
        type,
        limit: limit ? parseInt(limit, 10) : undefined,
      });
      return { data: entries };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // GET /memory/working/:sessionId — Get working memory for a session
  app.get<{
    Params: { sessionId: string };
  }>('/memory/working/:sessionId', async (req, reply) => {
    try {
      const wm = agentMemRepo.getWorkingMemory(req.params.sessionId);
      return { data: wm };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // PUT /memory/working/:sessionId — Save working memory
  app.put<{
    Params: { sessionId: string };
    Body: {
      agent_id?: string;
      active_goals?: string[];
      current_plan?: string;
      completed_steps?: string[];
      next_actions?: string[];
      pending_context?: string;
      open_questions?: string[];
    };
  }>('/memory/working/:sessionId', async (req, reply) => {
    try {
      const body = req.body ?? {};
      agentMemRepo.saveWorkingMemory(req.params.sessionId, body.agent_id ?? '', {
        activeGoals: body.active_goals,
        currentPlan: body.current_plan,
        completedSteps: body.completed_steps,
        nextActions: body.next_actions,
        pendingContext: body.pending_context,
        openQuestions: body.open_questions,
      });
      return { data: { success: true } };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // ── Episodes & Compaction History ─────────────────────────────────────────

  // GET /memory/episodes/:sessionId — Get episodes for a session
  app.get<{
    Params: { sessionId: string };
    Querystring: { type?: string; limit?: string };
  }>('/memory/episodes/:sessionId', async (req, reply) => {
    try {
      const { sessionId } = req.params;
      const { type, limit } = req.query;
      const maxResults = limit ? parseInt(limit, 10) : 50;

      let query = 'SELECT * FROM episodes WHERE session_id = ?';
      const params: unknown[] = [sessionId];
      if (type) {
        query += ' AND type = ?';
        params.push(type);
      }
      query += ' ORDER BY event_at DESC LIMIT ?';
      params.push(maxResults);

      const rows = db.prepare(query).all(...params);
      return { data: rows };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // GET /memory/compactions/:sessionId — Get compaction history
  app.get<{
    Params: { sessionId: string };
    Querystring: { limit?: string };
  }>('/memory/compactions/:sessionId', async (req, reply) => {
    try {
      const { sessionId } = req.params;
      const maxResults = req.query.limit ? parseInt(req.query.limit, 10) : 20;

      const rows = db.prepare(
        'SELECT * FROM compaction_log WHERE session_id = ? ORDER BY created_at DESC LIMIT ?'
      ).all(sessionId, maxResults);
      return { data: rows };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });

  // GET /memory/stats/:agentId — Memory statistics for an agent
  app.get<{
    Params: { agentId: string };
  }>('/memory/stats/:agentId', async (req, reply) => {
    try {
      const { agentId } = req.params;

      const totalMemories = (db.prepare(
        'SELECT COUNT(*) as cnt FROM agent_memory WHERE agent_id = ?'
      ).get(agentId) as { cnt: number }).cnt;

      const byType = db.prepare(
        'SELECT type, COUNT(*) as cnt FROM agent_memory WHERE agent_id = ? GROUP BY type ORDER BY cnt DESC'
      ).all(agentId) as Array<{ type: string; cnt: number }>;

      const totalEdges = (db.prepare(
        `SELECT COUNT(*) as cnt FROM memory_edges WHERE source_id IN (SELECT id FROM agent_memory WHERE agent_id = ?)`
      ).get(agentId) as { cnt: number }).cnt;

      const coreBlocks = db.prepare(
        'SELECT block_name, LENGTH(content) as size FROM core_memory_blocks WHERE agent_id = ?'
      ).all(agentId) as Array<{ block_name: string; size: number }>;

      const recentExtractions = (db.prepare(
        `SELECT COUNT(*) as cnt FROM episodes WHERE agent_id = ? AND type = 'extraction' AND event_at > datetime('now', '-24 hours')`
      ).get(agentId) as { cnt: number }).cnt;

      return {
        data: {
          total_memories: totalMemories,
          by_type: byType,
          total_edges: totalEdges,
          core_blocks: coreBlocks,
          extractions_24h: recentExtractions,
        },
      };
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: { code: 'INTERNAL', message: String(err) } });
    }
  });
}