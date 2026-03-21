'use client';

import { useState, useEffect, useCallback } from 'react';

interface FederationLink {
  id: string;
  peerInstanceId: string;
  peerInstanceName: string;
  peerUrl: string | null;
  direction: 'host' | 'guest';
  sharedSquadId: string;
  status: 'pending' | 'active' | 'disconnected' | 'revoked';
  connected: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

const API = '/api';

export function FederationPanel() {
  const [links, setLinks] = useState<FederationLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPairDialog, setShowPairDialog] = useState(false);
  const [showJoinDialog, setShowJoinDialog] = useState(false);

  const fetchLinks = useCallback(async () => {
    try {
      const res = await fetch(`${API}/federation/links`);
      if (res.status === 403) {
        setError('Federation not enabled. Set ENABLE_FEDERATION=true in your environment.');
        setLoading(false);
        return;
      }
      const json = await res.json();
      setLinks(json.data ?? []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLinks();
    const interval = setInterval(fetchLinks, 15_000); // refresh every 15s
    return () => clearInterval(interval);
  }, [fetchLinks]);

  const revokeLink = async (linkId: string) => {
    if (!confirm('Revoke this federation link? Shadow agents will be removed.')) return;
    await fetch(`${API}/federation/links/${linkId}`, { method: 'DELETE' });
    fetchLinks();
  };

  if (loading) {
    return <div style={{ padding: 20, color: 'var(--text-muted)' }}>Loading federation links...</div>;
  }

  if (error) {
    return (
      <div style={{ padding: 20 }}>
        <div style={{ color: 'var(--error)', marginBottom: 12 }}>⚠️ {error}</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>
          🔗 Federation Links
        </h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setShowPairDialog(true)}
            style={{
              padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)',
              background: 'var(--primary)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 500,
            }}
          >
            Create Invite
          </button>
          <button
            onClick={() => setShowJoinDialog(true)}
            style={{
              padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)',
              background: 'var(--surface-hover)', color: 'var(--text)', cursor: 'pointer', fontSize: 12, fontWeight: 500,
            }}
          >
            Join Federation
          </button>
        </div>
      </div>

      {links.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          No federation links yet. Create an invite to share a squad with another HiveClaw instance.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {links.map(link => (
            <FederationLinkCard key={link.id} link={link} onRevoke={() => revokeLink(link.id)} />
          ))}
        </div>
      )}

      {showPairDialog && <PairDialog onClose={() => { setShowPairDialog(false); fetchLinks(); }} />}
      {showJoinDialog && <JoinDialog onClose={() => { setShowJoinDialog(false); fetchLinks(); }} />}
    </div>
  );
}

// ── Link Card ────────────────────────────────────────────────────────────────

function FederationLinkCard({ link, onRevoke }: { link: FederationLink; onRevoke: () => void }) {
  const statusColor = {
    active: link.connected ? '#22c55e' : '#eab308',
    pending: '#eab308',
    disconnected: '#ef4444',
    revoked: '#6b7280',
  }[link.status];

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 14px', borderRadius: 8,
        border: '1px solid var(--border)', background: 'var(--surface)',
      }}
    >
      <div
        style={{
          width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0,
        }}
        title={link.connected ? 'Connected' : link.status}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
          {link.peerInstanceName}
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
            ({link.direction})
          </span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          {link.status}{link.connected ? ' · connected' : ''}
          {link.lastSeenAt && ` · last seen ${new Date(link.lastSeenAt).toLocaleTimeString()}`}
        </div>
      </div>
      {link.status !== 'revoked' && (
        <button
          onClick={onRevoke}
          style={{
            padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)',
            background: 'transparent', color: 'var(--error)', cursor: 'pointer', fontSize: 11,
          }}
        >
          Revoke
        </button>
      )}
    </div>
  );
}

// ── Pair Dialog ──────────────────────────────────────────────────────────────

