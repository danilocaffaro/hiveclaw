/**
 * ProgressChecker — Smart agentic loop control
 *
 * Sprint 80 — Unlimited Agent (Adler proposal, Mar 18 2026)
 * ─────────────────────────────────────────────────────────
 * Philosophy: The agent should never be stopped by artificial limits.
 * The ONLY legitimate stop reasons are:
 *   1. Genuine infinite loop (same tool + same args, consecutively)
 *   2. Absolute time wall (30 min) — true runaway protection only
 *
 * REMOVED vs Sprint 79:
 *   - stallThreshold: was incorrectly flagging legitimate multi-step work
 *     (fetching 20 GitHub files = "stalled" by old logic — wrong)
 *   - tokenBudget: redundant with LLM maxTokens; was killing useful work
 *   - checkInterval: no longer needed without stall detection
 *
 * CHANGED:
 *   - duplicateThreshold: 3 → 5 (more tolerance for retries)
 *   - timeBudgetMs: 10min → 30min (true wall, not productivity limit)
 *   - recordTokens(): now a no-op (API-compatible stub)
 */

export interface ToolCallRecord {
  name: string;
  argsHash: string;
  timestamp: number;
  success: boolean;
}

export interface ProgressCheckResult {
  shouldStop: boolean;
  reason?: 'duplicate_tool' | 'time_budget';
  details?: string;
  recommendation?: string;
}

export interface ProgressCheckerOptions {
  /** Consecutive identical tool+args calls before stopping. Default: 5 */
  duplicateThreshold?: number;
  /** Absolute time wall ms. Default: 1_800_000 (30min). 0 = disabled */
  timeBudgetMs?: number;
}

function hashArgs(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args, Object.keys(args).sort());
  } catch {
    return String(args);
  }
}

export class ProgressChecker {
  private history: ToolCallRecord[] = [];
  private startTime = Date.now();
  private duplicateThreshold: number;
  private timeBudgetMs: number;

  constructor(options: ProgressCheckerOptions = {}) {
    this.duplicateThreshold = options.duplicateThreshold ?? 5;
    this.timeBudgetMs = options.timeBudgetMs ?? 1_800_000;
  }

  recordToolCall(name: string, args: Record<string, unknown>, success = true): ProgressCheckResult {
    const argsHash = hashArgs(args);
    this.history.push({ name, argsHash, timestamp: Date.now(), success });

    // Count CONSECUTIVE identical calls at tail of history
    let count = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].name === name && this.history[i].argsHash === argsHash) count++;
      else break;
    }

    if (count >= this.duplicateThreshold) {
      return {
        shouldStop: true,
        reason: 'duplicate_tool',
        details: `"${name}" called ${count}x consecutively with identical args`,
        recommendation: `Tool "${name}" is not producing new results. Try different parameters or report what you found so far.`,
      };
    }
    return { shouldStop: false };
  }

  /** No-op stub — token budget removed in Sprint 80 */
  recordTokens(_in: number, _out: number): ProgressCheckResult {
    return { shouldStop: false };
  }

  checkTimeBudget(): ProgressCheckResult {
    if (this.timeBudgetMs <= 0) return { shouldStop: false };
    const elapsed = Date.now() - this.startTime;
    if (elapsed > this.timeBudgetMs) {
      return {
        shouldStop: true,
        reason: 'time_budget',
        details: `30-min wall reached: ${Math.round(elapsed / 1000)}s elapsed`,
        recommendation: 'Time limit reached. Consolidate and report everything gathered so far.',
      };
    }
    return { shouldStop: false };
  }

  /** Sprint 80: only checks time wall — stall detection removed */
  fullCheck(_iteration: number): ProgressCheckResult {
    return this.checkTimeBudget();
  }

  getSummary() {
    return {
      totalToolCalls: this.history.length,
      uniqueToolCalls: new Set(this.history.map(r => `${r.name}:${r.argsHash}`)).size,
      elapsedMs: Date.now() - this.startTime,
    };
  }
}
