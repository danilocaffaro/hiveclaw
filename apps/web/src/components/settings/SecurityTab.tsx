'use client';

import { useState, useCallback, useEffect } from 'react';
import { SectionTitle, StyledInput } from './shared';


interface ApiKeyEntry {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsed: string | null;
  status: 'active' | 'revoked';
}

interface ActiveSession {
  id: string;
  userId: string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
  lastActive: string;
  current: boolean;
}

interface AuditLogEntry {
  id: string;
  userId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  details: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
}

export default function SecurityTab() {
  const [apiKeys, setApiKeys] = useState<ApiKeyEntry[]>([]);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [auditFilter, setAuditFilter] = useState('');
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [keysRes, sessRes, auditRes] = await Promise.allSettled([
        fetch('/api/auth/api-keys'),
        fetch('/api/auth/sessions'),
        fetch('/api/audit?limit=50'),
      ]);
      if (keysRes.status === 'fulfilled' && keysRes.value.ok) {
        const j = await keysRes.value.json();
        setApiKeys(j.data ?? []);
      }
      if (sessRes.status === 'fulfilled' && sessRes.value.ok) {
        const j = await sessRes.value.json();
        setSessions(j.data ?? []);
      }
      if (auditRes.status === 'fulfilled' && auditRes.value.ok) {
        const j = await auditRes.value.json();
        setAuditLog(j.data ?? []);
      }
    } catch {
      // graceful — empty states will show below
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const rotateKey = async (keyId: string) => {
    setRotating(true);
    try {
      const res = await fetch(`/api/auth/api-keys/${keyId}/rotate`, { method: 'POST' });
      if (res.ok) {
        const j = await res.json();
        setCreatedKey(j.apiKey ?? null);
        setApiKeys((prev) => prev.map((k) => k.id === keyId ? { ...k, prefix: j.prefix ?? k.prefix } : k));
      }
    } catch { /* graceful */ }
    setRotating(false);
  };

  const revokeKey = async (keyId: string) => {
    if (!confirm('Revoke this API key? It will immediately stop working.')) return;
    try {
      await fetch(`/api/auth/api-keys/${keyId}`, { method: 'DELETE' });
    } catch { /* graceful */ }
    setApiKeys((prev) => prev.map((k) => k.id === keyId ? { ...k, status: 'revoked' } : k));
  };

  const createKey = async () => {
    if (!newKeyLabel.trim()) return;
    try {
      const res = await fetch('/api/auth/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newKeyLabel }),
      });
      if (res.ok) {
        const j = await res.json();
        setCreatedKey(j.apiKey ?? '');
        setApiKeys((prev) => [{ id: j.id ?? 'key-new', label: newKeyLabel, prefix: j.prefix ?? 'sc-...new', createdAt: new Date().toISOString(), lastUsed: null, status: 'active' }, ...prev]);
        setNewKeyLabel('');
      }
    } catch {
      setCreatedKey('');
      // API key creation failed — empty state will show
    }
  };

  const terminateSession = async (sessId: string) => {
    if (!confirm('Terminate this session?')) return;
    try {
      await fetch(`/api/auth/sessions/${sessId}`, { method: 'DELETE' });
    } catch { /* graceful */ }
    setSessions((prev) => prev.filter((s) => s.id !== sessId));
  };

  const filteredAudit = auditFilter
    ? auditLog.filter((e) => e.action.toLowerCase().includes(auditFilter.toLowerCase()) || (e.resourceType ?? '').toLowerCase().includes(auditFilter.toLowerCase()))
    : auditLog;

  const timeAgo = (iso: string) => {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60000) return 'just now';
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
    if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
    return `${Math.floor(ms / 86400000)}d ago`;
  };

  const actionColor = (action: string) => {
    if (action.includes('create')) return 'var(--green)';
    if (action.includes('delete') || action.includes('revoke')) return 'var(--coral)';
    if (action.includes('update') || action.includes('rotate')) return 'var(--yellow)';
    return 'var(--text-secondary)';
  };

  if (loading) {
    return (
      <div>
        <SectionTitle title="Security" aria-label="Security" desc="API keys, active sessions, and audit log." />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ height: 60, borderRadius: 'var(--radius-lg)', background: 'var(--card-bg)', border: '1px solid var(--border)', animation: 'pulse 1.5s infinite ease-in-out' }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionTitle title="Security" aria-label="Security" desc="API keys, active sessions, and audit log." />

      {/* ── API Keys ─────────────────────────────────── */}
      <div style={{
        fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)',
        textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 10,
      }}>
        🔑 API Keys
      </div>

      {/* Created key banner */}
      {createdKey && (
        <div style={{
          padding: '12px 16px', borderRadius: 'var(--radius-lg)',
          background: 'rgba(63,185,80,0.08)', border: '1px solid rgba(63,185,80,0.3)',
          marginBottom: 12, animation: 'fadeIn 150ms ease',
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)', marginBottom: 6 }}>
            ✓ API Key created — copy it now, it won't be shown again
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code style={{
              flex: 1, padding: '6px 10px', borderRadius: 'var(--radius-md)',
              background: 'var(--input-bg)', border: '1px solid var(--border)',
              color: 'var(--green)', fontSize: 12, fontFamily: 'var(--font-mono)',
              wordBreak: 'break-all',
            }}>
              {createdKey}
            </code>
            <button
              onClick={() => { navigator.clipboard.writeText(createdKey); }}
              style={{
                padding: '6px 12px', borderRadius: 'var(--radius-md)',
                background: 'var(--surface-hover)', border: '1px solid var(--border)',
                color: 'var(--text)', fontSize: 12, cursor: 'pointer', flexShrink: 0,
              }}
            >
              📋 Copy
            </button>
            <button
              onClick={() => setCreatedKey(null)}
              style={{
                width: 28, height: 28, borderRadius: 'var(--radius-md)',
                background: 'none', border: 'none', color: 'var(--text-muted)',
                fontSize: 14, cursor: 'pointer',
              }}
            >✕</button>
          </div>
        </div>
      )}

      {/* Create new key */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <StyledInput
          value={newKeyLabel}
          onChange={setNewKeyLabel}
          placeholder="Key label (e.g. CI/CD, Mobile App)"
          fullWidth
        />
        <button
          onClick={createKey}
          disabled={!newKeyLabel.trim()}
          style={{
            padding: '7px 16px', borderRadius: 'var(--radius-md)',
            background: newKeyLabel.trim() ? 'var(--coral)' : 'var(--surface-hover)',
            border: 'none', color: newKeyLabel.trim() ? '#fff' : 'var(--text-muted)',
            fontSize: 12, fontWeight: 600, cursor: newKeyLabel.trim() ? 'pointer' : 'not-allowed',
            whiteSpace: 'nowrap', transition: 'all 150ms',
          }}
        >
          + Create Key
        </button>
      </div>

      {/* Keys list */}
      <div style={{
        background: 'var(--card-bg)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 28,
      }}>
        {apiKeys.map((key, i) => (
          <div key={key.id} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 16px',
            borderBottom: i < apiKeys.length - 1 ? '1px solid var(--border)' : 'none',
            opacity: key.status === 'revoked' ? 0.5 : 1,
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: 'var(--radius-md)',
              background: key.status === 'active' ? 'rgba(63,185,80,0.1)' : 'rgba(255,107,107,0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0,
            }}>
              🔑
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{key.label}</span>
                <span style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 4,
                  background: key.status === 'active' ? 'rgba(63,185,80,0.1)' : 'rgba(255,107,107,0.1)',
                  color: key.status === 'active' ? 'var(--green)' : 'var(--coral)',
                  fontWeight: 600, textTransform: 'uppercase',
                }}>
                  {key.status}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{key.prefix}</span>
                <span style={{ margin: '0 6px' }}>·</span>
                Created {timeAgo(key.createdAt)}
                {key.lastUsed && <><span style={{ margin: '0 6px' }}>·</span>Last used {timeAgo(key.lastUsed)}</>}
              </div>
            </div>
            {key.status === 'active' && (
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <button
                  onClick={() => rotateKey(key.id)}
                  disabled={rotating}
                  title="Rotate key" aria-label="Rotate key"
                  style={{
                    padding: '4px 10px', borderRadius: 'var(--radius-md)',
                    background: 'var(--surface-hover)', border: '1px solid var(--border)',
                    color: 'var(--text-secondary)', fontSize: 11, cursor: rotating ? 'not-allowed' : 'pointer',
                    transition: 'all 150ms',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--yellow)'; e.currentTarget.style.color = 'var(--yellow)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >
                  🔄 Rotate
                </button>
                <button
                  onClick={() => revokeKey(key.id)}
                  title="Revoke key" aria-label="Revoke key"
                  style={{
                    padding: '4px 10px', borderRadius: 'var(--radius-md)',
                    background: 'var(--surface-hover)', border: '1px solid var(--border)',
                    color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer',
                    transition: 'all 150ms',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--coral)'; e.currentTarget.style.color = 'var(--coral)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >
                  ✕ Revoke
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Active Sessions ──────────────────────────── */}
      <div style={{
        fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)',
        textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 10,
      }}>
        🖥️ Active Sessions
      </div>

      <div style={{
        background: 'var(--card-bg)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 28,
      }}>
        {sessions.map((sess, i) => (
          <div key={sess.id} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 16px',
            borderBottom: i < sessions.length - 1 ? '1px solid var(--border)' : 'none',
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: 'var(--radius-md)',
              background: sess.current ? 'rgba(63,185,80,0.1)' : 'var(--surface-hover)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0,
            }}>
              {sess.current ? '💻' : '🖥️'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', maxWidth: '100%' }} title={sess.userAgent}>{sess.userAgent}</span>
                {sess.current && (
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 4,
                    background: 'rgba(63,185,80,0.1)', color: 'var(--green)',
                    fontWeight: 600,
                  }}>
                    CURRENT
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{sess.ipAddress}</span>
                <span style={{ margin: '0 6px' }}>·</span>
                Active {timeAgo(sess.lastActive)}
              </div>
            </div>
            {!sess.current && (
              <button
                onClick={() => terminateSession(sess.id)}
                title="Terminate session" aria-label="Terminate session"
                style={{
                  padding: '4px 10px', borderRadius: 'var(--radius-md)',
                  background: 'var(--surface-hover)', border: '1px solid var(--border)',
                  color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer',
                  transition: 'all 150ms', flexShrink: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--coral)'; e.currentTarget.style.color = 'var(--coral)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
              >
                Terminate
              </button>
            )}
          </div>
        ))}
      </div>

      {/* ── Audit Log ────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 10,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)',
          textTransform: 'uppercase', letterSpacing: '0.6px',
        }}>
          📋 Audit Log
        </div>
        <StyledInput
          value={auditFilter}
          onChange={setAuditFilter}
          placeholder="Filter by action…"
          style={{ width: 160, padding: '5px 8px', fontSize: 11 }}
        />
      </div>

      <div style={{
        background: 'var(--card-bg)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', overflow: 'hidden', maxHeight: 300,
        overflowY: 'auto',
      }}>
        {filteredAudit.length === 0 && (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            No audit entries {auditFilter ? 'matching filter' : 'yet'}
          </div>
        )}
        {filteredAudit.map((entry, i) => (
          <div key={entry.id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 16px',
            borderBottom: i < filteredAudit.length - 1 ? '1px solid var(--border)' : 'none',
            fontSize: 12,
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: actionColor(entry.action), flexShrink: 0,
            }} />
            <span style={{ color: 'var(--text)', fontWeight: 500, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              {entry.action}
            </span>
            {entry.resourceType && (
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                → {entry.resourceType}/{entry.resourceId ?? '?'}
              </span>
            )}
            <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 10, flexShrink: 0, fontFamily: 'var(--font-mono)' }}>
              {entry.ipAddress ?? '—'}
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: 10, flexShrink: 0, width: 50, textAlign: 'right' }}>
              {timeAgo(entry.createdAt)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

