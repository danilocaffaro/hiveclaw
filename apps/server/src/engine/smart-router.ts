/**
 * engine/smart-router.ts — 3-tier automatic model routing
 *
 * Routes tasks to cheap/standard/premium models based on:
 * 1. Task complexity heuristics (message length, context, tool use)
 * 2. Cost-awareness (cron/heartbeat always use cheap tier)
 * 3. User-configurable tier assignments
 *
 * Tiers:
 *   CHEAP    — simple lookups, cron, heartbeats, short Q&A
 *   STANDARD — general chat, moderate tool use, coding
 *   PREMIUM  — complex reasoning, multi-step, long context
 */

import { ProviderRepository } from '../db/index.js';
import { logger } from '../lib/logger.js';

// ─── Types ──────────────────────────────────────────────────────────────────────

export type ModelTier = 'cheap' | 'standard' | 'premium';

export interface TierConfig {
  cheap: { providerId: string; modelId: string } | null;
  standard: { providerId: string; modelId: string } | null;
  premium: { providerId: string; modelId: string } | null;
}

export interface RoutingDecision {
  tier: ModelTier;
  providerId: string;
  modelId: string;
  reason: string;
}

// ─── Complexity Heuristics ──────────────────────────────────────────────────────

interface RoutingContext {
  userMessage: string;
  historyLength: number;       // number of messages in session
  totalContextTokens?: number; // estimated tokens in context
  isHeartbeat?: boolean;       // heartbeat/cron task
  isCron?: boolean;            // scheduled task
  hasToolUse?: boolean;        // previous messages used tools
  agentTier?: ModelTier;       // agent-level override
}

/**
 * Classify task complexity into a tier.
 */
export function classifyComplexity(ctx: RoutingContext): { tier: ModelTier; reason: string } {
  // ── Override: agent-level fixed tier ───────────────────────────────────
  if (ctx.agentTier) {
    return { tier: ctx.agentTier, reason: `Agent configured for ${ctx.agentTier} tier` };
  }

  // ── Always cheap: heartbeats and cron ────────────────────────────────
  if (ctx.isHeartbeat || ctx.isCron) {
    return { tier: 'cheap', reason: 'Heartbeat/cron task — always uses cheap tier' };
  }

  const msgLen = ctx.userMessage.length;
  const histLen = ctx.historyLength;
  const contextTokens = ctx.totalContextTokens ?? 0;

  // ── Cheap tier indicators ─────────────────────────────────────────────
  // Short messages, no history, no complex patterns
  if (msgLen < 100 && histLen <= 2 && !ctx.hasToolUse) {
    return { tier: 'cheap', reason: 'Short message, minimal context, no tools' };
  }

  // Simple greetings / small talk
  const simplePatterns = /^(hi|hello|hey|thanks|ok|yes|no|sure|good|great|fine)\b/i;
  if (simplePatterns.test(ctx.userMessage.trim()) && msgLen < 50) {
    return { tier: 'cheap', reason: 'Simple greeting/acknowledgment' };
  }

  // ── Premium tier indicators ───────────────────────────────────────────
  // Long context (>80K tokens estimated)
  if (contextTokens > 80_000) {
    return { tier: 'premium', reason: `Large context window (${contextTokens} tokens)` };
  }

  // Complex reasoning patterns
  const complexPatterns = [
    /\b(analyze|analyse|compare|evaluate|architect|design|refactor|debug)\b/i,
    /\b(step[ -]by[ -]step|break down|explain in detail|deep dive)\b/i,
    /\b(pros and cons|trade-?offs|alternatives|implications)\b/i,
    /\b(implement|build|create|develop)\b.*\b(system|engine|framework|architecture)\b/i,
    /\b(review|audit|security|vulnerability|performance)\b/i,
  ];

  const complexMatchCount = complexPatterns.filter((p) => p.test(ctx.userMessage)).length;
  if (complexMatchCount >= 2) {
    return { tier: 'premium', reason: `Complex reasoning task (${complexMatchCount} complexity indicators)` };
  }

  // Long message + heavy history
  if (msgLen > 2000 && histLen > 20) {
    return { tier: 'premium', reason: 'Long message with extensive history' };
  }

  // Multi-tool sessions
  if (ctx.hasToolUse && histLen > 10 && msgLen > 500) {
    return { tier: 'premium', reason: 'Active tool-use session with significant context' };
  }

  // ── Standard tier: everything else ────────────────────────────────────
  return { tier: 'standard', reason: 'General task — standard tier' };
}

