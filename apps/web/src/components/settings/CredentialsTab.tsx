'use client';

import { useState, useEffect, useCallback } from 'react';
import { SectionTitle } from './shared';

// ─── Types ──────────────────────────────────────────────────────────────────────

type CredentialStatus = 'active' | 'invalid' | 'leaked' | 'expired' | 'unknown';

interface Credential {
  id: string;
  key: string;
  provider: string;
  value: string;           // masked from server
  status: CredentialStatus;
  lastChecked: string | null;
  lastSuccess: string | null;
  checkEndpoint: string | null;
  usedBy: string[];
  createdAt: string;
  updatedAt: string;
}

interface CheckResult {
  status: CredentialStatus;
  latencyMs: number;
  error?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const KNOWN_KEYS = [
  { key: 'GEMINI_API_KEY', provider: 'google', label: 'Google / Gemini' },
  { key: 'OPENAI_API_KEY', provider: 'openai', label: 'OpenAI' },
  { key: 'ANTHROPIC_API_KEY', provider: 'anthropic', label: 'Anthropic' },
  { key: 'OPENROUTER_API_KEY', provider: 'openrouter', label: 'OpenRouter' },
  { key: 'DEEPSEEK_API_KEY', provider: 'deepseek', label: 'DeepSeek' },
  { key: 'GROQ_API_KEY', provider: 'groq', label: 'Groq' },
  { key: 'MISTRAL_API_KEY', provider: 'mistral', label: 'Mistral' },
];

const STATUS_ICONS: Record<CredentialStatus, string> = {
  active: '🟢',
  invalid: '🔴',
  leaked: '🔴',
  expired: '🔴',
  unknown: '🟡',
};

const STATUS_COLORS: Record<CredentialStatus, string> = {
  active: 'var(--green)',
  invalid: 'var(--coral)',
  leaked: 'var(--coral)',
  expired: 'var(--coral)',
  unknown: '#EAB308',
};

// ─── Helpers ────────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function providerFromKey(key: string): string {
  const known = KNOWN_KEYS.find((k) => k.key === key);
  if (known) return known.provider;
  if (key.toLowerCase().includes('google') || key.toLowerCase().includes('gemini')) return 'google';
  if (key.toLowerCase().includes('openai')) return 'openai';
  if (key.toLowerCase().includes('anthropic') || key.toLowerCase().includes('claude')) return 'anthropic';
  return 'custom';
}

// ─── Credential Card ────────────────────────────────────────────────────────────

