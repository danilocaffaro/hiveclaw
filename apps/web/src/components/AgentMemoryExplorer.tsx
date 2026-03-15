'use client';

import { useState, useEffect, useCallback } from 'react';

const API = '';

/* ── Types ────────────────────────────────────────────────────────────────── */

interface MemoryEntry {
  id: string; agent_id: string; key: string; value: string;
  type: 'short_term' | 'long_term' | 'entity' | 'preference';
  relevance: number; created_at: string; expires_at: string | null;
  access_count?: number; source?: string; tags?: string;
}

interface CoreBlock {
  id?: string; agent_id: string; block_name: string;
  content: string; max_tokens: number; updated_at: string;
}

interface WorkingMemory {
  session_id: string; agent_id: string;
  active_goals?: string; current_plan?: string;
  completed_steps?: string; next_actions?: string;
  pending_context?: string; open_questions?: string;
  updated_at: string;
}

interface MemoryStats {
  total_memories: number;
  by_type: { type: string; cnt: number }[];
  total_edges: number;
  core_blocks: { block_name: string; size: number }[];
  extractions_24h: number;
}

interface SearchResult {
  id: string; role: string; content: string; session_id: string;
  created_at: string; rank?: number; snippet?: string;
}

/* ── Constants ────────────────────────────────────────────────────────────── */

type MemType = MemoryEntry['type'];
type Layer = 'memories' | 'core' | 'working' | 'search' | 'stats';

const TYPE_COLORS: Record<MemType, string> = {
  short_term: 'var(--blue)', long_term: 'var(--green)',
  entity: 'var(--purple)', preference: 'var(--yellow)',
};
const TYPE_ICONS: Record<MemType, string> = {
  short_term: '⚡', long_term: '📚', entity: '👤', preference: '⭐',
};
const MEMORY_TYPES: MemType[] = ['short_term', 'long_term', 'entity', 'preference'];

const LAYERS: { key: Layer; icon: string; label: string }[] = [
  { key: 'memories', icon: '🧠', label: 'Memories' },
  { key: 'core', icon: '💎', label: 'Core Blocks' },
  { key: 'working', icon: '📋', label: 'Working' },
  { key: 'search', icon: '🔍', label: 'Search' },
  { key: 'stats', icon: '📊', label: 'Stats' },
];

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', background: 'var(--bg)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
  color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-sans)',
  outline: 'none', boxSizing: 'border-box',
};

/* ── Component ────────────────────────────────────────────────────────────── */

interface AgentMemoryExplorerProps {
  agentId: string;
  agentName?: string;
  agentEmoji?: string;
}

export default function AgentMemoryExplorer({ agentId, agentName, agentEmoji }: AgentMemoryExplorerProps) {
  const [layer, setLayer] = useState<Layer>('memories');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Layer tabs */}
      <div style={{
        display: 'flex', gap: 2, padding: '0 0 12px',
        borderBottom: '1px solid var(--border)',
        overflowX: 'auto',
      }}>
        {LAYERS.map(l => (
          <button key={l.key} onClick={() => setLayer(l.key)} style={{
            padding: '5px 8px', borderRadius: 'var(--radius-sm)', fontSize: 11,
            fontWeight: layer === l.key ? 600 : 400, whiteSpace: 'nowrap',
            background: layer === l.key ? 'var(--coral-subtle)' : 'transparent',
            color: layer === l.key ? 'var(--coral)' : 'var(--text-muted)',
            border: 'none', cursor: 'pointer', transition: 'all 100ms',
          }}>
            {l.icon} {l.label}
          </button>
        ))}
      </div>

      {/* Layer content */}
      <div style={{ paddingTop: 12 }}>
        {layer === 'memories' && <MemoriesLayer agentId={agentId} />}
        {layer === 'core' && <CoreBlocksLayer agentId={agentId} />}
        {layer === 'working' && <WorkingMemoryLayer agentId={agentId} />}
        {layer === 'search' && <SearchLayer agentId={agentId} />}
        {layer === 'stats' && <StatsLayer agentId={agentId} agentName={agentName} agentEmoji={agentEmoji} />}
      </div>
    </div>
  );
}

