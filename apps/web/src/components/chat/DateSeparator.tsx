'use client';

/**
 * F6 — Timestamp grouping: "Today", "Yesterday", "12 Mar 2026"
 * Rendered between messages when the date changes.
 */

export function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = today.getTime() - msgDay.getTime();
  const days = Math.floor(diff / 86_400_000);

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString('en-US', { weekday: 'long' });
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

export function shouldShowDateSeparator(
  prevDate: string | undefined,
  currDate: string | undefined,
): boolean {
  if (!currDate) return false;
  if (!prevDate) return true;
  const prev = new Date(prevDate);
  const curr = new Date(currDate);
  return (
    prev.getFullYear() !== curr.getFullYear() ||
    prev.getMonth() !== curr.getMonth() ||
    prev.getDate() !== curr.getDate()
  );
}

export function DateSeparator({ dateStr }: { dateStr: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 0 8px', margin: '0 16px',
    }}>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      <span style={{
        fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.5px',
        padding: '2px 10px', borderRadius: 10,
        background: 'var(--surface)', border: '1px solid var(--border)',
      }}>
        {formatDateLabel(dateStr)}
      </span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );
}
