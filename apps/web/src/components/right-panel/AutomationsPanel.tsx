'use client';

import { useState, useEffect, useCallback } from 'react';

interface Automation {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger_type: 'cron' | 'event' | 'webhook';
  trigger_config: { cron?: string; schedule?: string; event?: string };
  agent_id: string | null;
  action_type: 'send_message' | 'run_workflow' | 'http_request';
  action_config: { message?: string; prompt?: string };
  last_run_at: string | null;
  last_run_status: string | null;
  run_count: number;
  created_at: string;
}

interface Agent {
  id: string;
  name: string;
  emoji: string;
}

const CRON_PRESETS = [
  { label: 'Every 30 minutes',   value: '*/30 * * * *' },
  { label: 'Every hour',         value: '0 * * * *' },
  { label: 'Every 4 hours',      value: '0 */4 * * *' },
  { label: 'Daily at 9am',       value: '0 9 * * *' },
  { label: 'Daily at midnight',  value: '0 0 * * *' },
  { label: 'Weekdays at 9am',    value: '0 9 * * 1-5' },
  { label: 'Every Sunday 3am',   value: '0 3 * * 0' },
];

export default function AutomationsPanel() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [running, setRunning] = useState<string | null>(null);

  // Create form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [cron, setCron] = useState('0 9 * * *');
  const [agentId, setAgentId] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [aRes, agRes] = await Promise.all([
        fetch('/api/automations'),
        fetch('/api/agents'),
      ]);
      if (aRes.ok) { const { data } = await aRes.json(); setAutomations(data ?? []); }
      if (agRes.ok) { const { data } = await agRes.json(); setAgents(data ?? []); }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const createAutomation = async () => {
    if (!name.trim() || !cron || !agentId || !message.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          triggerType: 'cron',
          triggerConfig: { cron },
          agentId,
          actionType: 'send_message',
          actionConfig: { message: message.trim() },
        }),
      });
      if (res.ok) {
        setShowCreate(false);
        setName(''); setDescription(''); setCron('0 9 * * *'); setAgentId(''); setMessage('');
        await load();
      }
    } catch { /* ignore */ }
    setSaving(false);
  };

  const toggleEnabled = async (id: string, current: boolean) => {
    await fetch(`/api/automations/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !current }),
    });
    setAutomations(prev => prev.map(a => a.id === id ? { ...a, enabled: !current } : a));
  };

  const deleteAuto = async (id: string, name: string) => {
    if (!confirm(`Delete automation "${name}"?`)) return;
    await fetch(`/api/automations/${id}`, { method: 'DELETE' });
    setAutomations(prev => prev.filter(a => a.id !== id));
  };

  const runNow = async (id: string) => {
    setRunning(id);
    await fetch(`/api/automations/${id}/run`, { method: 'POST' });
    setTimeout(() => { setRunning(null); load(); }, 1500);
  };

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const agentName = (id: string | null) => {
    if (!id) return '—';
    const a = agents.find(ag => ag.id === id);
    return a ? `${a.emoji} ${a.name}` : id.slice(0, 8);
  };

  const s: Record<string, React.CSSProperties> = {
    wrap: { padding: 16 },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    title: { fontSize: 14, fontWeight: 700, color: 'var(--text)' },
    addBtn: { padding: '6px 12px', borderRadius: 'var(--radius-md)', background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer' },
    card: { padding: 14, borderRadius: 'var(--radius-lg)', background: 'var(--bg-card)', border: '1px solid var(--border)', marginBottom: 10 },
    cardRow: { display: 'flex', alignItems: 'center', gap: 10 },
    label: { fontSize: 12, fontWeight: 600, color: 'var(--text)' },
    sub: { fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 },
    input: { width: '100%', padding: '7px 10px', borderRadius: 'var(--radius-md)', background: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12, outline: 'none', boxSizing: 'border-box' as const },
    select: { width: '100%', padding: '7px 10px', borderRadius: 'var(--radius-md)', background: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12, cursor: 'pointer' },
    fld: { marginBottom: 12 },
    flabel: { fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)', marginBottom: 4, display: 'block', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <span style={s.title}>⚡ Automations</span>
        <button style={s.addBtn} onClick={() => setShowCreate(v => !v)}>
          {showCreate ? '✕ Cancel' : '+ New'}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div style={{ ...s.card, marginBottom: 16, border: '1px solid var(--accent)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, color: 'var(--text)' }}>New Automation</div>

          <div style={s.fld}>
            <label style={s.flabel}>Name</label>
            <input style={s.input} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Daily Briefing" />
          </div>

          <div style={s.fld}>
            <label style={s.flabel}>Schedule (cron)</label>
            <select style={s.select} value={cron} onChange={e => setCron(e.target.value)}>
              {CRON_PRESETS.map(p => (
                <option key={p.value} value={p.value}>{p.label} ({p.value})</option>
              ))}
            </select>
          </div>

          <div style={s.fld}>
            <label style={s.flabel}>Agent</label>
            <select style={s.select} value={agentId} onChange={e => setAgentId(e.target.value)}>
              <option value="">— Select agent —</option>
              {agents.map(a => (
                <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>
              ))}
            </select>
          </div>

          <div style={s.fld}>
            <label style={s.flabel}>Message / Prompt</label>
            <textarea
              style={{ ...s.input, height: 70, resize: 'vertical' } as React.CSSProperties}
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="What should the agent do? e.g. 'Send me a morning briefing with top priorities'"
            />
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              onClick={createAutomation}
              disabled={saving || !name || !agentId || !message}
              style={{ ...s.addBtn, opacity: (!name || !agentId || !message) ? 0.5 : 1 }}
            >
              {saving ? 'Saving…' : '✓ Create'}
            </button>
            <button onClick={() => setShowCreate(false)} style={{ padding: '6px 12px', borderRadius: 'var(--radius-md)', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--fg-muted)', fontSize: 12, padding: 24 }}>Loading…</div>
      ) : automations.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--fg-muted)', fontSize: 12, padding: 32 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⚡</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No automations yet</div>
          <div>Create your first scheduled agent task above.</div>
        </div>
      ) : (
        automations.map(auto => (
          <div key={auto.id} style={{ ...s.card, opacity: auto.enabled ? 1 : 0.6 }}>
            <div style={s.cardRow}>
              {/* Toggle */}
              <div
                onClick={() => toggleEnabled(auto.id, auto.enabled)}
                style={{
                  width: 32, height: 18, borderRadius: 9,
                  background: auto.enabled ? 'var(--accent)' : 'var(--border)',
                  cursor: 'pointer', position: 'relative', flexShrink: 0,
                  transition: 'background 0.2s',
                }}
              >
                <div style={{
                  position: 'absolute', top: 2, left: auto.enabled ? 14 : 2,
                  width: 14, height: 14, borderRadius: '50%', background: '#fff',
                  transition: 'left 0.2s',
                }} />
              </div>

              <div style={{ flex: 1 }}>
                <div style={s.label}>{auto.name}</div>
                {auto.description && <div style={s.sub}>{auto.description}</div>}
                <div style={{ ...s.sub, marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' as const }}>
                  <span>🕐 {auto.trigger_config.cron ?? auto.trigger_config.schedule ?? '?'}</span>
                  <span>🤖 {agentName(auto.agent_id)}</span>
                  <span>✉️ {(auto.action_config.message ?? auto.action_config.prompt ?? '').slice(0, 40)}</span>
                </div>
                <div style={{ ...s.sub, marginTop: 4, display: 'flex', gap: 12 }}>
                  <span>Last run: {formatDate(auto.last_run_at)}</span>
                  {auto.last_run_status && (
                    <span style={{ color: auto.last_run_status === 'success' ? '#10B981' : '#EF4444' }}>
                      {auto.last_run_status === 'success' ? '✓ OK' : '✗ ' + auto.last_run_status.slice(0, 30)}
                    </span>
                  )}
                  <span>{auto.run_count} runs</span>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => runNow(auto.id)}
                  disabled={running === auto.id}
                  title="Run now"
                  style={{ padding: '4px 8px', fontSize: 11, borderRadius: 'var(--radius-sm)', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', cursor: 'pointer' }}
                >
                  {running === auto.id ? '⏳' : '▶'}
                </button>
                <button
                  onClick={() => deleteAuto(auto.id, auto.name)}
                  title="Delete"
                  style={{ padding: '4px 8px', fontSize: 11, borderRadius: 'var(--radius-sm)', background: 'transparent', border: '1px solid #EF4444', color: '#EF4444', cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
