'use client';

import { useState } from 'react';
import { useSessionStore } from '@/stores/session-store';
import { useAgentStore } from '@/stores/agent-store';
import { useUIStore } from '@/stores/ui-store';
import { useMessageStore } from '@/stores/message-store';
import type { Session } from '@/stores/session-store';
import { ContextMenu } from './menus/ContextMenu';

export interface SessionUsage {
  tokens: number;
  cost: number;
}

function relativeTime(dateStr?: string): string {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

interface SessionItemProps {
  session: Session;
  isActive: boolean;
  usage?: SessionUsage;
}

export function SessionItem({ session, isActive, usage }: SessionItemProps) {
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const renameSession = useSessionStore((s) => s.renameSession);
  const agents = useAgentStore((s) => s.agents);
  const [hovered, setHovered] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(session.title ?? '');
  const unreadCount = useMessageStore((s) => s.getUnreadCount(session.id));

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleClick = () => {
    setActiveSession(session.id);
    useMessageStore.getState().clearUnread(session.id);
    if (window.innerWidth < 768) {
      useUIStore.getState().setMobileSidebarOpen(false);
    }
  };

  const handleDelete = () => {
    void deleteSession(session.id);
  };

  // Resolve agent name from ID
  const sessionAgent = session.agent_id ? agents.find((a) => a.id === session.agent_id) : null;
  const subtitle = sessionAgent
    ? `${sessionAgent.emoji || '🤖'} ${sessionAgent.name}`
    : session.agent_id
    ? `Agent: ${session.agent_id.slice(0, 8)}…`
    : session.model_id ?? session.provider_id ?? '—';

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
          padding: '6px 16px',
          cursor: 'pointer',
          transition: 'all 120ms',
          borderLeft: `3px solid ${isActive ? 'var(--coral)' : 'transparent'}`,
          background: isActive || hovered ? 'var(--surface-hover)' : 'transparent',
          position: 'relative',
        }}
      >
        {/* Emoji/icon */}
        <span style={{ fontSize: 15, minWidth: 20, textAlign: 'center', flexShrink: 0 }}>
          {session.mode === 'squad' ? '👥' : '💬'}
        </span>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--text)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {isRenaming ? (
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && renameValue.trim()) {
                    renameSession(session.id, renameValue.trim());
                    setIsRenaming(false);
                  }
                  if (e.key === 'Escape') setIsRenaming(false);
                }}
                onBlur={() => {
                  if (renameValue.trim() && renameValue.trim() !== (session.title ?? '')) {
                    renameSession(session.id, renameValue.trim());
                  }
                  setIsRenaming(false);
                }}
                style={{
                  width: '100%', padding: '1px 4px', borderRadius: 4,
                  background: 'var(--bg)', border: '1px solid var(--coral)',
                  color: 'var(--text)', fontSize: 13, fontWeight: 500,
                  outline: 'none',
                }}
              />
            ) : (
              session.title || 'New Chat'
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 1 }}>
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-secondary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flex: 1,
                minWidth: 0,
              }}
            >
              {subtitle}
            </span>
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                flexShrink: 0,
                marginLeft: 6,
              }}
            >
              {relativeTime(session.updated_at)}
            </span>
            {!isActive && unreadCount > 0 && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#fff',
                  background: 'var(--coral, #F97066)',
                  borderRadius: 10,
                  minWidth: 18,
                  height: 18,
                  lineHeight: '18px',
                  textAlign: 'center',
                  padding: '0 5px',
                  marginLeft: 6,
                  flexShrink: 0,
                }}
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>
          {usage && usage.tokens > 0 && (
            <span style={{
              fontSize: 10,
              color: 'var(--text-muted, #484F58)',
              fontFamily: 'var(--font-mono)',
              display: 'block',
              marginTop: 1,
            }}>
              {`${(usage.tokens / 1000).toFixed(1)}k tok · $${usage.cost.toFixed(3)}`}
            </span>
          )}
        </div>

        {/* Delete × button (visible on hover) */}
        {hovered && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDelete();
            }}
            title="Delete session" aria-label="Delete session"
            style={{
              width: 18,
              height: 18,
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              color: 'var(--text-muted)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              flexShrink: 0,
              transition: 'color 100ms',
              lineHeight: 1,
              padding: 0,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--coral)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
            }}
          >
            ×
          </button>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onRename={() => {
            setContextMenu(null);
            setRenameValue(session.title ?? '');
            setIsRenaming(true);
          }}
          onDelete={handleDelete}
          onExport={() => {
            setContextMenu(null);
            // Export session messages as JSON
            fetch(`/api/sessions/${encodeURIComponent(session.id)}/messages`)
              .then(r => r.json())
              .then(json => {
                const blob = new Blob([JSON.stringify(json.data ?? json, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${(session.title ?? session.id).replace(/[^a-zA-Z0-9]/g, '_')}.json`;
                a.click();
                URL.revokeObjectURL(url);
              })
              .catch(() => { /* silent fail */ });
          }}
        />
      )}
    </>
  );
}
