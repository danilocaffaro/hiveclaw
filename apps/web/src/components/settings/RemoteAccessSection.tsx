'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { SectionTitle, SettingRow, Toggle } from './shared';

const API = process.env.NEXT_PUBLIC_API_URL ?? '/api';

interface TunnelStatus {
  active: boolean;
  provider: string | null;
  url: string | null;
  startedAt: string | null;
  pid: number | null;
  error: string | null;
}

interface ProvidersInfo {
  available: string[];
  preferred: string | null;
}

export function RemoteAccessSection() {
  const [status, setStatus] = useState<TunnelStatus | null>(null);
  const [providers, setProviders] = useState<ProvidersInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API}/tunnel/status`);
      const json = await res.json();
      setStatus(json.data);
    } catch {
      // API not available
    }
  }, []);

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch(`${API}/tunnel/providers`);
      const json = await res.json();
      setProviders(json.data);
    } catch {
      // API not available
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchProviders();
    const interval = setInterval(fetchStatus, 10_000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchProviders]);

  const handleToggle = async (enable: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const endpoint = enable ? 'start' : 'stop';
      const res = await fetch(`${API}/tunnel/${endpoint}`, { method: 'POST' });
      const json = await res.json();
      if (json.error) {
        setError(json.error);
      }
      setStatus(json.data);
    } catch (err: any) {
      setError(err.message ?? 'Failed to toggle tunnel');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (status?.url) {
      navigator.clipboard.writeText(status.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isActive = status?.active ?? false;
  const hasProvider = (providers?.available?.length ?? 0) > 0;
  const uptime = status?.startedAt
    ? Math.round((Date.now() - new Date(status.startedAt).getTime()) / 60_000)
    : 0;

  return (
    <>
      <div style={{
        fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)',
        textTransform: 'uppercase', letterSpacing: '0.6px',
        marginTop: 28, marginBottom: 8,
      }}>
        🌐 Remote Access
      </div>

      {!hasProvider && (
        <div style={{
          padding: '12px 14px', borderRadius: 'var(--radius-md)',
          background: 'rgba(255,180,50,0.08)', border: '1px solid rgba(255,180,50,0.25)',
          fontSize: 12, color: 'var(--fg-muted)', marginBottom: 12,
        }}>
          <strong style={{ color: 'var(--text)' }}>⚠️ No tunnel provider found.</strong><br />
          Install <code style={{ background: 'var(--bg-secondary)', padding: '1px 5px', borderRadius: 4, fontSize: 11 }}>
            cloudflared
          </code> or <code style={{ background: 'var(--bg-secondary)', padding: '1px 5px', borderRadius: 4, fontSize: 11 }}>
            ngrok
          </code> to enable remote access.
        </div>
      )}

      <SettingRow
        label="Enable Remote Access"
        desc={
          isActive
            ? `Active via ${status?.provider} · ${uptime}min uptime`
            : 'Expose this HiveClaw instance to the internet via secure tunnel'
        }
      >
        <Toggle
          checked={isActive}
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
          Starting tunnel…
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

      {isActive && status?.url && (
        <div style={{
          marginTop: 8, padding: '14px 16px',
          borderRadius: 'var(--radius-md)',
          background: 'rgba(80,200,120,0.06)', border: '1px solid rgba(80,200,120,0.2)',
        }}>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 6, fontWeight: 600 }}>
            PUBLIC URL
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code style={{
              flex: 1, fontSize: 13, fontFamily: 'var(--font-mono)',
              color: 'var(--text)', wordBreak: 'break-all',
              background: 'var(--bg-secondary)', padding: '8px 12px',
              borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
            }}>
              {status.url}
            </code>
            <button
              onClick={handleCopy}
              style={{
                padding: '8px 14px', borderRadius: 'var(--radius-md)',
                background: copied ? 'var(--green)' : 'var(--bg-secondary)',
                color: copied ? '#fff' : 'var(--text)',
                border: '1px solid var(--border)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                transition: 'all 0.2s',
                whiteSpace: 'nowrap',
              }}
            >
              {copied ? '✓ Copied' : '📋 Copy'}
            </button>
          </div>

          <div style={{
            marginTop: 10, fontSize: 11, color: 'var(--fg-muted)',
            display: 'flex', gap: 16, flexWrap: 'wrap',
          }}>
            <span>Provider: <strong>{status.provider}</strong></span>
            <span>PID: <strong>{status.pid}</strong></span>
            <span>Uptime: <strong>{uptime}min</strong></span>
          </div>

          <div style={{
            marginTop: 10, fontSize: 11, color: 'var(--fg-muted)',
            padding: '8px 10px', background: 'var(--bg-secondary)',
            borderRadius: 'var(--radius-sm)',
          }}>
            💡 Share this URL with anyone to give them access to this HiveClaw instance.
            Use <strong>Invite Links</strong> (Users tab) to control who can connect.
          </div>
        </div>
      )}
    </>
  );
}
