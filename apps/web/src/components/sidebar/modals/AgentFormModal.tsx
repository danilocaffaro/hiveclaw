'use client';

import { useState } from 'react';
import { useAgentStore } from '@/stores/agent-store';
import type { Agent, AgentCreateInput } from '@/stores/agent-store';

interface AgentFormModalProps {
  agent?: Agent | null;
  onClose: () => void;
  onSaved?: (agent: Agent) => void;
}

export function AgentFormModal({ agent, onClose, onSaved }: AgentFormModalProps) {
  const createAgent = useAgentStore((s) => s.createAgent);
  const updateAgent = useAgentStore((s) => s.updateAgent);
  const isEdit = !!agent;

  const [name, setName] = useState(agent?.name ?? '');
  const [emoji, setEmoji] = useState(agent?.emoji ?? '🤖');
  const [role, setRole] = useState(agent?.role ?? '');
  const [providerPreference, setProviderPreference] = useState(agent?.providerPreference ?? '');
  const [modelPreference, setModelPreference] = useState(agent?.modelPreference ?? '');
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? '');
  const [type, setType] = useState<'super' | 'specialist'>(agent?.type ?? 'specialist');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
    padding: '7px 10px',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    color: 'var(--text)',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: 4,
    display: 'block',
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
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 24,
          width: 400,
          maxWidth: 'calc(100vw - 32px)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.7)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 20px', fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
          {isEdit ? '✏️ Edit Agent' : '🤖 Create Agent'}
        </h2>

        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <div style={{ flex: '0 0 72px' }}>
            <label style={labelStyle}>Emoji</label>
            <input
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              maxLength={4}
              style={{ ...inputStyle, textAlign: 'center', fontSize: 18 }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Agent name"
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Role</label>
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. Backend Engineer, Researcher…"
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Provider</label>
          <input
            value={providerPreference}
            onChange={(e) => setProviderPreference(e.target.value)}
            placeholder="e.g. anthropic, openai, github-copilot, google, openrouter…"
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Model</label>
          <input
            value={modelPreference}
            onChange={(e) => setModelPreference(e.target.value)}
            placeholder="e.g. claude-sonnet-4, gpt-4o, gemini-2.5-pro…"
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as 'super' | 'specialist')}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            <option value="specialist">Specialist</option>
            <option value="super">Super</option>
          </select>
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>System Prompt</label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="You are a helpful AI assistant…"
            rows={4}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 80, fontFamily: 'inherit' }}
          />
        </div>

        {error && (
          <div style={{ color: 'var(--coral)', fontSize: 12, marginBottom: 12 }}>⚠️ {error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '7px 16px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--text-muted)',
              background: 'transparent',
              border: '1px solid var(--border)',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            style={{
              padding: '7px 16px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              color: '#fff',
              background: saving ? 'var(--text-muted)' : 'var(--coral)',
              border: 'none',
              cursor: saving ? 'not-allowed' : 'pointer',
              transition: 'background 150ms',
            }}
          >
            {saving ? 'Saving…' : isEdit ? 'Save' : 'Create Agent'}
          </button>
        </div>
      </div>
    </>
  );
}
