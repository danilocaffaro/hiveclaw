import { create } from 'zustand';
import { useMessageStore } from './message-store';

export interface Session {
  id: string;
  title: string;
  provider_id?: string;
  model_id?: string;
  agent_id?: string;
  agent_name?: string;
  mode: 'dm' | 'squad';
  squad_id?: string;
  created_at: string;
  updated_at: string;
  source?: 'hiveclaw';
  last_message?: string;
}

export interface MessageReaction {
  emoji: string;
  count: number;
}

export interface Message {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  agent_id?: string;
  agentId?: string;
  agentName?: string;
  agentEmoji?: string;
  sender_type?: 'human' | 'agent' | 'external_agent';
  tool_name?: string;
  tool_input?: string;
  tool_result?: string;
  tokens_in?: number;
  tokens_out?: number;
  cost?: number;
  created_at: string;
  reactions?: MessageReaction[];
  replyTo?: string;
}

interface SessionStore {
  sessions: Session[];
  activeSessionId: string | null;
  activeSquadId: string | null;
  messages: Message[];
  isStreaming: boolean;
  streamingSessions: Set<string>;
  messageQueue: Map<string, string[]>;
  setSessions: (sessions: Session[]) => void;
  setActiveSession: (id: string | null) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  appendToLastMessage: (text: string) => void;
  setStreaming: (val: boolean) => void;
  isSessionStreaming: (sessionId: string) => boolean;
  fetchSessions: (opts?: { preview?: boolean }) => Promise<void>;
  fetchMessages: (sessionId: string) => Promise<void>;
  createSession: (opts?: { title?: string; agent_id?: string }) => Promise<Session>;
  createSquadSession: (squadId: string, title?: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  sendMessage: (sessionId: string, content: string) => Promise<void>;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error((err as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Race condition guard: monotonically increasing counter for fetchMessages calls.
// Each call captures the current value; if a newer call starts before it resolves,
// the older result is discarded (user navigated to a different session).
let fetchCounter = 0;

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  activeSquadId: null,
  messages: [],
  isStreaming: false,
  streamingSessions: new Set<string>(),
  messageQueue: new Map<string, string[]>(),

  setSessions: (sessions) => set({ sessions }),
  setActiveSession: (id) => {
    const session = get().sessions.find((s) => s.id === id);
    // B6: Clear unread badge when opening a session
    if (id) useMessageStore.getState().clearUnread(id);
    set({
      activeSessionId: id,
      activeSquadId: session?.squad_id ?? null,
      messages: [],
    });
    if (id) {
      try { localStorage.setItem('hiveclaw-active-session', id); } catch { /* noop */ }
      get().fetchMessages(id);
    } else {
      try { localStorage.removeItem('hiveclaw-active-session'); } catch { /* noop */ }
    }
  },
  setMessages: (messages) => {
    const { activeSessionId } = get();
    if (activeSessionId) useMessageStore.getState().setMessages(activeSessionId, messages);
    set({ messages });
  },
  addMessage: (message) => {
    useMessageStore.getState().addMessage(message.session_id, message);
    // B6: Increment unread badge if message is for a non-active session
    const { activeSessionId } = get();
    if (message.session_id !== activeSessionId && message.role === 'assistant') {
      useMessageStore.getState().incrementUnread(message.session_id);
    }
    // Update sidebar preview: extract plain text from content for last_message
    const contentText = typeof message.content === 'string'
      ? message.content
      : Array.isArray(message.content)
        ? (message.content as Array<{ type: string; text?: string }>).filter(b => b.type === 'text').map(b => b.text).join(' ')
        : '';
    set((s) => ({
      messages: [...s.messages, message],
      sessions: s.sessions.map(sess =>
        sess.id === message.session_id
          ? { ...sess, last_message: contentText || sess.last_message, updated_at: new Date().toISOString() }
          : sess
      ),
    }));
  },
  appendToLastMessage: (text) => {
    const { activeSessionId } = get();
    if (activeSessionId) useMessageStore.getState().appendToLastMessage(activeSessionId, text);
    set((s) => {
      if (s.messages.length === 0) return s;
      const msgs = [...s.messages];
      const last = { ...msgs[msgs.length - 1] };
      last.content += text;
      msgs[msgs.length - 1] = last;
      return { messages: msgs };
    });
  },
  setStreaming: (val) => set((s) => ({ isStreaming: val })),
  isSessionStreaming: (sessionId) => get().streamingSessions.has(sessionId),

  fetchSessions: async (opts?: { preview?: boolean }) => {
    try {
      const qs = opts?.preview ? '?preview=true' : '';
      const data = await apiFetch<{ data: Session[] } | Session[]>(`/sessions${qs}`);
      const rawSessions = Array.isArray(data) ? data : (data as { data: Session[] }).data ?? [];
      // Normalize sessions — normalize session data from API
      const sessions = (rawSessions as unknown as Array<Record<string, unknown>>).map((s) => ({
        id: (s.id ?? s.sessionKey ?? '') as string,
        title: (s.title ?? s.label ?? s.id ?? s.sessionKey ?? 'Untitled') as string,
        provider_id: (s.provider_id ?? s.provider ?? '') as string | undefined,
        model_id: (s.model_id ?? s.model ?? '') as string | undefined,
        agent_id: (s.agent_id ?? '') as string | undefined,
        mode: (s.mode ?? 'dm') as 'dm' | 'squad',
        squad_id: (s.squad_id ?? '') as string | undefined,
        created_at: (s.created_at ?? s.lastActive ?? new Date().toISOString()) as string,
        updated_at: (s.updated_at ?? s.lastActive ?? new Date().toISOString()) as string,
        source: 'hiveclaw' as const,
        last_message: (s.last_message ?? '') as string,
      })) as Session[];
      set({ sessions });
      // Restore last active session from localStorage
      try {
        const stored = localStorage.getItem('hiveclaw-active-session');
        if (stored && sessions.find((s) => s.id === stored)) {
          const restoredSession = sessions.find((s) => s.id === stored);
          set({
            activeSessionId: stored,
            activeSquadId: restoredSession?.squad_id ?? null,
          });
          get().fetchMessages(stored);
        }
      } catch { /* localStorage may be unavailable */ }
    } catch (e) {
      console.error('fetchSessions error:', e);
    }
  },

  fetchMessages: async (sessionId) => {
    // Race condition fix: capture a fetch token so stale fetches don't overwrite newer results.
    // If setActiveSession is called twice quickly, only the last fetch wins.
    const fetchToken = ++fetchCounter;
    try {
      const data = await apiFetch<{ data: Message[] } | Message[]>(
        `/sessions/${encodeURIComponent(sessionId)}/messages`
      );
      // Discard result if a newer fetch has started (user navigated away)
      if (fetchToken !== fetchCounter) return;
      // Also discard if the user has already switched to a different session
      if (get().activeSessionId !== sessionId) return;
      const rawMsgs = Array.isArray(data) ? data : (data as { data: Message[] }).data ?? [];
      // M13: Map snake_case DB fields to camelCase frontend fields
      const messages = rawMsgs.map((m) => ({
        ...m,
        agentId: m.agentId ?? (m as unknown as { agent_id?: string }).agent_id ?? '',
        agentName: m.agentName ?? (m as unknown as { agent_name?: string }).agent_name ?? '',
        agentEmoji: m.agentEmoji ?? (m as unknown as { agent_emoji?: string }).agent_emoji ?? '',
      }));
      // B3: Write to message-store (keyed by sessionId) AND session-store flat array (shim)
      useMessageStore.getState().setMessages(sessionId, messages);
      set({ messages });
    } catch (e) {
      console.error('fetchMessages error:', e);
    }
  },

  createSession: async (opts) => {
    try {
      const res = await apiFetch<{ data: Session } | Session>('/sessions', {
        method: 'POST',
        body: JSON.stringify({ title: opts?.title ?? 'New Chat', agent_id: opts?.agent_id ?? '' }),
      });
      const session = (res as { data: Session }).data ?? (res as Session);
      set((s) => ({ sessions: [session, ...s.sessions], activeSessionId: session.id, activeSquadId: null, messages: [] }));
      try { localStorage.setItem('hiveclaw-active-session', session.id); } catch { /* noop */ }
      return session;
    } catch {
      const session: Session = {
        id: generateId(),
        title: opts?.title ?? 'New Chat',
        agent_id: opts?.agent_id ?? '',
        mode: 'dm',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      set((s) => ({ sessions: [session, ...s.sessions], activeSessionId: session.id, activeSquadId: null, messages: [] }));
      try { localStorage.setItem('hiveclaw-active-session', session.id); } catch { /* noop */ }
      return session;
    }
  },

  createSquadSession: async (squadId, title) => {
    try {
      // Reuse existing squad session only if it has recent activity (last 24h).
      // Stale sessions from days ago cause the "jumped back to old history" bug.
      const REUSE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
      const existing = get().sessions.find(
        (s) => s.squad_id === squadId && s.mode === 'squad' &&
          (Date.now() - new Date(s.updated_at ?? s.created_at).getTime()) < REUSE_WINDOW_MS
      );
      if (existing) {
        set({ activeSessionId: existing.id, activeSquadId: squadId, messages: [] });
        try { localStorage.setItem('hiveclaw-active-session', existing.id); } catch { /* noop */ }
        get().fetchMessages(existing.id);
        return;
      }

      const res = await fetch(`${API_BASE}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ squad_id: squadId, title: title ?? 'Squad Session', mode: 'squad' }),
      });
      if (!res.ok) throw new Error('Failed to create squad session');
      const data = await res.json() as { data: Session } | Session;
      const session = (data as { data: Session }).data ?? (data as Session);
      set((state) => ({
        sessions: [session, ...state.sessions],
        activeSessionId: session.id,
        activeSquadId: squadId,
        messages: [],
      }));
      try { localStorage.setItem('hiveclaw-active-session', session.id); } catch { /* noop */ }
    } catch (e) {
      console.error('Failed to create squad session:', e);
      // Fallback: create local session for offline/dev use
      const session: Session = {
        id: generateId(),
        title: title ?? 'Squad Session',
        mode: 'squad',
        squad_id: squadId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      set((state) => ({
        sessions: [session, ...state.sessions],
        activeSessionId: session.id,
        activeSquadId: squadId,
        messages: [],
      }));
      try { localStorage.setItem('hiveclaw-active-session', session.id); } catch { /* noop */ }
    }
  },

  deleteSession: async (id) => {
    try {
      await apiFetch(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch { /* server may be offline */ }
    set((s) => {
      const sessions = s.sessions.filter((sess) => sess.id !== id);
      const newActive = s.activeSessionId === id ? (sessions[0]?.id ?? null) : s.activeSessionId;
      return { sessions, activeSessionId: newActive, messages: newActive ? s.messages : [] };
    });
  },

  renameSession: async (id, title) => {
    try {
      await apiFetch(`/sessions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      });
    } catch { /* server may be offline — still update locally */ }
    set((s) => ({
      sessions: s.sessions.map((sess) => sess.id === id ? { ...sess, title } : sess),
    }));
  },

  sendMessage: async (sessionId, content) => {
    const { addMessage, appendToLastMessage, streamingSessions, messageQueue } = get();

    // If this session is already streaming, queue the message
    if (streamingSessions.has(sessionId)) {
      const queue = new Map(messageQueue);
      const existing = queue.get(sessionId) ?? [];
      existing.push(content);
      queue.set(sessionId, existing);
      set({ messageQueue: queue });
      return;
    }

    // Helper: mark session as streaming
    const startStreaming = () => {
      set((s) => {
        const ss = new Set(s.streamingSessions);
        ss.add(sessionId);
        const isActive = s.activeSessionId === sessionId;
        return { streamingSessions: ss, isStreaming: isActive ? true : s.isStreaming };
      });
    };

    // Helper: mark session as done streaming
    const stopStreaming = () => {
      set((s) => {
        const ss = new Set(s.streamingSessions);
        ss.delete(sessionId);
        const isActive = s.activeSessionId === sessionId;
        return { streamingSessions: ss, isStreaming: isActive ? false : ss.size > 0 };
      });
    };

    // Add user message locally
    const userMsg: Message = {
      id: generateId(),
      session_id: sessionId,
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    };
    addMessage(userMsg);

    // Add empty assistant message to stream into
    const assistantMsg: Message = {
      id: generateId(),
      session_id: sessionId,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString(),
    };
    addMessage(assistantMsg);
    startStreaming();

    try {
      // POST /sessions/:id/message returns SSE directly
      const res = await fetch(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
        throw new Error((err as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`);
      }

      // Read SSE stream from the response body
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          if (!part.trim()) continue;

          let eventType = 'message';
          let eventData = '';

          for (const line of part.split('\n')) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              eventData += line.slice(6);
            } else if (line.startsWith(':')) {
              // Comment (heartbeat), ignore
            }
          }

          if (!eventData) continue;

          try {
            const parsed = JSON.parse(eventData) as {
              text?: string;
              content?: string;
              agentId?: string;
              agentName?: string;
              agentEmoji?: string;
              isHeader?: boolean;
              name?: string;
              tool?: string;
              input?: unknown;
              output?: string;
              result?: string;
              message?: string;
              // token usage (message.finish)
              tokens_in?: number;
              tokens_out?: number;
              tokensIn?: number;
              tokensOut?: number;
              cost?: number;
              isLastAgent?: boolean;
            };

            switch (eventType) {
              case 'message.delta':
              case 'chat.delta':
                // SSE contamination guard: only write to messages if this stream
                // still belongs to the currently active session. If the user
                // navigated away mid-stream, discard the chunk silently.
                if (get().activeSessionId !== sessionId) break;
                // isHeader guard: squad-runner emits agent header deltas with isHeader:true.
                // These are protocol metadata, not user-visible content — skip them.
                if (parsed.isHeader) break;
                // If agent info comes with delta, stamp it onto the last assistant message
                if (parsed.agentId || parsed.agentName) {
                  set((s) => {
                    if (s.activeSessionId !== sessionId) return s; // double-check inside setter
                    if (s.messages.length === 0) return s;
                    const msgs = [...s.messages];
                    const last = { ...msgs[msgs.length - 1] };
                    if (!last.agentId && parsed.agentId) last.agentId = parsed.agentId;
                    if (!last.agentName && parsed.agentName) last.agentName = parsed.agentName;
                    if (!last.agentEmoji && parsed.agentEmoji) last.agentEmoji = parsed.agentEmoji;
                    last.content += parsed.text ?? parsed.content ?? '';
                    msgs[msgs.length - 1] = last;
                    return { messages: msgs };
                  });
                } else {
                  appendToLastMessage(parsed.text ?? parsed.content ?? '');
                }
                break;
              case 'message.finish':
              case 'chat.finish':
                // Attach token usage & cost to the last assistant message
                set((s) => {
                  const msgs = [...s.messages];
                  for (let i = msgs.length - 1; i >= 0; i--) {
                    if (msgs[i].role === 'assistant') {
                      msgs[i] = {
                        ...msgs[i],
                        tokens_in: parsed.tokens_in ?? parsed.tokensIn ?? 0,
                        tokens_out: parsed.tokens_out ?? parsed.tokensOut ?? 0,
                        cost: parsed.cost ?? 0,
                      };
                      break;
                    }
                  }
                  return { messages: msgs };
                });
                // In squad mode, only stop streaming after the last agent finishes
                if (!get().activeSquadId || parsed.isLastAgent) {
                  stopStreaming();
                }
                break;
              case 'tool.start':
                // Add tool message placeholder
                addMessage({
                  id: generateId(),
                  session_id: sessionId,
                  role: 'tool',
                  content: '',
                  tool_name: parsed.name ?? parsed.tool ?? 'tool',
                  tool_input: typeof parsed.input === 'string' ? parsed.input : JSON.stringify(parsed.input ?? ''),
                  created_at: new Date().toISOString(),
                });
                break;
              case 'tool.finish':
                // Update last tool message with result, then add new assistant message
                set((s) => {
                  const msgs = [...s.messages];
                  // Find last tool message and update
                  for (let i = msgs.length - 1; i >= 0; i--) {
                    if (msgs[i].role === 'tool') {
                      msgs[i] = { ...msgs[i], content: parsed.output ?? parsed.result ?? '', tool_result: parsed.output ?? parsed.result ?? '' };
                      break;
                    }
                  }
                  // Add new assistant message to continue streaming into
                  msgs.push({
                    id: generateId(),
                    session_id: sessionId,
                    role: 'assistant',
                    content: '',
                    created_at: new Date().toISOString(),
                  });
                  return { messages: msgs };
                });
                break;
              case 'agent.start':
                // Squad engine signals a new agent is about to speak.
                // Only create a new assistant message if the last one already has content
                // (avoids duplicate empty bubble in DM mode where we pre-create one).
                set((s) => {
                  const lastMsg = s.messages[s.messages.length - 1];
                  if (lastMsg?.role === 'assistant' && !lastMsg.content) {
                    // Just stamp agent info onto existing empty message
                    const msgs = [...s.messages];
                    msgs[msgs.length - 1] = {
                      ...lastMsg,
                      agentId: parsed.agentId ?? lastMsg.agentId,
                      agentName: parsed.agentName ?? lastMsg.agentName,
                      agentEmoji: parsed.agentEmoji ?? lastMsg.agentEmoji,
                    };
                    return { messages: msgs };
                  }
                  // Last message has content → push new empty one (squad multi-agent)
                  return {
                    messages: [
                      ...s.messages,
                      {
                        id: generateId(),
                        session_id: sessionId,
                        role: 'assistant',
                        content: '',
                        agentId: parsed.agentId,
                        agentName: parsed.agentName,
                        agentEmoji: parsed.agentEmoji,
                        created_at: new Date().toISOString(),
                      },
                    ],
                  };
                });
                break;
              case 'error':
                appendToLastMessage(`\n\n⚠️ Error: ${parsed.message ?? 'Unknown error'}`);
                stopStreaming();
                break;
            }
          } catch {
            // Non-JSON data, append as text
            if (eventType === 'message.delta') {
              appendToLastMessage(eventData);
            }
          }
        }
      }
    } catch (err) {
      appendToLastMessage(`\n\n⚠️ Connection error: ${(err as Error).message}`);
    } finally {
      stopStreaming();
      // Drain message queue — if messages were queued during streaming, send next one
      const queue = new Map(get().messageQueue);
      const pending = queue.get(sessionId);
      if (pending && pending.length > 0) {
        const next = pending.shift()!;
        if (pending.length === 0) {
          queue.delete(sessionId);
        } else {
          queue.set(sessionId, pending);
        }
        set({ messageQueue: queue });
        // Send next queued message (recursive, non-blocking)
        get().sendMessage(sessionId, next);
      }
    }
  },
}));
