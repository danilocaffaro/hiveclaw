'use client';

import { useState, useEffect } from 'react';

/**
 * Returns a formatted elapsed time string (m:ss) that updates every second.
 * Returns '0:00' when startedAt is null/undefined.
 */
export function useElapsedTime(startedAt: number | null | undefined): string {
  const [elapsed, setElapsed] = useState('0:00');

  useEffect(() => {
    if (!startedAt) {
      setElapsed('0:00');
      return;
    }

    const tick = () => {
      const ms = Date.now() - startedAt;
      const totalSec = Math.floor(ms / 1000);
      const m = Math.floor(totalSec / 60);
      setElapsed(`${m}:${String(totalSec % 60).padStart(2, '0')}`);
    };

    tick(); // immediate
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return elapsed;
}

/**
 * Returns elapsed seconds as a number, updating every 100ms.
 * Useful for per-tool live timers.
 */
export function useElapsedSeconds(startedAt: number | null | undefined): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!startedAt) {
      setSeconds(0);
      return;
    }

    const tick = () => {
      setSeconds((Date.now() - startedAt) / 1000);
    };

    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [startedAt]);

  return seconds;
}
