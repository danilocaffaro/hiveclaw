'use client';

import React from 'react';
import { useSessionStore, type SquadWorkflowStep } from '@/stores/session-store';

function StepDot({ step, isLast }: { step: SquadWorkflowStep; isLast: boolean }) {
  const colors = {
    pending: 'var(--text-muted)',
    running: 'var(--blue)',
    done: 'var(--green)',
    failed: 'var(--coral)',
  } as const;

  const color = colors[step.status];
  const duration = step.startedAt && step.finishedAt
    ? `${((step.finishedAt - step.startedAt) / 1000).toFixed(1)}s`
    : step.startedAt && step.status === 'running'
    ? '...'
    : '';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexShrink: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <div style={{
          width: 26, height: 26, borderRadius: '50%',
          background: step.status === 'running' ? `${color}20` : 'transparent',
          border: `2px solid ${color}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.3s ease',
          animation: step.status === 'running' ? 'squadPulse 1.5s ease infinite' : 'none',
        }}>
          {step.status === 'done' ? (
            <span style={{ fontSize: 11, color }}>✓</span>
          ) : step.status === 'failed' ? (
            <span style={{ fontSize: 11, color }}>✕</span>
          ) : (
            <span style={{ fontSize: 12 }}>{step.agentEmoji}</span>
          )}
        </div>
        <span style={{
          fontSize: 10, color: step.status === 'running' ? 'var(--text)' : 'var(--text-muted)',
          fontWeight: step.status === 'running' ? 600 : 400,
          maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          textAlign: 'center',
        }}>
          {step.agentName.split(' ')[0]}
        </span>
        {duration && (
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{duration}</span>
        )}
      </div>
      {!isLast && (
        <div style={{
          width: 24, height: 2, marginTop: -14,
          background: step.status === 'done' ? 'var(--green)' : 'var(--border)',
          transition: 'background 0.3s ease',
        }} />
      )}
    </div>
  );
}

export function SquadWorkflowBar() {
  const squadWorkflow = useSessionStore((s) => s.squadWorkflow);

  if (squadWorkflow.length === 0) return null;

  return (
    <>
      <style>{`
        @keyframes squadPulse {
          0%, 100% { box-shadow: 0 0 0 0 var(--blue-subtle); }
          50% { box-shadow: 0 0 0 4px var(--blue-subtle); }
        }
      `}</style>
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 0,
        padding: '10px 16px', marginBottom: 8,
        background: 'var(--glass-bg)',
        border: '1px solid var(--glass-border)',
        borderRadius: 'var(--radius-lg)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        overflowX: 'auto',
        justifyContent: 'center',
      }}>
        {squadWorkflow.map((step, i) => (
          <StepDot key={step.agentId} step={step} isLast={i === squadWorkflow.length - 1} />
        ))}
      </div>
    </>
  );
}
