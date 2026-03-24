'use client';

import { useState, useEffect } from 'react';

/**
 * HiveClaw Connect — PWA entry point
 *
 * User enters their Instance Token (HCW-XXXX-...) which contains:
 * - MQTT broker URL
 * - Instance ID
 * - MQTT credentials
 * The page connects via MQTT, pairs the device, and opens the chat.
 */

type Step = 'token' | 'connecting' | 'paired' | 'chat' | 'error';

interface PairingResult {
  deviceId: string;
  sessionToken: string;
  serverPublicKey: string;
  role: string;
  agents: string[];
}

export default function ConnectPage() {
  const [step, setStep] = useState<Step>('token');
  const [token, setToken] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [error, setError] = useState('');
  const [pairing, setPairing] = useState<PairingResult | null>(null);

  // Check if already paired
  useEffect(() => {
    const saved = localStorage.getItem('hiveclaw_connect');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.deviceId && data.sessionToken) {
          setPairing(data);
          setStep('paired');
        }
      } catch { /* ignore */ }
    }

    // Detect device name
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) setDeviceName('iPhone');
    else if (/iPad/.test(ua)) setDeviceName('iPad');
    else if (/Android/.test(ua)) setDeviceName('Android');
    else if (/Mac/.test(ua)) setDeviceName('MacBook');
    else if (/Windows/.test(ua)) setDeviceName('PC');
    else setDeviceName('Device');
  }, []);

  async function handleConnect() {
    const trimmed = token.trim();
    if (!trimmed) {
      setError('Paste your Instance Token');
      return;
    }
    if (!trimmed.startsWith('HCW-')) {
      setError('Invalid token format. It should start with HCW-');
      return;
    }

    setStep('connecting');
    setError('');

    try {
      // Decode token to get broker info
      const decoded = decodeTokenClient(trimmed);
      if (!decoded) throw new Error('Invalid token — could not decode');

      // Connect to MQTT broker
      // Dynamic import mqtt.js (browser bundle)
      const mqtt = await import('mqtt');

      const client = mqtt.connect(decoded.broker, {
        username: decoded.mqttUser,
        password: decoded.mqttPass,
        clientId: `hc_pwa_${Math.random().toString(36).slice(2, 10)}`,
        clean: true,
        reconnectPeriod: 5000,
        connectTimeout: 15000,
      });

      // Generate client keypair (Web Crypto or tweetnacl)
      const nacl = await import('tweetnacl');
      const naclUtil = await import('tweetnacl-util');
      const keyPair = nacl.default.box.keyPair();
      const publicKeyB64 = naclUtil.encodeBase64(keyPair.publicKey);
      const secretKeyB64 = naclUtil.encodeBase64(keyPair.secretKey);

      const connectTimeout = setTimeout(() => {
        client.end(true);
        setError('Connection timed out. Check your token and try again.');
        setStep('token');
      }, 20000);

      client.on('connect', () => {
        // Subscribe to auth response
        const responseTopic = `${decoded.instance}/+/agent`;
        client.subscribe(responseTopic, { qos: 1 });

        // Send pairing request
        const authPayload = JSON.stringify({
          token: trimmed,
          deviceName: deviceName || 'Browser',
          publicKey: publicKeyB64,
          userAgent: navigator.userAgent,
        });

        client.publish(`${decoded.instance}/auth`, authPayload, { qos: 1 });
      });

      client.on('message', (_topic: string, payload: Buffer) => {
        try {
          const msg = JSON.parse(payload.toString());
          if (msg.type === 'auth_response' && msg.payload?.status === 'paired') {
            clearTimeout(connectTimeout);

            const result: PairingResult = {
              deviceId: msg.payload.deviceId,
              sessionToken: msg.payload.sessionToken,
              serverPublicKey: msg.payload.serverPublicKey,
              role: msg.payload.role,
              agents: msg.payload.agents || [],
            };

            // Save to localStorage
            localStorage.setItem('hiveclaw_connect', JSON.stringify({
              ...result,
              instanceId: decoded.instance,
              broker: decoded.broker,
              mqttUser: decoded.mqttUser,
              mqttPass: decoded.mqttPass,
              clientPublicKey: publicKeyB64,
              clientSecretKey: secretKeyB64,
              pairedAt: new Date().toISOString(),
            }));

            setPairing(result);
            setStep('paired');
            client.end();
          }
        } catch { /* ignore non-json messages */ }
      });

      client.on('error', (err) => {
        clearTimeout(connectTimeout);
        setError(`Connection error: ${err.message}`);
        setStep('token');
      });

    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Connection failed');
      setStep('token');
    }
  }

  function handleOpenChat() {
    // The chat will use the MQTT connection info from localStorage
    window.location.href = '/';
  }

  function handleDisconnect() {
    localStorage.removeItem('hiveclaw_connect');
    setPairing(null);
    setStep('token');
    setToken('');
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Logo */}
        <div style={styles.logoSection}>
          <div style={styles.logo}>🐝</div>
          <h1 style={styles.title}>HiveClaw Connect</h1>
          <p style={styles.subtitle}>Access your AI team from anywhere</p>
        </div>

        {step === 'token' && (
          <div style={styles.form}>
            <div style={styles.field}>
              <label style={styles.label}>Instance Token</label>
              <input
                type="text"
                placeholder="HCW-XXXX-XXXX-XXXX-XXXX"
                value={token}
                onChange={(e) => setToken(e.target.value.toUpperCase())}
                style={{ ...styles.input, fontFamily: 'monospace', letterSpacing: '1px' }}
                autoFocus
                spellCheck={false}
                autoCapitalize="characters"
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
              />
              <p style={styles.hint}>
                Find this in your HiveClaw → Settings → Remote Access → Generate Token
              </p>
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Device Name</label>
              <input
                type="text"
                placeholder="My iPhone"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                style={styles.input}
              />
            </div>

            {error && <p style={styles.error}>⚠️ {error}</p>}

            <button onClick={handleConnect} style={styles.button}>
              Connect 🔗
            </button>

            <div style={styles.securityNote}>
              <span style={{ fontSize: 14 }}>🔒</span>
              <span>End-to-end encrypted. Your messages are encrypted on this device — no one in between can read them.</span>
            </div>
          </div>
        )}

        {step === 'connecting' && (
          <div style={styles.center}>
            <div style={styles.spinner} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <p style={styles.statusText}>Connecting to your HiveClaw…</p>
            <p style={styles.hint}>Exchanging encryption keys…</p>
          </div>
        )}

        {step === 'paired' && (
          <div style={styles.center}>
            <div style={{ fontSize: 48 }}>✅</div>
            <h2 style={styles.connectedTitle}>Device Paired!</h2>
            <p style={styles.statusText}>
              Role: <strong>{pairing?.role || 'member'}</strong>
            </p>
            {pairing?.agents && pairing.agents.length > 0 && (
              <p style={styles.hint}>
                Agents: {pairing.agents.join(', ')}
              </p>
            )}
            <button onClick={handleOpenChat} style={styles.button}>
              Open Chat 💬
            </button>
            <button onClick={handleDisconnect} style={styles.disconnectBtn}>
              Disconnect Device
            </button>
          </div>
        )}

        {step === 'error' && (
          <div style={styles.center}>
            <div style={{ fontSize: 48 }}>❌</div>
            <p style={styles.error}>{error}</p>
            <button onClick={() => setStep('token')} style={styles.button}>
              Try Again
            </button>
          </div>
        )}

        <div style={styles.footer}>
          <p style={styles.footerText}>
            Don&apos;t have HiveClaw?{' '}
            <a href="https://github.com/danilocaffaro/superclaw-pure" style={styles.link}>
              Install →
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Token Decoder (client-side, no Node.js crypto) ────────────────────────────

