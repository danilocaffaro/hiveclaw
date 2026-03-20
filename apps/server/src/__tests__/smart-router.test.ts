import { describe, it, expect } from 'vitest';
import {
  classifyComplexity,
  getModelQuality,
  qualityToTier,
  selectModelForTier,
  buildTierConfig,
} from '../engine/smart-router.js';

// ─── Mock ProviderRepository ────────────────────────────────────────────────────

function mockProviders(models: Array<{ providerId: string; modelId: string }>) {
  const providers = new Map<string, { id: string; enabled: boolean; models: string[] }>();
  for (const m of models) {
    const existing = providers.get(m.providerId);
    if (existing) {
      existing.models.push(m.modelId);
    } else {
      providers.set(m.providerId, { id: m.providerId, enabled: true, models: [m.modelId] });
    }
  }
  return { list: () => [...providers.values()] } as any;
}

// ─── Classification (3 rules) ───────────────────────────────────────────────────

describe('SmartRouter — classifyComplexity', () => {
  it('heartbeat → cheap', () => {
    const r = classifyComplexity({ userMessage: 'ping', historyLength: 0, isHeartbeat: true });
    expect(r.tier).toBe('cheap');
  });

  it('cron → cheap', () => {
    const r = classifyComplexity({ userMessage: 'run', historyLength: 0, isCron: true });
    expect(r.tier).toBe('cheap');
  });

  it('complex patterns (2+) → premium', () => {
    const r = classifyComplexity({
      userMessage: 'Analyze the architecture and evaluate trade-offs',
      historyLength: 5,
    });
    expect(r.tier).toBe('premium');
  });

  it('large context → premium', () => {
    const r = classifyComplexity({
      userMessage: 'Continue',
      historyLength: 10,
      totalContextTokens: 90_000,
    });
    expect(r.tier).toBe('premium');
  });

  it('everything else → standard', () => {
    const r = classifyComplexity({
      userMessage: 'Help me write a Python script',
      historyLength: 3,
    });
    expect(r.tier).toBe('standard');
  });

  it('agent override wins', () => {
    const r = classifyComplexity({
      userMessage: 'Analyze everything in detail',
      historyLength: 50,
      agentTier: 'cheap',
    });
    expect(r.tier).toBe('cheap');
  });

  it('system task override', () => {
    const r = classifyComplexity({
      userMessage: 'summarize this',
      historyLength: 0,
      systemTask: 'compaction',
    });
    expect(r.tier).toBe('standard'); // compaction maps to standard
  });
});

// ─── Quality Scores ─────────────────────────────────────────────────────────────

describe('SmartRouter — getModelQuality', () => {
  it('exact match', () => {
    expect(getModelQuality('anthropic', 'claude-opus-4')).toBe(95);
    expect(getModelQuality('openai', 'gpt-4o-mini')).toBe(72);
  });

  it('fuzzy match', () => {
    expect(getModelQuality('anthropic', 'claude-sonnet-4-5-20250929')).toBe(88);
  });

  it('infer from pricing for unknown', () => {
    const q = getModelQuality('ollama', 'some-unknown-local');
    expect(q).toBe(40); // free = 40
  });
});

describe('SmartRouter — qualityToTier', () => {
  it('maps correctly', () => {
    expect(qualityToTier(95)).toBe('premium');
    expect(qualityToTier(80)).toBe('premium');
    expect(qualityToTier(70)).toBe('standard');
    expect(qualityToTier(55)).toBe('standard');
    expect(qualityToTier(40)).toBe('cheap');
  });
});

// ─── Selection ──────────────────────────────────────────────────────────────────

describe('SmartRouter — selectModelForTier', () => {
  it('picks cheapest above floor', () => {
    const providers = mockProviders([
      { providerId: 'openai', modelId: 'gpt-4o' },       // q90, expensive
      { providerId: 'openai', modelId: 'gpt-4o-mini' },  // q72, cheap
      { providerId: 'anthropic', modelId: 'claude-opus-4' }, // q95, very expensive
    ]);
    const r = selectModelForTier('standard', providers); // floor 50
    expect(r!.modelId).toBe('gpt-4o-mini'); // cheapest that meets 50
    expect(r!.meetsFloor).toBe(true);
  });

  it('warns when nothing meets floor', () => {
    const providers = mockProviders([
      { providerId: 'ollama', modelId: 'llama3.2:3b' },  // q30
      { providerId: 'ollama', modelId: 'gemma2:2b' },    // q28
    ]);
    const r = selectModelForTier('premium', providers); // floor 80
    expect(r!.meetsFloor).toBe(false);
    expect(r!.qualityWarning).toContain('Quality warning');
    expect(r!.modelId).toBe('llama3.2:3b'); // best available
  });

  it('returns null when no providers', () => {
    expect(selectModelForTier('standard', mockProviders([]))).toBeNull();
  });

  it('heartbeat picks free model', () => {
    const providers = mockProviders([
      { providerId: 'ollama', modelId: 'qwen2.5:7b' },  // q42, free
      { providerId: 'openai', modelId: 'gpt-4o' },       // q90, paid
    ]);
    const r = selectModelForTier('cheap', providers); // floor 20
    expect(r!.modelId).toBe('qwen2.5:7b'); // free, meets floor
  });
});

// ─── buildTierConfig ────────────────────────────────────────────────────────────

describe('SmartRouter — buildTierConfig', () => {
  it('builds from quality scores', () => {
    const providers = mockProviders([
      { providerId: 'openai', modelId: 'gpt-4o' },
      { providerId: 'openai', modelId: 'gpt-4o-mini' },
      { providerId: 'ollama', modelId: 'qwen2.5:7b' },
    ]);
    const c = buildTierConfig(providers);
    expect(c.cheap?.modelId).toBe('qwen2.5:7b');
    expect(c.standard?.modelId).toBe('gpt-4o-mini');
    expect(c.premium?.modelId).toBe('gpt-4o');
  });

  it('fills standard from premium', () => {
    const providers = mockProviders([{ providerId: 'openai', modelId: 'gpt-4o' }]);
    const c = buildTierConfig(providers);
    expect(c.premium?.modelId).toBe('gpt-4o');
    expect(c.standard?.modelId).toBe('gpt-4o');
  });
});
