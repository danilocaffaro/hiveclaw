/**
 * engine/loop-detector.ts — Detect and break agent repetition loops (v2)
 *
 * R20.2b: Graduated thresholds inspired by OpenClaw's 3-detector system.
 * Instead of binary "5 calls = block", uses WARNING → INJECT → CIRCUIT_BREAKER.
 *
 * Catches two patterns:
 * 1. Tool call loops: agent calls same tool with same input N times
 * 2. Response loops: agent generates nearly identical text N times
 *
 * Severity levels:
 * - WARNING (3 identical): Log warning, continue normally
 * - INJECT (5 identical): Inject SYSTEM feedback, let LLM self-correct
 * - CIRCUIT_BREAKER (8 identical): Hard stop, force consolidation
 *
 * Decay: records older than DECAY_WINDOW_MS are pruned on each check,
 * preventing false positives in long-lived sessions where the same
 * legitimate tool call may recur hours apart.
 */

// ─── Configuration ──────────────────────────────────────────────────────────────

// R20.2b: Graduated thresholds (was: single MAX_IDENTICAL_TOOL_CALLS = 5)
const TOOL_THRESHOLD_WARNING = 3;        // log warning, no action
const TOOL_THRESHOLD_INJECT = 5;         // inject SYSTEM feedback
const TOOL_THRESHOLD_CIRCUIT_BREAKER = 8; // hard stop

const MAX_SIMILAR_RESPONSES = 3;       // similarity > 0.85
const SIMILARITY_THRESHOLD = 0.85;     // Jaccard similarity
const WINDOW_SIZE = 12;                // R20.2b: increased from 8 to support graduated detection
const DECAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes — records older than this are pruned

// ─── Types ──────────────────────────────────────────────────────────────────────

interface ToolCallRecord {
  name: string;
  inputHash: string;
  timestamp: number;
}

interface ResponseRecord {
  text: string;
  tokens: Set<string>;  // for Jaccard similarity
  timestamp: number;
}

export type LoopSeverity = 'none' | 'warning' | 'inject' | 'circuit_breaker';

export interface LoopDetectionResult {
  loopDetected: boolean;
  severity: LoopSeverity;       // R20.2b: graduated severity
  type?: 'tool_call' | 'response';
  details?: string;
  identicalCount?: number;       // R20.2b: how many identical calls detected
}

// ─── LoopDetector class ─────────────────────────────────────────────────────────

export class LoopDetector {
  private toolHistory: ToolCallRecord[] = [];
  private responseHistory: ResponseRecord[] = [];
  private _nowFn: () => number = Date.now;  // injectable for testing

  /**
   * Override the clock source (for deterministic tests).
   */
  setNowFn(fn: () => number): void {
    this._nowFn = fn;
  }

  /**
   * Record a tool call. Returns loop detection result with graduated severity.
   */
  recordToolCall(name: string, input: Record<string, unknown>): LoopDetectionResult {
    this.decayToolHistory();

    const inputHash = this.hashInput(input);
    this.toolHistory.push({ name, inputHash, timestamp: this._nowFn() });

    // Keep window bounded
    if (this.toolHistory.length > WINDOW_SIZE * 2) {
      this.toolHistory = this.toolHistory.slice(-WINDOW_SIZE);
    }

    // Count identical calls in the window
    const window = this.toolHistory.slice(-WINDOW_SIZE);
    const identicalCount = window.filter(
      (tc) => tc.name === name && tc.inputHash === inputHash,
    ).length;

    // R20.2b: Graduated response
    if (identicalCount >= TOOL_THRESHOLD_CIRCUIT_BREAKER) {
      return {
        loopDetected: true,
        severity: 'circuit_breaker',
        type: 'tool_call',
        details: `Tool "${name}" called ${identicalCount}x with identical input — CIRCUIT BREAKER`,
        identicalCount,
      };
    }

    if (identicalCount >= TOOL_THRESHOLD_INJECT) {
      return {
        loopDetected: true,
        severity: 'inject',
        type: 'tool_call',
        details: `Tool "${name}" called ${identicalCount}x with identical input — injecting feedback`,
        identicalCount,
      };
    }

    if (identicalCount >= TOOL_THRESHOLD_WARNING) {
      return {
        loopDetected: false, // not blocking yet, just warning
        severity: 'warning',
        type: 'tool_call',
        details: `Tool "${name}" called ${identicalCount}x with identical input — monitoring`,
        identicalCount,
      };
    }

    return { loopDetected: false, severity: 'none' };
  }

  /**
   * Record an assistant response. Returns loop detection result.
   */
  recordResponse(text: string): LoopDetectionResult {
    this.decayResponseHistory();

    const trimmed = text.trim();
    if (trimmed.length < 20) return { loopDetected: false, severity: 'none' };

    const tokens = this.tokenize(trimmed);
    this.responseHistory.push({ text: trimmed, tokens, timestamp: this._nowFn() });

    // Keep window bounded
    if (this.responseHistory.length > WINDOW_SIZE * 2) {
      this.responseHistory = this.responseHistory.slice(-WINDOW_SIZE);
    }

    // Check similarity against recent responses
    const window = this.responseHistory.slice(-WINDOW_SIZE - 1, -1); // exclude current
    let similarCount = 0;
    for (const prev of window) {
      const similarity = this.jaccardSimilarity(tokens, prev.tokens);
      if (similarity >= SIMILARITY_THRESHOLD) {
        similarCount++;
      }
    }

    if (similarCount >= MAX_SIMILAR_RESPONSES - 1) {
      return {
        loopDetected: true,
        severity: 'circuit_breaker',
        type: 'response',
        details: `Agent produced ${similarCount + 1} similar responses (similarity > ${SIMILARITY_THRESHOLD})`,
      };
    }

    return { loopDetected: false, severity: 'none' };
  }

  /**
   * Reset the detector (e.g., after breaking out of a loop).
   */
  reset(): void {
    this.toolHistory = [];
    this.responseHistory = [];
  }

  // ── Decay ────────────────────────────────────────────────────────────────────

  private decayToolHistory(): void {
    const cutoff = this._nowFn() - DECAY_WINDOW_MS;
    this.toolHistory = this.toolHistory.filter((r) => r.timestamp >= cutoff);
  }

  private decayResponseHistory(): void {
    const cutoff = this._nowFn() - DECAY_WINDOW_MS;
    this.responseHistory = this.responseHistory.filter((r) => r.timestamp >= cutoff);
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private hashInput(input: Record<string, unknown>): string {
    try {
      return JSON.stringify(input, Object.keys(input).sort());
    } catch {
      return String(input);
    }
  }

  private tokenize(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );
  }

  private jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 1;
    let intersection = 0;
    for (const token of a) {
      if (b.has(token)) intersection++;
    }
    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }
}
