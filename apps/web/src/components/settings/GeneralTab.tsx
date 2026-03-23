'use client';

import React, { useState, useEffect } from 'react';
import { SectionTitle, SettingRow, Toggle } from './shared';
import { RemoteAccessSection } from './RemoteAccessSection';

// ─── General Tab (B068: App config only — no agent/engine config here) ────────
// Agent config (name, prompt, temperature) → Agents tab → Agent detail
// Engine config (providers, models) → Providers/Models tabs (managed via Providers tab)

interface AppConfig {
  language: string;
  responseStyle: 'concise' | 'balanced' | 'detailed';
  markdownEnabled: boolean;
  autoSave: boolean;
  telemetry: boolean;
  soundNotifications: boolean;
  desktopNotifications: boolean;
  workingDirectory: string;
}

const DEFAULTS: AppConfig = {
  language: 'en',
  responseStyle: 'balanced',
  markdownEnabled: true,
  autoSave: true,
  telemetry: false,
  soundNotifications: false,
  desktopNotifications: false,
  workingDirectory: '',
};

const LANGUAGES = [
  { code: 'en', label: '🇺🇸 English' },
  { code: 'pt', label: '🇧🇷 Português' },
  { code: 'es', label: '🇪🇸 Español' },
  { code: 'fr', label: '🇫🇷 Français' },
  { code: 'de', label: '🇩🇪 Deutsch' },
  { code: 'ja', label: '🇯🇵 日本語' },
  { code: 'zh', label: '🇨🇳 中文' },
  { code: 'ko', label: '🇰🇷 한국어' },
];

const RESPONSE_STYLES = [
  { value: 'concise', label: 'Concise', desc: 'Short, direct answers' },
  { value: 'balanced', label: 'Balanced', desc: 'Standard detail level' },
  { value: 'detailed', label: 'Detailed', desc: 'Thorough explanations' },
] as const;

// ─── Update Banner ────────────────────────────────────────────────────────────
function UpdateBanner() {
  const [update, setUpdate] = useState<{ available: boolean; latest: string; url: string } | null>(null);

  useEffect(() => {
    fetch('/api/update')
      .then(r => r.json())
      .then(d => { if (d.data?.available) setUpdate(d.data); })
      .catch(() => {});
  }, []);

  if (!update) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 16px', marginBottom: 16,
      borderRadius: 'var(--radius-lg)',
      background: 'rgba(59, 130, 246, 0.1)',
      border: '1px solid rgba(59, 130, 246, 0.3)',
    }}>
      <span style={{ fontSize: 20 }}>🆕</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          Update available: v{update.latest}
        </div>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>
          You're running an older version. Update to get the latest features and fixes.
        </div>
      </div>
      <a
        href={update.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          padding: '6px 14px', borderRadius: 'var(--radius-md)',
          background: 'var(--accent)', color: '#fff',
          fontSize: 12, fontWeight: 600, textDecoration: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        View Release
      </a>
    </div>
  );
}

