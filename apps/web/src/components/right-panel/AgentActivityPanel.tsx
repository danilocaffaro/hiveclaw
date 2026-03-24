'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getApiBase, getAuthToken } from '../../lib/api-base';

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
}

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

export default function AgentActivityPanel({ sessionId }: { sessionId?: string }) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [connected, setConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState<'all' | 'tools' | 'messages'>('all');
  const scrollRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const actCounterRef = useRef(0);

  const addActivity = useCallback((act: Omit<Activity, 'id' | 'timestamp'>) => {
    const id = `act_${Date.now()}_${++actCounterRef.current}`;
    const timestamp = new Date().toISOString();
    setActivities(prev => [...prev.slice(-200), { id, timestamp, ...act }]);
  }, []);

  const updateLastTool = useCallback((toolName: string, updates: Partial<Activity>) => {
    setActivities(prev => {
      const idx = [...prev].reverse().findIndex(a => a.type === 'tool.start' && a.toolName === toolName && a.status === 'running');
      if (idx === -1) return prev;
      const realIdx = prev.length - 1 - idx;
      const updated = [...prev];
      updated[realIdx] = { ...updated[realIdx], ...updates };
      return updated;
    });
  }, []);

  useEffect(() => {
    if (!sessionId) return;

    // Connect to session SSE stream for live activity
    // Server endpoint: /sessions/:id/events (rewriteUrl strips /api prefix)
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
        addActivity({
          type: 'tool.start',
          agentName: d.agentName,
          agentEmoji: d.agentEmoji,
          toolName: d.name ?? d.toolName ?? 'tool',
          toolInput: typeof d.input === 'string' ? d.input : JSON.stringify(d.input ?? '').slice(0, 120),
          status: 'running',
        });
      } catch { /* ignore */ }
    });

    es.addEventListener('tool.finish', (e) => {
      try {
        const d = JSON.parse(e.data);
        const toolName = d.name ?? d.toolName ?? 'tool';
        updateLastTool(toolName, {
          type: 'tool.finish',
          status: d.error ? 'error' : 'done',
          result: d.error
            ? String(d.error).slice(0, 120)
            : (typeof d.output === 'string' ? d.output : JSON.stringify(d.output ?? '')).slice(0, 120),
          duration: d.durationMs,
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

    es.addEventListener('squad.start', () => addActivity({ type: 'squad.start', status: 'running' }));
    es.addEventListener('squad.end', () => addActivity({ type: 'squad.end', status: 'done' }));

    return () => { es.close(); esRef.current = null; setConnected(false); };
  }, [sessionId, addActivity, updateLastTool]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activities, autoScroll]);

  const filtered = activities.filter(a => {
    if (filter === 'tools') return a.type === 'tool.start' || a.type === 'tool.finish';
    if (filter === 'messages') return a.type === 'message.start' || a.type === 'message.finish';
    return true;
  });

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

  const resultStyle = (ok: boolean): React.CSSProperties => ({ fontSize: 11, color: ok ? '#10B981' : '#EF4444', marginTop: 2 });

  function rowIcon(act: Activity): string {
    if (act.type === 'tool.start' || act.type === 'tool.finish') return toolIcon(act.toolName ?? '');
    if (act.type === 'message.start') return '💬';
    if (act.type === 'message.finish') return '✅';
    if (act.type === 'squad.start') return '🚀';
    if (act.type === 'squad.end') return '🏁';
    return '•';
  }

  return (
    <div style={s.wrap}>
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
                      {act.status === 'running' && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--blue)' }}>running…</span>}
                      {act.duration && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--fg-muted)' }}>{act.duration}ms</span>}
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
