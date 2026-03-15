'use client';

import { useState, useEffect } from 'react';

interface AuthUser {
  id: string;
  name: string | null;
  email: string | null;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  avatarUrl: string | null;
}

/**
 * P-8: Login/Auth page — shown when multi-user mode is enabled and user is not authenticated.
 * Supports:
 * - API key login (x-api-key header)
 * - Auto-login for same-origin owner (single-user fallback)
 */
export function LoginPage({ onLogin }: { onLogin: (user: AuthUser) => void }) {
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoLoginAttempted, setAutoLoginAttempted] = useState(false);

  // Try auto-login (same-origin owner fallback) on mount
  useEffect(() => {
    if (autoLoginAttempted) return;
    setAutoLoginAttempted(true);
    fetch('/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(result => {
        if (result?.data) onLogin(result.data);
      })
      .catch(() => { /* No auto-login available */ });
  }, [autoLoginAttempted, onLogin]);

  const handleLogin = async () => {
    if (!apiKey.trim()) {
      setError('API key is required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/auth/me', {
        headers: { 'x-api-key': apiKey.trim() },
      });
      if (!res.ok) {
        setError('Invalid API key');
        return;
      }
      const { data } = await res.json();
      // Store API key for future requests
      localStorage.setItem('hiveclaw-api-key', apiKey.trim());
      onLogin(data);
    } catch {
      setError('Connection failed — is the server running?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg, #0a0a0a)',
      fontFamily: 'var(--font-sans, system-ui)',
    }}>
      <div style={{
        width: 380,
        padding: 32,
        borderRadius: 16,
        background: 'var(--surface, #141414)',
        border: '1px solid var(--border, #2a2a2a)',
        boxShadow: '0 16px 48px rgba(0,0,0,0.3)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>⚡</div>
          <h1 style={{
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--text, #e5e5e5)',
            margin: 0,
          }}>
            HiveClaw
          </h1>
          <p style={{
            fontSize: 13,
            color: 'var(--text-muted, #888)',
            margin: '6px 0 0',
          }}>
            Sign in to your workspace
          </p>
        </div>

        {/* API Key field */}
        <div style={{ marginBottom: 16 }}>
          <label style={{
            display: 'block',
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--text-muted, #888)',
            marginBottom: 6,
          }}>
            API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            placeholder="sc_..."
            autoFocus
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: 10,
              border: `1px solid ${error ? 'var(--red, #f85149)' : 'var(--border, #2a2a2a)'}`,
              background: 'var(--bg, #0a0a0a)',
              color: 'var(--text, #e5e5e5)',
              fontSize: 14,
              fontFamily: 'var(--font-mono, monospace)',
              outline: 'none',
              transition: 'border-color 150ms',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Error */}
        {error && (
          <div style={{
            fontSize: 12,
            color: 'var(--red, #f85149)',
            marginBottom: 12,
            padding: '6px 10px',
            background: 'rgba(248,81,73,0.1)',
            borderRadius: 6,
          }}>
            {error}
          </div>
        )}

        {/* Login button */}
        <button
          onClick={handleLogin}
          disabled={loading}
          style={{
            width: '100%',
            padding: '10px 0',
            borderRadius: 10,
            border: 'none',
            background: 'var(--coral, #F59E0B)',
            color: '#000',
            fontSize: 14,
            fontWeight: 600,
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.6 : 1,
            transition: 'opacity 150ms',
          }}
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>

        {/* Divider */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          margin: '20px 0',
        }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border, #2a2a2a)' }} />
          <span style={{ fontSize: 11, color: 'var(--text-muted, #888)' }}>or</span>
          <div style={{ flex: 1, height: 1, background: 'var(--border, #2a2a2a)' }} />
        </div>

        {/* Info */}
        <p style={{
          fontSize: 11,
          color: 'var(--text-muted, #666)',
          textAlign: 'center',
          lineHeight: 1.6,
          margin: 0,
        }}>
          Single-user mode auto-authenticates on localhost.
          <br />
          Get your API key from Settings → Security.
        </p>
      </div>
    </div>
  );
}

export type { AuthUser };
