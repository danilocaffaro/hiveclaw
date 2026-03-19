/**
 * Engine v2 — OpenAI-Compatible Provider Adapter
 *
 * Handles all OpenAI-compatible providers: OpenAI, GitHub Copilot,
 * OpenRouter, DeepSeek, Groq, Mistral, Google (via OpenAI compat).
 *
 * Key design decisions:
 * - Copilot token exchange handled internally with in-memory caching (R20.1a)
 * - Copilot MUST use stream: true (non-streaming tool_calls broken on proxy)
 * - SSE stream → AgentEvent mapping
 * - Index-based tool_calls accumulation from streaming chunks
 * - Retry with exponential backoff (R20.2a pattern)
 */

import type { ProviderAdapter, AdapterConfig, AdapterOptions, AgentEvent, LLMMessage } from './types.js';
import { logger } from '../../../lib/logger.js';

// ─── Copilot Token Cache (R20.1a) ──────────────────────────────────────────────

interface CopilotTokenCache {
  token: string;
  baseUrl: string;
  expiresAt: number; // epoch ms
  oauthKey: string;  // the original OAuth key that produced this token
}

let _copilotTokenCache: CopilotTokenCache | null = null;
const COPILOT_TOKEN_MARGIN_MS = 5 * 60 * 1000; // refresh 5min before expiry

function getCachedCopilotToken(oauthKey: string): CopilotTokenCache | null {
  if (!_copilotTokenCache) return null;
  if (_copilotTokenCache.oauthKey !== oauthKey) return null;
  if (Date.now() >= _copilotTokenCache.expiresAt - COPILOT_TOKEN_MARGIN_MS) return null;
  return _copilotTokenCache;
}

function setCopilotTokenCache(oauthKey: string, token: string, baseUrl: string, expiresAt: number): void {
  _copilotTokenCache = { token, baseUrl, expiresAt, oauthKey };
}

export function invalidateCopilotTokenCache(): void {
  _copilotTokenCache = null;
}

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

// ─── OpenAI Adapter ─────────────────────────────────────────────────────────────

export class OpenAIAdapter implements ProviderAdapter {
  readonly id: string;
  readonly name: string;

  private apiKey: string | undefined;
  private baseUrl: string;
  private extraHeaders: Record<string, string>;
  private isCopilot: boolean;

