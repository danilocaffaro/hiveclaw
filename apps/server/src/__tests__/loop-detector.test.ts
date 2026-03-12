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

  it('should detect tool call loop after 3 identical calls', () => {
    detector.recordToolCall('bash', { command: 'ls' });
    detector.recordToolCall('bash', { command: 'ls' });
    const result = detector.recordToolCall('bash', { command: 'ls' });
    expect(result.loopDetected).toBe(true);
    expect(result.type).toBe('tool_call');
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
    // After reset, 3 more should trigger fresh count
    detector.recordToolCall('bash', { cmd: 'x' });
    detector.recordToolCall('bash', { cmd: 'x' });
    const result = detector.recordToolCall('bash', { cmd: 'x' });
    expect(result.loopDetected).toBe(true); // fresh count → still triggers at 3
  });
});
