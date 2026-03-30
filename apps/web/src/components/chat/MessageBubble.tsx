'use client';

import React, { useState, useEffect, type ReactNode } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { LinkPreviews } from './LinkPreview';
import { AudioPlayer, isVoiceMessage } from './AudioPlayer';
import { QuotedReply } from './MessageActions';
import { ThinkingBlock, splitThinkingBlocks } from './ThinkingBlock';
import type { Message } from '@/stores/session-store';
import { useSessionStore } from '@/stores/session-store';
import { DebateCard, WorkflowCard, SprintProgressCard } from '../SpecialCards';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useUIStore } from '@/stores/ui-store';
import { useAgentStore } from '@/stores/agent-store';
import { cleanAgentName } from '@/lib/agent-utils';

// ─── Assistant Content Renderer (with thinking block extraction) ─────────────

function AssistantContent({ content }: { content: string }) {
  const segments = splitThinkingBlocks(content);
  // If no thinking blocks detected, render plain markdown
  if (segments.length === 1 && segments[0].type === 'text') {
    return <MarkdownRenderer content={segments[0].content} />;
  }
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'thinking' ? (
          <ThinkingBlock key={i} content={seg.content} />
        ) : (
          <MarkdownRenderer key={i} content={seg.content} />
        )
      )}
    </>
  );
}

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
  // B18: Tool output collapse — long outputs collapsed by default with preview
  const TOOL_OUTPUT_LINE_THRESHOLD = 5;
  const TOOL_OUTPUT_CHAR_THRESHOLD = 500;

  // Interactive/important tools start expanded; technical tools start collapsed
  const interactiveTools = ['question', 'memory', 'plans', 'todo', 'task', 'visual_memory', 'canvas', 'data_analysis'];
  const toolName = msg.tool_name || 'tool';
  const content = msg.content || '';
  const contentLines = content.split('\n');
  const isLongOutput = contentLines.length > TOOL_OUTPUT_LINE_THRESHOLD || content.length > TOOL_OUTPUT_CHAR_THRESHOLD;
  const isInteractive = interactiveTools.includes(toolName);

  // Long outputs collapse by default (even for interactive tools)
  // Short outputs follow the interactive/technical heuristic
  const defaultExpanded = isLongOutput ? false : isInteractive;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [hasUserToggled, setHasUserToggled] = useState(false);

  // If tool_name changes after mount (streaming race condition), update expanded state
  // But only if the user hasn't manually toggled it
  useEffect(() => {
    if (!hasUserToggled) {
      const isInt = interactiveTools.includes(msg.tool_name || 'tool');
      const newContent = msg.content || '';
      const newLines = newContent.split('\n');
      const isLong = newLines.length > TOOL_OUTPUT_LINE_THRESHOLD || newContent.length > TOOL_OUTPUT_CHAR_THRESHOLD;
      setExpanded(isLong ? false : isInt);
    }
  }, [msg.tool_name, msg.content, hasUserToggled]);

  const handleToggle = () => {
    setHasUserToggled(true);
    setExpanded(!expanded);
  };

  // Preview: first 2 lines, truncated
  const previewText = isLongOutput && !expanded
    ? contentLines.slice(0, 2).join('\n').slice(0, 120) + (contentLines.length > 2 || content.length > 120 ? '…' : '')
    : '';

  return (
    <div style={{
      margin: '4px 0 4px 42px',
      borderRadius: 'var(--radius-md)',
      border: '1px solid rgba(210,153,34,0.3)',
      overflow: 'hidden'
    }}>
      <button onClick={handleToggle} style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '8px 12px', background: 'var(--yellow-subtle)',
        cursor: 'pointer', fontSize: 13, border: 'none',
        color: 'var(--text)', textAlign: 'left'
      }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{expanded ? '▼' : '▶'}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--yellow)' }}>
          🔧 {toolName}
        </span>
        {/* Preview snippet when collapsed and output is long */}
        {isLongOutput && !expanded && previewText && (
          <span style={{
            fontSize: 11, color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            maxWidth: '40%', opacity: 0.7,
          }}>
            — {previewText}
          </span>
        )}
        <span style={{
          marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {isLongOutput && !expanded && (
            <span style={{
              padding: '1px 6px', borderRadius: 4,
              background: 'rgba(210,153,34,0.1)',
              color: 'var(--text-muted)',
              fontSize: 10, fontWeight: 500,
              fontFamily: 'var(--font-mono)',
            }}>
              {contentLines.length} lines
            </span>
          )}
          <span style={{
            padding: '1px 8px', borderRadius: 4,
            background: 'var(--green-subtle)', color: 'var(--green)',
            fontSize: 11, fontWeight: 500
          }}>
            ✓ done
          </span>
        </span>
      </button>
      {expanded && (
        <div style={{
          padding: '10px 12px', background: 'var(--code-bg)',
          fontFamily: 'var(--font-mono)', fontSize: 12,
          color: 'var(--text-secondary)', whiteSpace: 'pre-wrap',
          maxHeight: 300, overflowY: 'auto', lineHeight: 1.5,
          userSelect: 'text',
        }}>
          {content}
        </div>
      )}
      {/* Show more footer for collapsed long outputs */}
      {isLongOutput && !expanded && (
        <button
          onClick={handleToggle}
          style={{
            width: '100%', padding: '5px 12px', border: 'none',
            borderTop: '1px solid rgba(210,153,34,0.15)',
            background: 'var(--code-bg)', color: 'var(--text-muted)',
            fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-mono)',
            transition: 'background 150ms, color 150ms',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--code-bg)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          <span style={{ fontSize: 9 }}>▼</span>
          Show full output ({contentLines.length} lines)
        </button>
      )}
    </div>
  );
}

