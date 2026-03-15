/**
 * engine/token-monitor.ts — Real-time token monitoring for context window
 *
 * Sprint 80: Eidetic Memory v2
 * Monitors token usage in real-time and emits threshold events:
 *   70% → intensive extraction begins
 *   85% → fidelity check (verify everything was extracted)
 *   90% → session rotation trigger
 *
 * Uses character-based estimation (chars/4) for speed,
 * with optional tiktoken for precision when available.
 *
 * Design: stateless per-call estimation. No timers, no side effects.
 */

import { logger } from '../lib/logger.js';

// ─── Model Context Limits ───────────────────────────────────────────────────

/** Known context window sizes by model pattern */
const MODEL_LIMITS: Array<{ pattern: RegExp; maxTokens: number }> = [
  // Claude models
  { pattern: /claude-opus-4/i,        maxTokens: 200_000 },
  { pattern: /claude-sonnet-4/i,      maxTokens: 200_000 },
  { pattern: /claude-3-5/i,           maxTokens: 200_000 },
  { pattern: /claude-3/i,             maxTokens: 200_000 },
  { pattern: /claude/i,               maxTokens: 100_000 },
  // OpenAI models
  { pattern: /gpt-4o/i,               maxTokens: 128_000 },
  { pattern: /gpt-4-turbo/i,          maxTokens: 128_000 },
  { pattern: /gpt-4/i,                maxTokens: 8_192 },
  { pattern: /gpt-3\.5/i,             maxTokens: 16_385 },
  { pattern: /o1/i,                   maxTokens: 200_000 },
  { pattern: /o3/i,                   maxTokens: 200_000 },
  // Google models
  { pattern: /gemini-2/i,             maxTokens: 1_000_000 },
  { pattern: /gemini-1\.5-pro/i,      maxTokens: 1_000_000 },
  { pattern: /gemini-1\.5-flash/i,    maxTokens: 1_000_000 },
  { pattern: /gemini/i,               maxTokens: 32_000 },
  // Ollama / local
  { pattern: /llama/i,                maxTokens: 8_192 },
  { pattern: /mistral/i,              maxTokens: 32_000 },
  { pattern: /qwen/i,                 maxTokens: 32_000 },
  { pattern: /deepseek/i,             maxTokens: 64_000 },
];

/** Fallback if model not recognized */
const DEFAULT_MAX_TOKENS = 32_000;

// ─── Threshold Configuration ────────────────────────────────────────────────

export interface ThresholdConfig {
  /** Start intensive extraction (default: 0.70) */
  extractionThreshold: number;
  /** Verify extraction completeness (default: 0.85) */
  fidelityThreshold: number;
  /** Trigger session rotation (default: 0.90) */
  rotationThreshold: number;
}

const DEFAULT_THRESHOLDS: ThresholdConfig = {
  extractionThreshold: 0.70,
  fidelityThreshold: 0.85,
  rotationThreshold: 0.90,
};

// ─── Types ──────────────────────────────────────────────────────────────────

export type ThresholdLevel = 'normal' | 'extraction' | 'fidelity' | 'rotation';

export interface TokenStatus {
  /** Estimated tokens in current context */
  currentTokens: number;
  /** Maximum tokens for this model */
  maxTokens: number;
  /** Usage ratio (0.0 - 1.0) */
  ratio: number;
  /** Current threshold level */
  level: ThresholdLevel;
  /** Human-readable status */
  message: string;
  /** Whether action is needed */
  actionRequired: boolean;
  /** Specific action recommended */
  recommendedAction: 'none' | 'extract' | 'verify' | 'rotate';
}

export interface MessageForEstimation {
  role: string;
  content: string;
  tool_name?: string;
  tool_input?: string;
  tool_result?: string;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Get the context window limit for a given model.
 */
export function getModelLimit(modelId: string): number {
  for (const { pattern, maxTokens } of MODEL_LIMITS) {
    if (pattern.test(modelId)) return maxTokens;
  }
  logger.debug('[TokenMonitor] Unknown model %s, using default %d', modelId, DEFAULT_MAX_TOKENS);
  return DEFAULT_MAX_TOKENS;
}

/**
 * Estimate token count for a single message.
 * Uses chars/4 heuristic — fast and reasonably accurate for English/Portuguese.
 */
export function estimateMessageTokens(msg: MessageForEstimation): number {
  let chars = 0;
  // Main content
  if (msg.content) chars += msg.content.length;
  // Tool metadata (often large)
  if (msg.tool_input) chars += msg.tool_input.length;
  if (msg.tool_result) chars += msg.tool_result.length;
  // Role + formatting overhead (~4 tokens per message)
  return Math.ceil(chars / 4) + 4;
}

/**
 * Estimate total tokens for an array of messages.
 */
export function estimateTotalTokens(messages: MessageForEstimation[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateMessageTokens(msg);
  }
  // System prompt overhead (~500 tokens typical)
  total += 500;
  return total;
}

/**
 * Check token status against model limits and thresholds.
 * This is the main entry point — call after each message.
 */
export function checkTokenStatus(
  messages: MessageForEstimation[],
  modelId: string,
  thresholds: ThresholdConfig = DEFAULT_THRESHOLDS,
): TokenStatus {
  const currentTokens = estimateTotalTokens(messages);
  const maxTokens = getModelLimit(modelId);
  const ratio = currentTokens / maxTokens;

  let level: ThresholdLevel = 'normal';
  let message = '';
  let actionRequired = false;
  let recommendedAction: TokenStatus['recommendedAction'] = 'none';

  if (ratio >= thresholds.rotationThreshold) {
    level = 'rotation';
    message = `Context at ${(ratio * 100).toFixed(0)}% — session rotation required`;
    actionRequired = true;
    recommendedAction = 'rotate';
  } else if (ratio >= thresholds.fidelityThreshold) {
    level = 'fidelity';
    message = `Context at ${(ratio * 100).toFixed(0)}% — verifying extraction completeness`;
    actionRequired = true;
    recommendedAction = 'verify';
  } else if (ratio >= thresholds.extractionThreshold) {
    level = 'extraction';
    message = `Context at ${(ratio * 100).toFixed(0)}% — intensive extraction starting`;
    actionRequired = true;
    recommendedAction = 'extract';
  } else {
    message = `Context at ${(ratio * 100).toFixed(0)}% — normal`;
  }

  if (actionRequired) {
    logger.info('[TokenMonitor] %s (tokens: %d/%d)', message, currentTokens, maxTokens);
  }

  return {
    currentTokens,
    maxTokens,
    ratio,
    level,
    message,
    actionRequired,
    recommendedAction,
  };
}
