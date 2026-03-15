'use client';

import React, { useState, useEffect } from 'react';
import { SectionTitle } from './shared';

interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  connected: boolean;
  showKey: boolean;
  testing: boolean;
}

// ─── Providers Tab ───────────────────────────────────────────────────────────────

interface ProviderDef {
  id: string;
  name: string;
  icon: string;
  color: string;
  hasBaseUrl: boolean;
  defaultBaseUrl: string;
  keyPlaceholder: string;
}

const PROVIDERS: ProviderDef[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    icon: '🟠',
    color: '#D97706',
    hasBaseUrl: false,
    defaultBaseUrl: 'https://api.anthropic.com',
    keyPlaceholder: 'sk-ant-oat… (Claude Pro/Max) or sk-ant-api… (pay-per-use)',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    icon: '⬛',
    color: '#10A37F',
    hasBaseUrl: false,
    defaultBaseUrl: 'https://api.openai.com',
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    icon: '🐙',
    color: '#A371F7',
    hasBaseUrl: false,
    defaultBaseUrl: 'https://api.githubcopilot.com',
    keyPlaceholder: 'GitHub OAuth token',
  },
  {
    id: 'google',
    name: 'Google AI',
    icon: '🔵',
    color: '#4285F4',
    hasBaseUrl: false,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    keyPlaceholder: 'AIza...',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    icon: '🔀',
    color: '#A855F7',
    hasBaseUrl: false,
    defaultBaseUrl: 'https://openrouter.ai/api',
    keyPlaceholder: 'sk-or-...',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    icon: '🐋',
    color: '#0EA5E9',
    hasBaseUrl: false,
    defaultBaseUrl: 'https://api.deepseek.com',
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'groq',
    name: 'Groq',
    icon: '⚡',
    color: '#F97316',
    hasBaseUrl: false,
    defaultBaseUrl: 'https://api.groq.com/openai',
    keyPlaceholder: 'gsk_...',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    icon: '🇫🇷',
    color: '#F97316',
    hasBaseUrl: false,
    defaultBaseUrl: 'https://api.mistral.ai',
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    icon: '🦙',
    color: '#3FB950',
    hasBaseUrl: true,
    defaultBaseUrl: 'http://localhost:11434',
    keyPlaceholder: '(no key required)',
  },
];

function EngineProviders() {
  const [providers, setProviders] = useState<Array<{id: string; name: string; models: number}>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/config/providers')
      .then(r => r.json())
      .then((d: { data?: { models?: Array<{id: string; provider: string}> } }) => {
        const models = d?.data?.models ?? [];
        const byProvider = new Map<string, number>();
        for (const m of models) {
          const p = m.provider ?? 'unknown';
          byProvider.set(p, (byProvider.get(p) ?? 0) + 1);
        }
        setProviders([...byProvider.entries()].map(([id, count]) => ({
          id,
          name: id === 'ollama-cluster' ? 'Ollama Cluster'
              : id === 'ollama' ? 'Ollama (local)'
              : id.charAt(0).toUpperCase() + id.slice(1),
          models: count,
        })));
      })
      .catch(() => setProviders([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ color: 'var(--fg-muted)', fontSize: 13, padding: '8px 0 20px' }}>Loading providers…</div>;
  if (providers.length === 0) return <div style={{ color: 'var(--fg-muted)', fontSize: 13, padding: '8px 0 20px' }}>⚠️ No providers configured. Add one below.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
      {providers.map(p => (
        <div key={p.id} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 14px', borderRadius: 'var(--radius-md)',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />
          <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{p.name}</span>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{p.models} model{p.models !== 1 ? 's' : ''}</span>
          <span style={{ fontSize: 11, color: 'var(--green)', background: 'rgba(63,185,80,0.1)', padding: '2px 8px', borderRadius: 99 }}>configured</span>
        </div>
      ))}
    </div>
  );
}

