// ============================================================
// message-store — Blueprint Sprint B
//
// Owns ALL message state keyed by sessionId.
// Replaces the message arrays in session-store.ts.
//
// Design:
//   - messages: Map<sessionId, Message[]>  (not a flat array)
//   - unreadCounts: Map<sessionId, number> (for sidebar badges)
//   - The active session's messages are read via getMessages(sessionId)
//   - addMessage / appendToLastMessage / setMessages take sessionId as first arg
// ============================================================

import { create } from 'zustand';
import type { Message, MessageReaction } from './session-store';

export type { Message, MessageReaction };

interface MessageStore {
  // Core state
  messages: Map<string, Message[]>;
  unreadCounts: Map<string, number>;

  // Read
  getMessages: (sessionId: string) => Message[];
  getUnreadCount: (sessionId: string) => number;

  // Write — all take sessionId as first arg
  setMessages: (sessionId: string, messages: Message[]) => void;
  addMessage: (sessionId: string, message: Message) => void;
  appendToLastMessage: (sessionId: string, text: string) => void;
  updateLastMessage: (sessionId: string, patch: Partial<Message>) => void;
  clearMessages: (sessionId: string) => void;

  // Unread badge management
  incrementUnread: (sessionId: string) => void;
  clearUnread: (sessionId: string) => void;

  // Reactions
  toggleReaction: (sessionId: string, messageId: string, emoji: string) => Promise<void>;
}

export const useMessageStore = create<MessageStore>((set, get) => ({
  messages: new Map(),
  unreadCounts: new Map(),

  // ── Read ─────────────────────────────────────────────────────────────────────

  getMessages: (sessionId) => {
    return get().messages.get(sessionId) ?? [];
  },

  getUnreadCount: (sessionId) => {
    return get().unreadCounts.get(sessionId) ?? 0;
  },

  // ── Write ────────────────────────────────────────────────────────────────────

  setMessages: (sessionId, messages) => {
    set((s) => {
      const next = new Map(s.messages);
      next.set(sessionId, messages);
      return { messages: next };
    });
  },

  addMessage: (sessionId, message) => {
    set((s) => {
      const next = new Map(s.messages);
      const existing = next.get(sessionId) ?? [];
      next.set(sessionId, [...existing, message]);
      return { messages: next };
    });
  },

  appendToLastMessage: (sessionId, text) => {
    set((s) => {
      const next = new Map(s.messages);
      const existing = next.get(sessionId) ?? [];
      if (existing.length === 0) return s;
      const msgs = [...existing];
      const last = { ...msgs[msgs.length - 1] };
      last.content += text;
      msgs[msgs.length - 1] = last;
      next.set(sessionId, msgs);
      return { messages: next };
    });
  },

  updateLastMessage: (sessionId, patch) => {
    set((s) => {
      const next = new Map(s.messages);
      const existing = next.get(sessionId) ?? [];
      if (existing.length === 0) return s;
      const msgs = [...existing];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') {
          msgs[i] = { ...msgs[i], ...patch };
          break;
        }
      }
      next.set(sessionId, msgs);
      return { messages: next };
    });
  },

  clearMessages: (sessionId) => {
    set((s) => {
      const next = new Map(s.messages);
      next.delete(sessionId);
      return { messages: next };
    });
  },

  // ── Unread badge ──────────────────────────────────────────────────────────────

  incrementUnread: (sessionId) => {
    set((s) => {
      const next = new Map(s.unreadCounts);
      next.set(sessionId, (next.get(sessionId) ?? 0) + 1);
      return { unreadCounts: next };
    });
  },

  clearUnread: (sessionId) => {
    set((s) => {
      const next = new Map(s.unreadCounts);
      next.delete(sessionId);
      return { unreadCounts: next };
    });
  },

  // ── Reactions ──────────────────────────────────────────────────────────────

  toggleReaction: async (sessionId, messageId, emoji) => {
    try {
      const res = await fetch(`/api/messages/${messageId}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      });
      if (!res.ok) return;
      const { data } = await res.json() as { data: { reactions: MessageReaction[] } };
      set((s) => {
        const next = new Map(s.messages);
        const msgs = [...(next.get(sessionId) ?? [])];
        const idx = msgs.findIndex((m) => m.id === messageId);
        if (idx >= 0) {
          msgs[idx] = { ...msgs[idx], reactions: data.reactions };
          next.set(sessionId, msgs);
        }
        return { messages: next };
      });
    } catch { /* network error — ignore */ }
  },
}));
