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

    yield { type: 'error', error: `Anthropic adapter failed after ${MAX_RETRIES + 1} attempts: ${lastErr?.message}` };
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
    const body: Record<string, unknown> = {
      model: options.model,
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
      throw new Error(`Anthropic error ${res.status}: ${text.slice(0, 300)}`);
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
    let finishReason: 'stop' | 'tool_calls' | 'max_tokens' | 'error' = 'stop';

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

            // Anthropic stop reason
            if (data.type === 'message_delta' && data.delta?.stop_reason) {
              const stopReason = data.delta.stop_reason;
              if (stopReason === 'tool_use') {
                finishReason = 'tool_calls';
              } else if (stopReason === 'max_tokens') {
                finishReason = 'max_tokens';
              } else if (stopReason === 'end_turn') {
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

    yield { type: 'usage', inputTokens: tokensIn, outputTokens: tokensOut };
    yield { type: 'finish', reason: finishReason };
  }

  /**
   * Convert LLMMessage[] to Anthropic message format.
   * - Tool results become user-role messages with tool_result content blocks
   * - Assistant messages with tool_calls become content blocks with text + tool_use
   */
  private buildAnthropicMessages(
    messages: LLMMessage[],
  ): Array<Record<string, unknown>> {
    return messages.map(m => {
      if (m.role === 'tool') {
        // Tool results go as user messages with tool_result content blocks
        return {
          role: 'user',
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
          return { role: 'assistant', content: blocks };
        }
      }

      return {
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      };
    });
  }
}
