'use client';

/**
 * FederationBadge — shows "federated" indicator on shadow agents.
 */
export function FederationBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      title="Federated agent (remote)"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        padding: compact ? '0 4px' : '1px 6px',
        borderRadius: 4,
        fontSize: compact ? 9 : 10,
        fontWeight: 600,
        background: 'rgba(99, 102, 241, 0.12)',
        color: 'rgb(129, 140, 248)',
        border: '1px solid rgba(99, 102, 241, 0.2)',
        lineHeight: compact ? '14px' : '16px',
        whiteSpace: 'nowrap',
      }}
    >
      🔗 {compact ? '' : 'federated'}
    </span>
  );
}

/**
 * HybridSquadBadge — shows "hybrid" indicator on squads with mixed local + federated agents.
 */
export function HybridSquadBadge() {
  return (
    <span
      title="Hybrid squad (local + federated agents)"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        padding: '1px 6px',
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 600,
        background: 'rgba(234, 179, 8, 0.12)',
        color: 'rgb(234, 179, 8)',
        border: '1px solid rgba(234, 179, 8, 0.2)',
        lineHeight: '16px',
        whiteSpace: 'nowrap',
      }}
    >
      ⚡ hybrid
    </span>
  );
}
