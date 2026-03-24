'use client';

import { useState, useEffect } from 'react';
import { setServerUrl } from '../../lib/api-base';

type Step = 'login' | 'connecting' | 'connected' | 'error';

export default function ConnectPage() {
  const [step, setStep] = useState<Step>('login');
  const [serverUrl, setServerUrlState] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [serverInfo, setServerInfo] = useState<{ name: string; version: string } | null>(null);
  const [userName, setUserName] = useState('');

  // Check if already connected
  useEffect(() => {
    const saved = localStorage.getItem('hiveclaw_remote');
    if (saved) {
      try {
        const { serverUrl: url, token: tok, user } = JSON.parse(saved);
        if (url && tok) {
          setServerUrlState(url);
          setToken(tok);
          setUserName(user?.name || '');
          setStep('connected');
        }
      } catch { /* ignore */ }
    }
  }, []);

  async function handleConnect() {
    if (!serverUrl.trim() || !token.trim()) {
      setError('Server URL and Token are required');
      return;
    }

    setStep('connecting');
    setError('');

    const baseUrl = serverUrl.trim().replace(/\/+$/, '');

    try {
      const res = await fetch(`${baseUrl}/api/auth/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': token.trim(),
        },
        body: JSON.stringify({
          email: email.trim() || undefined,
          token: token.trim(),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Authentication failed (${res.status})`);
      }

      const { data } = await res.json();

      // Save connection info
      setServerUrl(baseUrl);
      localStorage.setItem('hiveclaw_remote', JSON.stringify({
        serverUrl: baseUrl,
        token: token.trim(),
        user: data.user,
        server: data.server,
        connectedAt: new Date().toISOString(),
      }));

      // Also save for api-base resolver
      localStorage.setItem('hiveclaw_server_url', baseUrl);
      localStorage.setItem('hiveclaw_auth_token', token.trim());

      setServerInfo(data.server);
      setUserName(data.user?.name || 'User');
      setStep('connected');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Connection failed');
      setStep('login');
    }
  }

  function handleDisconnect() {
    localStorage.removeItem('hiveclaw_remote');
    localStorage.removeItem('hiveclaw_server_url');
    localStorage.removeItem('hiveclaw_auth_token');
    setStep('login');
    setServerUrlState('');
    setToken('');
    setEmail('');
    setServerInfo(null);
  }

  function handleOpenChat() {
    window.location.href = '/hiveclaw/';
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Logo */}
        <div style={styles.logoSection}>
          <div style={styles.logo}>🐝</div>
          <h1 style={styles.title}>HiveClaw</h1>
          <p style={styles.subtitle}>Remote Connect</p>
        </div>

        {step === 'login' && (
          <>
            <div style={styles.form}>
              <div style={styles.field}>
                <label style={styles.label}>Server URL</label>
                <input
                  type="url"
                  placeholder="https://your-tunnel-url.trycloudflare.com"
                  value={serverUrl}
                  onChange={(e) => setServerUrlState(e.target.value)}
                  style={styles.input}
                  autoFocus
                />
                <p style={styles.hint}>
                  Find this in your HiveClaw → Settings → Remote Access
                </p>
              </div>

              <div style={styles.field}>
                <label style={styles.label}>Email (optional)</label>
                <input
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={styles.input}
                />
              </div>

              <div style={styles.field}>
                <label style={styles.label}>Instance Token</label>
                <input
                  type="password"
                  placeholder="sc_xxxxxxxxxxxxxxxx"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  style={styles.input}
                  onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                />
                <p style={styles.hint}>
                  Find this in your HiveClaw → Settings → General → Instance Token
                </p>
              </div>

              {error && <p style={styles.error}>⚠️ {error}</p>}

              <button onClick={handleConnect} style={styles.button}>
                Connect 🔗
              </button>
            </div>

            <div style={styles.footer}>
              <p style={styles.footerText}>
                Don&apos;t have a HiveClaw instance?{' '}
                <a href="https://github.com/danilocaffaro/superclaw-pure" style={styles.link}>
                  Get started →
                </a>
              </p>
            </div>
          </>
        )}

        {step === 'connecting' && (
          <div style={styles.center}>
            <div style={styles.spinner} />
            <p style={styles.statusText}>Connecting to your HiveClaw...</p>
          </div>
        )}

        {step === 'connected' && (
          <div style={styles.center}>
            <div style={styles.successIcon}>✅</div>
            <h2 style={styles.connectedTitle}>Connected!</h2>
            <p style={styles.statusText}>
              Welcome back, <strong>{userName}</strong>
            </p>
            {serverInfo && (
              <p style={styles.serverInfo}>
                {serverInfo.name} v{serverInfo.version}
              </p>
            )}
            <button onClick={handleOpenChat} style={styles.button}>
              Open Chat 💬
            </button>
            <button onClick={handleDisconnect} style={styles.disconnectBtn}>
              Disconnect
            </button>
          </div>
        )}

        {step === 'error' && (
          <div style={styles.center}>
            <div style={styles.errorIcon}>❌</div>
            <p style={styles.statusText}>{error}</p>
            <button onClick={() => setStep('login')} style={styles.button}>
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #0D1117 0%, #161B22 50%, #0D1117 100%)',
    padding: 20,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  card: {
    background: '#161B22',
    border: '1px solid #30363D',
    borderRadius: 16,
    padding: 40,
    width: '100%',
    maxWidth: 420,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
  },
  logoSection: {
    textAlign: 'center' as const,
    marginBottom: 32,
  },
  logo: {
    fontSize: 48,
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    color: '#F0F6FC',
    margin: 0,
  },
  subtitle: {
    fontSize: 14,
    color: '#8B949E',
    margin: '4px 0 0',
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 20,
  },
  field: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: '#C9D1D9',
  },
  input: {
    padding: '10px 14px',
    background: '#0D1117',
    border: '1px solid #30363D',
    borderRadius: 8,
    color: '#F0F6FC',
    fontSize: 14,
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  hint: {
    fontSize: 11,
    color: '#6E7681',
    margin: 0,
  },
  error: {
    fontSize: 13,
    color: '#F85149',
    background: 'rgba(248,81,73,0.1)',
    padding: '8px 12px',
    borderRadius: 8,
    margin: 0,
  },
  button: {
    padding: '12px 24px',
    background: 'linear-gradient(135deg, #F59E0B, #D97706)',
    color: '#000',
    border: 'none',
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'opacity 0.2s',
    marginTop: 8,
  },
  footer: {
    marginTop: 24,
    textAlign: 'center' as const,
  },
  footerText: {
    fontSize: 12,
    color: '#6E7681',
  },
  link: {
    color: '#F59E0B',
    textDecoration: 'none',
  },
  center: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 12,
    padding: '20px 0',
  },
  spinner: {
    width: 40,
    height: 40,
    border: '3px solid #30363D',
    borderTop: '3px solid #F59E0B',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  statusText: {
    fontSize: 14,
    color: '#8B949E',
    textAlign: 'center' as const,
  },
  successIcon: {
    fontSize: 48,
  },
  connectedTitle: {
    fontSize: 22,
    fontWeight: 700,
    color: '#F0F6FC',
    margin: 0,
  },
  serverInfo: {
    fontSize: 12,
    color: '#6E7681',
    margin: 0,
  },
  disconnectBtn: {
    padding: '8px 16px',
    background: 'transparent',
    color: '#F85149',
    border: '1px solid #F85149',
    borderRadius: 8,
    fontSize: 13,
    cursor: 'pointer',
    marginTop: 8,
  },
  errorIcon: {
    fontSize: 48,
  },
};
