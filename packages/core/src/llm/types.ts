// LLM Types — Universal adapter types for all providers

export interface LLMProvider {
  id: string;
  name: string;
  type: 'openai' | 'anthropic' | 'ollama' | 'google' | 'custom';
  baseUrl: string;
  apiKey?: string;
  models: string[];
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface LLMResponse {
  id: string;
  model: string;
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter';
}

export interface LLMStreamChunk {
  id: string;
  delta: string;
  done: boolean;
}

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}
