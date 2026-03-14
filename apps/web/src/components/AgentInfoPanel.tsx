'use client';

import { useState, useEffect } from 'react';
import { useRSPStore, selectActiveAgentId, selectActiveSquadId } from '@/stores/rsp-store';
import { useAgentStore } from '@/stores/agent-store';
import { useSquadStore } from '@/stores/squad-store';
import { useSessionStore } from '@/stores/session-store';

interface AgentInfoPanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * K-5: Slide-in config panel showing agent/squad info when header is clicked.
 */
export default function AgentInfoPanel({ open, onClose }: AgentInfoPanelProps) {
  const rspAgentId = useRSPStore(selectActiveAgentId);
  const squadId = useRSPStore(selectActiveSquadId);
  const agents = useAgentStore((s) => s.agents);
  const squads = useSquadStore((s) => s.squads);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const [visible, setVisible] = useState(false);

  // Fallback: if RSP store has no agent, use the active session's agent_id
  const sessionAgentId = activeSessionId ? sessions.find((s) => s.id === activeSessionId)?.agent_id : null;
  const agentId = rspAgentId ?? sessionAgentId ?? null;

  const agent = agentId ? agents.find((a) => a.id === agentId) : null;
  const squad = squadId ? squads.find((s) => s.id === squadId) : null;

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [open]);

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
          position: 'absolute',
          top: 0,
          right: 0,
          width: 340,
          height: '100%',
          background: 'var(--surface)',
          borderLeft: '1px solid var(--border)',
          boxShadow: '-8px 0 24px rgba(0,0,0,0.3)',
          transform: visible ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 250ms ease-out',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'auto',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
            {squad ? '👥 Squad Info' : '🤖 Agent Info'}
          </span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: 16, color: 'var(--text-muted)',
            cursor: 'pointer', padding: 4,
          }}>✕</button>
        </div>

        {/* Content */}
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {squad ? (
            <>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>{squad.emoji || '👥'}</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>{squad.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  {squad.routingStrategy} · {squad.agentIds?.length ?? 0} members
                </div>
              </div>
              {squad.description && (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {squad.description}
                </div>
              )}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                  Members
                </div>
                {(squad.agentIds ?? []).map((id) => {
                  const a = agents.find((x) => x.id === id);
                  return (
                    <div key={id} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 0', borderBottom: '1px solid var(--border)',
                    }}>
                      <span style={{ fontSize: 16 }}>{a?.emoji ?? '🤖'}</span>
                      <div>
                        <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{a?.name ?? id.slice(0, 8)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a?.role ?? 'agent'}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : agent ? (
            <>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>{agent.emoji || '🤖'}</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>{agent.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  {agent.role ?? 'assistant'}
                  {agent.isExternal && ' · External'}
                </div>
              </div>
              {agent.systemPrompt && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>
                    System Prompt
                  </div>
                  <div style={{
                    fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5,
                    padding: 10, background: 'var(--bg)', borderRadius: 6,
                    maxHeight: 200, overflow: 'auto', fontFamily: 'var(--font-mono)',
                  }}>
                    {agent.systemPrompt}
                  </div>
                </div>
              )}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>
                  Details
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div>Model: {agent.modelPreference ?? '—'}</div>
                  <div>Provider: {agent.providerPreference ?? '—'}</div>
                  <div>ID: <code style={{ fontSize: 10, color: 'var(--text-muted)' }}>{agent.id}</code></div>
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
