'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { SectionTitle, SettingRow, Toggle } from './shared';

const API = process.env.NEXT_PUBLIC_API_URL ?? '/api';

interface ConnectStatus {
  enabled: boolean;
  connected: boolean;
  instanceId: string | null;
  broker: string | null;
  devicesCount: number;
}

interface ConnectDevice {
  id: string;
  name: string;
  userId: string;
  pairedAt: string;
  lastSeenAt: string;
  revoked: boolean;
  userAgent?: string;
}

export function RemoteAccessSection() {
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [devices, setDevices] = useState<ConnectDevice[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [generatingToken, setGeneratingToken] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API}/connect/status`);
      const json = await res.json();
      setStatus(json.data);
    } catch {
      // API not available
    }
  }, []);

  const fetchDevices = useCallback(async () => {
    try {
      const res = await fetch(`${API}/connect/devices`);
      const json = await res.json();
      setDevices(json.data || []);
    } catch {
      // API not available
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchDevices();
    const interval = setInterval(() => {
      fetchStatus();
      fetchDevices();
    }, 15_000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchDevices]);

  const handleToggle = async (enable: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const endpoint = enable ? 'enable' : 'disable';
      const res = await fetch(`${API}/connect/${endpoint}`, { method: 'POST' });
      const json = await res.json();
      if (json.error) setError(json.error);
      await fetchStatus();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to toggle');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateToken = async () => {
    setGeneratingToken(true);
    setError(null);
    try {
      const res = await fetch(`${API}/connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'admin' }),
      });
      const json = await res.json();
      if (json.error) {
        setError(json.error);
      } else {
        setToken(json.data.token);
        setShowToken(true);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate token');
    } finally {
      setGeneratingToken(false);
    }
  };

  const handleCopyToken = () => {
    if (token) {
      navigator.clipboard.writeText(token);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    }
  };

  const handleRevokeDevice = async (deviceId: string) => {
    try {
      await fetch(`${API}/connect/devices/${deviceId}`, { method: 'DELETE' });
      await fetchDevices();
    } catch {
      // ignore
    }
  };

  const isEnabled = status?.enabled ?? false;
  const isConnected = status?.connected ?? false;

  const timeAgo = (dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <>
      <div style={{
        fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)',
        textTransform: 'uppercase', letterSpacing: '0.6px',
        marginTop: 28, marginBottom: 8,
      }}>
        🌐 HiveClaw Connect
      </div>

      <div style={{
        fontSize: 12, color: 'var(--fg-muted)', marginBottom: 12,
        lineHeight: 1.5,
      }}>
        Access your AI team from any device. Uses encrypted MQTT relay — no ports exposed, no tunnels needed.
      </div>

      <SettingRow
        label="Enable Remote Access"
        desc={
          isConnected
            ? `● Connected to relay · ${status?.devicesCount || 0} device${(status?.devicesCount || 0) !== 1 ? 's' : ''} paired`
            : isEnabled
              ? '○ Connecting to relay…'
              : 'Connect to MQTT relay for remote device access'
        }
      >
        <Toggle
          checked={isEnabled}
          onChange={handleToggle}
        />
      </SettingRow>

      {loading && (
        <div style={{
          fontSize: 12, color: 'var(--fg-muted)', padding: '8px 0',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{
            display: 'inline-block', width: 14, height: 14,
            border: '2px solid var(--border)', borderTopColor: 'var(--coral)',
            borderRadius: '50%', animation: 'spin 1s linear infinite',
          }} />
          {isEnabled ? 'Disconnecting…' : 'Connecting…'}
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {error && (
        <div style={{
          padding: '8px 12px', borderRadius: 'var(--radius-md)',
          background: 'rgba(255,80,80,0.08)', border: '1px solid rgba(255,80,80,0.2)',
          fontSize: 12, color: '#ff5050', marginTop: 4,
        }}>
          {error}
        </div>
      )}

      {isEnabled && (
        <>
          {/* Generate Token Section */}
          <div style={{
            marginTop: 12, padding: '14px 16px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          }}>
            <div style={{
              fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 8,
            }}>
              📱 Connect a Device
            </div>
            <div style={{
              fontSize: 12, color: 'var(--fg-muted)', marginBottom: 10, lineHeight: 1.5,
            }}>
              Generate a token, then open <strong>hiveclaw.github.io/connect</strong> on your phone or laptop and paste it.
            </div>

            {!showToken ? (
              <button
                onClick={handleGenerateToken}
                disabled={generatingToken}
                style={{
                  padding: '8px 16px', borderRadius: 'var(--radius-md)',
                  background: 'var(--coral)', color: '#fff',
                  border: 'none', fontSize: 12, fontWeight: 600,
                  cursor: generatingToken ? 'wait' : 'pointer',
                  opacity: generatingToken ? 0.6 : 1,
                }}
              >
                {generatingToken ? 'Generating…' : '🔑 Generate Token'}
              </button>
            ) : (
              <div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
                }}>
                  <code style={{
                    flex: 1, fontSize: 11, fontFamily: 'var(--font-mono)',
                    color: 'var(--text)', wordBreak: 'break-all',
                    background: 'var(--bg)', padding: '10px 12px',
                    borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
                    lineHeight: 1.4,
                  }}>
                    {token}
                  </code>
                  <button
                    onClick={handleCopyToken}
                    style={{
                      padding: '8px 14px', borderRadius: 'var(--radius-md)',
                      background: copiedToken ? '#50c878' : 'var(--bg)',
                      color: copiedToken ? '#fff' : 'var(--text)',
                      border: '1px solid var(--border)',
                      fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {copiedToken ? '✓ Copied' : '📋 Copy'}
                  </button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                  ⚠️ This token contains connection info. Share securely — don't post publicly.
                </div>
                <button
                  onClick={() => { setShowToken(false); setToken(null); }}
                  style={{
                    marginTop: 8, padding: '4px 10px', borderRadius: 'var(--radius-sm)',
                    background: 'transparent', color: 'var(--fg-muted)',
                    border: '1px solid var(--border)', fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  Generate New
                </button>
              </div>
            )}
          </div>

          {/* Connected Devices */}
          <div style={{
            marginTop: 12, padding: '14px 16px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          }}>
            <div style={{
              fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 8,
            }}>
              📋 Connected Devices
            </div>

            {devices.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                No devices connected yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {devices.map(d => (
                  <div key={d.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg)', border: '1px solid var(--border)',
                  }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                        {d.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                        Last seen: {timeAgo(d.lastSeenAt)} · Paired: {timeAgo(d.pairedAt)}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRevokeDevice(d.id)}
                      style={{
                        padding: '4px 10px', borderRadius: 'var(--radius-sm)',
                        background: 'rgba(255,80,80,0.1)', color: '#ff5050',
                        border: '1px solid rgba(255,80,80,0.2)',
                        fontSize: 11, cursor: 'pointer',
                      }}
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
