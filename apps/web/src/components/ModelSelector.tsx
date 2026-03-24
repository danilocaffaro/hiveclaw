'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { useSessionStore } from '@/stores/session-store';
import { useAgentStore } from '@/stores/agent-store';

// ─── Types ───────────────────────────────────────────────────────────────────────

interface ModelDef {
  id: string;
  name: string;
  provider: string;
  providerIcon: string;
  providerColor: string;
  contextK: number;
  priceIn?: number;
  priceOut?: number;
  free?: boolean;
}

// Provider display metadata — cosmetic only, NOT model lists
const PROVIDER_META: Record<string, { icon: string; color: string }> = {
  anthropic: { icon: '🟠', color: '#D97706' },
  openai: { icon: '🟢', color: '#10B981' },
  'github-copilot': { icon: '🐙', color: '#A371F7' },
  ollama: { icon: '🦙', color: 'var(--green)' },
  google: { icon: '🔵', color: '#4285F4' },
  openrouter: { icon: '🔀', color: '#A855F7' },
  deepseek: { icon: '🐋', color: '#0EA5E9' },
  groq: { icon: '⚡', color: '#F97316' },
  mistral: { icon: '🇫🇷', color: '#F97316' },
};

function getProviderMeta(providerId: string) {
  return PROVIDER_META[providerId] ?? { icon: '🤖', color: 'var(--text-secondary)' };
}

// ─── Component ───────────────────────────────────────────────────────────────────

