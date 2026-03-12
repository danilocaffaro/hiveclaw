/**
 * Provider Router — thin layer over native chat-engine.ts
 *
 * In SuperClaw Pure, all LLM communication goes through chat-engine.ts
 * which uses native fetch(). This file provides backward-compatible
 * interfaces for code that references ProviderRouter.
 */

import { logger } from '../../lib/logger.js';
import { streamChat } from '../chat-engine.js';
import { initDatabase } from '../../db/index.js';
import { ProviderRepository } from '../../db/providers.js';

export interface LLMProvider {
  id: string;
  name: string;
  models: string[];
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: string; text?: string; [k: string]: unknown }>;
  tool_call_id?: string;
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  systemPrompt?: string;
  tools?: unknown[];
}

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'usage' | 'finish' | 'error';
  text?: string;
  id?: string;
  name?: string;
  args?: string;
  inputTokens?: number;
  outputTokens?: number;
  finishReason?: string;
  error?: string;
  // compat fields
  delta?: string;
  done?: boolean;
}

export class ProviderRouter {
  private providers = new Map<string, LLMProvider>();
  private defaultProviderId: string | null = null;

  register(provider: LLMProvider): void {
    this.providers.set(provider.id, provider);
    if (!this.defaultProviderId) this.defaultProviderId = provider.id;
  }

  get(id: string): LLMProvider | undefined {
    return this.providers.get(id);
  }

  getDefault(): LLMProvider | undefined {
    if (!this.defaultProviderId) return undefined;
    return this.providers.get(this.defaultProviderId);
  }

  setDefault(id: string): void {
    if (this.providers.has(id)) this.defaultProviderId = id;
  }

  list(): LLMProvider[] {
    return [...this.providers.values()];
  }

  /**
   * chatWithFallback — streams chat using native chat-engine.ts
   * Tries each provider in the fallback chain until one succeeds.
   * Translates chat-engine events → StreamChunk for backward compat.
   */
  async *chatWithFallback(
    messages: LLMMessage[],
    options: LLMOptions,
    fallbackChain: string[],
  ): AsyncGenerator<StreamChunk> {
    const db = initDatabase();
    const providerRepo = new ProviderRepository(db);

    for (const providerId of fallbackChain) {
      const provConfig = providerRepo.getUnmasked(providerId);
      if (!provConfig?.rawApiKey) continue;

      const firstModel = provConfig.models[0];
      const modelId = options.model ?? (typeof firstModel === 'object' ? firstModel.id : firstModel) ?? 'gpt-4o';
      const providerType = (provConfig.type as 'openai' | 'anthropic') === 'anthropic' ? 'anthropic' : 'openai';
      const baseUrl = provConfig.baseUrl ?? (providerType === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com');

      const chatMessages: import('../chat-engine.js').ChatMessage[] = messages.map(m => ({
        role: (m.role === 'tool' ? 'assistant' : m.role) as 'user' | 'assistant' | 'system',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      }));

      const chatOptions: import('../chat-engine.js').ChatOptions = {
        model: modelId,
        baseUrl,
        apiKey: provConfig.rawApiKey,
        providerType,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
      };

      // Inject system prompt as first message if provided
      if (options.systemPrompt) {
        chatMessages.unshift({ role: 'system', content: options.systemPrompt });
      }

      try {
        for await (const event of streamChat(chatMessages, chatOptions)) {
          if (event.type === 'delta' && event.content) {
            yield { type: 'text', text: event.content };
          } else if (event.type === 'done') {
            yield { type: 'finish', finishReason: 'stop' };
          } else if (event.type === 'error') {
            throw new Error(event.error);
          }
        }
        return;
      } catch (err) {
        logger.warn(`[ProviderRouter] Provider ${providerId} failed: ${(err as Error).message} — trying next`);
        continue;
      }
    }

    // All providers exhausted
    yield { type: 'error', error: 'All providers in fallback chain failed or have no API key configured' };
  }
}

/**
 * Initialize providers from config.
 */
export async function initProviders(config: {
  anthropic?: { apiKey: string };
  openai?: { apiKey: string };
  defaults?: { provider: string };
} = {}): Promise<ProviderRouter> {
  const router = new ProviderRouter();

  if (config.anthropic?.apiKey) {
    router.register({ id: 'anthropic', name: 'Anthropic', models: ['claude-sonnet-4-5-20250514', 'claude-haiku-4-5-20250514'] });
  }

  if (config.openai?.apiKey) {
    router.register({ id: 'openai', name: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini'] });
  }

  if (config.defaults?.provider) {
    router.setDefault(config.defaults.provider);
  }

  logger.info(`[Providers] Initialized ${router.list().length} providers`);
  return router;
}

// ─── Singleton shim ────────────────────────────────────────────────────────────
let _router: ProviderRouter | null = null;

export function getProviderRouter(): ProviderRouter {
  if (!_router) {
    _router = new ProviderRouter();
  }
  return _router;
}

export function setProviderRouter(router: ProviderRouter): void {
  _router = router;
}
