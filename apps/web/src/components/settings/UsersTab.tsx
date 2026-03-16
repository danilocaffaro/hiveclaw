'use client';

import { useState, useEffect, useCallback } from 'react';
import { SectionTitle, SettingRow } from './shared';

interface UserItem {
  id: string;
  name: string | null;
  email: string | null;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  avatarUrl: string | null;
  createdAt: string;
  lastLogin: string | null;
}

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  owner: { label: 'Owner', color: '#F59E0B' },
  admin: { label: 'Admin', color: '#3B82F6' },
  member: { label: 'Member', color: '#10B981' },
  viewer: { label: 'Viewer', color: '#6B7280' },
};

export default function UsersTab() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<UserItem['role']>('member');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<UserItem['role']>('member');

  // Invite link state
  const [showInvite, setShowInvite] = useState(false);
  const [inviteRole, setInviteRole] = useState<'member' | 'viewer'>('member');
  const [inviteLink, setInviteLink] = useState('');
  const [inviteCopied, setInviteCopied] = useState(false);
  const [invites, setInvites] = useState<Array<{ id: string; code: string; role: string; uses: number; max_uses: number; expired: boolean; exhausted: boolean; created_at: string }>>([]);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/auth/users');
      if (res.ok) {
        const { data } = await res.json();
        setUsers(data);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // Invite link functions
  const fetchInvites = useCallback(async () => {
    try {
      const res = await fetch('/api/invites');
      if (res.ok) { const { data } = await res.json(); setInvites(data); }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchInvites(); }, [fetchInvites]);

  const createInvite = async () => {
    try {
      const res = await fetch('/api/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: inviteRole, maxUses: 5, expiresInDays: 7 }),
      });
      if (res.ok) {
        const { data } = await res.json();
        const link = `${window.location.origin}/invite/${data.code}`;
        setInviteLink(link);
        fetchInvites();
      }
    } catch { /* ignore */ }
  };

  const revokeInvite = async (id: string) => {
    await fetch(`/api/invites/${id}`, { method: 'DELETE' });
    fetchInvites();
  };

  const copyInviteLink = () => {
    navigator.clipboard.writeText(inviteLink);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  const createUser = async () => {
    if (!newName.trim()) return;
    try {
      const res = await fetch('/auth/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), email: newEmail.trim() || undefined, role: newRole }),
      });
      if (res.ok) {
        setShowCreate(false);
        setNewName('');
        setNewEmail('');
        setNewRole('member');
        fetchUsers();
      }
    } catch { /* ignore */ }
  };

  const updateUser = async (id: string) => {
    try {
      await fetch(`/auth/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), role: editRole }),
      });
      setEditingId(null);
      fetchUsers();
    } catch { /* ignore */ }
  };

  const deleteUser = async (id: string, name: string | null) => {
    if (!confirm(`Delete user "${name ?? id}"? This cannot be undone.`)) return;
    try {
      await fetch(`/auth/users/${id}`, { method: 'DELETE' });
      fetchUsers();
    } catch { /* ignore */ }
  };

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div title="Users & Access" aria-label="Users & Access">
      <SectionTitle title="Users & Access" desc="Manage who can access your HiveClaw workspace." />

      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        {['owner', 'admin', 'member', 'viewer'].map(role => {
          const count = users.filter(u => u.role === role).length;
          const meta = ROLE_LABELS[role];
          return (
            <div key={role} style={{
              padding: '8px 14px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              fontSize: 12,
            }}>
              <span style={{ color: meta.color, fontWeight: 600 }}>{count}</span>
              <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>{meta.label}{count !== 1 ? 's' : ''}</span>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => setShowInvite(v => !v)}
          style={{
            padding: '6px 14px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--accent)',
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            border: 'none',
            cursor: 'pointer',
          }}
        >
          🔗 Generate Invite Link
        </button>
        <button
          onClick={() => setShowCreate(v => !v)}
          style={{
            padding: '6px 14px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--coral)',
            color: '#000',
            fontSize: 12,
            fontWeight: 600,
            border: 'none',
            cursor: 'pointer',
          }}
        >
          + Invite User
        </button>
        <button
          onClick={fetchUsers}
          style={{
            padding: '6px 14px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface)',
            color: 'var(--text)',
            fontSize: 12,
            border: '1px solid var(--border)',
            cursor: 'pointer',
          }}
        >
          🔄 Refresh
        </button>
      </div>

      {/* Invite Link Panel */}
      {showInvite && (
        <div style={{
          padding: 16, marginBottom: 16,
          borderRadius: 'var(--radius-lg)',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text)' }}>
            🔗 Generate Invite Link
          </div>

          {!inviteLink ? (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Role:</label>
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value as 'member' | 'viewer')}
                style={{
                  padding: '5px 8px', borderRadius: 'var(--radius-md)',
                  background: 'var(--input-bg)', border: '1px solid var(--border)',
                  color: 'var(--text)', fontSize: 12,
                }}
              >
                <option value="member">Member (can chat)</option>
                <option value="viewer">Viewer (read only)</option>
              </select>
              <button onClick={createInvite} style={{
                padding: '6px 14px', borderRadius: 'var(--radius-md)',
                background: 'var(--accent)', color: '#fff',
                fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
              }}>
                Generate
              </button>
            </div>
          ) : (
            <div>
              <div style={{
                display: 'flex', gap: 8, alignItems: 'center',
                padding: '10px 12px', borderRadius: 'var(--radius-md)',
                background: 'var(--surface)', border: '1px solid var(--border)',
              }}>
                <input
                  readOnly value={inviteLink}
                  style={{
                    flex: 1, background: 'transparent', border: 'none',
                    color: 'var(--text)', fontSize: 12, outline: 'none',
                  }}
                />
                <button onClick={copyInviteLink} style={{
                  padding: '4px 10px', borderRadius: 'var(--radius-sm)',
                  background: inviteCopied ? '#10B981' : 'var(--accent)',
                  color: '#fff', fontSize: 11, fontWeight: 600,
                  border: 'none', cursor: 'pointer',
                }}>
                  {inviteCopied ? '✓ Copied' : '📋 Copy'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                Expires in 7 days · 5 uses max · Share this link with anyone you want to invite
              </div>
              <button
                onClick={() => { setInviteLink(''); setShowInvite(false); }}
                style={{
                  marginTop: 8, padding: '4px 10px', fontSize: 11,
                  background: 'transparent', color: 'var(--text-muted)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                }}
              >
                Done
              </button>
            </div>
          )}

          {/* Active invites */}
          {invites.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Active Invite Links
              </div>
              {invites.map(inv => (
                <div key={inv.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '8px 0',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 12,
                }}>
                  <span style={{ color: inv.expired || inv.exhausted ? 'var(--text-muted)' : 'var(--text)' }}>
                    {inv.code.slice(0, 8)}…
                  </span>
                  <span style={{ color: ROLE_LABELS[inv.role]?.color ?? '#6B7280', fontSize: 11 }}>
                    {inv.role}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                    {inv.uses}/{inv.max_uses} used
                  </span>
                  {(inv.expired || inv.exhausted) && (
                    <span style={{ color: '#EF4444', fontSize: 10 }}>
                      {inv.expired ? 'Expired' : 'Exhausted'}
                    </span>
                  )}
                  <button onClick={() => revokeInvite(inv.id)} style={{
                    marginLeft: 'auto', padding: '2px 8px', fontSize: 10,
                    background: 'transparent', color: '#EF4444',
                    border: '1px solid #EF4444', borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                  }}>
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div style={{
          padding: 16,
          borderRadius: 'var(--radius-lg)',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          marginBottom: 16,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>
            New User
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Name"
              style={{
                flex: 1, padding: '8px 12px', borderRadius: 8,
                background: 'var(--bg)', border: '1px solid var(--border)',
                color: 'var(--text)', fontSize: 13,
              }}
            />
            <input
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              placeholder="Email (optional)"
              style={{
                flex: 1, padding: '8px 12px', borderRadius: 8,
                background: 'var(--bg)', border: '1px solid var(--border)',
                color: 'var(--text)', fontSize: 13,
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              value={newRole}
              onChange={e => setNewRole(e.target.value as UserItem['role'])}
              style={{
                padding: '8px 12px', borderRadius: 8,
                background: 'var(--bg)', border: '1px solid var(--border)',
                color: 'var(--text)', fontSize: 13,
              }}
            >
              <option value="admin">Admin</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
            <button onClick={createUser} style={{
              padding: '8px 16px', borderRadius: 8,
              background: 'var(--coral)', color: '#000',
              fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
            }}>
              Create
            </button>
            <button onClick={() => setShowCreate(false)} style={{
              padding: '8px 16px', borderRadius: 8,
              background: 'transparent', color: 'var(--text-muted)',
              fontSize: 12, border: '1px solid var(--border)', cursor: 'pointer',
            }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* User list */}
      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 20, textAlign: 'center' }}>
          Loading users...
        </div>
      ) : users.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 20, textAlign: 'center' }}>
          No users found.
        </div>
      ) : (
        <div style={{
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          overflow: 'hidden',
        }}>
          {users.map((user, i) => {
            const meta = ROLE_LABELS[user.role];
            const isEditing = editingId === user.id;

            return (
              <div key={user.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 16px',
                borderBottom: i < users.length - 1 ? '1px solid var(--border)' : 'none',
                background: isEditing ? 'var(--surface-hover)' : 'transparent',
              }}>
                {/* Avatar */}
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: `${meta.color}22`,
                  color: meta.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, fontWeight: 600, flexShrink: 0,
                }}>
                  {(user.name ?? '?')[0].toUpperCase()}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {isEditing ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        style={{
                          flex: 1, padding: '4px 8px', borderRadius: 6,
                          background: 'var(--bg)', border: '1px solid var(--border)',
                          color: 'var(--text)', fontSize: 13,
                        }}
                      />
                      <select
                        value={editRole}
                        onChange={e => setEditRole(e.target.value as UserItem['role'])}
                        style={{
                          padding: '4px 8px', borderRadius: 6,
                          background: 'var(--bg)', border: '1px solid var(--border)',
                          color: 'var(--text)', fontSize: 12,
                        }}
                      >
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                        {user.name ?? 'Unnamed'}
                        {user.email && (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                            {user.email}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        Last login: {formatDate(user.lastLogin)} · Created: {formatDate(user.createdAt)}
                      </div>
                    </>
                  )}
                </div>

                {/* Role badge */}
                <span style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 99,
                  background: `${meta.color}22`,
                  color: meta.color,
                  flexShrink: 0,
                }}>
                  {meta.label}
                </span>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  {isEditing ? (
                    <>
                      <button onClick={() => updateUser(user.id)} style={{
                        padding: '4px 10px', borderRadius: 6,
                        background: 'var(--coral)', color: '#000',
                        fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
                      }}>Save</button>
                      <button onClick={() => setEditingId(null)} style={{
                        padding: '4px 10px', borderRadius: 6,
                        background: 'transparent', color: 'var(--text-muted)',
                        fontSize: 11, border: '1px solid var(--border)', cursor: 'pointer',
                      }}>Cancel</button>
                    </>
                  ) : (
                    <>
                      {user.role !== 'owner' && (
                        <>
                          <button onClick={() => { setEditingId(user.id); setEditName(user.name ?? ''); setEditRole(user.role); }} style={{
                            padding: '4px 8px', borderRadius: 6,
                            background: 'var(--surface)', color: 'var(--text-muted)',
                            fontSize: 11, border: '1px solid var(--border)', cursor: 'pointer',
                          }}>✏️</button>
                          <button onClick={() => deleteUser(user.id, user.name)} style={{
                            padding: '4px 8px', borderRadius: 6,
                            background: 'var(--surface)', color: 'var(--red, #f85149)',
                            fontSize: 11, border: '1px solid var(--border)', cursor: 'pointer',
                          }}>🗑️</button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
