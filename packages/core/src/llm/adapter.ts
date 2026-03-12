// LLM Adapter — Universal adapter for all LLM providers
// Translates SuperClaw messages to provider-specific format

import type { LLMConfig, LLMMessage, LLMResponse, LLMStreamChunk } from './types.js';

export class LLMAdapter {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  /**
   * Send a chat completion request (non-streaming)
   */
  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    const { provider } = this.config;

    switch (provider.type) {
      case 'openai':
      case 'custom':
        return this.chatOpenAI(messages);
      case 'anthropic':
        return this.chatAnthropic(messages);
      case 'ollama':
        return this.chatOllama(messages);
      case 'google':
        return this.chatGoogle(messages);
      default:
        throw new Error(`Unknown provider type: ${provider.type}`);
    }
  }

  /**
   * Send a streaming chat completion request
   */
  async *stream(messages: LLMMessage[]): AsyncGenerator<LLMStreamChunk> {
    const { provider } = this.config;

    switch (provider.type) {
      case 'openai':
      case 'custom':
        yield* this.streamOpenAI(messages);
        break;
      case 'anthropic':
        yield* this.streamAnthropic(messages);
        break;
      case 'ollama':
        yield* this.streamOllama(messages);
        break;
      case 'google':
        yield* this.streamGoogle(messages);
        break;
      default:
        throw new Error(`Unknown provider type: ${provider.type}`);
    }
  }

  // ─── OpenAI-compatible (covers 90% of providers) ──────────────────────

  private async chatOpenAI(messages: LLMMessage[]): Promise<LLMResponse> {
    const res = await fetch(`${this.config.provider.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.provider.apiKey && { Authorization: `Bearer ${this.config.provider.apiKey}` }),
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        temperature: this.config.temperature ?? 0.7,
        max_tokens: this.config.maxTokens ?? 4096,
      }),
    });

    if (!res.ok) throw new Error(`OpenAI API error: ${res.status} ${await res.text()}`);
    const data = await res.json() as any;
    const choice = data.choices[0];

    return {
      id: data.id,
      model: data.model,
      content: choice.message.content ?? '',
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      finishReason: choice.finish_reason,
    };
  }

  private async *streamOpenAI(messages: LLMMessage[]): AsyncGenerator<LLMStreamChunk> {
    const res = await fetch(`${this.config.provider.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.provider.apiKey && { Authorization: `Bearer ${this.config.provider.apiKey}` }),
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        temperature: this.config.temperature ?? 0.7,
        max_tokens: this.config.maxTokens ?? 4096,
        stream: true,
      }),
    });

    if (!res.ok) throw new Error(`OpenAI stream error: ${res.status}`);
    if (!res.body) throw new Error('No response body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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
          yield { id: '', delta: '', done: true };
          return;
        }
        try {
          const data = JSON.parse(payload) as any;
          const delta = data.choices?.[0]?.delta?.content ?? '';
          if (delta) {
            yield { id: data.id, delta, done: false };
          }
        } catch { /* skip malformed */ }
      }
    }
  }

  // ─── Anthropic ─────────────────────────────────────────────────────────

  private async chatAnthropic(_messages: LLMMessage[]): Promise<LLMResponse> {
    // TODO: Implement Anthropic Messages API
    throw new Error('Anthropic adapter not yet implemented');
  }

  private async *streamAnthropic(_messages: LLMMessage[]): AsyncGenerator<LLMStreamChunk> {
    // TODO: Implement Anthropic streaming
    throw new Error('Anthropic streaming not yet implemented');
  }

  // ─── Ollama ────────────────────────────────────────────────────────────

  private async chatOllama(_messages: LLMMessage[]): Promise<LLMResponse> {
    // Ollama uses OpenAI-compatible API at /v1/chat/completions
    return this.chatOpenAI(_messages);
  }

  private async *streamOllama(_messages: LLMMessage[]): AsyncGenerator<LLMStreamChunk> {
    yield* this.streamOpenAI(_messages);
  }

  // ─── Google ────────────────────────────────────────────────────────────

  private async chatGoogle(_messages: LLMMessage[]): Promise<LLMResponse> {
    // TODO: Implement Google Gemini API
    throw new Error('Google adapter not yet implemented');
  }

  private async *streamGoogle(_messages: LLMMessage[]): AsyncGenerator<LLMStreamChunk> {
    throw new Error('Google streaming not yet implemented');
  }
}
