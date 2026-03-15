'use client';

import React, { useState, useRef, useEffect } from 'react';

/**
 * F3 — Copy message text
 * F2 — Quick reactions (emoji picker)
 * F1 — Reply/Quote
 *
 * Long-press (mobile) or right-click (desktop) context menu on a message bubble.
 */

interface MessageAction {
  icon: string;
  label: string;
  onClick: () => void;
}

interface MessageContextMenuProps {
  x: number;
  y: number;
  actions: MessageAction[];
  onClose: () => void;
}

export function MessageContextMenu({ x, y, actions, onClose }: MessageContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [onClose]);

  // Ensure menu stays within viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(x, window.innerWidth - 200),
    top: Math.min(y, window.innerHeight - actions.length * 44 - 16),
    zIndex: 1000,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    minWidth: 180,
    overflow: 'hidden',
    animation: 'fadeIn 100ms ease-out',
  };

  return (
    <div ref={ref} style={style}>
      {actions.map((action, i) => (
        <button
          key={i}
          onClick={() => { action.onClick(); onClose(); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 16px', width: '100%',
            background: 'transparent', border: 'none',
            color: 'var(--text)', fontSize: 14,
            cursor: 'pointer', textAlign: 'left',
            borderBottom: i < actions.length - 1 ? '1px solid var(--border)' : 'none',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
          }}
        >
          <span style={{ fontSize: 16, width: 24, textAlign: 'center' }}>{action.icon}</span>
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * F2 — Quick reaction bar (shows above context menu or inline)
 */
const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥', '👀', '🎯'];

interface ReactionBarProps {
  x: number;
  y: number;
  onReact: (emoji: string) => void;
  onClose: () => void;
}

export function QuickReactionBar({ x, y, onReact, onClose }: ReactionBarProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: Math.min(x - 100, window.innerWidth - 260),
        top: y - 50,
        zIndex: 1001,
        display: 'flex', gap: 2,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 24, padding: '4px 6px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
      }}
    >
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => { onReact(emoji); onClose(); }}
          style={{
            width: 38, height: 38, borderRadius: '50%',
            background: 'transparent', border: 'none',
            fontSize: 20, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'transform 100ms',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.3)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
          }}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

/**
 * F1 — Reply quote preview (shown above input bar when replying to a message)
 */
interface ReplyPreviewProps {
  senderName: string;
  senderEmoji: string;
  content: string;
  onCancel: () => void;
}

export function ReplyPreview({ senderName, senderEmoji, content, onCancel }: ReplyPreviewProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 12px', margin: '0 12px',
      borderLeft: '3px solid var(--coral)',
      background: 'var(--surface-hover)',
      borderRadius: '0 8px 8px 0',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--coral)' }}>
          {senderEmoji} {senderName}
        </div>
        <div style={{
          fontSize: 13, color: 'var(--text-secondary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          marginTop: 2,
        }}>
          {content.slice(0, 100)}
        </div>
      </div>
      <button
        onClick={onCancel}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-muted)', fontSize: 18, padding: 4,
          width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        ✕
      </button>
    </div>
  );
}

/**
 * Bubble Action Button — WhatsApp Web style dropdown arrow on hover (desktop only)
 * Appears at top-right corner of message bubble when hovered.
 */
interface BubbleActionButtonProps {
  onClick: (e: React.MouseEvent) => void;
  isUser?: boolean;
}

export function BubbleActionButton({ onClick, isUser }: BubbleActionButtonProps) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      aria-label="Message actions"
      style={{
        position: 'absolute',
        top: 4,
        right: isUser ? undefined : 4,
        left: isUser ? 4 : undefined,
        width: 24, height: 24,
        borderRadius: 'var(--radius-sm)',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, color: 'var(--text-muted)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        transition: 'opacity 100ms, background 100ms',
        zIndex: 2,
        padding: 0,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)';
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface)';
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
      }}
    >
      ▾
    </button>
  );
}

/**
 * F1 — Quoted reply block inside a message bubble
 */
interface QuotedReplyProps {
  senderName: string;
  content: string;
}

export function QuotedReply({ senderName, content }: QuotedReplyProps) {
  return (
    <div style={{
      padding: '6px 10px',
      borderLeft: '3px solid var(--coral)',
      background: 'rgba(255,107,107,0.08)',
      borderRadius: '0 6px 6px 0',
      marginBottom: 6,
      fontSize: 12,
    }}>
      <div style={{ fontWeight: 600, color: 'var(--coral)', marginBottom: 2 }}>{senderName}</div>
      <div style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {content.slice(0, 100)}
      </div>
    </div>
  );
}
