'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRSPStore, selectActiveAgentId, selectActiveSquadId } from '@/stores/rsp-store';
import { useAgentStore } from '@/stores/agent-store';
import { useSquadStore } from '@/stores/squad-store';
import { useSessionStore } from '@/stores/session-store';

interface AgentInfoPanelProps {
  open: boolean;
  onClose: () => void;
}

/* Inline editable field */
function EditableField({ label, value, onSave, type = 'text', options }: {
  label: string;
  value: string;
  onSave: (v: string) => void;
  type?: 'text' | 'textarea' | 'number' | 'select';
  options?: { value: string; label: string }[];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => { setDraft(value); }, [value]);

  const save = () => {
    if (draft !== value) onSave(draft);
    setEditing(false);
  };

  const fieldStyle: React.CSSProperties = {
    width: '100%', padding: '6px 10px', borderRadius: 6,
    background: 'var(--bg)', border: '1px solid var(--border)',
    color: 'var(--text)', fontSize: 12,
    fontFamily: type === 'textarea' ? 'var(--font-mono)' : 'inherit',
    resize: type === 'textarea' ? 'vertical' as const : undefined,
    outline: 'none', boxSizing: 'border-box' as const,
  };

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 4,
      }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
          {label}
        </span>
        {!editing && (
          <button onClick={() => setEditing(true)} style={{
            background: 'none', border: 'none', fontSize: 10,
            color: 'var(--coral)', cursor: 'pointer', padding: '0 4px',
          }}>Edit</button>
        )}
      </div>
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {type === 'textarea' ? (
            <textarea value={draft} onChange={e => setDraft(e.target.value)}
              rows={4} style={fieldStyle} autoFocus />
          ) : type === 'select' ? (
            <select value={draft} onChange={e => setDraft(e.target.value)} style={fieldStyle}>
              {options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input value={draft} onChange={e => setDraft(e.target.value)}
              type={type} style={fieldStyle} autoFocus
              onKeyDown={e => e.key === 'Enter' && save()} />
          )}
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={save} style={{
              padding: '4px 10px', borderRadius: 6, background: 'var(--coral)',
              color: '#000', fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
            }}>Save</button>
            <button onClick={() => { setDraft(value); setEditing(false); }} style={{
              padding: '4px 10px', borderRadius: 6, background: 'transparent',
              color: 'var(--text-muted)', fontSize: 11, border: '1px solid var(--border)', cursor: 'pointer',
            }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{
          fontSize: 12, color: 'var(--text-secondary)',
          padding: '6px 10px', background: 'var(--bg)', borderRadius: 6,
          maxHeight: type === 'textarea' ? 120 : 'auto', overflow: 'auto',
          fontFamily: type === 'textarea' ? 'var(--font-mono)' : 'inherit',
          whiteSpace: type === 'textarea' ? 'pre-wrap' : 'normal',
          lineHeight: 1.5,
          cursor: 'pointer',
        }}
          onClick={() => setEditing(true)}
          title="Click to edit"
        >
          {value || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Not set</span>}
        </div>
      )}
    </div>
  );
}

/**
 * K-5 + P-8: Agent/Squad info + inline config editing
 */
