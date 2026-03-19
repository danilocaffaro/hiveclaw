/**
 * Engine v2 — Ollama Adapter (OpenAI-compatible subset)
 *
 * Simplified version for local Ollama models:
 * - No auth needed
 * - Uses Ollama's /api/chat endpoint with NDJSON streaming
 * - Tool support may be limited depending on model — handles gracefully
 * - No retry (local network, failures are usually config issues not transient)
 */

import type { ProviderAdapter, AdapterConfig, AdapterOptions, AgentEvent, LLMMessage } from './types.js';
import { logger } from '../../../lib/logger.js';

export class OllamaAdapter implements ProviderAdapter {
  readonly id: string;
  readonly name: string;

  private baseUrl: string;

  constructor(id: string, name: string, config: AdapterConfig) {
    this.id = id;
    this.name = name;
    this.baseUrl = (config.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '');
  }

  async *streamTurn(
    messages: LLMMessage[],
    options: AdapterOptions,
  ): AsyncGenerator<AgentEvent> {
    // Build Ollama messages
    const ollamaMessages: Array<{ role: string; content: string }> = [];

    if (options.systemPrompt) {
      ollamaMessages.push({ role: 'system', content: options.systemPrompt });
    }

    for (const m of messages) {
      if (m.role === 'system') continue; // handled above via systemPrompt
      ollamaMessages.push({
        role: m.role === 'tool' ? 'user' : m.role,
        content: this.flattenContent(m),
      });
    }

    const body: Record<string, unknown> = {
      model: options.model,
      messages: ollamaMessages,
      stream: true,
      options: {
        temperature: options.temperature ?? 0.7,
        num_predict: options.maxTokens ?? 4096,
      },
    };

    // Ollama supports tools for some models — include if provided
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: options.signal,
      });
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') {
        yield { type: 'error', error: 'Request aborted' };
        yield { type: 'finish', reason: 'error' };
        return;
      }
      yield { type: 'error', error: `Ollama connection failed: ${(err as Error).message}` };
      yield { type: 'finish', reason: 'error' };
      return;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown');
      yield { type: 'error', error: `Ollama error ${res.status}: ${text.slice(0, 300)}` };
      yield { type: 'finish', reason: 'error' };
      return;
    }

    if (!res.body) {
      yield { type: 'error', error: 'Ollama: No response body' };
      yield { type: 'finish', reason: 'error' };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let tokensIn = 0, tokensOut = 0;
    const collectedToolCalls: Array<{ id: string; name: string; arguments: string }> = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line) as {
              message?: {
                content?: string;
                tool_calls?: Array<{
                  function?: { name?: string; arguments?: Record<string, unknown> };
                }>;
              };
              done?: boolean;
              prompt_eval_count?: number;
              eval_count?: number;
            };

            // Text content
            if (data.message?.content) {
              yield { type: 'text', text: data.message.content };
            }

            // Tool calls (Ollama returns them in the message object when done)
            if (data.message?.tool_calls) {
              for (const tc of data.message.tool_calls) {
                if (tc.function?.name) {
                  const toolCall = {
                    id: `ollama_tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    name: tc.function.name,
                    arguments: tc.function.arguments ? JSON.stringify(tc.function.arguments) : '{}',
                  };
                  yield { type: 'tool_call', ...toolCall };
                  collectedToolCalls.push(toolCall);
                }
              }
            }

            // Stream done — capture usage
            if (data.done) {
              tokensIn = data.prompt_eval_count ?? 0;
              tokensOut = data.eval_count ?? 0;
            }
          } catch {
            /* skip malformed NDJSON lines */
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Emit tool_result_needed if we collected tool calls
    if (collectedToolCalls.length > 0) {
      yield { type: 'tool_result_needed', toolCalls: collectedToolCalls };
    }

    yield { type: 'usage', inputTokens: tokensIn, outputTokens: tokensOut };
    yield { type: 'finish', reason: collectedToolCalls.length > 0 ? 'tool_calls' : 'stop' };

    logger.debug(`[OllamaAdapter] Turn complete: ${tokensIn}in/${tokensOut}out tokens`);
  }

  /**
   * Flatten LLMMessage content to string.
   */
  private flattenContent(m: LLMMessage): string {
    if (typeof m.content === 'string') return m.content;
    return m.content
      .map(b => {
        if (b.type === 'text') return b.text;
        if (b.type === 'tool_result') return b.content;
        return '';
      })
      .join('');
  }
}
