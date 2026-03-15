'use client';

import { useState, useEffect, useCallback } from 'react';

const API = '';

/* ── Types ────────────────────────────────────────────────────────────────── */

interface MemoryEntry {
  id: string; agent_id: string; key: string; value: string;
  type: MemType;
  relevance: number; created_at: string; expires_at: string | null;
  access_count?: number; source?: string; tags?: string;
  event_at?: string | null; valid_until?: string | null;
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

interface MemoryEdge {
  id: string; source_id: string; target_id: string;
  relation: string; weight: number; created_at: string;
}

interface MemoryGraph {
  nodes: MemoryEntry[];
  edges: MemoryEdge[];
}

interface Episode {
  id: string; session_id: string; agent_id: string;
  type: string; content: string; event_at: string;
  metadata?: string;
}

interface CompactionEntry {
  id: string; session_id: string; summary: string;
  extracted_facts: number; messages_compacted: number;
  tokens_before: number; tokens_after: number;
  working_memory_saved: number; created_at: string;
}

/* ── Constants ────────────────────────────────────────────────────────────── */

type MemType = 'short_term' | 'long_term' | 'entity' | 'preference' | 'fact' | 'decision' | 'goal' | 'event' | 'procedure' | 'correction';
type Layer = 'memories' | 'core' | 'working' | 'episodes' | 'graph' | 'search' | 'stats';

const TYPE_COLORS: Record<MemType, string> = {
  short_term: 'var(--blue)',
  long_term: 'var(--green)',
  entity: 'var(--purple)',
  preference: 'var(--yellow)',
  fact: 'var(--coral)',
  decision: '#E879F9',      // fuchsia
  goal: '#34D399',           // emerald
  event: '#38BDF8',          // sky
  procedure: '#A78BFA',      // violet
  correction: '#FB7185',     // rose
};

const TYPE_ICONS: Record<MemType, string> = {
  short_term: '⚡', long_term: '📚', entity: '👤', preference: '⭐',
  fact: '📌', decision: '⚖️', goal: '🎯', event: '📅',
  procedure: '📝', correction: '🔄',
};

const MEMORY_TYPES: MemType[] = [
  'short_term', 'long_term', 'entity', 'preference',
  'fact', 'decision', 'goal', 'event', 'procedure', 'correction',
];

const LAYERS: { key: Layer; icon: string; label: string }[] = [
  { key: 'memories', icon: '🧠', label: 'Memories' },
  { key: 'core', icon: '💎', label: 'Core' },
  { key: 'working', icon: '📋', label: 'Working' },
  { key: 'episodes', icon: '📖', label: 'Episodes' },
  { key: 'graph', icon: '🕸️', label: 'Graph' },
  { key: 'search', icon: '🔍', label: 'Search' },
  { key: 'stats', icon: '📊', label: 'Stats' },
];

const EDGE_COLORS: Record<string, string> = {
  related_to: 'var(--text-muted)',
  updates: 'var(--blue)',
  contradicts: 'var(--red)',
  supports: 'var(--green)',
  caused_by: 'var(--yellow)',
  part_of: 'var(--purple)',
};

const EDGE_ICONS: Record<string, string> = {
  related_to: '↔', updates: '🔄', contradicts: '⚡',
  supports: '✅', caused_by: '←', part_of: '⊂',
};

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
        {layer === 'episodes' && <EpisodesLayer agentId={agentId} />}
        {layer === 'graph' && <GraphLayer agentId={agentId} />}
        {layer === 'search' && <SearchLayer agentId={agentId} />}
        {layer === 'stats' && <StatsLayer agentId={agentId} agentName={agentName} agentEmoji={agentEmoji} />}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   Layer: Memories — All 10 types with contradiction + temporal indicators
   ══════════════════════════════════════════════════════════════════════════════ */

function MemoriesLayer({ agentId }: { agentId: string }) {
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showExpired, setShowExpired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newType, setNewType] = useState<MemType>('fact');

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

