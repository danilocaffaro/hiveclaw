'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRSPStore, selectActiveAgentId, selectIsSquadMode } from '@/stores/rsp-store';

// ─── B056: Tasks Panel (unified — uses /api/backlog) ─────────────────────────

interface Task {
  id: string;
  title: string;
  description: string;
  status: 'todo' | 'doing' | 'review' | 'done';
  priority: 'low' | 'medium' | 'high' | 'critical';
  assigned_agent_id: string | null;
  tags: string;
  source_message_id: string | null;
  created_at: string;
}

interface Columns {
  todo: Task[];
  doing: Task[];
  review: Task[];
  done: Task[];
}

const COLS: { id: keyof Columns; label: string; dot: string }[] = [
  { id: 'todo',   label: 'TODO',   dot: 'var(--text-muted)' },
  { id: 'doing',  label: 'DOING',  dot: 'var(--blue)' },
  { id: 'review', label: 'REVIEW', dot: 'var(--yellow)' },
  { id: 'done',   label: 'DONE',   dot: 'var(--green)' },
];

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'var(--coral)',
  high:     'var(--yellow)',
  medium:   'var(--blue)',
  low:      'var(--text-muted)',
};

function SprintPanel() {
  const [columns, setColumns] = useState<Columns>({ todo: [], doing: [], review: [], done: [] });
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<keyof Columns | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<keyof Columns | null>(null);

  // RSP context: filter tasks by active agent in squad mode
  const rspAgentId = useRSPStore(selectActiveAgentId);
  const isSquad = useRSPStore(selectIsSquadMode);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/backlog');
      const d = await res.json() as { data: { columns: Columns } };
      setColumns(d.data.columns);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const addTask = async (status: keyof Columns) => {
    if (!newTitle.trim()) return;
    await fetch('/api/backlog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle.trim(), status }),
    });
    setNewTitle('');
    setAdding(null);
    await load();
  };

  const moveTask = async (taskId: string, newStatus: keyof Columns) => {
    await fetch(`/api/backlog/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    await load();
  };

  const deleteTask = async (taskId: string) => {
    await fetch(`/api/backlog/${taskId}`, { method: 'DELETE' });
    await load();
  };

  const cyclePriority = async (task: Task) => {
    const cycle: Task['priority'][] = ['low', 'medium', 'high', 'critical'];
    const next = cycle[(cycle.indexOf(task.priority) + 1) % cycle.length];
    await fetch(`/api/backlog/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority: next }),
    });
    await load();
  };

  const onDrop = async (colId: keyof Columns) => {
    if (dragging) await moveTask(dragging, colId);
    setDragging(null);
    setDragOver(null);
  };

  if (loading) return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Loading tasks…</div>
  );

  const total = Object.values(columns).flat().length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>
          Tasks <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>({total})</span>
        </span>
        <button
          onClick={() => { setAdding('todo'); setNewTitle(''); }}
          style={{
            fontSize: 12, color: 'var(--coral)', background: 'none',
            border: 'none', cursor: 'pointer',
          }}
        >+ New</button>
      </div>

      {/* Kanban */}
      <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden' }}>
        <div style={{ display: 'flex', gap: 8, padding: '8px 10px', height: '100%', minWidth: 'max-content' }}>
          {COLS.map(col => {
            const allTasks = columns[col.id];
            // L-4: In squad mode, filter tasks by active agent
            const tasks = (isSquad && rspAgentId)
              ? allTasks.filter(t => t.assigned_agent_id === rspAgentId || !t.assigned_agent_id)
              : allTasks;
            const isOver = dragOver === col.id;
            return (
              <div
                key={col.id}
                onDragOver={e => { e.preventDefault(); setDragOver(col.id); }}
                onDrop={() => onDrop(col.id)}
                onDragLeave={() => { if (dragOver === col.id) setDragOver(null); }}
                style={{
                  width: 180, minWidth: 180, display: 'flex', flexDirection: 'column',
                  background: isOver ? 'color-mix(in srgb, var(--coral) 4%, var(--surface))' : 'transparent',
                  borderRadius: 'var(--radius-md)',
                  border: isOver ? '1px solid var(--coral)' : '1px solid transparent',
                  transition: 'all 150ms',
                }}
              >
                {/* Col header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', marginBottom: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: col.dot, flexShrink: 0 }} />
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', color: col.dot }}>{col.label}</span>
                  <span style={{
                    marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)',
                    background: 'var(--surface-hover)', borderRadius: 999, padding: '1px 5px',
                  }}>{tasks.length}</span>
                  <button
                    onClick={() => { setAdding(col.id); setNewTitle(''); }}
                    style={{
                      width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, color: 'var(--text-muted)', background: 'none', border: 'none',
                      cursor: 'pointer', padding: 0,
                    }}
                  >+</button>
                </div>

                {/* Tasks */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', padding: '0 4px' }}>
                  {adding === col.id && (
                    <div style={{ padding: 6, borderRadius: 6, background: 'var(--surface)', border: '1px solid var(--coral)' }}>
                      <input
                        autoFocus
                        value={newTitle}
                        onChange={e => setNewTitle(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') void addTask(col.id);
                          if (e.key === 'Escape') { setAdding(null); setNewTitle(''); }
                        }}
                        placeholder="Task title…"
                        style={{
                          width: '100%', background: 'transparent', border: 'none', outline: 'none',
                          color: 'var(--text)', fontSize: 11, fontFamily: 'var(--font-sans)',
                        }}
                      />
                      <div style={{ display: 'flex', gap: 4, marginTop: 4, justifyContent: 'flex-end' }}>
                        <button onClick={() => setAdding(null)} style={{
                          fontSize: 10, padding: '2px 6px', background: 'none', border: '1px solid var(--border)',
                          borderRadius: 4, color: 'var(--text-muted)', cursor: 'pointer',
                        }}>Esc</button>
                        <button onClick={() => addTask(col.id)} style={{
                          fontSize: 10, padding: '2px 6px', background: 'var(--coral)', border: 'none',
                          borderRadius: 4, color: '#fff', cursor: 'pointer', fontWeight: 600,
                        }}>Add</button>
                      </div>
                    </div>
                  )}

                  {tasks.map(task => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={() => setDragging(task.id)}
                      onDragEnd={() => { setDragging(null); setDragOver(null); }}
                      style={{
                        padding: '6px 8px', borderRadius: 6, cursor: 'grab',
                        background: dragging === task.id ? 'var(--coral-subtle)' : 'var(--card-bg)',
                        border: `1px solid ${dragging === task.id ? 'var(--coral)' : 'var(--border)'}`,
                        opacity: dragging === task.id ? 0.5 : 1,
                        transition: 'border-color 100ms',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5 }}>
                        <button
                          onClick={() => cyclePriority(task)}
                          title={`${task.priority} (click to cycle)`}
                          style={{
                            width: 7, height: 7, borderRadius: '50%', flexShrink: 0, marginTop: 3,
                            background: PRIORITY_COLORS[task.priority] ?? '#888',
                            border: 'none', cursor: 'pointer', padding: 0,
                          }}
                        />
                        <span style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.4, flex: 1 }}>
                          {task.title}
                        </span>
                        <button
                          onClick={() => { if (confirm('Delete?')) deleteTask(task.id); }}
                          style={{
                            fontSize: 9, color: 'var(--text-muted)', background: 'none',
                            border: 'none', cursor: 'pointer', padding: '0 2px', flexShrink: 0,
                          }}
                        >✕</button>
                      </div>
                    </div>
                  ))}

                  {tasks.length === 0 && adding !== col.id && (
                    <div style={{
                      padding: '14px 6px', textAlign: 'center', color: 'var(--text-muted)',
                      fontSize: 10, border: '1px dashed var(--border)', borderRadius: 6, opacity: 0.6,
                    }}>Drop here</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default SprintPanel;
