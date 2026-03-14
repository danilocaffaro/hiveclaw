'use client';

import { useEffect, useState } from 'react';
import LandingPage from '@/components/LandingPage';
import PublicChat from '@/components/PublicChat';
import Sidebar from '@/components/sidebar';
import ChatArea from '@/components/ChatArea';
import RightPanel from '@/components/RightPanel';
import CommandPalette from '@/components/CommandPalette';
import SettingsPanel from '@/components/SettingsPanel';
import { CredentialModal } from '@/components/CredentialModal';
import { SetupWizard } from '@/components/SetupWizard';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import MobileApp from '@/components/MobileApp';
import { useUIStore } from '@/stores/ui-store';
import { useSessionStore } from '@/stores/session-store';
import { useAgentStore } from '@/stores/agent-store';
import { useSquadStore } from '@/stores/squad-store';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useGlobalSSE } from '@/hooks/useGlobalSSE';
import { PWAProvider } from '@/components/PWAProvider';

// ─── ThemeSync ─────────────────────────────────────────────────────────────────
function ThemeSync() {
  const theme = useUIStore((s) => s.theme);
  useEffect(() => {
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);
  return null;
}

// ─── ConnectionStatus ─────────────────────────────────────────────────────────
function ConnectionStatus() {
  const [status, setStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/healthz', {
          signal: AbortSignal.timeout(3000),
          cache: 'no-store',
        });
        setStatus(res.ok ? 'connected' : 'disconnected');
      } catch {
        setStatus('disconnected');
      }
    };
    void check();
    const interval = setInterval(() => void check(), 30_000);
    return () => clearInterval(interval);
  }, []);

  // Hidden when connected — only show when there's a problem
  if (status === 'connected') return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 9998,
        padding: '8px 16px',
        borderRadius: 8,
        background:
          status === 'disconnected' ? 'var(--coral-subtle)' : 'var(--surface)',
        border: `1px solid ${
          status === 'disconnected' ? 'rgba(255,107,107,0.3)' : 'var(--border)'
        }`,
        color:
          status === 'disconnected' ? 'var(--coral)' : 'var(--text-muted)',
        fontSize: 13,
        fontWeight: 500,
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: 'var(--font-sans)',
        userSelect: 'none',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background:
            status === 'disconnected' ? 'var(--coral)' : 'var(--yellow)',
          animation:
            status === 'checking'
              ? 'pulse 1.5s ease-in-out infinite'
              : undefined,
          flexShrink: 0,
        }}
      />
      {status === 'disconnected' ? 'Server disconnected' : 'Checking connection…'}
    </div>
  );
}

