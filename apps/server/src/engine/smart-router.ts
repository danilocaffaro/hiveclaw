/**
 * engine/smart-router.ts — Quality-aware model routing (simplified)
 *
 * 3 buckets: cheap / standard / premium
 * Each bucket has a quality floor.
 * Router picks cheapest model that meets the floor.
 * If nothing qualifies → best available + warning.
 *
 * Classification: 3 rules, no NLP, no ML.
 *   1. heartbeat/cron → cheap
 *   2. complex patterns (2+ regex matches) → premium
 *   3. everything else → standard
 */

import { ProviderRepository } from '../db/index.js';
import { getModelPricing } from '../config/pricing.js';
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
  qualityWarning?: string;
}

// ─── Quality Floors ─────────────────────────────────────────────────────────────

export const QUALITY_FLOORS: Record<ModelTier, number> = {
  cheap: 20,
  standard: 50,
  premium: 80,
};

// Also export as SystemTask for backward compat with memory subsystem
export type SystemTask =
  | 'chat' | 'heartbeat' | 'greeting' | 'compaction'
  | 'extraction' | 'embedding' | 'tool_heavy' | 'complex_reasoning';

// Map system tasks to tiers (the only thing callers need)
export const TASK_TO_TIER: Record<SystemTask, ModelTier> = {
  heartbeat: 'cheap',
  greeting: 'cheap',
  chat: 'standard',
  compaction: 'standard',
  extraction: 'standard',
  embedding: 'cheap',
  tool_heavy: 'premium',
  complex_reasoning: 'premium',
};

// ─── Classification (3 rules) ───────────────────────────────────────────────────

export interface RoutingContext {
  userMessage: string;
  historyLength: number;
  totalContextTokens?: number;
  isHeartbeat?: boolean;
  isCron?: boolean;
  hasToolUse?: boolean;
  agentTier?: ModelTier;
  systemTask?: SystemTask;
}

const COMPLEX_PATTERNS = [
  /\b(analyze|analyse|compare|evaluate|architect|design|refactor|debug)\b/i,
  /\b(step[ -]by[ -]step|break down|explain in detail|deep dive)\b/i,
  /\b(pros and cons|trade-?offs|alternatives|implications)\b/i,
  /\b(implement|build|create|develop)\b.*\b(system|engine|framework|architecture)\b/i,
  /\b(review|audit|security|vulnerability|performance)\b/i,
];

/**
 * Classify into 3 buckets. That's it.
 */
export function classifyComplexity(ctx: RoutingContext): { tier: ModelTier; reason: string } {
  // Agent override
  if (ctx.agentTier) {
    return { tier: ctx.agentTier, reason: `Agent configured for ${ctx.agentTier} tier` };
  }

  // Explicit system task
  if (ctx.systemTask) {
    return { tier: TASK_TO_TIER[ctx.systemTask], reason: `System task: ${ctx.systemTask}` };
  }

  // Rule 1: heartbeat/cron → cheap
  if (ctx.isHeartbeat || ctx.isCron) {
    return { tier: 'cheap', reason: 'Heartbeat/cron' };
  }

  // Rule 2: complex → premium
  const complexHits = COMPLEX_PATTERNS.filter(p => p.test(ctx.userMessage)).length;
  if (complexHits >= 2) {
    return { tier: 'premium', reason: `Complex task (${complexHits} indicators)` };
  }
  if ((ctx.totalContextTokens ?? 0) > 80_000) {
    return { tier: 'premium', reason: 'Large context' };
  }

  // Rule 3: everything else → standard
  return { tier: 'standard', reason: 'General' };
}

// Backward-compat alias
export function classifyTask(ctx: RoutingContext): { task: SystemTask; reason: string } {
  if (ctx.systemTask) return { task: ctx.systemTask, reason: `Explicit: ${ctx.systemTask}` };
  if (ctx.isHeartbeat || ctx.isCron) return { task: 'heartbeat', reason: 'Heartbeat/cron' };
  const { tier, reason } = classifyComplexity(ctx);
  const taskMap: Record<ModelTier, SystemTask> = { cheap: 'heartbeat', standard: 'chat', premium: 'complex_reasoning' };
  return { task: taskMap[tier], reason };
}

