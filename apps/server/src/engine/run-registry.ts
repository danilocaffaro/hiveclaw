/**
 * run-registry.ts — Active run tracker for abort support (P1)
 *
 * Maps sessionId → AbortController for all active v2 agent runs.
 * Callers register a controller before starting the run, and the
 * cancel API (or session deletion) triggers abort.
 */

const _activeRuns = new Map<string, AbortController>();

/** Register a new run. Returns the AbortController to pass to runAgentV2. */
export function registerRun(sessionId: string): AbortController {
  // If there's already an active run for this session, abort it first
  const existing = _activeRuns.get(sessionId);
  if (existing) {
    existing.abort();
  }
  const controller = new AbortController();
  _activeRuns.set(sessionId, controller);
  return controller;
}

/** Cancel (abort) an active run. Returns true if a run was found and cancelled. */
export function cancelRun(sessionId: string): boolean {
  const controller = _activeRuns.get(sessionId);
  if (!controller) return false;
  controller.abort();
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
