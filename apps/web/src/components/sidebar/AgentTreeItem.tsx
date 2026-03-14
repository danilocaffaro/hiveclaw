'use client';

import { useState } from 'react';
import { useSessionStore } from '@/stores/session-store';
import { useAgentStore } from '@/stores/agent-store';
import { useUIStore } from '@/stores/ui-store';
import type { Agent } from '@/stores/agent-store';
import type { Session } from '@/stores/session-store';
import { StatusDot } from './StatusDot';
import { AgentContextMenu } from './menus/AgentContextMenu';
import type { SessionUsage } from './SessionItem';

interface AgentTreeItemProps {
  agent: Agent;
  sessions: Session[];
  expanded: boolean;
  onToggle: () => void;
  onEdit: (agent: Agent) => void;
  activeSessionId: string;
  usageMap: Record<string, SessionUsage>;
}

export function AgentTreeItem({
  agent,
  sessions: agentSessions,
  onEdit,
  activeSessionId,
}: AgentTreeItemProps) {
  const createSession = useSessionStore((s) => s.createSession);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const setActiveAgent = useAgentStore((s) => s.setActiveAgent);
  const [hovered, setHovered] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const isActive = agentSessions.some((s) => s.id === activeSessionId);

  const handleClick = () => {
    setActiveAgent(agent.id);
    // Open main session (first) or create one
    if (agentSessions.length > 0) {
      setActiveSession(agentSessions[0].id);
    } else {
      void createSession({ title: `Chat with ${agent.name}`, agent_id: agent.id });
    }
    if (window.innerWidth < 768) {
      useUIStore.getState().setMobileSidebarOpen(false);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const avatarBg = agent.color ? `${agent.color}22` : 'rgba(255,107,107,0.12)';
  const avatarBorder = agent.color ? `${agent.color}44` : 'rgba(255,107,107,0.25)';

  return (
    <>
      {/* Single agent row — no nested session list */}
      <div
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && handleClick()}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '7px 12px 7px 16px',
          cursor: 'pointer',
          transition: 'all 120ms',
          borderLeft: `3px solid ${isActive ? (agent.color || 'var(--coral)') : 'transparent'}`,
          background: hovered ? 'var(--surface-hover)' : isActive ? 'rgba(255,107,107,0.06)' : 'transparent',
        }}
      >
        {/* Avatar */}
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 'var(--radius-md)',
            background: avatarBg,
            border: `1px solid ${avatarBorder}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            position: 'relative',
            flexShrink: 0,
          }}
        >
          {agent.emoji || '🤖'}
          <StatusDot status={agent.status} />
        </div>

        {/* Name + role */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {agent.name}
            {agent.isExternal && (
              <span style={{
                fontSize: 9,
                fontWeight: 600,
                background: 'rgba(168,85,247,0.15)',
                color: '#A855F7',
                borderRadius: 3,
                padding: '1px 4px',
                marginLeft: 4,
                verticalAlign: 'middle',
                letterSpacing: '0.3px',
              }}>EXT</span>
            )}
          </div>
          <div
            style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              marginTop: 1,
            }}
          >
            {agent.isExternal ? `${agent.tier ?? 'external'} agent` : (agent.role || agent.type)}
          </div>
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <AgentContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          agent={agent}
          onClose={() => setContextMenu(null)}
          onEdit={() => onEdit(agent)}
          onChat={() => {
            setActiveAgent(agent.id);
            void createSession({ title: `Chat with ${agent.name}`, agent_id: agent.id });
          }}
          onDelete={() => { void useAgentStore.getState().deleteAgent(agent.id); }}
        />
      )}
    </>
  );
}
