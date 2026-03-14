'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';

/**
 * F11 — Message search overlay.
 * Full-text search across all messages using FTS5 backend.
 */

interface SearchResult {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  createdAt: string;
  agentName: string | null;
  agentEmoji: string | null;
  senderType: string | null;
  snippet: string;
}

interface SearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (sessionId: string, messageId: string) => void;
  activeSessionId?: string;
}

export function SearchOverlay({ isOpen, onClose, onNavigate, activeSessionId }: SearchOverlayProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchScope, setSearchScope] = useState<'session' | 'all'>('session');
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setQuery('');
      setResults([]);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }
  }, [isOpen, onClose]);

  const doSearch = useCallback(
    (q: string) => {
      if (q.trim().length < 2) {
        setResults([]);
        return;
      }

      setLoading(true);
      const params = new URLSearchParams({ q: q.trim(), limit: '30' });
      if (searchScope === 'session' && activeSessionId) {
        params.set('session_id', activeSessionId);
      }

      fetch(`/api/search/messages?${params}`)
        .then((r) => r.json())
        .then((json) => {
          setResults(json.data ?? []);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    },
    [searchScope, activeSessionId],
  );

  const handleInput = (val: string) => {
    setQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 300);
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        justifyContent: 'center',
        paddingTop: 60,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: '90%',
          maxWidth: 560,
          maxHeight: '70vh',
          background: 'var(--bg)',
          borderRadius: 16,
          border: '1px solid var(--border)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Search input */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18, color: 'var(--text-muted)' }}>🔍</span>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => handleInput(e.target.value)}
              placeholder="Search messages..."
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                fontSize: 15,
                color: 'var(--text)',
                padding: '6px 0',
              }}
            />
            {loading && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>⏳</span>}
          </div>
          {/* Scope toggle */}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {(['session', 'all'] as const).map((scope) => (
              <button
                key={scope}
                onClick={() => setSearchScope(scope)}
                style={{
                  padding: '3px 10px',
                  borderRadius: 12,
                  fontSize: 11,
                  fontWeight: 600,
                  border: '1px solid var(--border)',
                  background: searchScope === scope ? 'var(--coral-subtle)' : 'transparent',
                  color: searchScope === scope ? 'var(--coral)' : 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                {scope === 'session' ? 'This chat' : 'All chats'}
              </button>
            ))}
          </div>
        </div>

        {/* Results */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {results.length === 0 && query.length >= 2 && !loading && (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 13 }}>
              No results found
            </div>
          )}
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                onNavigate(r.sessionId, r.id);
                onClose();
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '10px 12px',
                borderRadius: 8,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: 'var(--text)',
                marginBottom: 2,
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{ fontSize: 12 }}>
                  {r.role === 'user' ? '👤' : r.agentEmoji ?? '🤖'}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>
                  {r.role === 'user' ? 'You' : r.agentName ?? 'Assistant'}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                  {new Date(r.createdAt).toLocaleDateString('en-US', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              <div
                style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4 }}
                dangerouslySetInnerHTML={{ __html: r.snippet }}
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
