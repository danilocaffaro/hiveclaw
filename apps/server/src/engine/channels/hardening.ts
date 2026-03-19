/**
 * Channel Hardening Utilities — Rate limiter, circuit breaker, webhook validation.
 *
 * Shared by all channel adapters for production resilience.
 * Phase 4.1 of HiveClaw Platform Blueprint.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { logger } from '../../lib/logger.js';

// ─── Inbound Rate Limiter ─────────────────────────────────────────────────

export interface RateLimiterConfig {
  /** Max requests per window */
  maxRequests: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Optional per-sender limits (lower than global) */
  perSenderMax?: number;
}

interface SlidingWindow {
  timestamps: number[];
}

export class InboundRateLimiter {
  private readonly global: SlidingWindow = { timestamps: [] };
  private readonly perSender = new Map<string, SlidingWindow>();
  private readonly config: RateLimiterConfig;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: RateLimiterConfig) {
    this.config = config;
    // Sweep stale sender entries every 60s
    this.sweepTimer = setInterval(() => this.sweep(), 60_000);
  }

  /**
   * Check if a request should be allowed.
   * Returns true = allowed, false = rate limited.
   */
  check(senderId?: string): boolean {
    const now = Date.now();
    const cutoff = now - this.config.windowMs;

    // Global check
    this.global.timestamps = this.global.timestamps.filter(t => t > cutoff);
    if (this.global.timestamps.length >= this.config.maxRequests) {
      return false;
    }

    // Per-sender check
    if (senderId && this.config.perSenderMax) {
      let window = this.perSender.get(senderId);
      if (!window) {
        window = { timestamps: [] };
        this.perSender.set(senderId, window);
      }
      window.timestamps = window.timestamps.filter(t => t > cutoff);
      if (window.timestamps.length >= this.config.perSenderMax) {
        return false;
      }
      window.timestamps.push(now);
    }

    this.global.timestamps.push(now);
    return true;
  }

  private sweep(): void {
    const cutoff = Date.now() - this.config.windowMs;
    for (const [key, window] of this.perSender) {
      window.timestamps = window.timestamps.filter(t => t > cutoff);
      if (window.timestamps.length === 0) this.perSender.delete(key);
    }
  }

  destroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.perSender.clear();
    this.global.timestamps = [];
  }
}

// ─── Circuit Breaker ──────────────────────────────────────────────────────

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  /** Number of failures before opening */
  failureThreshold: number;
  /** Time in ms to wait before half-open */
  resetTimeoutMs: number;
  /** Number of successes in half-open to close */
  halfOpenSuccesses: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;
  private readonly config: CircuitBreakerConfig;
  private readonly name: string;

  constructor(name: string, config: CircuitBreakerConfig) {
    this.name = name;
    this.config = config;
  }

  get currentState(): CircuitState { return this.state; }

  /**
   * Check if the circuit allows a request.
   * Returns true if allowed.
   */
  canExecute(): boolean {
    switch (this.state) {
      case 'closed':
        return true;

      case 'open': {
        // Check if enough time has passed to try half-open
        const elapsed = Date.now() - this.lastFailureTime;
        if (elapsed >= this.config.resetTimeoutMs) {
          this.state = 'half-open';
          this.successes = 0;
          logger.info('[CircuitBreaker:%s] Transitioning to half-open', this.name);
          return true;
        }
        return false;
      }

      case 'half-open':
        return true;
    }
  }

  recordSuccess(): void {
    switch (this.state) {
      case 'closed':
        this.failures = 0;
        break;

      case 'half-open':
        this.successes++;
        if (this.successes >= this.config.halfOpenSuccesses) {
          this.state = 'closed';
          this.failures = 0;
          logger.info('[CircuitBreaker:%s] Closed (recovered)', this.name);
        }
        break;
    }
  }

  recordFailure(): void {
    this.lastFailureTime = Date.now();

    switch (this.state) {
      case 'closed':
        this.failures++;
        if (this.failures >= this.config.failureThreshold) {
          this.state = 'open';
          logger.warn('[CircuitBreaker:%s] OPEN — %d consecutive failures', this.name, this.failures);
        }
        break;

      case 'half-open':
        this.state = 'open';
        logger.warn('[CircuitBreaker:%s] OPEN (half-open probe failed)', this.name);
        break;
    }
  }

  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = 0;
  }
}

// ─── Webhook Signature Validation ─────────────────────────────────────────

/**
 * Telegram Bot API setWebhook secret_token validation.
 * Header: X-Telegram-Bot-Api-Secret-Token
 */
