'use client';

import React, { useState, useEffect } from 'react';
import { SectionTitle } from './shared';
import { useUIStore } from '@/stores/ui-store';

// ─── Models Tab ──────────────────────────────────────────────────────────────────

interface ModelDef {
  id: string;
  name: string;
  provider: string;
  providerIcon: string;
  contextK: number;
  priceIn?: number;  // $/M input tokens
  priceOut?: number; // $/M output tokens
  free?: boolean;
}

// Provider display metadata
const PROVIDER_META: Record<string, { icon: string; displayName: string }> = {
  anthropic: { icon: '🟠', displayName: 'Anthropic' },
  openai: { icon: '🟢', displayName: 'OpenAI' },
  'github-copilot': { icon: '🐙', displayName: 'GitHub Copilot' },
  ollama: { icon: '🦙', displayName: 'Ollama (local)' },
  'ollama-cluster': { icon: '🦙', displayName: 'Ollama Cluster' },
  google: { icon: '🔵', displayName: 'Google AI' },
  openrouter: { icon: '🔀', displayName: 'OpenRouter' },
  deepseek: { icon: '🐋', displayName: 'DeepSeek' },
  groq: { icon: '⚡', displayName: 'Groq' },
  mistral: { icon: '🇫🇷', displayName: 'Mistral' },
};

