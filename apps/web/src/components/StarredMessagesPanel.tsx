'use client';

import { useState, useEffect } from 'react';

interface StarredMessage {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
  agent_name?: string;
  agent_emoji?: string;
  session_title?: string;
  starred_at: string;
}

/**
 * N-3: Starred (saved) messages panel.
 * Shows all starred messages across sessions, newest first.
 */
export default function StarredMessagesPanel({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<StarredMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/starred');
        if (!res.ok) return;
        const json = await res.json() as { data: StarredMessage[] };
        setMessages(json.data ?? []);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  const unstar = async (msgId: string) => {
    try {
      await fetch(`/api/messages/${msgId}/star`, { method: 'POST' });
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
    } catch { /* ignore */ }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 900,
      background: 'rgba(0,0,0,0.35)',
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        position: 'absolute', top: 0, right: 0,
        width: 380, height: '100%',
        background: 'var(--surface)',
        borderLeft: '1px solid var(--border)',
        boxShadow: '-8px 0 24px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>⭐ Saved Messages</span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: 16, color: 'var(--text-muted)',
            cursor: 'pointer', padding: 4,
          }}>✕</button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20, fontSize: 13 }}>Loading…</div>
          ) : messages.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20, fontSize: 13 }}>
              No saved messages yet. Star a message to save it here.
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} style={{
                padding: 10, borderBottom: '1px solid var(--border)',
                display: 'flex', gap: 8,
              }}>
                <span style={{ fontSize: 14, flexShrink: 0, marginTop: 2 }}>
                  {msg.agent_emoji ?? (msg.role === 'user' ? '👤' : '🤖')}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{msg.agent_name ?? (msg.role === 'user' ? 'You' : 'Assistant')}</span>
                    <span>{msg.session_title ?? 'Chat'}</span>
                  </div>
                  <div style={{
                    fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5,
                    overflow: 'hidden', display: '-webkit-box',
                    WebkitLineClamp: 4, WebkitBoxOrient: 'vertical',
                  }}>
                    {msg.content?.slice(0, 300)}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{new Date(msg.starred_at).toLocaleString()}</span>
                    <button onClick={() => void unstar(msg.id)} style={{
                      background: 'none', border: 'none', fontSize: 11,
                      color: 'var(--text-muted)', cursor: 'pointer', padding: 0,
                    }}>Remove ⭐</button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
