/**
 * Sliding Window Rate Limiter
 *
 * Uses a log-based sliding window: stores timestamps of each request
 * and counts how many fall within the current window. O(n) per check
 * where n = requests in window (bounded by maxRequests).
 *
 * Memory-safe: expired entries are pruned on every check.
 */

export interface RateLimiterOptions {
  /** Max requests allowed within the window */
  maxRequests: number
  /** Window size in milliseconds */
  windowMs: number
}

export interface RateLimitResult {
  allowed: boolean
  /** Requests consumed in current window (including this one if allowed) */
  count: number
  /** Max requests per window */
  limit: number
  /** Remaining requests in current window */
  remaining: number
  /** Unix ms timestamp when the oldest entry in window expires (reset point) */
  resetAt: number
  /** Milliseconds until a retry would succeed (0 if allowed) */
  retryAfterMs: number
}

export class SlidingWindowRateLimiter {
  private readonly maxRequests: number
  private readonly windowMs: number
  /** key → sorted array of request timestamps */
  private readonly logs = new Map<string, number[]>()
  private pruneTimer: ReturnType<typeof setInterval> | null = null

  constructor(opts: RateLimiterOptions) {
    this.maxRequests = opts.maxRequests
    this.windowMs = opts.windowMs

    // Background prune every 60s to avoid unbounded memory growth
    // for keys that stop sending requests
    this.pruneTimer = setInterval(() => this.pruneAll(), 60_000)
    if (this.pruneTimer.unref) this.pruneTimer.unref()
  }

  /**
   * Check (and consume) a request for the given key.
   * Returns whether it's allowed + metadata for headers.
   */
  check(key: string, now: number = Date.now()): RateLimitResult {
    const windowStart = now - this.windowMs
    let timestamps = this.logs.get(key)

    if (!timestamps) {
      timestamps = []
      this.logs.set(key, timestamps)
    }

    // Prune expired entries (timestamps is sorted ascending)
    let pruneIdx = 0
    while (pruneIdx < timestamps.length && timestamps[pruneIdx] <= windowStart) {
      pruneIdx++
    }
    if (pruneIdx > 0) {
      timestamps.splice(0, pruneIdx)
    }

    const count = timestamps.length

    if (count >= this.maxRequests) {
      // Denied — oldest entry in window determines when a slot opens
      const oldestInWindow = timestamps[0]
      const resetAt = oldestInWindow + this.windowMs
      const retryAfterMs = Math.max(0, resetAt - now)

      return {
        allowed: false,
        count,
        limit: this.maxRequests,
        remaining: 0,
        resetAt,
        retryAfterMs,
      }
    }

    // Allowed — record this request
    timestamps.push(now)

    const newCount = count + 1
    const resetAt = timestamps[0] + this.windowMs

    return {
      allowed: true,
      count: newCount,
      limit: this.maxRequests,
      remaining: this.maxRequests - newCount,
      resetAt,
      retryAfterMs: 0,
    }
  }

  /** Remove all entries for a key */
  reset(key: string): void {
    this.logs.delete(key)
  }

  /** Number of tracked keys */
  get size(): number {
    return this.logs.size
  }

  /** Stop the background prune timer */
  destroy(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer)
      this.pruneTimer = null
    }
    this.logs.clear()
  }

  /** Prune all keys, removing expired timestamps and empty keys */
  private pruneAll(): void {
    const now = Date.now()
    const windowStart = now - this.windowMs

    for (const [key, timestamps] of this.logs) {
      let pruneIdx = 0
      while (pruneIdx < timestamps.length && timestamps[pruneIdx] <= windowStart) {
        pruneIdx++
      }
      if (pruneIdx > 0) {
        timestamps.splice(0, pruneIdx)
      }
      if (timestamps.length === 0) {
        this.logs.delete(key)
      }
    }
  }
}

// ── Fastify plugin ──────────────────────────────────────────────────

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

export interface RateLimitPluginOptions extends RateLimiterOptions {
  /** Extract key from request. Default: IP address */
  keyGenerator?: (req: FastifyRequest) => string
  /** Custom response when rate limited */
  onExceeded?: (req: FastifyRequest, reply: FastifyReply, result: RateLimitResult) => void
  /** Skip rate limiting for this request? */
  skip?: (req: FastifyRequest) => boolean
}

export async function rateLimitPlugin(
  fastify: FastifyInstance,
  opts: RateLimitPluginOptions,
): Promise<void> {
  const limiter = new SlidingWindowRateLimiter({
    maxRequests: opts.maxRequests,
    windowMs: opts.windowMs,
  })

  const keyGen = opts.keyGenerator ?? ((req: FastifyRequest) => req.ip)
  const skip = opts.skip ?? (() => false)

  fastify.addHook('onClose', () => limiter.destroy())

  fastify.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (skip(req)) return

    const key = keyGen(req)
    const result = limiter.check(key)

    // Always set informational headers
    reply.header('X-RateLimit-Limit', result.limit)
    reply.header('X-RateLimit-Remaining', Math.max(0, result.remaining))
    reply.header('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000))

    if (!result.allowed) {
      reply.header('Retry-After', Math.ceil(result.retryAfterMs / 1000))

      if (opts.onExceeded) {
        opts.onExceeded(req, reply, result)
        return
      }

      reply.code(429).send({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Try again in ${Math.ceil(result.retryAfterMs / 1000)}s`,
        retryAfter: Math.ceil(result.retryAfterMs / 1000),
      })
    }
  })
}