export default function AgentInfoPanel({ open, onClose }: AgentInfoPanelProps) {
  const rspAgentId = useRSPStore(selectActiveAgentId);
  const squadId = useRSPStore(selectActiveSquadId);
  const agents = useAgentStore((s) => s.agents);
  const updateAgent = useAgentStore((s) => s.updateAgent);
  const squads = useSquadStore((s) => s.squads);
  const updateSquad = useSquadStore((s) => s.updateSquad);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const [visible, setVisible] = useState(false);

  const sessionAgentId = activeSessionId ? sessions.find((s) => s.id === activeSessionId)?.agent_id : null;
  const agentId = rspAgentId ?? sessionAgentId ?? null;

  const agent = agentId ? agents.find((a) => a.id === agentId) : null;
  const squad = squadId ? squads.find((s) => s.id === squadId) : null;

  useEffect(() => {
    if (open) requestAnimationFrame(() => setVisible(true));
    else setVisible(false);
  }, [open]);

  const saveField = useCallback((field: string, value: string) => {
    if (!agent) return;
    const patch: Record<string, string | number> = {};
    if (field === 'temperature') patch[field] = parseFloat(value) || 0.7;
    else if (field === 'maxTokens') patch[field] = parseInt(value, 10) || 4096;
    else patch[field] = value;
    void updateAgent(agent.id, patch);
  }, [agent, updateAgent]);

  const saveSquadField = useCallback((field: string, value: string) => {
    if (!squad) return;
    const patch: Record<string, string | boolean> = {};
    if (field === 'debateEnabled') patch[field] = value === 'true';
    else patch[field] = value;
    void updateSquad(squad.id, patch);
  }, [squad, updateSquad]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 900,
        background: 'rgba(0,0,0,0.35)',
        transition: 'opacity 200ms',
        opacity: visible ? 1 : 0,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute', top: 0, right: 0,
          width: 360, height: '100%',
          background: 'var(--surface)',
          borderLeft: '1px solid var(--border)',
          boxShadow: '-8px 0 24px rgba(0,0,0,0.3)',
          transform: visible ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 250ms ease-out',
          display: 'flex', flexDirection: 'column',
          overflow: 'auto',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
            {squad ? '👥 Squad Config' : '🤖 Agent Config'}
          </span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: 16, color: 'var(--text-muted)',
            cursor: 'pointer', padding: 4,
          }}>✕</button>
        </div>

        {/* Content */}
        <div style={{ padding: 20, flex: 1, overflowY: 'auto' }}>
          {squad ? (
            <>
              {/* Identity */}
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>{squad.emoji || '👥'}</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>{squad.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  {squad.agentIds?.length ?? 0} members
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                  <code>{squad.id}</code>
                </div>
              </div>

              {/* Divider */}
              <div style={{ borderBottom: '1px solid var(--border)', marginBottom: 16 }} />

              {/* Editable fields */}
              <EditableField label="Name" value={squad.name} onSave={v => saveSquadField('name', v)} />
              <EditableField label="Emoji" value={squad.emoji ?? ''} onSave={v => saveSquadField('emoji', v)} />
              <EditableField label="Description" value={squad.description ?? ''} type="textarea"
                onSave={v => saveSquadField('description', v)} />
              <EditableField label="Routing Strategy" value={squad.routingStrategy ?? 'sequential'}
                type="select" options={[
                  { value: 'sequential', label: 'Sequential' },
                  { value: 'round-robin', label: 'Round Robin' },
                  { value: 'debate', label: 'Debate' },
                  { value: 'specialist', label: 'Specialist' },
                ]}
                onSave={v => saveSquadField('routingStrategy', v)} />
              <EditableField label="Debate Mode" value={String(squad.debateEnabled ?? false)}
                type="select" options={[
                  { value: 'true', label: 'Enabled' },
                  { value: 'false', label: 'Disabled' },
                ]}
                onSave={v => saveSquadField('debateEnabled', v)} />

              {/* Members */}
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                  Members
                </div>
                {(squad.agentIds ?? []).map((id) => {
                  const a = agents.find((x) => x.id === id);
                  return (
                    <div key={id} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 10px', marginBottom: 4,
                      background: 'var(--bg)', borderRadius: 6,
                    }}>
                      <span style={{ fontSize: 16 }}>{a?.emoji ?? '🤖'}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{a?.name ?? id.slice(0, 8)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a?.role ?? 'agent'}</div>
                      </div>
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: a?.status === 'active' ? 'var(--green, #3FB950)' :
                          a?.status === 'busy' ? 'var(--coral)' : 'var(--text-muted)',
                      }} />
                    </div>
                  );
                })}
              </div>
            </>
          ) : agent ? (
            <>
              {/* Identity */}
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>{agent.emoji || '🤖'}</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>{agent.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  {agent.role ?? 'assistant'}
                  {agent.isExternal && (
                    <span style={{
                      marginLeft: 8, fontSize: 9, fontWeight: 700,
                      color: '#A855F7', background: 'rgba(168,85,247,0.1)',
                      padding: '1px 6px', borderRadius: 99,
                    }}>EXTERNAL</span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                  <code>{agent.id}</code>
                </div>
              </div>

              {/* Divider */}
              <div style={{ borderBottom: '1px solid var(--border)', marginBottom: 16 }} />

              {/* Editable fields */}
              <EditableField label="Name" value={agent.name} onSave={v => saveField('name', v)} />
              <EditableField label="Emoji" value={agent.emoji} onSave={v => saveField('emoji', v)} />
              <EditableField label="Role" value={agent.role} onSave={v => saveField('role', v)} />

              <EditableField label="Model" value={agent.modelPreference ?? ''} onSave={v => saveField('modelPreference', v)} />
              <EditableField label="Provider" value={agent.providerPreference ?? ''} onSave={v => saveField('providerPreference', v)} />

              <EditableField label="Temperature" value={String(agent.temperature ?? 0.7)} type="number"
                onSave={v => saveField('temperature', v)} />
              <EditableField label="Max Tokens" value={String(agent.maxTokens ?? 4096)} type="number"
                onSave={v => saveField('maxTokens', v)} />

              <EditableField label="System Prompt" value={agent.systemPrompt ?? ''} type="textarea"
                onSave={v => saveField('systemPrompt', v)} />

              {/* Status */}
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>
                  Status
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 10px', background: 'var(--bg)', borderRadius: 6,
                }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: agent.status === 'active' ? 'var(--green, #3FB950)' :
                      agent.status === 'busy' ? 'var(--coral)' :
                        agent.status === 'error' ? 'var(--red, #F85149)' : 'var(--text-muted)',
                  }} />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
                    {agent.status}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 20 }}>
              No agent selected
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
