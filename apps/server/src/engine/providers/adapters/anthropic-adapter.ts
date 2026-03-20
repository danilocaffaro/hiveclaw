/**
 * Engine v2 — Anthropic Messages API Adapter
 *
 * Handles Anthropic-specific streaming:
 * - content_block_start/delta/stop for text and tool_use
 * - input_json_delta for streamed tool arguments
 * - Tool results as user-role messages with tool_result content blocks
 * - Both x-api-key and Bearer token (OAuth sk-ant-oat-*) auth
 * - Retry with exponential backoff (R20.2a pattern)
 */

import type { ProviderAdapter, AdapterConfig, AdapterOptions, AgentEvent, LLMMessage } from './types.js';
import { logger } from '../../../lib/logger.js';

// ─── Retry Constants (R20.2a) ───────────────────────────────────────────────────

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 529]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 15000;

function isRetryableError(err: unknown): boolean {
  // Never retry 400/401/403/404 — these are permanent client errors
  if (err && typeof err === 'object' && 'statusCode' in err) {
    const status = (err as { statusCode: number }).statusCode;
    if (status >= 400 && status < 500 && status !== 429) return false;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|UND_ERR_SOCKET|fetch failed|network/i.test(msg)) return true;
  for (const code of RETRYABLE_STATUS_CODES) {
    if (msg.includes(String(code))) return true;
  }
  return false;
}

