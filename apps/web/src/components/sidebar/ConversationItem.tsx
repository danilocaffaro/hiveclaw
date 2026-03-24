'use client';

import { useState, useMemo } from 'react';
import { useSessionStore } from '@/stores/session-store';
import { useAgentStore } from '@/stores/agent-store';
import { useUIStore } from '@/stores/ui-store';
import { useMessageStore } from '@/stores/message-store';
import { useRSPStore } from '@/stores/rsp-store';
import type { Agent } from '@/stores/agent-store';
import type { Session } from '@/stores/session-store';
import { StatusDot } from './StatusDot';
import { AgentContextMenu } from './menus/AgentContextMenu';

interface ConversationItemProps {
  agent: Agent;
  session: Session | null;        // latest session for this agent (may be null)
  isActive: boolean;
  onEdit: (agent: Agent) => void;
}

/** Format relative time like WhatsApp: "now", "5m", "2h", "Yesterday", "Mon", "12/03" */
function relativeTime(dateStr?: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 172_800_000) return 'Yesterday';
  if (diff < 604_800_000) return d.toLocaleDateString('en', { weekday: 'short' });
  return d.toLocaleDateString('en', { day: '2-digit', month: '2-digit' });
}

/** Truncate preview text to ~40 chars */
function preview(text?: string): string {
  if (!text) return 'No messages yet';
  const clean = text.replace(/\n/g, ' ').trim();
  return clean.length > 42 ? clean.slice(0, 40) + '…' : clean;
}

export function ConversationItem({ agent, session, isActive, onEdit }: ConversationItemProps) {
  const createSession = useSessionStore((s) => s.createSession);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const setActiveAgent = useAgentStore((s) => s.setActiveAgent);
  const getUnreadCount = useMessageStore((s) => s.getUnreadCount);
  const clearUnread = useMessageStore((s) => s.clearUnread);
  const [hovered, setHovered] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const unread = useMemo(() => session ? getUnreadCount(session.id) : 0, [session, getUnreadCount]);
  const lastTime = relativeTime(session?.updated_at);
  const lastPreview = preview(session?.last_message);

  const handleClick = () => {
    setActiveAgent(agent.id);
    if (session) {
      setActiveSession(session.id);
      clearUnread(session.id);
      useRSPStore.getState().enterDM(agent.id);
    } else {
      // createSession sets activeSessionId on completion → triggers rsp-store sync via subscribe
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

  const avatarBg = agent.color ? `${agent.color}22` : 'rgba(245,158,11,0.12)';
  const avatarBorder = agent.color ? `${agent.color}44` : 'rgba(245,158,11,0.25)';

  return (
    <>
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
          padding: '8px 12px 8px 14px',
          cursor: 'pointer',
          transition: 'all 120ms',
          borderLeft: `3px solid ${isActive ? (agent.color || 'var(--coral)') : 'transparent'}`,
          background: hovered
            ? 'var(--surface-hover)'
            : isActive
              ? 'rgba(245,158,11,0.06)'
              : 'transparent',
        }}
      >
        {/* Avatar */}
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: avatarBg,
            border: `1.5px solid ${avatarBorder}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            position: 'relative',
            flexShrink: 0,
          }}
        >
          {agent.emoji || '🤖'}
          <StatusDot status={agent.status} />
        </div>

        {/* Content: name + preview */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Top row: name + time */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: unread > 0 ? 700 : 600,
                color: 'var(--text)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flex: 1,
                minWidth: 0,
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
            {lastTime && (
              <span style={{
                fontSize: 10,
                color: unread > 0 ? 'var(--coral)' : 'var(--text-muted)',
                fontWeight: unread > 0 ? 600 : 400,
                flexShrink: 0,
                marginLeft: 6,
              }}>
                {lastTime}
              </span>
            )}
          </div>

          {/* Bottom row: preview + badge */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
            <div
              style={{
                fontSize: 11,
                color: unread > 0 ? 'var(--text-secondary)' : 'var(--text-muted)',
                fontWeight: unread > 0 ? 500 : 400,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flex: 1,
                minWidth: 0,
              }}
            >
              {lastPreview}
            </div>
            {unread > 0 && (
              <span style={{
                minWidth: 18,
                height: 18,
                borderRadius: 9,
                background: 'var(--coral)',
                color: '#fff',
                fontSize: 10,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 5px',
                flexShrink: 0,
                marginLeft: 6,
              }}>
                {unread > 99 ? '99+' : unread}
              </span>
            )}
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
