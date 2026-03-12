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
}