export default function ModelsTab() {
  const { selectedModel, setSelectedModel } = useUIStore();
  const [dailyTokensK, setDailyTokensK] = useState(100);
  const [allModels, setAllModels] = useState<ModelDef[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch models from providers API
  useEffect(() => {
    fetch('/api/config/providers')
      .then(r => r.json())
      .then((d: { data?: Array<{ id: string; name?: string; type?: string; models?: Array<any> }> }) => {
        const providers = d?.data ?? [];
        const models: ModelDef[] = [];
        for (const prov of providers) {
          const meta = PROVIDER_META[prov.id] ?? { icon: '🤖', displayName: prov.name ?? prov.id };
          const isLocal = ['ollama', 'local', 'lmstudio'].includes(prov.type ?? prov.id);
          for (const m of prov.models ?? []) {
            const modelId = typeof m === 'string' ? m : m.id;
            const modelName = typeof m === 'string' ? m : (m.name ?? m.id);
            models.push({
              id: `${prov.id}/${modelId}`,
              name: modelName,
              provider: meta.displayName,
              providerIcon: meta.icon,
              contextK: typeof m === 'object' ? (m.contextK ?? m.contextWindow ? Math.round((m.contextWindow ?? 128000) / 1000) : 128) : 128,
              priceIn: typeof m === 'object' ? (m.priceIn ?? m.pricing?.inputPerM) : undefined,
              priceOut: typeof m === 'object' ? (m.priceOut ?? m.pricing?.outputPerM) : undefined,
              free: isLocal,
            });
          }
        }
        setAllModels(models);
      })
      .catch(() => setAllModels([]))
      .finally(() => setLoading(false));
  }, []);

  const grouped = allModels.reduce<Record<string, ModelDef[]>>((acc, m) => {
    if (!acc[m.provider]) acc[m.provider] = [];
    acc[m.provider].push(m);
    return acc;
  }, {});

  const MAX_CONTEXT_K = 200;

  // Cost estimate for a model
  const estimateCost = (m: ModelDef) => {
    if (m.free || (!m.priceIn && !m.priceOut)) return null;
    // assume 70% input / 30% output split
    const totalTokens = dailyTokensK * 1000;
    const inputTokens = totalTokens * 0.7;
    const outputTokens = totalTokens * 0.3;
    const dailyCost = ((inputTokens / 1_000_000) * (m.priceIn ?? 0)) + ((outputTokens / 1_000_000) * (m.priceOut ?? 0));
    return dailyCost;
  };

  const formatCost = (c: number) => {
    if (c < 0.01) return '<$0.01';
    if (c < 1) return `$${c.toFixed(3)}`;
    return `$${c.toFixed(2)}`;
  };

  return (
    <div>
      <SectionTitle
        title="Models" aria-label="Models"
        desc="Available models from configured providers. Select a default model used in new sessions."
      />

      {/* Default model selector */}
      <div style={{
        background: 'var(--coral-subtle)', border: '1px solid rgba(255,107,107,0.25)',
        borderRadius: 'var(--radius-lg)', padding: '14px 16px', marginBottom: 20,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <span style={{ fontSize: 16 }}>🤖</span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--coral)', marginBottom: 2 }}>
            Default model
          </div>
          <div style={{ fontSize: 13, color: 'var(--text)' }}>
            {allModels.find((m) => m.id === selectedModel)?.name ?? 'None selected'}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-secondary)' }}>
          Used in ToolChips bar &amp; model selector
        </div>
      </div>

      {/* Cost preview calculator */}
      <div style={{
        background: 'var(--card-bg)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', padding: '14px 16px', marginBottom: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 14 }}>💰</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
            Cost Preview Calculator
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 4 }}>
            Adjust daily token usage to estimate costs
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            type="range"
            min={10}
            max={2000}
            step={10}
            value={dailyTokensK}
            onChange={(e) => setDailyTokensK(parseInt(e.target.value, 10))}
            style={{ flex: 1, accentColor: 'var(--coral)', cursor: 'pointer' }}
          />
          <span style={{
            fontSize: 12, fontWeight: 600, color: 'var(--coral)',
            fontFamily: 'var(--font-mono)', width: 80, textAlign: 'right',
          }}>
            {dailyTokensK}K tok/day
          </span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          ~{(dailyTokensK * 1000).toLocaleString()} tokens/day · 70% input / 30% output
        </div>
      </div>

      {/* Provider groups */}
      {Object.entries(grouped).map(([provider, models]) => (
        <div key={provider} style={{ marginBottom: 20 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)',
            textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8,
          }}>
            {models[0].providerIcon} {provider}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {models.map((model) => {
              const isSelected = selectedModel === model.id;
              const contextPct = Math.min(100, (model.contextK / MAX_CONTEXT_K) * 100);
              const dailyCost = estimateCost(model);
              return (
                <button
                  key={model.id}
                  onClick={() => setSelectedModel(model.id)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12,
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    background: isSelected ? 'var(--coral-subtle)' : 'var(--card-bg)',
                    border: `1px solid ${isSelected ? 'rgba(255,107,107,0.4)' : 'var(--border)'}`,
                    cursor: 'pointer', textAlign: 'left', transition: 'all 150ms', width: '100%',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-hover)';
                      (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
                      (e.currentTarget as HTMLButtonElement).style.background = 'var(--card-bg)';
                    }
                  }}
                >
                  {/* Radio dot */}
                  <div style={{
                    width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                    border: `2px solid ${isSelected ? 'var(--coral)' : 'var(--border)'}`,
                    background: isSelected ? 'var(--coral)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {isSelected && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: isSelected ? 'var(--coral)' : 'var(--text)' }}>
                      {model.name}
                    </div>

                    {/* Context window bar */}
                    <div style={{ marginTop: 6, marginBottom: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Context window</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                          {model.contextK >= 1000 ? `${(model.contextK / 1000).toFixed(0)}M` : `${model.contextK}K`} tokens
                        </span>
                      </div>
                      <div style={{
                        height: 4, width: '100%', borderRadius: 2,
                        background: 'var(--surface-hover)', overflow: 'hidden',
                      }}>
                        <div style={{
                          height: '100%', width: `${contextPct}%`,
                          borderRadius: 2,
                          background: isSelected
                            ? 'var(--coral)'
                            : contextPct >= 80 ? 'var(--green)' : contextPct >= 40 ? 'var(--yellow)' : 'var(--text-muted)',
                          transition: 'width 300ms ease',
                        }} />
                      </div>
                    </div>

                    {/* Cost preview */}
                    {dailyCost !== null && (
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                        💰 Est. {formatCost(dailyCost)}/day at {dailyTokensK}K tokens
                        <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
                          (in: ${model.priceIn}/M · out: ${model.priceOut}/M)
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Pricing badge */}
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    {model.free ? (
                      <span style={{
                        fontSize: 11, fontWeight: 600, color: 'var(--green)',
                        background: 'var(--green-subtle)', padding: '2px 8px', borderRadius: 'var(--radius-sm)',
                      }}>
                        FREE
                      </span>
                    ) : model.priceIn ? (
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 1 }}>per 1M tokens</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                          in: ${model.priceIn}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                          out: ${model.priceOut}
                        </div>
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>no pricing data</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Agent Assignments */}
      <AgentModelAssignments />
    </div>
  );
}

const AGENT_ASSIGNMENTS_API = process.env.NEXT_PUBLIC_API_URL ?? '/api';

function AgentModelAssignments() {
  const [agents, setAgents] = useState<Array<{ id: string; name: string; emoji: string; modelPreference: string; providerPreference: string }>>([]);

  useEffect(() => {
    fetch(`${AGENT_ASSIGNMENTS_API}/agents`)
      .then((r) => r.json())
      .then((d) => setAgents(d.data ?? []))
      .catch(() => {});
  }, []);

  if (agents.length === 0) return null;

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{
        fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)',
        textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 10,
      }}>
        🤖 Agent Model Assignments
      </div>
      <div style={{
        background: 'var(--card-bg)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', overflow: 'hidden',
      }}>
        {agents.map((agent, i) => {
          const hasCustom = !!(agent.modelPreference || agent.providerPreference);
          const modelLabel = hasCustom
            ? [agent.providerPreference, agent.modelPreference].filter(Boolean).join('/')
            : '(default)';
          return (
            <div
              key={agent.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 14px',
                borderBottom: i < agents.length - 1 ? '1px solid var(--border)' : 'none',
              }}
            >
              <span style={{ fontSize: 14 }}>{agent.emoji || '🤖'}</span>
              <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500, flex: 1 }}>
                {agent.name}
              </span>
              <span style={{
                fontSize: 11, fontFamily: 'var(--font-mono)',
                color: hasCustom ? 'var(--coral)' : 'var(--text-muted)',
                fontWeight: hasCustom ? 500 : 400,
              }}>
                {modelLabel}
              </span>
              {hasCustom && (
                <span style={{
                  fontSize: 9, padding: '1px 5px', borderRadius: 'var(--radius-sm)',
                  background: 'var(--coral-subtle)', color: 'var(--coral)',
                  fontWeight: 600, textTransform: 'uppercase',
                }}>
                  custom
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

