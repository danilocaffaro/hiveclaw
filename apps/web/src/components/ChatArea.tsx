'use client';

import React, { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { useSessionStore, type Message } from '@/stores/session-store';
import { useMessageStore } from '@/stores/message-store';
import { useUIStore } from '@/stores/ui-store';
import { useSquadStore } from '@/stores/squad-store';
import { useAgentStore } from '@/stores/agent-store';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useSessionEvents } from '@/hooks/useSessionEvents';

// Split components (was 1311 lines, now modular)
import { MessageBubble, LoadingSkeleton } from './chat/MessageBubble';
import { TypingIndicator } from './chat/TypingIndicator';
import { ChatHeader } from './chat/ChatHeader';
import { SquadChatHeader } from './chat/ChatHeader';
import AgentInfoPanel from './AgentInfoPanel';
import PinBanner from './chat/PinBanner';
import { ToolChipsBar } from './chat/ToolChipsBar';
import { WelcomeScreen, SquadWelcomeScreen } from './chat/WelcomeScreen';
import { InputBar, type Attachment } from './chat/InputBar';
import { DateSeparator, shouldShowDateSeparator } from './chat/DateSeparator';
import { ScrollFAB } from './chat/ScrollFAB';
import { MessageContextMenu, QuickReactionBar, ReplyPreview, BubbleActionButton } from './chat/MessageActions';
import { SearchOverlay } from './chat/SearchOverlay';

// ─── Main ChatArea ──────────────────────────────────────────────────────────────

