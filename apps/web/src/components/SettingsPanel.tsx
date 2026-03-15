'use client';

import { useEffect, useCallback, lazy, Suspense } from 'react';
import { useUIStore, type SettingsTab } from '@/stores/ui-store';
import { MarketplacePanel } from './MarketplacePanel';
import { ErrorBoundary } from './ErrorBoundary';

// Lazy-loaded settings tabs (split for bundle performance)
const GeneralTab = lazy(() => import('./settings/GeneralTab'));
const AppearanceTab = lazy(() => import('./settings/AppearanceTab'));
const ProvidersTab = lazy(() => import('./settings/ProvidersTab'));
const ModelsTab = lazy(() => import('./settings/ModelsTab'));
const MCPTab = lazy(() => import('./settings/MCPTab'));
const KeybindingsTab = lazy(() => import('./settings/KeybindingsTab'));
const AgentsTab = lazy(() => import('./settings/AgentsTab'));
const SecurityTab = lazy(() => import('./settings/SecurityTab'));
const DataStorageTab = lazy(() => import('./settings/DataStorageTab'));
const IntegrationsTab = lazy(() => import('./settings/IntegrationsTab'));
const VaultTab = lazy(() => import('./settings/VaultTab'));
const AdvancedTab = lazy(() => import('./settings/AdvancedTab'));
const DeploysTab = lazy(() => import('./settings/DeploysTab'));
const UsersTab = lazy(() => import('./settings/UsersTab'));

// ─── Nav items ──────────────────────────────────────────────────────────────────

const NAV_ITEMS: { key: SettingsTab; icon: string; label: string }[] = [
  { key: 'general', icon: '⚙️', label: 'General' },
  { key: 'appearance', icon: '🎨', label: 'Appearance' },
  { key: 'providers', icon: '🔌', label: 'Providers' },
  { key: 'models', icon: '🤖', label: 'Models' },
  { key: 'agents', icon: '🧑💼', label: 'Agents' },
  { key: 'mcp', icon: '🔗', label: 'MCP Servers' },
  { key: 'skills', icon: '⚡', label: 'Skills' },
  { key: 'keybindings', icon: '⌨️', label: 'Keybindings' },
  { key: 'security', icon: '🔒', label: 'Security' },
  { key: 'users', icon: '👥', label: 'Users' },
  { key: 'data-storage', icon: '💾', label: 'Data & Storage' },
  { key: 'integrations', icon: '🔗', label: 'Integrations' },
  { key: 'vault', icon: '🔐', label: 'Vault' },
  { key: 'advanced', icon: '🛠️', label: 'Advanced' },
  { key: 'deploys', icon: '📊', label: 'System' },
];

export default function SettingsPanel() {
  const { settingsOpen, settingsTab, setSettingsOpen, setSettingsTab } = useUIStore();

  // Escape key to close
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && settingsOpen) {
        setSettingsOpen(false);
      }
    },
    [settingsOpen, setSettingsOpen],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!settingsOpen) return null;

  const renderContent = () => {
    switch (settingsTab) {
      case 'general':
        return <GeneralTab />;
      case 'appearance':
        return <AppearanceTab />;
      case 'providers':
        return <ProvidersTab />;
      case 'models':
        return <ModelsTab />;
      case 'agents':
        return (
          <ErrorBoundary fallback={<div style={{padding:20,color:'var(--coral)'}}>⚠️ Error loading Agents tab. Try refreshing.</div>}>
            <AgentsTab />
          </ErrorBoundary>
        );
      case 'mcp':
        return <MCPTab />;
      case 'skills':
        return <MarketplacePanel />;
      case 'keybindings':
        return <KeybindingsTab />;
      case 'security':
        return <SecurityTab />;
      case 'users':
        return <UsersTab />;
      case 'data-storage':
        return <DataStorageTab />;
      case 'integrations':
        return <IntegrationsTab />;
      case 'vault':
        return <VaultTab />;
      case 'advanced':
        return <AdvancedTab />;
      case 'deploys':
        return <DeploysTab />;
      default:
        return <GeneralTab />;
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={() => setSettingsOpen(false)}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          zIndex: 999,
          animation: 'fadeIn 150ms ease',
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1000,
          display: 'flex',
          alignItems: 'stretch',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            margin: 'auto',
            width: '100%',
            maxWidth: 860,
            height: '85vh',
            maxHeight: 680,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-xl)',
            boxShadow: '0 25px 80px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            pointerEvents: 'auto',
            animation: 'slideUp 150ms ease',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Top bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 20px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--glass-bg)',
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 16 }}>⚙️</span>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', flex: 1 }}>
              Settings
            </h2>
            <button
              onClick={() => setSettingsOpen(false)}
              title="Close (Esc)" aria-label="Close (Esc)"
              style={{
                width: 28,
                height: 28,
                borderRadius: 'var(--radius-md)',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                fontSize: 16,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 150ms',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--surface-hover)';
                e.currentTarget.style.color = 'var(--text)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {/* Left Nav */}
            <nav
              data-nav-count={NAV_ITEMS.length}
              style={{
                width: 190,
                minWidth: 190,
                borderRight: '1px solid var(--border)',
                padding: '12px 0',
                overflowY: 'auto',
                background: 'var(--glass-bg)',
                flexShrink: 0,
              }}
            >
              {NAV_ITEMS.map((item) => {
                const isActive = settingsTab === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => setSettingsTab(item.key)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '8px 16px',
                      background: isActive ? 'var(--surface-hover)' : 'transparent',
                      border: 'none',
                      borderLeft: `3px solid ${isActive ? 'var(--coral)' : 'transparent'}`,
                      color: isActive ? 'var(--text)' : 'var(--text-secondary)',
                      fontSize: 13,
                      fontWeight: isActive ? 500 : 400,
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all 120ms',
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = 'var(--surface-hover)';
                        e.currentTarget.style.color = 'var(--text)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = 'var(--text-secondary)';
                      }
                    }}
                  >
                    <span style={{ fontSize: 14, width: 20, textAlign: 'center' }}>
                      {item.icon}
                    </span>
                    {item.label}
                  </button>
                );
              })}
            </nav>

            {/* Content */}
            <main
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '24px 32px',
              }}
            >
              <Suspense fallback={<div style={{ padding: 20, color: 'var(--text-muted)' }}>Loading...</div>}>
                {renderContent()}
              </Suspense>
            </main>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(16px) scale(0.98) } to { opacity: 1; transform: translateY(0) scale(1) } }
      `}</style>
    </>
  );
}
