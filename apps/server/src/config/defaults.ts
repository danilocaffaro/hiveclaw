/**
 * config/defaults.ts — Single source of truth for all defaults.
 *
 * RULE: No literal URLs, ports, model names, or provider configs
 * anywhere else in the codebase. Import from here.
 */

// ─── Server ─────────────────────────────────────────────────────────────────────

export const DEFAULT_PORT = 4070;
export const DEFAULT_HOST = '0.0.0.0';

// ─── Provider Base URLs ─────────────────────────────────────────────────────────
// Used as fallbacks when the DB record has no `base_url` set.

export const PROVIDER_BASE_URLS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  'github-copilot': 'https://api.githubcopilot.com',
  google: 'https://generativelanguage.googleapis.com',
  ollama: 'http://localhost:11434',
  openrouter: 'https://openrouter.ai/api',
  deepseek: 'https://api.deepseek.com',
  groq: 'https://api.groq.com/openai',
  mistral: 'https://api.mistral.ai',
};

/**
 * Resolve the base URL for a provider.
 * Priority: explicit baseUrl > DB record > PROVIDER_BASE_URLS default > OpenAI-compat fallback
 */
export function resolveProviderBaseUrl(
  providerId: string,
  explicitBaseUrl?: string | null,
): string {
  if (explicitBaseUrl) return explicitBaseUrl;
  return PROVIDER_BASE_URLS[providerId] ?? PROVIDER_BASE_URLS.openai;
}

// ─── Provider Types ─────────────────────────────────────────────────────────────
// Maps provider IDs to their API type (determines streaming protocol)

export const PROVIDER_API_TYPES: Record<string, 'openai' | 'anthropic'> = {
  anthropic: 'anthropic',
  openai: 'openai',
  'github-copilot': 'openai',
  google: 'openai',
  ollama: 'openai',
  openrouter: 'openai',
  deepseek: 'openai',
  groq: 'openai',
  mistral: 'openai',
};

export function resolveProviderType(
  providerId: string,
  explicitType?: string | null,
): 'openai' | 'anthropic' {
  if (explicitType === 'anthropic' || explicitType === 'openai') return explicitType;
  return PROVIDER_API_TYPES[providerId] ?? 'openai';
}

// ─── Providers that don't require an API key ────────────────────────────────────

export const KEYLESS_PROVIDERS = new Set(['ollama', 'local', 'lmstudio']);

export function providerNeedsApiKey(providerType: string): boolean {
  return !KEYLESS_PROVIDERS.has(providerType);
}

// ─── CORS ───────────────────────────────────────────────────────────────────────
// In production, SUPERCLAW_CORS_ORIGINS env var should be set.
// These are ONLY for local development.

export const DEV_CORS_ORIGINS = [
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
];

// ─── Defaults (non-model-specific) ──────────────────────────────────────────────

export const DEFAULT_TEMPERATURE = 0.7;
export const DEFAULT_MAX_TOKENS = 4096;
export const DEFAULT_SYSTEM_PROMPT = 'You are a helpful personal AI assistant. Be concise, direct, and helpful.';

// ─── Tool Limits ────────────────────────────────────────────────────────────────

export const TOOL_LIMITS = {
  MAX_LOG_LINES: 2000,
  MAX_FILE_CHARS: 100_000,
  MAX_WEBFETCH_CHARS: 50_000,
  MAX_GREP_OUTPUT: 50_000,
  MAX_BASH_OUTPUT: 50_000,
  MAX_TOOL_ITERATIONS: 10,
  SMART_COMPACT_TOKENS: 80_000,
};

// ─── System Task Quality Floors ─────────────────────────────────────────────────
// Minimum quality scores for internal system tasks.
// See engine/smart-router.ts QUALITY_FLOORS for authoritative values.
// These are documentation-only — the router owns the canonical values.

export const SYSTEM_TASK_QUALITY_FLOORS = {
  heartbeat: 20,
  greeting: 30,
  chat: 50,
  compaction: 60,
  extraction: 60,
  embedding: 0,
  tool_heavy: 75,
  complex_reasoning: 80,
} as const;
