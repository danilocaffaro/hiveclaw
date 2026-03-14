'use client';

import React, { useState, useEffect } from 'react';
import { SectionTitle } from './shared';

// ─── Skills Tab — installed + recommended (Sprint 78) ─────────────

interface Skill {
  name: string;
  description?: string;
  location?: string;
  enabled?: boolean;
}

interface RecommendedSkill {
  id: string;
  name: string;
  description: string;
  why: string;
  status: 'ready' | 'creating' | 'auditing' | 'failed' | 'activated';
  discovered_at: string;
}

type Tab = 'installed' | 'recommended';

export default function SkillsTab() {
  const [tab, setTab] = useState<Tab>('installed');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [recommended, setRecommended] = useState<RecommendedSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingRec, setLoadingRec] = useState(false);
  const [search, setSearch] = useState('');
  const [reloading, setReloading] = useState(false);
  const [activating, setActivating] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);

  const loadSkills = () => {
    setLoading(true);
    fetch('/api/skills')
      .then(r => r.json())
      .then((d: { data?: { skills?: Skill[] } | Skill[] }) => {
        const raw = d?.data;
        const list = Array.isArray(raw) ? raw : raw?.skills ?? [];
        setSkills(list);
      })
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  };

  const loadRecommended = () => {
    setLoadingRec(true);
    fetch('/api/skill-scout/recommended')
      .then(r => r.json())
      .then((d: { data?: RecommendedSkill[] }) => setRecommended(d?.data ?? []))
      .catch(() => setRecommended([]))
      .finally(() => setLoadingRec(false));
  };

  useEffect(() => { loadSkills(); loadRecommended(); }, []);

  const handleReload = async () => {
    setReloading(true);
    try {
      await fetch('/api/skills/reload', { method: 'POST' });
      loadSkills();
    } catch { /* ignore */ } finally { setReloading(false); }
  };

  const handleDiscover = async () => {
    setDiscovering(true);
    try {
      await fetch('/api/skill-scout/discover', { method: 'POST' });
      // poll until done
      let attempts = 0;
      const poll = setInterval(() => {
        attempts++;
        loadRecommended();
        if (attempts > 30) clearInterval(poll);
      }, 3000);
      setTimeout(() => clearInterval(poll), 120000);
    } catch { /* ignore */ } finally {
      setTimeout(() => setDiscovering(false), 5000);
    }
  };

  const handleActivate = async (id: string) => {
    setActivating(id);
    try {
      await fetch(`/api/skill-scout/activate/${id}`, { method: 'POST' });
      loadRecommended();
      loadSkills();
    } catch { /* ignore */ } finally { setActivating(null); }
  };

  const filtered = skills.filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.description ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const statusBadge = (status: RecommendedSkill['status']) => {
    const map: Record<string, { label: string; color: string; bg: string }> = {
      ready:     { label: '✅ pronta', color: 'var(--green)', bg: 'rgba(63,185,80,0.1)' },
      creating:  { label: '⚙️ criando…', color: '#f0a500', bg: 'rgba(240,165,0,0.1)' },
      auditing:  { label: '🔒 auditando…', color: '#7c9ef8', bg: 'rgba(124,158,248,0.1)' },
      failed:    { label: '❌ falhou', color: 'var(--red)', bg: 'rgba(255,80,80,0.1)' },
      activated: { label: '⚡ ativa', color: 'var(--green)', bg: 'rgba(63,185,80,0.15)' },
    };
    const s = map[status] ?? map.ready;
    return (
      <span style={{
        fontSize: 10, padding: '2px 8px', borderRadius: 99,
        background: s.bg, color: s.color, fontWeight: 600, flexShrink: 0,
      }}>{s.label}</span>
    );
  };

  return (
    <div>
      <SectionTitle
        title="Skills"
        desc="Extend agent capabilities with skills."
      />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {(['installed', 'recommended'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '7px 16px', fontSize: 13, fontWeight: tab === t ? 600 : 400,
            background: 'none', border: 'none', cursor: 'pointer',
            color: tab === t ? 'var(--text)' : 'var(--fg-muted)',
            borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
            marginBottom: -1, transition: 'all 0.15s',
          }}>
            {t === 'installed' ? `⚡ Instaladas (${skills.length})` : `✨ Recomendadas (${recommended.filter(r => r.status !== 'activated').length})`}
          </button>
        ))}
      </div>

      {/* ── Installed ── */}
      {tab === 'installed' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Buscar skills…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                flex: 1, padding: '7px 12px', borderRadius: 'var(--radius-md)',
                background: 'var(--input-bg)', border: '1px solid var(--border)',
                color: 'var(--text)', fontSize: 13, outline: 'none',
              }}
            />
            <button onClick={handleReload} disabled={reloading} style={{
              padding: '7px 14px', borderRadius: 'var(--radius-md)',
              background: 'var(--surface-hover)', border: '1px solid var(--border)',
              color: 'var(--fg-muted)', fontSize: 12, cursor: reloading ? 'not-allowed' : 'pointer',
            }}>
              {reloading ? '⟳ Recarregando…' : '⟳ Recarregar'}
            </button>
          </div>

          {loading ? (
            <div style={{ color: 'var(--fg-muted)', fontSize: 13, padding: '16px 0' }}>Carregando skills…</div>
          ) : filtered.length === 0 ? (
            <div style={{ color: 'var(--fg-muted)', fontSize: 13, padding: '16px 0' }}>
              {search ? 'Nenhuma skill encontrada.' : 'Nenhuma skill instalada.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filtered.map((s, i) => (
                <div key={s.name + i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12,
                  padding: '10px 14px', borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>⚡</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{s.name}</div>
                    {s.description && (
                      <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.4 }}>{s.description}</div>
                    )}
                  </div>
                  <span style={{
                    fontSize: 10, padding: '2px 7px', borderRadius: 99,
                    background: 'rgba(63,185,80,0.1)', color: 'var(--green)',
                    fontWeight: 600, flexShrink: 0,
                  }}>instalada</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Recommended ── */}
      {tab === 'recommended' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
              Skills descobertas semanalmente via Gemini — recriadas do zero, auditadas e seguras.
            </div>
            <button onClick={handleDiscover} disabled={discovering} style={{
              padding: '7px 14px', borderRadius: 'var(--radius-md)',
              background: discovering ? 'var(--surface-hover)' : 'var(--accent)',
              border: 'none', color: discovering ? 'var(--fg-muted)' : '#fff',
              fontSize: 12, fontWeight: 600, cursor: discovering ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}>
              {discovering ? '🔍 Descobrindo…' : '🔍 Descobrir agora'}
            </button>
          </div>

          {loadingRec ? (
            <div style={{ color: 'var(--fg-muted)', fontSize: 13, padding: '16px 0' }}>Carregando recomendações…</div>
          ) : recommended.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '40px 20px',
              color: 'var(--fg-muted)', fontSize: 13,
            }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>✨</div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Nenhuma recomendação ainda</div>
              <div style={{ fontSize: 12 }}>Clique em "Descobrir agora" para buscar novas skills via Gemini.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {recommended.map(r => (
                <div key={r.id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12,
                  padding: '12px 14px', borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  opacity: r.status === 'activated' ? 0.6 : 1,
                }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>✨</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{r.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.4, marginBottom: 4 }}>{r.description}</div>
                    {r.why && (
                      <div style={{ fontSize: 11, color: 'var(--accent)', fontStyle: 'italic' }}>💡 {r.why}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                    {statusBadge(r.status)}
                    {r.status === 'ready' && (
                      <button
                        onClick={() => handleActivate(r.id)}
                        disabled={activating === r.id}
                        style={{
                          padding: '4px 10px', borderRadius: 'var(--radius-md)',
                          background: 'var(--accent)', border: 'none',
                          color: '#fff', fontSize: 11, fontWeight: 600,
                          cursor: activating === r.id ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {activating === r.id ? 'Ativando…' : '⚡ Ativar'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
