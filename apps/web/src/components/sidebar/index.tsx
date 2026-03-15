'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { useSessionStore } from '@/stores/session-store';
import { useAgentStore } from '@/stores/agent-store';
import { useSquadStore } from '@/stores/squad-store';
import type { Agent } from '@/stores/agent-store';
import ModelSelector from '@/components/ModelSelector';
import StarredMessagesPanel from '@/components/StarredMessagesPanel';

import { SectionHeader } from './SectionHeader';
import { ConversationItem } from './ConversationItem';
import { SquadItem } from './SquadItem';
import { CollapsedIconBar } from './CollapsedIconBar';
import { ModeToggle } from './ModeToggle';
import { AgentFormModal } from './modals/AgentFormModal';
import { SquadFormModal } from './modals/SquadFormModal';
import InviteExternalModal from '../InviteExternalModal';
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

  // L-9: External agent invite modal
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [starredOpen, setStarredOpen] = useState(false);

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

  // Agent picker for New Chat → replaced by create menu (P-8)
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const createMenuRef = useRef<HTMLDivElement>(null);

  // Close create menu on outside click
  useEffect(() => {
    if (!createMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (createMenuRef.current && !createMenuRef.current.contains(e.target as Node)) {
        setCreateMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [createMenuOpen]);

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

          {/* P-8: Create menu — single + button with 3 options */}
          {!sidebarCollapsed && (
            <div ref={createMenuRef} style={{ margin: '3px 0', position: 'relative' }}>
              <button
                onClick={() => setCreateMenuOpen(!createMenuOpen)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  width: '100%',
                  padding: '7px 12px',
                  background: createMenuOpen ? 'var(--coral-subtle)' : 'var(--surface-hover)',
                  border: `1px solid ${createMenuOpen ? 'var(--coral)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius-md)',
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--text)',
                  transition: 'all 150ms',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  if (!createMenuOpen) {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--coral)';
                    (e.currentTarget as HTMLButtonElement).style.background = 'var(--coral-subtle)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!createMenuOpen) {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
                    (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)';
                  }
                }}
              >
                <span style={{ fontSize: 14, lineHeight: 1, transition: 'transform 150ms', transform: createMenuOpen ? 'rotate(45deg)' : 'none' }}>＋</span>
                <span>New</span>
              </button>

              {/* Create menu dropdown */}
              {createMenuOpen && (
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
                }}>
                  {[
                    { icon: '🤖', label: 'Create Agent', desc: 'Add a new AI agent', action: () => { setCreateMenuOpen(false); openCreateAgent(); } },
                    { icon: '👥', label: 'Create Squad', desc: 'Group agents into a team', action: () => { setCreateMenuOpen(false); setSquadModalOpen(true); } },
                    { icon: '🔗', label: 'Invite User', desc: 'External agent or human', action: () => { setCreateMenuOpen(false); setInviteModalOpen(true); } },
                  ].map((item) => (
                    <button
                      key={item.label}
                      onClick={item.action}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        width: '100%',
                        padding: '9px 12px',
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
                      <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
                      <div>
                        <div style={{ fontWeight: 500 }}>{item.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{item.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
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

          {/* N-3: Starred messages quick access */}
          {!sidebarCollapsed && (
            <button
              onClick={() => setStarredOpen(true)}
              style={{
                width: '100%', padding: '6px 0', margin: '4px 0 0',
                background: 'transparent', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 12, color: 'var(--text-muted)',
                borderRadius: 'var(--radius-md)',
              }}
              onMouseOver={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; }}
              onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              <span style={{ fontSize: 14, marginLeft: 4 }}>⭐</span> Saved Messages
            </button>
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
      <InviteExternalModal open={inviteModalOpen} onClose={() => setInviteModalOpen(false)} />
      {starredOpen && <StarredMessagesPanel onClose={() => setStarredOpen(false)} />}
    </>
  );
}
