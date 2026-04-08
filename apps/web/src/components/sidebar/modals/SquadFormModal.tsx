'use client';

import { useState, useEffect } from 'react';
import { useSquadStore } from '@/stores/squad-store';
import { useAgentStore } from '@/stores/agent-store';
import type { Squad } from '@/stores/squad-store';

interface SquadFormModalProps {
  onClose: () => void;
  onSaved?: (squad: Squad) => void;
  editSquad?: Squad; // If provided, modal opens in edit mode
}

export function SquadFormModal({ onClose, onSaved, editSquad }: SquadFormModalProps) {
  const createSquad = useSquadStore((s) => s.createSquad);
  const updateSquad = useSquadStore((s) => s.updateSquad);
  const agents = useAgentStore((s) => s.agents);
  const isEdit = !!editSquad;

  const [name, setName] = useState(editSquad?.name ?? '');
  const [emoji, setEmoji] = useState(editSquad?.emoji ?? '👥');
  const [description, setDescription] = useState(editSquad?.description ?? '');
  const [selectedAgents, setSelectedAgents] = useState<Array<{ agentId: string; nexusRole: 'po' | 'tech-lead' | 'qa-lead' | 'sre' | 'member' }>>(
    editSquad
      ? (editSquad.agentIds ?? []).map((id, idx) => ({
          agentId: id,
          nexusRole: (editSquad.agents?.find(a => a.id === id) as any)?.nexusRole ??
            (idx === 0 ? 'po' : idx === 1 ? 'tech-lead' : idx === 2 ? 'qa-lead' : idx === 3 ? 'sre' : 'member'),
        }))
      : []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Prevent the opening click from immediately closing the modal via overlay
  const [ready, setReady] = useState(false);
  useEffect(() => { const t = setTimeout(() => setReady(true), 150); return () => clearTimeout(t); }, []);

  const toggleAgent = (id: string) => {
    setSelectedAgents((prev) => {
      const exists = prev.find((a) => a.agentId === id);
      if (exists) {
        return prev.filter((a) => a.agentId !== id);
      } else {
        // Auto-assign NEXUS roles: first = PO, second = Tech Lead, third = QA Lead, fourth = SRE, rest = member
        const nextIdx = prev.length;
        const nexusRole: 'po' | 'tech-lead' | 'qa-lead' | 'sre' | 'member' =
          nextIdx === 0 ? 'po' :
          nextIdx === 1 ? 'tech-lead' :
          nextIdx === 2 ? 'qa-lead' :
          nextIdx === 3 ? 'sre' : 'member';
        return [...prev, { agentId: id, nexusRole }];
      }
    });
  };

  const updateNexusRole = (agentId: string, nexusRole: 'po' | 'tech-lead' | 'qa-lead' | 'sre' | 'member') => {
    setSelectedAgents((prev) =>
      prev.map((a) => (a.agentId === agentId ? { ...a, nexusRole } : a))
    );
  };

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      let saved: Squad;
      if (isEdit) {
        saved = await updateSquad(editSquad!.id, {
          name: name.trim(),
          emoji,
          description,
          agentIds: selectedAgents.map((a) => a.agentId),
          members: selectedAgents,
        } as any);
      } else {
        saved = await createSquad({
          name: name.trim(),
          emoji,
          description,
          agentIds: selectedAgents.map((a) => a.agentId),
          routingStrategy: 'sequential', // Always sequential — NEXUS pipeline
          members: selectedAgents,
        } as any);
      }
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
        onMouseDown={() => { if (ready) onClose(); }}
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
          👥 {isEdit ? 'Edit Squad' : 'Create Squad'}
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
              {agents.map((agent, idx) => {
                const selected = selectedAgents.find((a) => a.agentId === agent.id);
                return (
                  <div
                    key={agent.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '7px 10px',
                      background: selected
                        ? 'var(--surface-hover)'
                        : idx % 2 === 0
                        ? 'var(--bg)'
                        : 'transparent',
                      borderBottom: idx < agents.length - 1 ? '1px solid var(--border)' : 'none',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={!!selected}
                      onChange={() => toggleAgent(agent.id)}
                      style={{ accentColor: 'var(--coral)', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: 15 }}>{agent.emoji || '🤖'}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{agent.name}</div>
                      {agent.role && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{agent.role}</div>}
                    </div>
                    {selected && (
                      <select
                        value={selected.nexusRole}
                        onChange={(e) => updateNexusRole(agent.id, e.target.value as any)}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          padding: '4px 8px',
                          fontSize: 11,
                          borderRadius: 4,
                          border: '1px solid var(--border)',
                          background: 'var(--bg)',
                          color: 'var(--text)',
                          cursor: 'pointer',
                        }}
                      >
                        <option value="po">PO</option>
                        <option value="tech-lead">Tech Lead</option>
                        <option value="qa-lead">QA Lead</option>
                        <option value="sre">SRE</option>
                        <option value="member">Member</option>
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {selectedAgents.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              {selectedAgents.length} agent{selectedAgents.length !== 1 ? 's' : ''} selected
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
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Squad'}
          </button>
        </div>
      </div>
    </>
  );
}
