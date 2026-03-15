'use client';

import { useState, useEffect } from 'react';
import { useAgentStore } from '@/stores/agent-store';
import type { Agent, AgentCreateInput } from '@/stores/agent-store';

const API = process.env.NEXT_PUBLIC_API_URL ?? '/api';

interface AgentFormModalProps {
  agent?: Agent | null;
  onClose: () => void;
  onSaved?: (agent: Agent) => void;
}

// ── Agent Templates ───────────────────────────────────────────────────────────

const AGENT_TEMPLATES = [
  {
    id: 'assistant',
    emoji: '✨',
    name: 'Personal Assistant',
    role: 'General Assistant',
    prompt: 'You are a helpful personal assistant. You help with research, planning, writing, analysis, and everyday tasks. You are concise, accurate, and proactive.',
    desc: 'Your everyday AI — research, plan, write, organize',
  },
  {
    id: 'coder',
    emoji: '⚡',
    name: 'Coder',
    role: 'Full-stack Developer',
    prompt: 'You are an expert full-stack developer. You write clean, well-tested TypeScript code. You break complex tasks into small, incremental steps. You prefer simple solutions over clever ones.',
    desc: 'Write, debug, and review code',
  },
  {
    id: 'writer',
    emoji: '🎭',
    name: 'Writer',
    role: 'Content Writer',
    prompt: 'You are a skilled content writer. You write clear, engaging prose adapted to the audience. You structure content logically and vary tone as needed — from formal to conversational.',
    desc: 'Articles, emails, social posts, docs',
  },
  {
    id: 'analyst',
    emoji: '💎',
    name: 'Analyst',
    role: 'Data Analyst',
    prompt: 'You are a data analyst. You examine data carefully, identify patterns and anomalies, and present findings with clear summaries. You question assumptions and validate sources.',
    desc: 'Crunch numbers and find insights',
  },
  {
    id: 'researcher',
    emoji: '🦉',
    name: 'Researcher',
    role: 'Research Specialist',
    prompt: 'You are a thorough researcher. You search multiple sources, cross-reference facts, and deliver well-structured reports with citations. You distinguish opinion from evidence.',
    desc: 'Deep research with sources and citations',
  },
  {
    id: 'custom',
    emoji: '🤖',
    name: 'Custom',
    role: '',
    prompt: '',
    desc: 'Build from scratch',
  },
];

const EMOJI_OPTIONS = [
  '🤖', '🧠', '⚡', '🐕', '🦊', '🐱', '🦉', '🐙',
  '🔮', '🚀', '💎', '🌟', '🎯', '🛡️', '🌈', '☕',
  '🎭', '👾', '🦄', '🐝', '🌸', '🍀', '🔥', '✨',
];

interface ProviderInfo {
  id: string;
  name: string;
  type: string;
  status: string;
  models: Array<{ id: string; name: string }>;
}

