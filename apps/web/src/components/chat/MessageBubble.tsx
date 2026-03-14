'use client';

import React, { useState, type ReactNode } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { LinkPreviews } from './LinkPreview';
import { AudioPlayer, isVoiceMessage } from './AudioPlayer';
import type { Message } from '@/stores/session-store';
import { useSessionStore } from '@/stores/session-store';
import { DebateCard, WorkflowCard, SprintProgressCard } from '../SpecialCards';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useUIStore } from '@/stores/ui-store';
import { useAgentStore } from '@/stores/agent-store';
import { cleanAgentName } from '@/lib/agent-utils';

// ─── Loading Skeleton ───────────────────────────────────────────────────────────

export function LoadingSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 24 }}>
      {[1, 2, 3].map((i) => (
        <div key={i} style={{
          display: 'flex', gap: 12, alignItems: 'flex-start',
          animation: 'pulse 1.5s ease-in-out infinite',
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: 'var(--surface-hover)', flexShrink: 0,
          }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ width: '30%', height: 12, borderRadius: 4, background: 'var(--surface-hover)' }} />
            <div style={{ width: '80%', height: 12, borderRadius: 4, background: 'var(--surface-hover)' }} />
            <div style={{ width: '60%', height: 12, borderRadius: 4, background: 'var(--surface-hover)' }} />
          </div>
        </div>
      ))}
    </div>
  );
}



export function ToolCallBlock({ msg }: { msg: Message }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{
      margin: '4px 0 4px 42px',
      borderRadius: 'var(--radius-md)',
      border: '1px solid rgba(210,153,34,0.3)',
      overflow: 'hidden'
    }}>
      <button onClick={() => setExpanded(!expanded)} style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '8px 12px', background: 'var(--yellow-subtle)',
        cursor: 'pointer', fontSize: 13, border: 'none',
        color: 'var(--text)', textAlign: 'left'
      }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{expanded ? '▼' : '▶'}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--yellow)' }}>
          {msg.tool_name || 'tool'}
        </span>
        <span style={{
          marginLeft: 'auto', padding: '1px 8px', borderRadius: 4,
          background: 'var(--green-subtle)', color: 'var(--green)',
          fontSize: 11, fontWeight: 500
        }}>
          ✓ done
        </span>
      </button>
      {expanded && (
        <div style={{
          padding: '10px 12px', background: 'var(--code-bg)',
          fontFamily: 'var(--font-mono)', fontSize: 12,
          color: 'var(--text-secondary)', whiteSpace: 'pre-wrap',
          maxHeight: 300, overflowY: 'auto', lineHeight: 1.5
        }}>
          {msg.content}
        </div>
      )}
    </div>
  );
}

// ─── Special Card Parser ────────────────────────────────────────────────────────

export function renderSpecialCard(msg: Message): ReactNode | null {
  const content = msg.content ?? '';

  const debateMatch = content.match(/:::debate(\{[\s\S]*?\}):::/);
  if (debateMatch) {
    try {
      const props = JSON.parse(debateMatch[1]);
      return <DebateCard {...props} />;
    } catch { /* ignore malformed json */ }
  }

  const workflowMatch = content.match(/:::workflow(\{[\s\S]*?\}):::/);
  if (workflowMatch) {
    try {
      const props = JSON.parse(workflowMatch[1]);
      return <WorkflowCard {...props} />;
    } catch { /* ignore malformed json */ }
  }

  const sprintMatch = content.match(/:::sprint(\{[\s\S]*?\}):::/);
  if (sprintMatch) {
    try {
      const props = JSON.parse(sprintMatch[1]);
      return <SprintProgressCard {...props} />;
    } catch { /* ignore malformed json */ }
  }

  return null;
}

// ─── Message Bubble ─────────────────────────────────────────────────────────────

export function formatTime(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return ''; }
}