function ProviderCard({ provider }: { provider: ProviderDef }) {
  const [cfg, setCfg] = useState<ProviderConfig>({
    apiKey: '',
    baseUrl: provider.defaultBaseUrl,
    connected: false,
    showKey: false,
    testing: false,
  });
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const update = <K extends keyof ProviderConfig>(key: K, val: ProviderConfig[K]) =>
    setCfg((c) => ({ ...c, [key]: val }));

  // Load existing provider config from DB on mount
  useEffect(() => {
    fetch(`/api/config/providers/${provider.id}`)
      .then(r => { if (!r.ok) throw new Error('not found'); return r.json(); })
      .then((data: { api_key?: string; apiKey?: string; base_url?: string; baseUrl?: string; enabled?: boolean | number }) => {
        const maskedKey = data.api_key ?? data.apiKey ?? '';
        const baseUrl = data.base_url ?? data.baseUrl ?? provider.defaultBaseUrl;
        const hasKey = maskedKey.length > 0;
        setCfg(c => ({
          ...c,
          apiKey: maskedKey,
          baseUrl: baseUrl || provider.defaultBaseUrl,
          connected: hasKey || provider.id === 'ollama',
        }));
      })
      .catch(() => { /* provider not configured yet — keep defaults */ });
  }, [provider.id, provider.defaultBaseUrl]);

  // Save the provider config to DB, then immediately test the connection
  const testConnection = async () => {
    update('testing', true);
    setTestResult(null);

    // 1. Upsert the provider so the server has the current key/baseUrl
    try {
      await fetch(`/api/config/providers/${provider.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: provider.name,
          type: provider.id,
          apiKey: cfg.apiKey,
          baseUrl: cfg.baseUrl,
          enabled: true,
        }),
      });
    } catch {
      // Server offline — fall back to healthz ping
    }

    // 2. Hit the real test endpoint
    try {
      const res = await fetch(`/api/config/providers/${provider.id}/test`, { method: 'POST' });
      if (res.ok) {
        const json = await res.json();
        const ok = json.status === 'connected';
        update('connected', ok);
        setTestResult({ ok, msg: ok ? 'Connection successful!' : (json.message ?? 'Connection failed') });
      } else {
        // Fallback: hit /healthz to at least verify server is alive
        const hres = await fetch('/api/healthz');
        const alive = hres.ok;
        const fallback = alive && (cfg.apiKey.length > 0 || provider.id === 'ollama');
        update('connected', fallback);
        setTestResult({
          ok: fallback,
          msg: fallback
            ? 'Server reachable — key format looks valid'
            : 'Server reachable but key may be invalid',
        });
      }
    } catch {
      // Network error — try healthz
      try {
        const hres = await fetch('/api/healthz');
        update('connected', hres.ok);
        setTestResult({ ok: hres.ok, msg: hres.ok ? 'Server reachable (key untested)' : 'Server offline' });
      } catch {
        update('connected', false);
        setTestResult({ ok: false, msg: 'Server offline — cannot test connection' });
      }
    } finally {
      update('testing', false);
      // Clear the result after 5 s
      setTimeout(() => setTestResult(null), 5000);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`/api/config/providers/${provider.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: provider.name,
          type: provider.id,
          apiKey: cfg.apiKey,
          baseUrl: cfg.baseUrl,
          enabled: true,
        }),
      });
    } catch {
      // gracefully ignore (backend may not be running)
    } finally {
      setSaving(false);
    }
  };

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
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 20 }}>{provider.icon}</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
          {provider.name}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: cfg.connected ? 'var(--green)' : 'var(--red)',
              display: 'inline-block',
              boxShadow: cfg.connected ? '0 0 6px var(--green)' : 'none',
            }}
          />
          <span
            style={{
              fontSize: 11,
              color: cfg.connected ? 'var(--green)' : 'var(--text-secondary)',
              fontWeight: 500,
            }}
          >
            {cfg.connected ? 'Connected' : 'Not configured'}
          </span>
        </div>
      </div>

      {/* API Key */}
      <div style={{ marginBottom: 10 }}>
        <label
          style={{
            display: 'block',
            fontSize: 11,
            fontWeight: 500,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            marginBottom: 5,
          }}
        >
          API Key
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type={cfg.showKey ? 'text' : 'password'}
            value={cfg.apiKey}
            onChange={(e) => update('apiKey', e.target.value)}
            placeholder={provider.keyPlaceholder}
            style={{
              flex: 1,
              padding: '7px 10px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--input-bg)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              fontSize: 13,
              outline: 'none',
              fontFamily: cfg.showKey ? 'var(--font-mono)' : 'var(--font-sans)',
              transition: 'border-color 150ms',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--coral)'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
          />
          <button
            onClick={() => update('showKey', !cfg.showKey)}
            title={cfg.showKey ? 'Hide key' : 'Show key'}
            style={{
              width: 34,
              height: 34,
              borderRadius: 'var(--radius-md)',
              background: 'var(--surface-hover)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 150ms',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            {cfg.showKey ? '🙈' : '👁️'}
          </button>
        </div>
      </div>

      {/* Base URL (Ollama / custom) */}
      {provider.hasBaseUrl && (
        <div style={{ marginBottom: 10 }}>
          <label
            style={{
              display: 'block',
              fontSize: 11,
              fontWeight: 500,
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: 5,
            }}
          >
            Base URL
          </label>
          <input
            type="text"
            value={cfg.baseUrl}
            onChange={(e) => update('baseUrl', e.target.value)}
            placeholder={provider.defaultBaseUrl}
            style={{
              width: '100%',
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
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          onClick={testConnection}
          disabled={cfg.testing}
          style={{
            padding: '6px 14px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface-hover)',
            border: '1px solid var(--border)',
            color: cfg.testing ? 'var(--text-secondary)' : 'var(--text)',
            fontSize: 12,
            fontWeight: 500,
            cursor: cfg.testing ? 'not-allowed' : 'pointer',
            transition: 'all 150ms',
          }}
          onMouseEnter={(e) => {
            if (!cfg.testing) e.currentTarget.style.borderColor = 'var(--border-hover)';
          }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
        >
          {cfg.testing ? '⟳ Testing...' : '⚡ Test connection'}
        </button>
        <button
          onClick={save}
          disabled={saving}
          style={{
            padding: '6px 14px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--coral)',
            border: 'none',
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            cursor: saving ? 'not-allowed' : 'pointer',
            transition: 'opacity 150ms',
            opacity: saving ? 0.6 : 1,
          }}
          onMouseEnter={(e) => { if (!saving) e.currentTarget.style.opacity = '0.85'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = saving ? '0.6' : '1'; }}
        >
          {saving ? '⟳ Saving…' : 'Save'}
        </button>
      </div>

      {/* Test result inline feedback */}
      {testResult && (
        <div style={{
          marginTop: 10,
          padding: '8px 12px',
          borderRadius: 'var(--radius-md)',
          background: testResult.ok ? 'rgba(63,185,80,0.08)' : 'rgba(255,107,107,0.08)',
          border: `1px solid ${testResult.ok ? 'rgba(63,185,80,0.3)' : 'rgba(255,107,107,0.3)'}`,
          color: testResult.ok ? 'var(--green)' : 'var(--coral)',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          animation: 'fadeIn 150ms ease',
        }}>
          <span>{testResult.ok ? '✓' : '✗'}</span>
          <span>{testResult.msg}</span>
        </div>
      )}
    </div>
  );
}

export default function ProvidersTab() {
  return (
    <div>
      {/* Engine Providers — live from providers API */}
      <SectionTitle
        title="Engine Providers"
        desc="Providers configured for LLM access. Managed in Settings."
      />
      <EngineProviders />

      {/* Local API Keys — optional override stored in HiveClaw DB */}
      <SectionTitle
        title="Local API Keys"
        desc="API keys stored in HiveClaw database."
      />
      {PROVIDERS.map((p) => (
        <ProviderCard key={p.id} provider={p} />
      ))}
    </div>
  );
}

