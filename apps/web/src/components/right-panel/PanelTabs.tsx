'use client';

import { useState } from 'react';
import { useUIStore, type RightPanelTab } from '@/stores/ui-store';

const TABS: { id: RightPanelTab; label: string; icon: string }[] = [
  { id: 'code',    label: 'Code',     icon: '◻' },
  { id: 'sprint',  label: 'Tasks',    icon: '◆' },
  { id: 'console', label: 'Activity', icon: '⊞' },
  { id: 'memory',  label: 'Memory',   icon: '◎' },
];

function PanelTabs() {
  const { rightPanelTab, setRightPanelTab } = useUIStore();
  const [hovered, setHovered] = useState<RightPanelTab | null>(null);

  return (
    <div className="electron-drag" style={{
      display: 'flex',
      alignItems: 'center',
      borderBottom: '1px solid var(--border)',
      padding: '0 4px',
      background: 'var(--glass-bg)',
      backdropFilter: 'blur(8px)',
      flexShrink: 0,
    }}>
      {TABS.map((tab) => {
        const active = rightPanelTab === tab.id;
        const isHovered = hovered === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => setRightPanelTab(tab.id)}
            onMouseEnter={() => setHovered(tab.id)}
            onMouseLeave={() => setHovered(null)}
            className="electron-no-drag"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '12px 12px',
              fontSize: 12,
              fontWeight: 500,
              position: 'relative',
              transition: 'color 0.2s',
              whiteSpace: 'nowrap',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: active ? 'var(--text)' : isHovered ? 'var(--text-secondary)' : 'var(--text-muted)',
            }}
          >
            <span>{tab.label}</span>
            {active && (
              <span style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: 2,
                background: 'var(--coral)',
                borderRadius: '2px 2px 0 0',
              }} />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Code Panel ───────────────────────────────────────────────────────────────


export default PanelTabs;
