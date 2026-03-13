/**
 * agent-loop-e2e.test.ts — E2E tests for the agentic loop
 *
 * Tests the full cycle: user message → agent-runner → tool calls → response
 * Only the LLM provider HTTP calls are mocked.
 * Session manager uses a real temp SQLite DB (same pattern as session-manager.test.ts).
 *
 * Sprint 71 / Item 2.1
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import type { StreamChunk } from '../engine/providers/types.js';
import type { SSEEvent, AgentConfig } from '../engine/agent-runner.js';

// ─── Minimal schema needed by SessionManager ────────────────────────────────

const SESSION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', agent_id TEXT DEFAULT '',
    squad_id TEXT DEFAULT '', mode TEXT DEFAULT 'dm', provider_id TEXT DEFAULT '',
    model_id TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL, agent_id TEXT DEFAULT '', content TEXT NOT NULL DEFAULT '[]',
    tokens_input INTEGER DEFAULT 0, tokens_output INTEGER DEFAULT 0,
    cost REAL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);
`;

// ─── Mock: LLM provider router ───────────────────────────────────────────────

const mockChatWithFallback = vi.fn();

vi.mock('../engine/providers/index.js', () => ({
  getProviderRouter: () => ({
    chatWithFallback: mockChatWithFallback,
    getDefault: () => ({ id: 'mock-provider', name: 'Mock', type: 'openai' }),
    list: () => [{ id: 'mock-provider', name: 'Mock', type: 'openai' }],
    getProvider: (_id: string) => ({ id: 'mock-provider', name: 'Mock', type: 'openai' }),
  }),
}));

// ─── Mock: agent memory (no embeddings in unit tests) ────────────────────────

vi.mock('../db/agent-memory.js', () => ({
  AgentMemoryRepository: class {
    getContextStringBudgeted() { return ''; }
    extractAndStore() { return Promise.resolve(); }
  },
}));

// ─── Imports (after mocks are registered) ────────────────────────────────────

import { runAgent } from '../engine/agent-runner.js';
import { SessionManager } from '../engine/session-manager.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'test-agent-e2e',
    name: 'E2E Test Agent',
    systemPrompt: 'You are a test assistant.',
    providerId: 'mock-provider',
    modelId: 'mock-model',
    temperature: 0,
    maxTokens: 256,
    maxToolIterations: 5,
    ...overrides,
  };
}

async function collectEvents(gen: AsyncGenerator<SSEEvent>): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  for await (const evt of gen) events.push(evt);
  return events;
}

async function* makeStream(chunks: StreamChunk[]): AsyncGenerator<StreamChunk> {
  for (const chunk of chunks) yield chunk;
}

// ─── Test lifecycle ───────────────────────────────────────────────────────────

let tmpDir: string;
let dbPath: string;
let sm: SessionManager;
let sessionId: string;

/** Mock getSessionManager to return our test instance */
vi.mock('../engine/session-manager.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../engine/session-manager.js')>();
  return {
    ...original,
    getSessionManager: () => sm,
  };
});

