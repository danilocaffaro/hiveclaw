'use client';

/**
 * F5 — Scroll-to-bottom FAB with unread message count.
 * Appears when user scrolls up from the bottom of the chat.
 */

interface ScrollFABProps {
  visible: boolean;
  unreadCount: number;
  onClick: () => void;
}

export function ScrollFAB({ visible, unreadCount, onClick }: ScrollFABProps) {
  if (!visible) return null;

  return (
    <button
      onClick={onClick}
      aria-label={`Scroll to bottom${unreadCount > 0 ? ` (${unreadCount} new)` : ''}`}
      style={{
        position: 'absolute',
        bottom: 16,
        right: 20,
        zIndex: 50,
        width: 40,
        height: 40,
        borderRadius: '50%',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 18,
        color: 'var(--text)',
        transition: 'opacity 200ms, transform 200ms',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(10px)',
      }}
    >
      ↓
      {unreadCount > 0 && (
        <span
          style={{
            position: 'absolute',
            top: -6,
            right: -6,
            fontSize: 10,
            fontWeight: 700,
            color: '#fff',
            background: 'var(--coral, #F97066)',
            borderRadius: 10,
            minWidth: 18,
            height: 18,
            lineHeight: '18px',
            textAlign: 'center',
            padding: '0 5px',
          }}
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
}