  // Filter expired if toggle is off
  const filteredMemories = showExpired ? memories : memories.filter(m =>
    !m.valid_until || new Date(m.valid_until) > new Date()
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Search + filter */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ ...inputStyle, flex: 1, minWidth: 100 }} />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          style={{ ...inputStyle, width: 120, cursor: 'pointer' }}>
          <option value="all">All types</option>
          {MEMORY_TYPES.map(t => <option key={t} value={t}>{TYPE_ICONS[t]} {t}</option>)}
        </select>
      </div>

      {/* Temporal toggle */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>
        <input type="checkbox" checked={showExpired} onChange={e => setShowExpired(e.target.checked)}
          style={{ accentColor: 'var(--coral)' }} />
        Show invalidated memories
      </label>

      {/* Memory list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 350, overflowY: 'auto' }}>
        {loading && <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>Loading…</div>}
        {!loading && filteredMemories.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>
            No memories found
          </div>
        )}
        {filteredMemories.map(m => {
          const isInvalidated = m.valid_until && new Date(m.valid_until) <= new Date();
          return (
            <div key={m.id} style={{
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', padding: '8px 10px',
              opacity: isInvalidated ? 0.5 : 1,
              borderLeft: isInvalidated ? '3px solid var(--red)' : undefined,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: TYPE_COLORS[m.type] ?? 'var(--text-muted)' }}>
                    {TYPE_ICONS[m.type] ?? '⚪'} {m.type}
                  </span>
                  {isInvalidated && (
                    <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: 'var(--red-subtle)', color: 'var(--red)', fontWeight: 600 }}>
                      INVALIDATED
                    </span>
                  )}
                  {m.source && (
                    <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: 'var(--blue-subtle)', color: 'var(--blue)' }}>
                      {m.source}
                    </span>
                  )}
                </div>
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
              {/* Temporal metadata */}
              {(m.event_at || m.valid_until) && (
                <div style={{ display: 'flex', gap: 8, marginTop: 4, fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {m.event_at && <span>📅 {new Date(m.event_at).toLocaleDateString()}</span>}
                  {m.valid_until && <span>⏰ until {new Date(m.valid_until).toLocaleDateString()}</span>}
                </div>
              )}
              {/* Tags */}
              {m.tags && m.tags !== '[]' && (() => {
                try {
                  const tags: string[] = JSON.parse(m.tags);
                  if (tags.length === 0) return null;
                  return (
                    <div style={{ display: 'flex', gap: 3, marginTop: 4, flexWrap: 'wrap' }}>
                      {tags.map((tag, i) => (
                        <span key={i} style={{
                          fontSize: 9, padding: '1px 5px', borderRadius: 4,
                          background: 'var(--purple-subtle)', color: 'var(--purple)',
                        }}>{tag}</span>
                      ))}
                    </div>
                  );
                } catch { return null; }
              })()}
            </div>
          );
        })}
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
            {MEMORY_TYPES.map(t => <option key={t} value={t}>{TYPE_ICONS[t]} {t}</option>)}
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

/* ══════════════════════════════════════════════════════════════════════════════
   Layer: Core Memory Blocks
   ══════════════════════════════════════════════════════════════════════════════ */