/* ── Layer: Agent Memories (graph) ────────────────────────────────────────── */

function MemoriesLayer({ agentId }: { agentId: string }) {
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newType, setNewType] = useState<MemType>('long_term');

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (typeFilter !== 'all') params.set('type', typeFilter);
      const res = await fetch(`${API}/agents/${agentId}/memory?${params}`);
      const d = await res.json();
      setMemories(d.data ?? []);
    } catch { setMemories([]); }
    setLoading(false);
  }, [agentId, search, typeFilter]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!newKey.trim() || !newValue.trim()) return;
    await fetch(`${API}/agents/${agentId}/memory`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: newKey, value: newValue, type: newType, relevance: 0.8 }),
    });
    setNewKey(''); setNewValue(''); setShowAdd(false);
    load();
  };

  const handleDelete = async (memId: string) => {
    await fetch(`${API}/agents/${agentId}/memory/${memId}`, { method: 'DELETE' });
    load();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Search + filter */}
      <div style={{ display: 'flex', gap: 6 }}>
        <input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ ...inputStyle, flex: 1 }} />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          style={{ ...inputStyle, width: 110, cursor: 'pointer' }}>
          <option value="all">All types</option>
          {MEMORY_TYPES.map(t => <option key={t} value={t}>{TYPE_ICONS[t]} {t}</option>)}
        </select>
      </div>

      {/* Memory list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
        {loading && <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>Loading…</div>}
        {!loading && memories.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>
            No memories found
          </div>
        )}
        {memories.map(m => (
          <div key={m.id} style={{
            background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', padding: '8px 10px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: TYPE_COLORS[m.type] }}>
                {TYPE_ICONS[m.type]} {m.type}
              </span>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  r:{m.relevance}
                </span>
                <button onClick={() => handleDelete(m.id)} style={{
                  background: 'none', border: 'none', cursor: 'pointer', fontSize: 11,
                  color: 'var(--text-muted)', padding: '0 2px',
                }} title="Delete">✕</button>
              </div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
              {m.key}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text)', wordBreak: 'break-word' }}>
              {m.value}
            </div>
          </div>
        ))}
      </div>

      {/* Add new */}
      {!showAdd ? (
        <button onClick={() => setShowAdd(true)} style={{
          padding: '6px 10px', background: 'none', border: '1px dashed var(--border)',
          borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 12,
          color: 'var(--coral)', fontWeight: 500,
        }}>+ Add Memory</button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', background: 'var(--bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
          <input placeholder="Key" value={newKey} onChange={e => setNewKey(e.target.value)} style={inputStyle} />
          <input placeholder="Value" value={newValue} onChange={e => setNewValue(e.target.value)} style={inputStyle} />
          <select value={newType} onChange={e => setNewType(e.target.value as MemType)} style={{ ...inputStyle, cursor: 'pointer' }}>
            {MEMORY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={handleAdd} disabled={!newKey.trim() || !newValue.trim()} style={{
              flex: 1, padding: '6px', borderRadius: 'var(--radius-sm)', fontSize: 12, fontWeight: 600,
              background: 'var(--coral)', color: '#000', border: 'none', cursor: 'pointer',
              opacity: newKey.trim() && newValue.trim() ? 1 : 0.4,
            }}>Save</button>
            <button onClick={() => setShowAdd(false)} style={{
              padding: '6px 10px', borderRadius: 'var(--radius-sm)', fontSize: 12,
              background: 'none', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer',
            }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Layer: Core Memory Blocks ────────────────────────────────────────────── */

function CoreBlocksLayer({ agentId }: { agentId: string }) {
  const [blocks, setBlocks] = useState<CoreBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingBlock, setEditingBlock] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  useEffect(() => {
    if (!agentId) return;
    setLoading(true);
    fetch(`${API}/memory/agents/${agentId}/core`)
      .then(r => r.json()).then(d => setBlocks(d.data ?? []))
      .catch(() => setBlocks([]))
      .finally(() => setLoading(false));
  }, [agentId]);

  const saveBlock = async (blockName: string) => {
    await fetch(`${API}/memory/agents/${agentId}/core/${blockName}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editContent }),
    });
    setEditingBlock(null);
    // Reload
    const res = await fetch(`${API}/memory/agents/${agentId}/core`);
    const d = await res.json();
    setBlocks(d.data ?? []);
  };

  if (loading) return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 16, textAlign: 'center' }}>Loading…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
        Always-in-prompt blocks — injected into every agent request.
      </div>
      {blocks.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>
          No core memory blocks
        </div>
      )}
      {blocks.map(b => (
        <div key={b.block_name} style={{
          background: 'var(--bg)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', padding: '8px 10px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--coral)' }}>💎 {b.block_name}</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {b.max_tokens}tok
              </span>
              {editingBlock !== b.block_name && (
                <button onClick={() => { setEditingBlock(b.block_name); setEditContent(b.content); }} style={{
                  background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--coral)',
                }}>Edit</button>
              )}
            </div>
          </div>
          {editingBlock === b.block_name ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <textarea value={editContent} onChange={e => setEditContent(e.target.value)}
                rows={5} style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: 11, resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => saveBlock(b.block_name)} style={{
                  padding: '4px 10px', borderRadius: 'var(--radius-sm)', fontSize: 11, fontWeight: 600,
                  background: 'var(--coral)', color: '#000', border: 'none', cursor: 'pointer',
                }}>Save</button>
                <button onClick={() => setEditingBlock(null)} style={{
                  padding: '4px 10px', borderRadius: 'var(--radius-sm)', fontSize: 11,
                  background: 'none', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer',
                }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{
              fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)',
              whiteSpace: 'pre-wrap', lineHeight: 1.5, maxHeight: 120, overflowY: 'auto',
            }}>{b.content || <em style={{ color: 'var(--text-muted)' }}>Empty</em>}</div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Layer: Working Memory ────────────────────────────────────────────────── */

function WorkingMemoryLayer({ agentId }: { agentId: string }) {
  const [sessions, setSessions] = useState<{ id: string; title: string }[]>([]);
  const [selectedSession, setSelectedSession] = useState('');
  const [wm, setWm] = useState<WorkingMemory | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${API}/sessions?agent_id=${agentId}&limit=10`)
      .then(r => r.json()).then(d => {
        const list = d.data ?? [];
        setSessions(list);
        if (list.length > 0) setSelectedSession(list[0].id);
      }).catch(() => {});
  }, [agentId]);

  useEffect(() => {
    if (!selectedSession) return;
    setLoading(true);
    fetch(`${API}/memory/working/${selectedSession}`)
      .then(r => r.json()).then(d => setWm(d.data ?? null))
      .catch(() => setWm(null))
      .finally(() => setLoading(false));
  }, [selectedSession]);

  const parseField = (raw: string | undefined): string[] => {
    if (!raw) return [];
    try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : []; } catch { return raw ? [raw] : []; }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        Task state per session — goals, plan, next actions.
      </div>
      <select value={selectedSession} onChange={e => setSelectedSession(e.target.value)}
        style={{ ...inputStyle, cursor: 'pointer' }}>
        {sessions.length === 0 && <option value="">No sessions</option>}
        {sessions.map(s => <option key={s.id} value={s.id}>{s.title || s.id.slice(0, 8)}</option>)}
      </select>

      {loading && <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>Loading…</div>}
      {!loading && !wm && <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>No working memory for this session</div>}
      {!loading && wm && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { label: '🎯 Active Goals', items: parseField(wm.active_goals) },
            { label: '📋 Current Plan', items: wm.current_plan ? [wm.current_plan] : [] },
            { label: '✅ Completed', items: parseField(wm.completed_steps) },
            { label: '➡️ Next Actions', items: parseField(wm.next_actions) },
            { label: '❓ Open Questions', items: parseField(wm.open_questions) },
          ].filter(s => s.items.length > 0).map(section => (
            <div key={section.label} style={{
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', padding: '8px 10px',
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                {section.label}
              </div>
              {section.items.map((item, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--text)', padding: '2px 0', wordBreak: 'break-word' }}>
                  {section.items.length > 1 ? `• ${item}` : item}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Layer: Full-Text Search (Archival) ───────────────────────────────────── */

function SearchLayer({ agentId }: { agentId: string }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'fts' | 'hybrid'>('fts');

  const doSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      if (mode === 'hybrid') {
        const res = await fetch(`${API}/memory/${agentId}/hybrid-search`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, limit: 20 }),
        });
        const d = await res.json();
        setResults(d.data?.results ?? []);
      } else {
        const res = await fetch(`${API}/memory/search/fts?q=${encodeURIComponent(query)}&limit=20&snippets=true`);
        const d = await res.json();
        setResults(d.data ?? []);
      }
    } catch { setResults([]); }
    setLoading(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        Search across all message history and memories.
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input placeholder="Search query…" value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && doSearch()}
          style={{ ...inputStyle, flex: 1 }} />
        <button onClick={doSearch} disabled={!query.trim()} style={{
          padding: '6px 12px', borderRadius: 'var(--radius-sm)', fontSize: 12, fontWeight: 600,
          background: query.trim() ? 'var(--coral)' : 'var(--border)',
          color: query.trim() ? '#000' : 'var(--text-muted)',
          border: 'none', cursor: query.trim() ? 'pointer' : 'not-allowed',
        }}>Search</button>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {(['fts', 'hybrid'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)} style={{
            padding: '3px 8px', borderRadius: 'var(--radius-sm)', fontSize: 10,
            background: mode === m ? 'var(--coral-subtle)' : 'transparent',
            color: mode === m ? 'var(--coral)' : 'var(--text-muted)',
            border: 'none', cursor: 'pointer', fontWeight: mode === m ? 600 : 400,
          }}>{m === 'fts' ? 'Full-Text' : 'Hybrid (FTS+Vector)'}</button>
        ))}
      </div>

      {loading && <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>Searching…</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
        {results.map((r, i) => (
          <div key={r.id || i} style={{
            background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', padding: '8px 10px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{
                fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                color: r.role === 'assistant' ? 'var(--coral)' : 'var(--blue)',
              }}>{r.role}</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {new Date(r.created_at).toLocaleDateString()}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text)', wordBreak: 'break-word', lineHeight: 1.5 }}>
              {(r.snippet || r.content || '').slice(0, 200)}{(r.snippet || r.content || '').length > 200 ? '…' : ''}
            </div>
          </div>
        ))}
        {!loading && results.length === 0 && query.trim() && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>No results</div>
        )}
      </div>
    </div>
  );
}

/* ── Layer: Stats ─────────────────────────────────────────────────────────── */

function StatsLayer({ agentId, agentName, agentEmoji }: { agentId: string; agentName?: string; agentEmoji?: string }) {
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!agentId) return;
    setLoading(true);
    fetch(`${API}/memory/stats/${agentId}`)
      .then(r => r.json()).then(d => setStats(d.data ?? null))
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, [agentId]);

  if (loading) return <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>Loading…</div>;
  if (!stats) return <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>No stats available</div>;

  const maxCount = Math.max(...stats.by_type.map(t => t.cnt), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[
          { label: 'Total Memories', value: stats.total_memories, icon: '🧠' },
          { label: 'Graph Edges', value: stats.total_edges, icon: '🔗' },
          { label: 'Core Blocks', value: stats.core_blocks.length, icon: '💎' },
          { label: 'Extractions 24h', value: stats.extractions_24h, icon: '📥' },
        ].map(card => (
          <div key={card.label} style={{
            background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', padding: '10px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 20, marginBottom: 2 }}>{card.icon}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
              {card.value}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{card.label}</div>
          </div>
        ))}
      </div>

      {/* By type breakdown */}
      {stats.by_type.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase' }}>
            By Type
          </div>
          {stats.by_type.map(t => {
            const type = t.type as MemType;
            return (
              <div key={t.type} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 11, width: 80, color: 'var(--text-secondary)' }}>
                  {TYPE_ICONS[type] ?? '⚪'} {t.type}
                </span>
                <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 3,
                    background: TYPE_COLORS[type] ?? 'var(--text-muted)',
                    width: `${(t.cnt / maxCount) * 100}%`,
                    transition: 'width 300ms',
                  }} />
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', width: 30, textAlign: 'right' }}>
                  {t.cnt}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
