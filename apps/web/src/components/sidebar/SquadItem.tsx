'use client';

import { useState, useRef, useEffect } from 'react';
import { useSessionStore } from '@/stores/session-store';
import { useUIStore } from '@/stores/ui-store';
import { useRSPStore } from '@/stores/rsp-store';
import { useSquadStore } from '@/stores/squad-store';
import type { Squad } from '@/stores/squad-store';
import type { Agent } from '@/stores/agent-store';
import { HybridSquadBadge } from '../federation/FederationBadge';

interface SquadItemProps {
  squad: Squad;
  agents: Agent[];
  onEdit?: (squad: Squad) => void;
}

export function SquadItem({ squad, agents, onEdit }: SquadItemProps) {
  const createSquadSession = useSessionStore((s) => s.createSquadSession);
  const deleteSquad = useSquadStore((s) => s.deleteSquad);
  const [hovered, setHovered] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close context menu on outside click
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setShowMenu(true);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete squad "${squad.name}"?`)) return;
    setDeleting(true);
    try {
      await deleteSquad(squad.id);
    } catch (err) {
      console.error('Failed to delete squad:', err);
    } finally {
      setDeleting(false);
      setShowMenu(false);
    }
  };

  const handleClick = () => {
    const firstMember = agentIds[0] ?? null;
    useRSPStore.getState().enterSquad(squad.id, firstMember ?? undefined);
    void createSquadSession(squad.id, `Squad: ${squad.name}`);
    if (window.innerWidth < 768) {
      useUIStore.getState().setMobileSidebarOpen(false);
    }
  };

  const agentIds = squad.agentIds ?? [];
  const visibleIds = agentIds.slice(0, 3);
  const extraCount = agentIds.length - visibleIds.length;

  // Resolve member agents for emoji display
  const resolvedMembers = visibleIds.map((agentId) =>
    agents.find((a) => a.id === agentId)
  );

  // Check if squad has any federated (shadow) agents
  const hasFederatedAgents = agentIds.some(id => {
    const agent = agents.find(a => a.id === id);
    return agent?.isShadow;
  });

  return (
    <div
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); }}
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
        borderLeft: '3px solid transparent',
        background: hovered ? 'var(--surface-hover)' : 'transparent',
        position: 'relative',
      }}
    >
      {/* Context menu */}
      {showMenu && (
        <div
          ref={menuRef}
          style={{
            position: 'absolute',
            top: '100%',
            right: 8,
            zIndex: 50,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            padding: 4,
            minWidth: 140,
          }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setShowMenu(false); onEdit?.(squad); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '6px 10px',
              background: 'transparent',
              border: 'none',
              borderRadius: 6,
              color: 'var(--text)',
              fontSize: 13,
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            ✏️ Edit Squad
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '6px 10px',
              background: 'transparent',
              border: 'none',
              borderRadius: 6,
              color: '#ef4444',
              fontSize: 13,
              cursor: deleting ? 'wait' : 'pointer',
              opacity: deleting ? 0.5 : 1,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            🗑️ {deleting ? 'Deleting...' : 'Delete Squad'}
          </button>
        </div>
      )}

      {/* Hover delete icon */}
      {hovered && !showMenu && (
        <button
          onClick={handleDelete}
          title="Delete squad"
          style={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: 12,
            opacity: 0.5,
            padding: '2px 4px',
            borderRadius: 4,
            color: 'var(--text-muted)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = '#ef4444'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          ✕
        </button>
      )}
      {/* Squad icon */}
      <span style={{ fontSize: 15, minWidth: 20, textAlign: 'center', flexShrink: 0 }}>
        {squad.emoji || '👥'}
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
          {squad.name}
          {hasFederatedAgents && (
            <span style={{ marginLeft: 6, verticalAlign: 'middle' }}>
              <HybridSquadBadge />
            </span>
          )}
        </div>

        {/* Mini member avatar row */}
        {agentIds.length > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 3, gap: 0 }}>
            {resolvedMembers.map((agent, idx) => (
              <div
                key={visibleIds[idx] ?? idx}
                title={agent?.name ?? visibleIds[idx]}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 9,
                  border: '2px solid var(--surface)',
                  marginLeft: idx === 0 ? 0 : -5,
                  background: agent?.color ? `${agent.color}22` : 'var(--surface-hover)',
                  flexShrink: 0,
                  zIndex: 3 - idx,
                  position: 'relative',
                }}
              >
                {agent?.emoji ?? '🤖'}
              </div>
            ))}
            {extraCount > 0 && (
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 8,
                  fontWeight: 600,
                  border: '2px solid var(--surface)',
                  marginLeft: -5,
                  background: 'var(--surface-hover)',
                  color: 'var(--text-secondary)',
                  flexShrink: 0,
                  position: 'relative',
                  zIndex: 0,
                }}
              >
                +{extraCount}
              </div>
            )}
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                marginLeft: 6,
              }}
            >
              {agentIds.length} member{agentIds.length !== 1 ? 's' : ''}
            </span>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>No members</div>
        )}
      </div>
    </div>
  );
}
