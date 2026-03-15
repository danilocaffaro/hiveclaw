/**
 * Native Chat Engine — handles native LLM communication.
 * Supports OpenAI-compatible and Anthropic native APIs.
 * Full tool calling support for both protocols.
 * Streaming via async generators.
 */

// ─── Types ──────────────────────────────────────────────────────────────

/** Message with full tool calling support */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
  /** For assistant messages with tool calls (OpenAI format) */
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  /** For tool result messages (OpenAI format) */
  tool_call_id?: string;
  /** Tool name (for tool result messages) */
  name?: string;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatOptions {
  model: string;
  baseUrl: string;
  apiKey?: string;
  providerType: 'openai' | 'anthropic';
  temperature?: number;
  maxTokens?: number;
  extraHeaders?: Record<string, string>;
  tools?: ToolDefinition[];
}

export interface StreamDelta {
  type: 'delta' | 'done' | 'error' | 'tool_call';
  content?: string;
  tokensIn?: number;
  tokensOut?: number;
  error?: string;
  toolCall?: { id: string; name: string; arguments: string };
}

// ─── OpenAI-Compatible Streaming ────────────────────────────────────────

async function* streamOpenAI(messages: ChatMessage[], opts: ChatOptions): AsyncGenerator<StreamDelta> {
  const base = opts.baseUrl.replace(/\/$/, '');
  const isCopilot = base.includes('githubcopilot.com');
  const url = isCopilot ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.apiKey) headers['Authorization'] = `Bearer ${opts.apiKey}`;
  if (opts.extraHeaders) Object.assign(headers, opts.extraHeaders);

  // Convert messages to OpenAI format
  const oaiMessages = messages.map(m => {
    if (m.role === 'tool') {
      // Tool result message
      return {
        role: 'tool' as const,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        tool_call_id: m.tool_call_id ?? '',
      };
    }
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      // Assistant message with tool calls
      return {
        role: 'assistant' as const,
        content: typeof m.content === 'string' ? (m.content || null) : JSON.stringify(m.content),
        tool_calls: m.tool_calls,
      };
    }
    return {
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    };
  });

  // Build request body
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: oaiMessages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 4096,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (err: unknown) {
    yield { type: 'error', error: `Connection failed: ${(err as Error).message}` };
    return;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => 'unknown');
    yield { type: 'error', error: `LLM error ${res.status}: ${text.slice(0, 300)}` };
    return;
  }
  if (!res.body) {
    yield { type: 'error', error: 'No response body' };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let tokensIn = 0, tokensOut = 0;
  const pendingToolCalls: Array<{ id: string; name: string; arguments: string } | undefined> = [];

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
          // Emit any remaining tool calls before done
          for (const ptc of pendingToolCalls) {
            if (ptc) yield { type: 'tool_call', toolCall: ptc };
          }
          yield { type: 'done', tokensIn, tokensOut };
          return;
        }
        try {
          const data = JSON.parse(payload);
          const choice = data.choices?.[0];
          const delta = choice?.delta;

          // Text content
          if (delta?.content) yield { type: 'delta', content: delta.content };

          // Tool calls (streamed incrementally)
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls as Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>) {
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
            for (const ptc of pendingToolCalls) {
              if (ptc) yield { type: 'tool_call', toolCall: ptc };
            }
            pendingToolCalls.length = 0;
          }

          // Usage tracking
          if (data.usage) {
            tokensIn = data.usage.prompt_tokens ?? tokensIn;
            tokensOut = data.usage.completion_tokens ?? tokensOut;
          }
        } catch { /* skip malformed chunks */ }
      }
    }
  } finally {
    reader.releaseLock();
  }

  yield { type: 'done', tokensIn, tokensOut };
}

// ─── Anthropic Native Streaming ─────────────────────────────────────────

async function* streamAnthropic(messages: ChatMessage[], opts: ChatOptions): AsyncGenerator<StreamDelta> {
  const url = `${opts.baseUrl.replace(/\/$/, '')}/v1/messages`;

  // Extract system message
  const systemMsg = messages.find(m => m.role === 'system');
  const chatMsgs = messages.filter(m => m.role !== 'system');

  // Convert messages to Anthropic format
  const anthropicMsgs = chatMsgs.map(m => {
    if (m.role === 'tool') {
      // Tool results go as user messages with tool_result content blocks
      return {
        role: 'user' as const,
        content: [{
          type: 'tool_result' as const,
          tool_use_id: m.tool_call_id ?? '',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        }],
      };
    }
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      // Assistant with tool calls → content blocks with text + tool_use
      const blocks: Array<Record<string, unknown>> = [];
      const textContent = typeof m.content === 'string' ? m.content : '';
      if (textContent) blocks.push({ type: 'text', text: textContent });
      for (const tc of m.tool_calls) {
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(tc.function.arguments); } catch { /* empty */ }
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
      }
      return { role: 'assistant' as const, content: blocks };
    }
    return {
      role: m.role as 'user' | 'assistant',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    };
  });

  // Build request body
  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 4096,
    stream: true,
    messages: anthropicMsgs,
  };
  if (systemMsg) {
    body.system = typeof systemMsg.content === 'string' ? systemMsg.content : JSON.stringify(systemMsg.content);
  }
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.apiKey?.includes('sk-ant-oat')
          ? { Authorization: `Bearer ${opts.apiKey}`, 'anthropic-beta': 'oauth-2025-04-20' }
          : { 'x-api-key': opts.apiKey ?? '' }),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
  } catch (err: unknown) {
    yield { type: 'error', error: `Connection failed: ${(err as Error).message}` };
    return;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => 'unknown');
    yield { type: 'error', error: `Anthropic error ${res.status}: ${text.slice(0, 300)}` };
    return;
  }
  if (!res.body) {
    yield { type: 'error', error: 'No response body' };
    return;
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
            yield { type: 'delta', content: data.delta.text };
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
            yield {
              type: 'tool_call',
              toolCall: { id: currentToolId, name: currentToolName, arguments: currentToolArgs },
            };
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
        } catch { /* skip malformed */ }
      }
    }
  } finally {
    reader.releaseLock();
  }

  yield { type: 'done', tokensIn, tokensOut };
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Stream a chat completion from any supported provider.
 * Full tool calling support for both OpenAI and Anthropic protocols.
 */
export function streamChat(messages: ChatMessage[], opts: ChatOptions): AsyncGenerator<StreamDelta> {
  if (opts.providerType === 'anthropic') {
    return streamAnthropic(messages, opts);
  }
  return streamOpenAI(messages, opts);
}

/**
 * Non-streaming completion (convenience wrapper). Does NOT handle tool calls.
 */
export async function chatComplete(messages: ChatMessage[], opts: ChatOptions): Promise<{ content: string; tokensIn: number; tokensOut: number }> {
  let content = '';
  let tokensIn = 0, tokensOut = 0;

  for await (const delta of streamChat(messages, opts)) {
    if (delta.type === 'delta' && delta.content) content += delta.content;
    if (delta.type === 'done') {
      tokensIn = delta.tokensIn ?? 0;
      tokensOut = delta.tokensOut ?? 0;
    }
    if (delta.type === 'error') throw new Error(delta.error);
  }

  return { content, tokensIn, tokensOut };
}
