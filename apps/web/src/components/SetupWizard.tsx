'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? '/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProviderInfo {
  id: string;
  name: string;
  type: string;
  status: 'connected' | 'not_configured' | 'error';
  models: Array<{ id: string; name: string }>;
}

interface CreatedAgent {
  id: string;
  name: string;
  emoji: string;
  role: string;
}

interface SetupWizardProps {
  onComplete: (agentId?: string) => void;
}

// ── Agent Templates ───────────────────────────────────────────────────────────

const AGENT_TEMPLATES = [
  {
    id: 'assistant',
    emoji: '✨',
    name: 'Personal Assistant',
    role: 'General Assistant',
    prompt: 'You are a helpful personal assistant. You help with research, planning, writing, analysis, and everyday tasks. You are concise, accurate, and proactive.',
    desc: 'Your everyday AI — research, plan, write, organize',
  },
  {
    id: 'coder',
    emoji: '⚡',
    name: 'Coder',
    role: 'Full-stack Developer',
    prompt: 'You are an expert full-stack developer. You write clean, well-tested TypeScript code. You break complex tasks into small, incremental steps. You prefer simple solutions over clever ones.',
    desc: 'Write, debug, and review code',
  },
  {
    id: 'writer',
    emoji: '🎭',
    name: 'Writer',
    role: 'Content Writer',
    prompt: 'You are a skilled content writer. You write clear, engaging prose adapted to the audience. You structure content logically and vary tone as needed — from formal to conversational.',
    desc: 'Articles, emails, social posts, docs',
  },
  {
    id: 'analyst',
    emoji: '💎',
    name: 'Analyst',
    role: 'Data Analyst',
    prompt: 'You are a data analyst. You examine data carefully, identify patterns and anomalies, and present findings with clear summaries. You question assumptions and validate sources.',
    desc: 'Crunch numbers and find insights',
  },
  {
    id: 'researcher',
    emoji: '🦉',
    name: 'Researcher',
    role: 'Research Specialist',
    prompt: 'You are a thorough researcher. You search multiple sources, cross-reference facts, and deliver well-structured reports with citations. You distinguish opinion from evidence.',
    desc: 'Deep research with sources and citations',
  },
  {
    id: 'custom',
    emoji: '🤖',
    name: 'Custom',
    role: '',
    prompt: '',
    desc: 'Build from scratch',
  },
];

const EMOJI_OPTIONS = [
  '🤖', '🧠', '⚡', '🐕', '🦊', '🐱', '🦉', '🐙',
  '🔮', '🚀', '💎', '🌟', '🎯', '🛡️', '🌈', '☕',
  '🎭', '👾', '🦄', '🐝', '🌸', '🍀', '🔥', '✨',
];

// ── Shared Styles ─────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: 'var(--surface, #161B22)',
  border: '1px solid var(--border, #30363d)',
  borderRadius: 12,
  padding: 20,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: 8,
  border: '1px solid var(--border, #30363d)',
  background: 'var(--input-bg, #0D1117)',
  color: 'var(--text, #e6edf3)',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 150ms',
};

const btnPrimary: React.CSSProperties = {
  padding: '10px 24px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--blue, #58a6ff)',
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'opacity 150ms, transform 100ms',
};

const btnSecondary: React.CSSProperties = {
  padding: '10px 20px',
  borderRadius: 8,
  border: '1px solid var(--border, #30363d)',
  background: 'transparent',
  color: 'var(--text, #e6edf3)',
  fontSize: 14,
  cursor: 'pointer',
  transition: 'background 150ms',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--text-muted, #8b949e)',
  marginBottom: 6,
};

