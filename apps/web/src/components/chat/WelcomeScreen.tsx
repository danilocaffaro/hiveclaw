'use client';

import React, { useState } from 'react';
import type { Squad } from '@/stores/squad-store';
import type { Agent } from '@/stores/agent-store';
import { useIsMobile } from '@/hooks/useIsMobile';

// ─── Welcome Screen ─────────────────────────────────────────────────────────────

// Welcome screen with accessible landmarks
export function WelcomeScreen({ onSend }: { onSend: (text: string) => void }) {
  const isMobile = useIsMobile();

  const allPrompts = [
    { icon: '🔍', text: 'Compare the best laptops under $1500' },
    { icon: '✈️', text: 'Plan a 5-day trip to Lisbon' },
    { icon: '📝', text: 'Write a professional email declining an offer' },
    { icon: '📊', text: 'Help me create a monthly budget' },
    { icon: '🍽️', text: 'Suggest a weekly meal plan for 4 people' },
    { icon: '💡', text: 'Explain machine learning in simple terms' },
    { icon: '🏋️', text: 'Create a beginner workout plan' },
    { icon: '📋', text: 'Make a checklist for moving apartments' },
    { icon: '🛒', text: 'Find the best deals on noise-canceling headphones' },
    { icon: '🎬', text: 'Recommend movies similar to Inception' },
    { icon: '📄', text: 'Summarize this document for me' },
    { icon: '🧘', text: 'Help me build a morning routine' },
  ];

  // Randomize and pick subset
  const shuffled = allPrompts.sort(() => Math.random() - 0.5);
  const prompts = isMobile ? shuffled.slice(0, 2) : shuffled.slice(0, 4);

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: isMobile ? 16 : 20,
      padding: isMobile ? '24px 16px' : 40,
    }}>
      <div style={{ fontSize: isMobile ? 48 : 52 }}>✨</div>
      <h2 style={{ fontSize: isMobile ? 22 : 24, fontWeight: 700, color: 'var(--text)', textAlign: 'center' }}>
        How can I help?
      </h2>
      {!isMobile && (
        <p style={{ color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 420, fontSize: 14 }}>
          Your personal AI assistant — research, plan, write, analyze, create, and more.
        </p>
      )}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
        gap: isMobile ? 10 : 8,
        maxWidth: isMobile ? '100%' : 460,
        width: '100%',
        marginTop: 8,
      }}>
        {prompts.map((s) => (
          <button key={s.text} onClick={() => onSend(s.text)} style={{
            padding: isMobile ? '16px 20px' : '12px 16px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--card-bg)', border: '1px solid var(--border)',
            color: 'var(--text-secondary)', fontSize: isMobile ? 15 : 13, textAlign: 'left',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
            transition: 'all 150ms', minHeight: isMobile ? 56 : undefined,
          }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--surface-hover)';
              e.currentTarget.style.borderColor = 'rgba(255,107,107,0.3)';
              e.currentTarget.style.color = 'var(--text)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--card-bg)';
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            <span style={{ fontSize: isMobile ? 22 : 18 }}>{s.icon}</span> {s.text}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Squad Welcome Screen ───────────────────────────────────────────────────────

export function SquadWelcomeScreen({ squad, onSend }: { squad: Squad; onSend: (text: string) => void }) {
  const prompts = [
    { icon: '📋', text: '@all Identify your NEXUS role and what phase you own' },
    { icon: '🎯', text: 'Analyze this requirement and propose an implementation plan' },
    { icon: '🔍', text: '@all Review the current codebase and identify improvements' },
    { icon: '🚀', text: 'Start a sprint — break down the next feature into tasks' },
  ];

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 20, padding: 40
    }}>
      {/* Squad icon */}
      <div style={{
        width: 64, height: 64, borderRadius: 18,
        background: 'var(--purple-subtle)',
        border: '1px solid rgba(188,140,255,0.3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 32,
      }}>
        {squad.emoji || '👥'}
      </div>

      <h2 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', textAlign: 'center' }}>
        Squad ready. What should we tackle?
      </h2>
      <p style={{ color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 420, fontSize: 14 }}>
        Agents collaborate using{' '}
        <span style={{
          padding: '1px 8px', borderRadius: 'var(--radius-sm)',
          background: 'var(--blue-subtle)', color: 'var(--blue)',
          fontSize: 12, fontWeight: 500
        }}>NEXUS Pipeline</span>{' '}
        — each agent has a defined role and phase.
      </p>

      {/* Agent avatars row */}
      {(squad.agentIds ?? []).length > 0 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {(squad.agentIds ?? []).slice(0, 6).map((agentId) => (
            <div key={agentId} style={{
              width: 28, height: 28, borderRadius: '50%',
              background: 'var(--surface-hover)', border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14,
            }}>
              🤖
            </div>
          ))}
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 2 }}>
            {(squad.agentIds ?? []).length} agents ready
          </span>
        </div>
      )}

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 8, maxWidth: 460, width: '100%', marginTop: 8
      }}>
        {prompts.map((s) => (
          <button key={s.text} onClick={() => onSend(s.text)} style={{
            padding: '12px 16px', borderRadius: 'var(--radius-md)',
            background: 'var(--card-bg)', border: '1px solid var(--border)',
            color: 'var(--text-secondary)', fontSize: 13, textAlign: 'left',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
            transition: 'all 150ms'
          }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--surface-hover)';
              e.currentTarget.style.borderColor = 'rgba(188,140,255,0.3)';
              e.currentTarget.style.color = 'var(--text)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--card-bg)';
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            <span style={{ fontSize: 18 }}>{s.icon}</span> {s.text}
          </button>
        ))}
      </div>
    </div>
  );
}

