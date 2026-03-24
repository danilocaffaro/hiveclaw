'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useUIStore } from '@/stores/ui-store';
import { useSessionStore } from '@/stores/session-store';
import { VoiceRecorder } from './VoiceRecorder';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface Attachment {
  file: File;
  preview?: string; // data URL for images
  type: 'image' | 'document';
}

// ─── Attachment Chip ────────────────────────────────────────────────────────────

function AttachmentChip({ att, onRemove }: { att: Attachment; onRemove: () => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '4px 8px', borderRadius: 8,
      background: 'var(--surface)', border: '1px solid var(--border)',
      fontSize: 12, color: 'var(--text-secondary)',
      maxWidth: 180,
    }}>
      {att.type === 'image' && att.preview && (
        <img src={att.preview} alt="" style={{
          width: 24, height: 24, borderRadius: 4, objectFit: 'cover',
        }} />
      )}
      {att.type === 'document' && <span>📄</span>}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
        {att.file.name}
      </span>
      <button
        onClick={onRemove}
        aria-label={`Remove ${att.file.name}`}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-muted)', fontSize: 14, padding: 0, lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}

// ─── Input Bar (Liquid Glass) ───────────────────────────────────────────────────

export function InputBar({ onSend }: { onSend: (text: string, attachments?: Attachment[]) => void }) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const interfaceMode = useUIStore(s => s.interfaceMode);
  const isMobile = useIsMobile();

  // Stop button: derive streaming state from active session
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const isStreaming = useSessionStore((s) => s.streamingSessions.has(s.activeSessionId ?? ''));

  const handleStop = useCallback(async () => {
    if (!activeSessionId) return;
    try {
      await fetch(`/api/sessions/${activeSessionId}/cancel`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to cancel run:', err);
    }
  }, [activeSessionId]);

  const handleSend = () => {
    if (!text.trim() && attachments.length === 0) return;
    const trimmed = text.trim();
    // Handle /stop command inline
    if (trimmed.toLowerCase() === '/stop') {
      handleStop();
      setText('');
      return;
    }
    onSend(trimmed, attachments.length > 0 ? attachments : undefined);
    setText('');
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newAttachments: Attachment[] = [];
    for (const file of Array.from(files)) {
      const isImage = file.type.startsWith('image/');
      const att: Attachment = {
        file,
        type: isImage ? 'image' : 'document',
      };

      if (isImage) {
        // Generate preview
        const reader = new FileReader();
        reader.onload = () => {
          setAttachments(prev =>
            prev.map(a => a.file === file ? { ...a, preview: reader.result as string } : a)
          );
        };
        reader.readAsDataURL(file);
      }

      newAttachments.push(att);
    }

    setAttachments(prev => [...prev, ...newAttachments]);

    // Reset input so same file can be selected again
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  }, []);

  const hasContent = text.trim() || attachments.length > 0;
  const [isRecording, setIsRecording] = useState(false);

  // F13: Handle voice send — upload blob then send as message
  const handleVoiceSend = useCallback(async (blob: Blob, durationMs: number) => {
    setIsRecording(false);
    try {
      const filename = `voice-${Date.now()}.webm`;
      const file = new File([blob], filename, { type: blob.type || 'audio/webm' });
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/files/upload', { method: 'POST', body: formData });
      const json = await res.json();
      const uploaded = json.data?.[0];
      if (uploaded) {
        const dur = Math.round(durationMs / 1000);
        onSend(`[Audio: ${filename} (${dur}s)](/api/files/uploads/${encodeURIComponent(uploaded.name)})`);
      }
    } catch (err) {
      console.error('Voice upload failed:', err);
    }
  }, [onSend]);

  // F13: Show VoiceRecorder instead of InputBar when recording
  if (isRecording) {
    return (
      <div style={{ padding: isMobile ? '0 12px' : '0 20px', paddingBottom: isMobile ? 'max(12px, calc(12px + env(safe-area-inset-bottom)))' : '16px' }}>
        <VoiceRecorder onSend={handleVoiceSend} onCancel={() => setIsRecording(false)} />
      </div>
    );
  }

  return (
    <div style={{
      padding: isMobile ? '0 12px' : '0 20px',
      paddingBottom: isMobile
        ? 'max(12px, calc(12px + env(safe-area-inset-bottom)))'
        : '16px',
    }}>
      <div style={{
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid var(--glass-border)',
        borderRadius: 'var(--radius-xl)',
        overflow: 'hidden',
        transition: 'border-color 200ms',
      }}>
        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div style={{
            padding: '8px 16px 0',
            display: 'flex', flexWrap: 'wrap', gap: 6,
          }}>
            {attachments.map((att, i) => (
              <AttachmentChip key={i} att={att} onRemove={() => removeAttachment(i)} />
            ))}
          </div>
        )}

        {/* Textarea + controls */}
        <div style={{ display: 'flex', alignItems: 'flex-end', padding: '12px 16px', gap: 8 }}>
          {/* Attach button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach file"
            style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'transparent',
              color: 'var(--text-muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, flexShrink: 0, cursor: 'pointer',
              border: 'none', padding: 0,
              transition: 'color 150ms',
            }}
          >
            📎
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.doc,.docx,.txt,.csv,.json,.md"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />

          <textarea aria-label="Message input"
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            placeholder="Ask me anything..."
            rows={1}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text)', fontSize: 14, fontFamily: 'var(--font-sans)',
              resize: 'none', lineHeight: 1.5, maxHeight: 150,
            }}
            disabled={false}
          />

          {/* Send, Stop, or Mic button */}
          {isStreaming ? (
            <button onClick={handleStop} aria-label="Stop generation" title="Stop generation (/stop)" style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'var(--error, #ef4444)',
              color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, flexShrink: 0, transition: 'all 150ms',
              cursor: 'pointer',
              border: 'none',
            }}>
              ■
            </button>
          ) : hasContent ? (
            <button onClick={handleSend} style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'var(--coral)',
              color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, flexShrink: 0, transition: 'all 150ms',
              cursor: 'pointer',
              border: 'none',
            }}>
              ↑
            </button>
          ) : (
            <button onClick={() => setIsRecording(true)} aria-label="Record voice message" style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'var(--surface)',
              color: 'var(--text-muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, flexShrink: 0, transition: 'all 150ms',
              cursor: 'pointer',
              border: '1px solid var(--border)',
            }}>
              🎙️
            </button>
          )}
        </div>

        {/* Bottom hints — desktop only */}
        {!isMobile && (
          <div style={{
            padding: '4px 16px 8px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontSize: 11, color: 'var(--text-muted)'
          }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <span><kbd style={{ padding: '1px 4px', borderRadius: 3, background: 'var(--surface)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>Enter</kbd> send</span>
              <span><kbd style={{ padding: '1px 4px', borderRadius: 3, background: 'var(--surface)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>Shift+Enter</kbd> new line</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