function CredentialCard({
  credential,
  onDelete,
  onUpdate,
}: {
  credential: Credential;
  onDelete: (id: string) => void;
  onUpdate: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const runCheck = async () => {
    setChecking(true);
    setCheckResult(null);
    try {
      const res = await fetch(`/api/credential-store/${credential.id}/check`, { method: 'POST' });
      if (res.ok) {
        const json = await res.json();
        setCheckResult({
          status: json.data.status,
          latencyMs: json.data.latencyMs,
          error: json.data.error,
        });
        onUpdate(); // refresh list to get updated status
      } else {
        setCheckResult({ status: 'unknown', latencyMs: 0, error: 'Check request failed' });
      }
    } catch {
      setCheckResult({ status: 'unknown', latencyMs: 0, error: 'Network error' });
    }
    setChecking(false);
    setTimeout(() => setCheckResult(null), 8000);
  };

  const saveEdit = async () => {
    if (!editValue.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/credential-store/${credential.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: editValue }),
      });
      if (res.ok) {
        setEditing(false);
        setEditValue('');
        onUpdate();
      }
    } catch {
      // silently fail
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    try {
      const res = await fetch(`/api/credential-store/${credential.id}`, { method: 'DELETE' });
      if (res.ok) {
        onDelete(credential.id);
      }
    } catch {
      // silently fail
    }
    setConfirmDelete(false);
  };

  const known = KNOWN_KEYS.find((k) => k.key === credential.key);
  const displayName = known?.label ?? credential.key;
  const statusIcon = STATUS_ICONS[credential.status] ?? '🟡';
  const statusColor = STATUS_COLORS[credential.status] ?? '#EAB308';

  return (
    <div
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '16px 20px',
        marginBottom: 12,
        transition: 'border-color 150ms',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-hover)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'; }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>{statusIcon}</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', flex: 1 }}>
          {displayName}
        </span>
        <span
          style={{
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-muted)',
            background: 'var(--surface-hover)',
            padding: '2px 10px',
            borderRadius: 4,
          }}
        >
          {credential.value}
        </span>
      </div>

      {/* Meta row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 4,
            background: 'rgba(88,166,255,0.1)',
            color: 'var(--blue, #58A6FF)',
            fontWeight: 500,
          }}
        >
          {credential.provider}
        </span>
        <span style={{ fontSize: 12, color: statusColor, fontWeight: 500 }}>
          {credential.status}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Checked: {timeAgo(credential.lastChecked)}
        </span>
        {credential.key !== displayName && (
          <span
            style={{
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-muted)',
            }}
          >
            {credential.key}
          </span>
        )}
      </div>

      {/* Edit inline */}
      {editing && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            type="password"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder="Enter new value…"
            style={{
              flex: 1,
              padding: '7px 10px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--input-bg)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              fontSize: 13,
              outline: 'none',
              fontFamily: 'var(--font-mono)',
              transition: 'border-color 150ms',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--coral)'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
          />
          <button
            onClick={saveEdit}
            disabled={saving || !editValue.trim()}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--coral)',
              border: 'none',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving || !editValue.trim() ? 0.6 : 1,
            }}
          >
            {saving ? '⟳' : 'Save'}
          </button>
          <button
            onClick={() => { setEditing(false); setEditValue(''); }}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--surface-hover)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(255,107,107,0.08)',
            border: '1px solid rgba(255,107,107,0.25)',
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--coral)', flex: 1 }}>
            Delete <strong>{credential.key}</strong>? This cannot be undone.
          </span>
          <button
            onClick={handleDelete}
            style={{
              padding: '5px 12px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--coral)',
              border: 'none',
              color: '#fff',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Confirm
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            style={{
              padding: '5px 12px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--surface-hover)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={runCheck}
          disabled={checking}
          style={{
            padding: '6px 14px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface-hover)',
            border: '1px solid var(--border)',
            color: checking ? 'var(--text-secondary)' : 'var(--text)',
            fontSize: 12,
            fontWeight: 500,
            cursor: checking ? 'not-allowed' : 'pointer',
            transition: 'all 150ms',
          }}
          onMouseEnter={(e) => {
            if (!checking) e.currentTarget.style.borderColor = 'var(--border-hover)';
          }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
        >
          {checking ? '⟳ Testing…' : '⚡ Test'}
        </button>
        <button
          onClick={() => { setEditing(!editing); setConfirmDelete(false); }}
          style={{
            padding: '6px 14px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface-hover)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'all 150ms',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
        >
          ✏️ Edit
        </button>
        <button
          onClick={() => { setConfirmDelete(!confirmDelete); setEditing(false); }}
          style={{
            padding: '6px 14px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface-hover)',
            border: '1px solid var(--border)',
            color: 'var(--coral)',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'all 150ms',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(255,107,107,0.5)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
        >
          🗑️ Delete
        </button>
      </div>

      {/* Check result inline */}
      {checkResult && (
        <div
          style={{
            marginTop: 10,
            padding: '8px 12px',
            borderRadius: 'var(--radius-md)',
            background:
              checkResult.status === 'active'
                ? 'rgba(63,185,80,0.08)'
                : checkResult.status === 'unknown'
                  ? 'rgba(234,179,8,0.08)'
                  : 'rgba(255,107,107,0.08)',
            border: `1px solid ${
              checkResult.status === 'active'
                ? 'rgba(63,185,80,0.3)'
                : checkResult.status === 'unknown'
                  ? 'rgba(234,179,8,0.3)'
                  : 'rgba(255,107,107,0.3)'
            }`,
            color: STATUS_COLORS[checkResult.status],
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            animation: 'fadeIn 150ms ease',
          }}
        >
          <span>{STATUS_ICONS[checkResult.status]}</span>
          <span style={{ flex: 1 }}>
            {checkResult.status === 'active'
              ? 'Connection successful!'
              : checkResult.error ?? `Status: ${checkResult.status}`}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {checkResult.latencyMs}ms
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Add Credential Form ────────────────────────────────────────────────────────

function AddCredentialForm({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [keyType, setKeyType] = useState<'preset' | 'custom'>('preset');
  const [selectedKey, setSelectedKey] = useState(KNOWN_KEYS[0].key);
  const [customKey, setCustomKey] = useState('');
  const [provider, setProvider] = useState(KNOWN_KEYS[0].provider);
  const [value, setValue] = useState('');
  const [checkEndpoint, setCheckEndpoint] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setKeyType('preset');
    setSelectedKey(KNOWN_KEYS[0].key);
    setCustomKey('');
    setProvider(KNOWN_KEYS[0].provider);
    setValue('');
    setCheckEndpoint('');
    setError(null);
  };

  const handleKeyChange = (key: string) => {
    setSelectedKey(key);
    const detected = providerFromKey(key);
    setProvider(detected);
  };

  const submit = async () => {
    const finalKey = keyType === 'preset' ? selectedKey : customKey.trim();
    if (!finalKey) { setError('Key name is required'); return; }
    if (!value) { setError('Value is required'); return; }
    if (!provider.trim()) { setError('Provider is required'); return; }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/credential-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: finalKey,
          provider: provider.trim(),
          value,
          checkEndpoint: checkEndpoint.trim() || undefined,
        }),
      });
      if (res.ok) {
        reset();
        setOpen(false);
        onAdded();
      } else {
        const json = await res.json().catch(() => null);
        setError(json?.error?.message ?? `Error ${res.status}`);
      }
    } catch {
      setError('Network error');
    }
    setSaving(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          padding: '10px 20px',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--coral)',
          border: 'none',
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'opacity 150ms',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
      >
        + Add Credential
      </button>
    );
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 11,
    fontWeight: 500,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: 5,
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '7px 10px',
    borderRadius: 'var(--radius-md)',
    background: 'var(--input-bg)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    fontSize: 13,
    outline: 'none',
    transition: 'border-color 150ms',
  };

  return (
    <div
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px',
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 16 }}>
        Add Credential
      </div>

      {/* Key type toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button
          onClick={() => setKeyType('preset')}
          style={{
            padding: '5px 12px',
            borderRadius: 'var(--radius-md)',
            background: keyType === 'preset' ? 'var(--coral)' : 'var(--surface-hover)',
            border: keyType === 'preset' ? 'none' : '1px solid var(--border)',
            color: keyType === 'preset' ? '#fff' : 'var(--text-secondary)',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Known Keys
        </button>
        <button
          onClick={() => setKeyType('custom')}
          style={{
            padding: '5px 12px',
            borderRadius: 'var(--radius-md)',
            background: keyType === 'custom' ? 'var(--coral)' : 'var(--surface-hover)',
            border: keyType === 'custom' ? 'none' : '1px solid var(--border)',
            color: keyType === 'custom' ? '#fff' : 'var(--text-secondary)',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Custom Key
        </button>
      </div>

      {/* Key name */}
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Key Name</label>
        {keyType === 'preset' ? (
          <select
            value={selectedKey}
            onChange={(e) => handleKeyChange(e.target.value)}
            style={{
              ...inputStyle,
              cursor: 'pointer',
            }}
          >
            {KNOWN_KEYS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label} — {k.key}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={customKey}
            onChange={(e) => {
              setCustomKey(e.target.value);
              setProvider(providerFromKey(e.target.value));
            }}
            placeholder="MY_CUSTOM_API_KEY"
            style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--coral)'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
          />
        )}
      </div>

      {/* Provider */}
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Provider</label>
        <input
          type="text"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          placeholder="google, openai, anthropic, custom…"
          style={inputStyle}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--coral)'; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
        />
      </div>

      {/* Value */}
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Value</label>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste your API key or secret…"
          style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--coral)'; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
        />
      </div>

      {/* Check endpoint (optional) */}
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Check Endpoint (optional)</label>
        <input
          type="text"
          value={checkEndpoint}
          onChange={(e) => setCheckEndpoint(e.target.value)}
          placeholder="https://api.example.com/v1/models"
          style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--coral)'; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
        />
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(255,107,107,0.08)',
            border: '1px solid rgba(255,107,107,0.25)',
            color: 'var(--coral)',
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={submit}
          disabled={saving}
          style={{
            padding: '8px 20px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--coral)',
            border: 'none',
            color: '#fff',
            fontSize: 13,
            fontWeight: 600,
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? '⟳ Saving…' : 'Save Credential'}
        </button>
        <button
          onClick={() => { reset(); setOpen(false); }}
          style={{
            padding: '8px 20px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface-hover)',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Main Tab ───────────────────────────────────────────────────────────────────

export default function CredentialsTab() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/credential-store');
      if (res.ok) {
        const json = await res.json();
        setCredentials(json.data ?? []);
      } else {
        setError(`Server returned ${res.status}`);
      }
    } catch {
      setError('Server unavailable');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = (id: string) => {
    setCredentials((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <div>
      <SectionTitle
        title="Credentials"
        desc="API keys and secrets stored in the credential store. Test, edit, or manage access."
      />

      {/* Status bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          borderRadius: 'var(--radius-lg)',
          background: error ? 'rgba(255,107,107,0.08)' : 'var(--green-subtle, rgba(63,185,80,0.06))',
          border: `1px solid ${error ? 'rgba(255,107,107,0.25)' : 'rgba(63,185,80,0.25)'}`,
          marginBottom: 20,
        }}
      >
        <span style={{ fontSize: 20 }}>{error ? '⚠️' : '🔑'}</span>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: error ? 'var(--coral)' : 'var(--green)',
            }}
          >
            {error ? 'Connection Issue' : 'Credential Store'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            {error ?? `${credentials.length} credential${credentials.length !== 1 ? 's' : ''} stored`}
          </div>
        </div>
        <button
          onClick={load}
          style={{
            padding: '6px 14px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface-hover)',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
            fontSize: 12,
            cursor: 'pointer',
            transition: 'all 150ms',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
        >
          ↻ Refresh
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
      )}

      {/* Credential list */}
      {!loading && credentials.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {credentials.map((cred) => (
            <CredentialCard
              key={cred.id}
              credential={cred}
              onDelete={handleDelete}
              onUpdate={load}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && credentials.length === 0 && !error && (
        <div
          style={{
            padding: '32px 20px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 13,
            background: 'var(--card-bg)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            marginBottom: 20,
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔐</div>
          No credentials stored yet. Add your first API key below.
        </div>
      )}

      {/* Add form */}
      <AddCredentialForm onAdded={load} />
    </div>
  );
}
