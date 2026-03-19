/**
 * Engine v2 — Agent Runner V2 Tests
 *
 * Tests for the native tool loop agent runner using mock adapters.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { AgentEvent } from '../engine/providers/adapters/types.js';
import type { SSEEvent, AgentConfig } from '../engine/agent-runner.js';

// ─── Mock All Heavy Dependencies ─────────────────────────────────────────────

// Mock session manager
const mockAddMessage = vi.fn();
const mockGetMessages = vi.fn().mockReturnValue([]);
const mockGetSessionWithMessages = vi.fn().mockReturnValue({ session: { id: 'test-session' }, messages: [] });
const mockSmartCompact = vi.fn().mockResolvedValue(undefined);

vi.mock('../engine/session-manager.js', () => ({
  getSessionManager: () => ({
    addMessage: mockAddMessage,
    getMessages: mockGetMessages,
    getSessionWithMessages: mockGetSessionWithMessages,
    smartCompact: mockSmartCompact,
  }),
}));

// Mock DB
vi.mock('../db/index.js', () => ({
  getDb: () => ({
    prepare: () => ({ all: () => [], get: () => undefined }),
  }),
  initDatabase: () => ({
    prepare: () => ({ all: () => [], get: () => undefined }),
  }),
}));

// Mock agent memory
vi.mock('../db/agent-memory.js', () => ({
  AgentMemoryRepository: class {
    getContextStringBudgeted() { return ''; }
    set() {}
    logEpisode() {}
  },
}));

// Mock providers DB
vi.mock('../db/providers.js', () => ({
  ProviderRepository: class {
    list() { return []; }
    getUnmasked() { return undefined; }
  },
}));

// Mock logger
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock session consolidator
vi.mock('../engine/session-consolidator.js', () => ({
  touchSession: vi.fn(),
}));

// Mock token monitor
vi.mock('../engine/token-monitor.js', () => ({
  checkTokenStatus: () => ({ actionRequired: false }),
}));

// Mock session rotator
vi.mock('../engine/session-rotator.js', () => ({
  ensureSessionChainSchema: vi.fn(),
  handleThreshold: vi.fn().mockResolvedValue(null),
}));

// Mock config
vi.mock('../config/security.js', () => ({
  getWorkspaceRoot: () => '/tmp/test-workspace',
}));

vi.mock('../config/pricing.js', () => ({
  estimateTokenCost: () => 0.001,
}));

vi.mock('../config/defaults.js', () => ({
  TOOL_LIMITS: { MAX_TOOL_ITERATIONS: 500, SMART_COMPACT_TOKENS: 80000 },
  ENABLE_MESSAGE_BUS: false,
  DEFAULT_PORT: 4070,
  resolveProviderBaseUrl: (id: string) => `https://${id}.example.com`,
  resolveProviderType: (id: string) => id === 'anthropic' ? 'anthropic' : 'openai',
}));

// Mock message bus
vi.mock('../engine/message-bus.js', () => ({
  messageBus: { publish: vi.fn() },
}));

// Mock tool registry — a single test tool
vi.mock('../engine/tools/index.js', () => ({
  getToolRegistry: () => {
    const tool = {
      definition: {
        name: 'test_tool',
        description: 'A test tool',
        parameters: { type: 'object', properties: { input: { type: 'string' } } },
      },
      execute: vi.fn().mockResolvedValue({ success: true, result: 'tool result' }),
    };
    return new Map([['test_tool', tool]]);
  },
}));

// We need a mock adapter. Let's create one that we control.
let mockStreamTurnFn: Mock;

vi.mock('../engine/providers/adapters/index.js', () => {
  return {
    getAdapterForProvider: () => ({
      id: 'test-provider',
      name: 'Test Provider',
      streamTurn: (...args: unknown[]) => mockStreamTurnFn(...args),
    }),
    clearAdapterCache: vi.fn(),
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const baseAgentConfig: AgentConfig = {
  id: 'test-agent',
  name: 'Test Agent',
  systemPrompt: 'You are a test agent.',
  providerId: 'test-provider',
  modelId: 'test-model',
  temperature: 0.7,
  maxTokens: 4096,
  engineVersion: 2,
};

/** Create an async generator from an array of events */
async function* eventStream(events: AgentEvent[]): AsyncGenerator<AgentEvent> {
  for (const evt of events) {
    yield evt;
  }
}