function decodeTokenClient(token: string): {
  instance: string;
  broker: string;
  mqttUser: string;
  mqttPass: string;
} | null {
  try {
    const parts = token.split('-');
    if (parts.length < 3 || parts[0] !== 'HCW') return null;

    // Remove prefix (HCW) and checksum (last part)
    const encoded = parts.slice(1, -1).join('');

    // base64url decode
    const json = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
    const data = JSON.parse(json);

    return {
      instance: data.i,
      broker: data.b,
      mqttUser: data.u,
      mqttPass: data.p,
    };
  } catch {
    return null;
  }
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
  logo: { fontSize: 48, marginBottom: 8 },
  title: { fontSize: 24, fontWeight: 700, color: '#F0F6FC', margin: 0 },
  subtitle: { fontSize: 14, color: '#8B949E', margin: '4px 0 0' },
  form: { display: 'flex', flexDirection: 'column' as const, gap: 20 },
  field: { display: 'flex', flexDirection: 'column' as const, gap: 6 },
  label: { fontSize: 13, fontWeight: 600, color: '#C9D1D9' },
  input: {
    padding: '12px 14px',
    background: '#0D1117',
    border: '1px solid #30363D',
    borderRadius: 8,
    color: '#F0F6FC',
    fontSize: 14,
    outline: 'none',
  },
  hint: { fontSize: 11, color: '#6E7681', margin: 0 },
  error: {
    fontSize: 13, color: '#F85149',
    background: 'rgba(248,81,73,0.1)',
    padding: '8px 12px', borderRadius: 8, margin: 0,
  },
  button: {
    padding: '12px 24px',
    background: 'linear-gradient(135deg, #F59E0B, #D97706)',
    color: '#000', border: 'none', borderRadius: 8,
    fontSize: 15, fontWeight: 600, cursor: 'pointer',
    marginTop: 8,
  },
  securityNote: {
    display: 'flex', alignItems: 'flex-start', gap: 8,
    padding: '10px 14px', borderRadius: 8,
    background: 'rgba(80,200,120,0.05)',
    border: '1px solid rgba(80,200,120,0.15)',
    fontSize: 11, color: '#8B949E', lineHeight: '1.5',
  },
  center: {
    display: 'flex', flexDirection: 'column' as const,
    alignItems: 'center', gap: 12, padding: '20px 0',
  },
  spinner: {
    width: 40, height: 40,
    border: '3px solid #30363D', borderTop: '3px solid #F59E0B',
    borderRadius: '50%', animation: 'spin 1s linear infinite',
  },
  statusText: { fontSize: 14, color: '#8B949E', textAlign: 'center' as const },
  connectedTitle: { fontSize: 22, fontWeight: 700, color: '#F0F6FC', margin: 0 },
  disconnectBtn: {
    padding: '8px 16px', background: 'transparent',
    color: '#F85149', border: '1px solid #F85149',
    borderRadius: 8, fontSize: 13, cursor: 'pointer', marginTop: 8,
  },
  footer: { marginTop: 24, textAlign: 'center' as const },
  footerText: { fontSize: 12, color: '#6E7681' },
  link: { color: '#F59E0B', textDecoration: 'none' },
};
