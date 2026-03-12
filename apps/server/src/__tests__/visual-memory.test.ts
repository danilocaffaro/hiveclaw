import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { VisualMemoryTool } from '../engine/tools/visual-memory.js';
import { AgentMemoryRepository } from '../db/agent-memory.js';

describe('VisualMemoryTool', () => {
  let db: Database.Database;
  let tool: VisualMemoryTool;

  beforeEach(() => {
    db = new Database(':memory:');

    // Create required tables (match production schema)
    db.exec(`CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY, name TEXT, emoji TEXT, role TEXT DEFAULT 'assistant',
      type TEXT DEFAULT 'specialist', system_prompt TEXT DEFAULT '',
      color TEXT, skills TEXT DEFAULT '[]', model_preference TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS agent_memory (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'short_term',
      key TEXT NOT NULL, value TEXT NOT NULL, relevance REAL DEFAULT 1.0,
      expires_at DATETIME, source TEXT, tags TEXT DEFAULT '[]',
      embedding_id TEXT, metadata TEXT, event_at DATETIME, valid_until DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS episodes (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL DEFAULT '',
      agent_id TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT 'event',
      content TEXT NOT NULL DEFAULT '', metadata TEXT,
      event_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    tool = new VisualMemoryTool();
  });

  it('has correct definition', () => {
    expect(tool.definition.name).toBe('visual_memory');
    expect(tool.definition.parameters.properties).toHaveProperty('action');
    expect(tool.definition.parameters.properties).toHaveProperty('description');
    expect(tool.definition.parameters.properties).toHaveProperty('image_path');
  });

  it('stores a visual memory', async () => {
    const result = await tool.execute(
      {
        action: 'store',
        description: 'A dashboard showing 5 connected gateways with green status indicators',
        image_path: '/tmp/screenshots/dashboard.png',
        source: 'screenshot',
        tags: ['dashboard', 'gateways'],
      },
      { agentId: 'agent-1', sessionId: 'sess-1', db },
    );

    expect(result.success).toBe(true);
    const data = result.result as { memory_id: string; message: string };
    expect(data.memory_id).toBeTruthy();
    expect(data.message).toContain('Visual memory stored');

    // Verify in DB
    const repo = new AgentMemoryRepository(db);
    const memories = repo.list('agent-1');
    expect(memories.length).toBe(1);
    expect(memories[0].value).toContain('[Visual: screenshot]');
    expect(memories[0].value).toContain('dashboard');
  });

  it('recalls visual memories by query', async () => {
    // Store first
    await tool.execute(
      {
        action: 'store',
        description: 'Server CPU usage graph showing 45% average',
        image_path: '/tmp/cpu.png',
        source: 'screenshot',
      },
      { agentId: 'agent-1', sessionId: 'sess-1', db },
    );

    await tool.execute(
      {
        action: 'store',
        description: 'Family photo at the beach, sunny day',
        image_path: '/tmp/beach.jpg',
        source: 'upload',
      },
      { agentId: 'agent-1', sessionId: 'sess-1', db },
    );

    // Recall
    const result = await tool.execute(
      { action: 'recall', query: 'CPU server' },
      { agentId: 'agent-1', sessionId: 'sess-1', db },
    );

    expect(result.success).toBe(true);
  });

  it('lists all visual memories', async () => {
    await tool.execute(
      { action: 'store', description: 'Screenshot of login page', image_path: '/tmp/login.png', source: 'screenshot' },
      { agentId: 'agent-1', sessionId: 'sess-1', db },
    );
    await tool.execute(
      { action: 'store', description: 'Camera snap of whiteboard', image_path: '/tmp/whiteboard.jpg', source: 'camera' },
      { agentId: 'agent-1', sessionId: 'sess-1', db },
    );

    const result = await tool.execute(
      { action: 'list' },
      { agentId: 'agent-1', sessionId: 'sess-1', db },
    );

    expect(result.success).toBe(true);
    const items = result.result as Array<{ id: string; description: string }>;
    expect(items.length).toBe(2);
  });

  it('returns empty result for list with no memories', async () => {
    const result = await tool.execute(
      { action: 'list' },
      { agentId: 'agent-1', sessionId: 'sess-1', db },
    );
    expect(result.success).toBe(true);
    expect(result.result).toBe('No visual memories stored.');
  });

  it('errors on store without description', async () => {
    const result = await tool.execute(
      { action: 'store', image_path: '/tmp/img.png' },
      { agentId: 'agent-1', sessionId: 'sess-1', db },
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('description');
  });

  it('errors on store without image_path', async () => {
    const result = await tool.execute(
      { action: 'store', description: 'Something' },
      { agentId: 'agent-1', sessionId: 'sess-1', db },
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('image_path');
  });

  it('errors on unknown action', async () => {
    const result = await tool.execute(
      { action: 'delete' },
      { agentId: 'agent-1', sessionId: 'sess-1', db },
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown action');
  });

  it('logs episode with image path reference on store', async () => {
    await tool.execute(
      { action: 'store', description: 'Test image', image_path: '/tmp/test.png', source: 'browser' },
      { agentId: 'agent-1', sessionId: 'sess-1', db },
    );

    const episodes = db.prepare('SELECT * FROM episodes WHERE agent_id = ?').all('agent-1') as Array<{
      content: string; metadata: string;
    }>;
    expect(episodes.length).toBe(1);
    expect(episodes[0].content).toContain('Visual memory stored');
    const meta = JSON.parse(episodes[0].metadata);
    expect(meta.image_path).toBe('/tmp/test.png');
    expect(meta.source).toBe('browser');
  });
});
