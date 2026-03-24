// ============================================================
// Self-Watchdog — Internal health monitoring for HiveClaw
// Autonomous: no external dependencies (no OpenClaw, no Alice)
// ============================================================

import { logger, safeFire } from '../lib/logger.js';

export interface WatchdogConfig {
  /** Health check interval in ms (default: 60_000 = 1 min) */
  intervalMs?: number;
  /** Port to self-check (default: from env PORT or 4070) */
  port?: number;
  /** Max consecutive failures before restart alert (default: 3) */
  maxFailures?: number;
  /** Enable process memory monitoring (default: true) */
  monitorMemory?: boolean;
  /** Memory threshold in MB before warning (default: 512) */
  memoryThresholdMb?: number;
}

interface HealthSnapshot {
  timestamp: string;
  healthy: boolean;
  uptime: number;
  memoryMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  consecutiveFailures: number;
  lastError?: string;
}

export class SelfWatchdog {
  private intervalMs: number;
  private port: number;
  private maxFailures: number;
  private monitorMemory: boolean;
  private memoryThresholdMb: number;

  private timer: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
  private lastSnapshot: HealthSnapshot | null = null;
  private startTime = Date.now();

  constructor(config?: WatchdogConfig) {
    this.intervalMs = config?.intervalMs ?? 60_000;
    this.port = config?.port ?? Number(process.env['PORT'] ?? 4070);
    this.maxFailures = config?.maxFailures ?? 3;
    this.monitorMemory = config?.monitorMemory ?? true;
    this.memoryThresholdMb = config?.memoryThresholdMb ?? 512;
  }

  /** Start the watchdog loop */
  start(): void {
    if (this.timer) return;

    logger.info(`[Watchdog] Started — checking every ${this.intervalMs / 1000}s on port ${this.port}`);

    // First check after 30s (let server fully boot)
    setTimeout(() => {
      safeFire(this.check(), 'watchdog:firstCheck');
      this.timer = setInterval(() => safeFire(this.check(), 'watchdog:interval'), this.intervalMs);
    }, 30_000);
  }

  /** Stop the watchdog */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('[Watchdog] Stopped');
    }
  }

  /** Get the latest health snapshot */
  getSnapshot(): HealthSnapshot | null {
    return this.lastSnapshot;
  }

  /** Run a single health check */
  async check(): Promise<HealthSnapshot> {
    const mem = process.memoryUsage();
    const memoryMb = Math.round(mem.rss / 1024 / 1024);
    const heapUsedMb = Math.round(mem.heapUsed / 1024 / 1024);
    const heapTotalMb = Math.round(mem.heapTotal / 1024 / 1024);
    const uptime = Math.round((Date.now() - this.startTime) / 1000);

    let healthy = true;
    let lastError: string | undefined;

    // 1. Self HTTP check
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      const res = await fetch(`http://127.0.0.1:${this.port}/api/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        healthy = false;
        lastError = `Health endpoint returned ${res.status}`;
      }
    } catch (err) {
      healthy = false;
      lastError = `Health check failed: ${(err as Error).message}`;
    }

    // 2. Memory check
    if (this.monitorMemory && memoryMb > this.memoryThresholdMb) {
      logger.warn(
        `[Watchdog] ⚠️ High memory: ${memoryMb}MB RSS (threshold: ${this.memoryThresholdMb}MB), heap: ${heapUsedMb}/${heapTotalMb}MB`
      );
    }

    // 3. Track consecutive failures
    if (healthy) {
      if (this.consecutiveFailures > 0) {
        logger.info(`[Watchdog] ✅ Recovered after ${this.consecutiveFailures} failure(s)`);
      }
      this.consecutiveFailures = 0;
    } else {
      this.consecutiveFailures++;
      logger.error(
        `[Watchdog] 🔴 Health check FAILED (${this.consecutiveFailures}/${this.maxFailures}): ${lastError}`
      );

      if (this.consecutiveFailures >= this.maxFailures) {
        logger.error(
          `[Watchdog] 🔴 ${this.consecutiveFailures} consecutive failures — server may be unresponsive. ` +
            `launchd will restart on process exit.`
        );
        // Log to stderr so it shows in hiveclaw-error.log
        process.stderr.write(
          `[WATCHDOG CRITICAL] ${new Date().toISOString()} — ${this.consecutiveFailures} consecutive health check failures. Last error: ${lastError}\n`
        );
      }
    }

    // 4. Periodic status log (every 10 checks when healthy)
    const checkCount = Math.round(uptime / (this.intervalMs / 1000));
    if (healthy && checkCount > 0 && checkCount % 10 === 0) {
      logger.info(
        `[Watchdog] 💚 Healthy — uptime ${Math.round(uptime / 60)}min, RSS ${memoryMb}MB, heap ${heapUsedMb}/${heapTotalMb}MB`
      );
    }

    this.lastSnapshot = {
      timestamp: new Date().toISOString(),
      healthy,
      uptime,
      memoryMb,
      heapUsedMb,
      heapTotalMb,
      consecutiveFailures: this.consecutiveFailures,
      lastError,
    };

    return this.lastSnapshot;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _watchdog: SelfWatchdog | null = null;

export function getWatchdog(config?: WatchdogConfig): SelfWatchdog {
  if (!_watchdog) _watchdog = new SelfWatchdog(config);
  return _watchdog;
}