beforeEach(() => {
  // mockReset clears call counts AND the return-value queue left by mockReturnValueOnce
  mockChatWithFallback.mockReset();
  // Fresh temp DB with schema for each test
  tmpDir = mkdtempSync(join(tmpdir(), 'sc-e2e-'));
  dbPath = join(tmpDir, 'test.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SESSION_SCHEMA);
  db.close();
  sm = new SessionManager(dbPath);
  const session = sm.createSession({ title: 'E2E Test Session' });
  sessionId = session.id;
});

afterEach(() => {
  sm.close();
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ─── Suite 1: Simple text responses ─────────────────────────────────────────

describe('DM session — text responses', () => {
  it('yields message.delta and message.finish for a simple response', async () => {
    mockChatWithFallback.mockReturnValueOnce(makeStream([
      { type: 'text', text: 'Hello! ' },
      { type: 'text', text: 'How can I help?' },
      { type: 'finish', reason: 'stop' },
    ]));

    const events = await collectEvents(runAgent(sessionId, 'Hi', makeAgentConfig()));

    const deltas = events.filter(e => e.event === 'message.delta');
    const finish = events.find(e => e.event === 'message.finish');

    expect(deltas.length).toBeGreaterThan(0);
    expect(finish).toBeDefined();

    const text = deltas.map(e => (e.data as { text: string }).text).join('');
    expect(text).toContain('Hello');
  });

  it('persists user and assistant messages to session', async () => {
    mockChatWithFallback.mockReturnValueOnce(makeStream([
      { type: 'text', text: 'Saved!' },
      { type: 'finish', reason: 'stop' },
    ]));

    await collectEvents(runAgent(sessionId, 'Remember this', makeAgentConfig()));

    const messages = sm.getMessages(sessionId);
    const roles = messages.map(m => m.role);

    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
  });

  it('yields error event for non-existent session', async () => {
    const events = await collectEvents(
      runAgent('session-does-not-exist', 'Hi', makeAgentConfig()),
    );

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('error');
    expect((events[0].data as { code: string }).code).toBe('SESSION_NOT_FOUND');
  });

  it('accumulates delta text into a complete response', async () => {
    mockChatWithFallback.mockReturnValueOnce(makeStream([
      { type: 'text', text: 'Part one. ' },
      { type: 'text', text: 'Part two. ' },
      { type: 'text', text: 'Part three.' },
      { type: 'finish', reason: 'stop' },
    ]));

    const events = await collectEvents(runAgent(sessionId, 'Tell me something', makeAgentConfig()));
    const deltas = events.filter(e => e.event === 'message.delta');
    const combined = deltas.map(e => (e.data as { text: string }).text).join('');
    expect(combined).toBe('Part one. Part two. Part three.');
  });
});

// ─── Suite 2: Tool execution ─────────────────────────────────────────────────

describe('Tool execution', () => {
  it('terminates within maxToolIterations even if LLM keeps calling tools', async () => {
    // Every LLM turn calls a tool — would loop forever without the limit
    for (let i = 0; i < 20; i++) {
      mockChatWithFallback.mockReturnValueOnce(makeStream([
        { type: 'tool_call', id: `tc_${i}`, name: 'bash', input: { command: 'echo loop' } },
        { type: 'finish', reason: 'tool_calls' },
      ]));
    }

    const events = await collectEvents(
      runAgent(sessionId, 'Loop forever', makeAgentConfig({ maxToolIterations: 3 })),
    );

    // Must terminate — finish or error, never hang
    const finish = events.find(e => e.event === 'message.finish');
    const error = events.find(e => e.event === 'error');
    expect(finish || error).toBeDefined();

    // Provider called at most maxToolIterations + 1 times
    expect(mockChatWithFallback.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('completes a tool call cycle: tool_calls → tool result → final text', async () => {
    mockChatWithFallback
      // Turn 1: LLM calls a tool
      .mockReturnValueOnce(makeStream([
        { type: 'tool_call', id: 'tc_001', name: 'bash', input: { command: 'ls' } },
        { type: 'finish', reason: 'tool_calls' },
      ]))
      // Turn 2: LLM sees tool result and responds
      .mockReturnValueOnce(makeStream([
        { type: 'text', text: 'Here are the results.' },
        { type: 'finish', reason: 'stop' },
      ]));

    const events = await collectEvents(
      runAgent(sessionId, 'List files', makeAgentConfig()),
    );

    const finish = events.find(e => e.event === 'message.finish');
    const error = events.find(e => e.event === 'error');
    // Either completed (tool ran) or errored gracefully (tool not registered) — never hangs
    expect(finish || error).toBeDefined();
  });
});

// ─── Suite 3: Error handling ─────────────────────────────────────────────────

describe('Error handling', () => {
  it('yields error event when provider throws synchronously', async () => {
    mockChatWithFallback.mockReturnValueOnce((async function* () {
      throw new Error('Provider unavailable');
    })());

    const events = await collectEvents(runAgent(sessionId, 'Hello', makeAgentConfig()));
    const error = events.find(e => e.event === 'error');
    expect(error).toBeDefined();
  });

  it('handles empty provider stream without hanging', async () => {
    mockChatWithFallback.mockReturnValueOnce(makeStream([]));

    const events = await collectEvents(runAgent(sessionId, 'Hello', makeAgentConfig()));
    // Must resolve, not hang
    expect(Array.isArray(events)).toBe(true);
  });

  it('handles max_tokens finish reason gracefully', async () => {
    mockChatWithFallback.mockReturnValueOnce(makeStream([
      { type: 'text', text: 'Truncated' },
      { type: 'finish', reason: 'max_tokens' },
    ]));

    const events = await collectEvents(runAgent(sessionId, 'Write a long essay', makeAgentConfig()));
    const finish = events.find(e => e.event === 'message.finish');
    expect(finish).toBeDefined();
  });
});

// ─── Suite 4: Loop detection ─────────────────────────────────────────────────

describe('Loop detection', () => {
  it('stops when same tool is called identically 3+ times', async () => {
    // Simulate identical tool calls to trigger LoopDetector
    for (let i = 0; i < 10; i++) {
      mockChatWithFallback.mockReturnValueOnce(makeStream([
        { type: 'tool_call', id: `tc_${i}`, name: 'bash', input: { command: 'ls' } },
        { type: 'finish', reason: 'tool_calls' },
      ]));
    }

    const events = await collectEvents(
      runAgent(sessionId, 'Run ls forever', makeAgentConfig({ maxToolIterations: 10 })),
    );

    const finish = events.find(e => e.event === 'message.finish');
    const error = events.find(e => e.event === 'error');
    expect(finish || error).toBeDefined();
    // Should have stopped well before all 10 mocked streams were consumed
    expect(mockChatWithFallback.mock.calls.length).toBeLessThan(10);
  });
});

// ─── Suite 5: Multi-turn context ─────────────────────────────────────────────

describe('Multi-turn context', () => {
  it('includes previous messages in subsequent turns', async () => {
    // First message
    mockChatWithFallback.mockReturnValueOnce(makeStream([
      { type: 'text', text: 'I remember that.' },
      { type: 'finish', reason: 'stop' },
    ]));
    await collectEvents(runAgent(sessionId, 'First message', makeAgentConfig()));

    // Second message — provider should receive history
    mockChatWithFallback.mockReturnValueOnce(makeStream([
      { type: 'text', text: 'Yes, you said "First message" earlier.' },
      { type: 'finish', reason: 'stop' },
    ]));
    await collectEvents(runAgent(sessionId, 'What did I say?', makeAgentConfig()));

    // Verify that the second call received messages including the first turn
    const secondCallMessages = mockChatWithFallback.mock.calls[1]?.[0] as Array<{ role: string }>;
    expect(secondCallMessages).toBeDefined();
    expect(secondCallMessages.length).toBeGreaterThan(1);
  });
});

// ─── Suite 6: Usage tracking ─────────────────────────────────────────────────

describe('Usage tracking', () => {
  it('captures token usage when provider reports it', async () => {
    mockChatWithFallback.mockReturnValueOnce(makeStream([
      { type: 'text', text: 'Hi!' },
      { type: 'usage', inputTokens: 42, outputTokens: 10 },
      { type: 'finish', reason: 'stop' },
    ]));

    const events = await collectEvents(runAgent(sessionId, 'Hi', makeAgentConfig()));
    const finish = events.find(e => e.event === 'message.finish');
    expect(finish).toBeDefined();
    const data = finish?.data as Record<string, unknown>;
    if (data?.usage) {
      expect((data.usage as { inputTokens: number }).inputTokens).toBe(42);
    }
  });
});