function retryDelay(attempt: number): number {
  const exponential = BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = 0.5 + Math.random() * 0.5;
  return Math.min(exponential * jitter, MAX_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Anthropic Adapter ──────────────────────────────────────────────────────────

export class AnthropicAdapter implements ProviderAdapter {
  readonly id: string;
  readonly name: string;

  private apiKey: string | undefined;
  private baseUrl: string;

  constructor(id: string, name: string, config: AdapterConfig) {
    this.id = id;
    this.name = name;
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
  }

  async *streamTurn(
    messages: LLMMessage[],
    options: AdapterOptions,
  ): AsyncGenerator<AgentEvent> {
    let lastErr: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = retryDelay(attempt - 1);
        logger.warn(`[AnthropicAdapter] Retry ${attempt}/${MAX_RETRIES} for ${this.id} in ${Math.round(delay)}ms`);
        await sleep(delay);
      }

      try {
        yield* this.doStreamTurn(messages, options);
        return; // success
      } catch (err) {
        lastErr = err as Error;
        if (attempt < MAX_RETRIES && isRetryableError(err)) {
          continue;
        }
        break;
      }
    }

    yield { type: 'error', error: `Anthropic adapter error: ${lastErr?.message}` };
    yield { type: 'finish', reason: 'error' };
  }

  /**
   * Single streaming attempt.
   */
  private async *doStreamTurn(
    messages: LLMMessage[],
    options: AdapterOptions,
  ): AsyncGenerator<AgentEvent> {
    const url = `${this.baseUrl}/v1/messages`;

    // Extract system message from the messages array or from options
    const systemMsg = messages.find(m => m.role === 'system');
    const chatMsgs = messages.filter(m => m.role !== 'system');

    // Determine system prompt: options.systemPrompt takes precedence, then message
    const systemPrompt = options.systemPrompt
      ?? (systemMsg ? (typeof systemMsg.content === 'string' ? systemMsg.content : JSON.stringify(systemMsg.content)) : undefined);

    // Convert messages to Anthropic format
    const anthropicMsgs = this.buildAnthropicMessages(chatMsgs);

    // Build request body
    // Normalize model ID: users may store "claude-opus-4.6" (dot) but Anthropic API
    // expects "claude-opus-4-6" (hyphen). Also handle common aliases.
    const normalizedModel = this.normalizeModelId(options.model);
    const body: Record<string, unknown> = {
      model: normalizedModel,
      max_tokens: options.maxTokens ?? 4096,
      stream: true,
      messages: anthropicMsgs,
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }

    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    // Auth: OAuth tokens (sk-ant-oat-*) use Bearer, regular keys use x-api-key
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (this.apiKey?.includes('sk-ant-oat')) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
      headers['anthropic-beta'] = 'oauth-2025-04-20';
    } else {
      headers['x-api-key'] = this.apiKey ?? '';
    }

    // Debug: log request details for diagnosing 400 errors
    logger.info('[AnthropicAdapter] Request: model=%s max_tokens=%d messages=%d tools=%d system=%s',
      normalizedModel, body.max_tokens as number, anthropicMsgs.length, Array.isArray(body.tools) ? (body.tools as unknown[]).length : 0,
      systemPrompt ? `${systemPrompt.length} chars` : 'none');
    if (anthropicMsgs.length > 0) {
      const roles = anthropicMsgs.map(m => m.role).join(',');
      logger.info('[AnthropicAdapter] Message roles: [%s]', roles);
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: options.signal,
      });
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') {
        yield { type: 'error', error: 'Request aborted' };
        yield { type: 'finish', reason: 'error' };
        return;
      }
      throw new Error(`Connection failed: ${(err as Error).message}`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown');
      const err = new Error(`Anthropic error ${res.status}: ${text.slice(0, 500)}`);
      // Tag the error with the status code for retry logic
      (err as Error & { statusCode?: number }).statusCode = res.status;
      throw err;
    }
    if (!res.body) {
      throw new Error('No response body');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let tokensIn = 0, tokensOut = 0;

    // Anthropic streams tool_use as content blocks
    let currentToolId = '';
    let currentToolName = '';
    let currentToolArgs = '';
    let inToolUse = false;
    const collectedToolCalls: Array<{ id: string; name: string; arguments: string }> = [];
    let finishReason: 'stop' | 'tool_calls' | 'max_tokens' | 'max_tokens_tool_call' | 'error' = 'stop';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();

          try {
            const data = JSON.parse(payload);

            // Text deltas
            if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
              yield { type: 'text', text: data.delta.text };
            }

            // Tool use block start
            if (data.type === 'content_block_start' && data.content_block?.type === 'tool_use') {
              inToolUse = true;
              currentToolId = data.content_block.id ?? '';
              currentToolName = data.content_block.name ?? '';
              currentToolArgs = '';
            }

            // Tool use input delta (streamed JSON)
            if (data.type === 'content_block_delta' && data.delta?.type === 'input_json_delta') {
              currentToolArgs += data.delta.partial_json ?? '';
            }

            // Tool use block end → emit tool_call
            if (data.type === 'content_block_stop' && inToolUse) {
              const tc = { id: currentToolId, name: currentToolName, arguments: currentToolArgs };
              yield { type: 'tool_call', ...tc };
              collectedToolCalls.push(tc);
              inToolUse = false;
              currentToolId = '';
              currentToolName = '';
              currentToolArgs = '';
            }

            // Usage tracking
            if (data.type === 'message_start' && data.message?.usage) {
              tokensIn = data.message.usage.input_tokens ?? tokensIn;
            }
            if (data.type === 'message_delta' && data.usage) {
              tokensOut = data.usage.output_tokens ?? tokensOut;
            }

            // Anthropic stop reason — complete mapping per
            // https://docs.anthropic.com/en/api/messages#response-stop-reason
            // and Vercel AI SDK map-anthropic-stop-reason.ts
            if (data.type === 'message_delta' && data.delta?.stop_reason) {
              const stopReason = data.delta.stop_reason;
              if (stopReason === 'tool_use') {
                finishReason = 'tool_calls';
              } else if (stopReason === 'max_tokens' || stopReason === 'model_context_window_exceeded') {
                finishReason = 'max_tokens';
              } else if (stopReason === 'end_turn' || stopReason === 'pause_turn' || stopReason === 'stop_sequence') {
                finishReason = 'stop';
              } else if (stopReason === 'refusal') {
                logger.warn('[Anthropic] Model refused to respond (stop_reason=refusal)');
                finishReason = 'error';
              } else if (stopReason === 'compaction') {
                // Anthropic internal context compaction — treat as stop, model may continue
                logger.info('[Anthropic] Server-side compaction triggered (stop_reason=compaction)');
                finishReason = 'stop';
              } else {
                logger.warn('[Anthropic] Unknown stop_reason: %s — defaulting to stop', stopReason);
                finishReason = 'stop';
              }
            }
          } catch {
            /* skip malformed chunks */
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Emit tool_result_needed if we collected tool calls
    if (collectedToolCalls.length > 0) {
      yield { type: 'tool_result_needed', toolCalls: collectedToolCalls };
      finishReason = 'tool_calls';
    }

    // R22-P1: Detect incomplete tool call (max_tokens mid-JSON)
    // If the stream ended while building a tool call, the content_block_stop
    // was never emitted. Signal max_tokens_tool_call so the runner can inject
    // a recovery prompt instead of treating it as normal text truncation.
    if (inToolUse && currentToolName) {
      logger.warn('[Anthropic] Tool call "%s" truncated by max_tokens (%d chars of args)', currentToolName, currentToolArgs.length);
      finishReason = 'max_tokens_tool_call';
      inToolUse = false;
    }

    yield { type: 'usage', inputTokens: tokensIn, outputTokens: tokensOut };
    yield { type: 'finish', reason: finishReason };
  }

  /**
   * Normalize model ID to Anthropic API format.
   * Users may store "claude-opus-4.6" (dot notation) but Anthropic expects "claude-opus-4-6" (hyphens).
   * Also strips invalid snapshot dates — only known valid dates are kept.
   * Maps common aliases to valid API model IDs.
   */
  private normalizeModelId(model: string): string {
    // 1. Direct alias mapping (dot notation, common names)
    const ALIASES: Record<string, string> = {
      'claude-opus-4.6': 'claude-opus-4-6',
      'claude-sonnet-4.6': 'claude-sonnet-4-6',
      'claude-sonnet-4.5': 'claude-sonnet-4-5-20250929',
      'claude-haiku-4.5': 'claude-haiku-4-5',
      'claude-opus-4.5': 'claude-opus-4-5',
    };
    if (ALIASES[model]) return ALIASES[model];

    // 2. Known valid snapshot dates per model family
    const VALID_SNAPSHOTS: Record<string, string[]> = {
      'claude-opus-4-6': [],                   // no snapshot date published yet — use alias
      'claude-sonnet-4-6': [],                 // no snapshot date published yet — use alias
      'claude-haiku-4-5': ['20251001'],
      'claude-sonnet-4-5': ['20250929'],
      'claude-opus-4-5': ['20251101'],
      'claude-opus-4-1': ['20250805'],
      'claude-sonnet-4': ['20250514'],
      'claude-opus-4': ['20250514'],
    };

    // 3. Check if model has an invalid snapshot date — strip it
    const snapshotMatch = model.match(/^(claude-[\w-]+?)-(\d{8})$/);
    if (snapshotMatch) {
      const base = snapshotMatch[1];
      const snapshot = snapshotMatch[2];
      const validDates = VALID_SNAPSHOTS[base];
      if (validDates !== undefined) {
        if (validDates.length === 0) {
          // No valid snapshot dates — use base alias
          logger.info('[AnthropicAdapter] Stripped invalid snapshot date from %s → %s', model, base);
          return base;
        }
        if (!validDates.includes(snapshot)) {
          // Invalid snapshot date — use the correct one
          const corrected = `${base}-${validDates[0]}`;
          logger.info('[AnthropicAdapter] Corrected snapshot date: %s → %s', model, corrected);
          return corrected;
        }
      }
    }

    return model;
  }

  /**
   * Convert LLMMessage[] to Anthropic message format.
   * - Tool results become user-role messages with tool_result content blocks
   * - Assistant messages with tool_calls become content blocks with text + tool_use
   * - Ensures first message is user role and roles alternate (Anthropic requirement)
   */
  private buildAnthropicMessages(
    messages: LLMMessage[],
  ): Array<Record<string, unknown>> {
    const raw = messages.map(m => {
      if (m.role === 'tool') {
        // Tool results go as user messages with tool_result content blocks
        return {
          role: 'user' as const,
          content: [{
            type: 'tool_result',
            tool_use_id: m.tool_call_id ?? '',
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          }],
        };
      }

      if (m.role === 'assistant') {
        const tc = (m as unknown as {
          tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
        }).tool_calls;

        if (tc && tc.length > 0) {
          // Assistant with tool calls → content blocks with text + tool_use
          const blocks: Array<Record<string, unknown>> = [];
          const textContent = typeof m.content === 'string' ? m.content : '';
          if (textContent) blocks.push({ type: 'text', text: textContent });
          for (const call of tc) {
            let input: Record<string, unknown> = {};
            try { input = JSON.parse(call.function.arguments); } catch { /* empty */ }
            blocks.push({ type: 'tool_use', id: call.id, name: call.function.name, input });
          }
          return { role: 'assistant' as const, content: blocks };
        }
      }

      return {
        role: (m.role === 'user' || m.role === 'assistant' ? m.role : 'user') as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      };
    });

    // Anthropic requires: (1) first message is user role, (2) roles alternate.
    // Merge consecutive same-role messages to fix violations.
    const merged: Array<Record<string, unknown>> = [];
    for (const msg of raw) {
      const prev = merged[merged.length - 1];
      if (prev && prev.role === msg.role) {
        // Merge: append content to previous message
        const prevContent = prev.content;
        const curContent = msg.content;
        if (Array.isArray(prevContent) && Array.isArray(curContent)) {
          prev.content = [...prevContent, ...curContent];
        } else if (Array.isArray(prevContent)) {
          prev.content = [...prevContent, { type: 'text', text: String(curContent) }];
        } else if (Array.isArray(curContent)) {
          prev.content = [{ type: 'text', text: String(prevContent) }, ...curContent];
        } else {
          prev.content = `${String(prevContent)}\n\n${String(curContent)}`;
        }
        logger.debug('[AnthropicAdapter] Merged consecutive %s messages', msg.role);
      } else {
        merged.push({ ...msg });
      }
    }

    // Ensure first message is user role
    if (merged.length > 0 && merged[0].role !== 'user') {
      logger.warn('[AnthropicAdapter] First message was %s, prepending empty user message', merged[0].role);
      merged.unshift({ role: 'user', content: 'Continue.' });
    }

    return merged;
  }
}
