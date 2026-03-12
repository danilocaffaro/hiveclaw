import { describe, it, expect } from 'vitest';
import { classifyComplexity } from '../engine/smart-router.js';

describe('SmartRouter — classifyComplexity', () => {
  it('should route heartbeat to cheap tier', () => {
    const result = classifyComplexity({
      userMessage: 'Check if the gateway is healthy',
      historyLength: 0,
      isHeartbeat: true,
    });
    expect(result.tier).toBe('cheap');
    expect(result.reason.toLowerCase()).toContain('heartbeat');
  });

  it('should route cron to cheap tier', () => {
    const result = classifyComplexity({
      userMessage: 'Run daily report',
      historyLength: 1,
      isCron: true,
    });
    expect(result.tier).toBe('cheap');
  });

  it('should route short greeting to cheap tier', () => {
    const result = classifyComplexity({
      userMessage: 'hi',
      historyLength: 0,
    });
    expect(result.tier).toBe('cheap');
  });

  it('should route complex analysis to premium tier', () => {
    const result = classifyComplexity({
      userMessage: 'Please analyze and evaluate the architecture of this system, compare trade-offs, and design a better approach',
      historyLength: 5,
    });
    expect(result.tier).toBe('premium');
  });

  it('should route short message with minimal context to cheap tier', () => {
    const result = classifyComplexity({
      userMessage: 'What time is it?',
      historyLength: 0,
    });
    expect(result.tier).toBe('cheap');
  });

  it('should route general chat to standard tier', () => {
    const result = classifyComplexity({
      userMessage: 'Can you help me write a Python script to process CSV files?',
      historyLength: 3,
    });
    expect(result.tier).toBe('standard');
  });

  it('should respect agent-level tier override', () => {
    const result = classifyComplexity({
      userMessage: 'Analyze and compare all architectural patterns',
      historyLength: 50,
      agentTier: 'cheap',
    });
    expect(result.tier).toBe('cheap');
    expect(result.reason).toContain('Agent configured');
  });

  it('should route long context to premium tier', () => {
    const result = classifyComplexity({
      userMessage: 'Continue where we left off',
      historyLength: 10,
      totalContextTokens: 90_000,
    });
    expect(result.tier).toBe('premium');
    expect(result.reason).toContain('context');
  });
});
