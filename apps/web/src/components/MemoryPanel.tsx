'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRSPStore, selectActiveAgentId } from '@/stores/rsp-store';

const API = '';

interface MemoryEntry {
  id: string; agent_id: string;
  type: 'short_term' | 'long_term' | 'entity' | 'preference';
  key: string; value: string; relevance: number;
  created_at: string; expires_at: string | null;
}

interface Agent { id: string; name: string; emoji: string; }

type MemType = MemoryEntry['type'];

const TYPE_COLORS: Record<MemType, string> = {
  short_term: 'var(--blue, #58A6FF)', long_term: 'var(--green, #3FB950)',
  entity: 'var(--purple, #BC8CFF)', preference: 'var(--yellow, #D29922)',
};
const TYPE_ICONS: Record<MemType, string> = {
  short_term: '🔵', long_term: '🟢', entity: '🟣', preference: '🟡',
};
const MEMORY_TYPES: MemType[] = ['short_term', 'long_term', 'entity', 'preference'];

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', background: 'var(--bg, #0D1117)',
  border: '1px solid var(--border, #30363D)', borderRadius: 'var(--radius-sm, 6px)',
  color: 'var(--text, #E6EDF3)', fontSize: 13, fontFamily: 'var(--font-sans)',
  outline: 'none', boxSizing: 'border-box' as const,
};
const selectStyle: React.CSSProperties = {
  ...inputStyle, cursor: 'pointer', appearance: 'none' as const,
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238B949E' d='M2 4l4 4 4-4'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', paddingRight: 28,
};
const labelStyle: React.CSSProperties = {
  fontSize: 11, color: 'var(--text-muted, #484F58)', marginBottom: 4, display: 'block',
};

