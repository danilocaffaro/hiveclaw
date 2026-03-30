'use client';

import React, { useState } from 'react';

// ─── Thinking/Reasoning Collapse Block ──────────────────────────────────────────
// B18: Collapsible block for LLM thinking/reasoning content.
// Default: collapsed. Shows "🧠 Thinking... (Xs)" pill.
// Follows CodeBlock.tsx collapse pattern.

interface ThinkingBlockProps {
  content: string;
  /** Duration in seconds (optional) */
  durationSec?: number;
}

export function ThinkingBlock({ content, durationSec }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = content.split('\n').length;

  const durationLabel = durationSec != null && durationSec > 0
    ? ` (${durationSec < 1 ? '<1' : Math.round(durationSec)}s)`
    : '';

  return (
    <div style={{
      borderRadius: 'var(--radius-md)',
      border: '1px solid rgba(168, 85, 247, 0.25)',
      overflow: 'hidden',
      margin: '6px 0',
      transition: 'border-color 150ms',
    }}>
      {/* Pill header — always visible */}
      <button
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          padding: '6px 12px',
          background: 'rgba(168, 85, 247, 0.06)',
          cursor: 'pointer',
          fontSize: 12,
          border: 'none',
          color: 'var(--text-secondary)',
          textAlign: 'left',
          fontFamily: 'var(--font-mono)',
          transition: 'background 150ms',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(168, 85, 247, 0.10)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(168, 85, 247, 0.06)';
        }}
      >
        <span style={{ fontSize: 13 }}>🧠</span>
        <span style={{
          fontWeight: 500,
          color: 'rgba(168, 85, 247, 0.85)',
        }}>
          Thinking{durationLabel}
        </span>
        <span style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          opacity: 0.6,
        }}>
          {lineCount} line{lineCount !== 1 ? 's' : ''}
        </span>
        <span style={{
          marginLeft: 'auto',
          fontSize: 10,
          color: 'var(--text-muted)',
          transition: 'transform 200ms',
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          display: 'inline-block',
        }}>
          ▼
        </span>
      </button>

      {/* Expandable content */}
      <div style={{
        maxHeight: expanded ? '600px' : '0px',
        overflow: expanded ? 'auto' : 'hidden',
        transition: 'max-height 300ms ease, opacity 200ms ease',
        opacity: expanded ? 1 : 0,
      }}>
        <div style={{
          padding: '10px 12px',
          background: 'var(--code-bg)',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--text-secondary)',
          whiteSpace: 'pre-wrap',
          lineHeight: 1.5,
          userSelect: 'text',
          borderTop: '1px solid rgba(168, 85, 247, 0.15)',
        }}>
          {content}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────────

/** Regex to detect <thinking>...</thinking> blocks in markdown content */
const THINKING_BLOCK_RE = /<thinking>([\s\S]*?)<\/thinking>/gi;

/**
 * Splits markdown content into segments: regular text and thinking blocks.
 * Returns an array of { type: 'text' | 'thinking', content: string }.
 */
export interface ContentSegment {
  type: 'text' | 'thinking';
  content: string;
}

export function splitThinkingBlocks(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  let lastIndex = 0;

  // Reset regex state
  THINKING_BLOCK_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = THINKING_BLOCK_RE.exec(content)) !== null) {
    // Text before the thinking block
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index).trim();
      if (text) segments.push({ type: 'text', content: text });
    }
    // The thinking block content
    const thinkingContent = match[1].trim();
    if (thinkingContent) {
      segments.push({ type: 'thinking', content: thinkingContent });
    }
    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last thinking block
  if (lastIndex < content.length) {
    const text = content.slice(lastIndex).trim();
    if (text) segments.push({ type: 'text', content: text });
  }

  // If no thinking blocks found, return the whole content as text
  if (segments.length === 0) {
    return [{ type: 'text', content }];
  }

  return segments;
}
