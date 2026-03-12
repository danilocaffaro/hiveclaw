import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

// Create test DB
function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY, name TEXT, emoji TEXT, system_prompt TEXT,
    provider_preference TEXT, model_preference TEXT, temperature REAL,
    type TEXT DEFAULT 'assistant', status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY, name TEXT, type TEXT, api_key TEXT,
    base_url TEXT, status TEXT DEFAULT 'connected', models TEXT DEFAULT '[]',
    enabled INTEGER DEFAULT 1, config_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, title TEXT DEFAULT '', agent_id TEXT DEFAULT '',
    squad_id TEXT DEFAULT '', mode TEXT DEFAULT 'dm',
    provider_id TEXT DEFAULT '', model_id TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL DEFAULT '',
    agent_id TEXT NOT NULL DEFAULT '', role TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '', tool_calls TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.prepare(`INSERT INTO providers (id, name, type, api_key, config_json) VALUES (?, ?, ?, ?, ?)`).run(
    'test-provider', 'Test', 'openai', 'sk-test', JSON.stringify({ models: [{ id: 'gpt-4o-mini', name: 'GPT-4o Mini' }] })
  );
  db.prepare(`INSERT INTO agents (id, name, emoji, system_prompt) VALUES (?, ?, ?, ?)`).run(
    'agent-1', 'TestBot', '🤖', 'You are a test bot.'
  );
  return db;
}

const testDb = createTestDb();

vi.mock('../db/index.js', () => ({
  initDatabase: () => testDb,
  getDb: () => testDb,
}));

// Mock runAgent
vi.mock('../engine/agent-runner.js', () => ({
  runAgent: async function* (_sid: string, _msg: string, _cfg: unknown) {
    yield { event: 'message.start', data: {} };
    yield { event: 'message.delta', data: { text: 'Hello from ' } };
    yield { event: 'message.delta', data: { text: 'the agent!' } };
    yield { event: 'message.finish', data: {} };
  },
  serializeSSE: (e: unknown) => JSON.stringify(e),
}));

// Mock session-manager
const mockSessions: Array<{ id: string; title: string }> = [];
vi.mock('../engine/session-manager.js', () => ({
  getSessionManager: () => ({
    listSessions: () => mockSessions,
    createSession: (opts: { title?: string; agent_id?: string; mode?: string }) => {
      const s = {
        id: `sess-${Date.now()}`,
        title: opts.title ?? '',
        agent_id: opts.agent_id ?? '',
        mode: opts.mode ?? 'dm',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      mockSessions.push(s);
      return s;
    },
    getSessionWithMessages: () => ({
      session: { id: 'test', title: '', agent_id: '', mode: 'dm', created_at: '', updated_at: '' },
      messages: [],
    }),
  }),
}));

import { handleChannelInbound } from '../engine/channel-responder.js';

describe('channel-responder', () => {
  beforeEach(() => {
    mockSessions.length = 0;
  });

  it('creates session and collects agent response', async () => {
    const result = await handleChannelInbound({
      channelId: 'ch-1',
      agentId: 'agent-1',
      fromId: 'user-123',
      text: 'Hello!',
    });
    expect(result).toBe('Hello from the agent!');
    expect(mockSessions.length).toBe(1);
    expect(mockSessions[0].title).toBe('channel:ch-1:user-123');
  });

  it('reuses existing session on second message', async () => {
    mockSessions.push({ id: 'existing-sess', title: 'channel:ch-1:user-123' });

    const result = await handleChannelInbound({
      channelId: 'ch-1',
      agentId: 'agent-1',
      fromId: 'user-123',
      text: 'Second message',
    });
    expect(result).toBe('Hello from the agent!');
    // Should NOT create a new session
    expect(mockSessions.length).toBe(1);
    expect(mockSessions[0].id).toBe('existing-sess');
  });

  it('handles unknown agentId gracefully (fallback config)', async () => {
    const result = await handleChannelInbound({
      channelId: 'ch-4',
      agentId: 'nonexistent-agent',
      fromId: 'user-000',
      text: 'Hi',
    });
    // Should still work with default config
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns error message on agent error event', async () => {
    const agentRunner = await import('../engine/agent-runner.js');
    vi.spyOn(agentRunner, 'runAgent').mockImplementationOnce(async function* () {
      yield { event: 'error' as const, data: { message: 'Model rate limited' } };
    });

    const result = await handleChannelInbound({
      channelId: 'ch-3',
      agentId: 'agent-1',
      fromId: 'user-789',
      text: 'Test',
    });
    expect(result).toContain('Model rate limited');
  });

  it('returns fallback on empty response', async () => {
    const agentRunner = await import('../engine/agent-runner.js');
    vi.spyOn(agentRunner, 'runAgent').mockImplementationOnce(async function* () {
      yield { event: 'message.start' as const, data: {} };
      yield { event: 'message.finish' as const, data: {} };
    });

    const result = await handleChannelInbound({
      channelId: 'ch-2',
      agentId: 'agent-1',
      fromId: 'user-456',
      text: 'Hello?',
    });
    expect(result).toBe('🤖 (no response)');
  });
});
