'use client';

import React, { useState } from 'react';
import { SectionTitle, SettingRow, Toggle } from './shared';
import { useUIStore } from '@/stores/ui-store';

type ThemeKey = 'dark' | 'light' | 'system' | 'midnight' | 'forest' | 'rose' | 'honey';

interface ThemeOption {
  key: ThemeKey;
  label: string;
  icon: string;
  desc: string;
  previewBg: string;
  previewSurface: string;
  previewAccent: string;
  previewText: string;
}

const themes: ThemeOption[] = [
  {
    key: 'dark', label: 'Zinc', icon: '🌙', desc: 'Default dark',
    previewBg: '#09090B', previewSurface: '#18181B', previewAccent: '#F59E0B', previewText: '#FAFAFA',
  },
  {
    key: 'light', label: 'Light', icon: '☀️', desc: 'Clean white',
    previewBg: '#FFFFFF', previewSurface: '#F4F4F5', previewAccent: '#D97706', previewText: '#09090B',
  },
  {
    key: 'midnight', label: 'Midnight', icon: '🌌', desc: 'Deep blue',
    previewBg: '#0B1120', previewSurface: '#111827', previewAccent: '#60A5FA', previewText: '#F1F5F9',
  },
  {
    key: 'forest', label: 'Forest', icon: '🌲', desc: 'Nature green',
    previewBg: '#052E16', previewSurface: '#14532D', previewAccent: '#4ADE80', previewText: '#F0FDF4',
  },
  {
    key: 'rose', label: 'Rosé', icon: '🌸', desc: 'Warm pink',
    previewBg: '#1C0A1C', previewSurface: '#2D1530', previewAccent: '#F472B6', previewText: '#FDF2F8',
  },
  {
    key: 'honey', label: 'Honey', icon: '🍯', desc: 'HiveClaw amber',
    previewBg: '#1A1207', previewSurface: '#27200F', previewAccent: '#F59E0B', previewText: '#FEFCE8',
  },
  {
    key: 'system', label: 'System', icon: '💻', desc: 'Follows OS',
    previewBg: '#09090B', previewSurface: '#18181B', previewAccent: '#F59E0B', previewText: '#FAFAFA',
  },
];

