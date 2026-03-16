// ============================================================
// Log Rotation — Keeps log files from growing unbounded
// Runs at server startup: rotates if > MAX_SIZE, keeps last N
// ============================================================

import { statSync, renameSync, unlinkSync, existsSync, writeFileSync } from 'fs';
import { logger } from './logger.js';

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_ROTATED = 3; // Keep 3 old logs

/**
 * Rotate a log file if it exceeds MAX_LOG_SIZE.
 * Creates: file.log → file.log.1, file.log.1 → file.log.2, etc.
 * Deletes file.log.{MAX_ROTATED+1} if it exists.
 */
export function rotateLogIfNeeded(filePath: string): void {
  try {
    if (!existsSync(filePath)) return;
    const stats = statSync(filePath);
    if (stats.size < MAX_LOG_SIZE) return;

    // Rotate: .3 → delete, .2 → .3, .1 → .2, current → .1
    for (let i = MAX_ROTATED; i >= 1; i--) {
      const src = i === 1 ? filePath : `${filePath}.${i - 1}`;
      const dst = `${filePath}.${i}`;
      if (existsSync(src)) {
        if (i === MAX_ROTATED && existsSync(dst)) {
          unlinkSync(dst);
        }
        renameSync(src, dst);
      }
    }

    // Create fresh empty log
    writeFileSync(filePath, '', 'utf-8');
    logger.info('[LogRotation] Rotated %s (was %d MB)', filePath, Math.round(stats.size / 1024 / 1024));
  } catch (err) {
    // Non-fatal — don't crash server over log rotation
    logger.warn('[LogRotation] Failed to rotate %s: %s', filePath, (err as Error).message);
  }
}

/**
 * Rotate all known HiveClaw log files.
 * Called once at server startup.
 */
export function rotateAllLogs(): void {
  const logFiles = [
    '/tmp/hiveclaw.log',
    '/tmp/hiveclaw-error.log',
  ];
  for (const file of logFiles) {
    rotateLogIfNeeded(file);
  }
}