export function MessageBubble({ msg }: { msg: Message }) {
  // Accessible message bubble
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';
  const isTool = msg.role === 'tool';
  const isMobile = useIsMobile();

  // Resolve agent from store for DM sessions (fallback for messages without agentName)
  const activeSession = useSessionStore((s) => s.sessions.find((sess) => sess.id === s.activeSessionId));
  const agents = useAgentStore((s) => s.agents);
  const resolvedAgent = agents.find(
    (a) => a.id === (msg.agentId || activeSession?.agent_id)
  );

  // Detect system notifications masquerading as user messages
  // Pattern: "System: [2026-03-11 ...]" or "[System Message]"
  const textForDetection = (msg.content || '').toString();
  const isSystemNotification = isUser && (
    /^System:\s*\[\d{4}-\d{2}-\d{2}/.test(textForDetection) ||
    /^\[System Message\]/.test(textForDetection)
  );

  // S9: Use sender_type for reliable identity detection (replaces regex hack)
  const senderType = msg.sender_type ?? (isUser ? 'human' : 'agent');
  const isFromAgent = senderType === 'agent' || senderType === 'external_agent';
  const isFromExternalAgent = senderType === 'external_agent';

  // Legacy fallback: detect agent messages that arrived as role:user before sender_type migration
  const isAgentMasqueradingAsUser = !msg.sender_type && isUser && (
    /^(Excelente input|Consolidando como PO|Como PO,|🐕|🦊|🦾|🔭|🦄|\*\*DECISÃO)/.test(textForDetection) ||
    /^Previous agent's analysis:/.test(textForDetection)
  );
  // Treat these as assistant bubbles
  const effectiveIsUser = isUser && !isFromAgent && !isAgentMasqueradingAsUser;

  if (isSystem || isSystemNotification) return null;
  if (isTool) return <ToolCallBlock msg={msg} />;

  // Parse structured content arrays: [{"type":"text","text":"..."}]
  let rawContent = msg.content || '';
  if (rawContent.startsWith('[{') && rawContent.includes('"type"')) {
    try {
      const parsed = JSON.parse(rawContent);
      if (Array.isArray(parsed)) {
        rawContent = parsed
          .filter((p: { type?: string }) => p.type === 'text')
          .map((p: { text?: string }) => p.text ?? '')
          .join('');
      }
    } catch { /* keep raw */ }
  }
  const content = rawContent;
  // B-ECHO fix: strip protocol metadata that leaks into chat content
  // Removes lines like "ECHO-FREE", "[CLAIMED]", "ACK", "isHeader markers"
  const stripProtocolMeta = (text: string): string => {
    return text
      .split('\n')
      .filter(line => {
        const t = line.trim();
        // Filter out pure protocol markers
        if (/^(ECHO[-\s]?FREE|ACK\.?|BUILD ON|ROLE[-\s]?GATE)[.:!]?\s*$/i.test(t)) return false;
        if (/^\[CLAIM(ED)?\]/.test(t)) return false;
        if (/^\[Squad Group Context\]/.test(t)) return false;
        if (/^Previous agent'?s? analysis:/.test(t)) return false;
        return true;
      })
      .join('\n')
      .trim();
  };
  // Always render full message (no truncation). Collapse only long code blocks.
  const displayContent = effectiveIsUser ? content : stripProtocolMeta(content);

  // Multi-agent attribution — prefer msg fields, then resolved agent from store
  const rawName = msg.agentName ?? resolvedAgent?.name ?? '';
  const agentId = msg.agentId ?? resolvedAgent?.id ?? '';
  // M13: If agentId exists but no name resolved yet, show truncated id as fallback (not "🤖 Assistant")
  const agentName = cleanAgentName(agentId, rawName) || (agentId ? `Agent ${agentId.slice(0, 8)}` : '');
  const agentEmoji = msg.agentEmoji ?? resolvedAgent?.emoji ?? (isFromExternalAgent ? '🤝' : '🤖');
  // M13: hasAgentAttribution is true whenever there's any agent signal (id, name, or resolved)
  const hasAgentAttribution = !effectiveIsUser && Boolean(msg.agentId || msg.agentName || resolvedAgent);

  // Check if user message contains file references that need markdown rendering
  const hasFileRefs = effectiveIsUser && /\[(?:File|Image):\s[^\]]+\]\(file:\/\//.test(displayContent);

  // F13/F14: Detect voice messages
  const voiceSrc = isVoiceMessage(displayContent);

  // On mobile: WhatsApp-style — no avatar for user, tighter layout
  if (isMobile) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: effectiveIsUser ? 'flex-end' : 'flex-start',
        padding: '4px 0',
        alignItems: 'flex-end',
        gap: 6,
      }}>
        {/* Assistant avatar on left */}
        {!effectiveIsUser && (
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'var(--coral-subtle)',
            border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, flexShrink: 0, alignSelf: 'flex-end',
          }}>
            {agentEmoji}
          </div>
        )}

        <div style={{
          maxWidth: '82%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: effectiveIsUser ? 'flex-end' : 'flex-start',
        }}>
          {/* Bubble */}
          <div style={{
            padding: '8px 12px',
            borderRadius: effectiveIsUser ? '16px 16px 4px 16px' : '4px 16px 16px 16px',
            background: effectiveIsUser
              ? 'linear-gradient(135deg, #2563eb, #1d4ed8)'
              : isFromExternalAgent
                ? 'linear-gradient(135deg, rgba(168,85,247,0.08), rgba(168,85,247,0.04))'
                : 'var(--coral-subtle)',
            border: effectiveIsUser ? 'none' : isFromExternalAgent ? '1px solid rgba(168,85,247,0.3)' : '1px solid color-mix(in srgb, var(--coral) 20%, transparent)',
            fontSize: 14, lineHeight: 1.55, color: effectiveIsUser ? '#fff' : 'var(--text)',
            wordBreak: 'break-word',
          }}>
            {voiceSrc ? (
              <AudioPlayer src={voiceSrc} />
            ) : effectiveIsUser ? (
              hasFileRefs ? (
                <MarkdownRenderer content={displayContent} />
              ) : (
                <span style={{ whiteSpace: 'pre-wrap' }}>{displayContent}</span>
              )
            ) : (
              <>
                {renderSpecialCard(msg)}
                <MarkdownRenderer content={displayContent.replace(/:::(?:debate|workflow|sprint)\{[\s\S]*?\}:::/g, '').trim()} />
              </>
            )}
          </div>

          {/* F10: Link previews */}
          {!effectiveIsUser && <LinkPreviews content={displayContent} />}

          {/* Time + delivery status */}
          <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, padding: '0 2px', display: 'flex', alignItems: 'center', gap: 3 }}>
            {formatTime(msg.created_at)}
            {effectiveIsUser && <span style={{ color: 'var(--blue, #58a6ff)', fontSize: 11 }}>✓</span>}
          </span>
        </div>
      </div>
    );
  }

  // Desktop layout (unchanged)
  return (
    <div style={{
      display: 'flex', gap: 10, padding: '8px 0',
      flexDirection: effectiveIsUser ? 'row-reverse' : 'row',
      alignItems: 'flex-start',
    }}>
      {/* Avatar */}
      <div style={{
        width: 32, height: 32, borderRadius: 10,
        background: effectiveIsUser ? 'var(--blue-subtle)' : 'var(--coral-subtle)',
        border: `1px solid ${effectiveIsUser ? 'rgba(88,166,255,0.3)' : 'color-mix(in srgb, var(--coral) 30%, transparent)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, flexShrink: 0
      }}>
        {effectiveIsUser ? '👤' : agentEmoji}
      </div>

      {/* Content */}
      <div style={{ flex: 1, maxWidth: '85%' }}>
        {/* Header: name + role + time */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          marginBottom: 4, fontSize: 13,
          flexDirection: effectiveIsUser ? 'row-reverse' : 'row'
        }}>
          {effectiveIsUser ? (
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>You</span>
          ) : hasAgentAttribution ? (
            /* Multi-agent attribution header */
            <>
              <span style={{ fontSize: 14 }}>{agentEmoji}</span>
              <span style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14 }}>{agentName}</span>
              {/* B-UUID fix: agentId hidden from UI — stored as data attr for devtools only */}
            </>
          ) : (
            <>
              <span style={{ fontSize: 14 }}>{agentEmoji}</span>
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>{agentName}</span>
              <span style={{
                padding: '1px 8px', borderRadius: 'var(--radius-sm)',
                background: 'var(--coral-subtle)', color: 'var(--coral)',
                fontSize: 11, fontWeight: 500
              }}>
                {resolvedAgent?.role ?? 'Assistant'}
              </span>
            </>
          )}
          <span style={{ color: 'var(--text-muted)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
            {formatTime(msg.created_at)}
            {effectiveIsUser && <span style={{ color: 'var(--blue, #58a6ff)', fontSize: 11 }}>✓</span>}
          </span>
        </div>

        {/* Message body */}
        <div style={{
          padding: effectiveIsUser ? '10px 14px' : '2px 0',
          borderRadius: effectiveIsUser ? '14px 14px 4px 14px' : undefined,
          background: effectiveIsUser ? 'linear-gradient(135deg, var(--coral), var(--coral-hover))' : 'transparent',
          fontSize: 14, lineHeight: 1.6, color: 'var(--text)',
          wordBreak: 'break-word',
          // B2 fix: ensure user bubble text is selectable
          userSelect: 'text',
          WebkitUserSelect: 'text',
          cursor: effectiveIsUser ? 'text' : undefined,
        }}>
          {voiceSrc ? (
            <AudioPlayer src={voiceSrc} />
          ) : effectiveIsUser ? (
            hasFileRefs ? (
              <MarkdownRenderer content={displayContent} />
            ) : (
              <span style={{ whiteSpace: 'pre-wrap' }}>{displayContent}</span>
            )
          ) : (
            <>
              {renderSpecialCard(msg)}
              <MarkdownRenderer content={displayContent.replace(/:::(?:debate|workflow|sprint)\{[\s\S]*?\}:::/g, '').trim()} />
            </>
          )}
        </div>

        {/* F10: Link previews (desktop) */}
        {!effectiveIsUser && <LinkPreviews content={displayContent} />}

        {/* Token info */}
        {((msg.tokens_in ?? 0) > 0 || (msg.tokens_out ?? 0) > 0) && (
          <div style={{
            fontSize: 10, color: 'var(--text-muted)', marginTop: 4,
            fontFamily: 'var(--font-mono)', display: 'flex', gap: 8, alignItems: 'center',
          }}>
            <span>{(msg.tokens_in ?? 0).toLocaleString()}↑</span>
            <span>{(msg.tokens_out ?? 0).toLocaleString()}↓</span>
            <span style={{ color: 'var(--text-muted)', opacity: 0.5 }}>·</span>
            <span>{((msg.tokens_in ?? 0) + (msg.tokens_out ?? 0)).toLocaleString()} tokens</span>
            {(msg.cost ?? 0) > 0 && (
              <>
                <span style={{ color: 'var(--text-muted)', opacity: 0.5 }}>·</span>
                <span style={{ color: 'var(--green)' }}>${msg.cost!.toFixed(msg.cost! < 0.01 ? 4 : 2)}</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