// ─── Quality Scores (0-100) ─────────────────────────────────────────────────────

const MODEL_QUALITY: Record<string, number> = {
  // Anthropic
  'claude-opus-4-6': 96, 'claude-opus-4-5': 95, 'claude-opus-4-5-20251101': 95,
  'claude-opus-4': 95, 'claude-opus-4.6': 95, 'claude-3-opus': 92,
  'claude-sonnet-4-6': 90, 'claude-sonnet-4-5': 88, 'claude-sonnet-4-5-20250929': 88,
  'claude-sonnet-4': 88, 'claude-sonnet-4.6': 88, 'claude-3-5-sonnet': 87,
  'claude-haiku-4-5': 68, 'claude-haiku-4-5-20251001': 68, 'claude-3-5-haiku': 68,
  // OpenAI
  'gpt-4o': 90, 'gpt-4-turbo': 88, 'gpt-4': 85,
  'o1': 93, 'o1-pro': 95, 'o1-mini': 75, 'o3': 95, 'o3-mini': 78, 'o4-mini': 78,
  'gpt-4o-mini': 72, 'gpt-3.5-turbo': 45,
  // Google
  'gemini-2.5-pro': 92, 'gemini-2.5-flash': 75, 'gemini-2.0-flash': 65,
  'gemini-1.5-pro': 85, 'gemini-1.5-flash': 60,
  // DeepSeek
  'deepseek-chat': 70, 'deepseek-reasoner': 85,
  // Groq / Open
  'llama-3.3-70b': 78, 'llama-3.1-70b': 75, 'llama-3.1-8b': 45, 'mixtral-8x7b': 55,
  // Mistral
  'mistral-large': 82, 'mistral-small': 55, 'codestral': 70,
  // Local (Ollama)
  'qwen2.5:72b': 78, 'qwen2.5:32b': 68, 'qwen2.5:14b': 55, 'qwen2.5:7b': 42,
  'qwen3:8b': 50, 'qwen3:32b': 72,
  'llama3.1:8b': 45, 'llama3.1:70b': 75, 'llama3.2:3b': 30, 'llama3.3:70b': 78,
  'deepseek-r1:32b': 72, 'deepseek-r1:14b': 58, 'deepseek-r1:8b': 42,
  'phi3:14b': 55, 'phi3:3.8b': 35,
  'gemma2:27b': 65, 'gemma2:9b': 48, 'gemma2:2b': 28,
  'mistral:7b': 42, 'mixtral:8x7b': 55,
  'codellama:34b': 60, 'codellama:7b': 38,
};

/**
 * Get quality score for a model.
 * Exact match → fuzzy match → infer from pricing.
 */
export function getModelQuality(providerId: string, modelId: string): number {
  // Exact
  if (MODEL_QUALITY[modelId] !== undefined) return MODEL_QUALITY[modelId];

  // Fuzzy
  const lo = modelId.toLowerCase();
  for (const [key, score] of Object.entries(MODEL_QUALITY)) {
    const klo = key.toLowerCase();
    if (lo.includes(klo) || klo.includes(lo)) return score;
  }

  // Infer from pricing
  const pricing = getModelPricing(providerId, modelId);
  const avg = (pricing.in + pricing.out) / 2;
  if (avg === 0) return 40;
  if (avg < 0.5) return 55;
  if (avg < 2) return 65;
  if (avg < 5) return 80;
  if (avg < 15) return 88;
  return 92;
}

export function qualityToTier(quality: number): ModelTier {
  if (quality >= 80) return 'premium';
  if (quality >= 55) return 'standard';
  return 'cheap';
}

// ─── Model Selection ────────────────────────────────────────────────────────────

interface ScoredModel {
  providerId: string;
  modelId: string;
  quality: number;
  costPer1M: number;
}

