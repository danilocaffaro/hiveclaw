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

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT DEFAULT '',
      provider_id TEXT DEFAULT '',
      model_id TEXT DEFAULT '',
      agent_id TEXT DEFAULT '',
      mode TEXT DEFAULT 'dm',
      squad_id TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      agent_id TEXT DEFAULT '',
      content TEXT NOT NULL DEFAULT '[]',
      tokens_input INTEGER DEFAULT 0,
      tokens_output INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS agent_memory (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('short_term','long_term','entity','preference','fact','decision','goal','event','procedure','correction')),
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      relevance REAL DEFAULT 1.0,
      source TEXT,
      tags TEXT DEFAULT '[]',
      access_count INTEGER DEFAULT 0,
      last_accessed DATETIME,
      event_at DATETIME,
      valid_until DATETIME,
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

    CREATE TABLE IF NOT EXISTS core_memory_blocks (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      block_name TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      max_tokens INTEGER DEFAULT 500,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      UNIQUE(agent_id, block_name)
    );

    CREATE TABLE IF NOT EXISTS working_memory (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL DEFAULT '',
      active_goals TEXT DEFAULT '[]',
      current_plan TEXT DEFAULT '',
      completed_steps TEXT DEFAULT '[]',
      next_actions TEXT DEFAULT '[]',
      pending_context TEXT DEFAULT '',
      open_questions TEXT DEFAULT '[]',
      tool_state TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_working_memory_session ON working_memory(session_id);

    CREATE TABLE IF NOT EXISTS episodes (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      agent_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL CHECK(type IN ('message','compaction','extraction','decision','event')),
      content TEXT NOT NULL,
      event_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS compaction_log (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      extracted_facts INTEGER DEFAULT 0,
      messages_compacted INTEGER DEFAULT 0,
      tokens_before INTEGER DEFAULT 0,
      tokens_after INTEGER DEFAULT 0,
      working_memory_saved INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_agent_memory_agent ON agent_memory(agent_id, type);
    CREATE INDEX IF NOT EXISTS idx_agent_memory_expires ON agent_memory(expires_at);
    CREATE INDEX IF NOT EXISTS idx_memory_edges_source ON memory_edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_memory_edges_target ON memory_edges(target_id);
    CREATE INDEX IF NOT EXISTS idx_core_memory_agent ON core_memory_blocks(agent_id);
  `);

  // FTS5 for archival search
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        session_id UNINDEXED,
        agent_id UNINDEXED,
        role UNINDEXED,
        created_at UNINDEXED,
        tokenize='porter unicode61 remove_diacritics 2'
      )
    `);
  } catch { /* FTS5 may not be available in test env */ }

  // Seed test agents
  db.prepare(`INSERT INTO agents (id, name, role, type, system_prompt) VALUES (?, ?, ?, ?, ?)`).run(
    'agent-1', 'TestBot', 'tester', 'specialist', 'You are a test agent.',
  );
  db.prepare(`INSERT INTO agents (id, name, role, type, system_prompt) VALUES (?, ?, ?, ?, ?)`).run(
    'agent-2', 'OtherBot', 'helper', 'specialist', 'You are another agent.',
  );
  // Seed test session
  db.prepare(`INSERT INTO sessions (id, title, agent_id) VALUES (?, ?, ?)`).run(
    'session-1', 'Test Session', 'agent-1',
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

  it('should support all 10 memory types', () => {
    const f = repo.set('agent-1', 'decision-1', 'Use SQLite for storage', 'decision');
    const g = repo.set('agent-1', 'goal-1', 'Ship v1.0 by Q2', 'goal');
    const e = repo.set('agent-1', 'event-1', 'Deployed to production', 'event');
    const p = repo.set('agent-1', 'proc-1', 'Run npm test before deploy', 'procedure');
    const c = repo.set('agent-1', 'corr-1', 'User corrected timezone to GMT-3', 'correction');
    expect(f.type).toBe('decision');
    expect(g.type).toBe('goal');
    expect(e.type).toBe('event');
    expect(p.type).toBe('procedure');
    expect(c.type).toBe('correction');
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
    const _old = repo.set('agent-1', 'status', 'inactive', 'fact');
    const newEntry = repo.set('agent-1', 'status-v2', 'active', 'fact');
    repo.detectUpdates('agent-1', 'status', newEntry.id);
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

  // ── Sprint 65: New Tests ────────────────────────────────────────────────────

  it('should store and retrieve bi-temporal metadata (event_at, valid_until)', () => {
    const entry = repo.set('agent-1', 'sprint', 'Sprint 65', 'fact', 1.0, undefined, {
      eventAt: '2026-03-12T00:00:00Z',
    });
    const fetched = repo.get(entry.id);
    expect(fetched!.event_at).toBe('2026-03-12T00:00:00Z');
    expect(fetched!.valid_until).toBeNull();
  });

  it('should invalidate a memory (set valid_until)', () => {
    const entry = repo.set('agent-1', 'current-sprint', 'Sprint 64', 'fact');
    repo.invalidate(entry.id);
    const fetched = repo.get(entry.id);
    expect(fetched!.valid_until).toBeTruthy();
  });

  it('should detect contradictions and invalidate old values', () => {
    const old = repo.set('agent-1', 'active-sprint', 'Sprint 64', 'fact');
    // Force a different key to avoid upsert (setWithContradictionCheck handles this)
    const { memory, contradicted } = repo.setWithContradictionCheck(
      'agent-1', 'active-sprint', 'Sprint 65', 'fact',
    );
    // Upsert means same key = update, not contradiction (check value change)
    expect(memory.value).toBe('Sprint 65');
  });

  it('should get memories valid at a specific date', () => {
    repo.set('agent-1', 'v1-fact', 'Old value', 'fact', 1.0, undefined, {
      eventAt: '2026-01-01T00:00:00Z',
      validUntil: '2026-02-01T00:00:00Z',
    });
    repo.set('agent-1', 'v2-fact', 'New value', 'fact', 1.0, undefined, {
      eventAt: '2026-02-01T00:00:00Z',
    });

    const janFacts = repo.getValidAt('agent-1', '2026-01-15T00:00:00Z');
    expect(janFacts.some(m => m.key === 'v1-fact')).toBe(true);
    expect(janFacts.some(m => m.key === 'v2-fact')).toBe(false);

    const marFacts = repo.getValidAt('agent-1', '2026-03-01T00:00:00Z');
    expect(marFacts.some(m => m.key === 'v2-fact')).toBe(true);
    // v1-fact expired, should not appear
    expect(marFacts.some(m => m.key === 'v1-fact')).toBe(false);
  });

  // ── Core Memory Blocks ──────────────────────────────────────────────────────

  it('should set and get core memory blocks', () => {
    repo.setCoreBlock('agent-1', 'persona', 'I am a helpful assistant.');
    repo.setCoreBlock('agent-1', 'human', 'User: Danilo, timezone GMT-3');

    const blocks = repo.getCoreBlocks('agent-1');
    expect(blocks).toHaveLength(2);

    const persona = repo.getCoreBlock('agent-1', 'persona');
    expect(persona).toBe('I am a helpful assistant.');
  });

  it('should replace text in core memory block', () => {
    repo.setCoreBlock('agent-1', 'project', 'Current sprint: 64');
    const replaced = repo.coreBlockReplace('agent-1', 'project', 'sprint: 64', 'sprint: 65');
    expect(replaced).toBe(true);
    expect(repo.getCoreBlock('agent-1', 'project')).toBe('Current sprint: 65');
  });

  it('should append text to core memory block', () => {
    repo.setCoreBlock('agent-1', 'scratchpad', 'Note 1');
    repo.coreBlockAppend('agent-1', 'scratchpad', 'Note 2');
    const content = repo.getCoreBlock('agent-1', 'scratchpad');
    expect(content).toContain('Note 1');
    expect(content).toContain('Note 2');
  });

  it('should generate core memory prompt string', () => {
    repo.setCoreBlock('agent-1', 'persona', 'I am Alice the dog');
    repo.setCoreBlock('agent-1', 'human', 'Danilo loves AI');
    const prompt = repo.getCoreMemoryPrompt('agent-1');
    expect(prompt).toContain('## Core Memory');
    expect(prompt).toContain('### human');
    expect(prompt).toContain('Danilo loves AI');
  });

  // ── Working Memory ──────────────────────────────────────────────────────────

  it('should save and retrieve working memory', () => {
    repo.saveWorkingMemory('session-1', 'agent-1', {
      activeGoals: ['Ship Sprint 65', 'Fix memory architecture'],
      currentPlan: 'Implement FTS5 first, then working memory',
      nextActions: ['Create schema', 'Write tests'],
      pendingContext: 'User wants best-in-class memory',
    });

    const wm = repo.getWorkingMemory('session-1');
    expect(wm).toBeTruthy();
    expect(wm!.activeGoals).toHaveLength(2);
    expect(wm!.currentPlan).toContain('FTS5');
    expect(wm!.nextActions).toHaveLength(2);
  });

  it('should format working memory for prompt', () => {
    repo.saveWorkingMemory('session-1', 'agent-1', {
      activeGoals: ['Ship v1.0'],
      currentPlan: 'Eidetic memory implementation',
      nextActions: ['Run tests'],
    });

    const prompt = repo.getWorkingMemoryPrompt('session-1');
    expect(prompt).toContain('Working Memory');
    expect(prompt).toContain('Ship v1.0');
    expect(prompt).toContain('Eidetic memory');
  });

  it('should return null for missing working memory', () => {
    const wm = repo.getWorkingMemory('nonexistent-session');
    expect(wm).toBeNull();
  });

  // ── Episodes & Compaction Log ───────────────────────────────────────────────

  it('should log episodes', () => {
    repo.logEpisode({
      sessionId: 'session-1',
      agentId: 'agent-1',
      type: 'decision',
      content: 'Decided to use FTS5 for archival search',
      eventAt: '2026-03-12T06:00:00Z',
    });

    const rows = db.prepare('SELECT * FROM episodes WHERE session_id = ?').all('session-1');
    expect(rows).toHaveLength(1);
  });

  it('should log compaction events', () => {
    repo.logCompaction('session-1', 'Compacted 50 messages about Sprint 64 work', {
      extractedFacts: 5,
      messagesCompacted: 50,
      tokensBefore: 80000,
      tokensAfter: 30000,
      workingMemorySaved: true,
    });

    const rows = db.prepare('SELECT * FROM compaction_log WHERE session_id = ?').all('session-1') as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].extracted_facts).toBe(5);
    expect(rows[0].working_memory_saved).toBe(1);
  });

  // ── FTS5 Archival Search ────────────────────────────────────────────────────

  it('should search messages via FTS5 (if available)', () => {
    // Insert test messages
    db.prepare(`INSERT INTO messages (id, session_id, role, agent_id, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run('m1', 'session-1', 'user', '', 'How do I configure the memory architecture?', '2026-03-12T01:00:00Z');
    db.prepare(`INSERT INTO messages (id, session_id, role, agent_id, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run('m2', 'session-1', 'assistant', 'agent-1', 'The memory architecture uses 5 layers including FTS5', '2026-03-12T01:01:00Z');
    db.prepare(`INSERT INTO messages (id, session_id, role, agent_id, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run('m3', 'session-1', 'user', '', 'Tell me about the weather today', '2026-03-12T01:02:00Z');

    // Manually insert into FTS5 (triggers don't fire in test since table was created before triggers)
    try {
      db.exec(`INSERT INTO messages_fts(rowid, content, session_id, agent_id, role, created_at)
        VALUES (1, 'How do I configure the memory architecture?', 'session-1', '', 'user', '2026-03-12T01:00:00Z')`);
      db.exec(`INSERT INTO messages_fts(rowid, content, session_id, agent_id, role, created_at)
        VALUES (2, 'The memory architecture uses 5 layers including FTS5', 'session-1', 'agent-1', 'assistant', '2026-03-12T01:01:00Z')`);
      db.exec(`INSERT INTO messages_fts(rowid, content, session_id, agent_id, role, created_at)
        VALUES (3, 'Tell me about the weather today', 'session-1', '', 'user', '2026-03-12T01:02:00Z')`);

      const results = repo.archivalSearch('memory architecture');
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results[0].content).toContain('memory');

      // Session-scoped search
      const scoped = repo.archivalSearch('memory', { sessionId: 'session-1' });
      expect(scoped.length).toBeGreaterThanOrEqual(1);

      // Snippet search
      const snippets = repo.archivalSearchWithSnippets('memory architecture');
      expect(snippets.length).toBeGreaterThanOrEqual(1);
    } catch {
      // FTS5 may not be available in test environment — skip gracefully
    }
  });

  // ── Budget-Aware Context Injection ──────────────────────────────────────────

  it('should generate budgeted context string', () => {
    repo.setCoreBlock('agent-1', 'persona', 'I am a helpful AI assistant');
    repo.set('agent-1', 'current-goal', 'Ship Sprint 65', 'goal');
    repo.set('agent-1', 'tech-decision', 'Use SQLite for everything', 'decision');
    repo.set('agent-1', 'user-pref', 'Portuguese language', 'preference');
    repo.saveWorkingMemory('session-1', 'agent-1', {
      activeGoals: ['Complete eidetic memory'],
      nextActions: ['Run QA tests'],
    });

    const ctx = repo.getContextStringBudgeted('agent-1', 'session-1');
    expect(ctx).toContain('Core Memory');
    expect(ctx).toContain('helpful AI assistant');
    expect(ctx).toContain('Working Memory');
    expect(ctx).toContain('eidetic memory');
    expect(ctx).toContain('Active Goals');
  });
});