export default function ModelSelector() {
  const { selectedModel, setSelectedModel } = useUIStore();
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelDef[]>([]);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  // Get active agent's model preference to sync selector
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const agents = useAgentStore((s) => s.agents);
  const updateAgent = useAgentStore((s) => s.updateAgent);
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeAgent = activeSession?.agent_id
    ? agents.find((a) => a.id === activeSession.agent_id)
    : null;

  // Fetch models from API on mount
  useEffect(() => {
    let cancelled = false;
    async function fetchModels() {
      try {
        const res = await fetch('/api/config/providers');
        if (!res.ok) return;
        const { data: providers } = await res.json();
        const fetched: ModelDef[] = [];
        for (const prov of providers) {
          // Only show models from configured/connected providers (skip not_configured)
          if (prov.status === 'not_configured') continue;
          const meta = getProviderMeta(prov.id);
          const isLocal = ['ollama', 'local', 'lmstudio'].includes(prov.type ?? prov.id);
          for (const m of prov.models ?? []) {
            const modelId = typeof m === 'string' ? m : m.id;
            const modelName = typeof m === 'string' ? m : (m.name ?? m.id);
            fetched.push({
              id: `${prov.id}/${modelId}`,
              name: modelName,
              provider: prov.name ?? prov.id,
              providerIcon: meta.icon,
              providerColor: meta.color,
              contextK: typeof m === 'object' ? (m.contextK ?? 128) : 128,
              priceIn: typeof m === 'object' ? m.priceIn : undefined,
              priceOut: typeof m === 'object' ? m.priceOut : undefined,
              free: isLocal,
            });
          }
        }
        if (!cancelled) {
          setModels(fetched);
          // If selected model is not in the list, auto-select a good default
          if (fetched.length > 0 && !fetched.find((m) => m.id === selectedModel)) {
            // Prefer best-quality models in priority order, covering all major providers
            const preferred = [
              'github-copilot/claude-sonnet-4.6',
              'github-copilot/claude-opus-4.6',
              'anthropic/claude-sonnet-4-6',
              'anthropic/claude-sonnet-4-6-20250725',
              'anthropic/claude-opus-4-6',
              'anthropic/claude-opus-4-6-20250725',
              'anthropic/claude-sonnet-4-5-20250514',
              'anthropic/claude-haiku-4-5',
              'anthropic/claude-haiku-4-5-20251001',
              'openai/gpt-4o',
              'google/gemini-2.5-pro',
              'google/gemini-2.5-flash',
              'deepseek/deepseek-chat',
            ];
            const best = preferred.find((p) => fetched.some((m) => m.id === p));
            // Fallback: pick first non-local model, then first available
            const nonLocal = fetched.find((m) => !['ollama', 'local', 'lmstudio'].some(l => m.provider.toLowerCase().includes(l)));
            setSelectedModel(best ?? nonLocal?.id ?? fetched[0].id);
          }
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }
    fetchModels();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync selector with active agent's model preference
  useEffect(() => {
    if (!activeAgent?.modelPreference || models.length === 0) return;
    const agentModelId = activeAgent.modelPreference;
    const provId = activeAgent.providerPreference ?? '';
    // Try exact match: "provider/model"
    const fullId = `${provId}/${agentModelId}`;
    const match = models.find((m) => m.id === fullId) ?? models.find((m) => m.id.endsWith(`/${agentModelId}`));
    if (match && match.id !== selectedModel) {
      setSelectedModel(match.id);
    }
  }, [activeAgent?.modelPreference, activeAgent?.providerPreference, models, selectedModel, setSelectedModel]);

  // External agents run on their own infrastructure — HiveClaw doesn't control their model
  if (activeAgent?.isExternal) {
    return (
      <div style={{ position: 'relative', width: '100%' }}>
        <button
          disabled
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 10px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--input-bg)',
            border: '1px solid var(--border)',
            color: 'var(--text-muted)',
            fontSize: 13,
            cursor: 'default',
          }}
        >
          <span style={{ fontSize: 14, flexShrink: 0 }}>{activeAgent.emoji ?? '🌐'}</span>
          <span style={{ flex: 1, fontSize: 12, opacity: 0.7 }}>External Agent</span>
        </button>
      </div>
    );
  }

  const currentModel = models.find((m) => m.id === selectedModel) ?? models[0];

  // Group by provider
  const grouped = models.reduce<Record<string, ModelDef[]>>((acc, m) => {
    if (!acc[m.provider]) acc[m.provider] = [];
    acc[m.provider].push(m);
    return acc;
  }, {});

  // Close on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (loading || !currentModel) {
    const isEmpty = !loading && models.length === 0;
    return (
      <div style={{ position: 'relative', width: '100%' }}>
        <button
          disabled
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 10px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--input-bg)',
            border: '1px solid var(--border)',
            color: 'var(--text-muted)',
            fontSize: 13,
            cursor: 'default',
          }}
        >
          <span style={{ fontSize: 14, flexShrink: 0 }}>{isEmpty ? '⚠️' : '⏳'}</span>
          <span style={{ flex: 1, fontSize: 12 }}>{isEmpty ? 'No models — add a provider' : 'Loading models...'}</span>
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      {/* Trigger */}
      <button
        onClick={() => {
          if (!open && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            setDropdownStyle({
              position: 'fixed',
              bottom: window.innerHeight - rect.top + 6,
              left: rect.left,
              width: rect.width,
            });
          }
          setOpen((v) => !v);
        }}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 10px',
          borderRadius: 'var(--radius-md)',
          background: open ? 'var(--surface-hover)' : 'var(--input-bg)',
          border: `1px solid ${open ? 'var(--coral)' : 'var(--border)'}`,
          color: 'var(--text)',
          fontSize: 13,
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'all 150ms',
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.borderColor = 'var(--border-hover)';
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.borderColor = 'var(--border)';
        }}
      >
        <span style={{ fontSize: 14, flexShrink: 0 }}>{activeAgent?.emoji ?? currentModel.providerIcon}</span>
        <span
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 12,
          }}
        >
          {currentModel.name}
        </span>
        <span
          style={{
            color: 'var(--text-secondary)',
            fontSize: 10,
            transition: 'transform 150ms',
            transform: open ? 'rotate(180deg)' : 'rotate(0)',
            flexShrink: 0,
          }}
        >
          ▾
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            ...dropdownStyle,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
            zIndex: 9999,
            overflow: 'hidden',
            animation: 'dropUp 120ms ease',
            maxHeight: 320,
            overflowY: 'auto',
          }}
        >
          {Object.entries(grouped).map(([provider, provModels], gi) => (
            <div key={provider}>
              {/* Provider header */}
              <div
                style={{
                  padding: '7px 12px 4px',
                  fontSize: 10,
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.6px',
                  borderTop: gi > 0 ? '1px solid var(--border)' : 'none',
                }}
              >
                {provModels[0].providerIcon} {provider}
              </div>

              {/* Model items */}
              {provModels.map((model) => {
                const isSelected = selectedModel === model.id;
                return (
                  <button
                    key={model.id}
                    onClick={() => {
                      setSelectedModel(model.id);
                      setOpen(false);
                      // Persist model selection to active agent
                      if (activeAgent?.id) {
                        const [providerId, ...modelParts] = model.id.split('/');
                        const modelId = modelParts.join('/');
                        void updateAgent(activeAgent.id, {
                          modelPreference: modelId,
                          providerPreference: providerId,
                        });
                      }
                    }}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 12px',
                      background: isSelected ? 'var(--coral-subtle)' : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'background 100ms',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected)
                        (e.currentTarget as HTMLButtonElement).style.background =
                          'var(--surface-hover)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected)
                        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                    }}
                  >
                    {/* Selection dot */}
                    <div
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        border: `2px solid ${isSelected ? 'var(--coral)' : 'var(--border)'}`,
                        background: isSelected ? 'var(--coral)' : 'transparent',
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {isSelected && (
                        <div
                          style={{
                            width: 5,
                            height: 5,
                            borderRadius: '50%',
                            background: '#fff',
                          }}
                        />
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: isSelected ? 600 : 400,
                          color: isSelected ? 'var(--coral)' : 'var(--text)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {model.name}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                        {model.contextK}K ctx
                        {model.free && (
                          <span
                            style={{
                              marginLeft: 6,
                              fontSize: 9,
                              fontWeight: 700,
                              color: 'var(--green)',
                              background: 'var(--green-subtle)',
                              padding: '0 4px',
                              borderRadius: 'var(--radius-sm)',
                            }}
                          >
                            LOCAL
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Price badge */}
                    <div style={{ flexShrink: 0 }}>
                      {model.free ? (
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            color: 'var(--green)',
                            background: 'var(--green-subtle)',
                            padding: '1px 5px',
                            borderRadius: 'var(--radius-sm)',
                          }}
                        >
                          FREE
                        </span>
                      ) : model.priceIn ? (
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          ${model.priceIn}/M
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}

          {models.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              No models configured. Add a provider in Settings.
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes dropUp {
          from { opacity: 0; transform: translateY(6px) }
          to   { opacity: 1; transform: translateY(0) }
        }
      `}</style>
    </div>
  );
}
