'use client';

import React from 'react';
import { useSessionStore, type ActiveTool } from '@/stores/session-store';

const TOOL_META: Record<string, { icon: string; color: string }> = {
  bash: { icon: '💻', color: 'var(--green)' },
  read: { icon: '📖', color: 'var(--blue)' },
  write: { icon: '✏️', color: 'var(--coral)' },
  edit: { icon: '🔧', color: 'var(--yellow)' },
  grep: { icon: '🔍', color: 'var(--purple)' },
  glob: { icon: '📁', color: 'var(--text-secondary)' },
  web_search: { icon: '🌐', color: 'var(--blue)' },
  web_fetch: { icon: '📡', color: 'var(--blue)' },
  browser: { icon: '🖥️', color: 'var(--purple)' },
  screenshot: { icon: '📸', color: 'var(--coral)' },
  mac_control: { icon: '🖱️', color: 'var(--yellow)' },
  memory_read: { icon: '🧠', color: 'var(--green)' },
  memory_write: { icon: '🧠', color: 'var(--green)' },
  squad_message: { icon: '💬', color: 'var(--blue)' },
};

function getToolMeta(name: string) {
  return TOOL_META[name] ?? { icon: '⚡', color: 'var(--text-muted)' };
}

function ToolChip({ tool }: { tool: ActiveTool }) {
  const { icon, color } = getToolMeta(tool.name);
  const duration = tool.finishedAt
    ? `${((tool.finishedAt - tool.startedAt) / 1000).toFixed(1)}s`
    : null;

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 'var(--radius-sm)',
      background: tool.status === 'running'
        ? `color-mix(in srgb, ${color} 15%, transparent)`
        : `color-mix(in srgb, ${color} 8%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} ${tool.status === 'running' ? '30' : '15'}%, transparent)`,
      color: tool.status === 'running' ? color : 'var(--text-muted)',
      fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap',
      transition: 'all 0.2s ease',
      animation: tool.status === 'running' ? 'chipPulse 1.5s ease infinite' : 'none',
    }}>
      <span style={{ fontSize: 11 }}>{icon}</span>
      <span>{tool.name}</span>
      {tool.status === 'done' && (
        <span style={{ color: 'var(--green)', fontSize: 10 }}>✓</span>
      )}
      {duration && (
        <span style={{ fontSize: 9, color: 'var(--text-muted)', opacity: 0.7 }}>{duration}</span>
      )}
    </span>
  );
}

export function ToolChipsBar() {
  const activeTools = useSessionStore((s) => s.activeTools);
  const isStreaming = useSessionStore((s) => s.streamingSessions.has(s.activeSessionId ?? ''));

  // Only show during streaming, and only if there are tools
  if (!isStreaming || activeTools.length === 0) return null;

  return (
    <>
      <style>{`
        @keyframes chipPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
      <div
        role="toolbar"
        aria-label="Active tools"
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 16px', flexWrap: 'wrap', overflow: 'hidden',
        }}
      >
        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500, marginRight: 2 }}>
          Tools:
        </span>
        {activeTools.map((tool, i) => (
          <ToolChip key={`${tool.name}-${i}`} tool={tool} />
        ))}
      </div>
    </>
  );
}
