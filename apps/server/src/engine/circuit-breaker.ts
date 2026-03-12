/**
 * engine/circuit-breaker.ts — Auto-disable failing tasks
 *
 * Tracks failure counts per task key. After N consecutive failures,
 * the circuit "opens" (task disabled). Resets on success.
 *
 * States:
 *   CLOSED  → Normal operation (passes through)
 *   OPEN    → Blocked (too many failures, auto-disabled)
 *   HALF    → After cooldown, allows one retry
 */

import { logger } from '../lib/logger.js';

// ─── Configuration ──────────────────────────────────────────────────────────────

const DEFAULT_FAILURE_THRESHOLD = 3;        // consecutive failures to open
const DEFAULT_COOLDOWN_MS = 30 * 60_000;    // 30min before half-open retry
const MAX_TRACKED_KEYS = 500;               // prevent memory leak

// ─── Types ──────────────────────────────────────────────────────────────────────

export type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitRecord {
  state: CircuitState;
  failureCount: number;
  lastFailure: number;     // timestamp
  lastSuccess: number;     // timestamp
  openedAt: number;        // when circuit opened
  totalFailures: number;   // lifetime counter
  totalSuccesses: number;  // lifetime counter
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
}

// ─── CircuitBreaker class ───────────────────────────────────────────────────────

export class CircuitBreaker {
  private circuits = new Map<string, CircuitRecord>();
  private failureThreshold: number;
  private cooldownMs: number;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  }

  /**
   * Check if a task is allowed to execute.
   * Returns true if CLOSED or HALF-OPEN (retry allowed).
   */
  canExecute(key: string): boolean {
    const record = this.circuits.get(key);
    if (!record) return true; // no record = closed (healthy)

    if (record.state === 'closed') return true;

    if (record.state === 'open') {
      // Check if cooldown has elapsed → transition to half-open
      const elapsed = Date.now() - record.openedAt;
      if (elapsed >= this.cooldownMs) {
        record.state = 'half-open';
        logger.info(`[CircuitBreaker] ${key}: OPEN → HALF-OPEN (cooldown elapsed, retry allowed)`);
        return true;
      }
      return false; // still cooling down
    }

    // half-open: allow one retry
    return true;
  }

  /**
   * Record a successful execution. Resets failure count.
   */
  recordSuccess(key: string): void {
    const record = this.circuits.get(key);
    if (!record) {
      // First interaction, no record needed for successes
      return;
    }

    const wasOpen = record.state !== 'closed';
    record.state = 'closed';
    record.failureCount = 0;
    record.lastSuccess = Date.now();
    record.totalSuccesses++;

    if (wasOpen) {
      logger.info(`[CircuitBreaker] ${key}: → CLOSED (success after recovery)`);
    }
  }

  /**
   * Record a failed execution. May open the circuit.
   */
  recordFailure(key: string, error?: string): void {
    const now = Date.now();
    let record = this.circuits.get(key);

    if (!record) {
      // Garbage collection: prevent unbounded growth
      if (this.circuits.size >= MAX_TRACKED_KEYS) {
        this.evictOldest();
      }

      record = {
        state: 'closed',
        failureCount: 0,
        lastFailure: 0,
        lastSuccess: 0,
        openedAt: 0,
        totalFailures: 0,
        totalSuccesses: 0,
      };
      this.circuits.set(key, record);
    }

    record.failureCount++;
    record.lastFailure = now;
    record.totalFailures++;

    if (record.state === 'half-open') {
      // Retry failed → back to OPEN with fresh cooldown
      record.state = 'open';
      record.openedAt = now;
      logger.warn(`[CircuitBreaker] ${key}: HALF-OPEN → OPEN (retry failed: ${error ?? 'unknown'})`);
      return;
    }

    if (record.failureCount >= this.failureThreshold) {
      record.state = 'open';
      record.openedAt = now;
      logger.warn(
        `[CircuitBreaker] ${key}: CLOSED → OPEN (${record.failureCount} consecutive failures). ` +
        `Auto-disabled for ${this.cooldownMs / 60_000}min. Last error: ${error ?? 'unknown'}`,
      );
    }
  }

  /**
   * Get the current state of a circuit.
   */
  getState(key: string): CircuitRecord | null {
    return this.circuits.get(key) ?? null;
  }

  /**
   * List all tracked circuits.
   */
  listAll(): Array<{ key: string } & CircuitRecord> {
    return Array.from(this.circuits.entries()).map(([key, record]) => ({
      key,
      ...record,
    }));
  }

  /**
   * Manually reset (close) a circuit.
   */
  reset(key: string): void {
    this.circuits.delete(key);
    logger.info(`[CircuitBreaker] ${key}: manually reset`);
  }

  /**
   * Reset all circuits.
   */
  resetAll(): void {
    this.circuits.clear();
    logger.info('[CircuitBreaker] All circuits reset');
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, record] of this.circuits) {
      const lastActivity = Math.max(record.lastFailure, record.lastSuccess);
      if (lastActivity < oldestTime) {
        oldestTime = lastActivity;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.circuits.delete(oldestKey);
    }
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────────

let globalBreaker: CircuitBreaker | null = null;

export function getCircuitBreaker(): CircuitBreaker {
  if (!globalBreaker) {
    globalBreaker = new CircuitBreaker();
  }
  return globalBreaker;
}
