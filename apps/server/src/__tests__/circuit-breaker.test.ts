import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CircuitBreaker } from '../engine/circuit-breaker.js';

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 500 });
  });

  it('should allow execution when no failures recorded', () => {
    expect(cb.canExecute('job-1')).toBe(true);
  });

  it('should remain closed after 2 failures', () => {
    cb.recordFailure('job-1');
    cb.recordFailure('job-1');
    expect(cb.canExecute('job-1')).toBe(true);
    expect(cb.getState('job-1')?.state).toBe('closed');
  });

  it('should open circuit after threshold failures', () => {
    cb.recordFailure('job-1');
    cb.recordFailure('job-1');
    cb.recordFailure('job-1');
    expect(cb.canExecute('job-1')).toBe(false);
    expect(cb.getState('job-1')?.state).toBe('open');
  });

  it('should reset to closed on success', () => {
    cb.recordFailure('job-1');
    cb.recordFailure('job-1');
    cb.recordSuccess('job-1');
    expect(cb.canExecute('job-1')).toBe(true);
    expect(cb.getState('job-1')?.state).toBe('closed');
  });

  it('should transition to half-open after cooldown', async () => {
    cb.recordFailure('job-1');
    cb.recordFailure('job-1');
    cb.recordFailure('job-1');
    expect(cb.canExecute('job-1')).toBe(false);

    // Wait for cooldown
    await new Promise(r => setTimeout(r, 600));
    expect(cb.canExecute('job-1')).toBe(true); // half-open allows one try
    expect(cb.getState('job-1')?.state).toBe('half-open');
  });

  it('should re-open from half-open on failure', async () => {
    cb.recordFailure('job-1');
    cb.recordFailure('job-1');
    cb.recordFailure('job-1');

    await new Promise(r => setTimeout(r, 600)); // wait for half-open
    cb.canExecute('job-1'); // transitions to half-open

    cb.recordFailure('job-1', 'retry failed');
    expect(cb.getState('job-1')?.state).toBe('open');
  });

  it('should close from half-open on success', async () => {
    cb.recordFailure('job-1');
    cb.recordFailure('job-1');
    cb.recordFailure('job-1');

    await new Promise(r => setTimeout(r, 600));
    cb.canExecute('job-1'); // → half-open

    cb.recordSuccess('job-1');
    expect(cb.getState('job-1')?.state).toBe('closed');
  });

  it('should manually reset a circuit', () => {
    cb.recordFailure('job-1');
    cb.recordFailure('job-1');
    cb.recordFailure('job-1');
    cb.reset('job-1');
    expect(cb.canExecute('job-1')).toBe(true);
    expect(cb.getState('job-1')).toBeNull();
  });

  it('should track multiple independent circuits', () => {
    cb.recordFailure('job-a');
    cb.recordFailure('job-a');
    cb.recordFailure('job-a');

    expect(cb.canExecute('job-a')).toBe(false);
    expect(cb.canExecute('job-b')).toBe(true); // independent
  });

  it('should list all circuits', () => {
    cb.recordFailure('job-x');
    cb.recordFailure('job-y');
    const all = cb.listAll();
    expect(all.length).toBe(2);
    expect(all.map(c => c.key)).toContain('job-x');
  });
});