export default function MemoryPanel() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  // L-5: Auto-select agent from RSP context
  const rspAgentId = useRSPStore(selectActiveAgentId);
  useEffect(() => {
    if (rspAgentId && rspAgentId !== selectedAgentId) {
      setSelectedAgentId(rspAgentId);
    }
  }, [rspAgentId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newType, setNewType] = useState<MemType>('short_term');
  const [newRelevance, setNewRelevance] = useState(0.8);

  useEffect(() => {
    fetch(`${API}/agents`).then((r) => r.json()).then((d) => {
      const list: Agent[] = d.data ?? [];
      setAgents(list);
      if (list.length > 0 && !selectedAgentId) setSelectedAgentId(list[0].id);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMemories = useCallback(async () => {
    if (!selectedAgentId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (typeFilter !== 'all') params.set('type', typeFilter);
      const res = await fetch(`${API}/agents/${selectedAgentId}/memory?${params}`);
      const d = await res.json();
      setMemories(d.data ?? []);
    } catch { setMemories([]); }
    setLoading(false);
  }, [selectedAgentId, search, typeFilter]);

  useEffect(() => { loadMemories(); }, [loadMemories]);

  const handleAdd = async () => {
    if (!newKey.trim() || !newValue.trim() || !selectedAgentId) return;
    try {
      await fetch(`${API}/agents/${selectedAgentId}/memory`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: newKey, value: newValue, type: newType, relevance: newRelevance }),
      });
      setNewKey(''); setNewValue(''); setShowAdd(false);
      loadMemories();
    } catch {}
  };

  const handleDelete = async (memoryId: string) => {
    try {
      await fetch(`${API}/agents/${selectedAgentId}/memory/${memoryId}`, { method: 'DELETE' });
      loadMemories();
    } catch {}
  };

  const canSave = newKey.trim() && newValue.trim();

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--surface, #161B22)', color: 'var(--text, #E6EDF3)',
      fontFamily: 'var(--font-sans)', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--border, #30363D)', flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>🧠</span><span>Agent Memory</span>
        </div>
        <select value={selectedAgentId} onChange={(e) => setSelectedAgentId(e.target.value)} style={selectStyle}>
          {agents.length === 0 && <option value="">No agents</option>}
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>
          ))}
        </select>
      </div>

      {/* Search & Filter */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid var(--border, #30363D)',
        display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0,
      }}>
        <div style={{ position: 'relative' }}>
          <span style={{
            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
            fontSize: 13, pointerEvents: 'none', color: 'var(--text-muted, #484F58)',
          }}>🔍</span>
          <input type="text" placeholder="Search memories..." value={search}
            onChange={(e) => setSearch(e.target.value)} style={{ ...inputStyle, paddingLeft: 32 }} />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={selectStyle}>
          <option value="all">All types</option>
          {MEMORY_TYPES.map((t) => <option key={t} value={t}>{TYPE_ICONS[t]} {t}</option>)}
        </select>
      </div>

      {/* Memory List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted, #484F58)', padding: 24, fontSize: 13 }}>Loading…</div>
        )}
        {!loading && memories.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted, #484F58)', padding: 24, fontSize: 13 }}>
            {selectedAgentId ? 'No memories found' : 'Select an agent'}
          </div>
        )}
        {!loading && memories.map((m) => {
          const color = TYPE_COLORS[m.type] ?? 'var(--text-muted)';
          const icon = TYPE_ICONS[m.type] ?? '⚪';
          return (
            <div key={m.id} style={{
              background: 'var(--card-bg, #161B22)', border: '1px solid var(--border, #30363D)',
              borderRadius: 'var(--radius-md, 8px)', padding: '10px 12px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color }}>{icon} {m.type}</span>
                <button onClick={() => handleDelete(m.id)} title="Delete memory" aria-label="Delete memory" style={{
                  background: 'none', border: 'none', cursor: 'pointer', fontSize: 14,
                  padding: '2px 4px', borderRadius: 4, color: 'var(--text-muted, #484F58)', lineHeight: 1,
                }}>🗑</button>
              </div>
              <div style={{
                fontSize: 13, fontWeight: 500, color: 'var(--text-secondary, #8B949E)',
                fontFamily: 'var(--font-mono)', marginBottom: 2,
              }}>{m.key}</div>
              <div style={{ fontSize: 13, color: 'var(--text, #E6EDF3)', marginBottom: 6, wordBreak: 'break-word' }}>
                &ldquo;{m.value}&rdquo;
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted, #484F58)', fontFamily: 'var(--font-mono)' }}>
                relevance: {m.relevance}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Memory */}
      <div style={{ borderTop: '1px solid var(--border, #30363D)', flexShrink: 0 }}>
        <button onClick={() => setShowAdd(!showAdd)} style={{
          width: '100%', padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 13, fontWeight: 500, color: 'var(--coral, #FF7B72)', textAlign: 'left',
          fontFamily: 'var(--font-sans)', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ fontSize: 15 }}>{showAdd ? '−' : '+'}</span>
          <span>{showAdd ? 'Cancel' : 'Add Memory'}</span>
        </button>
        {showAdd && (
          <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <label style={labelStyle}>Key</label>
              <input type="text" placeholder="e.g. primary_skill" value={newKey}
                onChange={(e) => setNewKey(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Value</label>
              <input type="text" placeholder="e.g. TypeScript expert" value={newValue}
                onChange={(e) => setNewValue(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Type</label>
                <select value={newType} onChange={(e) => setNewType(e.target.value as MemType)} style={selectStyle}>
                  {MEMORY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div style={{ width: 80 }}>
                <label style={labelStyle}>Relevance</label>
                <input type="number" min={0} max={1} step={0.1} value={newRelevance}
                  onChange={(e) => setNewRelevance(parseFloat(e.target.value) || 0)}
                  style={{ ...inputStyle, textAlign: 'center' }} />
              </div>
            </div>
            <button onClick={handleAdd} disabled={!canSave} style={{
              padding: '8px 16px', border: 'none', borderRadius: 'var(--radius-sm, 6px)',
              fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-sans)',
              background: canSave ? 'var(--coral, #FF7B72)' : 'var(--border, #30363D)',
              color: canSave ? '#fff' : 'var(--text-muted, #484F58)',
              cursor: canSave ? 'pointer' : 'not-allowed',
            }}>Save</button>
          </div>
        )}
      </div>
    </div>
  );
}
