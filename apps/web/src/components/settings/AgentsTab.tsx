'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { SectionTitle } from './shared';
import { AgentCard } from './agents/AgentCard';
import { AgentEditModal } from './agents/AgentEditModal';
import { InviteAgentModal } from './agents/InviteAgentModal';
import ExternalAgentsPanel from './ExternalAgentsPanel';
import { FederationPanel } from '../federation/FederationPanel';
import type { AgentRow, WorkerAgentStatus, PoolStatusData } from './agents/types';

export default function AgentsTab() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingAgent, setEditingAgent] = useState<AgentRow | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [poolStatus, setPoolStatus] = useState<PoolStatusData | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const sseRef = useRef<EventSource | null>(null);

  // ─── SSE: Real-time agent status from worker pool ──────────────────────
  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      try {
        es = new EventSource('/api/agents/status/stream');

        es.onmessage = (evt) => {
          try {
            const data = JSON.parse(evt.data) as PoolStatusData;
            setPoolStatus(data);
          } catch {
            // ignore parse errors
          }
        };

        es.onerror = () => {
          es?.close();
          retryTimeout = setTimeout(connect, 5000);
        };

        sseRef.current = es;
      } catch {
        // SSE not supported or server unavailable — silent fail
      }
    };

    connect();

    return () => {
      es?.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/agents');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setAgents(json.data ?? []);
    } catch (e) {
      setError('Could not load agents — server may be offline.');
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (patch: Partial<AgentRow>) => {
    if (!editingAgent) return;
    try {
      const res = await fetch(`/api/agents/${editingAgent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const json = await res.json();
        setAgents((prev) => prev.map((a) => (a.id === editingAgent.id ? { ...a, ...json.data } : a)));
      } else {
        setAgents((prev) => prev.map((a) => (a.id === editingAgent.id ? { ...a, ...patch } : a)));
      }
    } catch {
      setAgents((prev) => prev.map((a) => (a.id === editingAgent.id ? { ...a, ...patch } : a)));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/agents/${id}`, { method: 'DELETE' });
    } catch {
      // fall through
    }
    setAgents((prev) => prev.filter((a) => a.id !== id));
  };

  const statusCounts = agents.reduce<Record<string, number>>((acc, a) => {
    const s = a.status ?? 'offline';
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});

  // Build a map of agentId → worker status for passing to cards
  const workerStatusMap = new Map<string, WorkerAgentStatus>();
  if (poolStatus?.agents) {
    for (const ws of poolStatus.agents) {
      // B058: new format uses `id` field; legacy format uses `agentId`
      const key = (ws as { agentId?: string; id?: string }).agentId ?? (ws as { id?: string }).id ?? '';
      if (key) workerStatusMap.set(key, ws);
    }
  }

  // Use pool status counts (active/offline) when available
  const poolActive = poolStatus?.byState?.['active'] ?? null;
  const poolOffline = poolStatus?.byState?.['offline'] ?? 0;
  const poolTotal = poolStatus?.total ?? 0;
  const activeCount = poolActive !== null ? poolActive : (statusCounts.active ?? 0);
  const offlineCount = poolActive !== null ? poolOffline : ((statusCounts.idle ?? 0) + (statusCounts.busy ?? 0));

  // Count unique gateways from SSE agent data
  const gatewaySet = new Set<string>();
  const activeGatewaySet = new Set<string>();
  if (poolStatus?.agents) {
    for (const a of poolStatus.agents) {
      const gwId = (a as { gatewayId?: string }).gatewayId;
      if (gwId) {
        gatewaySet.add(gwId);
        if ((a as { state?: string }).state === 'active') activeGatewaySet.add(gwId);
      }
    }
  }

  return (
    <div>
      <SectionTitle
        title="Agents" aria-label="Agents"
        desc="Manage your AI agents — edit their configuration, system prompts, and model preferences."
      />

      {/* Stats bar */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap',
      }}>
        {[
          { label: 'Total', value: agents.length, color: 'var(--text)' },
          { label: 'Active', value: activeCount, color: 'var(--green)' },
          { label: 'Offline', value: offlineCount, color: 'var(--text-muted)' },
          { label: 'Gateways', value: gatewaySet.size > 0 ? `${activeGatewaySet.size}/${gatewaySet.size}` : '—', color: 'var(--blue, #58A6FF)' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            flex: 1, minWidth: 70,
            padding: '10px 14px', borderRadius: 'var(--radius-md)',
            background: 'var(--card-bg)', border: '1px solid var(--border)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: 'var(--font-mono)' }}>
              {value}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{label}</div>
          </div>
        ))}
        <button
          onClick={load}
          style={{
            width: 40, height: 'auto', borderRadius: 'var(--radius-md)',
            background: 'var(--surface-hover)', border: '1px solid var(--border)',
            color: 'var(--text-secondary)', fontSize: 16, cursor: 'pointer',
            transition: 'all 150ms', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.borderColor = 'var(--border-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
          title="Refresh agents" aria-label="Refresh agents"
        >
          ↻
        </button>
        <button
          onClick={async () => {
            setDiscovering(true);
            try {
              const res = await fetch('/api/agents/discover', { method: 'POST' });
              if (res.ok) {
                const json = await res.json();
                const count = json.count ?? 0;
                // Reload the full agent list after discovery
                await load();
                if (count > 0) {
                  setError(null);
                }
              }
            } catch {
              // silent fail
            } finally {
              setDiscovering(false);
            }
          }}
          disabled={discovering}
          style={{
            height: 'auto', borderRadius: 'var(--radius-md)',
            background: 'var(--surface-hover)', border: '1px solid var(--border)',
            color: discovering ? 'var(--text-muted)' : 'var(--coral)',
            fontSize: 11, cursor: discovering ? 'default' : 'pointer',
            transition: 'all 150ms', padding: '8px 12px', fontWeight: 600,
            opacity: discovering ? 0.6 : 1,
          }}
          title="Discover agents from all connected gateways"
        >
          {discovering ? '🔍 Scanning...' : '🔍 Discover'}
        </button>
        <button
          onClick={() => setShowInvite(true)}
          style={{
            height: 'auto', borderRadius: 'var(--radius-md)',
            background: 'var(--surface-hover)', border: '1px solid var(--border)',
            color: 'var(--blue, #58A6FF)',
            fontSize: 11, cursor: 'pointer',
            transition: 'all 150ms', padding: '8px 12px', fontWeight: 600,
          }}
          title="Invite an external agent via pairing link"
        >
          🔗 Invite
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          padding: '10px 14px', borderRadius: 'var(--radius-md)',
          background: 'color-mix(in srgb, var(--coral) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--coral) 25%, transparent)',
          color: 'var(--coral)', fontSize: 12, marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span>⚠️</span>
          <span>{error} Unable to load agents.</span>
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12,
        }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{
              height: 190, borderRadius: 'var(--radius-lg)',
              background: 'var(--card-bg)', border: '1px solid var(--border)',
              animation: 'pulse 1.5s infinite ease-in-out',
            }} />
          ))}
        </div>
      ) : (
        /* Agent grid */
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12,
        }}>
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              workerStatus={workerStatusMap.get(agent.id)}
              onEdit={setEditingAgent}
              onDelete={handleDelete}
            />
          ))}

          {/* "Create agent" card */}
          <button
            style={{
              background: 'transparent', border: '2px dashed var(--border)',
              borderRadius: 'var(--radius-lg)', padding: '16px',
              cursor: 'pointer', color: 'var(--text-secondary)',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 10, minHeight: 190,
              transition: 'all 150ms',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--coral)';
              e.currentTarget.style.color = 'var(--coral)';
              e.currentTarget.style.background = 'color-mix(in srgb, var(--coral) 4%, transparent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.color = 'var(--text-secondary)';
              e.currentTarget.style.background = 'transparent';
            }}
            onClick={async () => {
              try {
                const res = await fetch('/api/agents', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name: 'New Agent',
                    emoji: '🤖',
                    role: 'AI Assistant',
                    systemPrompt: 'You are a helpful AI assistant.',
                    skills: [],
                    color: 'var(--purple, #7c5bf5)',
                  }),
                });
                if (res.ok) {
                  const json = await res.json();
                  setAgents((prev) => [json.data, ...prev]);
                  setEditingAgent(json.data);
                } else {
                  alert('Could not create agent — server may be offline.');
                }
              } catch {
                alert('Could not create agent — server may be offline.');
              }
            }}
          >
            <div style={{ fontSize: 28 }}>+</div>
            <div style={{ fontSize: 12, fontWeight: 500 }}>New Agent</div>
          </button>
        </div>
      )}

      {/* Edit Modal */}
      {editingAgent && (
        <AgentEditModal
          agent={editingAgent}
          onSave={handleSave}
          onClose={() => setEditingAgent(null)}
        />
      )}

      {/* Invite Modal */}
      {showInvite && (
        <InviteAgentModal
          onClose={() => setShowInvite(false)}
          onConnected={() => { setShowInvite(false); load(); }}
        />
      )}

      {/* M-1: External Agents section */}
      <div style={{ marginTop: 24 }}>
        <SectionTitle title="External Agents" desc="Manage agents connected via webhook (OpenClaw, custom bots, third-party AI)." />
        <ExternalAgentsPanel />
      </div>

      {/* Federation section */}
      <div style={{ marginTop: 24 }}>
        <SectionTitle title="Federation" desc="Link squads with other HiveClaw instances for cross-instance collaboration." />
        <FederationPanel />
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1 }
          50% { opacity: 0.4 }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
