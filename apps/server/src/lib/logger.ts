// ============================================================
// Structured Logger — Pino-based logging for HiveClaw
// ============================================================

import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

export function createChildLogger(context: Record<string, unknown>) {
  return logger.child(context);
}

/**
 * Fire-and-forget helper that catches unhandled rejections.
 * Use instead of bare `void asyncFn()` to prevent Node.js process crashes.
 *
 * @example safeFire(doSomethingAsync(), 'doSomething');
 */
export function safeFire(promise: Promise<unknown>, label?: string): void {
  promise.catch((err) => {
    logger.error({ err, label }, '[safeFire] Unhandled async error in %s', label ?? 'unknown');
  });
}