// ── Step Indicator ────────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  const labels = ['Welcome', 'Provider', 'Agent', 'Channels', 'Ready'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 32 }}>
      {Array.from({ length: total }, (_, i) => {
        const step = i + 1;
        const isActive = step === current;
        const isCompleted = step < current;
        return (
          <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 600,
                  background: isCompleted
                    ? 'var(--green, #3fb950)'
                    : isActive
                      ? 'var(--blue, #58a6ff)'
                      : 'var(--surface, #161B22)',
                  color: isCompleted || isActive ? '#fff' : 'var(--text-muted, #8b949e)',
                  border: `2px solid ${
                    isCompleted ? 'var(--green, #3fb950)' : isActive ? 'var(--blue, #58a6ff)' : 'var(--border, #30363d)'
                  }`,
                  transition: 'all 250ms ease',
                }}
              >
                {isCompleted ? '✓' : step}
              </div>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? 'var(--text, #e6edf3)' : 'var(--text-muted, #8b949e)',
                  transition: 'color 200ms',
                }}
              >
                {labels[i]}
              </span>
            </div>
            {i < total - 1 && (
              <div
                style={{
                  width: 32,
                  height: 2,
                  background: isCompleted ? 'var(--green, #3fb950)' : 'var(--border, #30363d)',
                  marginBottom: 18,
                  transition: 'background 300ms',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Emoji Picker ──────────────────────────────────────────────────────────────

function EmojiPicker({ value, onChange }: { value: string; onChange: (e: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {EMOJI_OPTIONS.map((e) => (
        <button
          key={e}
          type="button"
          onClick={() => onChange(e)}
          style={{
            width: 34,
            height: 34,
            fontSize: 16,
            border: value === e ? '2px solid var(--blue, #58a6ff)' : '2px solid transparent',
            borderRadius: 8,
            background: value === e ? 'var(--surface-hover, #21262d)' : 'transparent',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 150ms',
          }}
        >
          {e}
        </button>
      ))}
    </div>
  );
}

// ── GitHub Copilot Auth Panel ─────────────────────────────────────────────────

function CopilotAuthPanel({ onToken }: { onToken: (token: string) => void }) {
  const [mode, setMode] = useState<'choose' | 'auto' | 'manual'>('choose');
  const [userCode, setUserCode] = useState('');
  const [verificationUri, setVerificationUri] = useState('');
  const [deviceCode, setDeviceCode] = useState('');
  const [pollStatus, setPollStatus] = useState<'idle' | 'waiting' | 'success' | 'error' | 'expired'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [manualToken, setManualToken] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const startAutoLogin = async () => {
    setMode('auto');
    setPollStatus('waiting');
    setErrorMsg('');
    try {
      const res = await fetch(`${API}/setup/copilot/device-code`, { method: 'POST' });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const json = await res.json() as { data: { device_code: string; user_code: string; verification_uri: string; interval: number } };
      const { device_code, user_code, verification_uri, interval } = json.data;
      setDeviceCode(device_code);
      setUserCode(user_code);
      setVerificationUri(verification_uri);

      // Open GitHub in new tab
      window.open(verification_uri, '_blank');

      // Start polling
      const pollInterval = Math.max((interval || 5) * 1000, 5000);
      pollRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch(`${API}/setup/copilot/poll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_code }),
          });
          if (!pollRes.ok) return;
          const pollJson = await pollRes.json() as { data: { status: string; token?: string; error?: string } };
          if (pollJson.data.status === 'success' && pollJson.data.token) {
            if (pollRef.current) clearInterval(pollRef.current);
            setPollStatus('success');
            onToken(pollJson.data.token);
          } else if (pollJson.data.status === 'expired') {
            if (pollRef.current) clearInterval(pollRef.current);
            setPollStatus('expired');
            setErrorMsg('Code expired. Please try again.');
          } else if (pollJson.data.status === 'error') {
            if (pollRef.current) clearInterval(pollRef.current);
            setPollStatus('error');
            setErrorMsg(pollJson.data.error || 'Authentication failed');
          }
        } catch { /* continue polling */ }
      }, pollInterval);
    } catch (err) {
      setPollStatus('error');
      setErrorMsg((err as Error).message);
    }
  };

  const handleManualSubmit = () => {
    if (manualToken.trim()) {
      onToken(manualToken.trim());
    }
  };

  const boxStyle: React.CSSProperties = {
    padding: '14px 16px',
    background: 'var(--surface-hover, #161b22)',
    borderRadius: 8,
    border: '1px solid var(--border, #30363d)',
    cursor: 'pointer',
    transition: 'border-color 150ms',
  };

  if (mode === 'choose') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--text-secondary, #c9d1d9)', marginBottom: 4 }}>
          Choose how to connect your GitHub Copilot account:
        </div>

        {/* Option A: Auto Login */}
        <div
          style={boxStyle}
          onClick={startAutoLogin}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--blue, #58a6ff)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border, #30363d)'; }}
        >
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text, #f0f6fc)', marginBottom: 4 }}>
            🔐 Auto Login (recommended)
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted, #8b949e)', lineHeight: 1.5 }}>
            Opens GitHub in your browser. Sign in and enter a code — HiveClaw handles the rest.
            Requires an active GitHub Copilot subscription.
          </div>
        </div>

        {/* Option B: Manual Token */}
        <div
          style={boxStyle}
          onClick={() => setMode('manual')}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--blue, #58a6ff)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border, #30363d)'; }}
        >
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text, #f0f6fc)', marginBottom: 4 }}>
            🔑 Paste Token Manually
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted, #8b949e)', lineHeight: 1.5 }}>
            Already have a Copilot API token? Paste it directly.
          </div>
        </div>

        <a
          href="https://github.com/settings/copilot"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 11, color: 'var(--blue, #58a6ff)', textDecoration: 'none', marginTop: 4 }}
        >
          🔗 Manage your GitHub Copilot subscription →
        </a>
      </div>
    );
  }

  if (mode === 'auto') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {pollStatus === 'waiting' && userCode && (
          <>
            <div style={{ fontSize: 12, color: 'var(--text-secondary, #c9d1d9)', lineHeight: 1.5 }}>
              A browser tab should have opened. If not, go to:
            </div>
            <a
              href={verificationUri}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block', textAlign: 'center', padding: '8px 16px',
                background: 'var(--surface-hover, #161b22)', borderRadius: 8,
                border: '1px solid var(--border, #30363d)',
                color: 'var(--blue, #58a6ff)', fontSize: 13, textDecoration: 'none',
              }}
            >
              {verificationUri}
            </a>
            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted, #8b949e)', marginBottom: 6 }}>
                Enter this code on GitHub:
              </div>
              <div style={{
                fontSize: 28, fontWeight: 700, fontFamily: 'var(--font-mono, monospace)',
                letterSpacing: 6, color: 'var(--text, #f0f6fc)',
                padding: '12px 24px', background: 'var(--surface-hover, #161b22)',
                borderRadius: 8, border: '1px solid var(--border, #30363d)',
                display: 'inline-block', userSelect: 'all',
              }}>
                {userCode}
              </div>
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center',
              marginTop: 8, padding: '10px 14px', borderRadius: 8,
              background: 'color-mix(in srgb, var(--blue, #58a6ff) 6%, transparent)',
              border: '1px solid color-mix(in srgb, var(--blue, #58a6ff) 20%, transparent)',
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: 'var(--blue, #58a6ff)',
                animation: 'pulse 1.5s infinite',
              }} />
              <span style={{ fontSize: 12, color: 'var(--text-secondary, #c9d1d9)' }}>
                Waiting for you to authorize on GitHub…
              </span>
            </div>
          </>
        )}
        {pollStatus === 'waiting' && !userCode && (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted, #8b949e)', fontSize: 13 }}>
            Contacting GitHub…
          </div>
        )}
        {pollStatus === 'success' && (
          <div style={{ textAlign: 'center', padding: 16 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--green, #3fb950)' }}>
              GitHub Copilot connected!
            </div>
          </div>
        )}
        {(pollStatus === 'error' || pollStatus === 'expired') && (
          <div style={{ textAlign: 'center', padding: 16 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>{pollStatus === 'expired' ? '⏱' : '❌'}</div>
            <div style={{ fontSize: 13, color: 'var(--coral, #f85149)', marginBottom: 12 }}>{errorMsg}</div>
            <button
              onClick={() => { setMode('choose'); setPollStatus('idle'); setErrorMsg(''); }}
              style={{
                padding: '8px 20px', borderRadius: 8,
                background: 'var(--surface-hover, #161b22)', border: '1px solid var(--border, #30363d)',
                color: 'var(--text, #f0f6fc)', cursor: 'pointer', fontSize: 12,
              }}
            >
              Try again
            </button>
          </div>
        )}
        {pollStatus !== 'success' && (
          <button
            onClick={() => { if (pollRef.current) clearInterval(pollRef.current); setMode('choose'); setPollStatus('idle'); }}
            style={{ fontSize: 11, color: 'var(--text-muted, #8b949e)', background: 'none', border: 'none', cursor: 'pointer', alignSelf: 'center' }}
          >
            ← Back
          </button>
        )}
      </div>
    );
  }

  // Manual mode
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted, #8b949e)', textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: 4, display: 'block' }}>
          Copilot Token
        </label>
        <input
          type="password"
          placeholder="Paste your Copilot token"
          value={manualToken}
          onChange={(e) => setManualToken(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && manualToken) handleManualSubmit(); }}
          style={{
            width: '100%', padding: '9px 12px',
            background: 'var(--bg, #0d1117)', border: '1px solid var(--border, #30363d)',
            borderRadius: 8, color: 'var(--text, #f0f6fc)', fontSize: 13,
            outline: 'none', boxSizing: 'border-box' as const,
          }}
          autoFocus
        />
      </div>
      <div style={{ padding: '10px 12px', background: 'var(--surface-hover, #161b22)', borderRadius: 8, border: '1px solid var(--border, #30363d)' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted, #8b949e)', marginBottom: 6 }}>
          📋 How to get a Copilot token:
        </div>
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: 'var(--text-muted, #8b949e)', lineHeight: 1.8 }}>
          <li>Install GitHub CLI: <code style={{ background: 'var(--surface, #0d1117)', padding: '1px 5px', borderRadius: 3 }}>brew install gh</code></li>
          <li>Authenticate: <code style={{ background: 'var(--surface, #0d1117)', padding: '1px 5px', borderRadius: 3 }}>gh auth login</code></li>
          <li>Get token: <code style={{ background: 'var(--surface, #0d1117)', padding: '1px 5px', borderRadius: 3 }}>gh auth token</code></li>
          <li>Paste the token above</li>
        </ol>
      </div>
      {manualToken && (
        <button
          onClick={handleManualSubmit}
          style={{
            padding: '9px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: 'var(--coral, #f85149)', border: 'none', color: '#fff', cursor: 'pointer',
            alignSelf: 'flex-start',
          }}
        >
          Connect
        </button>
      )}
      <button
        onClick={() => setMode('choose')}
        style={{ fontSize: 11, color: 'var(--text-muted, #8b949e)', background: 'none', border: 'none', cursor: 'pointer', alignSelf: 'center' }}
      >
        ← Back
      </button>
    </div>
  );
}

// ── Main Wizard ───────────────────────────────────────────────────────────────

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(1);
  const [flowMode, setFlowMode] = useState<'new' | 'connect' | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [configuredProviders, setConfiguredProviders] = useState<Set<string>>(new Set());
  const [fadeIn, setFadeIn] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Step 2 state
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [baseUrlInput, setBaseUrlInput] = useState('');
  const [customProviderName, setCustomProviderName] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState('');
  const [testedModels, setTestedModels] = useState<string[]>([]);

  // Step 3 state
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [agentName, setAgentName] = useState('');
  const [agentEmoji, setAgentEmoji] = useState('🤖');
  const [agentRole, setAgentRole] = useState('');
  const [agentPrompt, setAgentPrompt] = useState('');
  const [agentProvider, setAgentProvider] = useState('');
  const [agentModel, setAgentModel] = useState('');
  const [createdAgent, setCreatedAgent] = useState<CreatedAgent | null>(null);
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  // Step 4 state (Channels)
  const [channelExpanded, setChannelExpanded] = useState<string | null>(null);
  const [channelToken, setChannelToken] = useState('');
  const [channelSaving, setChannelSaving] = useState(false);
  const [channelSaved, setChannelSaved] = useState<string | null>(null);
  const [channelError, setChannelError] = useState('');

  // Step 5 state (Ready)
  const [chatMessage, setChatMessage] = useState('');
  const [chatResponse, setChatResponse] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [completing, setCompleting] = useState(false);

  // Fade in on mount
  useEffect(() => {
    const t = setTimeout(() => setFadeIn(true), 50);
    return () => clearTimeout(t);
  }, []);

  // Fetch providers
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${API}/setup/status`);
        const json = await res.json() as { data: { providers: ProviderInfo[] } };
        setProviders(json.data.providers);
        const configured = new Set(
          json.data.providers
            .filter((p: ProviderInfo) => p.status === 'connected' && p.type !== 'ollama')
            .map((p: ProviderInfo) => p.id),
        );
        setConfiguredProviders(configured);
      } catch {
        /* server not yet reachable */
      }
    })();
  }, []);

  // Auto-select provider for agent when entering step 3
  useEffect(() => {
    if (step === 3 && !agentProvider && configuredProviders.size > 0) {
      const first = Array.from(configuredProviders)[0];
      setAgentProvider(first);
      const prov = providers.find((p) => p.id === first);
      if (prov?.models[0]) setAgentModel(prov.models[0].id);
    }
  }, [step, agentProvider, configuredProviders, providers]);

  // Scroll to top on step change
  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);

  const PROVIDER_CARDS = [
    {
      id: 'anthropic', name: 'Anthropic', icon: '🟣', desc: 'Claude Opus 4, Sonnet 4, Haiku 4.5',
      hint: 'Two options: Console API key (pay-per-use) OR Claude Code OAuth token (subscription)',
      steps: [
        '💳 Option A — Pay-per-use API key (recommended):',
        'Go to console.anthropic.com → Settings → API Keys → Create Key',
        'Copy the key (starts with sk-ant-api…) and paste below',
        'This is billed per usage (pay only for what you use)',
        '─────────────────────────',
        '💡 Option B — Claude Max/Pro subscription token:',
        'Install Claude Code CLI: npm i -g @anthropic-ai/claude-code',
        'Run "claude" in your terminal → complete the browser login',
        'The OAuth token is saved in your OS keychain',
        'macOS: run "security find-generic-password -s claude-code -w" to extract it',
        'The token starts with sk-ant-oat… — paste it below',
        'This uses your existing subscription — no extra charges!',
      ],
      url: 'https://console.anthropic.com/settings/keys',
    },
    {
      id: 'openai', name: 'OpenAI', icon: '🟢', desc: 'GPT-4o, o3, o4-mini',
      hint: 'platform.openai.com → API Keys',
      steps: [
        'Go to platform.openai.com and sign up or log in',
        'Click API Keys in the left sidebar (or Settings → API Keys)',
        'Click "Create new secret key", name it, click Create',
        'Copy the key (starts with sk-…) and paste it below',
      ],
      url: 'https://platform.openai.com/api-keys',
    },
    {
      id: 'google', name: 'Google AI', icon: '🔵', desc: 'Gemini 2.5 Pro, Flash',
      hint: 'aistudio.google.com — free tier available',
      steps: [
        'Go to aistudio.google.com and sign in with Google',
        'Click "Get API key" in the top bar',
        'Click "Create API key in new project" (or choose existing)',
        'Copy the key and paste it below — free tier included!',
      ],
      url: 'https://aistudio.google.com/apikey',
    },
    {
      id: 'openrouter', name: 'OpenRouter', icon: '🔀', desc: '100+ models, one key',
      hint: 'One API key → Claude, GPT, Gemini, Llama, and more',
      steps: [
        'Go to openrouter.ai and sign up or log in',
        'Click Keys in the top-right menu',
        'Click "Create Key", name it, click Create',
        'Copy the key (starts with sk-or-…) and paste it below',
        'Add credits ($5 minimum) to start using paid models',
      ],
      url: 'https://openrouter.ai/keys',
    },
    {
      id: 'deepseek', name: 'DeepSeek', icon: '🐋', desc: 'DeepSeek V3, R1',
      hint: 'platform.deepseek.com → API Keys',
      steps: [
        'Go to platform.deepseek.com and sign up or log in',
        'Click API Keys in the left sidebar',
        'Click "Create new API key", name it',
        'Copy the key and paste it below',
      ],
      url: 'https://platform.deepseek.com/api_keys',
    },
    {
      id: 'groq', name: 'Groq', icon: '⚡', desc: 'Ultra-fast inference',
      hint: 'console.groq.com — free tier available',
      steps: [
        'Go to console.groq.com and sign up (Google/GitHub login)',
        'Click API Keys in the left sidebar',
        'Click "Create API Key", name it',
        'Copy the key (starts with gsk_…) and paste it below',
        'Free tier: 14,400 requests/day for most models!',
      ],
      url: 'https://console.groq.com/keys',
    },
    {
      id: 'mistral', name: 'Mistral', icon: '🇫🇷', desc: 'Mistral Large, Codestral',
      hint: 'console.mistral.ai → API Keys',
      steps: [
        'Go to console.mistral.ai and sign up or log in',
        'Click API Keys in the left sidebar',
        'Click "Create new key", name it',
        'Copy the key and paste it below',
      ],
      url: 'https://console.mistral.ai/api-keys',
    },
    {
      id: 'ollama', name: 'Ollama', icon: '🦙', desc: 'Local models (free)',
      hint: 'No API key needed — runs on your machine',
      steps: [
        'Download and install from ollama.com',
        'Open Terminal and run: ollama pull llama3.3',
        'Ollama runs at localhost:11434 by default',
        'No API key needed — just paste the base URL below',
      ],
      url: 'https://ollama.com/download',
    },
    {
      id: 'github-copilot', name: 'GitHub Copilot', icon: '🐙', desc: 'Claude, GPT-4o via GitHub',
      hint: 'Requires GitHub Copilot subscription',
      steps: [
        'You need an active GitHub Copilot subscription (Individual, Business, or Enterprise)',
        'Choose Auto Login below to authenticate via your browser',
        'Or paste a token manually if you already have one',
      ],
      url: 'https://github.com/settings/copilot',
    },
    {
      id: 'custom', name: 'Other', icon: '🔧', desc: 'Any OpenAI-compatible API',
      hint: 'Together AI, Fireworks, Azure, Perplexity, LM Studio, vLLM…',
      steps: [
        'Get the base URL from your provider (e.g. https://api.together.xyz)',
        'Must support the /v1/chat/completions endpoint',
        'Get an API key from your provider\'s dashboard',
        'Enter the name, base URL, and key below',
      ],
    },
  ];

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleTestConnection = useCallback(async () => {
    if (!activeProvider) return;
    setTestStatus('testing');
    setTestError('');
    setTestedModels([]);
    try {
      const body: Record<string, string> = { providerId: activeProvider, apiKey: apiKeyInput };
      if (activeProvider === 'ollama' && baseUrlInput) body.baseUrl = baseUrlInput;
      if (activeProvider === 'custom') {
        body.baseUrl = baseUrlInput;
        if (customProviderName) body.name = customProviderName;
      }
      const res = await fetch(`${API}/setup/provider`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json() as { data?: { success: boolean; models?: string[]; error?: string } };
      if (json.data?.success) {
        setTestStatus('success');
        setTestedModels(json.data.models ?? []);
        setConfiguredProviders((prev) => new Set([...prev, activeProvider]));
        const statusRes = await fetch(`${API}/setup/status`);
        const statusJson = await statusRes.json() as { data: { providers: ProviderInfo[] } };
        setProviders(statusJson.data.providers);
      } else {
        setTestStatus('error');
        setTestError(json.data?.error ?? 'Connection failed');
      }
    } catch (err) {
      setTestStatus('error');
      setTestError((err as Error).message);
    }
  }, [activeProvider, apiKeyInput, baseUrlInput]);

  const handleSelectTemplate = (tplId: string) => {
    setSelectedTemplate(tplId);
    const tpl = AGENT_TEMPLATES.find((t) => t.id === tplId);
    if (tpl) {
      setAgentName(tpl.name === 'Custom' ? '' : tpl.name);
      setAgentEmoji(tpl.emoji);
      setAgentRole(tpl.role);
      setAgentPrompt(tpl.prompt);
    }
  };

  const handleCreateAgent = useCallback(async () => {
    setCreateError('');
    setCreating(true);
    if (!agentName || !agentRole || !agentPrompt) {
      setCreateError('Name, role, and system prompt are required');
      setCreating(false);
      return;
    }
    try {
      const res = await fetch(`${API}/setup/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: agentName,
          emoji: agentEmoji,
          role: agentRole,
          systemPrompt: agentPrompt,
          providerId: agentProvider,
          modelId: agentModel,
        }),
      });
      const json = await res.json() as { data?: CreatedAgent; error?: { message: string } };
      if (res.ok && json.data) {
        setCreatedAgent(json.data);
      } else {
        setCreateError(json.error?.message ?? 'Failed to create agent');
      }
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }, [agentName, agentEmoji, agentRole, agentPrompt, agentProvider, agentModel]);

  const handleTestChat = useCallback(async () => {
    if (!createdAgent || !chatMessage.trim()) return;
    setChatLoading(true);
    setChatResponse('');
    try {
      const res = await fetch(`${API}/setup/test-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: createdAgent.id, message: chatMessage }),
      });
      const json = await res.json() as { data?: { response: string }; error?: { message: string } };
      if (res.ok && json.data) {
        setChatResponse(json.data.response);
      } else {
        setChatResponse(`Error: ${json.error?.message ?? 'Unknown error'}`);
      }
    } catch (err) {
      setChatResponse(`Error: ${(err as Error).message}`);
    } finally {
      setChatLoading(false);
    }
  }, [createdAgent, chatMessage]);

  const handleComplete = useCallback(async () => {
    setCompleting(true);
    try {
      await fetch(`${API}/setup/complete`, { method: 'POST' });
      onComplete(createdAgent?.id);
    } catch {
      onComplete(createdAgent?.id);
    }
  }, [onComplete, createdAgent]);

  const selectProvider = (id: string) => {
    setActiveProvider(id);
    setApiKeyInput('');
    setBaseUrlInput('');
    setTestStatus('idle');
    setTestError('');
    setTestedModels([]);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'var(--bg, #0D1117)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        overflow: 'auto',
        fontFamily: 'var(--font-sans, system-ui, sans-serif)',
        opacity: fadeIn ? 1 : 0,
        transition: 'opacity 400ms ease',
      }}
    >
      <div style={{ width: '100%', maxWidth: 600 }}>
        <StepIndicator current={step} total={5} />

        {/* ═══════════════════════ Step 1: Welcome ═══════════════════════════ */}
        {step === 1 && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 64, marginBottom: 16, lineHeight: 1 }}>⚡</div>
            <h1
              style={{
                fontSize: 32,
                fontWeight: 800,
                margin: 0,
                background: 'linear-gradient(135deg, var(--coral, #FF6B6B), #ff8f8f)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              Welcome to HiveClaw
            </h1>
            <p style={{ color: 'var(--text-muted, #8b949e)', fontSize: 16, marginTop: 12, lineHeight: 1.6, maxWidth: 460, marginLeft: 'auto', marginRight: 'auto' }}>
              Your personal AI assistant. Let&apos;s set things up.
            </p>

            {/* What you'll do */}
            <div style={{ ...cardStyle, marginTop: 32, textAlign: 'left', padding: 24 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { icon: '🔑', text: 'Connect your AI provider (OpenAI, Anthropic, Google, Ollama…)' },
                  { icon: '🤖', text: 'Create your first agent from a template or from scratch' },
                  { icon: '💬', text: 'Test it with a chat message' },
                ].map((item) => (
                  <div key={item.text} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 20, minWidth: 28, textAlign: 'center' }}>{item.icon}</span>
                    <span style={{ fontSize: 14, color: 'var(--text-muted, #8b949e)' }}>{item.text}</span>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted, #8b949e)', margin: '16px 0 0', opacity: 0.7 }}>
                Takes about 2 minutes. You can change everything later in Settings.
              </p>
            </div>

            <div style={{ marginTop: 24, textAlign: 'center' }}>
              <button
                type="button"
                onClick={() => { setFlowMode('new'); setStep(2); }}
                style={{ ...btnPrimary, padding: '14px 32px', fontSize: 16 }}
              >
                Let&apos;s Go 🚀
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, color: 'var(--text, #e6edf3)' }}>
              Connect an AI Provider
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted, #8b949e)', marginBottom: 20 }}>
              You need at least one provider to power your agents. You can add more later in Settings.
            </p>

            {/* Provider cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 20 }}>
              {PROVIDER_CARDS.map((p) => {
                const isConfigured = configuredProviders.has(p.id);
                const isSelected = activeProvider === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectProvider(p.id)}
                    style={{
                      ...cardStyle,
                      padding: 14,
                      cursor: 'pointer',
                      textAlign: 'left',
                      borderColor: isSelected
                        ? 'var(--blue, #58a6ff)'
                        : isConfigured
                          ? 'var(--green, #3fb950)'
                          : 'var(--border, #30363d)',
                      position: 'relative',
                      transition: 'border-color 150ms, background 150ms',
                      background: isSelected ? 'var(--surface-hover, #21262d)' : 'var(--surface, #161B22)',
                    }}
                  >
                    {isConfigured && (
                      <span style={{ position: 'absolute', top: 8, right: 10, fontSize: 13, color: 'var(--green, #3fb950)', fontWeight: 600 }}>
                        ✓ Connected
                      </span>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 20 }}>{p.icon}</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text, #e6edf3)' }}>{p.name}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted, #8b949e)' }}>{p.desc}</div>
                  </button>
                );
              })}
            </div>

            {/* API key form */}
            {activeProvider && (
              <div style={{ ...cardStyle, marginBottom: 16 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {activeProvider !== 'ollama' && activeProvider !== 'custom' && activeProvider !== 'github-copilot' ? (
                    <div>
                      <label style={labelStyle}>API Key</label>
                      <input
                        type="password"
                        placeholder={`Paste your ${PROVIDER_CARDS.find((p) => p.id === activeProvider)?.name ?? ''} API key`}
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && apiKeyInput) void handleTestConnection(); }}
                        style={inputStyle}
                        autoFocus
                      />
                      {(() => {
                        const prov = PROVIDER_CARDS.find((p) => p.id === activeProvider);
                        if (!prov) return null;
                        return (
                          <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--surface-hover, #161b22)', borderRadius: 8, border: '1px solid var(--border, #30363d)' }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted, #8b949e)', marginBottom: 6 }}>
                              📋 How to get your {prov.name} API key:
                            </div>
                            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: 'var(--text-muted, #8b949e)', lineHeight: 1.8 }}>
                              {prov.steps.map((s, i) => <li key={i}>{s}</li>)}
                            </ol>
                            {prov.url && (
                              <a
                                href={prov.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ display: 'inline-block', marginTop: 8, fontSize: 11, color: 'var(--blue, #58a6ff)', textDecoration: 'none' }}
                              >
                                🔗 Open {prov.name} dashboard →
                              </a>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  ) : activeProvider === 'github-copilot' ? (
                    <CopilotAuthPanel
                      onToken={async (token) => {
                        setApiKeyInput(token);
                        setTestStatus('testing');
                        setTestError('');
                        // Auto-save provider to backend
                        try {
                          const res = await fetch(`${API}/setup/provider`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ providerId: 'github-copilot', apiKey: token }),
                          });
                          const json = await res.json() as { data?: { success: boolean; error?: string } };
                          if (json.data?.success) {
                            setTestStatus('success');
                            setConfiguredProviders((prev) => new Set([...prev, 'github-copilot']));
                            const statusRes = await fetch(`${API}/setup/status`);
                            const statusJson = await statusRes.json() as { data: { providers: ProviderInfo[] } };
                            setProviders(statusJson.data.providers);
                          } else {
                            setTestStatus('error');
                            setTestError(json.data?.error ?? 'Failed to save provider');
                          }
                        } catch (err) {
                          setTestStatus('error');
                          setTestError((err as Error).message);
                        }
                      }}
                    />
                  ) : activeProvider === 'custom' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div>
                        <label style={labelStyle}>Provider Name</label>
                        <input
                          type="text"
                          placeholder="e.g. Together AI, Fireworks, Azure OpenAI…"
                          value={customProviderName}
                          onChange={(e) => setCustomProviderName(e.target.value)}
                          style={inputStyle}
                          autoFocus
                        />
                      </div>
                      <div>
                        <label style={labelStyle}>Base URL</label>
                        <input
                          type="text"
                          placeholder="e.g. https://api.together.xyz"
                          value={baseUrlInput}
                          onChange={(e) => setBaseUrlInput(e.target.value)}
                          style={inputStyle}
                        />
                        <p style={{ fontSize: 11, color: 'var(--text-muted, #8b949e)', marginTop: 4, marginBottom: 0 }}>
                          Must be OpenAI-compatible (supports <code style={{ background: 'var(--surface-hover)', padding: '1px 5px', borderRadius: 3 }}>/v1/chat/completions</code>)
                        </p>
                      </div>
                      <div>
                        <label style={labelStyle}>API Key</label>
                        <input
                          type="password"
                          placeholder="Paste your API key"
                          value={apiKeyInput}
                          onChange={(e) => setApiKeyInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && apiKeyInput && baseUrlInput) void handleTestConnection(); }}
                          style={inputStyle}
                        />
                      </div>
                      <p style={{ fontSize: 11, color: 'var(--text-muted, #8b949e)', marginTop: 0, marginBottom: 0 }}>
                        💡 Any provider with an OpenAI-compatible API works — Together AI, Fireworks, Azure, Perplexity, LM Studio, vLLM, etc.
                      </p>
                    </div>
                  ) : activeProvider === 'ollama' ? (
                    <div>
                      <label style={labelStyle}>Base URL</label>
                      <input
                        type="text"
                        placeholder="http://localhost:11434 (default)"
                        value={baseUrlInput}
                        onChange={(e) => setBaseUrlInput(e.target.value)}
                        style={inputStyle}
                      />
                      <p style={{ fontSize: 11, color: 'var(--text-muted, #8b949e)', marginTop: 6, marginBottom: 0 }}>
                        💡 Install Ollama from ollama.com, then run: <code style={{ background: 'var(--surface-hover)', padding: '1px 5px', borderRadius: 3 }}>ollama pull llama3</code>
                      </p>
                    </div>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => void handleTestConnection()}
                    disabled={testStatus === 'testing' || (activeProvider !== 'ollama' && activeProvider !== 'github-copilot' && !apiKeyInput && activeProvider !== 'custom')}
                    style={{
                      ...btnPrimary,
                      opacity: testStatus === 'testing' || (activeProvider !== 'ollama' && activeProvider !== 'github-copilot' && !apiKeyInput && activeProvider !== 'custom') ? 0.4 : 1,
                      alignSelf: 'flex-start',
                    }}
                  >
                    {testStatus === 'testing' ? '⏳ Testing…' : '🔌 Test Connection'}
                  </button>

                  {testStatus === 'success' && (
                    <div style={{ padding: 10, borderRadius: 8, background: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.3)', fontSize: 13 }}>
                      <span style={{ color: 'var(--green, #3fb950)', fontWeight: 600 }}>✓ Connected!</span>
                      {testedModels.length > 0 && (
                        <span style={{ color: 'var(--text-muted, #8b949e)', marginLeft: 8 }}>
                          {testedModels.length} model{testedModels.length !== 1 ? 's' : ''} available
                        </span>
                      )}
                    </div>
                  )}

                  {testStatus === 'error' && (
                    <div style={{ padding: 10, borderRadius: 8, background: 'rgba(255,107,107,0.1)', border: '1px solid rgba(255,107,107,0.3)', fontSize: 13, color: 'var(--coral, #ff6b6b)' }}>
                      ✗ {testError}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
              <button type="button" onClick={() => setStep(1)} style={btnSecondary}>
                ← Back
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                disabled={configuredProviders.size === 0}
                style={{ ...btnPrimary, opacity: configuredProviders.size === 0 ? 0.35 : 1 }}
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* ═══════════════════════ Step 3: Agent ═════════════════════════════ */}
        {step === 3 && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, color: 'var(--text, #e6edf3)' }}>
              Create Your First Agent
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted, #8b949e)', marginBottom: 20 }}>
              Pick a template to get started quickly, or build a custom agent.
            </p>

            {/* Template cards */}
            {!selectedTemplate && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 20 }}>
                {AGENT_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => handleSelectTemplate(tpl.id)}
                    style={{
                      ...cardStyle,
                      padding: 16,
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'border-color 150ms, background 150ms',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--blue, #58a6ff)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border, #30363d)'; }}
                  >
                    <div style={{ fontSize: 28, marginBottom: 8 }}>{tpl.emoji}</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text, #e6edf3)' }}>{tpl.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted, #8b949e)', marginTop: 4 }}>{tpl.desc}</div>
                  </button>
                ))}
              </div>
            )}

            {/* Agent form (shown after template selected) */}
            {selectedTemplate && !createdAgent && (
              <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <label style={labelStyle}>Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Coder"
                      value={agentName}
                      onChange={(e) => setAgentName(e.target.value)}
                      style={inputStyle}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Icon</label>
                    <EmojiPicker value={agentEmoji} onChange={setAgentEmoji} />
                  </div>
                </div>

                <div>
                  <label style={labelStyle}>Role</label>
                  <input
                    type="text"
                    placeholder="e.g. Full-stack developer"
                    value={agentRole}
                    onChange={(e) => setAgentRole(e.target.value)}
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={labelStyle}>System Prompt</label>
                  <textarea
                    rows={4}
                    placeholder="Describe how this agent should behave…"
                    value={agentPrompt}
                    onChange={(e) => setAgentPrompt(e.target.value)}
                    style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }}
                  />
                </div>

                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <label style={labelStyle}>Provider</label>
                    <select
                      value={agentProvider}
                      onChange={(e) => {
                        setAgentProvider(e.target.value);
                        const prov = providers.find((p) => p.id === e.target.value);
                        if (prov?.models[0]) setAgentModel(prov.models[0].id);
                      }}
                      style={inputStyle}
                    >
                      {providers
                        .filter((p) => configuredProviders.has(p.id) || p.type === 'ollama')
                        .map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <label style={labelStyle}>Model</label>
                    <select
                      value={agentModel}
                      onChange={(e) => setAgentModel(e.target.value)}
                      style={inputStyle}
                    >
                      {providers
                        .find((p) => p.id === agentProvider)
                        ?.models.map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => void handleCreateAgent()}
                    disabled={creating || !agentName || !agentRole || !agentPrompt}
                    style={{
                      ...btnPrimary,
                      opacity: creating || !agentName || !agentRole || !agentPrompt ? 0.4 : 1,
                    }}
                  >
                    {creating ? '⏳ Creating…' : '✨ Create Agent'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSelectedTemplate(null); setAgentName(''); setAgentRole(''); setAgentPrompt(''); }}
                    style={{ ...btnSecondary, padding: '10px 14px', fontSize: 13 }}
                  >
                    ← Pick different template
                  </button>
                </div>

                {createError && (
                  <div style={{ fontSize: 13, color: 'var(--coral, #ff6b6b)' }}>{createError}</div>
                )}
              </div>
            )}

            {/* Success state */}
            {createdAgent && (
              <div style={{ ...cardStyle, textAlign: 'center', padding: 28 }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>{createdAgent.emoji}</div>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text, #e6edf3)', margin: 0 }}>
                  {createdAgent.name}
                </h3>
                <p style={{ fontSize: 13, color: 'var(--text-muted, #8b949e)', marginTop: 4 }}>
                  {createdAgent.role}
                </p>
                <div style={{ marginTop: 12, padding: 8, borderRadius: 6, background: 'rgba(63,185,80,0.1)', display: 'inline-block' }}>
                  <span style={{ color: 'var(--green, #3fb950)', fontSize: 13, fontWeight: 600 }}>✓ Agent created</span>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
              <button type="button" onClick={() => setStep(2)} style={btnSecondary}>
                ← Back
              </button>
              <button
                type="button"
                onClick={() => setStep(4)}
                disabled={!createdAgent}
                style={{ ...btnPrimary, opacity: !createdAgent ? 0.35 : 1 }}
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* ═══════════════════════ Step 4: Channels (optional) ═════════════ */}
        {step === 4 && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, color: 'var(--text, #e6edf3)' }}>
              Connect a messaging channel
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted, #8b949e)', marginBottom: 20 }}>
              Chat with your agent from Telegram, Discord, or Slack. This is optional — you can always add channels later in Settings.
            </p>

            {/* Channel cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {([
                { id: 'telegram', icon: '✈️', name: 'Telegram', desc: 'Create a bot via @BotFather, paste the token', field: 'Bot Token', placeholder: '123456:ABC-DEF...' },
                { id: 'discord', icon: '🎮', name: 'Discord', desc: 'Create a webhook in your server channel settings', field: 'Webhook URL', placeholder: 'https://discord.com/api/webhooks/...' },
                { id: 'slack', icon: '💼', name: 'Slack', desc: 'Create an incoming webhook in your Slack workspace', field: 'Webhook URL', placeholder: 'https://hooks.slack.com/services/...' },
                { id: 'whatsapp', icon: '💬', name: 'WhatsApp', desc: 'Via Twilio or Meta Cloud API (advanced)', field: 'Account SID', placeholder: 'ACxxxxxxxx' },
              ] as const).map((ch) => {
                const isExpanded = channelExpanded === ch.id;
                return (
                  <div key={ch.id} style={{ ...cardStyle }}>
                    <button
                      type="button"
                      onClick={() => setChannelExpanded(isExpanded ? null : ch.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                        background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ fontSize: 24 }}>{ch.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text, #e6edf3)' }}>{ch.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted, #8b949e)' }}>{ch.desc}</div>
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--text-muted, #8b949e)', transition: 'transform 200ms', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)' }}>▼</span>
                    </button>

                    {isExpanded && (
                      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {ch.id === 'telegram' && (
                          <>
                            <label style={labelStyle}>Bot Token</label>
                            <input
                              type="password"
                              placeholder={ch.placeholder}
                              value={channelToken}
                              onChange={(e) => setChannelToken(e.target.value)}
                              style={inputStyle}
                            />
                            <p style={{ fontSize: 11, color: 'var(--text-muted, #8b949e)', margin: 0 }}>
                              💡 Open Telegram → search @BotFather → /newbot → copy the token
                            </p>
                          </>
                        )}
                        {ch.id === 'discord' && (
                          <>
                            <label style={labelStyle}>Webhook URL</label>
                            <input
                              type="text"
                              placeholder={ch.placeholder}
                              value={channelToken}
                              onChange={(e) => setChannelToken(e.target.value)}
                              style={inputStyle}
                            />
                            <p style={{ fontSize: 11, color: 'var(--text-muted, #8b949e)', margin: 0 }}>
                              💡 Server Settings → Integrations → Webhooks → New Webhook → Copy URL
                            </p>
                          </>
                        )}
                        {ch.id === 'slack' && (
                          <>
                            <label style={labelStyle}>Webhook URL</label>
                            <input
                              type="text"
                              placeholder={ch.placeholder}
                              value={channelToken}
                              onChange={(e) => setChannelToken(e.target.value)}
                              style={inputStyle}
                            />
                            <p style={{ fontSize: 11, color: 'var(--text-muted, #8b949e)', margin: 0 }}>
                              💡 api.slack.com → Your Apps → Incoming Webhooks → Add to Slack
                            </p>
                          </>
                        )}
                        {ch.id === 'whatsapp' && (
                          <>
                            <label style={labelStyle}>Account SID (Twilio)</label>
                            <input
                              type="password"
                              placeholder={ch.placeholder}
                              value={channelToken}
                              onChange={(e) => setChannelToken(e.target.value)}
                              style={inputStyle}
                            />
                            <p style={{ fontSize: 11, color: 'var(--text-muted, #8b949e)', margin: 0 }}>
                              💡 Requires a Twilio account with WhatsApp sandbox or Meta Cloud API
                            </p>
                          </>
                        )}
                        <button
                          type="button"
                          disabled={!channelToken.trim() || channelSaving}
                          onClick={() => {
                            setChannelSaving(true);
                            setChannelError('');
                            void (async () => {
                              try {
                                let config: Record<string, unknown>;
                                if (ch.id === 'telegram') config = { type: 'telegram', botToken: channelToken };
                                else if (ch.id === 'discord') config = { type: 'discord', webhookUrl: channelToken };
                                else if (ch.id === 'slack') config = { type: 'slack', webhookUrl: channelToken };
                                else config = { type: 'whatsapp', provider: 'twilio', accountSid: channelToken };

                                const res = await fetch(`${API}/channels`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    name: `${ch.name} Channel`,
                                    type: ch.id,
                                    agentId: createdAgent?.id ?? '',
                                    config,
                                  }),
                                });
                                if (!res.ok) {
                                  const err = await res.json() as { error?: { message?: string } };
                                  throw new Error(err.error?.message ?? `Failed (${res.status})`);
                                }
                                setChannelSaved(ch.id);
                                setChannelToken('');
                              } catch (err) {
                                setChannelError((err as Error).message);
                              } finally {
                                setChannelSaving(false);
                              }
                            })();
                          }}
                          style={{
                            ...btnPrimary,
                            padding: '10px 20px',
                            opacity: !channelToken.trim() || channelSaving ? 0.4 : 1,
                          }}
                        >
                          {channelSaving ? '⏳ Connecting…' : channelSaved === ch.id ? '✅ Connected!' : `Connect ${ch.name}`}
                        </button>
                        {channelError && channelExpanded === ch.id && (
                          <p style={{ fontSize: 12, color: 'var(--red, #f85149)', margin: 0 }}>{channelError}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
              <button type="button" onClick={() => setStep(3)} style={btnSecondary}>
                ← Back
              </button>
              <button
                type="button"
                onClick={() => setStep(5)}
                style={btnPrimary}
              >
                {channelSaved ? 'Next →' : 'Skip for now →'}
              </button>
            </div>
          </div>
        )}

        {/* ═══════════════════════ Step 5: Ready ═════════════════════════════ */}
        {step === 5 && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, color: 'var(--text, #e6edf3)' }}>
              You&apos;re All Set!
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted, #8b949e)', marginBottom: 20 }}>
              Try chatting with your agent below, or jump straight into the app.
            </p>

            <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {createdAgent && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text-muted, #8b949e)' }}>
                  <span style={{ fontSize: 20 }}>{createdAgent.emoji}</span>
                  <strong style={{ color: 'var(--text, #e6edf3)' }}>{createdAgent.name}</strong>
                  <span>is ready</span>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="Say something to test…"
                  value={chatMessage}
                  onChange={(e) => setChatMessage(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !chatLoading) void handleTestChat(); }}
                  style={{ ...inputStyle, flex: 1 }}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => void handleTestChat()}
                  disabled={chatLoading || !chatMessage.trim()}
                  style={{
                    ...btnPrimary,
                    opacity: chatLoading || !chatMessage.trim() ? 0.4 : 1,
                    whiteSpace: 'nowrap',
                    padding: '10px 18px',
                  }}
                >
                  {chatLoading ? '⏳' : '↑ Send'}
                </button>
              </div>

              {chatResponse && (
                <div
                  style={{
                    padding: 14,
                    borderRadius: 8,
                    background: 'var(--surface-hover, #21262d)',
                    border: '1px solid var(--border, #30363d)',
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: 'var(--text, #e6edf3)',
                    whiteSpace: 'pre-wrap',
                    maxHeight: 200,
                    overflow: 'auto',
                  }}
                >
                  {chatResponse}
                </div>
              )}
            </div>

            {/* What's next */}
            <div style={{ ...cardStyle, marginTop: 16, padding: 16 }}>
              <h4 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted, #8b949e)', marginTop: 0, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                What you can do next
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { icon: '👥', text: 'Create squads — teams of agents that collaborate on complex tasks' },
                  { icon: '⚙️', text: 'Add more providers in Settings to unlock different models' },
                  { icon: '🔧', text: 'Give your agent tools like bash, file editing, and web access' },
                  { icon: '📋', text: 'Build workflows to automate multi-step processes' },
                ].map((item) => (
                  <div key={item.text} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: 'var(--text-muted, #8b949e)' }}>
                    <span style={{ flexShrink: 0 }}>{item.icon}</span>
                    <span>{item.text}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
              <button type="button" onClick={() => setStep(4)} style={btnSecondary}>
                ← Back
              </button>
              <button
                type="button"
                onClick={() => void handleComplete()}
                disabled={completing}
                style={{
                  ...btnPrimary,
                  background: 'var(--green, #3fb950)',
                  opacity: completing ? 0.5 : 1,
                  padding: '12px 28px',
                  fontSize: 15,
                }}
              >
                {completing ? 'Loading…' : 'Launch HiveClaw 🚀'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
