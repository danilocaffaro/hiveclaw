/**
 * Native Session Runner — handles chat streaming without OpenClaw Bridge.
 * This replaces sessions-bridge.ts which routed everything through WebSocket.
 */

import { streamChat, type ChatMessage, type ChatOptions } from './chat-engine.js';
import type { ProviderRepository } from '../db/providers.js';
import type { AgentRepository } from '../db/index.js';
import type Database from 'better-sqlite3';

export interface SessionRunnerConfig {
  db: Database.Database;
  agents: AgentRepository;
  providers: ProviderRepository;
}

interface ResolvedAgent {
  id: string;
  name: string;
  emoji: string;
  systemPrompt: string;
  model: string;
  providerType: 'openai' | 'anthropic';
  baseUrl: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
}

// Provider type detection from base URL or explicit config
const PROVIDER_TYPE_MAP: Record<string, 'openai' | 'anthropic'> = {
  anthropic: 'anthropic',
  openai: 'openai',
  ollama: 'openai',        // Ollama uses OpenAI-compatible API
  google: 'openai',        // Gemini via OpenAI-compatible endpoint
  openrouter: 'openai',    // OpenRouter uses OpenAI format
  'github-copilot': 'openai',
};

const PROVIDER_BASE_URLS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  ollama: 'http://localhost:11434',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openrouter: 'https://openrouter.ai/api',
};

/**
 * Resolve agent + provider config into streaming-ready options.
 */
export function resolveAgent(
  agentId: string,
  agents: AgentRepository,
  providers: ProviderRepository,
): ResolvedAgent | null {
  const agent = agents.getById(agentId);
  if (!agent) return null;

  // Find provider — try agent's preference, then first available
  const providerList = providers.list();
  const pref = agent.providerPreference || agent.modelPreference?.split('/')[0];
  const provider = providerList.find(p => p.id === pref)
    || providerList.find(p => p.enabled)
    || providerList[0];

  if (!provider) return null;

  // Get unmasked API key
  const unmasked = providers.getUnmasked(provider.id);
  const apiKey = unmasked?.rawApiKey || undefined;

  // Determine provider type and base URL
  const providerType = PROVIDER_TYPE_MAP[provider.id] ?? 'openai';
  const baseUrl = provider.baseUrl || PROVIDER_BASE_URLS[provider.id] || 'https://api.openai.com';

  // Determine model
  const firstModel = provider.models[0];
  const model = agent.modelPreference || (typeof firstModel === 'string' ? firstModel : firstModel?.id) || 'gpt-4o';

  return {
    id: agent.id,
    name: agent.name,
    emoji: agent.emoji || '🤖',
    systemPrompt: agent.systemPrompt || 'You are a helpful assistant.',
    model,
    providerType,
    baseUrl,
    apiKey,
    temperature: agent.temperature ?? 0.7,
    maxTokens: agent.maxTokens ?? 4096,
  };
}

/**
 * Build message history for LLM from DB messages.
 */
export function buildChatMessages(
  systemPrompt: string,
  dbMessages: Array<{ role: string; content: string }>,
  maxHistory = 50,
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  // Include recent history (capped to avoid context overflow)
  const recent = dbMessages.slice(-maxHistory);
  for (const msg of recent) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  return messages;
}

/**
 * Stream a chat response for an agent, yielding SSE-formatted data.
 * This is the main entrypoint that replaces bridge.chat.send().
 */
export async function* runSession(
  resolved: ResolvedAgent,
  messages: ChatMessage[],
): AsyncGenerator<{ type: string; [key: string]: any }> {
  const opts: ChatOptions = {
    model: resolved.model,
    baseUrl: resolved.baseUrl,
    apiKey: resolved.apiKey,
    providerType: resolved.providerType,
    temperature: resolved.temperature,
    maxTokens: resolved.maxTokens,
  };

  yield { type: 'message.start', agentId: resolved.id, agentName: resolved.name, agentEmoji: resolved.emoji };

  let fullContent = '';

  for await (const delta of streamChat(messages, opts)) {
    if (delta.type === 'delta' && delta.content) {
      fullContent += delta.content;
      yield { type: 'message.delta', text: delta.content, agentId: resolved.id };
    }
    if (delta.type === 'error') {
      yield { type: 'error', message: delta.error, agentId: resolved.id };
      return;
    }
    if (delta.type === 'done') {
      yield {
        type: 'message.finish',
        agentId: resolved.id,
        content: fullContent,
        tokensIn: delta.tokensIn ?? 0,
        tokensOut: delta.tokensOut ?? 0,
        model: resolved.model,
      };
    }
  }
}
