'use client';

import { useState } from 'react';
import type { AgentRow, WorkerAgentStatus } from './types';
import { WORKER_STATE_DOT } from './types';
import { StatusBadge } from './StatusBadge';
import { FederationBadge } from '../../federation/FederationBadge';

export function AgentCard({
  agent,
  workerStatus,
  onEdit,
  onDelete,
}: {
  agent: AgentRow;
  workerStatus?: WorkerAgentStatus;
  onEdit: (a: AgentRow) => void;
  onDelete: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const isProtected = agent.id === 'super' || agent.type === 'super';

  const handleDelete = () => {
    if (isProtected) return;
    if (!confirm(`Delete agent "${agent.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    onDelete(agent.id);
  };

  // Determine live state from worker pool (if available)
  const liveState = workerStatus?.state;
  const dotInfo = liveState ? WORKER_STATE_DOT[liveState] : undefined;

  return (
    <div
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        transition: 'border-color 150ms, box-shadow 150ms',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-hover)';
        (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 20px rgba(0,0,0,0.15)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)';
        (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
      }}
    >
      {/* Color accent bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: agent.color || 'var(--coral)',
        borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
      }} />

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 4 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 'var(--radius-md)',
          background: `color-mix(in srgb, ${agent.color || 'var(--coral)'} 15%, var(--surface-hover))`,
          border: `1px solid color-mix(in srgb, ${agent.color || 'var(--coral)'} 30%, transparent)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, flexShrink: 0,
        }}>
          {agent.emoji}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {agent.name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {agent.role}
          </div>
        </div>
        {isProtected && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', padding: '2px 6px', borderRadius: 4, background: 'var(--surface-hover)', border: '1px solid var(--border)', flexShrink: 0 }}>
            Protected
          </span>
        )}
        {(agent as unknown as Record<string, unknown>).is_shadow === 1 && <FederationBadge />}
      </div>

      {/* Status badge — live from worker pool or fallback to DB status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {dotInfo ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 8px',
              borderRadius: 12,
              fontSize: 11,
              fontWeight: 600,
              background: `color-mix(in srgb, ${dotInfo.color} 12%, transparent)`,
              color: dotInfo.color,
              border: `1px solid color-mix(in srgb, ${dotInfo.color} 30%, transparent)`,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: dotInfo.color,
                boxShadow: dotInfo.glow ? `0 0 6px ${dotInfo.color}` : 'none',
                flexShrink: 0,
                animation: dotInfo.glow ? 'pulse 1.5s infinite ease-in-out' : 'none',
              }}
            />
            {dotInfo.label}
          </span>
        ) : (
          <StatusBadge status={agent.status ?? 'offline'} />
        )}
        {workerStatus?.stats && (
          <span style={{
            fontSize: 10,
            color: 'var(--text-muted)',
            marginLeft: 'auto',
          }}>
            {workerStatus.stats.messages > 0 && `${workerStatus.stats.messages} msg`}
            {workerStatus.stats.tokens > 0 && ` · ${(workerStatus.stats.tokens / 1000).toFixed(1)}k tok`}
          </span>
        )}
      </div>

      {/* System prompt preview */}
      <div style={{
        fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5,
        overflow: 'hidden', display: '-webkit-box',
        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
      }}>
        {agent.systemPrompt}
      </div>

      {/* Meta */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {agent.source === 'hiveclaw' && (
          <span style={{ fontSize: 10, color: 'var(--coral)', padding: '2px 7px', borderRadius: 'var(--radius-sm)', background: 'color-mix(in srgb, var(--coral) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--coral) 20%, transparent)' }}>
            ⚡ Local
          </span>
        )}
        {agent.modelPreference && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', padding: '2px 7px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>
            🤖 {agent.modelPreference}
          </span>
        )}
        {agent.skills?.length > 0 && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', padding: '2px 7px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-hover)', border: '1px solid var(--border)' }}>
            ⚡ {agent.skills.length} skill{agent.skills.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
        <button
          onClick={() => onEdit(agent)}
          style={{
            flex: 1, padding: '6px 0', borderRadius: 'var(--radius-md)',
            background: 'var(--surface-hover)', border: '1px solid var(--border)',
            color: 'var(--text)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
            transition: 'all 150ms',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--coral)'; e.currentTarget.style.color = 'var(--coral)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text)'; }}
        >
          ✏️ Edit
        </button>
        <button
          onClick={async () => {
            try {
              const res = await fetch('/api/shared-links', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentId: agent.id, title: `Chat with ${agent.name}` }),
              });
              const json = await res.json() as { data?: { token?: string } };
              const token = json?.data?.token;
              if (token) {
                const url = `${window.location.origin}/#/chat/${token}`;
                await navigator.clipboard.writeText(url);
                alert(`Link copied!\n${url}`);
              }
            } catch { alert('Failed to create share link'); }
          }}
          style={{
            width: 32, height: 32, borderRadius: 'var(--radius-md)',
            background: 'var(--surface-hover)', border: '1px solid var(--border)',
            color: 'var(--text-muted)', fontSize: 14, cursor: 'pointer',
            transition: 'all 150ms', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--green)'; e.currentTarget.style.color = 'var(--green)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
          title="Share — create public chat link" aria-label="Share chat link"
        >
          🔗
        </button>
        {!isProtected && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            style={{
              width: 32, height: 32, borderRadius: 'var(--radius-md)',
              background: 'var(--surface-hover)', border: '1px solid var(--border)',
              color: 'var(--text-muted)', fontSize: 14, cursor: deleting ? 'not-allowed' : 'pointer',
              transition: 'all 150ms', display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--coral)'; e.currentTarget.style.color = 'var(--coral)'; e.currentTarget.style.background = 'color-mix(in srgb, var(--coral) 8%, transparent)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'var(--surface-hover)'; }}
            title="Delete agent" aria-label="Delete agent"
          >
            {deleting ? '…' : '🗑️'}
          </button>
        )}
      </div>
    </div>
  );
}
