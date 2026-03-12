'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? '/api';

interface Agent { id: string; name: string; emoji: string; }
interface Session { id: string; agent_id?: string; title: string; updated_at: string; }
interface Message { id: string; role: string; content: string; created_at: string; }

export function ChatApp() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load agents and sessions
  useEffect(() => {
    fetch(`${API}/agents`).then(r => r.json()).then(d => setAgents(d.data ?? [])).catch(() => {});
    fetch(`${API}/sessions`).then(r => r.json()).then(d => setSessions(d.data ?? [])).catch(() => {});
  }, []);

  // Load messages when session changes
  useEffect(() => {
    if (!activeSession) { setMessages([]); return; }
    fetch(`${API}/sessions/${activeSession}/messages`).then(r => r.json()).then(d => setMessages(d.data ?? [])).catch(() => {});
  }, [activeSession]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamText]);

  const selectedAgent = agents[0]; // For now, use first agent

  const startChat = useCallback(async (agentId?: string) => {
    const res = await fetch(`${API}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId }),
    });
    const data = await res.json();
    const session = data.data;
    setSessions(prev => [session, ...prev]);
    setActiveSession(session.id);
    setMessages([]);
  }, []);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || streaming) return;
    const text = input.trim();
    setInput('');

    let sessionId = activeSession;
    if (!sessionId) {
      // Create session on first message
      const res = await fetch(`${API}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: selectedAgent?.id }),
      });
      const data = await res.json();
      sessionId = data.data.id;
      setSessions(prev => [data.data, ...prev]);
      setActiveSession(sessionId);
    }

    // Add user message immediately
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setStreaming(true);
    setStreamText('');

    try {
      const res = await fetch(`${API}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: text, agentId: selectedAgent?.id }),
      });

      if (!res.body) throw new Error('No response body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            const data = JSON.parse(payload);
            if (data.type === 'delta') {
              fullText += data.content;
              setStreamText(fullText);
            } else if (data.type === 'done') {
              setMessages(prev => [...prev, {
                id: data.messageId ?? Date.now().toString(),
                role: 'assistant',
                content: fullText,
                created_at: new Date().toISOString(),
              }]);
              setStreamText('');
              // Update session title in sidebar
              setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: text.slice(0, 60), updated_at: new Date().toISOString() } : s));
            } else if (data.type === 'error') {
              setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'assistant',
                content: `⚠️ Error: ${data.error}`,
                created_at: new Date().toISOString(),
              }]);
              setStreamText('');
            }
          } catch { /* skip */ }
        }
      }
    } catch (err: any) {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `⚠️ Connection error: ${err.message}`,
        created_at: new Date().toISOString(),
      }]);
      setStreamText('');
    }

    setStreaming(false);
    inputRef.current?.focus();
  }, [input, streaming, activeSession, selectedAgent]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const deleteSession = async (id: string) => {
    await fetch(`${API}/sessions/${id}`, { method: 'DELETE' });
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSession === id) { setActiveSession(''); setMessages([]); }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--bg)' }}>
      {/* ── Sidebar ── */}
      <aside style={{
        width: sidebarOpen ? 260 : 0, minWidth: sidebarOpen ? 260 : 0,
        background: 'var(--bg-secondary)', borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        transition: 'all 250ms cubic-bezier(0.4,0,0.2,1)',
      }}>
        {/* Header */}
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 18 }}>✨</span>
            <span style={{ fontSize: 15, fontWeight: 700, background: 'linear-gradient(135deg, var(--accent), var(--coral))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              SuperClaw
            </span>
          </div>
          <button onClick={() => startChat(selectedAgent?.id)} style={{
            width: '100%', padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 8, color: 'var(--text)', fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8,
            transition: 'all 150ms',
          }} onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
             onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
            <span style={{ fontSize: 16 }}>✎</span> New Chat
          </button>
        </div>

        {/* Agent(s) */}
        <div style={{ padding: '8px 12px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px', padding: '4px 4px 6px' }}>
            Agents
          </div>
          {agents.map(a => (
            <div key={a.id} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
              borderRadius: 6, fontSize: 13, color: 'var(--text-secondary)',
            }}>
              <span>{a.emoji}</span> {a.name}
            </div>
          ))}
        </div>

        {/* Sessions */}
        <div style={{ flex: 1, overflow: 'auto', padding: '0 12px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px', padding: '8px 4px 6px' }}>
            Recent Chats
          </div>
          {sessions.map(s => (
            <div key={s.id} onClick={() => setActiveSession(s.id)}
              style={{
                padding: '8px 10px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
                background: activeSession === s.id ? 'var(--surface)' : 'transparent',
                color: activeSession === s.id ? 'var(--text)' : 'var(--text-secondary)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                transition: 'all 100ms', marginBottom: 2,
              }}
              onMouseEnter={e => { if (activeSession !== s.id) e.currentTarget.style.background = 'var(--surface-hover)'; }}
              onMouseLeave={e => { if (activeSession !== s.id) e.currentTarget.style.background = 'transparent'; }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
              <button onClick={e => { e.stopPropagation(); deleteSession(s.id); }}
                style={{ fontSize: 12, color: 'var(--text-muted)', padding: '0 4px', opacity: 0.5, flexShrink: 0 }}
                onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                onMouseLeave={e => e.currentTarget.style.opacity = '0.5'}>✕</button>
            </div>
          ))}
        </div>
      </aside>

      {/* ── Main Chat Area ── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Top Bar */}
        <div style={{
          padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        }}>
          <button onClick={() => setSidebarOpen(v => !v)} style={{ fontSize: 16, color: 'var(--text-secondary)', padding: 4 }}>☰</button>
          {selectedAgent && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 18 }}>{selectedAgent.emoji}</span>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{selectedAgent.name}</span>
            </div>
          )}
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
          {messages.length === 0 && !streamText && (
            <div style={{ textAlign: 'center', marginTop: '20vh', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>{selectedAgent?.emoji ?? '✨'}</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                {selectedAgent ? `Chat with ${selectedAgent.name}` : 'Start a conversation'}
              </div>
              <div style={{ fontSize: 14 }}>Type a message below to get started</div>
            </div>
          )}

          {messages.map(msg => (
            <div key={msg.id} style={{
              display: 'flex', gap: 12, marginBottom: 16,
              flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 16,
                background: msg.role === 'user' ? 'var(--accent)' : 'var(--surface)',
              }}>
                {msg.role === 'user' ? '👤' : (selectedAgent?.emoji ?? '🤖')}
              </div>
              <div style={{
                maxWidth: '70%', padding: '10px 14px', borderRadius: 12,
                background: msg.role === 'user' ? 'var(--accent)' : 'var(--surface)',
                color: msg.role === 'user' ? '#fff' : 'var(--text)',
                fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap',
              }}>
                {msg.content}
              </div>
            </div>
          ))}

          {/* Streaming indicator */}
          {streamText && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 16,
                background: 'var(--surface)',
              }}>
                {selectedAgent?.emoji ?? '🤖'}
              </div>
              <div style={{
                maxWidth: '70%', padding: '10px 14px', borderRadius: 12,
                background: 'var(--surface)', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap',
              }}>
                {streamText}
                <span style={{ animation: 'blink 1s infinite' }}>▌</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={{ padding: '12px 24px 20px', flexShrink: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'flex-end', gap: 8,
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14,
            padding: '8px 12px', transition: 'border-color 200ms',
          }} onFocus={() => {}} >
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'; }}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              rows={1}
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: 'var(--text)', fontSize: 14, resize: 'none', lineHeight: 1.5,
                maxHeight: 160, padding: '4px 0',
              }}
            />
            <button onClick={sendMessage} disabled={!input.trim() || streaming}
              style={{
                width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: input.trim() && !streaming ? 'var(--accent)' : 'var(--surface-hover)',
                color: input.trim() && !streaming ? '#fff' : 'var(--text-muted)',
                fontSize: 16, transition: 'all 200ms', flexShrink: 0,
              }}>
              ↑
            </button>
          </div>
          <div style={{ textAlign: 'center', marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
            SuperClaw Pure v0.1.0 · Press Enter to send, Shift+Enter for new line
          </div>
        </div>

        <style>{`@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }`}</style>
      </main>
    </div>
  );
}