function PairDialog({ onClose }: { onClose: () => void }) {
  const [squadId, setSquadId] = useState('');
  const [agentIds, setAgentIds] = useState('');
  const [result, setResult] = useState<{ token: string; inviteUrl: string; expiresAt: string } | null>(null);
  const [error, setError] = useState('');

  const createPairing = async () => {
    setError('');
    try {
      const res = await fetch(`${API}/federation/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          squadId,
          agentIds: agentIds.split(',').map(s => s.trim()).filter(Boolean),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to create pairing');
      setResult(json.data);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
    }}>
      <div style={{
        background: 'var(--surface)', borderRadius: 12, padding: 24,
        width: 400, maxWidth: '90vw', border: '1px solid var(--border)',
      }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600 }}>Create Federation Invite</h3>

        {!result ? (
          <>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Squad ID</label>
            <input
              value={squadId} onChange={e => setSquadId(e.target.value)}
              placeholder="squad-id-here"
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 6,
                border: '1px solid var(--border)', background: 'var(--surface-hover)',
                color: 'var(--text)', fontSize: 13, marginBottom: 12,
              }}
            />

            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
              Agent IDs to share (comma-separated)
            </label>
            <input
              value={agentIds} onChange={e => setAgentIds(e.target.value)}
              placeholder="agent-id-1, agent-id-2"
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 6,
                border: '1px solid var(--border)', background: 'var(--surface-hover)',
                color: 'var(--text)', fontSize: 13, marginBottom: 16,
              }}
            />

            {error && <div style={{ color: 'var(--error)', fontSize: 12, marginBottom: 8 }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={onClose} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text)', fontSize: 12 }}>
                Cancel
              </button>
              <button onClick={createPairing} disabled={!squadId || !agentIds} style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: 'var(--primary)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
                Generate Invite
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 12 }}>
              Share this invite token with the other HiveClaw instance:
            </div>
            <div style={{
              padding: 10, borderRadius: 6, background: 'var(--surface-hover)',
              fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all',
              border: '1px solid var(--border)', marginBottom: 12,
            }}>
              {result.token}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>
              Expires: {new Date(result.expiresAt).toLocaleString()}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: 'var(--primary)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Join Dialog ──────────────────────────────────────────────────────────────

function JoinDialog({ onClose }: { onClose: () => void }) {
  const [token, setToken] = useState('');
  const [agentIds, setAgentIds] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const acceptInvite = async () => {
    setError('');
    setStatus('Accepting invite...');
    try {
      const res = await fetch(`${API}/federation/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          agentIds: agentIds.split(',').map(s => s.trim()).filter(Boolean),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to accept invite');
      setStatus('Federation link established! ✅');
      setTimeout(onClose, 1500);
    } catch (err) {
      setError((err as Error).message);
      setStatus('');
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
    }}>
      <div style={{
        background: 'var(--surface)', borderRadius: 12, padding: 24,
        width: 400, maxWidth: '90vw', border: '1px solid var(--border)',
      }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600 }}>Join Federation</h3>

        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Invite Token</label>
        <input
          value={token} onChange={e => setToken(e.target.value)}
          placeholder="Paste the invite token here"
          style={{
            width: '100%', padding: '8px 10px', borderRadius: 6,
            border: '1px solid var(--border)', background: 'var(--surface-hover)',
            color: 'var(--text)', fontSize: 13, marginBottom: 12,
          }}
        />

        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
          Your Agent IDs to contribute (comma-separated)
        </label>
        <input
          value={agentIds} onChange={e => setAgentIds(e.target.value)}
          placeholder="my-agent-1, my-agent-2"
          style={{
            width: '100%', padding: '8px 10px', borderRadius: 6,
            border: '1px solid var(--border)', background: 'var(--surface-hover)',
            color: 'var(--text)', fontSize: 13, marginBottom: 16,
          }}
        />

        {error && <div style={{ color: 'var(--error)', fontSize: 12, marginBottom: 8 }}>{error}</div>}
        {status && <div style={{ color: 'var(--success, #22c55e)', fontSize: 12, marginBottom: 8 }}>{status}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text)', fontSize: 12 }}>
            Cancel
          </button>
          <button onClick={acceptInvite} disabled={!token || !agentIds} style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: 'var(--primary)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
            Accept & Connect
          </button>
        </div>
      </div>
    </div>
  );
}
