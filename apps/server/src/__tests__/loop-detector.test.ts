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
    expect(result.severity).toBe('none');
  });

  // R20.2b: Graduated thresholds
  it('should warn at 3 identical calls (severity=warning)', () => {
    detector.recordToolCall('bash', { command: 'ls' });
    detector.recordToolCall('bash', { command: 'ls' });
    const result = detector.recordToolCall('bash', { command: 'ls' });
    expect(result.severity).toBe('warning');
    expect(result.loopDetected).toBe(false); // warning doesn't block
    expect(result.identicalCount).toBe(3);
  });

  it('should inject at 5 identical calls (severity=inject)', () => {
    for (let i = 0; i < 4; i++) detector.recordToolCall('bash', { command: 'ls' });
    const result = detector.recordToolCall('bash', { command: 'ls' });
    expect(result.severity).toBe('inject');
    expect(result.loopDetected).toBe(true);
    expect(result.type).toBe('tool_call');
    expect(result.identicalCount).toBe(5);
  });

  it('should circuit-break at 8 identical calls (severity=circuit_breaker)', () => {
    for (let i = 0; i < 7; i++) detector.recordToolCall('bash', { command: 'ls' });
    const result = detector.recordToolCall('bash', { command: 'ls' });
    expect(result.severity).toBe('circuit_breaker');
    expect(result.loopDetected).toBe(true);
    expect(result.identicalCount).toBe(8);
  });

  it('should NOT detect loop after only 2 identical calls', () => {
    detector.recordToolCall('bash', { command: 'ls' });
    const result = detector.recordToolCall('bash', { command: 'ls' });
    expect(result.loopDetected).toBe(false);
    expect(result.severity).toBe('none');
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
    expect(result.severity).toBe('none');
  });

  it('should detect response loop for highly similar responses', () => {
    const base = 'I searched the filesystem and found no matching files in the specified directory path you provided. Please verify the path is correct and the directory exists on your system.';
    detector.recordResponse(base + ' Try again with absolute path.');
    detector.recordResponse(base + ' Try again with full path.');
    const result = detector.recordResponse(base + ' Try again with complete path.');
    expect(result.loopDetected).toBe(true);
    expect(result.type).toBe('response');
    expect(result.severity).toBe('circuit_breaker');
  });

  it('should reset all state on reset()', () => {
    detector.recordToolCall('bash', { cmd: 'x' });
    detector.recordToolCall('bash', { cmd: 'x' });
    detector.reset();
    // After reset, 5 more should trigger inject (threshold = 5)
    for (let i = 0; i < 4; i++) detector.recordToolCall('bash', { cmd: 'x' });
    const result = detector.recordToolCall('bash', { cmd: 'x' });
    expect(result.loopDetected).toBe(true);
    expect(result.severity).toBe('inject');
  });

  // ── Decay tests ───────────────────────────────────────────────────────────

  describe('time-based decay', () => {
    it('should NOT detect loop when old calls have decayed (>5 min apart)', () => {
      let clock = 0;
      detector.setNowFn(() => clock);

      detector.recordToolCall('bash', { command: 'ls' });
      clock += 1000;
      detector.recordToolCall('bash', { command: 'ls' });

      clock += 6 * 60 * 1000; // 6min — old records decay

      const result = detector.recordToolCall('bash', { command: 'ls' });
      expect(result.loopDetected).toBe(false);
    });

    it('should detect loop when calls are within decay window', () => {
      let clock = 0;
      detector.setNowFn(() => clock);

      for (let i = 0; i < 4; i++) {
        detector.recordToolCall('bash', { command: 'ls' });
        clock += 10_000;
      }
      const result = detector.recordToolCall('bash', { command: 'ls' });
      expect(result.loopDetected).toBe(true);
      expect(result.severity).toBe('inject');
    });

    it('should decay response history for long-lived sessions', () => {
      let clock = 0;
      detector.setNowFn(() => clock);

      const base = 'I searched the filesystem and found no matching files in the specified directory path you provided. Please verify the path is correct and the directory exists on your system.';

      detector.recordResponse(base + ' Try with absolute path.');
      clock += 1000;
      detector.recordResponse(base + ' Try with full path.');
      clock += 6 * 60 * 1000;

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

      detector.recordToolCall('bash', { command: 'ls' });
      clock += 4 * 60 * 1000;
      detector.recordToolCall('bash', { command: 'ls' });
      clock += 2 * 60 * 1000;

      const result = detector.recordToolCall('bash', { command: 'ls' });
      expect(result.loopDetected).toBe(false);
    });
  });

  // ── R20.2b: Graduated severity tests ─────────────────────────────────────

  describe('graduated severity', () => {
    it('should escalate: none → warning → inject → circuit_breaker', () => {
      // 1-2: none
      expect(detector.recordToolCall('bash', { cmd: 'x' }).severity).toBe('none');
      expect(detector.recordToolCall('bash', { cmd: 'x' }).severity).toBe('none');
      // 3: warning
      expect(detector.recordToolCall('bash', { cmd: 'x' }).severity).toBe('warning');
      // 4: still warning
      expect(detector.recordToolCall('bash', { cmd: 'x' }).severity).toBe('warning');
      // 5: inject
      expect(detector.recordToolCall('bash', { cmd: 'x' }).severity).toBe('inject');
      // 6-7: still inject
      expect(detector.recordToolCall('bash', { cmd: 'x' }).severity).toBe('inject');
      expect(detector.recordToolCall('bash', { cmd: 'x' }).severity).toBe('inject');
      // 8: circuit_breaker
      expect(detector.recordToolCall('bash', { cmd: 'x' }).severity).toBe('circuit_breaker');
    });

    it('should return identicalCount on detected loops', () => {
      for (let i = 0; i < 4; i++) detector.recordToolCall('bash', { cmd: 'x' });
      const result = detector.recordToolCall('bash', { cmd: 'x' });
      expect(result.identicalCount).toBe(5);
    });
  });
});
