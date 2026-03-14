/**
 * engine/skill-scout-cron.ts — Weekly Skill Scout Cron Job
 *
 * Runs every Sunday at 03:00 (São Paulo time) by default.
 * Can also be triggered manually via POST /skills/scout/run
 *
 * Sprint 78 — Clark 🐙
 */

import { logger } from '../lib/logger.js';
import { runSkillScout } from './skill-scout.js';
import type Database from 'better-sqlite3';

// ─── Cron State ───────────────────────────────────────────────────────────────

let cronTimer: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;
let lastRun: Date | null = null;
let lastResult: { discovered: number; created: number; failed: number } | null = null;

// ─── Schedule Calculation ─────────────────────────────────────────────────────

function msUntilNextSunday3AM(): number {
  const now = new Date();
  const next = new Date(now);

  // Get next Sunday
  const daysUntilSunday = (7 - now.getDay()) % 7 || 7;
  next.setDate(now.getDate() + daysUntilSunday);
  next.setHours(3, 0, 0, 0); // 03:00 local time

  return next.getTime() - now.getTime();
}

// ─── Run ──────────────────────────────────────────────────────────────────────

export async function runScoutNow(db: Database.Database): Promise<{
  discovered: number; created: number; failed: number
}> {
  if (isRunning) {
    logger.warn('[skill-scout-cron] Already running — skipping');
    return { discovered: 0, created: 0, failed: 0 };
  }

  isRunning = true;
  lastRun = new Date();

  try {
    logger.info('[skill-scout-cron] Starting skill scout run...');
    const result = await runSkillScout(db);
    lastResult = result;
    logger.info({ result }, '[skill-scout-cron] Skill scout completed');
    return result;
  } catch (err) {
    logger.error({ err }, '[skill-scout-cron] Skill scout failed');
    return { discovered: 0, created: 0, failed: 0 };
  } finally {
    isRunning = false;
  }
}

// ─── Start Cron ───────────────────────────────────────────────────────────────

export function startSkillScoutCron(db: Database.Database): void {
  const schedule = (): void => {
    const ms = msUntilNextSunday3AM();
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    logger.info(`[skill-scout-cron] Next run in ${days}d ${hours}h (every Sunday 03:00)`);

    cronTimer = setTimeout(async () => {
      await runScoutNow(db);
      schedule(); // reschedule for next week
    }, ms);
  };

  schedule();
  logger.info('[skill-scout-cron] Weekly skill discovery cron started ✅');
}

// ─── Stop Cron ────────────────────────────────────────────────────────────────

export function stopSkillScoutCron(): void {
  if (cronTimer) {
    clearTimeout(cronTimer);
    cronTimer = null;
    logger.info('[skill-scout-cron] Cron stopped');
  }
}

// ─── Status ───────────────────────────────────────────────────────────────────

export function getScoutStatus(): {
  isRunning: boolean;
  lastRun: string | null;
  lastResult: { discovered: number; created: number; failed: number } | null;
  nextRun: string;
} {
  const ms = msUntilNextSunday3AM();
  const nextRun = new Date(Date.now() + ms).toISOString();

  return {
    isRunning,
    lastRun: lastRun?.toISOString() ?? null,
    lastResult,
    nextRun
  };
}
