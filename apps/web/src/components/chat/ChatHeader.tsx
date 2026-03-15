'use client';

import React, { useState, useEffect } from 'react';
import { useSessionStore } from '@/stores/session-store';
import { useUIStore } from '@/stores/ui-store';
import type { Squad } from '@/stores/squad-store';
import { useSquadStore } from '@/stores/squad-store';
import type { Agent } from '@/stores/agent-store';
import { useAgentStore } from '@/stores/agent-store';
import { useIsMobile } from '@/hooks/useIsMobile';

// ─── Squad Chat Header ──────────────────────────────────────────────────────────

export function SquadChatHeader({ squad, agents, onSquadInfoClick }: { squad: Squad; agents: Agent[]; onSquadInfoClick?: () => void }) {
  const { isStreaming } = useSessionStore();
  const { toggleRightPanel, toggleSettings, setMobileSidebarOpen, setMobileRightPanelOpen, interfaceMode } = useUIStore();
  const isMobile = useIsMobile();

  return (
    <div style={{
      padding: isMobile ? '10px 12px' : '12px 20px',
      borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      flexShrink: 0, background: 'var(--surface)',
      paddingTop: isMobile ? 'max(10px, calc(10px + env(safe-area-inset-top)))' : '12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Hamburger on mobile */}
        {isMobile && (
          <button onClick={() => setMobileSidebarOpen(true)} style={{
            width: 32, height: 32, borderRadius: 'var(--radius-md)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, color: 'var(--text-secondary)',
            background: 'transparent', border: 'none', cursor: 'pointer',
          }}>
            ☰
          </button>
        )}

        {/* Squad emoji in colored square — clickable to open info panel */}
        <div
          onClick={onSquadInfoClick}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            cursor: onSquadInfoClick ? 'pointer' : 'default',
          }}
        >
        <div style={{
          width: 34, height: 34, borderRadius: 10,
          background: 'var(--purple-subtle)',
          border: '1px solid rgba(188,140,255,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, flexShrink: 0,
        }}>
          {squad.emoji || '👥'}
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{squad.name}</span>
            <span style={{
              padding: '1px 8px', borderRadius: 'var(--radius-sm)',
              background: 'var(--purple-subtle)', color: 'var(--purple)',
              fontSize: 11, fontWeight: 500
            }}>Squad</span>
            <span style={{
              padding: '1px 8px', borderRadius: 'var(--radius-sm)',
              background: 'var(--blue-subtle)', color: 'var(--blue)',
              fontSize: 11, fontWeight: 500
            }}>{squad.routingStrategy || 'auto'}</span>
            {isStreaming && (
              <span style={{
                padding: '1px 8px', borderRadius: 'var(--radius-sm)',
                background: 'var(--green-subtle)', color: 'var(--green)',
                fontSize: 11, fontWeight: 500
              }}>● Streaming</span>
            )}
          </div>

          {/* Mini avatar row of members */}
          <div style={{ display: 'flex', gap: 4, marginTop: 3, alignItems: 'center' }}>
            {(squad.agentIds ?? []).slice(0, 5).map((agentId) => {
              const agent = agents.find((a) => a.id === agentId);
              return (
                <div key={agentId} title={agent?.name ?? agentId} style={{
                  width: 18, height: 18, borderRadius: '50%',
                  background: 'var(--surface-hover)', border: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, flexShrink: 0,
                }}>
                  {agent?.emoji ?? '🤖'}
                </div>
              );
            })}
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {(squad.agentIds ?? []).length} agents
            </span>
          </div>
        </div>
        </div>
      </div>

      {/* Settings + right panel buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button onClick={toggleSettings} title="Settings (⌘,)" aria-label="Settings (⌘,)" style={{
          width: 32, height: 32, borderRadius: 'var(--radius-md)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 15, color: 'var(--text-secondary)',
          background: 'transparent', border: 'none', cursor: 'pointer',
        }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          ⚙️
        </button>
        {interfaceMode === 'pro' && (
          <button onClick={() => isMobile ? setMobileRightPanelOpen(true) : toggleRightPanel()} title="Toggle right panel" aria-label="Toggle right panel" style={{
            width: 32, height: 32, borderRadius: 'var(--radius-md)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 15, color: 'var(--text-secondary)',
            background: 'transparent', border: 'none', cursor: 'pointer',
          }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            ▣
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Chat Header ────────────────────────────────────────────────────────────────

export function ChatHeader({ onAgentInfoClick }: { onAgentInfoClick?: () => void }) {
  const { activeSessionId, activeSquadId, isStreaming, sessions } = useSessionStore();
  const { toggleRightPanel, toggleSettings, setMobileSidebarOpen, setMobileRightPanelOpen, interfaceMode } = useUIStore();
  const squads = useSquadStore((s) => s.squads);
  const agents = useAgentStore((s) => s.agents);
  const isMobile = useIsMobile();

  // Token usage state
  const [tokenUsage, setTokenUsage] = useState<{ input: number; output: number; total: number } | null>(null);

  // Fetch session usage when active session changes
  useEffect(() => {
    if (!activeSessionId) { setTokenUsage(null); return; }
    let cancelled = false;
    const fetchUsage = async () => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(activeSessionId)}/usage`);
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        const u = json.data?.sessions?.[0]?.usage ?? json.data?.usage ?? json.data ?? {};
        const input = u.input ?? u.tokensIn ?? 0;
        const output = u.output ?? u.tokensOut ?? 0;
        const total = u.totalTokens ?? (input + output);
        if (total > 0) setTokenUsage({ input, output, total });
        else setTokenUsage(null);
      } catch { /* ignore */ }
    };
    fetchUsage();
    // Refresh every 30s while streaming
    const interval = isStreaming ? setInterval(fetchUsage, 10000) : undefined;
    return () => { cancelled = true; if (interval) clearInterval(interval); };
  }, [activeSessionId, isStreaming]);

  // If squad session, show squad header
  if (activeSquadId) {
    const squad = squads.find((s) => s.id === activeSquadId);
    if (squad) {
      return <SquadChatHeader squad={squad} agents={agents} onSquadInfoClick={onAgentInfoClick} />;
    }
  }

  // Resolve agent for active session
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const sessionAgentId = activeSession?.agent_id;
  const agent = sessionAgentId ? agents.find((a) => a.id === sessionAgentId) : null;
  const agentName = agent?.name ?? 'Assistant';
  const agentEmoji = agent?.emoji ?? '🤖';
  const agentDescription = agent?.role || 'Personal AI assistant';

  // If squad session, show squad header
  if (activeSquadId) {
    const squad = squads.find((s) => s.id === activeSquadId);
    if (squad) {
      return <SquadChatHeader squad={squad} agents={agents} onSquadInfoClick={onAgentInfoClick} />;
    }
  }

  return (
    <div style={{
      padding: isMobile ? '10px 12px' : '12px 20px', borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      flexShrink: 0, background: 'var(--surface)',
      paddingTop: isMobile ? 'max(10px, calc(10px + env(safe-area-inset-top)))' : '12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Hamburger on mobile */}
        {isMobile && (
          <button onClick={() => setMobileSidebarOpen(true)} style={{
            width: 32, height: 32, borderRadius: 'var(--radius-md)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, color: 'var(--text-secondary)',
            background: 'transparent', border: 'none', cursor: 'pointer',
          }}>
            ☰
          </button>
        )}
        {/* Agent avatar — K-5: clickable to open info panel */}
        <div
          onClick={onAgentInfoClick}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            cursor: onAgentInfoClick ? 'pointer' : 'default',
          }}
        >
          <div style={{
            width: 34, height: 34, borderRadius: 10,
            background: 'var(--coral-subtle)',
            border: '1px solid rgba(255,107,107,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16,
          }}>
            {agentEmoji}
          </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{agentName}</span>
            {isStreaming && (
              <span style={{
                padding: '1px 8px', borderRadius: 'var(--radius-sm)',
                background: 'var(--green-subtle)', color: 'var(--green)',
                fontSize: 11, fontWeight: 500
              }}>● Working</span>
            )}
          </div>
          {!isMobile && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
              {agentDescription}
            </div>
          )}
        </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* Token counter pill */}
        {tokenUsage && !isMobile && (
          <div title={`Input: ${tokenUsage.input.toLocaleString()} · Output: ${tokenUsage.output.toLocaleString()}`} style={{
            padding: '3px 10px', borderRadius: 'var(--radius-sm)',
            background: 'var(--surface-hover)', border: '1px solid var(--border)',
            fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
            display: 'flex', alignItems: 'center', gap: 6,
            whiteSpace: 'nowrap',
          }}>
            <span>🪙</span>
            <span>{tokenUsage.total >= 1_000_000 ? `${(tokenUsage.total/1_000_000).toFixed(1)}M` : tokenUsage.total >= 1_000 ? `${(tokenUsage.total/1_000).toFixed(1)}K` : String(tokenUsage.total)}</span>
          </div>
        )}
        <button onClick={toggleSettings} title="Settings (⌘,)" aria-label="Settings (⌘,)" style={{
          width: 32, height: 32, borderRadius: 'var(--radius-md)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 15, color: 'var(--text-secondary)',
          background: 'transparent', border: 'none', cursor: 'pointer',
        }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          ⚙️
        </button>
        {interfaceMode === 'pro' && (
          <button onClick={() => isMobile ? setMobileRightPanelOpen(true) : toggleRightPanel()} title="Toggle right panel" aria-label="Toggle right panel" style={{
            width: 32, height: 32, borderRadius: 'var(--radius-md)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 15, color: 'var(--text-secondary)',
            background: 'transparent', border: 'none', cursor: 'pointer',
          }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            ▣
          </button>
        )}
      </div>
    </div>
  );
}

