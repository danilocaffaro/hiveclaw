/**
 * Provider Router — thin layer over native chat-engine.ts
 *
 * In HiveClaw, all LLM communication goes through chat-engine.ts
 * which uses native fetch(). This file provides backward-compatible
 * interfaces for code that references ProviderRouter.
 *
 * R20.1: Copilot token cache, unified naming, structured logging
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

// ─── R20.1a: Copilot Token Cache ────────────────────────────────────────────────
// Caches the exchanged Copilot session token in-memory with expiry tracking.
// Avoids redundant token exchanges on every iteration of the agentic loop.
// OpenClaw caches to disk + checks 5min before expiry; we cache in-memory (simpler,
// same process lifetime, no disk I/O).
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

// ─── R20.2a: Retry with Exponential Backoff ─────────────────────────────────────
// Transient errors (429, 503, network) should retry on the SAME provider before
// falling through to the next one. OpenClaw has configurable retry with jitter.
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 529]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 15000;

function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  // Network errors
  if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|UND_ERR_SOCKET|fetch failed|network/i.test(msg)) return true;
  // HTTP status codes embedded in error messages
  for (const code of RETRYABLE_STATUS_CODES) {
    if (msg.includes(String(code))) return true;
  }
  return false;
}

function retryDelay(attempt: number): number {
  // Exponential backoff with jitter: base * 2^attempt * (0.5-1.0 random)
  const exponential = BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = 0.5 + Math.random() * 0.5;
  return Math.min(exponential * jitter, MAX_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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
          return { role: 'tool' as const, content, tool_call_id: m.tool_call_id ?? '', name: m.name };
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

      // R20.1a: GitHub Copilot — exchange OAuth token for Copilot session token (CACHED)
      // Previously did a fresh exchange on EVERY chatWithFallback call (= every loop iteration).
      // Now caches in-memory with 5min pre-expiry margin, matching OpenClaw's approach.
      if (providerId === 'github-copilot' && chatOptions.apiKey) {
        const oauthKey = chatOptions.apiKey;
        const cached = getCachedCopilotToken(oauthKey);

        if (cached) {
          // Cache hit — reuse token
          chatOptions.apiKey = cached.token;
          chatOptions.baseUrl = cached.baseUrl;
          chatOptions.extraHeaders = {
            'Editor-Version': 'vscode/1.96.0',
            'Editor-Plugin-Version': 'copilot/1.0.0',
            'Copilot-Integration-Id': 'vscode-chat',
          };
          logger.debug(`[ProviderRouter] Copilot token cache hit (expires in ${Math.round((cached.expiresAt - Date.now()) / 1000)}s)`);
        } else {
          // Cache miss — exchange token
          let copilotExchangeOk = false;
          try {
            const tokenRes = await fetch('https://api.github.com/copilot_internal/v2/token', {
              headers: {
                Authorization: `Bearer ${oauthKey}`,
                'Accept': 'application/json',
                'User-Agent': 'HiveClaw/1.1',
              },
              signal: AbortSignal.timeout(10000),
            });
            if (tokenRes.ok) {
              const tokenData = await tokenRes.json() as { token?: string; expires_at?: number; endpoints?: { api?: string } };
              if (tokenData.token) {
                const resolvedBase = tokenData.endpoints?.api ?? chatOptions.baseUrl;
                // Parse expiry — Copilot returns unix epoch (seconds or ms)
                let expiresAt = Date.now() + 30 * 60 * 1000; // default 30min
                if (tokenData.expires_at) {
                  expiresAt = tokenData.expires_at > 1e12 ? tokenData.expires_at : tokenData.expires_at * 1000;
                }
                // Cache the token
                setCopilotTokenCache(oauthKey, tokenData.token, resolvedBase, expiresAt);
                chatOptions.apiKey = tokenData.token;
                chatOptions.baseUrl = resolvedBase;
                chatOptions.extraHeaders = {
                  'Editor-Version': 'vscode/1.96.0',
                  'Editor-Plugin-Version': 'copilot/1.0.0',
                  'Copilot-Integration-Id': 'vscode-chat',
                };
                logger.info(`[ProviderRouter] Copilot token exchanged OK, endpoint: ${resolvedBase}, expires in ${Math.round((expiresAt - Date.now()) / 1000)}s`);
                copilotExchangeOk = true;
              }
            } else {
              logger.error(`[ProviderRouter] Copilot token exchange failed: ${tokenRes.status} ${await tokenRes.text().catch(() => '')}`);
            }
          } catch (err) {
            logger.error(`[ProviderRouter] Copilot token exchange error: ${(err as Error).message}`);
          }

          if (!copilotExchangeOk) {
            // Invalidate any stale cache
            _copilotTokenCache = null;
            logger.warn(`[ProviderRouter] GitHub Copilot token exchange failed — skipping provider. Re-authenticate via Settings > Providers > GitHub Copilot.`);
            continue; // skip to next provider in fallback chain
          }
        }
      }

      logger.debug(`[ProviderRouter] Using ${providerId} / ${chatOptions.model} @ ${chatOptions.baseUrl}`);

      // Inject system prompt as first message if provided
      if (options.systemPrompt) {
        chatMessages.unshift({ role: 'system', content: options.systemPrompt });
      }

      // R20.2a: Retry with exponential backoff for transient errors
      let lastErr: Error | null = null;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          const delay = retryDelay(attempt - 1);
          logger.warn(`[ProviderRouter] Retry ${attempt}/${MAX_RETRIES} for ${providerId} in ${Math.round(delay)}ms`);
          await sleep(delay);
          // On retry for Copilot, invalidate token cache in case it expired
          if (providerId === 'github-copilot') {
            _copilotTokenCache = null;
          }
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
          return; // success — exit both retry loop and provider loop
        } catch (err) {
          lastErr = err as Error;
          if (attempt < MAX_RETRIES && isRetryableError(err)) {
            continue; // retry same provider
          }
          break; // non-retryable or max retries exhausted
        }
      }
      logger.warn(`[ProviderRouter] Provider ${providerId} failed after ${MAX_RETRIES + 1} attempts: ${lastErr?.message} — trying next`);
      continue;
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
