'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getApiBase, getAuthToken } from '../../lib/api-base';
import ExecutionProgressBar, { type ExecutionStep } from './ExecutionProgressBar';
import { useElapsedSeconds } from '@/hooks/useElapsedTime';

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */

interface Activity {
  id: string;
  timestamp: string;
  type: 'tool.start' | 'tool.finish' | 'message.start' | 'message.finish' | 'squad.start' | 'squad.end' | 'info';
  agentName?: string;
  agentEmoji?: string;
  toolName?: string;
  toolInput?: string;
  result?: string;
  duration?: number;
  status?: 'running' | 'done' | 'error';
  /** Epoch ms when this activity was created (for live elapsed timers) */
  startedAtMs?: number;
  /** Retry info — only present when backend sends attempt field */
  attempt?: number;
  maxAttempts?: number;
}

/* ══════════════════════════════════════════════════════════
   Constants
   ══════════════════════════════════════════════════════════ */

const TOOL_ICONS: Record<string, string> = {
  bash: '🖥️',
  read_file: '📄',
  write_file: '💾',
  browser: '🌐',
  search: '🔍',
  memory: '🧠',
  http: '🔗',
  sql: '🗄️',
  image: '🖼️',
  default: '🔧',
};

function toolIcon(name: string): string {
  const lc = name.toLowerCase();
  for (const [key, icon] of Object.entries(TOOL_ICONS)) {
    if (lc.includes(key)) return icon;
  }
  return TOOL_ICONS.default;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function truncate(s: string, n = 80): string {
  return s && s.length > n ? s.slice(0, n) + '…' : s;
}

/** Format ms duration as human-readable string */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}:${String(rem).padStart(2, '0')}`;
}

/* ══════════════════════════════════════════════════════════
   ToolElapsedBadge — live timer for running tools
   ══════════════════════════════════════════════════════════ */

function ToolElapsedBadge({ startedAtMs }: { startedAtMs: number }) {
  const seconds = useElapsedSeconds(startedAtMs);
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const label = m > 0
    ? `${m}:${String(s).padStart(2, '0')}`
    : `${s}s`;
  return <span style={badgeStyles.elapsed}>⏱ {label}…</span>;
}

const badgeStyles: Record<string, React.CSSProperties> = {
  elapsed: {
    marginLeft: 6,
    fontSize: 10,
    color: 'var(--accent)',
    fontFamily: 'var(--font-mono)',
  },
};

/* ══════════════════════════════════════════════════════════
   RetryBadge — shows "Attempt 2/3" when present
   ══════════════════════════════════════════════════════════ */

function RetryBadge({ attempt, maxAttempts }: { attempt: number; maxAttempts?: number }) {
  if (attempt <= 1) return null;
  const label = maxAttempts
    ? `⟳ ${attempt}/${maxAttempts}`
    : `⟳ Attempt ${attempt}`;
  return (
    <span style={retryStyles.badge} title={`Retry attempt ${attempt}${maxAttempts ? ` of ${maxAttempts}` : ''}`}>
      {label}
    </span>
  );
}

const retryStyles: Record<string, React.CSSProperties> = {
  badge: {
    marginLeft: 6,
    fontSize: 9,
    fontWeight: 700,
    color: '#fff',
    background: '#EF4444',
    padding: '1px 5px',
    borderRadius: 4,
    verticalAlign: 'middle',
  },
};

/* ══════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════ */

export default function AgentActivityPanel({ sessionId }: { sessionId?: string }) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [connected, setConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState<'all' | 'tools' | 'messages'>('all');
  const scrollRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const actCounterRef = useRef(0);

  /* ── Progress bar state ──────────────────────────────── */
  const [executionSteps, setExecutionSteps] = useState<ExecutionStep[]>([]);
  const [executionStartedAt, setExecutionStartedAt] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  /* ── Callbacks ──────────────────────────────────────── */

  const addActivity = useCallback((act: Omit<Activity, 'id' | 'timestamp'>) => {
    const id = `act_${Date.now()}_${++actCounterRef.current}`;
    const timestamp = new Date().toISOString();
    setActivities(prev => [...prev.slice(-200), { id, timestamp, ...act }]);
  }, []);

  const updateLastTool = useCallback((toolName: string, updates: Partial<Activity>) => {
    setActivities(prev => {
      const idx = [...prev].reverse().findIndex(
        a => a.type === 'tool.start' && a.toolName === toolName && a.status === 'running',
      );
      if (idx === -1) return prev;
      const realIdx = prev.length - 1 - idx;
      const updated = [...prev];
      updated[realIdx] = { ...updated[realIdx], ...updates };
      return updated;
    });
  }, []);

  /* ── SSE connection ─────────────────────────────────── */

  useEffect(() => {
    if (!sessionId) return;

    const base = getApiBase();
    const token = getAuthToken();
    const url = `${base}/sessions/${sessionId}/events${token ? `?token=${token}` : ''}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener('open', () => setConnected(true));
    es.addEventListener('error', () => setConnected(false));

    es.addEventListener('tool.start', (e) => {
      try {
        const d = JSON.parse(e.data);
        const name = d.name ?? d.toolName ?? 'tool';
        const now = Date.now();

        addActivity({
          type: 'tool.start',
          agentName: d.agentName,
          agentEmoji: d.agentEmoji,
          toolName: name,
          toolInput: typeof d.input === 'string' ? d.input : JSON.stringify(d.input ?? '').slice(0, 120),
          status: 'running',
          startedAtMs: now,
          // Retry fields — backward compatible (ignored if absent)
          attempt: typeof d.attempt === 'number' ? d.attempt : undefined,
          maxAttempts: typeof d.maxAttempts === 'number' ? d.maxAttempts : undefined,
        });

        // Update progress bar steps
        setExecutionSteps(prev => [...prev, {
          id: `${name}_${now}`,
          label: name,
          status: 'running',
          startedAt: now,
        }]);
      } catch { /* ignore */ }
    });

    es.addEventListener('tool.finish', (e) => {
      try {
        const d = JSON.parse(e.data);
        const name = d.name ?? d.toolName ?? 'tool';

        updateLastTool(name, {
          type: 'tool.finish',
          status: d.error ? 'error' : 'done',
          result: d.error
            ? String(d.error).slice(0, 120)
            : (typeof d.output === 'string' ? d.output : JSON.stringify(d.output ?? '')).slice(0, 120),
          duration: d.durationMs,
        });

        // Update progress bar steps — mark first running step with matching label as done
        setExecutionSteps(prev => {
          const idx = prev.findIndex(s => s.status === 'running' && s.label === name);
          if (idx === -1) return prev;
          const updated = [...prev];
          updated[idx] = {
            ...updated[idx],
            status: d.error ? 'error' : 'done',
            finishedAt: Date.now(),
          };
          return updated;
        });
      } catch { /* ignore */ }
    });

    es.addEventListener('message.start', (e) => {
      try {
        const d = JSON.parse(e.data);
        addActivity({ type: 'message.start', agentName: d.agentName, agentEmoji: d.agentEmoji, status: 'running' });
      } catch { /* ignore */ }
    });

    es.addEventListener('message.finish', (e) => {
      try {
        const d = JSON.parse(e.data);
        addActivity({ type: 'message.finish', agentName: d.agentName, agentEmoji: d.agentEmoji, status: 'done' });
      } catch { /* ignore */ }
    });

    es.addEventListener('squad.start', () => {
      addActivity({ type: 'squad.start', status: 'running' });
      setExecutionStartedAt(Date.now());
      setIsRunning(true);
      setExecutionSteps([]);
    });

    es.addEventListener('squad.end', () => {
      addActivity({ type: 'squad.end', status: 'done' });
      setIsRunning(false);
    });

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [sessionId, addActivity, updateLastTool]);

  /* ── Auto-scroll ────────────────────────────────────── */

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activities, autoScroll]);

  /* ── Filter ─────────────────────────────────────────── */

  const filtered = activities.filter(a => {
    if (filter === 'tools') return a.type === 'tool.start' || a.type === 'tool.finish';
    if (filter === 'messages') return a.type === 'message.start' || a.type === 'message.finish';
    return true;
  });

  /* ── Derived: current step index for progress bar ──── */

  const currentStepIndex = executionSteps.findLastIndex(s => s.status === 'running');

  /* ── Styles ─────────────────────────────────────────── */

  const s: Record<string, React.CSSProperties> = {
    wrap: { display: 'flex', flexDirection: 'column', height: '100%' },
    header: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 },
    title: { fontSize: 12, fontWeight: 700, color: 'var(--text)', flex: 1 },
    dot: { width: 8, height: 8, borderRadius: '50%', background: connected ? '#10B981' : '#6B7280' },
    status: { fontSize: 10, color: connected ? '#10B981' : 'var(--fg-muted)' },
    feed: { flex: 1, overflow: 'auto', padding: '8px 12px' },
    row: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' },
    icon: { fontSize: 14, flexShrink: 0, width: 20 },
    body: { flex: 1 },
    time: { fontSize: 10, color: 'var(--fg-muted)', flexShrink: 0 },
    agent: { fontSize: 10, fontWeight: 600, color: 'var(--accent)', marginBottom: 2 },
    toolName: { fontSize: 12, fontWeight: 600, color: 'var(--text)' },
    toolInput: { fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 },
  };

  const filterBtn = (active: boolean): React.CSSProperties => ({
    padding: '2px 8px', fontSize: 10, borderRadius: 'var(--radius-sm)',
    background: active ? 'var(--accent)' : 'var(--surface)', border: '1px solid var(--border)',
    color: active ? '#fff' : 'var(--fg-muted)', cursor: 'pointer',
  });

  const resultStyle = (ok: boolean): React.CSSProperties => ({
    fontSize: 11,
    color: ok ? '#10B981' : '#EF4444',
    marginTop: 2,
  });

  const durationStyle: React.CSSProperties = {
    marginLeft: 6,
    fontSize: 10,
    color: 'var(--fg-muted)',
    fontFamily: 'var(--font-mono)',
  };

  function rowIcon(act: Activity): string {
    if (act.type === 'tool.start' || act.type === 'tool.finish') return toolIcon(act.toolName ?? '');
    if (act.type === 'message.start') return '💬';
    if (act.type === 'message.finish') return '✅';
    if (act.type === 'squad.start') return '🚀';
    if (act.type === 'squad.end') return '🏁';
    return '•';
  }

  /* ── Render ─────────────────────────────────────────── */

  return (
    <div style={s.wrap}>
      {/* ── Progress Bar (above header) ──────────────── */}
      <ExecutionProgressBar
        steps={executionSteps}
        currentStepIndex={currentStepIndex}
        startedAt={executionStartedAt ?? Date.now()}
        isRunning={isRunning}
      />

      {/* ── Header ───────────────────────────────────── */}
      <div style={s.header}>
        <div style={s.dot} />
        <span style={s.title}>Activity Feed</span>
        <span style={s.status}>{connected ? 'Live' : 'Waiting…'}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['all', 'tools', 'messages'] as const).map(f => (
            <button key={f} style={filterBtn(filter === f)} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>
        <button
          onClick={() => setActivities([])}
          style={{ padding: '2px 6px', fontSize: 10, background: 'transparent', border: '1px solid var(--border)', color: 'var(--fg-muted)', borderRadius: 4, cursor: 'pointer' }}
        >
          Clear
        </button>
      </div>

      {/* ── Activity Feed ────────────────────────────── */}
      <div
        ref={scrollRef}
        style={s.feed}
        onScroll={e => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          setAutoScroll(atBottom);
        }}
      >
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--fg-muted)', fontSize: 12, paddingTop: 40 }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>🎯</div>
            {connected
              ? 'Watching for agent activity…'
              : sessionId
                ? 'Select an active session to stream live activity'
                : 'No session selected'}
          </div>
        ) : (
          filtered.map(act => (
            <div key={act.id} style={s.row}>
              <span style={s.icon}>{rowIcon(act)}</span>
              <div style={s.body}>
                {act.agentName && (
                  <div style={s.agent}>{act.agentEmoji ?? ''} {act.agentName}</div>
                )}
                {(act.type === 'tool.start' || act.type === 'tool.finish') && (
                  <>
                    <div style={s.toolName}>
                      {act.toolName}

                      {/* Retry badge */}
                      {act.attempt != null && act.attempt > 1 && (
                        <RetryBadge attempt={act.attempt} maxAttempts={act.maxAttempts} />
                      )}

                      {/* Elapsed time: live timer when running, final duration when done */}
                      {act.status === 'running' && act.startedAtMs && (
                        <ToolElapsedBadge startedAtMs={act.startedAtMs} />
                      )}
                      {act.status !== 'running' && act.duration != null && (
                        <span style={durationStyle}>⏱ {formatDuration(act.duration)}</span>
                      )}

                      {/* Status text */}
                      {act.status === 'running' && (
                        <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--accent)' }}>running…</span>
                      )}
                    </div>
                    {act.toolInput && <div style={s.toolInput}>{truncate(act.toolInput)}</div>}
                    {act.result && <div style={resultStyle(act.status !== 'error')}>{truncate(act.result)}</div>}
                  </>
                )}
                {act.type === 'message.start' && <div style={s.toolName}>Generating response…</div>}
                {act.type === 'message.finish' && <div style={s.toolName}>Response complete</div>}
                {act.type === 'squad.start' && <div style={s.toolName}>Squad started</div>}
                {act.type === 'squad.end' && <div style={s.toolName}>Squad finished</div>}
              </div>
              <span style={s.time}>{formatTime(act.timestamp)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
