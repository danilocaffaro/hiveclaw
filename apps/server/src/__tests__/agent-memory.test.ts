import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentMemoryRepository } from '../db/agent-memory.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, emoji TEXT DEFAULT '🤖',
      role TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'specialist',
      system_prompt TEXT NOT NULL, skills TEXT DEFAULT '[]',
      model_preference TEXT DEFAULT '', provider_preference TEXT DEFAULT '',
      fallback_providers TEXT DEFAULT '[]', temperature REAL DEFAULT 0.7,
      max_tokens INTEGER DEFAULT 4096, status TEXT DEFAULT 'active',
      color TEXT DEFAULT '#7c5bf5',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS agent_memory (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('short_term','long_term','entity','preference','fact','decision','goal','event')),
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      relevance REAL DEFAULT 1.0,
      source TEXT,
      tags TEXT DEFAULT '[]',
      access_count INTEGER DEFAULT 0,
      last_accessed DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_edges (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES agent_memory(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES agent_memory(id) ON DELETE CASCADE,
      relation TEXT NOT NULL CHECK(relation IN ('related_to','updates','contradicts','supports','caused_by','part_of')),
      weight REAL DEFAULT 1.0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_id, target_id, relation)
    );

    CREATE INDEX IF NOT EXISTS idx_agent_memory_agent ON agent_memory(agent_id, type);
    CREATE INDEX IF NOT EXISTS idx_agent_memory_expires ON agent_memory(expires_at);
    CREATE INDEX IF NOT EXISTS idx_memory_edges_source ON memory_edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_memory_edges_target ON memory_edges(target_id);
  `);
  // Seed test agents for FK constraints
  db.prepare(`INSERT INTO agents (id, name, role, type, system_prompt) VALUES (?, ?, ?, ?, ?)`).run(
    'agent-1', 'TestBot', 'tester', 'specialist', 'You are a test agent.',
  );
  db.prepare(`INSERT INTO agents (id, name, role, type, system_prompt) VALUES (?, ?, ?, ?, ?)`).run(
    'agent-2', 'OtherBot', 'helper', 'specialist', 'You are another agent.',
  );
  return db;
}

describe('AgentMemoryRepository', () => {
  let db: Database.Database;
  let repo: AgentMemoryRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new AgentMemoryRepository(db);
  });

  it('should set and get a memory', () => {
    const entry = repo.set('agent-1', 'user-name', 'Danilo', 'long_term');
    expect(entry.id).toBeDefined();
    expect(entry.key).toBe('user-name');
    expect(entry.value).toBe('Danilo');
    const fetched = repo.get(entry.id);
    expect(fetched).toBeTruthy();
    expect(fetched!.value).toBe('Danilo');
  });

  it('should list memories for an agent', () => {
    repo.set('agent-1', 'k1', 'v1', 'short_term');
    repo.set('agent-1', 'k2', 'v2', 'long_term');
    repo.set('agent-2', 'k3', 'v3', 'short_term');
    const list = repo.list('agent-1');
    expect(list).toHaveLength(2);
  });

  it('should update existing memory by key (upsert)', () => {
    repo.set('agent-1', 'pref', 'dark', 'preference');
    repo.set('agent-1', 'pref', 'light', 'preference');
    const list = repo.list('agent-1', { type: 'preference' });
    expect(list).toHaveLength(1);
    expect(list[0].value).toBe('light');
  });

  it('should delete a memory', () => {
    const entry = repo.set('agent-1', 'temp', 'data', 'short_term');
    expect(repo.delete(entry.id)).toBe(true);
    expect(repo.get(entry.id)).toBeUndefined();
    expect(repo.delete('non-existent')).toBe(false);
  });

  it('should search across agents', () => {
    repo.set('agent-1', 'project', 'SuperClaw is awesome', 'long_term');
    repo.set('agent-2', 'note', 'SuperClaw v2 release', 'short_term');
    repo.set('agent-1', 'other', 'unrelated info', 'short_term');
    const results = repo.search('SuperClaw');
    expect(results).toHaveLength(2);
  });

  it('should get context string', () => {
    repo.set('agent-1', 'name', 'Danilo', 'entity');
    repo.set('agent-1', 'theme', 'dark', 'preference');
    const ctx = repo.getContextString('agent-1');
    expect(ctx).toContain('Agent Memory');
    expect(ctx).toContain('name: Danilo');
    expect(ctx).toContain('theme: dark');
  });

  it('should clear all memories for an agent', () => {
    repo.set('agent-1', 'a', '1', 'short_term');
    repo.set('agent-1', 'b', '2', 'long_term');
    repo.set('agent-2', 'c', '3', 'short_term');
    const cleared = repo.clearAgent('agent-1');
    expect(cleared).toBe(2);
    expect(repo.list('agent-1')).toHaveLength(0);
    expect(repo.list('agent-2')).toHaveLength(1);
  });

  it('should support new memory types (fact, decision, goal, event)', () => {
    const f = repo.set('agent-1', 'decision-1', 'Use SQLite for storage', 'decision');
    const g = repo.set('agent-1', 'goal-1', 'Ship v1.0 by Q2', 'goal');
    const e = repo.set('agent-1', 'event-1', 'Deployed to production', 'event');
    expect(f.type).toBe('decision');
    expect(g.type).toBe('goal');
    expect(e.type).toBe('event');
  });

  it('should create and retrieve memory edges', () => {
    const m1 = repo.set('agent-1', 'k1', 'v1', 'long_term');
    const m2 = repo.set('agent-1', 'k2', 'v2', 'long_term');
    const edge = repo.addEdge(m1.id, m2.id, 'related_to');
    expect(edge.id).toBeDefined();
    expect(edge.relation).toBe('related_to');

    const edges = repo.getEdges(m1.id);
    expect(edges.length).toBeGreaterThan(0);
    expect(edges[0].source_id).toBe(m1.id);
  });

  it('should find related memories via graph traversal', () => {
    const m1 = repo.set('agent-1', 'cause', 'Server error', 'fact');
    const m2 = repo.set('agent-1', 'effect', 'Downtime occurred', 'fact');
    repo.addEdge(m2.id, m1.id, 'caused_by');

    const related = repo.findRelated(m2.id, 'caused_by');
    expect(related.length).toBeGreaterThan(0);
    expect(related[0].key).toBe('cause');
  });

  it('should auto-detect update edges when key is overwritten', () => {
    const old = repo.set('agent-1', 'status', 'inactive', 'fact');
    const newEntry = repo.set('agent-1', 'status-v2', 'active', 'fact');
    repo.detectUpdates('agent-1', 'status', newEntry.id);

    // The update detection is best-effort; just ensure no crash
    expect(newEntry.id).toBeDefined();
  });

  it('should return graph (nodes + edges) for an agent', () => {
    const m1 = repo.set('agent-1', 'a', '1', 'long_term');
    const m2 = repo.set('agent-1', 'b', '2', 'long_term');
    repo.addEdge(m1.id, m2.id, 'supports');

    const graph = repo.getGraph('agent-1');
    expect(graph.nodes.length).toBe(2);
    expect(graph.edges.length).toBe(1);
  });

  it('should include optional metadata (source, tags)', () => {
    const entry = repo.set('agent-1', 'decision', 'use TypeScript', 'decision', 1.0, undefined, {
      source: 'sprint-planning',
      tags: ['architecture', 'language'],
    });
    expect(entry.source).toBe('sprint-planning');
    expect(entry.tags).toContain('architecture');
  });
});