// ─── Special Card Parser ────────────────────────────────────────────────────────

export function renderSpecialCard(msg: Message): ReactNode | null {
  const content = msg.content ?? '';

  const debateMatches = [...content.matchAll(/:::debate(\{[\s\S]*?\}):::/g)];
  if (debateMatches.length > 0) {
    try {
      // Use last match — resolved card overwrites active card
      const props = JSON.parse(debateMatches[debateMatches.length - 1][1]);
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

  // P-1: Parse reply quote prefix — `> **Name**: text\n\nmessage`
  let quotedReply: { senderName: string; content: string } | null = null;
  let mainContent = displayContent;
  const quoteMatch = displayContent.match(/^>\s*\*\*([^*]+)\*\*:\s*(.+?)(?:\n\n([\s\S]*))?$/);
  if (quoteMatch) {
    quotedReply = { senderName: quoteMatch[1], content: quoteMatch[2] };
    mainContent = quoteMatch[3]?.trim() ?? '';
  }

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
            // B14 fix: ensure text is selectable on mobile
            userSelect: 'text',
            WebkitUserSelect: 'text',
          }}>
            {voiceSrc ? (
              <AudioPlayer src={voiceSrc} />
            ) : effectiveIsUser ? (
              <>
                {quotedReply && <QuotedReply senderName={quotedReply.senderName} content={quotedReply.content} />}
                {hasFileRefs ? (
                  <MarkdownRenderer content={mainContent} />
                ) : (
                  <span style={{ whiteSpace: 'pre-wrap' }}>{mainContent}</span>
                )}
              </>
            ) : (
              <>
                {quotedReply && <QuotedReply senderName={quotedReply.senderName} content={quotedReply.content} />}
                {renderSpecialCard(msg)}
                <AssistantContent content={mainContent.replace(/:::(?:debate|workflow|sprint)\{[\s\S]*?\}:::/g, '').trim()} />
              </>
            )}
          </div>

          {/* F10: Link previews */}
          {!effectiveIsUser && <LinkPreviews content={mainContent} />}

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
          background: effectiveIsUser ? 'linear-gradient(135deg, #2563eb, #1d4ed8)' : 'transparent',
          color: effectiveIsUser ? '#fff' : 'var(--text)',
          fontSize: 14, lineHeight: 1.6,
          wordBreak: 'break-word',
          // B2 fix: ensure user bubble text is selectable
          userSelect: 'text',
          WebkitUserSelect: 'text',
          cursor: effectiveIsUser ? 'text' : undefined,
        }}>
          {voiceSrc ? (
            <AudioPlayer src={voiceSrc} />
          ) : effectiveIsUser ? (
            <>
              {quotedReply && <QuotedReply senderName={quotedReply.senderName} content={quotedReply.content} />}
              {hasFileRefs ? (
                <MarkdownRenderer content={mainContent} />
              ) : (
                <span style={{ whiteSpace: 'pre-wrap' }}>{mainContent}</span>
              )}
            </>
          ) : (
            <>
              {quotedReply && <QuotedReply senderName={quotedReply.senderName} content={quotedReply.content} />}
              {renderSpecialCard(msg)}
              <AssistantContent content={mainContent.replace(/:::(?:debate|workflow|sprint)\{[\s\S]*?\}:::/g, '').trim()} />
            </>
          )}
        </div>

        {/* F10: Link previews (desktop) */}
        {!effectiveIsUser && <LinkPreviews content={mainContent} />}

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

        {/* K-1: Reaction badges */}
        {msg.reactions && msg.reactions.length > 0 && (
          <div style={{
            display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap',
          }}>
            {msg.reactions.map((r) => (
              <span key={r.emoji} style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '2px 6px', borderRadius: 10,
                background: 'var(--surface-hover)',
                border: '1px solid var(--border)',
                fontSize: 12, cursor: 'default',
              }}>
                <span>{r.emoji}</span>
                {r.count > 1 && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{r.count}</span>}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

