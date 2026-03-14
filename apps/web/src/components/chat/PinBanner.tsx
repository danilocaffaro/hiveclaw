'use client';

import { useState, useEffect, useCallback } from 'react';

interface PinnedMessage {
  id: string;
  role: string;
  content: string;
  created_at: string;
  agent_name?: string;
  agent_emoji?: string;
  pinned_at: string;
}

/**
 * N-2: Pin banner — shows pinned messages at top of chat area.
 * Collapsible: shows latest pin with expand toggle for all.
 */
export default function PinBanner({ sessionId }: { sessionId: string | null }) {
  const [pins, setPins] = useState<PinnedMessage[]>([]);
  const [expanded, setExpanded] = useState(false);

  const fetchPins = useCallback(async () => {
    if (!sessionId) { setPins([]); return; }
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/pins`);
      if (!res.ok) return;
      const json = await res.json() as { data: PinnedMessage[] };
      setPins(json.data ?? []);
    } catch { /* ignore */ }
  }, [sessionId]);

  useEffect(() => { void fetchPins(); }, [fetchPins]);

  // Re-fetch when pin action happens (listen for custom event)
  useEffect(() => {
    const handler = () => void fetchPins();
    window.addEventListener('hiveclaw:pin-changed', handler);
    return () => window.removeEventListener('hiveclaw:pin-changed', handler);
  }, [fetchPins]);

  if (pins.length === 0) return null;

  const latest = pins[0];
  const displayPins = expanded ? pins : [latest];

  return (
    <div style={{
      borderBottom: '1px solid var(--border)',
      background: 'var(--surface-hover)',
      padding: '6px 16px',
      fontSize: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 14 }}>📌</span>
          <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>{pins.length} pinned</span>
        </div>
        {pins.length > 1 && (
          <button onClick={() => setExpanded(!expanded)} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 11, color: 'var(--coral)', padding: '2px 6px',
          }}>
            {expanded ? '▲ Collapse' : '▼ Show all'}
          </button>
        )}
      </div>
      <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {displayPins.map((pin) => (
          <div key={pin.id} style={{
            display: 'flex', gap: 6, alignItems: 'baseline',
            color: 'var(--text-secondary)', lineHeight: 1.4,
          }}>
            <span style={{ fontSize: 11, flexShrink: 0 }}>
              {pin.agent_emoji ?? (pin.role === 'user' ? '👤' : '🤖')}
            </span>
            <span style={{
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              fontSize: 12,
            }}>
              {pin.content?.slice(0, 120)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
