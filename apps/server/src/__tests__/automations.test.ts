import { describe, test, expect } from 'vitest';

// ─── Cron Parser Tests ─────────────────────────────────────────────────────────
// These test the logic independently (same patterns used in automations.ts)

function parseCronToMs(cron: string): number | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return null;
  const [min, hour] = parts;

  const everyMinMatch = min.match(/^\*\/(\d+)$/);
  if (everyMinMatch && hour === '*') return parseInt(everyMinMatch[1]) * 60 * 1000;

  const everyHourMatch = hour.match(/^\*\/(\d+)$/);
  if (min === '0' && everyHourMatch) return parseInt(everyHourMatch[1]) * 3600 * 1000;

  const fixedMin = parseInt(min);
  const fixedHour = parseInt(hour);
  if (!isNaN(fixedMin) && !isNaN(fixedHour) && parts[2] === '*' && parts[3] === '*') {
    return 24 * 3600 * 1000;
  }
  return null;
}

function parseDowFilter(cron: string): Set<number> | null {
  const parts = cron.trim().split(/\s+/);
  const dow = parts[4] ?? '*';
  if (dow === '*') return null;
  const days = new Set<number>();
  for (const segment of dow.split(',')) {
    const range = segment.match(/^(\d)-(\d)$/);
    if (range) {
      for (let d = parseInt(range[1]); d <= parseInt(range[2]); d++) days.add(d);
    } else if (/^\d$/.test(segment)) {
      days.add(parseInt(segment));
    }
  }
  return days.size > 0 ? days : null;
}

describe('Cron Parser', () => {
  test('every 5 minutes', () => {
    expect(parseCronToMs('*/5 * * * *')).toBe(5 * 60 * 1000);
  });

  test('every 30 minutes', () => {
    expect(parseCronToMs('*/30 * * * *')).toBe(30 * 60 * 1000);
  });

  test('every 2 hours', () => {
    expect(parseCronToMs('0 */2 * * *')).toBe(2 * 3600 * 1000);
  });

  test('daily at 9am', () => {
    expect(parseCronToMs('0 9 * * *')).toBe(24 * 3600 * 1000);
  });

  test('weekdays at 9am returns daily interval', () => {
    // Interval is 24h; weekday filtering is done at execution time
    expect(parseCronToMs('0 9 * * 1-5')).toBe(24 * 3600 * 1000);
  });

  test('invalid cron (too few parts) returns null', () => {
    expect(parseCronToMs('*/5 *')).toBeNull();
  });

  test('unrecognized pattern returns null (not silent default)', () => {
    expect(parseCronToMs('0 0 1 1 *')).toBeNull(); // yearly — not supported
  });
});

describe('Day-of-Week Filter', () => {
  test('wildcard returns null (any day)', () => {
    expect(parseDowFilter('0 9 * * *')).toBeNull();
  });

  test('weekdays 1-5', () => {
    const result = parseDowFilter('0 9 * * 1-5');
    expect(result).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  test('specific days 0,6 (weekend)', () => {
    const result = parseDowFilter('0 9 * * 0,6');
    expect(result).toEqual(new Set([0, 6]));
  });

  test('monday only', () => {
    const result = parseDowFilter('0 9 * * 1');
    expect(result).toEqual(new Set([1]));
  });
});
