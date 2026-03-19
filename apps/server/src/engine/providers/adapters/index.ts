/**
 * Engine v2 — Adapter Registry
 *
 * Factory functions to create and retrieve provider adapters.
 * Maps provider IDs/types to the correct adapter class.
 */

import type { ProviderAdapter, AdapterConfig } from './types.js';
import type { ProviderConfig } from '../../../db/providers.js';
import { OpenAIAdapter } from './openai-adapter.js';
import { AnthropicAdapter } from './anthropic-adapter.js';
import { OllamaAdapter } from './ollama-adapter.js';
import { resolveProviderBaseUrl, resolveProviderType } from '../../../config/defaults.js';

// Re-export types and adapters for convenience
export type { ProviderAdapter, AdapterConfig, AdapterOptions, AgentEvent, LLMMessage, ToolDefinition } from './types.js';
export { OpenAIAdapter } from './openai-adapter.js';
export { AnthropicAdapter } from './anthropic-adapter.js';
export { OllamaAdapter } from './ollama-adapter.js';

// ─── In-Memory Adapter Cache ────────────────────────────────────────────────────
// Adapters are stateless per-turn but hold config (API key, baseUrl).
// Cache by providerId to avoid re-creating on every call.

const _adapterCache = new Map<string, ProviderAdapter>();

/**
 * Create a ProviderAdapter from a ProviderConfig (DB record).
 * Determines the correct adapter class based on provider type.
 */
export function createAdapter(
  providerId: string,
  config: ProviderConfig & { rawApiKey?: string },
): ProviderAdapter {
  const providerType = resolveProviderType(providerId, config.type);
  const baseUrl = resolveProviderBaseUrl(providerId, config.baseUrl);
  const apiKey = config.rawApiKey ?? config.apiKey;

  const adapterConfig: AdapterConfig = {
    apiKey,
    baseUrl,
  };

  if (providerType === 'anthropic') {
    return new AnthropicAdapter(providerId, config.name, adapterConfig);
  }

  if (providerId === 'ollama' || config.type === 'ollama') {
    return new OllamaAdapter(providerId, config.name, adapterConfig);
  }

  // Default: OpenAI-compatible (OpenAI, Copilot, OpenRouter, DeepSeek, Groq, Mistral, Google, custom)
  return new OpenAIAdapter(providerId, config.name, adapterConfig);
}

/**
 * Get (or create and cache) an adapter for a provider ID.
 * Requires the ProviderConfig to create on first access.
 */
export function getAdapterForProvider(
  providerId: string,
  config?: ProviderConfig & { rawApiKey?: string },
): ProviderAdapter {
  const cached = _adapterCache.get(providerId);
  if (cached) return cached;

  if (!config) {
    throw new Error(`No adapter cached for provider "${providerId}" and no config provided to create one.`);
  }

  const adapter = createAdapter(providerId, config);
  _adapterCache.set(providerId, adapter);
  return adapter;
}

/**
 * Clear the adapter cache (useful for testing or config changes).
 */
export function clearAdapterCache(): void {
  _adapterCache.clear();
}

/**
 * Remove a specific adapter from the cache (e.g., when API key changes).
 */
export function invalidateAdapter(providerId: string): void {
  _adapterCache.delete(providerId);
}
