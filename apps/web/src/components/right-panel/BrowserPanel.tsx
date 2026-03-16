'use client';

import { useState } from 'react';
import { useRSPStore, selectActiveAgentId, selectActiveSquadId } from '@/stores/rsp-store';
import { useAgentStore } from '@/stores/agent-store';

interface BrowserTab {
  id: string;
  url: string;
  title: string;
  favicon: string;
  imageUrl: string | null;
  loading: boolean;
}

let browserTabCounter = 0;
function newTabId() { return `tab-${++browserTabCounter}`; }

function BrowserPanel() {
  const [tabs, setTabs] = useState<BrowserTab[]>([
    { id: newTabId(), url: '', title: 'New Tab', favicon: '🌐', imageUrl: null, loading: false },
  ]);
  const [activeTabId, setActiveTabId] = useState(tabs[0].id);
  const [inputUrl, setInputUrl] = useState('https://');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // P-4: RSP context
  const activeAgentId = useRSPStore(selectActiveAgentId);
  const activeSquadId = useRSPStore(selectActiveSquadId);
  const agents = useAgentStore(s => s.agents);
  const activeAgent = agents.find(a => a.id === activeAgentId);
  const agentLabel = activeAgent
    ? `${activeAgent.emoji ?? '🤖'} ${activeAgent.name}`
    : activeSquadId ? '👥 Squad workspace' : null;

  const activeTab = tabs.find(t => t.id === activeTabId) ?? tabs[0];

  const updateTab = (id: string, updates: Partial<BrowserTab>) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const navigate = async (targetUrl: string, tabId?: string) => {
    const tid = tabId ?? activeTabId;
    updateTab(tid, { loading: true, url: targetUrl });
    setInputUrl(targetUrl);

    // Add to history
    const newHistory = [...history.slice(0, historyIndex + 1), targetUrl];
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);

    try {
      const res = await fetch('/browser/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      });
      if (res.ok) {
        const data = await res.json();
        const d = data.data ?? {};
        // Backend returns screenshotBase64 (Playwright) or imageUrl (thum.io fallback)
        let imgUrl = d.imageUrl ?? null;
        if (!imgUrl && d.screenshotBase64) {
          imgUrl = `data:${d.mimeType ?? 'image/jpeg'};base64,${d.screenshotBase64}`;
        }
        let title = d.title || targetUrl;
        try { if (!d.title) title = new URL(targetUrl).hostname; } catch { /* keep */ }
        updateTab(tid, { loading: false, url: d.url || targetUrl, imageUrl: imgUrl, title, favicon: '🌐' });
        return;
      }
    } catch {
      // silent fail — browser unavailable
    }
    updateTab(tid, { loading: false });
  };

  const addTab = () => {
    const id = newTabId();
    const tab: BrowserTab = { id, url: '', title: 'New Tab', favicon: '🌐', imageUrl: null, loading: false };
    setTabs(prev => [...prev, tab]);
    setActiveTabId(id);
    setInputUrl('https://');
  };

  const closeTab = (id: string) => {
    if (tabs.length <= 1) return; // Keep at least one tab
    const idx = tabs.findIndex(t => t.id === id);
    const newTabs = tabs.filter(t => t.id !== id);
    setTabs(newTabs);
    if (activeTabId === id) {
      // Switch to adjacent tab
      const newIdx = Math.min(idx, newTabs.length - 1);
      setActiveTabId(newTabs[newIdx].id);
      setInputUrl(newTabs[newIdx].url || 'https://');
    }
  };

  const switchTab = (id: string) => {
    setActiveTabId(id);
    const tab = tabs.find(t => t.id === id);
    if (tab) setInputUrl(tab.url || 'https://');
  };

  const goBack = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      navigate(history[newIndex]);
    }
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      navigate(history[newIndex]);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* P-4: Agent context header */}
      {agentLabel && (
        <div style={{
          padding: '4px 10px',
          fontSize: 11,
          color: 'var(--text-muted)',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ opacity: 0.6 }}>Browser:</span>
          <span style={{ color: 'var(--coral)', fontWeight: 600 }}>{agentLabel}</span>
        </div>
      )}
      {/* Tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0,
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)', flexShrink: 0,
        overflowX: 'auto', minHeight: 32,
      }}>
        {tabs.map(tab => (
          <div key={tab.id} onClick={() => switchTab(tab.id)} style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 8px', minWidth: 80, maxWidth: 160,
            cursor: 'pointer',
            background: tab.id === activeTabId ? 'var(--bg)' : 'transparent',
            borderRight: '1px solid var(--border)',
            borderBottom: tab.id === activeTabId ? '2px solid var(--blue)' : '2px solid transparent',
            position: 'relative',
          }}>
            <span style={{ fontSize: 12, flexShrink: 0 }}>{tab.favicon}</span>
            <span style={{
              fontSize: 10, color: tab.id === activeTabId ? 'var(--text)' : 'var(--text-muted)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
              flex: 1,
            }}>
              {tab.loading ? 'Loading…' : tab.title}
            </span>
            {tabs.length > 1 && (
              <button onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }} style={{
                width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, color: 'var(--text-muted)', background: 'none', border: 'none',
                cursor: 'pointer', borderRadius: 2, flexShrink: 0, lineHeight: 1, padding: 0,
              }}>✕</button>
            )}
          </div>
        ))}
        <button onClick={addTab} title="New tab" aria-label="New tab" style={{
          padding: '4px 8px', background: 'none', border: 'none',
          color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14,
          flexShrink: 0,
        }}>+</button>
      </div>

      {/* Navigation Bar */}
      <div style={{
        display: 'flex', gap: 6, padding: '8px 12px',
        borderBottom: '1px solid var(--border)', alignItems: 'center',
      }}>
        <button onClick={goBack} disabled={historyIndex <= 0} style={{
          padding: '4px 8px', borderRadius: 6,
          background: 'var(--surface-hover)', border: '1px solid var(--border)',
          color: historyIndex > 0 ? 'var(--text-secondary)' : 'var(--text-muted)',
          cursor: historyIndex > 0 ? 'pointer' : 'default', fontSize: 14,
          opacity: historyIndex > 0 ? 1 : 0.4,
        }}>←</button>
        <button onClick={goForward} disabled={historyIndex >= history.length - 1} style={{
          padding: '4px 8px', borderRadius: 6,
          background: 'var(--surface-hover)', border: '1px solid var(--border)',
          color: historyIndex < history.length - 1 ? 'var(--text-secondary)' : 'var(--text-muted)',
          cursor: historyIndex < history.length - 1 ? 'pointer' : 'default', fontSize: 14,
          opacity: historyIndex < history.length - 1 ? 1 : 0.4,
        }}>→</button>
        <input
          value={inputUrl}
          onChange={e => setInputUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && navigate(inputUrl)}
          placeholder="https://example.com"
          style={{
            flex: 1, padding: '6px 10px', borderRadius: 6,
            background: 'var(--bg)', border: '1px solid var(--border)',
            color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)',
            outline: 'none',
          }}
        />
        <button onClick={() => navigate(inputUrl)} style={{
          padding: '6px 12px', borderRadius: 6,
          background: 'var(--green-subtle)', border: '1px solid rgba(63,185,80,0.3)',
          color: 'var(--green)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
        }}>Navigate</button>
      </div>

      {/* Content Area — iframe first, screenshot fallback */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {activeTab.loading && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            background: 'rgba(13,17,23,0.8)', zIndex: 10,
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>🌐</div>
              <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Navigating…</span>
            </div>
          </div>
        )}
        {activeTab.url && activeTab.url.startsWith('https://') && !activeTab.imageUrl ? (
          // Iframe mode — sandboxed, interactive
          <iframe
            key={activeTab.url}
            src={activeTab.url}
            title={activeTab.title}
            sandbox="allow-scripts allow-forms allow-popups"
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
            onLoad={() => updateTab(activeTab.id, { loading: false })}
            onError={() => {
              // Iframe blocked → fall back to screenshot
              navigate(activeTab.url);
            }}
          />
        ) : activeTab.imageUrl ? (
          // Screenshot fallback
          <div style={{ overflow: 'auto', height: '100%' }}>
            <img
              src={activeTab.imageUrl}
              alt="Browser screenshot"
              style={{ width: '100%', display: 'block' }}
            />
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔭</div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 4 }}>
              Agent Browser
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 16 }}>
              Navigate to any HTTPS URL — loads interactively.<br />
              Cross-origin blocked sites fall back to screenshot.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, justifyContent: 'center' }}>
              {['https://github.com', 'https://wikipedia.org', 'https://hacker-news.firebaseio.com'].map(u => (
                <button key={u} onClick={() => { setInputUrl(u); navigate(u); }} style={{
                  padding: '4px 10px', borderRadius: 6,
                  background: 'var(--surface-hover)', border: '1px solid var(--border)',
                  color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer',
                  fontFamily: 'var(--font-mono)',
                }}>{u}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sprint Panel ─────────────────────────────────────────────────────────────

export default BrowserPanel;
