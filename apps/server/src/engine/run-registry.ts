/**
 * run-registry.ts — Active run tracker for abort support (P1)
 *
 * Maps sessionId → { controller, createdAt } for all active v2 agent runs.
 * Callers register a controller before starting the run, and the
 * cancel API (or session deletion) triggers abort.
 *
 * A periodic sweep removes stale entries where the AbortController's signal
 * is already aborted (run completed or was cancelled but unregisterRun was
 * never called due to an exception). This mirrors the P3 sessionLocks sweep.
 */

import { logger } from '../lib/logger.js';

interface RunEntry {
  controller: AbortController;
  createdAt: number;
}

const _activeRuns = new Map<string, RunEntry>();

/** Max age before a run entry is considered stale and force-cleaned (10 min). */
const STALE_RUN_MS = 10 * 60 * 1000;

/** Sweep interval (60s, same cadence as sessionLocks). */
const SWEEP_INTERVAL_MS = 60_000;

let _sweepTimer: ReturnType<typeof setInterval> | null = null;

function startSweep(): void {
  if (_sweepTimer) return;
  _sweepTimer = setInterval(() => {
    const now = Date.now();
    let swept = 0;
    for (const [sessionId, entry] of _activeRuns) {
      // Remove if signal already aborted (run finished but unregister wasn't called)
      // or if entry is older than STALE_RUN_MS (likely leaked)
      if (entry.controller.signal.aborted || (now - entry.createdAt) > STALE_RUN_MS) {
        _activeRuns.delete(sessionId);
        swept++;
      }
    }
    if (swept > 0) {
      logger.info('[run-registry] Swept %d stale run entries, %d remaining', swept, _activeRuns.size);
    }
  }, SWEEP_INTERVAL_MS);
  _sweepTimer.unref();
}

// Start sweep on module load
startSweep();

/** Register a new run. Returns the AbortController to pass to runAgentV2. */
export function registerRun(sessionId: string): AbortController {
  // If there's already an active run for this session, abort it first
  const existing = _activeRuns.get(sessionId);
  if (existing) {
    existing.controller.abort();
  }
  const controller = new AbortController();
  _activeRuns.set(sessionId, { controller, createdAt: Date.now() });
  return controller;
}

/** Cancel (abort) an active run. Returns true if a run was found and cancelled. */
export function cancelRun(sessionId: string): boolean {
  const entry = _activeRuns.get(sessionId);
  if (!entry) return false;
  entry.controller.abort();
  _activeRuns.delete(sessionId);
  return true;
}

/** Unregister a run (called when run completes naturally). */
export function unregisterRun(sessionId: string): void {
  _activeRuns.delete(sessionId);
}

/** Check if a session has an active run. */
export function hasActiveRun(sessionId: string): boolean {
  return _activeRuns.has(sessionId);
}

/** Get count of active runs (for health endpoint). */
export function activeRunCount(): number {
  return _activeRuns.size;
}

/** Stop the sweep timer (for clean shutdown in tests). */
export function stopRunRegistrySweep(): void {
  if (_sweepTimer) {
    clearInterval(_sweepTimer);
    _sweepTimer = null;
  }
}
