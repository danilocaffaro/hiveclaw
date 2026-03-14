'use client';

import { useState } from 'react';
import { useSessionStore } from '@/stores/session-store';
import { useUIStore } from '@/stores/ui-store';
import { useRSPStore } from '@/stores/rsp-store';
import type { Squad } from '@/stores/squad-store';
import type { Agent } from '@/stores/agent-store';

interface SquadItemProps {
  squad: Squad;
  agents: Agent[];
}

export function SquadItem({ squad, agents }: SquadItemProps) {
  const createSquadSession = useSessionStore((s) => s.createSquadSession);
  const [hovered, setHovered] = useState(false);

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

  return (
    <div
      onClick={handleClick}
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
        borderLeft: '3px solid transparent',
        background: hovered ? 'var(--surface-hover)' : 'transparent',
      }}
    >
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