// ─── HomePage ─────────────────────────────────────────────────────────────────
export default function HomePage() {
  // B054: Public chat detection — #/chat/:token → standalone guest chat
  const [publicToken, setPublicToken] = useState<string | null>(null);
  useEffect(() => {
    const hash = window.location.hash;
    const match = hash.match(/^#\/chat\/([a-zA-Z0-9_-]+)/);
    if (match) setPublicToken(match[1]);

    const onHashChange = () => {
      const m = window.location.hash.match(/^#\/chat\/([a-zA-Z0-9_-]+)/);
      setPublicToken(m ? m[1] : null);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // K-3: Global SSE for unread badges
  useGlobalSSE();

  if (publicToken) return <PublicChat token={publicToken} />;

  const {
    sidebarCollapsed,
    toggleSidebar,
    toggleRightPanel,
    setSettingsOpen,
    mobileSidebarOpen,
    mobileRightPanelOpen,
    setMobileSidebarOpen,
    setMobileRightPanelOpen,
    interfaceMode,
    toggleInterfaceMode,
    setInterfaceMode,
  } = useUIStore();
  const isMobile = useIsMobile();
  const [needsSetup, setNeedsSetup] = useState(false);
  const [showLanding, setShowLanding] = useState(false);

  // Show landing page when ?landing=true or #landing is in URL
  useEffect(() => {
    if (
      window.location.hash === '#landing' ||
      window.location.search.includes('landing=true')
    ) {
      setShowLanding(true);
    }
  }, []);

  // Auto-detect mobile on first visit: force 'lite' if no localStorage override
  useEffect(() => {
    if (isMobile && typeof window !== 'undefined') {
      const hasOverride = localStorage.getItem('hiveclaw-interface-mode');
      if (!hasOverride) {
        setInterfaceMode('lite');
      }
    }
  }, [isMobile, setInterfaceMode]);

  // Check if first-run setup is needed (with retry for slow server start)
  const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';
  const [setupChecked, setSetupChecked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const check = async (retries = 5): Promise<void> => {
      try {
        const res = await fetch(`${API_BASE}/setup/status`, {
          signal: AbortSignal.timeout(5000),
          cache: 'no-store',
        });
        if (cancelled) return;
        if (res.ok) {
          const json = await res.json() as { data: { needsSetup: boolean } };
          if (json.data.needsSetup) setNeedsSetup(true);
          setSetupChecked(true);
        }
      } catch {
        if (cancelled) return;
        if (retries > 0) {
          await new Promise((r) => setTimeout(r, 2000));
          return check(retries - 1);
        }
        setSetupChecked(true); // Give up — show app
      }
    };
    void check();
    return () => { cancelled = true; };
  }, [API_BASE]);

  // Initialise stores on mount
  useEffect(() => {
    void useSessionStore.getState().fetchSessions();
    void useAgentStore.getState().fetchAgents();
    void useSquadStore.getState().fetchSquads();
  }, []);

  // ── Global keyboard shortcuts ──────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      // ⌘N — new session
      if (e.key === 'n') {
        e.preventDefault();
        void useSessionStore.getState().createSession();
        return;
      }
      // ⌘B — toggle sidebar (desktop only)
      if (e.key === 'b') {
        e.preventDefault();
        if (!isMobile) toggleSidebar();
        return;
      }
      // ⌘\ — toggle right panel
      if (e.key === '\\') {
        e.preventDefault();
        toggleRightPanel();
        return;
      }
      // ⌘, — open settings  (⌘K palette also handles this, kept in sync)
      if (e.key === ',') {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }
      // ⌘Shift+L — toggle interface mode (lite ↔ pro)
      if (e.shiftKey && e.key === 'l') {
        e.preventDefault();
        toggleInterfaceMode();
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isMobile, toggleSidebar, toggleRightPanel, setSettingsOpen, toggleInterfaceMode]);

  // Close mobile overlays on resize to desktop
  useEffect(() => {
    if (!isMobile) {
      setMobileSidebarOpen(false);
      setMobileRightPanelOpen(false);
    }
  }, [isMobile, setMobileSidebarOpen, setMobileRightPanelOpen]);

  // ── Loading gate — prevent FOUC (flash of main app before wizard) ─────────
  if (!setupChecked) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100dvh', background: 'var(--bg, #0D1117)', color: 'var(--text-muted, #8b949e)',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚡</div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Loading…</div>
        </div>
      </div>
    );
  }

  // ── Landing page gate ──────────────────────────────────────────────────────
  if (showLanding) {
    return (
      <LandingPage
        onLaunch={() => {
          setShowLanding(false);
          window.location.hash = '';
        }}
      />
    );
  }

  // ── Mobile: WhatsApp-style stack navigation ──────────────────────────────
  if (isMobile) {
    return (
      <>
        <ThemeSync />
        {needsSetup ? (
          <SetupWizard onComplete={(agentId) => {
            setNeedsSetup(false);
            // Refresh stores and auto-create session with the configured agent
            void useAgentStore.getState().fetchAgents().then(() => {
              void useSessionStore.getState().fetchSessions();
              if (agentId) {
                void useSessionStore.getState().createSession({ title: 'Welcome', agent_id: agentId });
              }
            });
          }} />
        ) : (
          <ErrorBoundary>
            <MobileApp />
          </ErrorBoundary>
        )}
        <SettingsPanel />
      </>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        height: '100dvh',
        overflow: 'hidden',
        background: 'var(--bg)',
        color: 'var(--text)',
        position: 'relative',
      }}
    >
      <ThemeSync />

      {/* ── Desktop Sidebar (hidden on mobile) ── */}
      {!isMobile && (
        <div
          style={{
            flexShrink: 0,
            width: sidebarCollapsed ? 56 : 280,
            transition: 'width 200ms ease-in-out',
          }}
        >
          <ErrorBoundary><Sidebar /></ErrorBoundary>
        </div>
      )}

      {/* ── Mobile Sidebar Overlay ── */}
      {isMobile && mobileSidebarOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
          }}
        >
          {/* Backdrop */}
          <div
            onClick={() => setMobileSidebarOpen(false)}
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(2px)',
              WebkitBackdropFilter: 'blur(2px)',
            }}
          />
          {/* Sidebar panel — slides in from left */}
          <div
            style={{
              position: 'relative',
              width: 280,
              height: '100%',
              zIndex: 51,
              animation: 'slideInLeft 220ms cubic-bezier(0.4,0,0.2,1)',
            }}
          >
            <ErrorBoundary><Sidebar /></ErrorBoundary>
          </div>
        </div>
      )}

      {/* ── Main chat area ── */}
      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <ErrorBoundary><ChatArea /></ErrorBoundary>
      </main>

      {/* ── Desktop Right Panel ── */}
      {!isMobile && interfaceMode === 'pro' && <ErrorBoundary><RightPanel /></ErrorBoundary>}

      {/* ── Mobile Right Panel Overlay ── */}
      {isMobile && mobileRightPanelOpen && interfaceMode === 'pro' && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
          }}
        >
          {/* Backdrop */}
          <div
            onClick={() => setMobileRightPanelOpen(false)}
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(2px)',
              WebkitBackdropFilter: 'blur(2px)',
            }}
          />
          {/* Right panel — slides in from right */}
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              width: 'min(340px, 92vw)',
              zIndex: 51,
              animation: 'slideInRight 220ms cubic-bezier(0.4,0,0.2,1)',
            }}
          >
            <RightPanel mobileOverlay />
          </div>
        </div>
      )}

      {/* ── Overlays (position: fixed, z-index managed internally) ── */}

      {/* Command Palette (⌘K) */}
      <CommandPalette />

      {/* Settings Panel (⌘,) */}
      <SettingsPanel />

      {/* Connection Status toast — only visible when disconnected */}
      <ConnectionStatus />

      {/* First-run Setup Wizard — full-screen overlay */}
      {needsSetup && <SetupWizard onComplete={(agentId) => {
        setNeedsSetup(false);
        // Refresh agents FIRST, then sessions, then create welcome session
        void useAgentStore.getState().fetchAgents().then(() => {
          void useSessionStore.getState().fetchSessions().then(() => {
            void useSessionStore.getState().createSession(agentId ? { agent_id: agentId } : undefined);
          });
        });
      }} />}

      {/* Secure Credential Modal — polls for pending requests, fixed overlay */}
      <CredentialModal />

      {/* PWA — service worker registration, install prompt, offline banner */}
      <PWAProvider />

      {/* Slide animations */}
      <style>{`
        @keyframes slideInLeft {
          from { transform: translateX(-100%); }
          to   { transform: translateX(0); }
        }
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