export function verifyTelegramWebhook(body: string, secretToken: string, headerToken: string): boolean {
  if (!secretToken || !headerToken) return false;
  // Telegram sends the secret_token as-is in the header (no HMAC)
  try {
    const expected = Buffer.from(secretToken, 'utf8');
    const actual = Buffer.from(headerToken, 'utf8');
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/**
 * Discord webhook/interaction signature validation.
 * Uses Ed25519 verification (Discord public key).
 * Note: discord.js handles this internally when using Gateway mode.
 * This is only needed for HTTP interactions endpoint (not currently used).
 *
 * Header: X-Signature-Ed25519, X-Signature-Timestamp
 */
export function verifyDiscordSignature(
  body: string,
  signature: string,
  timestamp: string,
  publicKey: string,
): boolean {
  if (!body || !signature || !timestamp || !publicKey) return false;
  try {
    // Use Node.js crypto.verify with Ed25519 (Node 18+)
    const { verify, createPublicKey } = require('node:crypto');
    const message = Buffer.from(timestamp + body);
    const sig = hexToBuffer(signature);
    const keyDer = Buffer.concat([
      // Ed25519 public key OID prefix
      Buffer.from('302a300506032b6570032100', 'hex'),
      hexToBuffer(publicKey),
    ]);
    const key = createPublicKey({ key: keyDer, format: 'der', type: 'spki' });
    return verify(null, message, key, sig);
  } catch {
    return false;
  }
}

/**
 * Slack request signature validation (v0).
 * Header: X-Slack-Signature, X-Slack-Request-Timestamp
 */
export function verifySlackSignature(
  body: string,
  signingSecret: string,
  slackSignature: string,
  timestamp: string,
): boolean {
  if (!body || !signingSecret || !slackSignature || !timestamp) return false;

  // Reject requests older than 5 minutes (replay protection)
  const requestAge = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
  if (requestAge > 300) return false;

  const baseString = `v0:${timestamp}:${body}`;
  const hmac = createHmac('sha256', signingSecret).update(baseString).digest('hex');
  const expected = Buffer.from(`v0=${hmac}`, 'utf8');
  const actual = Buffer.from(slackSignature, 'utf8');

  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

// ─── Streaming Debounce ───────────────────────────────────────────────────

/**
 * Hybrid debounce: emits on punctuation terminal OR hard cap (whichever first).
 * Decision Q3 from blueprint.
 */
export class StreamingDebouncer {
  private buffer = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly hardCapMs: number;
  private readonly onFlush: (text: string) => void;

  // Punctuation that signals a "sentence boundary"
  private static readonly TERMINAL_RE = /[.!?。！？…\n][\s]*$/;

  constructor(hardCapMs: number, onFlush: (text: string) => void) {
    this.hardCapMs = hardCapMs;
    this.onFlush = onFlush;
  }

  append(chunk: string): void {
    this.buffer += chunk;

    // If the buffer ends with a sentence-terminal char, flush immediately
    if (StreamingDebouncer.TERMINAL_RE.test(this.buffer)) {
      this.flush();
      return;
    }

    // Otherwise, schedule hard-cap flush
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.hardCapMs);
    }
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length > 0) {
      const text = this.buffer;
      this.buffer = '';
      this.onFlush(text);
    }
  }

  destroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.buffer = '';
  }
}

// ─── Reconnection Helper ─────────────────────────────────────────────────

export interface ReconnectConfig {
  baseMs: number;
  maxMs: number;
  maxAttempts: number;  // 0 = unlimited
}

export class ReconnectManager {
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly config: ReconnectConfig;
  private readonly name: string;

  constructor(name: string, config: ReconnectConfig) {
    this.name = name;
    this.config = config;
  }

  get currentAttempt(): number { return this.attempt; }

  reset(): void {
    this.attempt = 0;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  stop(): void {
    this.stopped = true;
    this.reset();
  }

  /**
   * Schedule a reconnection attempt.
   * Returns false if max attempts exceeded.
   */
  schedule(fn: () => Promise<void>): boolean {
    if (this.stopped) return false;
    if (this.timer) return true; // already scheduled

    this.attempt++;
    if (this.config.maxAttempts > 0 && this.attempt > this.config.maxAttempts) {
      logger.error('[Reconnect:%s] Max attempts (%d) exceeded', this.name, this.config.maxAttempts);
      return false;
    }

    const delay = Math.min(
      this.config.baseMs * Math.pow(2, this.attempt - 1),
      this.config.maxMs,
    );

    logger.info('[Reconnect:%s] Attempt %d in %dms', this.name, this.attempt, delay);

    this.timer = setTimeout(async () => {
      this.timer = null;
      if (this.stopped) return;
      try {
        await fn();
        this.attempt = 0; // success
      } catch (err) {
        logger.warn('[Reconnect:%s] Attempt %d failed: %s', this.name, this.attempt, (err as Error).message);
        this.schedule(fn);
      }
    }, delay);

    return true;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
