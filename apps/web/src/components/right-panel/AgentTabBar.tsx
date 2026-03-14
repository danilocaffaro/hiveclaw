'use client';

import { useRSPStore, selectActiveSquadId, selectSelectedMemberId } from '@/stores/rsp-store';
import { useSquadStore } from '@/stores/squad-store';
import { useAgentStore } from '@/stores/agent-store';

/**
 * L-2: Agent tab bar for squad context.
 * Shows emoji+name tabs for each squad member above PanelTabs.
 * Only renders when activeSquadId is set (squad mode).
 */
export default function AgentTabBar() {
  const squadId = useRSPStore(selectActiveSquadId);
  const selectedMemberId = useRSPStore(selectSelectedMemberId);
  const setSelectedMember = useRSPStore((s) => s.setSelectedMember);
  const setActiveAgent = useRSPStore((s) => s.setActiveAgent);

  const squads = useSquadStore((s) => s.squads);
  const agents = useAgentStore((s) => s.agents);

  if (!squadId) return null;

  const squad = squads.find((s) => s.id === squadId);
  if (!squad) return null;

  const memberIds: string[] = squad.agentIds ?? [];

  const members = memberIds.map((id) => {
    const agent = agents.find((a) => a.id === id);
    return {
      id,
      name: agent?.name ?? id.slice(0, 6),
      emoji: agent?.emoji ?? '🤖',
    };
  });

  if (members.length === 0) return null;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      padding: '4px 8px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--surface)',
      overflowX: 'auto',
      flexShrink: 0,
    }}>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, marginRight: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Members
      </span>
      {members.map((m) => {
        const active = m.id === selectedMemberId;
        return (
          <button
            key={m.id}
            onClick={() => {
              setSelectedMember(m.id);
              setActiveAgent(m.id);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 12,
              fontWeight: active ? 600 : 400,
              color: active ? 'var(--text)' : 'var(--text-secondary)',
              background: active ? 'var(--coral-subtle)' : 'transparent',
              border: active ? '1px solid var(--coral)' : '1px solid transparent',
              cursor: 'pointer',
              transition: 'all 120ms',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ fontSize: 13 }}>{m.emoji}</span>
            <span>{m.name}</span>
          </button>
        );
      })}
    </div>
  );
}