/** Collect all SSE events from the runner */
async function collectEvents(gen: AsyncGenerator<SSEEvent>): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  for await (const evt of gen) {
    events.push(evt);
  }
  return events;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Agent Runner V2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMessages.mockReturnValue([]);
    mockGetSessionWithMessages.mockReturnValue({ session: { id: 'test-session' }, messages: [] });
  });

  it('should export runAgentV2', async () => {
    const mod = await import('../engine/agent-runner-v2.js');
    expect(mod.runAgentV2).toBeDefined();
    expect(typeof mod.runAgentV2).toBe('function');
  });

  it('should handle text-only response', async () => {
    mockStreamTurnFn = vi.fn().mockReturnValue(
      eventStream([
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world!' },
        { type: 'usage', inputTokens: 10, outputTokens: 5 },
        { type: 'finish', reason: 'stop' },
      ]),
    );

    const { runAgentV2 } = await import('../engine/agent-runner-v2.js');
    const events = await collectEvents(runAgentV2('test-session', 'Hi', baseAgentConfig));

    // Should have: message.start, 2x message.delta (or buffer-merged), message.finish
    const starts = events.filter(e => e.event === 'message.start');
    const deltas = events.filter(e => e.event === 'message.delta');
    const finishes = events.filter(e => e.event === 'message.finish');
    const errors = events.filter(e => e.event === 'error');

    expect(starts).toHaveLength(1);
    expect(deltas.length).toBeGreaterThanOrEqual(1);
    expect(finishes).toHaveLength(1);
    expect(errors).toHaveLength(0);

    // Verify assistant message was persisted
    const assistantCalls = mockAddMessage.mock.calls.filter(
      (c: unknown[]) => (c[1] as { role: string }).role === 'assistant',
    );
    expect(assistantCalls).toHaveLength(1);
    expect(assistantCalls[0][1].content).toContain('Hello world!');
  });

  it('should handle single tool call cycle', async () => {
    let callCount = 0;
    mockStreamTurnFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First call: model wants to use a tool
        return eventStream([
          { type: 'text', text: 'Let me check...' },
          { type: 'tool_call', id: 'tc1', name: 'test_tool', arguments: '{"input":"hello"}' },
          { type: 'tool_result_needed', toolCalls: [{ id: 'tc1', name: 'test_tool', arguments: '{"input":"hello"}' }] },
          { type: 'usage', inputTokens: 20, outputTokens: 10 },
          { type: 'finish', reason: 'tool_calls' },
        ]);
      }
      // Second call: model responds with text
      return eventStream([
        { type: 'text', text: 'The result is done.' },
        { type: 'usage', inputTokens: 30, outputTokens: 15 },
        { type: 'finish', reason: 'stop' },
      ]);
    });

    const { runAgentV2 } = await import('../engine/agent-runner-v2.js');
    const events = await collectEvents(runAgentV2('test-session', 'Do something', baseAgentConfig));

    const toolStarts = events.filter(e => e.event === 'tool.start');
    const toolFinishes = events.filter(e => e.event === 'tool.finish');

    expect(toolStarts).toHaveLength(1);
    expect(toolFinishes).toHaveLength(1);
    expect((toolStarts[0].data as { name: string }).name).toBe('test_tool');
    expect(mockStreamTurnFn).toHaveBeenCalledTimes(2);
  });

  it('should handle multiple tool calls in one turn', async () => {
    let callCount = 0;
    mockStreamTurnFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return eventStream([
          { type: 'tool_call', id: 'tc1', name: 'test_tool', arguments: '{"input":"a"}' },
          { type: 'tool_call', id: 'tc2', name: 'test_tool', arguments: '{"input":"b"}' },
          { type: 'tool_call', id: 'tc3', name: 'test_tool', arguments: '{"input":"c"}' },
          { type: 'tool_result_needed', toolCalls: [
            { id: 'tc1', name: 'test_tool', arguments: '{"input":"a"}' },
            { id: 'tc2', name: 'test_tool', arguments: '{"input":"b"}' },
            { id: 'tc3', name: 'test_tool', arguments: '{"input":"c"}' },
          ] },
          { type: 'usage', inputTokens: 20, outputTokens: 10 },
          { type: 'finish', reason: 'tool_calls' },
        ]);
      }
      return eventStream([
        { type: 'text', text: 'All three done.' },
        { type: 'usage', inputTokens: 30, outputTokens: 15 },
        { type: 'finish', reason: 'stop' },
      ]);
    });

    const { runAgentV2 } = await import('../engine/agent-runner-v2.js');
    const events = await collectEvents(runAgentV2('test-session', 'Do three things', baseAgentConfig));

    const toolStarts = events.filter(e => e.event === 'tool.start');
    const toolFinishes = events.filter(e => e.event === 'tool.finish');

    expect(toolStarts).toHaveLength(3);
    expect(toolFinishes).toHaveLength(3);
  });

  it('should detect loop and inject warning at 5 identical tool calls (inject severity)', async () => {
    let callCount = 0;
    mockStreamTurnFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 5) {
        // Same tool call every iteration
        return eventStream([
          { type: 'tool_call', id: `tc${callCount}`, name: 'test_tool', arguments: '{"input":"same"}' },
          { type: 'tool_result_needed', toolCalls: [{ id: `tc${callCount}`, name: 'test_tool', arguments: '{"input":"same"}' }] },
          { type: 'usage', inputTokens: 10, outputTokens: 5 },
          { type: 'finish', reason: 'tool_calls' },
        ]);
      }
      // After loop injection, respond normally
      return eventStream([
        { type: 'text', text: 'OK, stopping.' },
        { type: 'usage', inputTokens: 10, outputTokens: 5 },
        { type: 'finish', reason: 'stop' },
      ]);
    });

    const { runAgentV2 } = await import('../engine/agent-runner-v2.js');
    const events = await collectEvents(runAgentV2('test-session', 'Loop test', baseAgentConfig));

    // Should have loop detection messages in deltas
    const deltas = events.filter(e => e.event === 'message.delta');
    const loopDeltas = deltas.filter(e => {
      const text = (e.data as { text?: string }).text ?? '';
      return text.includes('Loop detected') || text.includes('Circuit breaker');
    });

    expect(loopDeltas.length).toBeGreaterThan(0);
  });

  it('should circuit-break after consecutive loop detections', async () => {
    let callCount = 0;
    mockStreamTurnFn = vi.fn().mockImplementation(() => {
      callCount++;
      // Always return the same tool call to trigger loops
      return eventStream([
        { type: 'tool_call', id: `tc${callCount}`, name: 'test_tool', arguments: '{"input":"stuck"}' },
        { type: 'tool_result_needed', toolCalls: [{ id: `tc${callCount}`, name: 'test_tool', arguments: '{"input":"stuck"}' }] },
        { type: 'usage', inputTokens: 10, outputTokens: 5 },
        { type: 'finish', reason: 'tool_calls' },
      ]);
    });

    const { runAgentV2 } = await import('../engine/agent-runner-v2.js');
    const events = await collectEvents(runAgentV2('test-session', 'Stuck test', baseAgentConfig));

    // Should eventually stop (not run 500 iterations)
    // The loop detector resets after inject, but on second inject it hard-stops
    expect(mockStreamTurnFn.mock.calls.length).toBeLessThan(20);

    const finishes = events.filter(e => e.event === 'message.finish');
    expect(finishes).toHaveLength(1);
  });

  it('should handle max iterations with consolidation', async () => {
    // Override to very low max iterations
    const limitConfig = { ...baseAgentConfig, maxToolIterations: 3 };
    let callCount = 0;
    mockStreamTurnFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 3) {
        // Return different tool calls each time to avoid loop detection
        return eventStream([
          { type: 'tool_call', id: `tc${callCount}`, name: 'test_tool', arguments: `{"input":"step${callCount}"}` },
          { type: 'tool_result_needed', toolCalls: [{ id: `tc${callCount}`, name: 'test_tool', arguments: `{"input":"step${callCount}"}` }] },
          { type: 'usage', inputTokens: 10, outputTokens: 5 },
          { type: 'finish', reason: 'tool_calls' },
        ]);
      }
      // Consolidation response
      return eventStream([
        { type: 'text', text: 'Here is the consolidated summary.' },
        { type: 'usage', inputTokens: 10, outputTokens: 5 },
        { type: 'finish', reason: 'stop' },
      ]);
    });

    const { runAgentV2 } = await import('../engine/agent-runner-v2.js');
    const events = await collectEvents(runAgentV2('test-session', 'Long task', limitConfig));

    // Verify consolidation text is in the output
    const deltas = events.filter(e => e.event === 'message.delta');
    const allText = deltas.map(e => (e.data as { text: string }).text).join('');
    expect(allText).toContain('consolidated summary');

    // Should persist the final message
    const assistantCalls = mockAddMessage.mock.calls.filter(
      (c: unknown[]) => (c[1] as { role: string }).role === 'assistant',
    );
    expect(assistantCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle adapter error and persist partial response', async () => {
    mockStreamTurnFn = vi.fn().mockReturnValue(
      eventStream([
        { type: 'text', text: 'Partial content...' },
        { type: 'error', error: 'Something went wrong' },
        { type: 'finish', reason: 'error' },
      ]),
    );

    const { runAgentV2 } = await import('../engine/agent-runner-v2.js');
    const events = await collectEvents(runAgentV2('test-session', 'Break', baseAgentConfig));

    const errors = events.filter(e => e.event === 'error');
    expect(errors).toHaveLength(1);

    // Partial response should be persisted
    const assistantCalls = mockAddMessage.mock.calls.filter(
      (c: unknown[]) => (c[1] as { role: string }).role === 'assistant',
    );
    expect(assistantCalls.length).toBeGreaterThanOrEqual(1);
    expect(assistantCalls[0][1].content).toContain('Partial content');
  });

  it('should handle max_tokens with auto-continue', async () => {
    let callCount = 0;
    mockStreamTurnFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return eventStream([
          { type: 'text', text: 'Start of response...' },
          { type: 'usage', inputTokens: 20, outputTokens: 4096 },
          { type: 'finish', reason: 'max_tokens' },
        ]);
      }
      return eventStream([
        { type: 'text', text: ' continued and finished.' },
        { type: 'usage', inputTokens: 30, outputTokens: 20 },
        { type: 'finish', reason: 'stop' },
      ]);
    });

    const { runAgentV2 } = await import('../engine/agent-runner-v2.js');
    const events = await collectEvents(runAgentV2('test-session', 'Long answer', baseAgentConfig));

    // Should have called streamTurn twice
    expect(mockStreamTurnFn).toHaveBeenCalledTimes(2);

    // Final text should include both parts
    const assistantCalls = mockAddMessage.mock.calls.filter(
      (c: unknown[]) => (c[1] as { role: string }).role === 'assistant',
    );
    expect(assistantCalls).toHaveLength(1);
    expect(assistantCalls[0][1].content).toContain('Start of response');
    expect(assistantCalls[0][1].content).toContain('continued and finished');
  });

  it('should emit SSE events in correct order', async () => {
    mockStreamTurnFn = vi.fn().mockReturnValue(
      eventStream([
        { type: 'text', text: 'Done.' },
        { type: 'usage', inputTokens: 5, outputTokens: 2 },
        { type: 'finish', reason: 'stop' },
      ]),
    );

    const { runAgentV2 } = await import('../engine/agent-runner-v2.js');
    const events = await collectEvents(runAgentV2('test-session', 'Order test', baseAgentConfig));

    const eventTypes = events.map(e => e.event);
    const startIdx = eventTypes.indexOf('message.start');
    const finishIdx = eventTypes.indexOf('message.finish');
    const deltaIdx = eventTypes.indexOf('message.delta');

    expect(startIdx).toBeLessThan(deltaIdx);
    expect(deltaIdx).toBeLessThan(finishIdx);
  });

  it('should return error for non-existent session', async () => {
    mockGetSessionWithMessages.mockImplementation(() => { throw new Error('not found'); });

    const { runAgentV2 } = await import('../engine/agent-runner-v2.js');
    const events = await collectEvents(runAgentV2('bad-session', 'Hi', baseAgentConfig));

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('error');
    expect((events[0].data as { code: string }).code).toBe('SESSION_NOT_FOUND');
  });

  it('should track tokens across iterations', async () => {
    let callCount = 0;
    mockStreamTurnFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return eventStream([
          { type: 'tool_call', id: 'tc1', name: 'test_tool', arguments: '{"input":"x"}' },
          { type: 'tool_result_needed', toolCalls: [{ id: 'tc1', name: 'test_tool', arguments: '{"input":"x"}' }] },
          { type: 'usage', inputTokens: 100, outputTokens: 50 },
          { type: 'finish', reason: 'tool_calls' },
        ]);
      }
      return eventStream([
        { type: 'text', text: 'Done' },
        { type: 'usage', inputTokens: 200, outputTokens: 100 },
        { type: 'finish', reason: 'stop' },
      ]);
    });

    const { runAgentV2 } = await import('../engine/agent-runner-v2.js');
    const events = await collectEvents(runAgentV2('test-session', 'Token test', baseAgentConfig));

    const finish = events.find(e => e.event === 'message.finish');
    expect(finish).toBeDefined();
    const data = finish!.data as { tokens_in: number; tokens_out: number };
    expect(data.tokens_in).toBe(300); // 100 + 200
    expect(data.tokens_out).toBe(150); // 50 + 100
  });
});