export default function AppearanceTab() {
  const { theme, setTheme, interfaceMode, setInterfaceMode } = useUIStore();
  const [fontSize, setFontSize] = useState(14);
  const [compactMode, setCompactMode] = useState(false);

  return (
    <div>
      <SectionTitle title="Appearance" aria-label="Appearance" desc="Customize the look and feel of the interface." />

      {/* Theme grid */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>
          Color Theme
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 10,
        }}>
          {themes.map((t) => {
            const active = theme === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTheme(t.key)}
                style={{
                  padding: 0,
                  borderRadius: 'var(--radius-lg)',
                  border: `2px solid ${active ? 'var(--coral)' : 'var(--border)'}`,
                  background: active ? 'var(--coral-subtle)' : 'var(--surface)',
                  cursor: 'pointer',
                  transition: 'all 150ms',
                  overflow: 'hidden',
                  textAlign: 'left',
                }}
                onMouseEnter={e => {
                  if (!active) (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-hover)';
                }}
                onMouseLeave={e => {
                  if (!active) (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
                }}
              >
                {/* Color preview */}
                <div style={{
                  height: 56,
                  background: t.previewBg,
                  position: 'relative',
                  overflow: 'hidden',
                }}>
                  {/* Sidebar preview */}
                  <div style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0, width: '30%',
                    background: t.previewSurface,
                    borderRight: `1px solid ${t.key === 'light' ? '#E4E4E7' : 'rgba(255,255,255,0.08)'}`,
                  }}>
                    <div style={{ padding: '8px 6px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <div style={{ height: 3, borderRadius: 2, background: t.previewAccent, width: '70%' }} />
                      <div style={{ height: 3, borderRadius: 2, background: t.previewText, width: '50%', opacity: 0.3 }} />
                      <div style={{ height: 3, borderRadius: 2, background: t.previewText, width: '60%', opacity: 0.15 }} />
                    </div>
                  </div>
                  {/* Chat preview */}
                  <div style={{ position: 'absolute', left: '35%', top: 8, right: 6 }}>
                    <div style={{
                      height: 8, borderRadius: 4, marginBottom: 4,
                      background: t.previewAccent, opacity: 0.6, width: '70%',
                    }} />
                    <div style={{
                      height: 8, borderRadius: 4, marginBottom: 4,
                      background: t.previewText, opacity: 0.15, width: '50%',
                      marginLeft: 'auto',
                    }} />
                    <div style={{
                      height: 8, borderRadius: 4,
                      background: t.previewAccent, opacity: 0.4, width: '60%',
                    }} />
                  </div>
                  {/* System half-split */}
                  {t.key === 'system' && (
                    <div style={{
                      position: 'absolute', top: 0, right: 0, bottom: 0, width: '50%',
                      background: '#FFFFFF',
                      borderLeft: '1px solid #E4E4E7',
                    }}>
                      <div style={{ position: 'absolute', left: 4, top: 8, right: 4 }}>
                        <div style={{ height: 4, borderRadius: 2, background: '#D97706', opacity: 0.5, width: '65%', marginBottom: 3 }} />
                        <div style={{ height: 4, borderRadius: 2, background: '#09090B', opacity: 0.1, width: '45%' }} />
                      </div>
                    </div>
                  )}
                </div>
                {/* Label */}
                <div style={{ padding: '8px 10px' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                    {t.icon} {t.label}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                    {t.desc}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Interface Mode */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>
          Interface Mode
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setInterfaceMode('lite')}
            style={{
              flex: 1, padding: '12px 16px', borderRadius: 10, cursor: 'pointer',
              background: interfaceMode === 'lite' ? 'var(--blue-subtle)' : 'var(--surface-hover)',
              border: interfaceMode === 'lite' ? '1px solid rgba(59,130,246,0.3)' : '1px solid var(--border)',
              textAlign: 'left', transition: 'all 150ms',
            }}
          >
            <div style={{
              fontSize: 14, fontWeight: 600,
              color: interfaceMode === 'lite' ? 'var(--blue)' : 'var(--text)',
              marginBottom: 4,
            }}>💬 Lite</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
              Clean chat experience. No squads, code panels, or automations.
            </div>
          </button>
          <button
            onClick={() => setInterfaceMode('pro')}
            style={{
              flex: 1, padding: '12px 16px', borderRadius: 10, cursor: 'pointer',
              background: interfaceMode === 'pro' ? 'var(--purple-subtle)' : 'var(--surface-hover)',
              border: interfaceMode === 'pro' ? '1px solid rgba(168,85,247,0.3)' : '1px solid var(--border)',
              textAlign: 'left', transition: 'all 150ms',
            }}
          >
            <div style={{
              fontSize: 14, fontWeight: 600,
              color: interfaceMode === 'pro' ? 'var(--purple)' : 'var(--text)',
              marginBottom: 4,
            }}>⚡ Pro</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
              Full dashboard with squads, code, sprints, and workflows.
            </div>
          </button>
        </div>
      </div>

      {/* Font size + Compact */}
      <div>
        <SettingRow label="Font size" desc={`Interface font size. Current: ${fontSize}px`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>12</span>
            <input
              type="range" min={12} max={18} step={1} value={fontSize}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setFontSize(v);
                document.documentElement.style.fontSize = `${v}px`;
              }}
              style={{ width: 120, accentColor: 'var(--coral)', cursor: 'pointer' }}
            />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>18</span>
            <span style={{
              fontSize: 12, fontWeight: 600, color: 'var(--coral)',
              width: 32, textAlign: 'right', fontFamily: 'var(--font-mono)',
            }}>{fontSize}px</span>
          </div>
        </SettingRow>
        <SettingRow label="Compact mode" desc="Reduce padding and spacing throughout the UI.">
          <Toggle checked={compactMode} onChange={setCompactMode} />
        </SettingRow>
      </div>
    </div>
  );
}
