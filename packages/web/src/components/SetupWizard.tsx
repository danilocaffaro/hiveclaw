'use client';

import { useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? '/api';

interface Props { onComplete: () => void; }

type Step = 'welcome' | 'provider' | 'agent' | 'done';

const PROVIDER_OPTIONS = [
  { id: 'openai', name: 'OpenAI', desc: 'GPT-4o, GPT-4.1, o3-mini', icon: '🟢', needsKey: true },
  { id: 'anthropic', name: 'Anthropic', desc: 'Claude Sonnet 4.5, Haiku', icon: '🟠', needsKey: true },
  { id: 'google', name: 'Google', desc: 'Gemini 2.5 Flash & Pro', icon: '🔵', needsKey: true },
  { id: 'openrouter', name: 'OpenRouter', desc: 'One key, all models', icon: '🌐', needsKey: true },
  { id: 'ollama', name: 'Ollama (Local)', desc: 'Free, private, no API key', icon: '🦙', needsKey: false },
];

const EMOJI_OPTIONS = ['🤖', '🧠', '⚡', '🦊', '🐕', '🦉', '🎯', '🔮', '🛡️', '🚀', '💎', '🌟'];

const SPECIALTY_OPTIONS = [
  { id: 'general', name: 'General Assistant', desc: 'Good at everything' },
  { id: 'coding', name: 'Coding & Dev', desc: 'Software engineering expert' },
  { id: 'research', name: 'Research & Analysis', desc: 'Deep research and insights' },
  { id: 'writing', name: 'Writing & Content', desc: 'Compelling writing and editing' },
];

export function SetupWizard({ onComplete }: Props) {
  const [step, setStep] = useState<Step>('welcome');
  const [selectedProvider, setSelectedProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [providerId, setProviderId] = useState('');

  const [agentName, setAgentName] = useState('');
  const [agentEmoji, setAgentEmoji] = useState('🤖');
  const [specialty, setSpecialty] = useState('general');
  const [creating, setCreating] = useState(false);

  const verifyAndSave = async () => {
    setVerifying(true);
    setVerifyError('');
    try {
      // Verify key
      const vRes = await fetch(`${API}/setup/verify-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetId: selectedProvider, apiKey: apiKey || undefined }),
      });
      const vData = await vRes.json();
      if (!vData.ok) { setVerifyError(vData.error); setVerifying(false); return; }

      // Save provider
      const pRes = await fetch(`${API}/setup/provider`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetId: selectedProvider, apiKey: apiKey || undefined, models: vData.models }),
      });
      const pData = await pRes.json();
      if (!pData.ok) { setVerifyError('Failed to save provider'); setVerifying(false); return; }

      setModels(vData.models ?? []);
      setProviderId(pData.provider.id);
      setStep('agent');
    } catch (e: any) {
      setVerifyError(e.message ?? 'Connection failed');
    }
    setVerifying(false);
  };

  const createAndFinish = async () => {
    setCreating(true);
    try {
      await fetch(`${API}/setup/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: agentName || 'Atlas',
          emoji: agentEmoji,
          specialty,
          providerId,
          model: models[0] ?? 'gpt-4o',
        }),
      });
      setStep('done');
      setTimeout(onComplete, 2000);
    } catch { /* ignore */ }
    setCreating(false);
  };

  const needsKey = PROVIDER_OPTIONS.find(p => p.id === selectedProvider)?.needsKey ?? true;

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 480, animation: 'fadeIn 0.3s ease' }}>

        {/* ── Step: Welcome ── */}
        {step === 'welcome' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 64, marginBottom: 24 }}>✨</div>
            <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8, background: 'linear-gradient(135deg, #7c5bf5, #f97066)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Welcome to SuperClaw
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: 16, marginBottom: 40, lineHeight: 1.6 }}>
              Your personal AI assistant platform.<br/>
              Let's get you set up in 3 easy steps.
            </p>
            <button onClick={() => setStep('provider')} style={{
              padding: '14px 48px', background: 'var(--accent)', color: '#fff', borderRadius: 12,
              fontSize: 16, fontWeight: 600, transition: 'all 200ms',
            }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-hover)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
               onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.transform = 'none'; }}>
              Get Started →
            </button>
            <div style={{ marginTop: 24 }}>
              <StepIndicator current={0} total={3} />
            </div>
          </div>
        )}

        {/* ── Step: Provider ── */}
        {step === 'provider' && (
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Choose your LLM</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 24 }}>Where should your AI brain live?</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {PROVIDER_OPTIONS.map(p => (
                <button key={p.id} onClick={() => { setSelectedProvider(p.id); setVerifyError(''); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                    background: selectedProvider === p.id ? 'rgba(124,91,245,0.1)' : 'var(--surface)',
                    border: `1px solid ${selectedProvider === p.id ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 10, textAlign: 'left', transition: 'all 150ms',
                  }}>
                  <span style={{ fontSize: 24 }}>{p.icon}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.desc}</div>
                  </div>
                  {selectedProvider === p.id && <span style={{ marginLeft: 'auto', color: 'var(--accent)' }}>✓</span>}
                </button>
              ))}
            </div>

            {selectedProvider && needsKey && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 6, display: 'block' }}>API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  style={{
                    width: '100%', padding: '10px 14px', background: 'var(--surface)',
                    border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)',
                    fontSize: 14, outline: 'none',
                  }}
                  onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                  onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
                />
              </div>
            )}

            {verifyError && (
              <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: '#ef4444', fontSize: 13, marginBottom: 16 }}>
                {verifyError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setStep('welcome')} style={{
                padding: '10px 20px', background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 8, color: 'var(--text-secondary)', fontSize: 14,
              }}>← Back</button>
              <button onClick={verifyAndSave} disabled={!selectedProvider || (needsKey && !apiKey) || verifying}
                style={{
                  flex: 1, padding: '10px 20px', background: 'var(--accent)', color: '#fff',
                  borderRadius: 8, fontSize: 14, fontWeight: 600,
                  opacity: (!selectedProvider || (needsKey && !apiKey) || verifying) ? 0.5 : 1,
                  transition: 'all 200ms',
                }}>
                {verifying ? 'Verifying...' : 'Verify & Continue →'}
              </button>
            </div>
            <div style={{ marginTop: 20, textAlign: 'center' }}><StepIndicator current={1} total={3} /></div>
          </div>
        )}

        {/* ── Step: Agent ── */}
        {step === 'agent' && (
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Create your first agent</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 24 }}>Give it a name and personality</p>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 6, display: 'block' }}>Name</label>
              <input value={agentName} onChange={e => setAgentName(e.target.value)} placeholder="Atlas"
                style={{ width: '100%', padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 14, outline: 'none' }}
                onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 8, display: 'block' }}>Emoji</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {EMOJI_OPTIONS.map(e => (
                  <button key={e} onClick={() => setAgentEmoji(e)}
                    style={{
                      width: 40, height: 40, fontSize: 20, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: agentEmoji === e ? 'rgba(124,91,245,0.2)' : 'var(--surface)',
                      border: `1px solid ${agentEmoji === e ? 'var(--accent)' : 'var(--border)'}`,
                      transition: 'all 150ms',
                    }}>{e}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 8, display: 'block' }}>Specialty</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {SPECIALTY_OPTIONS.map(s => (
                  <button key={s.id} onClick={() => setSpecialty(s.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', textAlign: 'left',
                      background: specialty === s.id ? 'rgba(124,91,245,0.1)' : 'var(--surface)',
                      border: `1px solid ${specialty === s.id ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 8, transition: 'all 150ms',
                    }}>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{s.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.desc}</div>
                    </div>
                    {specialty === s.id && <span style={{ marginLeft: 'auto', color: 'var(--accent)' }}>✓</span>}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setStep('provider')} style={{
                padding: '10px 20px', background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 8, color: 'var(--text-secondary)', fontSize: 14,
              }}>← Back</button>
              <button onClick={createAndFinish} disabled={creating}
                style={{
                  flex: 1, padding: '10px 20px', background: 'var(--green)', color: '#fff',
                  borderRadius: 8, fontSize: 14, fontWeight: 600, opacity: creating ? 0.5 : 1,
                }}>
                {creating ? 'Creating...' : 'Create Agent →'}
              </button>
            </div>
            <div style={{ marginTop: 20, textAlign: 'center' }}><StepIndicator current={2} total={3} /></div>
          </div>
        )}

        {/* ── Step: Done ── */}
        {step === 'done' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
            <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>You're all set!</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 15, marginBottom: 8 }}>
              Your agent <strong>{agentEmoji} {agentName || 'Atlas'}</strong> is ready to chat.
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Redirecting...</p>
            <div style={{ marginTop: 20 }}><StepIndicator current={3} total={3} /></div>
          </div>
        )}

        <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }`}</style>
      </div>
    </div>
  );
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} style={{
          width: i <= current ? 24 : 8, height: 8, borderRadius: 4,
          background: i <= current ? 'var(--accent)' : 'var(--border)',
          transition: 'all 300ms',
        }} />
      ))}
    </div>
  );
}
