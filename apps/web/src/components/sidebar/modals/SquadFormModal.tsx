'use client';

import { useState } from 'react';
import { useSquadStore } from '@/stores/squad-store';
import { useAgentStore } from '@/stores/agent-store';
import type { Squad } from '@/stores/squad-store';

interface SquadFormModalProps {
  onClose: () => void;
  onSaved?: (squad: Squad) => void;
}

export function SquadFormModal({ onClose, onSaved }: SquadFormModalProps) {
  const createSquad = useSquadStore((s) => s.createSquad);
  const agents = useAgentStore((s) => s.agents);

  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('👥');
  const [description, setDescription] = useState('');
  const [routingStrategy, setRoutingStrategy] = useState<'sequential' | 'debate' | 'specialist' | 'round-robin'>('sequential');
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggleAgent = (id: string) => {
    setSelectedAgentIds((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  };

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const saved = await createSquad({
        name: name.trim(),
        emoji,
        description,
        agentIds: selectedAgentIds,
        routingStrategy,
      });
      onSaved?.(saved);
      onClose();
    } catch (e) {
      setError((e as Error).message ?? 'Failed to create squad');
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
          width: 420,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          boxShadow: '0 16px 48px rgba(0,0,0,0.7)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 20px', fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
          👥 Create Squad
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
              placeholder="Squad name"
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this squad do?"
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 60, fontFamily: 'inherit' }}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Routing Strategy</label>
          <select
            value={routingStrategy}
            onChange={(e) => setRoutingStrategy(e.target.value as 'sequential' | 'debate' | 'specialist' | 'round-robin')}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            <option value="sequential">Sequential — agents respond in order, @mentions work</option>
            <option value="debate">Debate — all agents argue, highest confidence wins</option>
            <option value="specialist">Specialist — coordinator picks the best agent per question</option>
            <option value="round-robin">Round Robin — rotate agents one at a time</option>
          </select>
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Agents</label>
          {agents.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>No agents available. Create agents first.</div>
          ) : (
            <div
              style={{
                border: '1px solid var(--border)',
                borderRadius: 6,
                overflow: 'hidden',
                maxHeight: 160,
                overflowY: 'auto',
              }}
            >
              {agents.map((agent, idx) => (
                <label
                  key={agent.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '7px 10px',
                    cursor: 'pointer',
                    background: selectedAgentIds.includes(agent.id)
                      ? 'var(--surface-hover)'
                      : idx % 2 === 0
                      ? 'var(--bg)'
                      : 'transparent',
                    borderBottom: idx < agents.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedAgentIds.includes(agent.id)}
                    onChange={() => toggleAgent(agent.id)}
                    style={{ accentColor: 'var(--coral)', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 15 }}>{agent.emoji || '🤖'}</span>
                  <div>
                    <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{agent.name}</div>
                    {agent.role && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{agent.role}</div>}
                  </div>
                </label>
              ))}
            </div>
          )}
          {selectedAgentIds.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              {selectedAgentIds.length} agent{selectedAgentIds.length !== 1 ? 's' : ''} selected
            </div>
          )}
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
            {saving ? 'Saving…' : 'Create Squad'}
          </button>
        </div>
      </div>
    </>
  );
}