function CoreBlocksLayer({ agentId }: { agentId: string }) {
  const [blocks, setBlocks] = useState<CoreBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingBlock, setEditingBlock] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [newBlockName, setNewBlockName] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const loadBlocks = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/memory/agents/${agentId}/core`);
      const d = await res.json();
      setBlocks(d.data ?? []);
    } catch { setBlocks([]); }
    setLoading(false);
  }, [agentId]);

  useEffect(() => { loadBlocks(); }, [loadBlocks]);

  const saveBlock = async (blockName: string) => {
    await fetch(`${API}/memory/agents/${agentId}/core/${blockName}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editContent }),
    });
    setEditingBlock(null);
    loadBlocks();
  };

  const createBlock = async () => {
    if (!newBlockName.trim()) return;
    await fetch(`${API}/memory/agents/${agentId}/core/${newBlockName.trim()}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '' }),
    });
    setNewBlockName('');
    setShowAdd(false);
    loadBlocks();
  };

  if (loading) return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 16, textAlign: 'center' }}>Loading…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
        Always-in-prompt blocks — injected into every agent request. MemGPT-style.
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

      {/* Add new block */}
      {!showAdd ? (
        <button onClick={() => setShowAdd(true)} style={{
          padding: '6px 10px', background: 'none', border: '1px dashed var(--border)',
          borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 12,
          color: 'var(--coral)', fontWeight: 500,
        }}>+ Add Core Block</button>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <input placeholder="Block name (e.g. persona, human, goals)" value={newBlockName}
            onChange={e => setNewBlockName(e.target.value)} style={{ ...inputStyle, flex: 1 }}
            onKeyDown={e => e.key === 'Enter' && createBlock()} />
          <button onClick={createBlock} disabled={!newBlockName.trim()} style={{
            padding: '6px 10px', borderRadius: 'var(--radius-sm)', fontSize: 11, fontWeight: 600,
            background: newBlockName.trim() ? 'var(--coral)' : 'var(--border)',
            color: newBlockName.trim() ? '#000' : 'var(--text-muted)',
            border: 'none', cursor: newBlockName.trim() ? 'pointer' : 'not-allowed',
          }}>Create</button>
          <button onClick={() => setShowAdd(false)} style={{
            padding: '6px 10px', borderRadius: 'var(--radius-sm)', fontSize: 11,
            background: 'none', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer',
          }}>Cancel</button>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   Layer: Working Memory
   ══════════════════════════════════════════════════════════════════════════════ */

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

/* ══════════════════════════════════════════════════════════════════════════════
   Layer: Episodes — Episodic events + Compaction log
   ══════════════════════════════════════════════════════════════════════════════ */

function EpisodesLayer({ agentId }: { agentId: string }) {
  const [sessions, setSessions] = useState<{ id: string; title: string }[]>([]);
  const [selectedSession, setSelectedSession] = useState('');
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [compactions, setCompactions] = useState<CompactionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'episodes' | 'compactions'>('episodes');

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
    fetch(`${API}/memory/episodes/${selectedSession}`)
      .then(r => r.json())
      .then(d => {
        setEpisodes(d.data?.episodes ?? []);
        setCompactions(d.data?.compactions ?? []);
      })
      .catch(() => { setEpisodes([]); setCompactions([]); })
      .finally(() => setLoading(false));
  }, [selectedSession]);

  const EPISODE_COLORS: Record<string, string> = {
    message: 'var(--blue)', compaction: 'var(--yellow)',
    extraction: 'var(--green)', decision: '#E879F9', event: 'var(--coral)',
  };
  const EPISODE_ICONS: Record<string, string> = {
    message: '💬', compaction: '📦', extraction: '📥',
    decision: '⚖️', event: '📅',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        Episodic memory — events, compactions, and knowledge extractions.
      </div>

      <select value={selectedSession} onChange={e => setSelectedSession(e.target.value)}
        style={{ ...inputStyle, cursor: 'pointer' }}>
        {sessions.length === 0 && <option value="">No sessions</option>}
        {sessions.map(s => <option key={s.id} value={s.id}>{s.title || s.id.slice(0, 8)}</option>)}
      </select>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 4 }}>
        {(['episodes', 'compactions'] as const).map(v => (
          <button key={v} onClick={() => setView(v)} style={{
            padding: '4px 10px', borderRadius: 'var(--radius-sm)', fontSize: 11,
            background: view === v ? 'var(--coral-subtle)' : 'transparent',
            color: view === v ? 'var(--coral)' : 'var(--text-muted)',
            border: 'none', cursor: 'pointer', fontWeight: view === v ? 600 : 400,
          }}>{v === 'episodes' ? `📖 Episodes (${episodes.length})` : `📦 Compactions (${compactions.length})`}</button>
        ))}
      </div>

      {loading && <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>Loading…</div>}

      {/* Episodes list */}
      {!loading && view === 'episodes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 350, overflowY: 'auto' }}>
          {episodes.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>No episodes recorded</div>
          )}
          {episodes.map(ep => (
            <div key={ep.id} style={{
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', padding: '8px 10px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: EPISODE_COLORS[ep.type] ?? 'var(--text-muted)' }}>
                  {EPISODE_ICONS[ep.type] ?? '⚪'} {ep.type}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {new Date(ep.event_at).toLocaleString()}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text)', wordBreak: 'break-word', lineHeight: 1.5 }}>
                {ep.content.slice(0, 300)}{ep.content.length > 300 ? '…' : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Compactions list */}
      {!loading && view === 'compactions' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 350, overflowY: 'auto' }}>
          {compactions.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>No compactions recorded</div>
          )}
          {compactions.map(c => (
            <div key={c.id} style={{
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', padding: '8px 10px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--yellow)' }}>📦 Compaction</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {new Date(c.created_at).toLocaleString()}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 6, lineHeight: 1.5 }}>
                {c.summary.slice(0, 200)}{c.summary.length > 200 ? '…' : ''}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[
                  { label: 'Facts extracted', value: c.extracted_facts, color: 'var(--green)' },
                  { label: 'Messages compacted', value: c.messages_compacted, color: 'var(--blue)' },
                  { label: 'Tokens saved', value: c.tokens_before - c.tokens_after, color: 'var(--coral)' },
                ].map(s => (
                  <span key={s.label} style={{
                    fontSize: 10, padding: '2px 6px', borderRadius: 4,
                    background: `color-mix(in srgb, ${s.color} 12%, transparent)`,
                    color: s.color, fontWeight: 500, fontFamily: 'var(--font-mono)',
                  }}>{s.label}: {s.value}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   Layer: Graph — Memory relationships (edges)
   ══════════════════════════════════════════════════════════════════════════════ */

function GraphLayer({ agentId }: { agentId: string }) {
  const [graph, setGraph] = useState<MemoryGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');

  useEffect(() => {
    if (!agentId) return;
    setLoading(true);
    fetch(`${API}/memory/agents/${agentId}/graph?limit=50`)
      .then(r => r.json()).then(d => setGraph(d.data ?? null))
      .catch(() => setGraph(null))
      .finally(() => setLoading(false));
  }, [agentId]);

  if (loading) return <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>Loading graph…</div>;
  if (!graph) return <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>No graph data</div>;

  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
  const filteredEdges = typeFilter === 'all' ? graph.edges : graph.edges.filter(e => e.relation === typeFilter);
  const edgeTypes = [...new Set(graph.edges.map(e => e.relation))];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        Relationships between memories — contradictions, updates, support chains.
      </div>

      {/* Summary */}
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
          🧠 {graph.nodes.length} nodes
        </span>
        <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
          🔗 {graph.edges.length} edges
        </span>
      </div>

      {/* Edge type filter */}
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        <button onClick={() => setTypeFilter('all')} style={{
          padding: '3px 8px', borderRadius: 4, fontSize: 10,
          background: typeFilter === 'all' ? 'var(--coral-subtle)' : 'transparent',
          color: typeFilter === 'all' ? 'var(--coral)' : 'var(--text-muted)',
          border: 'none', cursor: 'pointer', fontWeight: typeFilter === 'all' ? 600 : 400,
        }}>All</button>
        {edgeTypes.map(et => (
          <button key={et} onClick={() => setTypeFilter(et)} style={{
            padding: '3px 8px', borderRadius: 4, fontSize: 10,
            background: typeFilter === et ? 'var(--coral-subtle)' : 'transparent',
            color: typeFilter === et ? EDGE_COLORS[et] ?? 'var(--coral)' : 'var(--text-muted)',
            border: 'none', cursor: 'pointer', fontWeight: typeFilter === et ? 600 : 400,
          }}>{EDGE_ICONS[et] ?? '↔'} {et}</button>
        ))}
      </div>

      {/* Edge list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 350, overflowY: 'auto' }}>
        {filteredEdges.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>
            No relationships found
          </div>
        )}
        {filteredEdges.map(edge => {
          const src = nodeMap.get(edge.source_id);
          const tgt = nodeMap.get(edge.target_id);
          const relColor = EDGE_COLORS[edge.relation] ?? 'var(--text-muted)';
          return (
            <div key={edge.id} style={{
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', padding: '8px 10px',
              borderLeft: `3px solid ${relColor}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: relColor }}>
                  {EDGE_ICONS[edge.relation] ?? '↔'} {edge.relation}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  w:{edge.weight}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {/* Source */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>FROM</span>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                    {src ? `${TYPE_ICONS[src.type] ?? '⚪'} ${src.key}` : edge.source_id.slice(0, 8)}
                  </span>
                </div>
                {/* Target */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 10, color: 'var(--blue)', fontWeight: 600 }}>TO&nbsp;&nbsp;</span>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                    {tgt ? `${TYPE_ICONS[tgt.type] ?? '⚪'} ${tgt.key}` : edge.target_id.slice(0, 8)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   Layer: Full-Text Search (Archival)
   ══════════════════════════════════════════════════════════════════════════════ */

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

/* ══════════════════════════════════════════════════════════════════════════════
   Layer: Stats
   ══════════════════════════════════════════════════════════════════════════════ */

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
                <span style={{ fontSize: 11, width: 90, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
