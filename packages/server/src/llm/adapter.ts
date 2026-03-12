// Universal LLM Adapter — supports OpenAI-compatible + Anthropic native

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model: string;
  baseUrl: string;
  apiKey?: string;
  providerType: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface ChatResponse {
  content: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

/**
 * Non-streaming chat completion
 */
export async function chatComplete(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResponse> {
  if (opts.providerType === 'anthropic') {
    return chatAnthropic(messages, opts);
  }
  return chatOpenAI(messages, opts);
}

/**
 * Streaming chat completion — yields text deltas
 */
export async function* chatStream(messages: ChatMessage[], opts: ChatOptions): AsyncGenerator<string> {
  if (opts.providerType === 'anthropic') {
    yield* streamAnthropic(messages, opts);
  } else {
    yield* streamOpenAI(messages, opts);
  }
}

// ── OpenAI-compatible (covers OpenAI, Ollama, OpenRouter, Google, etc.) ──

async function chatOpenAI(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResponse> {
  const url = `${opts.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.apiKey) headers['Authorization'] = `Bearer ${opts.apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: opts.model,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 4096,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM error ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = await res.json() as any;
  return {
    content: data.choices?.[0]?.message?.content ?? '',
    model: data.model ?? opts.model,
    tokensIn: data.usage?.prompt_tokens ?? 0,
    tokensOut: data.usage?.completion_tokens ?? 0,
  };
}

async function* streamOpenAI(messages: ChatMessage[], opts: ChatOptions): AsyncGenerator<string> {
  const url = `${opts.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.apiKey) headers['Authorization'] = `Bearer ${opts.apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: opts.model,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 4096,
      stream: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM stream error ${res.status}: ${text.slice(0, 500)}`);
  }
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
      if (payload === '[DONE]') return;
      try {
        const data = JSON.parse(payload) as any;
        const delta = data.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch { /* skip malformed */ }
    }
  }
}

// ── Anthropic native ─────────────────────────────────────────────────────

async function chatAnthropic(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResponse> {
  const url = `${opts.baseUrl.replace(/\/$/, '')}/v1/messages`;
  
  // Extract system message
  const systemMsg = messages.find(m => m.role === 'system');
  const chatMsgs = messages.filter(m => m.role !== 'system');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': opts.apiKey ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4096,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: chatMsgs.map(m => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic error ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = await res.json() as any;
  return {
    content: data.content?.[0]?.text ?? '',
    model: data.model ?? opts.model,
    tokensIn: data.usage?.input_tokens ?? 0,
    tokensOut: data.usage?.output_tokens ?? 0,
  };
}

async function* streamAnthropic(messages: ChatMessage[], opts: ChatOptions): AsyncGenerator<string> {
  const url = `${opts.baseUrl.replace(/\/$/, '')}/v1/messages`;
  
  const systemMsg = messages.find(m => m.role === 'system');
  const chatMsgs = messages.filter(m => m.role !== 'system');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': opts.apiKey ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4096,
      stream: true,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: chatMsgs.map(m => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic stream error ${res.status}: ${text.slice(0, 500)}`);
  }
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
      try {
        const data = JSON.parse(payload) as any;
        if (data.type === 'content_block_delta' && data.delta?.text) {
          yield data.delta.text;
        }
      } catch { /* skip */ }
    }
  }
}
