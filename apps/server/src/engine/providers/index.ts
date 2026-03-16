/**
 * Provider Router — thin layer over native chat-engine.ts
 *
 * In HiveClaw, all LLM communication goes through chat-engine.ts
 * which uses native fetch(). This file provides backward-compatible
 * interfaces for code that references ProviderRouter.
 */

import { logger } from '../../lib/logger.js';
import { streamChat } from '../chat-engine.js';
import { initDatabase } from '../../db/index.js';
import { ProviderRepository } from '../../db/providers.js';
import { resolveProviderBaseUrl, resolveProviderType, providerNeedsApiKey } from '../../config/defaults.js';

export interface LLMProvider {
  id: string;
  name: string;
  models: string[];
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: string; text?: string; [k: string]: unknown }>;
  tool_call_id?: string;
  name?: string;
}

export type { LLMOptions, ToolDefinition as LLMToolDefinition } from './types.js';
import type { LLMOptions } from './types.js';

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'usage' | 'finish' | 'error';
  text?: string;
  id?: string;
  name?: string;
  args?: string;
  inputTokens?: number;
  outputTokens?: number;
  tokensIn?: number;
  tokensOut?: number;
  finishReason?: string;
  error?: string;
  toolCall?: { id: string; name: string; arguments: string };
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
      if (!provConfig) continue;
      // Ollama and local providers don't need API keys
      if (providerNeedsApiKey(provConfig.type ?? '') && !provConfig.rawApiKey) continue;

      const firstModel = provConfig.models[0];
      // Resolve model: prefer agent's model_preference, but only if it exists in provider's model list
      // For Ollama (and local providers), validate the requested model is actually installed
      const requestedModel = options.model;
      const availableIds = provConfig.models.map(m => typeof m === 'object' ? m.id : m);
      const resolvedModel = requestedModel && availableIds.includes(requestedModel)
        ? requestedModel
        : (typeof firstModel === 'object' ? firstModel.id : firstModel) ?? '';
      const modelId = resolvedModel;
      const providerType = resolveProviderType(providerId, provConfig.type);
      const baseUrl = resolveProviderBaseUrl(providerId, provConfig.baseUrl);

      // Convert LLMMessage[] to ChatMessage[] preserving tool call data
      const chatMessages: import('../chat-engine.js').ChatMessage[] = messages.map(m => {
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        if (m.role === 'tool') {
          return { role: 'tool' as const, content, tool_call_id: m.tool_call_id ?? (m as unknown as { toolCallId?: string }).toolCallId ?? '', name: m.name };
        }
        // Check for tool_calls on assistant messages
        const tc = (m as unknown as { tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }).tool_calls;
        if (m.role === 'assistant' && tc && tc.length > 0) {
          return { role: 'assistant' as const, content, tool_calls: tc };
        }
        return { role: m.role as 'system' | 'user' | 'assistant', content };
      });

      const chatOptions: import('../chat-engine.js').ChatOptions = {
        model: modelId,
        baseUrl,
        apiKey: provConfig.rawApiKey,
        providerType,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        tools: options.tools,
      };

      // GitHub Copilot: exchange OAuth token for Copilot session token
      if (providerId === 'github-copilot' && chatOptions.apiKey) {
        let copilotExchangeOk = false;
        try {
          const tokenRes = await fetch('https://api.github.com/copilot_internal/v2/token', {
            headers: {
              Authorization: `Bearer ${chatOptions.apiKey}`,
              'Accept': 'application/json',
              'User-Agent': 'HiveClaw/1.0',
            },
            signal: AbortSignal.timeout(10000),
          });
          if (tokenRes.ok) {
            const tokenData = await tokenRes.json() as { token?: string; endpoints?: { api?: string } };
            if (tokenData.token) {
              chatOptions.apiKey = tokenData.token;
              if (tokenData.endpoints?.api) {
                chatOptions.baseUrl = tokenData.endpoints.api;
              }
              console.log(`[copilot] Token exchanged OK, endpoint: ${chatOptions.baseUrl}`);
              // Add required Copilot headers
              chatOptions.extraHeaders = {
                'Editor-Version': 'vscode/1.96.0',
                'Editor-Plugin-Version': 'copilot/1.0.0',
                'Copilot-Integration-Id': 'vscode-chat',
              };
              copilotExchangeOk = true;
            }
          } else {
            console.error(`[copilot] Token exchange failed: ${tokenRes.status} ${await tokenRes.text().catch(() => '')}`);
          }
        } catch (err) {
          console.error(`[copilot] Token exchange error:`, (err as Error).message);
        }

        if (!copilotExchangeOk) {
          logger.warn(`[ProviderRouter] GitHub Copilot token exchange failed — skipping provider. Re-authenticate via Settings > Providers > GitHub Copilot.`);
          continue; // skip to next provider in fallback chain
        }
      }

      console.log(`[provider] Using ${providerId} / ${chatOptions.model} @ ${chatOptions.baseUrl}`);

      // Inject system prompt as first message if provided
      if (options.systemPrompt) {
        chatMessages.unshift({ role: 'system', content: options.systemPrompt });
      }

      try {
        for await (const event of streamChat(chatMessages, chatOptions)) {
          if (event.type === 'delta' && event.content) {
            yield { type: 'text', text: event.content };
          } else if (event.type === 'tool_call' && event.toolCall) {
            yield { type: 'tool_call', toolCall: event.toolCall };
          } else if (event.type === 'done') {
            yield { type: 'finish', finishReason: 'stop', tokensIn: event.tokensIn, tokensOut: event.tokensOut };
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
    router.register({ id: 'anthropic', name: 'Anthropic', models: [] }); // models discovered at runtime via /v1/models
  }

  if (config.openai?.apiKey) {
    router.register({ id: 'openai', name: 'OpenAI', models: [] }); // models discovered at runtime via /v1/models
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