export function AgentFormModal({ agent, onClose, onSaved }: AgentFormModalProps) {
  const createAgent = useAgentStore((s) => s.createAgent);
  const updateAgent = useAgentStore((s) => s.updateAgent);
  const isEdit = !!agent;

  // Step state: 'template' → 'form' (skip template step in edit mode)
  const [step, setStep] = useState<'template' | 'form'>(isEdit ? 'form' : 'template');
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(isEdit ? 'custom' : null);

  // Form fields
  const [name, setName] = useState(agent?.name ?? '');
  const [emoji, setEmoji] = useState(agent?.emoji ?? '🤖');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [role, setRole] = useState(agent?.role ?? '');
  const [providerPreference, setProviderPreference] = useState(agent?.providerPreference ?? '');
  const [modelPreference, setModelPreference] = useState(agent?.modelPreference ?? '');
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? '');
  const [type, setType] = useState<'super' | 'specialist'>(agent?.type ?? 'specialist');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Providers fetched from setup/status
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(true);

  // Fetch providers on mount
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${API}/setup/status`);
        const json = await res.json() as { data: { providers: ProviderInfo[] } };
        const connected = json.data.providers.filter(
          (p: ProviderInfo) => p.status === 'connected'
        );
        setProviders(connected);

        // Auto-select first provider if not set
        if (!providerPreference && connected.length > 0) {
          setProviderPreference(connected[0].id);
          if (connected[0].models[0] && !modelPreference) {
            setModelPreference(connected[0].models[0].id);
          }
        }
      } catch {
        /* server unreachable */
      } finally {
        setLoadingProviders(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedProvider = providers.find((p) => p.id === providerPreference);
  const availableModels = selectedProvider?.models ?? [];

  const handleSelectTemplate = (tplId: string) => {
    setSelectedTemplate(tplId);
    const tpl = AGENT_TEMPLATES.find((t) => t.id === tplId);
    if (tpl) {
      if (tpl.id !== 'custom') {
        setName(tpl.name);
        setRole(tpl.role);
        setSystemPrompt(tpl.prompt);
      }
      setEmoji(tpl.emoji);
    }
    setStep('form');
  };

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const payload: AgentCreateInput = {
        name: name.trim(), emoji, role: role.trim(), systemPrompt, type,
        providerPreference: providerPreference || undefined,
        modelPreference: modelPreference || undefined,
      };
      let saved: Agent;
      if (isEdit && agent) {
        saved = await updateAgent(agent.id, payload);
      } else {
        saved = await createAgent(payload);
      }
      onSaved?.(saved);
      onClose();
    } catch (e) {
      setError((e as Error).message ?? 'Failed to save agent');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 14px',
    background: 'var(--input-bg, #0D1117)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text)',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 150ms',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: 6,
    display: 'block',
  };

  const cardStyle: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: 14,
    cursor: 'pointer',
    textAlign: 'left' as const,
    transition: 'border-color 150ms, background 150ms',
  };

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1100,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
      />
      {/* Modal */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 1101,
          background: 'var(--card-bg, var(--surface))',
          border: '1px solid var(--border)',
          borderRadius: 14,
          padding: 0,
          width: step === 'template' ? 520 : 480,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 48px)',
          overflow: 'auto',
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ═══ Step 1: Template Selection ═══ */}
        {step === 'template' && (
          <div style={{ padding: 24 }}>
            <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
              🤖 Create Agent
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 20px' }}>
              Pick a template to get started, or build from scratch.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              {AGENT_TEMPLATES.map((tpl) => (
                <div
                  key={tpl.id}
                  onClick={() => handleSelectTemplate(tpl.id)}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--coral)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}
                  style={cardStyle}
                >
                  <div style={{ fontSize: 26, marginBottom: 6 }}>{tpl.emoji}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{tpl.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{tpl.desc}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                onClick={onClose}
                style={{
                  padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                  color: 'var(--text-muted)', background: 'transparent',
                  border: '1px solid var(--border)', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ═══ Step 2: Form ═══ */}
        {step === 'form' && (
          <div style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
              {!isEdit && (
                <button
                  onClick={() => setStep('template')}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 14, color: 'var(--text-muted)', padding: '4px 8px',
                    borderRadius: 6,
                  }}
                  title="Back to templates"
                >
                  ←
                </button>
              )}
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
                {isEdit ? '✏️ Edit Agent' : `${emoji} Configure Agent`}
              </h2>
            </div>

            {/* Name + Icon row */}
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Name *</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Coder, Researcher…"
                  style={inputStyle}
                  autoFocus
                />
              </div>
              <div>
                <label style={labelStyle}>Icon</label>
                <button
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  style={{
                    width: 44, height: 44, fontSize: 22, borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'var(--input-bg, #0D1117)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'border-color 150ms',
                  }}
                >
                  {emoji}
                </button>
              </div>
            </div>

            {/* Emoji picker grid */}
            {showEmojiPicker && (
              <div style={{
                display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 16,
                padding: 10, borderRadius: 10,
                background: 'var(--surface)', border: '1px solid var(--border)',
              }}>
                {EMOJI_OPTIONS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => { setEmoji(e); setShowEmojiPicker(false); }}
                    style={{
                      width: 34, height: 34, fontSize: 16, borderRadius: 8,
                      border: emoji === e ? '2px solid var(--coral)' : '2px solid transparent',
                      background: emoji === e ? 'var(--surface-hover)' : 'transparent',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 150ms',
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}

            {/* Role */}
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Role</label>
              <input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="e.g. Full-stack Developer, Research Specialist…"
                style={inputStyle}
              />
            </div>

            {/* System Prompt */}
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>System Prompt / Soul</label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Describe how this agent should behave, its personality, expertise, and communication style…"
                rows={4}
                style={{ ...inputStyle, resize: 'vertical', minHeight: 80, fontFamily: 'inherit' }}
              />
            </div>

            {/* Provider + Model (dropdowns from configured providers) */}
            <div style={{
              padding: 16, borderRadius: 10, marginBottom: 16,
              background: 'var(--surface)', border: '1px solid var(--border)',
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
                🔌 Model & Provider
              </div>

              {loadingProviders ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>
                  ⏳ Loading providers…
                </div>
              ) : providers.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--coral)', padding: '8px 0' }}>
                  ⚠️ No providers configured. Add one in Settings → Providers first.
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <label style={{ ...labelStyle, fontSize: 10 }}>Provider</label>
                    <select
                      value={providerPreference}
                      onChange={(e) => {
                        setProviderPreference(e.target.value);
                        const prov = providers.find((p) => p.id === e.target.value);
                        if (prov?.models[0]) setModelPreference(prov.models[0].id);
                        else setModelPreference('');
                      }}
                      style={{ ...inputStyle, cursor: 'pointer' }}
                    >
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <label style={{ ...labelStyle, fontSize: 10 }}>Model</label>
                    <select
                      value={modelPreference}
                      onChange={(e) => setModelPreference(e.target.value)}
                      style={{ ...inputStyle, cursor: 'pointer' }}
                    >
                      {availableModels.length === 0 && (
                        <option value="">No models available</option>
                      )}
                      {availableModels.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Type */}
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Type</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['specialist', 'super'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    style={{
                      flex: 1, padding: '10px 14px', borderRadius: 8,
                      border: type === t ? '2px solid var(--coral)' : '1px solid var(--border)',
                      background: type === t ? 'var(--coral-subtle)' : 'var(--surface)',
                      color: type === t ? 'var(--coral)' : 'var(--text-muted)',
                      cursor: 'pointer', fontSize: 13, fontWeight: type === t ? 600 : 400,
                      transition: 'all 150ms',
                    }}
                  >
                    {t === 'specialist' ? '🎯 Specialist' : '🌟 Super'}
                    <div style={{ fontSize: 10, marginTop: 2, opacity: 0.7 }}>
                      {t === 'specialist' ? 'Focused on one area' : 'Can orchestrate other agents'}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{ color: 'var(--coral)', fontSize: 13, marginBottom: 14, padding: '8px 12px', borderRadius: 8, background: 'var(--red-subtle)' }}>
                ⚠️ {error}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={onClose}
                style={{
                  padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                  color: 'var(--text-muted)', background: 'transparent',
                  border: '1px solid var(--border)', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving}
                style={{
                  padding: '10px 24px', borderRadius: 8, fontSize: 14, fontWeight: 600,
                  color: '#fff',
                  background: saving ? 'var(--text-muted)' : 'var(--coral)',
                  border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
                  transition: 'background 150ms, transform 100ms',
                }}
              >
                {saving ? '⏳ Saving…' : isEdit ? '✅ Save Changes' : '✨ Create Agent'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
