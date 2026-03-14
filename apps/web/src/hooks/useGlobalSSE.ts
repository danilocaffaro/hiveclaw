'use client';

import { useEffect } from 'react';
import { useSessionStore } from '@/stores/session-store';
import { useMessageStore } from '@/stores/message-store';

/**
 * K-3: Global SSE listener for unread badge updates.
 * Connects to GET /api/events (wildcard) and increments unread
 * when assistant messages arrive for non-active sessions.
 */
export function useGlobalSSE() {
  useEffect(() => {
    const es = new EventSource('/api/events');

    es.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        const event = data.event ?? data.type;
        const payload = data.payload ?? data;

        // Only care about new assistant messages
        if (event === 'message.complete' || event === 'chat.finish') {
          const sessionId = payload.session_id ?? payload.sessionId;
          if (!sessionId) return;

          const activeSessionId = useSessionStore.getState().activeSessionId;
          if (sessionId !== activeSessionId) {
            useMessageStore.getState().incrementUnread(sessionId);
          }
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      // EventSource auto-reconnects — no action needed
    };

    return () => es.close();
  }, []);
}
