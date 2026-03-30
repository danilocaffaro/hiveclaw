'use client';

import React from 'react';

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface BudgetConfig {
  /** Max tokens before budget is "exhausted" */
  maxTokens?: number;
  /** Max cost in USD (default: $5.00) */
  maxCostUsd: number;
  /** Warn threshold as ratio 0–1 (default: 0.8) */
  warnAt?: number;
  /** Hard-stop threshold as ratio 0–1 (default: 0.95) */
  hardStopAt?: number;
}

export interface BudgetGuardProps {
  usage: TokenUsage;
  budget?: BudgetConfig;
  compact?: boolean;
}

/* ══════════════════════════════════════════════════════════
   Defaults & Utilities
   ══════════════════════════════════════════════════════════ */

const DEFAULT_BUDGET: BudgetConfig = {
  maxCostUsd: 5.0,
  warnAt: 0.8,
  hardStopAt: 0.95,
};

/** Compute budget ratio (0–1+) based on whichever limit is closer */
export function computeBudgetRatio(
  usage: TokenUsage,
  budget: BudgetConfig,
): number {
  const costRatio = budget.maxCostUsd > 0
    ? usage.costUsd / budget.maxCostUsd
    : 0;
  const tokenRatio = budget.maxTokens && budget.maxTokens > 0
    ? usage.totalTokens / budget.maxTokens
    : 0;
  return Math.max(costRatio, tokenRatio);
}

/** Color for the progress bar based on ratio */
function barColor(ratio: number): string {
  if (ratio <= 0.5) return '#10B981';   // green — safe
  if (ratio <= 0.8) return '#F59E0B';   // yellow/amber — caution
  return '#EF4444';                      // red — critical
}

/** Format cost with appropriate decimal places */
function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** Format token count with K/M suffixes */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

/** Status emoji based on ratio */
function statusEmoji(ratio: number): string {
  if (ratio <= 0.5) return '💰';
  if (ratio <= 0.8) return '💰';
  if (ratio <= 0.95) return '⚠️';
  return '🚨';
}

/* ══════════════════════════════════════════════════════════
   Component
   ══════════════════════════════════════════════════════════ */

export default function BudgetGuard({
  usage,
  budget: budgetProp,
  compact = false,
}: BudgetGuardProps) {
  const budget = { ...DEFAULT_BUDGET, ...budgetProp };
  const ratio = computeBudgetRatio(usage, budget);
  const clampedRatio = Math.min(ratio, 1);
  const pct = Math.round(clampedRatio * 100);
  const color = barColor(ratio);
  const emoji = statusEmoji(ratio);
  const warnAt = budget.warnAt ?? 0.8;

  // Nothing to show when zero usage
  if (usage.totalTokens === 0 && usage.costUsd === 0) {
    return (
      <div style={styles.wrap}>
        <div style={styles.row}>
          <span style={styles.muted}>💰 No token usage yet</span>
        </div>
      </div>
    );
  }

  // Compact mode: single line with icon + cost
  if (compact) {
    return (
      <div style={styles.wrap}>
        <div style={styles.row}>
          <span style={{ ...styles.label, color }}>
            {emoji} {formatCost(usage.costUsd)}
          </span>
          <span style={styles.muted}>/</span>
          <span style={styles.muted}>{formatCost(budget.maxCostUsd)}</span>
        </div>
        <div style={styles.barTrack}>
          <div style={{ ...styles.barFill, width: `${pct}%`, background: color }} />
        </div>
      </div>
    );
  }

  // Full mode
  return (
    <div style={styles.wrap}>
      {/* Row 1: Token counts + cost */}
      <div style={styles.row}>
        <span style={styles.label}>
          {emoji}{' '}
          <span style={styles.text}>
            Tokens: {formatTokens(usage.inputTokens)} in / {formatTokens(usage.outputTokens)} out
          </span>
          <span style={styles.sep}>•</span>
          <span style={{ ...styles.cost, color }}>
            Cost: {formatCost(usage.costUsd)}
          </span>
          <span style={styles.sep}>•</span>
          <span style={styles.muted}>
            Budget: {pct}%
          </span>
        </span>
      </div>

      {/* Row 2: Color-coded progress bar */}
      <div style={styles.barTrack}>
        <div
          style={{
            ...styles.barFill,
            width: `${pct}%`,
            background: color,
          }}
        />
      </div>

      {/* Row 3: Warning message when approaching limit */}
      {ratio >= warnAt && (
        <div style={{ ...styles.warning, color }}>
          {ratio >= 0.95
            ? `Budget nearly exhausted (${formatCost(budget.maxCostUsd)})`
            : `Approaching budget limit (${formatCost(budget.maxCostUsd)})`}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Styles
   ══════════════════════════════════════════════════════════ */

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    padding: '8px 12px',
    borderTop: '1px solid var(--border)',
    background: 'rgba(16, 185, 129, 0.03)',
    flexShrink: 0,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  label: {
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },
  text: {
    color: 'var(--text)',
    fontWeight: 500,
  },
  cost: {
    fontWeight: 700,
  },
  sep: {
    color: 'var(--fg-muted)',
    fontSize: 10,
    margin: '0 2px',
  },
  muted: {
    color: 'var(--fg-muted)',
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
  },
  barTrack: {
    height: 6,
    borderRadius: 3,
    background: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
    transition: 'width 0.4s ease-out, background 0.3s ease',
    minWidth: 2,
  },
  warning: {
    fontSize: 10,
    fontWeight: 600,
    marginTop: 4,
  },
};