export default function GeneralTab() {
  const [config, setConfig] = useState<AppConfig>(() => {
    if (typeof window === 'undefined') return DEFAULTS;
    try {
      const saved = localStorage.getItem('hiveclaw-app-config');
      return saved ? { ...DEFAULTS, ...JSON.parse(saved) } : DEFAULTS;
    } catch { return DEFAULTS; }
  });
  const [saved, setSaved] = useState(false);
  const [dirPicking, setDirPicking] = useState(false);

  const update = <K extends keyof AppConfig>(key: K, val: AppConfig[K]) =>
    setConfig(c => ({ ...c, [key]: val }));

  const handleSave = () => {
    localStorage.setItem('hiveclaw-app-config', JSON.stringify(config));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const pickDirectory = async () => {
    setDirPicking(true);
    try {
      if ('showDirectoryPicker' in window) {
        const handle = await (window as unknown as { showDirectoryPicker: (o: unknown) => Promise<{ name: string }> })
          .showDirectoryPicker({ mode: 'readwrite' });
        update('workingDirectory', handle.name);
      } else {
        const dir = prompt('Enter working directory path:', config.workingDirectory || '~/projects');
        if (dir) update('workingDirectory', dir);
      }
    } catch { /* cancelled */ } finally { setDirPicking(false); }
  };

  const selectStyle: React.CSSProperties = {
    width: 180, padding: '7px 10px',
    borderRadius: 'var(--radius-md)', background: 'var(--input-bg)',
    border: '1px solid var(--border)', color: 'var(--text)',
    fontSize: 13, outline: 'none', cursor: 'pointer',
  };

  return (
    <div>
      <UpdateBanner />
      <SectionTitle
        title="General"
        desc="Application preferences. Agent config is in the Agents tab → per-agent settings."
      />

      {/* ── Interface ──────────────────────────────────────────────── */}
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8 }}>
        Interface
      </div>

      <SettingRow label="Language" desc="Language for menus and system messages.">
        <select value={config.language} onChange={e => update('language', e.target.value)} style={selectStyle}>
          {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
      </SettingRow>

      <SettingRow label="Response style" desc="How detailed agent responses are by default.">
        <select
          value={config.responseStyle}
          onChange={e => update('responseStyle', e.target.value as AppConfig['responseStyle'])}
          style={selectStyle}
        >
          {RESPONSE_STYLES.map(s => (
            <option key={s.value} value={s.value}>{s.label} — {s.desc}</option>
          ))}
        </select>
      </SettingRow>

      <SettingRow label="Render markdown" desc="Format responses with rich text (bold, code, lists, etc.)">
        <Toggle checked={config.markdownEnabled} onChange={v => update('markdownEnabled', v)} />
      </SettingRow>

      {/* ── Workspace ──────────────────────────────────────────────── */}
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginTop: 24, marginBottom: 8 }}>
        Workspace
      </div>

      <SettingRow label="Working directory" desc="Default project directory for new sessions.">
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div style={{
            flex: 1, padding: '7px 10px', borderRadius: 'var(--radius-md)',
            background: 'var(--input-bg)', border: '1px solid var(--border)',
            color: config.workingDirectory ? 'var(--text)' : 'var(--fg-muted)',
            fontSize: 12, fontFamily: 'var(--font-mono)',
            maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {config.workingDirectory || '~/projects'}
          </div>
          <button onClick={pickDirectory} disabled={dirPicking} style={{
            padding: '7px 12px', borderRadius: 'var(--radius-md)',
            background: 'var(--surface-hover)', border: '1px solid var(--border)',
            color: 'var(--fg-muted)', fontSize: 12, cursor: dirPicking ? 'not-allowed' : 'pointer',
          }}>
            📂 {dirPicking ? 'Picking…' : 'Browse'}
          </button>
        </div>
      </SettingRow>

      {/* ── Behavior ──────────────────────────────────────────────── */}
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginTop: 24, marginBottom: 8 }}>
        Behavior
      </div>

      <SettingRow label="Auto-save sessions" desc="Automatically persist conversation history.">
        <Toggle checked={config.autoSave} onChange={v => update('autoSave', v)} />
      </SettingRow>

      {/* ── Notifications ──────────────────────────────────────────────── */}
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginTop: 24, marginBottom: 8 }}>
        Notifications
      </div>

      <SettingRow label="Sound notifications" desc="Play a sound when an agent responds.">
        <Toggle checked={config.soundNotifications} onChange={v => update('soundNotifications', v)} />
      </SettingRow>
      <SettingRow label="Desktop notifications" desc="Show system notifications for new messages.">
        <Toggle checked={config.desktopNotifications} onChange={v => update('desktopNotifications', v)} />
      </SettingRow>

      {/* ── Privacy ──────────────────────────────────────────────── */}
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginTop: 24, marginBottom: 8 }}>
        Privacy
      </div>

      <SettingRow label="Telemetry" desc="Send anonymous usage data. No personal data, no conversation content.">
        <Toggle checked={config.telemetry} onChange={v => update('telemetry', v)} />
      </SettingRow>

      {/* ── Info callout (agent config location) ──────────────────────────────────── */}
      <div style={{
        marginTop: 24, padding: '12px 14px',
        borderRadius: 'var(--radius-md)', background: 'rgba(255,107,107,0.06)',
        border: '1px solid rgba(255,107,107,0.2)', fontSize: 12, color: 'var(--fg-muted)',
        display: 'flex', gap: 10, alignItems: 'flex-start',
      }}>
        <span style={{ fontSize: 16, flexShrink: 0 }}>💡</span>
        <div>
          <strong style={{ color: 'var(--text)', display: 'block', marginBottom: 3 }}>Looking for agent config?</strong>
          Go to <strong>Agents</strong> tab → click an agent → Edit to configure name, system prompt, model, and parameters per agent.
        </div>
      </div>

      {/* ── Remote Access ─────────────────────────────────────────── */}
      <RemoteAccessSection />

      <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={handleSave}
          style={{
            padding: '8px 18px', borderRadius: 'var(--radius-md)',
            background: saved ? 'var(--green)' : 'var(--coral)',
            color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >
          {saved ? '✓ Saved!' : 'Save changes'}
        </button>
        {saved && <span style={{ fontSize: 12, color: 'var(--green)' }}>Saved to localStorage</span>}
      </div>
    </div>
  );
}
