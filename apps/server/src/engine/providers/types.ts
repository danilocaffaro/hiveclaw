// ============================================================
// LLM Provider Types
// ============================================================

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | LLMContentBlock[];
  tool_call_id?: string; // R20.1b: normalized to snake_case (was toolCallId)
  name?: string;
}

export type LLMContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  systemPrompt?: string;
}

export type StreamChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'finish'; reason: 'stop' | 'tool_calls' | 'max_tokens' | 'error' };

export interface LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly models: string[];
  chat(messages: LLMMessage[], options: LLMOptions): AsyncGenerator<StreamChunk>;
}