function buildModelInventory(providers: ProviderRepository): ScoredModel[] {
  const models: ScoredModel[] = [];
  for (const provider of providers.list()) {
    if (!provider.enabled) continue;
    for (const model of provider.models) {
      const modelId = typeof model === 'string' ? model : model.id;
      const quality = getModelQuality(provider.id, modelId);
      const pricing = getModelPricing(provider.id, modelId);
      models.push({ providerId: provider.id, modelId, quality, costPer1M: (pricing.in + pricing.out) / 2 });
    }
  }
  return models;
}

export interface QualityRoutingResult {
  providerId: string;
  modelId: string;
  quality: number;
  costPer1M: number;
  meetsFloor: boolean;
  qualityWarning?: string;
}

/**
 * Pick cheapest model that meets quality floor for a tier.
 * If none qualifies → best available + warning.
 */
export function selectModelForTier(
  tier: ModelTier,
  providers: ProviderRepository,
): QualityRoutingResult | null {
  const floor = QUALITY_FLOORS[tier];
  const inventory = buildModelInventory(providers);
  if (inventory.length === 0) return null;

  const qualified = inventory.filter(m => m.quality >= floor);

  if (qualified.length > 0) {
    qualified.sort((a, b) => a.costPer1M - b.costPer1M || b.quality - a.quality);
    const pick = qualified[0];
    return { ...pick, meetsFloor: true };
  }

  // Nothing meets floor → best available + warning
  inventory.sort((a, b) => b.quality - a.quality);
  const best = inventory[0];
  const warning = `⚠️ Quality warning: "${tier}" tier requires quality ≥${floor}, ` +
    `but best available "${best.modelId}" scores ${best.quality}. ` +
    `Consider adding a more capable model.`;
  logger.warn('[SmartRouter] %s', warning);
  return { ...best, meetsFloor: false, qualityWarning: warning };
}

// Backward compat alias
export function selectModelForTask(
  task: SystemTask,
  providers: ProviderRepository,
): QualityRoutingResult | null {
  return selectModelForTier(TASK_TO_TIER[task], providers);
}

export function getSystemModel(
  task: SystemTask,
  providers: ProviderRepository,
): QualityRoutingResult | null {
  return selectModelForTask(task, providers);
}

// ─── Tier Config ────────────────────────────────────────────────────────────────

export function buildTierConfig(providers: ProviderRepository): TierConfig {
  const config: TierConfig = { cheap: null, standard: null, premium: null };
  const inventory = buildModelInventory(providers);
  const sorted = [...inventory].sort((a, b) => a.quality - b.quality);

  for (const model of sorted) {
    const tier = qualityToTier(model.quality);
    if (!config[tier]) {
      config[tier] = { providerId: model.providerId, modelId: model.modelId };
    }
  }

  if (!config.standard) config.standard = config.premium ?? config.cheap;
  return config;
}

// ─── Route ──────────────────────────────────────────────────────────────────────

export function routeToModel(
  ctx: RoutingContext,
  tierConfig: TierConfig,
  fallbackProvider: string,
  fallbackModel: string,
  providers?: ProviderRepository,
): RoutingDecision {
  const { tier, reason } = classifyComplexity(ctx);

  // Quality-aware path
  if (providers) {
    const result = selectModelForTier(tier, providers);
    if (result) {
      return {
        tier,
        providerId: result.providerId,
        modelId: result.modelId,
        reason: `${reason} → q${result.quality}${result.meetsFloor ? '' : ' [BELOW FLOOR]'}`,
        qualityWarning: result.qualityWarning,
      };
    }
  }

  // Tier config fallback
  if (tierConfig[tier]) {
    return { tier, ...tierConfig[tier]!, reason };
  }

  const fallbackOrder: ModelTier[] =
    tier === 'cheap' ? ['standard', 'premium'] :
    tier === 'premium' ? ['standard', 'cheap'] :
    ['premium', 'cheap'];

  for (const fb of fallbackOrder) {
    if (tierConfig[fb]) {
      return { tier: fb, ...tierConfig[fb]!, reason: `${reason} (wanted ${tier}, using ${fb})` };
    }
  }

  return { tier, providerId: fallbackProvider, modelId: fallbackModel, reason: `${reason} (agent default)` };
}
