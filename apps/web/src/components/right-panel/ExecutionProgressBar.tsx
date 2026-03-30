'use client';

import React, { useState, useEffect } from 'react';
import { useElapsedTime } from '@/hooks/useElapsedTime';

/* ── Types ────────────────────────────────────────────── */

export interface ExecutionStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped';
  startedAt?: number;
  finishedAt?: number;
}

export interface ExecutionProgressBarProps {
  steps: ExecutionStep[];
  currentStepIndex: number;
  startedAt: number;
  isRunning: boolean;
}

type BarState = 'idle' | 'running' | 'done';

/* ── Component ────────────────────────────────────────── */

export default function ExecutionProgressBar({
  steps,
  currentStepIndex,
  startedAt,
  isRunning,
}: ExecutionProgressBarProps) {
  const elapsed = useElapsedTime(isRunning ? startedAt : null);
  const [barState, setBarState] = useState<BarState>('idle');
  const [visible, setVisible] = useState(false);

  const doneCount = steps.filter(s => s.status === 'done' || s.status === 'error').length;
  const totalCount = steps.length;
  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  // State machine: idle → running → done (fade out after 3s)
  useEffect(() => {
    if (isRunning && totalCount > 0) {
      setBarState('running');
      setVisible(true);
    } else if (!isRunning && barState === 'running') {
      setBarState('done');
      const timer = setTimeout(() => {
        setVisible(false);
        setBarState('idle');
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [isRunning, totalCount, barState]);

  if (!visible && barState === 'idle') return null;

  /* ── Tool chain ────────────────────────────────────── */
  const toolChain = steps.map((step, i) => {
    const isLast = i === steps.length - 1;
    const statusIcon =
      step.status === 'done' ? '✓' :
      step.status === 'error' ? '✗' :
      step.status === 'running' ? '' :
      '';

    return (
      <span key={step.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
        {step.status === 'running' ? (
          <span style={styles.runningTool}>[{step.label} running…]</span>
        ) : (
          <span style={{
            color: step.status === 'error' ? '#EF4444' :
                   step.status === 'done' ? '#10B981' :
                   'var(--fg-muted)',
          }}>
            {step.label}{statusIcon && ` ${statusIcon}`}
          </span>
        )}
        {!isLast && step.status !== 'running' && (
          <span style={{ color: 'var(--fg-muted)', margin: '0 2px' }}> → </span>
        )}
      </span>
    );
  });

  return (
    <div style={{
      ...styles.wrap,
      opacity: barState === 'done' ? 0 : 1,
      transition: 'opacity 0.6s ease-out',
    }}>
      {/* Row 1: Status + Step counter + Elapsed */}
      <div style={styles.topRow}>
        <span style={styles.statusBadge}>
          {barState === 'done' ? '✅' : '🚀'}{' '}
          {barState === 'done' ? 'Done' : 'Running'}
        </span>
        <span style={styles.separator}>•</span>
        <span style={styles.stepCounter}>
          Step {Math.min(doneCount + 1, totalCount)} / {totalCount}
        </span>
        <span style={styles.separator}>•</span>
        <span style={styles.elapsed}>⏱ {elapsed}</span>
      </div>

      {/* Row 2: Progress bar */}
      <div style={styles.barTrack}>
        <div style={{
          ...styles.barFill,
          width: `${barState === 'done' ? 100 : progressPct}%`,
        }} />
      </div>

      {/* Row 3: Tool chain */}
      {steps.length > 0 && (
        <div style={styles.toolChain}>
          {toolChain}
        </div>
      )}
    </div>
  );
}

/* ── Styles ───────────────────────────────────────────── */

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    padding: '8px 12px',
    borderBottom: '1px solid var(--border)',
    background: 'rgba(59,130,246,0.04)',
    flexShrink: 0,
  },
  topRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 11,
    marginBottom: 4,
  },
  statusBadge: {
    fontWeight: 700,
    color: 'var(--accent)',
  },
  separator: {
    color: 'var(--fg-muted)',
    fontSize: 10,
  },
  stepCounter: {
    color: 'var(--text)',
    fontWeight: 600,
  },
  elapsed: {
    color: 'var(--fg-muted)',
    fontFamily: 'var(--font-mono)',
  },
  barTrack: {
    height: 4,
    borderRadius: 2,
    background: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    marginBottom: 4,
  },
  barFill: {
    height: '100%',
    borderRadius: 2,
    background: 'var(--accent)',
    transition: 'width 0.4s ease-out',
    minWidth: 4,
  },
  toolChain: {
    fontSize: 10,
    fontFamily: 'var(--font-mono)',
    color: 'var(--fg-muted)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  runningTool: {
    color: 'var(--accent)',
    animation: 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
  },
};
