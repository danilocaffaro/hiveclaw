// ============================================================
// useSessionEvents — Global SSE connection per session
//
// Opens a persistent EventSource to GET /api/sessions/:id/events
// so the browser receives ALL events for a session in real-time,
// not just those from the current POST /message fetch.
//
// Blueprint Sprint A requirement:
//   - EventSource global (not inline in fetch)
//   - Reconnect with exponential backoff (1s→2s→4s→max 30s)
//   - Cleanup: return () => es.close() on unmount or sessionId change
//   - ENABLE_MESSAGE_BUS feature flag respected
// ============================================================

import { useEffect, useRef, useCallback } from 'react';
import { getApiBase, getAuthToken } from '@/lib/api-base';

const ENABLE_MESSAGE_BUS = process.env.NEXT_PUBLIC_ENABLE_MESSAGE_BUS === 'true';

export interface SessionSSEEvent {
  event: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

type SSEEventHandler = (event: SessionSSEEvent) => void;

const BACKOFF_SEQUENCE_MS = [1000, 2000, 4000, 8000, 16000, 30000];

/**
 * Opens a persistent SSE connection to /api/sessions/:id/events.
 * Reconnects automatically with exponential backoff on disconnect.
 *
 * Only active when ENABLE_MESSAGE_BUS=true (feature flag).
 * Falls back silently to inline SSE (existing behavior) when flag is off.
 *
 * @param sessionId - Active session ID (or null to disconnect)
 * @param onEvent   - Handler called for every SSE event received
 */
export function useSessionEvents(
  sessionId: string | null,
  onEvent: SSEEventHandler,
): void {
  const esRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Stable ref for onEvent to avoid re-connecting on every render
  const onEventRef = useRef<SSEEventHandler>(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback((id: string) => {
    if (!mountedRef.current) return;

    // Close any existing connection before opening a new one
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const base = getApiBase();
    const token = getAuthToken();
    const url = `${base}/sessions/${encodeURIComponent(id)}/events${token ? `?token=${token}` : ''}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (e: MessageEvent) => {
      if (!mountedRef.current) return;
      try {
        const parsed = JSON.parse(e.data) as SessionSSEEvent;
        onEventRef.current(parsed);
      } catch {
        // ignore malformed events
      }
    };

    es.onopen = () => {
      // Reset backoff on successful connection
      retryCountRef.current = 0;
    };

    es.onerror = () => {
      if (!mountedRef.current) return;

      es.close();
      esRef.current = null;

      // Exponential backoff reconnect
      const delay = BACKOFF_SEQUENCE_MS[
        Math.min(retryCountRef.current, BACKOFF_SEQUENCE_MS.length - 1)
      ];
      retryCountRef.current += 1;

      retryTimerRef.current = setTimeout(() => {
        if (mountedRef.current && sessionId === id) {
          connect(id);
        }
      }, delay);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current = true;

    // Feature flag: only use global EventSource when ENABLE_MESSAGE_BUS=true
    if (!ENABLE_MESSAGE_BUS || !sessionId) {
      return;
    }

    connect(sessionId);

    return () => {
      // Cleanup: close EventSource and cancel any pending retry
      mountedRef.current = false;

      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }

      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }

      // Reset for next mount
      mountedRef.current = true;
      retryCountRef.current = 0;
    };
  }, [sessionId, connect]);
}
