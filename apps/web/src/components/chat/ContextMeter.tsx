'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface ContextUsageData {
  tokensUsed: number;
  contextWindow: number;
  percentUsed: number;
  messageCount: number;
  costUsd: number;
  model: string;
  canCompact: boolean;
}

interface ContextMeterProps {
  sessionId: string;
  isStreaming?: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}

function getColor(percent: number): { color: string; bg: string; track: string } {
  if (percent >= 80) return { color: 'var(--coral, #ff6b6b)', bg: 'var(--coral-subtle, rgba(255,107,107,0.15))', track: 'rgba(255,107,107,0.2)' };
  if (percent >= 50) return { color: 'var(--yellow, #f5a623)', bg: 'var(--yellow-subtle, rgba(245,166,35,0.15))', track: 'rgba(245,166,35,0.2)' };
  return { color: 'var(--green, #51cf66)', bg: 'var(--green-subtle, rgba(81,207,102,0.15))', track: 'rgba(81,207,102,0.2)' };
}

// ─── SVG Circular Progress ──────────────────────────────────────────────────────

function CircularProgress({ percent, size = 80, strokeWidth = 6 }: { percent: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(percent, 100) / 100) * circumference;
  const { color, track } = getColor(percent);

  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      {/* Track */}
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke={track} strokeWidth={strokeWidth}
      />
      {/* Progress */}
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 0.6s ease-out, stroke 0.3s ease' }}
      />
    </svg>
  );
}

// ─── Mini Circular Progress (for header button) ─────────────────────────────────

function MiniCircularProgress({ percent, size = 18, strokeWidth = 2.5 }: { percent: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(percent, 100) / 100) * circumference;
  const { color } = getColor(percent);

  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke="var(--border)" strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 0.6s ease-out' }}
      />
    </svg>
  );
}

// ─── ContextMeter Popover ───────────────────────────────────────────────────────

export function ContextMeter({ sessionId, isStreaming }: ContextMeterProps) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ContextUsageData | null>(null);
  const [compacting, setCompacting] = useState(false);
  const [compactResult, setCompactResult] = useState<'success' | 'error' | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Fetch context usage
  const fetchUsage = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/context-usage`);
      if (!res.ok) return;
      const json = await res.json();
      if (json.data) setData(json.data);
    } catch { /* ignore */ }
  }, [sessionId]);

  // Fetch on open + periodically when streaming
  useEffect(() => {
    if (!sessionId) return;
    fetchUsage();
    const interval = isStreaming ? setInterval(fetchUsage, 15000) : undefined;
    return () => { if (interval) clearInterval(interval); };
  }, [sessionId, isStreaming, fetchUsage]);

  // Refetch when popover opens
  useEffect(() => {
    if (open) fetchUsage();
  }, [open, fetchUsage]);

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  // Compact session
  const handleCompact = async () => {
    if (!sessionId || compacting) return;
    setCompacting(true);
    setCompactResult(null);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/compact`, { method: 'POST' });
      if (res.ok) {
        setCompactResult('success');
        // Refresh data after compaction
        setTimeout(fetchUsage, 1000);
      } else {
        setCompactResult('error');
      }
    } catch {
      setCompactResult('error');
    } finally {
      setCompacting(false);
      // Clear result after 3s
      setTimeout(() => setCompactResult(null), 3000);
    }
  };

  const percent = data?.percentUsed ?? 0;
  const { color, bg } = getColor(percent);

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      {/* Trigger button — mini circular progress */}
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        title="Context usage"
        aria-label="Context usage"
        style={{
          width: 32, height: 32, borderRadius: 'var(--radius-md)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: open ? 'var(--surface-hover)' : 'transparent',
          border: 'none', cursor: 'pointer',
          position: 'relative',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent'; }}
      >
        {data ? (
          <MiniCircularProgress percent={percent} />
        ) : (
          <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>📊</span>
        )}
      </button>

      {/* Popover */}
      {open && (
        <div
          ref={popoverRef}
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            zIndex: 1000,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 16,
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            padding: '20px',
            minWidth: 280,
            maxWidth: 320,
            animation: 'fadeIn 150ms ease-out',
          }}
        >
          {!data ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px 0', fontSize: 13 }}>
              Loading…
            </div>
          ) : (
            <>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Context Usage</span>
                <span style={{
                  padding: '2px 10px', borderRadius: 'var(--radius-sm)',
                  background: bg, color: color,
                  fontSize: 12, fontWeight: 600,
                }}>
                  {percent.toFixed(1)}%
                </span>
              </div>

              {/* Circular progress */}
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16, position: 'relative' }}>
                <CircularProgress percent={percent} size={88} strokeWidth={7} />
                <div style={{
                  position: 'absolute', top: '50%', left: '50%',
                  transform: 'translate(-50%, -50%)',
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: color }}>{Math.round(percent)}%</div>
                </div>
              </div>

              {/* Stats grid */}
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr',
                gap: '10px', marginBottom: 16,
              }}>
                {/* Tokens used */}
                <div style={{
                  padding: '10px 12px', borderRadius: 10,
                  background: 'var(--surface-hover)',
                }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Tokens used
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                    {formatTokens(data.tokensUsed)}
                  </div>
                </div>

                {/* Context limit */}
                <div style={{
                  padding: '10px 12px', borderRadius: 10,
                  background: 'var(--surface-hover)',
                }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Model limit
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                    {formatTokens(data.contextWindow)}
                  </div>
                </div>

                {/* Messages */}
                <div style={{
                  padding: '10px 12px', borderRadius: 10,
                  background: 'var(--surface-hover)',
                }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Messages
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                    {data.messageCount}
                  </div>
                </div>

                {/* Session cost */}
                <div style={{
                  padding: '10px 12px', borderRadius: 10,
                  background: 'var(--surface-hover)',
                }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Session cost
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                    {formatCost(data.costUsd)}
                  </div>
                </div>
              </div>

              {/* Model name */}
              <div style={{
                fontSize: 11, color: 'var(--text-muted)',
                textAlign: 'center', marginBottom: 14,
                fontFamily: 'var(--font-mono)',
              }}>
                {data.model || 'Unknown model'}
              </div>

              {/* Compact button */}
              <button
                onClick={handleCompact}
                disabled={!data.canCompact || compacting}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  borderRadius: 10,
                  background: data.canCompact ? 'var(--surface-hover)' : 'transparent',
                  border: `1px solid ${data.canCompact ? 'var(--border)' : 'var(--border)'}`,
                  color: data.canCompact ? 'var(--text)' : 'var(--text-muted)',
                  fontSize: 13, fontWeight: 500,
                  cursor: data.canCompact ? 'pointer' : 'not-allowed',
                  opacity: data.canCompact ? 1 : 0.5,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={(e) => { if (data.canCompact) e.currentTarget.style.background = 'var(--border)'; }}
                onMouseLeave={(e) => { if (data.canCompact) e.currentTarget.style.background = 'var(--surface-hover)'; }}
              >
                <span>{compacting ? '⏳' : '🔄'}</span>
                <span>
                  {compacting ? 'Compacting…' :
                   compactResult === 'success' ? '✅ Compacted!' :
                   compactResult === 'error' ? '❌ Failed' :
                   'Compact Session'}
                </span>
              </button>

              {!data.canCompact && (
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', marginTop: 6 }}>
                  Not enough messages to compact (&lt;20)
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
