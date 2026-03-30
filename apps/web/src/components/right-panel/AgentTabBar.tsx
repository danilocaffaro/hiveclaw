'use client';

import { useState, useEffect } from 'react';
import { useRSPStore, selectActiveSquadId, selectSelectedMemberId } from '@/stores/rsp-store';
import { useSquadStore } from '@/stores/squad-store';
import { useAgentStore } from '@/stores/agent-store';

/**
 * L-2: Agent tab bar for squad context.
 * Shows emoji+name+NEXUS role tabs for each squad member above PanelTabs.
 * Only renders when activeSquadId is set (squad mode).
 */
export default function AgentTabBar() {
  const squadId = useRSPStore(selectActiveSquadId);
  const selectedMemberId = useRSPStore(selectSelectedMemberId);
  const setSelectedMember = useRSPStore((s) => s.setSelectedMember);
  const setActiveAgent = useRSPStore((s) => s.setActiveAgent);

  const squads = useSquadStore((s) => s.squads);
  const agents = useAgentStore((s) => s.agents);
  const [nexusRoles, setNexusRoles] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!squadId) return;
    fetch(`/api/squads/${squadId}/members`)
      .then(r => r.ok ? r.json() : { data: [] })
      .then(d => {
        const roles: Record<string, string> = {};
        for (const m of d.data ?? []) {
          if (m.nexusRole && m.nexusRole !== 'member') roles[m.agentId ?? m.agent_id] = m.nexusRole;
        }
        setNexusRoles(roles);
      })
      .catch(() => {});
  }, [squadId]);

  if (!squadId) return null;

  const squad = squads.find((s) => s.id === squadId);
  if (!squad) return null;

  const memberIds: string[] = squad.agentIds ?? [];

  const members = memberIds.map((id) => {
    // B18 fix: Try agent store first, then fall back to resolved agents from squad API response
    const agent = agents.find((a) => a.id === id);
    const resolvedFromSquad = squad.agents?.find((a) => a.id === id);
    return {
      id,
      name: agent?.name ?? resolvedFromSquad?.name ?? id.slice(0, 6),
      emoji: agent?.emoji ?? resolvedFromSquad?.emoji ?? '🤖',
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
            {nexusRoles[m.id] && (
              <span style={{
                fontSize: 9,
                fontWeight: 600,
                color: active ? 'var(--coral)' : 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.3px',
              }}>
                {nexusRoles[m.id] === 'po' ? 'PO' :
                 nexusRoles[m.id] === 'tech-lead' ? 'TL' :
                 nexusRoles[m.id] === 'qa-lead' ? 'QA' :
                 nexusRoles[m.id] === 'sre' ? 'SRE' : ''}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
