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
    desc: 'Research, plan, write, and organize',
  },
  {
    id: 'coder',
    emoji: '💻',
    name: 'Coder',
    role: 'Full-stack Developer',
    prompt: 'You are an expert full-stack developer. You write clean, well-tested TypeScript code. You break complex tasks into small, incremental steps. You prefer simple solutions over clever ones.',
    desc: 'Write, debug, and review code',
  },
  {
    id: 'writer',
    emoji: '✍️',
    name: 'Writer',
    role: 'Content Writer',
    prompt: 'You are a skilled content writer. You write clear, engaging prose adapted to the audience. You structure content logically and vary tone as needed — from formal to conversational.',
    desc: 'Draft articles, docs, and copy',
  },
  {
    id: 'analyst',
    emoji: '📊',
    name: 'Analyst',
    role: 'Data Analyst',
    prompt: 'You are a data analyst. You examine data carefully, identify patterns and anomalies, and present findings with clear charts and summaries. You question assumptions and validate sources.',
    desc: 'Analyze data and extract insights',
  },
  {
    id: 'researcher',
    emoji: '🔍',
    name: 'Researcher',
    role: 'Research Specialist',
    prompt: 'You are a thorough researcher. You search multiple sources, cross-reference facts, and deliver well-structured reports with citations. You distinguish opinion from evidence.',
    desc: 'Deep research with sources',
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

const EMOJI_OPTIONS = ['🤖', '🧠', '⚡', '🦀', '🔮', '🚀', '💻', '✍️', '📊', '🎯', '🛡️', '🎨'];

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
  const labels = ['Welcome', 'Provider', 'Agent', 'Ready'];
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

  // Step 4 state
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
    { id: 'anthropic', name: 'Anthropic', icon: '🟣', desc: 'Claude Opus, Sonnet', hint: 'console.anthropic.com → API Keys' },
    { id: 'openai', name: 'OpenAI', icon: '🟢', desc: 'GPT-4o, o3, o4-mini', hint: 'platform.openai.com → API Keys' },
    { id: 'google', name: 'Google AI', icon: '🔵', desc: 'Gemini 2.5 Pro, Flash', hint: 'aistudio.google.com → API Keys' },
    { id: 'openrouter', name: 'OpenRouter', icon: '🔀', desc: '100+ models, one key', hint: 'openrouter.ai → Keys — access Claude, GPT, Gemini, Llama, and more' },
    { id: 'deepseek', name: 'DeepSeek', icon: '🐋', desc: 'DeepSeek V3, R1', hint: 'platform.deepseek.com → API Keys' },
    { id: 'groq', name: 'Groq', icon: '⚡', desc: 'Ultra-fast inference', hint: 'console.groq.com → API Keys — free tier available' },
    { id: 'mistral', name: 'Mistral', icon: '🇫🇷', desc: 'Mistral Large, Codestral', hint: 'console.mistral.ai → API Keys' },
    { id: 'github-copilot', name: 'GitHub Copilot', icon: '🐙', desc: 'Claude, GPT via Copilot', hint: 'Needs active Copilot subscription + GitHub CLI auth' },
    { id: 'ollama', name: 'Ollama', icon: '🦙', desc: 'Local models (free)', hint: 'ollama.com — run models locally, no API key needed' },
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
        <StepIndicator current={step} total={4} />

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
              Welcome to SuperClaw
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
                  {activeProvider !== 'ollama' && activeProvider !== 'github-copilot' ? (
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
                      <p style={{ fontSize: 11, color: 'var(--text-muted, #8b949e)', marginTop: 6, marginBottom: 0 }}>
                        💡 {PROVIDER_CARDS.find((p) => p.id === activeProvider)?.hint}
                      </p>
                    </div>
                  ) : activeProvider === 'github-copilot' ? (
                    <div>
                      <p style={{ fontSize: 13, color: 'var(--text-muted, #8b949e)', marginTop: 0, marginBottom: 0, lineHeight: 1.6 }}>
                        🐙 GitHub Copilot — no API key needed. SuperClaw uses the Copilot token from your GitHub CLI installation.
                      </p>
                      <p style={{ fontSize: 11, color: 'var(--text-muted, #8b949e)', marginTop: 8, marginBottom: 0 }}>
                        💡 Requires: GitHub Copilot subscription + <code style={{ background: 'var(--surface-hover)', padding: '1px 5px', borderRadius: 3 }}>gh auth login</code> running on this machine.
                      </p>
                    </div>
                  ) : (
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
                  )}

                  <button
                    type="button"
                    onClick={() => void handleTestConnection()}
                    disabled={testStatus === 'testing' || (activeProvider !== 'ollama' && activeProvider !== 'github-copilot' && !apiKeyInput)}
                    style={{
                      ...btnPrimary,
                      opacity: testStatus === 'testing' || (activeProvider !== 'ollama' && activeProvider !== 'github-copilot' && !apiKeyInput) ? 0.4 : 1,
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
                        .filter((p) => configuredProviders.has(p.id) || p.type === 'ollama' || p.type === 'github-copilot')
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

        {/* ═══════════════════════ Step 4: Ready ═════════════════════════════ */}
        {step === 4 && (
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
              <button type="button" onClick={() => setStep(3)} style={btnSecondary}>
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
                {completing ? 'Loading…' : 'Launch SuperClaw 🚀'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