  constructor(id: string, name: string, config: AdapterConfig) {
    this.id = id;
    this.name = name;
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? 'https://api.openai.com').replace(/\/$/, '');
    this.extraHeaders = config.extraHeaders ?? {};
    this.isCopilot = this.baseUrl.includes('githubcopilot.com');
  }

  async *streamTurn(
    messages: LLMMessage[],
    options: AdapterOptions,
  ): AsyncGenerator<AgentEvent> {
    // Resolve Copilot credentials if needed
    let apiKey = this.apiKey;
    let baseUrl = this.baseUrl;
    let extraHeaders = { ...this.extraHeaders };

    if (this.isCopilot && apiKey) {
      const resolved = await this.resolveCopilotCredentials(apiKey);
      if (!resolved) {
        yield { type: 'error', error: 'GitHub Copilot token exchange failed. Re-authenticate via Settings > Providers > GitHub Copilot.' };
        yield { type: 'finish', reason: 'error' };
        return;
      }
      apiKey = resolved.token;
      baseUrl = resolved.baseUrl;
      extraHeaders = {
        ...extraHeaders,
        'Editor-Version': 'vscode/1.96.0',
        'Editor-Plugin-Version': 'copilot/1.0.0',
        'Copilot-Integration-Id': 'vscode-chat',
      };
    }

    // Retry loop (R20.2a)
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = retryDelay(attempt - 1);
        logger.warn(`[OpenAIAdapter] Retry ${attempt}/${MAX_RETRIES} for ${this.id} in ${Math.round(delay)}ms`);
        await sleep(delay);
        // On retry for Copilot, invalidate token cache
        if (this.isCopilot) {
          invalidateCopilotTokenCache();
          if (this.apiKey) {
            const resolved = await this.resolveCopilotCredentials(this.apiKey);
            if (resolved) {
              apiKey = resolved.token;
              baseUrl = resolved.baseUrl;
            }
          }
        }
      }

      try {
        yield* this.doStreamTurn(messages, options, apiKey, baseUrl, extraHeaders);
        return; // success
      } catch (err) {
        lastErr = err as Error;
        if (attempt < MAX_RETRIES && isRetryableError(err)) {
          continue;
        }
        break; // non-retryable or max retries exhausted
      }
    }

    yield { type: 'error', error: `OpenAI adapter failed after ${MAX_RETRIES + 1} attempts: ${lastErr?.message}` };
    yield { type: 'finish', reason: 'error' };
  }

  /**
   * Single streaming attempt — no retries.
   */
  private async *doStreamTurn(
    messages: LLMMessage[],
    options: AdapterOptions,
    apiKey: string | undefined,
    baseUrl: string,
    extraHeaders: Record<string, string>,
  ): AsyncGenerator<AgentEvent> {
    const url = this.isCopilot || baseUrl.includes('githubcopilot.com')
      ? `${baseUrl}/chat/completions`
      : `${baseUrl}/v1/chat/completions`;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    Object.assign(headers, extraHeaders);

    // Convert messages to OpenAI format
    const oaiMessages = this.buildOAIMessages(messages, options.systemPrompt);

    // Build request body
    const body: Record<string, unknown> = {
      model: options.model,
      messages: oaiMessages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }

    let res: Response;
    try {
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: options.signal });
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
      throw new Error(`LLM error ${res.status}: ${text.slice(0, 300)}`);
    }
    if (!res.body) {
      throw new Error('No response body');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let tokensIn = 0, tokensOut = 0;
    const pendingToolCalls: Array<{ id: string; name: string; arguments: string } | undefined> = [];
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
          if (payload === '[DONE]') {
            // Emit any remaining tool calls
            const collected = this.collectToolCalls(pendingToolCalls);
            if (collected.length > 0) {
              for (const tc of collected) {
                yield { type: 'tool_call', id: tc.id, name: tc.name, arguments: tc.arguments };
              }
              yield { type: 'tool_result_needed', toolCalls: collected };
              finishReason = 'tool_calls';
            }
            yield { type: 'usage', inputTokens: tokensIn, outputTokens: tokensOut };
            yield { type: 'finish', reason: finishReason };
            return;
          }

          try {
            const data = JSON.parse(payload);
            const choice = data.choices?.[0];
            const delta = choice?.delta;

            // Text content
            if (delta?.content) {
              yield { type: 'text', text: delta.content };
            }

            // Tool calls (streamed incrementally, index-based)
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls as Array<{
                index: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>) {
                const idx = tc.index;
                if (tc.id || tc.function?.name) {
                  if (!pendingToolCalls[idx]) {
                    pendingToolCalls[idx] = {
                      id: tc.id ?? '',
                      name: tc.function?.name ?? '',
                      arguments: tc.function?.arguments ?? '',
                    };
                  } else {
                    if (tc.function?.arguments) pendingToolCalls[idx]!.arguments += tc.function.arguments;
                  }
                } else if (tc.function?.arguments && pendingToolCalls[idx]) {
                  pendingToolCalls[idx]!.arguments += tc.function.arguments;
                }
              }
            }

            // Finish reason = tool_calls → emit accumulated tool calls
            if (choice?.finish_reason === 'tool_calls') {
              const collected = this.collectToolCalls(pendingToolCalls);
              for (const tc of collected) {
                yield { type: 'tool_call', id: tc.id, name: tc.name, arguments: tc.arguments };
              }
              if (collected.length > 0) {
                yield { type: 'tool_result_needed', toolCalls: collected };
              }
              pendingToolCalls.length = 0;
              finishReason = 'tool_calls';
            } else if (choice?.finish_reason === 'stop') {
              finishReason = 'stop';
            } else if (choice?.finish_reason === 'length') {
              finishReason = 'max_tokens';
            }

            // Usage tracking
            if (data.usage) {
              tokensIn = data.usage.prompt_tokens ?? tokensIn;
              tokensOut = data.usage.completion_tokens ?? tokensOut;
            }
          } catch {
            /* skip malformed chunks */
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Stream ended without [DONE] — emit what we have
    // R22-P1: If max_tokens and any collected tool call has un-parseable JSON,
    // signal max_tokens_tool_call so the runner can inject a recovery prompt.
    const collected = this.collectToolCalls(pendingToolCalls);
    if (collected.length > 0) {
      let anyTruncated = false;
      if (finishReason === 'max_tokens') {
        for (const tc of collected) {
          try { JSON.parse(tc.arguments); } catch {
            logger.warn('[OpenAI] Tool call "%s" truncated by max_tokens (%d chars of args)', tc.name, tc.arguments.length);
            anyTruncated = true;
          }
        }
      }
      if (!anyTruncated) {
        for (const tc of collected) {
          yield { type: 'tool_call', id: tc.id, name: tc.name, arguments: tc.arguments };
        }
        yield { type: 'tool_result_needed', toolCalls: collected };
        finishReason = 'tool_calls';
      } else {
        finishReason = 'max_tokens_tool_call';
      }
    }
    yield { type: 'usage', inputTokens: tokensIn, outputTokens: tokensOut };
    yield { type: 'finish', reason: finishReason };
  }

  /**
   * Build OpenAI-format messages array, including system prompt.
   */
  private buildOAIMessages(
    messages: LLMMessage[],
    systemPrompt?: string,
  ): Array<Record<string, unknown>> {
    const oaiMessages: Array<Record<string, unknown>> = [];

    if (systemPrompt) {
      oaiMessages.push({ role: 'system', content: systemPrompt });
    }

    for (const m of messages) {
      if (m.role === 'tool') {
        oaiMessages.push({
          role: 'tool',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          tool_call_id: m.tool_call_id ?? '',
        });
      } else if (m.role === 'assistant' && this.hasToolCalls(m)) {
        const tc = (m as unknown as {
          tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
        }).tool_calls;
        oaiMessages.push({
          role: 'assistant',
          content: typeof m.content === 'string' ? (m.content || null) : JSON.stringify(m.content),
          tool_calls: tc,
        });
      } else {
        oaiMessages.push({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        });
      }
    }

    return oaiMessages;
  }

  /**
   * Check if an assistant message has tool_calls attached.
   */
  private hasToolCalls(m: LLMMessage): boolean {
    const tc = (m as unknown as {
      tool_calls?: Array<unknown>;
    }).tool_calls;
    return Array.isArray(tc) && tc.length > 0;
  }

  /**
   * Collect non-undefined pending tool calls into a clean array.
   */
  private collectToolCalls(
    pending: Array<{ id: string; name: string; arguments: string } | undefined>,
  ): Array<{ id: string; name: string; arguments: string }> {
    return pending.filter((tc): tc is { id: string; name: string; arguments: string } => tc !== undefined);
  }

  /**
   * Resolve Copilot OAuth token → session token (with caching).
   */
  private async resolveCopilotCredentials(
    oauthKey: string,
  ): Promise<{ token: string; baseUrl: string } | null> {
    const cached = getCachedCopilotToken(oauthKey);
    if (cached) {
      logger.debug(`[OpenAIAdapter] Copilot token cache hit (expires in ${Math.round((cached.expiresAt - Date.now()) / 1000)}s)`);
      return { token: cached.token, baseUrl: cached.baseUrl };
    }

    try {
      const tokenRes = await fetch('https://api.github.com/copilot_internal/v2/token', {
        headers: {
          Authorization: `Bearer ${oauthKey}`,
          'Accept': 'application/json',
          'User-Agent': 'HiveClaw/1.1',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!tokenRes.ok) {
        logger.error(`[OpenAIAdapter] Copilot token exchange failed: ${tokenRes.status} ${await tokenRes.text().catch(() => '')}`);
        return null;
      }

      const tokenData = await tokenRes.json() as {
        token?: string;
        expires_at?: number;
        endpoints?: { api?: string };
      };

      if (!tokenData.token) {
        logger.error('[OpenAIAdapter] Copilot token exchange returned no token');
        return null;
      }

      const resolvedBase = tokenData.endpoints?.api ?? this.baseUrl;
      let expiresAt = Date.now() + 30 * 60 * 1000; // default 30min
      if (tokenData.expires_at) {
        expiresAt = tokenData.expires_at > 1e12 ? tokenData.expires_at : tokenData.expires_at * 1000;
      }

      setCopilotTokenCache(oauthKey, tokenData.token, resolvedBase, expiresAt);
      logger.info(`[OpenAIAdapter] Copilot token exchanged OK, endpoint: ${resolvedBase}, expires in ${Math.round((expiresAt - Date.now()) / 1000)}s`);

      return { token: tokenData.token, baseUrl: resolvedBase };
    } catch (err) {
      logger.error(`[OpenAIAdapter] Copilot token exchange error: ${(err as Error).message}`);
      invalidateCopilotTokenCache();
      return null;
    }
  }
}
