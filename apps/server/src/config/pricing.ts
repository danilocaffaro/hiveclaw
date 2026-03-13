/**
 * config/pricing.ts — Model pricing data (USD per 1M tokens)
 *
 * Single source of truth for cost estimation.
 * Updated: 2026-03. Sources: official provider pricing pages.
 *
 * Usage:
 *   import { MODEL_PRICING, getModelPricing } from './config/pricing.js';
 *   const p = getModelPricing('openai', 'gpt-4o');
 *   const cost = (tokensIn * p.in + tokensOut * p.out) / 1_000_000;
 */

export interface ModelPricing {
  /** Cost per 1M input tokens (USD) */
  in: number;
  /** Cost per 1M output tokens (USD) */
  out: number;
}

/**
 * Pricing per 1M tokens (USD) keyed by model ID.
 * Add new models here as providers release them.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // ── Anthropic ──────────────────────────────────────────────────────────
  'claude-opus-4-6':                { in: 15.0,  out: 75.0  },
  'claude-opus-4-6-20250725':       { in: 15.0,  out: 75.0  },
  'claude-opus-4-5':                { in: 15.0,  out: 75.0  },
  'claude-opus-4':                  { in: 15.0,  out: 75.0  },
  'claude-opus-4.6':                { in: 15.0,  out: 75.0  },
  'claude-sonnet-4-6':              { in: 3.0,   out: 15.0  },
  'claude-sonnet-4-6-20250725':     { in: 3.0,   out: 15.0  },
  'claude-sonnet-4-5':              { in: 3.0,   out: 15.0  },
  'claude-sonnet-4-5-20250514':     { in: 3.0,   out: 15.0  },
  'claude-sonnet-4':                { in: 3.0,   out: 15.0  },
  'claude-sonnet-4.6':              { in: 3.0,   out: 15.0  },
  'claude-haiku-4-5':               { in: 0.8,   out: 4.0   },
  'claude-haiku-4-5-20250514':      { in: 0.8,   out: 4.0   },
  'claude-3-5-sonnet':              { in: 3.0,   out: 15.0  },
  'claude-3-5-sonnet-20241022':     { in: 3.0,   out: 15.0  },
  'claude-3-5-haiku':               { in: 0.8,   out: 4.0   },
  'claude-3-5-haiku-20241022':      { in: 0.8,   out: 4.0   },
  'claude-3-opus':                  { in: 15.0,  out: 75.0  },

  // ── OpenAI ─────────────────────────────────────────────────────────────
  'gpt-4o':                         { in: 2.5,   out: 10.0  },
  'gpt-4o-2024-11-20':              { in: 2.5,   out: 10.0  },
  'gpt-4o-mini':                    { in: 0.15,  out: 0.6   },
  'gpt-4-turbo':                    { in: 10.0,  out: 30.0  },
  'gpt-4':                          { in: 30.0,  out: 60.0  },
  'gpt-3.5-turbo':                  { in: 0.5,   out: 1.5   },
  'o1':                             { in: 15.0,  out: 60.0  },
  'o1-mini':                        { in: 3.0,   out: 12.0  },
  'o1-pro':                         { in: 150.0, out: 600.0 },
  'o3':                             { in: 10.0,  out: 40.0  },
  'o3-mini':                        { in: 1.1,   out: 4.4   },
  'o4-mini':                        { in: 1.1,   out: 4.4   },

  // ── Google ─────────────────────────────────────────────────────────────
  'gemini-2.5-pro':                 { in: 1.25,  out: 10.0  },
  'gemini-2.5-flash':               { in: 0.15,  out: 0.6   },
  'gemini-2.0-flash':               { in: 0.1,   out: 0.4   },
  'gemini-1.5-pro':                 { in: 1.25,  out: 5.0   },
  'gemini-1.5-flash':               { in: 0.075, out: 0.3   },

  // ── DeepSeek ───────────────────────────────────────────────────────────
  'deepseek-chat':                  { in: 0.27,  out: 1.1   },
  'deepseek-reasoner':              { in: 0.55,  out: 2.19  },

  // ── Groq ───────────────────────────────────────────────────────────────
  'llama-3.3-70b':                  { in: 0.59,  out: 0.79  },
  'llama-3.1-8b':                   { in: 0.05,  out: 0.08  },
  'mixtral-8x7b':                   { in: 0.24,  out: 0.24  },

  // ── Mistral ────────────────────────────────────────────────────────────
  'mistral-large':                  { in: 2.0,   out: 6.0   },
  'mistral-small':                  { in: 0.2,   out: 0.6   },
  'codestral':                      { in: 0.3,   out: 0.9   },

  // ── Local / Free ───────────────────────────────────────────────────────
  'ollama':                         { in: 0,     out: 0     },
  'github-copilot':                 { in: 0,     out: 0     },
};

/** Provider-level fallback pricing when model isn't in the table */
export const PROVIDER_FALLBACK_PRICING: Record<string, ModelPricing> = {
  'anthropic':        { in: 3.0,  out: 15.0  },
  'claude':           { in: 3.0,  out: 15.0  },
  'openai':           { in: 2.5,  out: 10.0  },
  'google':           { in: 1.25, out: 5.0   },
  'google-ai':        { in: 1.25, out: 5.0   },
  'deepseek':         { in: 0.27, out: 1.1   },
  'groq':             { in: 0.59, out: 0.79  },
  'mistral':          { in: 2.0,  out: 6.0   },
  'ollama':           { in: 0,    out: 0     },
  'github-copilot':   { in: 0,    out: 0     },
};

/** Default pricing when nothing matches */
export const DEFAULT_PRICING: ModelPricing = { in: 3.0, out: 15.0 };

/**
 * Get pricing for a model with fuzzy matching and provider fallback.
 */
export function getModelPricing(providerId: string, modelId: string): ModelPricing {
  // Exact match
  if (MODEL_PRICING[modelId]) return MODEL_PRICING[modelId];

  // Fuzzy: substring match
  const modelLower = modelId.toLowerCase();
  for (const [key, val] of Object.entries(MODEL_PRICING)) {
    if (modelLower.includes(key.toLowerCase()) || key.toLowerCase().includes(modelLower)) {
      return val;
    }
  }

  // Provider fallback
  const provLower = providerId.toLowerCase();
  for (const [key, val] of Object.entries(PROVIDER_FALLBACK_PRICING)) {
    if (provLower.includes(key)) return val;
  }

  return DEFAULT_PRICING;
}

/**
 * Estimate cost in USD for a given token usage.
 */
export function estimateTokenCost(
  providerId: string,
  modelId: string,
  tokensIn: number,
  tokensOut: number,
): number {
  const pricing = getModelPricing(providerId, modelId);
  return (tokensIn * pricing.in + tokensOut * pricing.out) / 1_000_000;
}
