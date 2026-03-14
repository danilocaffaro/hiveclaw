'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { useSessionStore } from '@/stores/session-store';
import { useAgentStore } from '@/stores/agent-store';
import { useSquadStore } from '@/stores/squad-store';
import type { Agent } from '@/stores/agent-store';
import ModelSelector from '@/components/ModelSelector';

import { SectionHeader } from './SectionHeader';
import { ConversationItem } from './ConversationItem';
import { SquadItem } from './SquadItem';
import { CollapsedIconBar } from './CollapsedIconBar';
import { ModeToggle } from './ModeToggle';
import { AgentFormModal } from './modals/AgentFormModal';
import { SquadFormModal } from './modals/SquadFormModal';
// InviteAgentModal removed — Pure uses local agent creation, not gateway pairing
import { cleanAgentName } from '@/lib/agent-utils';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

export default function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, interfaceMode } = useUIStore();
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const createSession = useSessionStore((s) => s.createSession);
  const agents = useAgentStore((s) => s.agents);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const setActiveAgent = useAgentStore((s) => s.setActiveAgent);
  const squads = useSquadStore((s) => s.squads);

  // Ensure agents are loaded
  useEffect(() => {
    if (agents.length === 0) {
      void fetchAgents();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Section collapse states
  const [chatsCollapsed, setChatsCollapsed] = useState(false);
  const [squadsCollapsed, setSquadsCollapsed] = useState(false);

  // ── Clean agents for display (apply name rules once) ──────────────────────
  const displayAgents = useMemo(() => {
    return agents.map((a) => ({
      ...a,
      name: cleanAgentName(a.id, a.name || ''),
    }));
  }, [agents]);

  // ── Session grouping: find latest session per agent, sorted by recency ──
  const conversationList = useMemo(() => {
    // Map: agentId → most recent session
    const latestByAgent = new Map<string, (typeof sessions)[0]>();
    for (const s of sessions) {
      const key = s.agent_id;
      if (!key) continue;
      const existing = latestByAgent.get(key);
      if (!existing || new Date(s.updated_at) > new Date(existing.updated_at)) {
        latestByAgent.set(key, s);
      }
    }

    // Build list of { agent, session } tuples, sorted by last activity
    const list = displayAgents.map((agent) => ({
      agent,
      session: latestByAgent.get(agent.id) ?? null,
    }));

    list.sort((a, b) => {
      const tA = a.session ? new Date(a.session.updated_at).getTime() : 0;
      const tB = b.session ? new Date(b.session.updated_at).getTime() : 0;
      return tB - tA; // most recent first
    });

    return list;
  }, [sessions, displayAgents]);

  // Agent form modal state
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

  // Squad form modal state
  const [squadModalOpen, setSquadModalOpen] = useState(false);

  const openCreateAgent = () => {
    setEditingAgent(null);
    setAgentModalOpen(true);
  };

  const openEditAgent = (agent: Agent) => {
    setEditingAgent(agent);
    setAgentModalOpen(true);
  };

  const closeAgentModal = () => {
    setAgentModalOpen(false);
    setEditingAgent(null);
  };

  // Agent picker for New Chat
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const agentPickerRef = useRef<HTMLDivElement>(null);

  // Close picker on outside click
  useEffect(() => {
    if (!agentPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (agentPickerRef.current && !agentPickerRef.current.contains(e.target as Node)) {
        setAgentPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [agentPickerOpen]);

  return (
    <>
      <aside
        style={{
          width: sidebarCollapsed ? 56 : 268,
          minWidth: sidebarCollapsed ? 56 : 268,
          background: 'var(--surface)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transition: 'width 250ms cubic-bezier(0.4,0,0.2,1), min-width 250ms cubic-bezier(0.4,0,0.2,1)',
          height: '100vh',
          position: 'relative',
          zIndex: 20,
        }}
      >
        {/* ── Header ─────────────────────────────────────────── */}
        <div
          className="electron-drag"
          style={{
            padding: sidebarCollapsed ? '12px 0 16px' : '12px 12px 16px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          {/* Top row: logo + collapse btn */}
          <div
            className="electron-no-drag"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: sidebarCollapsed ? 8 : 8,
              justifyContent: sidebarCollapsed ? 'center' : 'space-between',
            }}
          >
            {/* Logo */}
            {!sidebarCollapsed && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 16 }} className="claw">⚡</span>
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    background: 'linear-gradient(135deg, var(--coral), #ff8f8f)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                  }}
                >
                  HiveClaw
                </span>
              </div>
            )}

            {/* Collapse / hamburger button */}
            <button
              onClick={toggleSidebar}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              style={{
                width: 24,
                height: 24,
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                color: 'var(--text-secondary)',
                transition: 'all 150ms',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)';
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)';
              }}
            >
              ☰
            </button>
          </div>

          {/* New Chat (agent picker) + Create Agent row */}
          {!sidebarCollapsed && (
            <div style={{ display: 'flex', gap: 6, margin: '3px 0', position: 'relative' }}>
              <div ref={agentPickerRef} style={{ flex: 1, position: 'relative' }}>
                <button
                  onClick={() => setAgentPickerOpen(!agentPickerOpen)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '7px 12px',
                    background: 'var(--surface-hover)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'var(--text)',
                    transition: 'all 150ms',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--coral)';
                    (e.currentTarget as HTMLButtonElement).style.background = 'var(--coral-subtle)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
                    (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)';
                  }}
                >
                  <span style={{ fontSize: 16, lineHeight: 1, color: 'var(--text-secondary)' }}>✎</span>
                  New Chat
                </button>

                {/* Agent picker dropdown */}
                {agentPickerOpen && displayAgents.length > 0 && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    marginTop: 4,
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                    zIndex: 100,
                    overflow: 'hidden',
                    maxHeight: 220,
                    overflowY: 'auto',
                  }}>
                    <div style={{ padding: '6px 10px 3px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Choose agent
                    </div>
                    {displayAgents.map((agent) => (
                      <button
                        key={agent.id}
                        onClick={() => {
                          setAgentPickerOpen(false);
                          setActiveAgent(agent.id);
                          void createSession({ title: `Chat with ${agent.name}`, agent_id: agent.id });
                          if (window.innerWidth < 768) useUIStore.getState().setMobileSidebarOpen(false);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          width: '100%',
                          padding: '7px 10px',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: 13,
                          color: 'var(--text)',
                          textAlign: 'left',
                          transition: 'background 100ms',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                      >
                        <span style={{ fontSize: 15 }}>{agent.emoji || '🤖'}</span>
                        <span>{agent.name}</span>
                        {agent.isExternal && <span style={{ fontSize: 9, color: '#A855F7', fontWeight: 600 }}>EXT</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={openCreateAgent}
                title="Create new agent"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 36,
                  padding: '7px 0',
                  background: 'var(--surface-hover)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 15,
                  color: 'var(--blue, #58A6FF)',
                  transition: 'all 150ms',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--blue, #58A6FF)';
                  (e.currentTarget as HTMLButtonElement).style.background = 'color-mix(in srgb, var(--blue, #58A6FF) 8%, transparent)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)';
                }}
              >
                ➕
              </button>
            </div>
          )}

          {/* Search bar */}
          {!sidebarCollapsed && (
            <div style={{ margin: '6px 0 4px', position: 'relative' }}>
              <span
                style={{
                  position: 'absolute',
                  left: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: 11,
                  color: 'var(--text-muted)',
                }}
              >
                🔍
              </span>
              <div
                style={{
                  width: '100%',
                  padding: '5px 10px 5px 26px',
                  background: 'var(--surface-hover)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  height: 28,
                  display: 'flex',
                  alignItems: 'center',
                  cursor: 'pointer',
                }}
                onClick={() => useUIStore.getState().toggleCommandPalette()}
              >
                Search or ⌘K…
              </div>
            </div>
          )}

          {/* Label: CHATS */}
          {!sidebarCollapsed && (
            <div style={{
              margin: '6px -12px 0',
              padding: '4px 16px 2px',
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.8px',
            }}>
              Chats
            </div>
          )}
        </div>

        {/* ── Scrollable Content ─────────────────────────────── */}
        {sidebarCollapsed ? (
          <CollapsedIconBar />
        ) : (
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              overflowX: 'hidden',
              padding: '6px 0',
            }}
          >
            {/* ── No agents at all ── */}
            {displayAgents.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                  fontSize: 12,
                  padding: '20px 16px',
                }}
              >
                <div style={{ fontSize: 26, marginBottom: 8 }}>🤖</div>
                <div>No agents configured</div>
                <div style={{ marginTop: 4, opacity: 0.7 }}>Complete setup to add agents</div>
              </div>
            ) : (
              <>
                {/* ── DM Chats: Conversations sorted by last activity ── */}
                {!chatsCollapsed && conversationList.map(({ agent, session }) => (
                  <ConversationItem
                    key={agent.id}
                    agent={agent}
                    session={session}
                    isActive={session?.id === activeSessionId}
                    onEdit={openEditAgent}
                  />
                ))}
              </>
            )}

            {/* ── Squads (group chats) ── */}
            {squads.length > 0 && (
              <>
                <SectionHeader
                  title="Squads" aria-label="Squads"
                  count={squads.length}
                  collapsed={squadsCollapsed}
                  onToggle={() => setSquadsCollapsed((v) => !v)}
                  onAdd={() => setSquadModalOpen(true)}
                />
                {!squadsCollapsed &&
                  squads.map((sq) => (
                    <SquadItem key={sq.id} squad={sq} agents={displayAgents} />
                  ))
                }
              </>
            )}
          </div>
        )}

        {/* ── Footer: Model Selector ────────────────────────── */}
        {!sidebarCollapsed && (
          <div
            style={{
              padding: '8px 14px',
              borderTop: '1px solid var(--border)',
              flexShrink: 0,
            }}
          >
            <ModelSelector />
          </div>
        )}

        {/* ── Footer: Mode Toggle ───────────────────────────── */}
        {!sidebarCollapsed && <ModeToggle />}
      </aside>

      {/* ── Modals (rendered outside aside to avoid z-index issues) ── */}
      {agentModalOpen && (
        <AgentFormModal
          agent={editingAgent}
          onClose={closeAgentModal}
        />
      )}
      {squadModalOpen && (
        <SquadFormModal
          onClose={() => setSquadModalOpen(false)}
        />
      )}
    </>
  );
}
