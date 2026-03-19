/**
 * Engine v2 — Provider Adapter Types
 *
 * AgentEvent is the unified event type all adapters emit.
 * ProviderAdapter is the interface each provider implements.
 *
 * The CALLER (agent-runner-v2) manages the tool execution loop:
 *   1. Call streamTurn()
 *   2. If finish.reason === 'tool_calls', execute tools, append results, call again
 *   3. If finish.reason === 'stop', done
 */

import type { LLMMessage, ToolDefinition, LLMContentBlock } from '../types.js';

// ─── AgentEvent ─────────────────────────────────────────────────────────────────

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | { type: 'tool_result_needed'; toolCalls: Array<{ id: string; name: string; arguments: string }> }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'finish'; reason: 'stop' | 'tool_calls' | 'max_tokens' | 'error' }
  | { type: 'error'; error: string };

// ─── ProviderAdapter ────────────────────────────────────────────────────────────

export interface ProviderAdapter {
  readonly id: string;
  readonly name: string;

  /**
   * Stream a single LLM turn. Returns text deltas and/or tool_call events.
   * When the model requests tool calls, emits tool_call events for each one,
   * then a tool_result_needed summary, and finishes with
   * { type: 'finish', reason: 'tool_calls' }.
   *
   * For a simple text response, emits text events and finishes with
   * { type: 'finish', reason: 'stop' }.
   */
  streamTurn(
    messages: LLMMessage[],
    options: AdapterOptions,
  ): AsyncGenerator<AgentEvent>;
}

// ─── AdapterOptions ─────────────────────────────────────────────────────────────

export interface AdapterOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  /** Abort signal propagated from the runner — cancels in-flight fetch requests */
  signal?: AbortSignal;
}

// ─── AdapterConfig ──────────────────────────────────────────────────────────────
// Configuration passed when creating an adapter instance (API key, base URL, etc.)

export interface AdapterConfig {
  apiKey?: string;
  baseUrl?: string;
  extraHeaders?: Record<string, string>;
}

// ─── Re-exports ─────────────────────────────────────────────────────────────────

export type { LLMMessage, ToolDefinition, LLMContentBlock } from '../types.js';
