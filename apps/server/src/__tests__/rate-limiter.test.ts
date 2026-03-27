import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SlidingWindowRateLimiter } from '../../src/lib/rate-limiter'

describe('SlidingWindowRateLimiter', () => {
  let limiter: SlidingWindowRateLimiter

  afterEach(() => {
    limiter?.destroy()
  })

  describe('basic allow/deny', () => {
    beforeEach(() => {
      limiter = new SlidingWindowRateLimiter({ maxRequests: 3, windowMs: 1000 })
    })

    it('allows requests under the limit', () => {
      const r1 = limiter.check('a', 1000)
      expect(r1.allowed).toBe(true)
      expect(r1.count).toBe(1)
      expect(r1.remaining).toBe(2)

      const r2 = limiter.check('a', 1100)
      expect(r2.allowed).toBe(true)
      expect(r2.count).toBe(2)
      expect(r2.remaining).toBe(1)

      const r3 = limiter.check('a', 1200)
      expect(r3.allowed).toBe(true)
      expect(r3.count).toBe(3)
      expect(r3.remaining).toBe(0)
    })

    it('denies the request that exceeds the limit', () => {
      limiter.check('a', 1000)
      limiter.check('a', 1100)
      limiter.check('a', 1200)

      const r4 = limiter.check('a', 1300)
      expect(r4.allowed).toBe(false)
      expect(r4.count).toBe(3)
      expect(r4.remaining).toBe(0)
      expect(r4.retryAfterMs).toBeGreaterThan(0)
    })
  })

  describe('sliding window behavior', () => {
    beforeEach(() => {
      limiter = new SlidingWindowRateLimiter({ maxRequests: 2, windowMs: 1000 })
    })

    it('allows requests after oldest entry expires', () => {
      limiter.check('a', 1000)  // window: [1000]
      limiter.check('a', 1200)  // window: [1000, 1200]

      // At t=1300, window is [300..1300] → both still in
      const r = limiter.check('a', 1300)
      expect(r.allowed).toBe(false)

      // At t=2001, window is [1001..2001] → 1000 expired, 1200 still in
      const r2 = limiter.check('a', 2001)
      expect(r2.allowed).toBe(true)
      expect(r2.count).toBe(2) // 1200 + 2001
    })

    it('correctly slides — not fixed window reset', () => {
      limiter.check('a', 1000) // in
      limiter.check('a', 1500) // in
      // Full at t=1500

      // At t=1800 → window [800..1800], both still in
      expect(limiter.check('a', 1800).allowed).toBe(false)

      // At t=2001 → window [1001..2001], 1000 expired, 1500 in → 1 slot open
      expect(limiter.check('a', 2001).allowed).toBe(true)

      // Now [1500, 2001] → full
      expect(limiter.check('a', 2100).allowed).toBe(false)

      // At t=2501 → window [1501..2501], 1500 expired, 2001 in → 1 slot
      expect(limiter.check('a', 2501).allowed).toBe(true)
    })
  })

  describe('key isolation', () => {
    beforeEach(() => {
      limiter = new SlidingWindowRateLimiter({ maxRequests: 1, windowMs: 1000 })
    })

    it('tracks keys independently', () => {
      const r1 = limiter.check('user-1', 1000)
      expect(r1.allowed).toBe(true)

      // user-1 is full, but user-2 is separate
      const r2 = limiter.check('user-1', 1100)
      expect(r2.allowed).toBe(false)

      const r3 = limiter.check('user-2', 1100)
      expect(r3.allowed).toBe(true)
    })
  })

  describe('retryAfterMs / resetAt', () => {
    beforeEach(() => {
      limiter = new SlidingWindowRateLimiter({ maxRequests: 2, windowMs: 5000 })
    })

    it('returns correct retryAfterMs when denied', () => {
      limiter.check('a', 10000)
      limiter.check('a', 11000)

      const denied = limiter.check('a', 12000)
      expect(denied.allowed).toBe(false)
      // oldest is 10000, expires at 15000, now is 12000 → retryAfter = 3000ms
      expect(denied.retryAfterMs).toBe(3000)
      expect(denied.resetAt).toBe(15000)
    })

    it('returns retryAfterMs=0 when allowed', () => {
      const r = limiter.check('a', 10000)
      expect(r.retryAfterMs).toBe(0)
    })
  })

  describe('reset()', () => {
    it('clears entries for a key', () => {
      limiter = new SlidingWindowRateLimiter({ maxRequests: 1, windowMs: 60000 })

      limiter.check('a', 1000)
      expect(limiter.check('a', 1100).allowed).toBe(false)

      limiter.reset('a')

      expect(limiter.check('a', 1200).allowed).toBe(true)
    })
  })

  describe('size', () => {
    it('returns number of tracked keys', () => {
      limiter = new SlidingWindowRateLimiter({ maxRequests: 10, windowMs: 1000 })

      expect(limiter.size).toBe(0)
      limiter.check('a')
      expect(limiter.size).toBe(1)
      limiter.check('b')
      expect(limiter.size).toBe(2)
      limiter.reset('a')
      expect(limiter.size).toBe(1)
    })
  })

  describe('edge cases', () => {
    it('handles maxRequests=0 (deny all)', () => {
      limiter = new SlidingWindowRateLimiter({ maxRequests: 0, windowMs: 1000 })
      const r = limiter.check('a', 1000)
      expect(r.allowed).toBe(false)
    })

    it('handles burst at exact same timestamp', () => {
      limiter = new SlidingWindowRateLimiter({ maxRequests: 3, windowMs: 1000 })

      expect(limiter.check('a', 5000).allowed).toBe(true)
      expect(limiter.check('a', 5000).allowed).toBe(true)
      expect(limiter.check('a', 5000).allowed).toBe(true)
      expect(limiter.check('a', 5000).allowed).toBe(false)
    })

    it('handles very large window', () => {
      limiter = new SlidingWindowRateLimiter({ maxRequests: 1, windowMs: 86400000 }) // 24h
      expect(limiter.check('a', 0).allowed).toBe(true)
      expect(limiter.check('a', 43200000).allowed).toBe(false) // 12h later
      expect(limiter.check('a', 86400001).allowed).toBe(true)  // 24h+1ms later
    })
  })
})
