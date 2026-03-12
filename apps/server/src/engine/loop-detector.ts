/**
 * engine/loop-detector.ts — Detect and break agent repetition loops
 *
 * Catches two patterns:
 * 1. Tool call loops: agent calls same tool with same input N times
 * 2. Response loops: agent generates nearly identical text N times
 */

// ─── Configuration ──────────────────────────────────────────────────────────────

const MAX_IDENTICAL_TOOL_CALLS = 3;   // same tool + same input
const MAX_SIMILAR_RESPONSES = 3;       // similarity > 0.85
const SIMILARITY_THRESHOLD = 0.85;     // Jaccard similarity
const WINDOW_SIZE = 8;                 // only check last N items

// ─── Types ──────────────────────────────────────────────────────────────────────

interface ToolCallRecord {
  name: string;
  inputHash: string;
}

interface ResponseRecord {
  text: string;
  tokens: Set<string>;  // for Jaccard similarity
}

export interface LoopDetectionResult {
  loopDetected: boolean;
  type?: 'tool_call' | 'response';
  details?: string;
}

// ─── LoopDetector class ─────────────────────────────────────────────────────────

export class LoopDetector {
  private toolHistory: ToolCallRecord[] = [];
  private responseHistory: ResponseRecord[] = [];

  /**
   * Record a tool call. Returns loop detection result.
   */
  recordToolCall(name: string, input: Record<string, unknown>): LoopDetectionResult {
    const inputHash = this.hashInput(input);
    this.toolHistory.push({ name, inputHash });

    // Keep window bounded
    if (this.toolHistory.length > WINDOW_SIZE * 2) {
      this.toolHistory = this.toolHistory.slice(-WINDOW_SIZE);
    }

    // Count identical calls in the window
    const window = this.toolHistory.slice(-WINDOW_SIZE);
    const identicalCount = window.filter(
      (tc) => tc.name === name && tc.inputHash === inputHash,
    ).length;

    if (identicalCount >= MAX_IDENTICAL_TOOL_CALLS) {
      return {
        loopDetected: true,
        type: 'tool_call',
        details: `Tool "${name}" called ${identicalCount} times with identical input in last ${WINDOW_SIZE} calls`,
      };
    }

    return { loopDetected: false };
  }

  /**
   * Record an assistant response. Returns loop detection result.
   */
  recordResponse(text: string): LoopDetectionResult {
    const trimmed = text.trim();
    if (trimmed.length < 20) return { loopDetected: false };  // too short to matter

    const tokens = this.tokenize(trimmed);
    this.responseHistory.push({ text: trimmed, tokens });

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

    if (similarCount >= MAX_SIMILAR_RESPONSES - 1) {  // -1 because we compare against previous
      return {
        loopDetected: true,
        type: 'response',
        details: `Agent produced ${similarCount + 1} similar responses (similarity > ${SIMILARITY_THRESHOLD})`,
      };
    }

    return { loopDetected: false };
  }

  /**
   * Reset the detector (e.g., after breaking out of a loop).
   */
  reset(): void {
    this.toolHistory = [];
    this.responseHistory = [];
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private hashInput(input: Record<string, unknown>): string {
    try {
      // Stable JSON stringification (sorted keys)
      return JSON.stringify(input, Object.keys(input).sort());
    } catch {
      return String(input);
    }
  }

  private tokenize(text: string): Set<string> {
    // Simple word-level tokenization, lowercased
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
