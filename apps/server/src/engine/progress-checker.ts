/**
 * ProgressChecker — Smart agentic loop control
 *
 * Replaces fixed MAX_TOOL_ITERATIONS with intelligent self-awareness:
 * 1. Detects duplicate tool calls (same name + args)
 * 2. Detects stalled progress (no state change in N iterations)
 * 3. Provides budget tracking (tokens, time)
 *
 * Sprint 79 — Smart Agentic Loop
 */

export interface ToolCallRecord {
  name: string;
  argsHash: string;
  timestamp: number;
  success: boolean;
}

export interface ProgressCheckResult {
  shouldStop: boolean;
  reason?: 'duplicate_tool' | 'no_progress' | 'token_budget' | 'time_budget';
  details?: string;
  recommendation?: string;
}

export interface ProgressCheckerOptions {
  /** How many consecutive duplicate tool calls trigger a stop (default: 2) */
  duplicateThreshold?: number;
  /** How many iterations without progress before stopping (default: 6) */
  stallThreshold?: number;
  /** Max tokens before stopping (default: 80_000) */
  tokenBudget?: number;
  /** Max time in ms before stopping (default: 120_000 = 2min) */
  timeBudgetMs?: number;
  /** Check interval — evaluate progress every N iterations (default: 5) */
  checkInterval?: number;
}

function hashArgs(args: Record<string, unknown>): string {
  try {
    // Stable hash — sort keys for consistent comparison
    return JSON.stringify(args, Object.keys(args).sort());
  } catch {
    return String(args);
  }
}

export class ProgressChecker {
  private history: ToolCallRecord[] = [];
  private totalTokens = 0;
  private startTime = Date.now();
  private lastProgressIteration = 0;
  private uniqueToolsExecuted = new Set<string>();

  private duplicateThreshold: number;
  private stallThreshold: number;
  private tokenBudget: number;
  private timeBudgetMs: number;
  private checkInterval: number;

  constructor(options: ProgressCheckerOptions = {}) {
    this.duplicateThreshold = options.duplicateThreshold ?? 2;
    this.stallThreshold = options.stallThreshold ?? 6;
    this.tokenBudget = options.tokenBudget ?? 80_000;
    this.timeBudgetMs = options.timeBudgetMs ?? 120_000;
    this.checkInterval = options.checkInterval ?? 5;
  }

  /**
   * Record a tool call and check for duplicate loops
   */
  recordToolCall(name: string, args: Record<string, unknown>, success = true): ProgressCheckResult {
    const argsHash = hashArgs(args);
    const now = Date.now();

    this.history.push({ name, argsHash, timestamp: now, success });

    // Mark progress — new unique tool executed
    const toolKey = `${name}:${argsHash}`;
    if (!this.uniqueToolsExecuted.has(toolKey)) {
      this.uniqueToolsExecuted.add(toolKey);
      this.lastProgressIteration = this.history.length;
    }

    // Check for consecutive duplicates
    const recentDuplicates = this.history
      .slice(-this.duplicateThreshold)
      .filter(r => r.name === name && r.argsHash === argsHash);

    if (recentDuplicates.length >= this.duplicateThreshold) {
      return {
        shouldStop: true,
        reason: 'duplicate_tool',
        details: `Tool "${name}" called ${recentDuplicates.length}x with identical arguments`,
        recommendation: 'The tool is not producing new results. Try a different approach or report the result.',
      };
    }

    return { shouldStop: false };
  }

  /**
   * Record token usage
   */
  recordTokens(inputTokens: number, outputTokens: number): ProgressCheckResult {
    this.totalTokens += inputTokens + outputTokens;

    if (this.totalTokens > this.tokenBudget) {
      return {
        shouldStop: true,
        reason: 'token_budget',
        details: `Token budget exceeded: ${this.totalTokens.toLocaleString()} / ${this.tokenBudget.toLocaleString()}`,
        recommendation: 'Summarize progress so far and continue in a new iteration.',
      };
    }

    return { shouldStop: false };
  }

  /**
   * Check time budget
   */
  checkTimeBudget(): ProgressCheckResult {
    const elapsed = Date.now() - this.startTime;

    if (elapsed > this.timeBudgetMs) {
      return {
        shouldStop: true,
        reason: 'time_budget',
        details: `Time budget exceeded: ${Math.round(elapsed / 1000)}s / ${Math.round(this.timeBudgetMs / 1000)}s`,
        recommendation: 'Report current progress and continue in next response.',
      };
    }

    return { shouldStop: false };
  }

  /**
   * Check for stalled progress (called every N iterations)
   */
  checkProgress(currentIteration: number): ProgressCheckResult {
    // Only check at intervals
    if (currentIteration % this.checkInterval !== 0 || currentIteration === 0) {
      return { shouldStop: false };
    }

    const iterationsSinceProgress = currentIteration - this.lastProgressIteration;

    if (iterationsSinceProgress >= this.stallThreshold) {
      return {
        shouldStop: true,
        reason: 'no_progress',
        details: `No new progress in ${iterationsSinceProgress} iterations (last progress at iteration ${this.lastProgressIteration})`,
        recommendation: 'The agent appears stuck. Report current state and ask for guidance.',
      };
    }

    return { shouldStop: false };
  }

  /**
   * Full check — run all checks at once
   */
  fullCheck(currentIteration: number): ProgressCheckResult {
    // Time budget
    const timeCheck = this.checkTimeBudget();
    if (timeCheck.shouldStop) return timeCheck;

    // Stall check
    const progressCheck = this.checkProgress(currentIteration);
    if (progressCheck.shouldStop) return progressCheck;

    return { shouldStop: false };
  }

  /**
   * Summary stats for logging
   */
  getSummary() {
    return {
      totalToolCalls: this.history.length,
      uniqueToolCalls: this.uniqueToolsExecuted.size,
      totalTokens: this.totalTokens,
      elapsedMs: Date.now() - this.startTime,
      lastProgressIteration: this.lastProgressIteration,
    };
  }
}