// ─── Model Tier Resolution ──────────────────────────────────────────────────────

// Known model cost tiers (lowercase matching)
const CHEAP_MODELS = [
  'gpt-4o-mini', 'gpt-3.5-turbo', 'o3-mini', 'o4-mini',
  'claude-haiku', 'haiku',
  'gemini-flash', 'gemini-2.0-flash', 'gemini-2.5-flash',
  'deepseek-chat', 'llama-3.1-8b', 'mixtral',
  'qwen', 'phi',
];

const PREMIUM_MODELS = [
  'gpt-4o', 'gpt-4-turbo', 'gpt-4', 'o1', 'o1-pro', 'o3',
  'claude-opus', 'claude-sonnet-4', 'claude-3-5-sonnet',
  'gemini-2.5-pro', 'gemini-1.5-pro',
  'deepseek-reasoner',
  'mistral-large',
];

function modelMatchesTier(modelId: string, tier: ModelTier): boolean {
  const modelLower = modelId.toLowerCase();
  if (tier === 'cheap') {
    return CHEAP_MODELS.some((m) => modelLower.includes(m));
  }
  if (tier === 'premium') {
    return PREMIUM_MODELS.some((m) => modelLower.includes(m));
  }
  // Standard = neither cheap nor premium
  return !CHEAP_MODELS.some((m) => modelLower.includes(m)) &&
         !PREMIUM_MODELS.some((m) => modelLower.includes(m));
}

/**
 * Build tier configuration from available providers.
 * Scans all enabled providers and their models to find the best match for each tier.
 */
export function buildTierConfig(providers: ProviderRepository): TierConfig {
  const config: TierConfig = { cheap: null, standard: null, premium: null };

  for (const provider of providers.list()) {
    if (!provider.enabled) continue;
    for (const model of provider.models) {
      const modelId = typeof model === 'string' ? model : model.id;
      for (const tier of ['cheap', 'standard', 'premium'] as ModelTier[]) {
        if (!config[tier] && modelMatchesTier(modelId, tier)) {
          config[tier] = { providerId: provider.id, modelId };
        }
      }
    }
  }

  return config;
}

/**
 * Route a request to the best model for the task.
 * Falls back gracefully: if the ideal tier isn't available, uses the nearest one.
 */
export function routeToModel(
  ctx: RoutingContext,
  tierConfig: TierConfig,
  fallbackProvider: string,
  fallbackModel: string,
): RoutingDecision {
  const { tier, reason } = classifyComplexity(ctx);

  // Try exact tier
  if (tierConfig[tier]) {
    return { tier, ...tierConfig[tier]!, reason };
  }

  // Fallback chain: cheap→standard→premium or premium→standard→cheap
  const fallbackOrder: ModelTier[] =
    tier === 'cheap' ? ['standard', 'premium'] :
    tier === 'premium' ? ['standard', 'cheap'] :
    ['premium', 'cheap'];

  for (const fallbackTier of fallbackOrder) {
    if (tierConfig[fallbackTier]) {
      return {
        tier: fallbackTier,
        ...tierConfig[fallbackTier]!,
        reason: `${reason} (wanted ${tier}, fell back to ${fallbackTier})`,
      };
    }
  }

  // Ultimate fallback: use agent's configured model
  return {
    tier,
    providerId: fallbackProvider,
    modelId: fallbackModel,
    reason: `${reason} (no tier models available, using agent default)`,
  };
}
