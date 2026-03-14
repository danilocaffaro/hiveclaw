import { describe, it, expect, beforeEach } from 'vitest';
import { LoopDetector } from '../engine/loop-detector.js';

describe('LoopDetector', () => {
  let detector: LoopDetector;

  beforeEach(() => {
    detector = new LoopDetector();
  });

  it('should not detect loop on first tool call', () => {
    const result = detector.recordToolCall('bash', { command: 'ls' });
    expect(result.loopDetected).toBe(false);
  });

  it('should detect tool call loop after 5 identical calls', () => {
    detector.recordToolCall('bash', { command: 'ls' });
    detector.recordToolCall('bash', { command: 'ls' });
    detector.recordToolCall('bash', { command: 'ls' });
    detector.recordToolCall('bash', { command: 'ls' });
    const result = detector.recordToolCall('bash', { command: 'ls' });
    expect(result.loopDetected).toBe(true);
    expect(result.type).toBe('tool_call');
  });

  it('should NOT detect loop after only 4 identical calls (threshold is 5)', () => {
    detector.recordToolCall('bash', { command: 'ls' });
    detector.recordToolCall('bash', { command: 'ls' });
    detector.recordToolCall('bash', { command: 'ls' });
    const result = detector.recordToolCall('bash', { command: 'ls' });
    expect(result.loopDetected).toBe(false);
  });

  it('should NOT detect loop for same tool with different input', () => {
    detector.recordToolCall('read', { path: '/a.ts' });
    detector.recordToolCall('read', { path: '/b.ts' });
    const result = detector.recordToolCall('read', { path: '/c.ts' });
    expect(result.loopDetected).toBe(false);
  });

  it('should NOT detect loop for different tools with same input', () => {
    detector.recordToolCall('read', { path: '/a.ts' });
    detector.recordToolCall('glob', { path: '/a.ts' });
    const result = detector.recordToolCall('grep', { path: '/a.ts' });
    expect(result.loopDetected).toBe(false);
  });

  it('should not detect response loop on short/unique text', () => {
    const result = detector.recordResponse('Hello! How can I help you today?');
    expect(result.loopDetected).toBe(false);
  });

  it('should detect response loop for highly similar responses', () => {
    // Use nearly identical long texts to guarantee Jaccard > 0.85
    const base = 'I searched the filesystem and found no matching files in the specified directory path you provided. Please verify the path is correct and the directory exists on your system.';
    detector.recordResponse(base + ' Try again with absolute path.');
    detector.recordResponse(base + ' Try again with full path.');
    const result = detector.recordResponse(base + ' Try again with complete path.');
    expect(result.loopDetected).toBe(true);
    expect(result.type).toBe('response');
  });

  it('should reset all state on reset()', () => {
    detector.recordToolCall('bash', { cmd: 'x' });
    detector.recordToolCall('bash', { cmd: 'x' });
    detector.reset();
    // After reset, 5 more should trigger fresh count (threshold = 5)
    detector.recordToolCall('bash', { cmd: 'x' });
    detector.recordToolCall('bash', { cmd: 'x' });
    detector.recordToolCall('bash', { cmd: 'x' });
    detector.recordToolCall('bash', { cmd: 'x' });
    const result = detector.recordToolCall('bash', { cmd: 'x' });
    expect(result.loopDetected).toBe(true); // fresh count → triggers at 5
  });

  // ── Decay tests ───────────────────────────────────────────────────────────

  describe('time-based decay', () => {
    it('should NOT detect loop when old calls have decayed (>5 min apart)', () => {
      let clock = 0;
      detector.setNowFn(() => clock);

      // Two calls at t=0
      detector.recordToolCall('bash', { command: 'ls' });
      clock += 1000; // +1s
      detector.recordToolCall('bash', { command: 'ls' });

      // Jump 6 minutes — old records decay
      clock += 6 * 60 * 1000;

      // Third call should NOT trigger — the first two decayed
      const result = detector.recordToolCall('bash', { command: 'ls' });
      expect(result.loopDetected).toBe(false);
    });

    it('should detect loop when calls are within decay window', () => {
      let clock = 0;
      detector.setNowFn(() => clock);

      // Five calls within 1 minute (threshold = 5)
      detector.recordToolCall('bash', { command: 'ls' });
      clock += 10_000; // +10s
      detector.recordToolCall('bash', { command: 'ls' });
      clock += 10_000; // +10s
      detector.recordToolCall('bash', { command: 'ls' });
      clock += 10_000; // +10s
      detector.recordToolCall('bash', { command: 'ls' });
      clock += 10_000; // +10s
      const result = detector.recordToolCall('bash', { command: 'ls' });
      expect(result.loopDetected).toBe(true);
    });

    it('should decay response history for long-lived sessions', () => {
      let clock = 0;
      detector.setNowFn(() => clock);

      const base = 'I searched the filesystem and found no matching files in the specified directory path you provided. Please verify the path is correct and the directory exists on your system.';

      // Two similar responses at t=0
      detector.recordResponse(base + ' Try with absolute path.');
      clock += 1000;
      detector.recordResponse(base + ' Try with full path.');

      // Jump 6 minutes — old responses decay
      clock += 6 * 60 * 1000;

      // Third similar response should NOT trigger — the first two decayed
      const result = detector.recordResponse(base + ' Try with complete path.');
      expect(result.loopDetected).toBe(false);
    });

    it('should still detect response loop within decay window', () => {
      let clock = 0;
      detector.setNowFn(() => clock);

      const base = 'I searched the filesystem and found no matching files in the specified directory path you provided. Please verify the path is correct and the directory exists on your system.';

      detector.recordResponse(base + ' Try again with absolute path.');
      clock += 5_000;
      detector.recordResponse(base + ' Try again with full path.');
      clock += 5_000;
      const result = detector.recordResponse(base + ' Try again with complete path.');
      expect(result.loopDetected).toBe(true);
    });

    it('should partially decay — keep recent, drop old', () => {
      let clock = 0;
      detector.setNowFn(() => clock);

      // First call at t=0
      detector.recordToolCall('bash', { command: 'ls' });

      // Jump 4 min (within window)
      clock += 4 * 60 * 1000;
      detector.recordToolCall('bash', { command: 'ls' });

      // Jump another 2 min (first call is now 6 min old — decayed)
      clock += 2 * 60 * 1000;
      // Only 1 recent call survives → third should NOT trigger
      const result = detector.recordToolCall('bash', { command: 'ls' });
      expect(result.loopDetected).toBe(false);
    });
  });
});