export default function ChatArea({ hideHeader = false }: { hideHeader?: boolean } = {}) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { activeSessionId, activeSquadId, isStreaming, sendMessage, createSession, messageQueue, setStreaming } = useSessionStore();
  // B3: Read messages from message-store (keyed by sessionId) instead of session-store flat array
  const getMessages = useMessageStore((s) => s.getMessages);
  const addMessageToStore = useMessageStore((s) => s.addMessage);
  const appendToStore = useMessageStore((s) => s.appendToLastMessage);
  const messages = activeSessionId ? getMessages(activeSessionId) : [];
  const squads = useSquadStore((s) => s.squads);
  const interfaceMode = useUIStore(s => s.interfaceMode);
  const isMobile = useIsMobile();
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  // F5: Track new messages while scrolled up
  const [fabUnreadCount, setFabUnreadCount] = useState(0);
  // F1: Reply state
  const [replyTo, setReplyTo] = useState<{ id: string; senderName: string; senderEmoji: string; content: string } | null>(null);
  // F2/F3: Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; msg: Message } | null>(null);
  const [reactionBar, setReactionBar] = useState<{ x: number; y: number; msgId: string } | null>(null);
  // Hover state for desktop bubble action button
  const [hoveredMsgId, setHoveredMsgId] = useState<string | null>(null);
  const [agentInfoOpen, setAgentInfoOpen] = useState(false);
  // F11: Search overlay
  const [searchOpen, setSearchOpen] = useState(false);

  // ── Global SSE connection (Blueprint Sprint A) ──────────────────────────────
  // When NEXT_PUBLIC_ENABLE_MESSAGE_BUS=true, opens a persistent EventSource to
  // GET /api/sessions/:id/events so ALL agent events arrive in real-time.
  // When flag is off (default), falls back to inline SSE from sendMessage().
  useSessionEvents(activeSessionId, (evt) => {
    if (!activeSessionId) return;
    if (evt.event === 'message.start' && evt.data) {
      addMessageToStore(activeSessionId, {
        id: evt.data.id ?? crypto.randomUUID(),
        session_id: activeSessionId,
        role: 'assistant' as const,
        content: '',
        created_at: new Date().toISOString(),
        agentId: evt.data.agentId,
        agentName: evt.data.agentName,
        agentEmoji: evt.data.agentEmoji,
      });
      setStreaming(true);
    } else if (evt.event === 'message.delta' && evt.data?.text) {
      appendToStore(activeSessionId, evt.data.text);
    } else if (evt.event === 'message.finish') {
      setStreaming(false);
    }
  });

  // Count queued messages for active session
  const queuedCount = activeSessionId ? (messageQueue.get(activeSessionId)?.length ?? 0) : 0;

  // Track when activeSessionId changes to show skeleton while messages load
  useEffect(() => {
    if (activeSessionId && messages.length === 0 && !isStreaming) {
      setIsLoadingMessages(true);
      // If no messages arrive within 1s, it's an empty session — stop loading
      const timeout = setTimeout(() => setIsLoadingMessages(false), 1000);
      return () => clearTimeout(timeout);
    }
  }, [activeSessionId]);

  useEffect(() => {
    if (messages.length > 0 || !activeSessionId) {
      setIsLoadingMessages(false);
    }
  }, [messages, activeSessionId]);

  // When switching sessions/squads → always jump to bottom instantly and re-enable auto-scroll
  useEffect(() => {
    setAutoScroll(true);
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeSessionId, activeSquadId]);

  // When new messages arrive → scroll only if auto-scroll is enabled (user hasn't scrolled up)
  useEffect(() => {
    if (!autoScroll) {
      // F5: Count new messages while user is scrolled up
      setFabUnreadCount((c) => c + 1);
      return;
    }
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, autoScroll]);

  // Track manual scroll: if user scrolls up, disable auto-scroll; if at bottom, re-enable
  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isAtBottom = distanceFromBottom < 80;
    setAutoScroll(isAtBottom);
    if (isAtBottom) setFabUnreadCount(0);
  };

  // F5: Scroll to bottom handler
  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setAutoScroll(true);
    setFabUnreadCount(0);
  }, []);

  const handleSend = async (content: string, attachments?: Attachment[]) => {
    // Haptic feedback on mobile
    if (isMobile && navigator.vibrate) navigator.vibrate(10);

    let sessionId = activeSessionId;
    if (!sessionId) {
      const session = await createSession({ title: content.slice(0, 40) || 'File share' });
      sessionId = session.id;
    }

    // Upload attachments if any
    let messageText = content;
    if (attachments && attachments.length > 0) {
      try {
        const formData = new FormData();
        for (const att of attachments) {
          formData.append('file', att.file);
        }
        const res = await fetch('/api/files/upload', { method: 'POST', body: formData });
        const json = await res.json();
        const uploaded = json.data || [];

        // Build message with file references
        const fileLines = uploaded.map((f: { name: string; path: string; type: string }) => {
          if (f.type.startsWith('image/')) {
            return `[Image: ${f.name}](file://${f.path})`;
          }
          return `[File: ${f.name}](file://${f.path})`;
        });

        if (fileLines.length > 0) {
          messageText = fileLines.join('\n') + (content ? '\n\n' + content : '');
        }
      } catch (err) {
        console.error('Upload failed:', err);
        // Continue with text only
      }
    }

    if (!messageText) return;
    // F1: Prepend reply context if replying
    const finalText = replyTo
      ? `> **${replyTo.senderName}**: ${replyTo.content.slice(0, 80)}\n\n${messageText}`
      : messageText;
    setReplyTo(null);
    await sendMessage(sessionId, finalText);
  };

  // F3: Copy message text handler
  const handleCopy = useCallback((content: string) => {
    void navigator.clipboard.writeText(content);
  }, []);

  // F16: Edit message handler
  const handleEdit = useCallback(async (msg: Message) => {
    const newContent = prompt('Edit message:', msg.content ?? '');
    if (newContent === null || newContent === msg.content) return;
    try {
      const res = await fetch(`/api/messages/${msg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent }),
      });
      if (res.ok && activeSessionId) {
        // Refresh messages
        const { fetchMessages } = useSessionStore.getState();
        fetchMessages(activeSessionId);
      }
    } catch { /* ignore */ }
  }, [activeSessionId]);

  // F17: Delete message handler
  const handleDelete = useCallback(async (msgId: string) => {
    if (!confirm('Delete this message?')) return;
    try {
      const res = await fetch(`/api/messages/${msgId}?mode=soft`, { method: 'DELETE' });
      if (res.ok && activeSessionId) {
        const { fetchMessages } = useSessionStore.getState();
        fetchMessages(activeSessionId);
      }
    } catch { /* ignore */ }
  }, [activeSessionId]);

  // F18: Pin message handler
  const handlePin = useCallback(async (msgId: string) => {
    try {
      await fetch(`/api/messages/${msgId}/pin`, { method: 'POST' });
      window.dispatchEvent(new Event('hiveclaw:pin-changed'));
    } catch { /* ignore */ }
  }, []);

  // F1: Reply handler
  const handleReply = useCallback((msg: Message) => {
    const name = msg.role === 'user' ? 'You' : (msg.agentName ?? 'Assistant');
    const emoji = msg.role === 'user' ? '👤' : (msg.agentEmoji ?? '🤖');
    setReplyTo({ id: msg.id, senderName: name, senderEmoji: emoji, content: msg.content ?? '' });
  }, []);

  // F1/F2/F3: Context menu handler (right-click or long-press)
  const handleMessageContextMenu = useCallback((e: React.MouseEvent, msg: Message) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, msg });
    setReactionBar({ x: e.clientX, y: e.clientY, msgId: msg.id });
  }, []);

    // K-1: Handle reaction — persist to backend + update store
  const toggleReaction = useMessageStore((s) => s.toggleReaction);
  const handleReaction = useCallback((emoji: string, msgId: string) => {
    if (!activeSessionId) return;
    void toggleReaction(activeSessionId, msgId, emoji);
  }, [activeSessionId, toggleReaction]);

  // F11: Cmd+K to toggle search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // F19: Star/bookmark message handler
  const handleStar = useCallback(async (msgId: string) => {
    try {
      await fetch(`/api/messages/${msgId}/star`, { method: 'POST' });
    } catch { /* ignore */ }
  }, []);
  const handleSearchNavigate = useCallback((_sessionId: string, _messageId: string) => {
    // TODO: Switch to session + scroll to message
    // For now, just close search
  }, []);

  // Determine what to show
  const hasNoMessages = messages.length === 0;
  const isSquadSession = !!activeSquadId;
  const activeSquad = isSquadSession ? squads.find((s) => s.id === activeSquadId) : null;

  // Welcome: no messages at all (new or empty session)
  const showDefaultWelcome = hasNoMessages && !isLoadingMessages && !activeSquadId;
  // Squad welcome: squad session with no messages yet
  const showSquadWelcome = hasNoMessages && isSquadSession && !!activeSquad;

  return (
    <main style={{
      display: 'flex', flexDirection: 'column',
      height: '100%', minWidth: isMobile ? 0 : 400,
      background: 'var(--bg)', overflow: 'hidden', flex: 1,
    }}>
      {/* Chat Header — hidden when MobileApp provides its own */}
      {!hideHeader && <ChatHeader onAgentInfoClick={() => setAgentInfoOpen(true)} />}

      {/* N-2: Pin banner */}
      <PinBanner sessionId={activeSessionId} />

      {/* Messages / Welcome */}
      {showDefaultWelcome ? (
        <WelcomeScreen onSend={handleSend} />
      ) : showSquadWelcome && activeSquad ? (
        <SquadWelcomeScreen squad={activeSquad} onSend={handleSend} />
      ) : isLoadingMessages ? (
        <LoadingSkeleton />
      ) : (
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '12px 12px' : '16px 24px', position: 'relative' }}
        >
          {messages.map((msg, i) => (
            <React.Fragment key={msg.id}>
              {/* F6: Date separator when date changes */}
              {shouldShowDateSeparator(messages[i - 1]?.created_at, msg.created_at) && msg.created_at && (
                <DateSeparator dateStr={msg.created_at} />
              )}
              {/* F1/F2/F3: Right-click context menu + hover action button on messages */}
              <div
                onContextMenu={(e) => handleMessageContextMenu(e, msg)}
                onMouseEnter={() => { if (!isMobile) setHoveredMsgId(msg.id); }}
                onMouseLeave={() => { if (!isMobile) setHoveredMsgId(null); }}
                style={{ position: 'relative' }}
              >
                <MessageBubble key={msg.id} msg={msg} />
                {/* Desktop: WhatsApp-style action button on hover */}
                {!isMobile && hoveredMsgId === msg.id && !contextMenu && (
                  <BubbleActionButton
                    isUser={msg.role === 'user'}
                    onClick={(e) => handleMessageContextMenu(e, msg)}
                  />
                )}
              </div>
            </React.Fragment>
          ))}
          {isStreaming && messages.length > 0 && messages[messages.length - 1].role !== 'assistant' && (
            <TypingIndicator />
          )}
          <div ref={messagesEndRef} />

          {/* F5: Scroll-to-bottom FAB */}
          <ScrollFAB visible={!autoScroll} unreadCount={fabUnreadCount} onClick={scrollToBottom} />
        </div>
      )}

      {/* Tool Chips Bar — Pro mode only, hidden on mobile */}
      {/* ToolChips bar disabled until real data available (B030) */}

      {/* F2: Quick reaction bar (floating above context menu) */}
      {reactionBar && (
        <QuickReactionBar
          x={reactionBar.x}
          y={reactionBar.y}
          onReact={(emoji) => handleReaction(emoji, reactionBar.msgId)}
          onClose={() => setReactionBar(null)}
        />
      )}

      {/* F1/F3: Context menu (Copy, Reply, React) */}
      {contextMenu && (
        <MessageContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => { setContextMenu(null); setReactionBar(null); }}
          actions={[
            { icon: '💬', label: 'Reply', onClick: () => handleReply(contextMenu.msg) },
            { icon: '📋', label: 'Copy', onClick: () => handleCopy(contextMenu.msg.content ?? '') },
            ...(contextMenu.msg.role === 'user' ? [
              { icon: '✏️', label: 'Edit', onClick: () => handleEdit(contextMenu.msg) },
            ] : []),
            { icon: '📌', label: 'Pin', onClick: () => handlePin(contextMenu.msg.id) },
            { icon: '⭐', label: 'Star', onClick: () => handleStar(contextMenu.msg.id) },
            { icon: '🗑️', label: 'Delete', onClick: () => handleDelete(contextMenu.msg.id) },
          ]}
        />
      )}

      {/* F1: Reply preview above input */}
      {replyTo && (
        <ReplyPreview
          senderName={replyTo.senderName}
          senderEmoji={replyTo.senderEmoji}
          content={replyTo.content}
          onCancel={() => setReplyTo(null)}
        />
      )}

      {/* Queue indicator */}
      {queuedCount > 0 && (
        <div style={{
          textAlign: 'center', padding: '4px 0', fontSize: 11,
          color: 'var(--text-muted)', fontStyle: 'italic',
        }}>
          {queuedCount} message{queuedCount > 1 ? 's' : ''} queued — will send when ready
        </div>
      )}

      {/* Input Bar (Liquid Glass) */}
      <InputBar onSend={handleSend} />

      {/* F11: Search overlay (Cmd+K) */}
      <SearchOverlay
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onNavigate={handleSearchNavigate}
        activeSessionId={activeSessionId ?? undefined}
      />
      {/* K-5: Agent info slide-in panel */}
      <AgentInfoPanel open={agentInfoOpen} onClose={() => setAgentInfoOpen(false)} />
    </main>
  );
}
