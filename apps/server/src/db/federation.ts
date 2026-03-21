/**
 * Federation Repository — CRUD for federation_links and federation_pairing tables.
 * Manages pairing tokens, links, and shadow agent lifecycle.
 */
import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';

// ── Types ────────────────────────────────────────────────────────────────────

export type LinkDirection = 'host' | 'guest';
export type LinkStatus = 'pending' | 'active' | 'disconnected' | 'revoked';

export interface FederationLink {
  id: string;
  peerInstanceId: string;
  peerInstanceName: string;
  peerUrl: string | null;
  direction: LinkDirection;
  sharedSquadId: string;
  connectionTokenHash: string;
  status: LinkStatus;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FederationPairing {
  tokenHash: string;
  squadId: string;
  contributedAgentIds: string[];
  expiresAt: string;
  accepted: boolean;
  acceptedLinkId: string | null;
  createdAt: string;
}

export interface CreatePairingResult {
  token: string;        // raw token (shown once to user)
  tokenHash: string;    // SHA-256 hash (stored in DB)
  expiresAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function generateId(): string {
  return randomBytes(16).toString('hex');
}

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

// ── Row types (DB snake_case) ────────────────────────────────────────────────

interface LinkRow {
  id: string;
  peer_instance_id: string;
  peer_instance_name: string;
  peer_url: string | null;
  direction: string;
  shared_squad_id: string;
  connection_token_hash: string;
  status: string;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PairingRow {
  token_hash: string;
  squad_id: string;
  contributed_agent_ids: string;
  expires_at: string;
  accepted: number;
  accepted_link_id: string | null;
  created_at: string;
}

function rowToLink(r: LinkRow): FederationLink {
  return {
    id: r.id,
    peerInstanceId: r.peer_instance_id,
    peerInstanceName: r.peer_instance_name,
    peerUrl: r.peer_url,
    direction: r.direction as LinkDirection,
    sharedSquadId: r.shared_squad_id,
    connectionTokenHash: r.connection_token_hash,
    status: r.status as LinkStatus,
    lastSeenAt: r.last_seen_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToPairing(r: PairingRow): FederationPairing {
  return {
    tokenHash: r.token_hash,
    squadId: r.squad_id,
    contributedAgentIds: JSON.parse(r.contributed_agent_ids || '[]'),
    expiresAt: r.expires_at,
    accepted: r.accepted === 1,
    acceptedLinkId: r.accepted_link_id,
    createdAt: r.created_at,
  };
}

// ── Repository ───────────────────────────────────────────────────────────────

export class FederationRepository {
  constructor(private db: Database.Database) {}

  // ── Pairing ──────────────────────────────────────────────────────────────

  /** Create a pairing token for a squad. Returns raw token (show once) + hash. */
  createPairingToken(squadId: string, agentIds: string[], expiresInMinutes = 30): CreatePairingResult {
    const token = generateToken();
    const tokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000).toISOString();

    this.db.prepare(`
      INSERT INTO federation_pairing (token_hash, squad_id, contributed_agent_ids, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(tokenHash, squadId, JSON.stringify(agentIds), expiresAt);

    return { token, tokenHash, expiresAt };
  }

  /** Validate and retrieve pairing info from a raw token. Returns null if invalid/expired/consumed. */
  getPairing(rawToken: string): FederationPairing | null {
    const hash = sha256(rawToken);
    const row = this.db.prepare('SELECT * FROM federation_pairing WHERE token_hash = ?').get(hash) as PairingRow | undefined;
    if (!row) return null;
    const pairing = rowToPairing(row);
    if (pairing.accepted) return null; // already consumed
    if (new Date(pairing.expiresAt) < new Date()) return null; // expired
    return pairing;
  }

  /** Get pairing by hash (for info endpoint — does NOT validate expiry/consumed). */
  getPairingByHash(tokenHash: string): FederationPairing | null {
    const row = this.db.prepare('SELECT * FROM federation_pairing WHERE token_hash = ?').get(tokenHash) as PairingRow | undefined;
    return row ? rowToPairing(row) : null;
  }

  /** Get raw pairing row for status checks (includes accepted/expired). */
  getPairingRaw(rawToken: string): { pairing: FederationPairing; expired: boolean; consumed: boolean } | null {
    const hash = sha256(rawToken);
    const row = this.db.prepare('SELECT * FROM federation_pairing WHERE token_hash = ?').get(hash) as PairingRow | undefined;
    if (!row) return null;
    const pairing = rowToPairing(row);
    return {
      pairing,
      expired: new Date(pairing.expiresAt) < new Date(),
      consumed: pairing.accepted,
    };
  }

  /** Mark pairing as consumed and associate with a link. */
  consumePairing(rawToken: string, linkId: string): boolean {
    const hash = sha256(rawToken);
    const result = this.db.prepare(`
      UPDATE federation_pairing
      SET accepted = 1, accepted_link_id = ?
      WHERE token_hash = ? AND accepted = 0 AND expires_at > datetime('now')
    `).run(linkId, hash);
    return result.changes > 0;
  }

  // ── Links ────────────────────────────────────────────────────────────────

  /** Create a new federation link. */
  createLink(opts: {
    peerInstanceId: string;
    peerInstanceName: string;
    peerUrl?: string;
    direction: LinkDirection;
    sharedSquadId: string;
    connectionTokenHash: string;
  }): FederationLink {
    const id = generateId();
    this.db.prepare(`
      INSERT INTO federation_links (id, peer_instance_id, peer_instance_name, peer_url, direction, shared_squad_id, connection_token_hash, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(id, opts.peerInstanceId, opts.peerInstanceName, opts.peerUrl ?? null, opts.direction, opts.sharedSquadId, opts.connectionTokenHash);

    return this.getLink(id)!;
  }

  /** Get a link by ID. */
  getLink(linkId: string): FederationLink | null {
    const row = this.db.prepare('SELECT * FROM federation_links WHERE id = ?').get(linkId) as LinkRow | undefined;
    return row ? rowToLink(row) : null;
  }

  /** Get a link by connection token hash. */
  getLinkByTokenHash(tokenHash: string): FederationLink | null {
    const row = this.db.prepare('SELECT * FROM federation_links WHERE connection_token_hash = ?').get(tokenHash) as LinkRow | undefined;
    return row ? rowToLink(row) : null;
  }

  /** List all links, optionally filtered by status. */
  listLinks(status?: LinkStatus): FederationLink[] {
    if (status) {
      return (this.db.prepare('SELECT * FROM federation_links WHERE status = ? ORDER BY created_at DESC').all(status) as LinkRow[]).map(rowToLink);
    }
    return (this.db.prepare('SELECT * FROM federation_links ORDER BY created_at DESC').all() as LinkRow[]).map(rowToLink);
  }

  /** Update link status. */
  updateLinkStatus(linkId: string, status: LinkStatus): void {
    this.db.prepare(`
      UPDATE federation_links SET status = ?, updated_at = datetime('now') WHERE id = ?
    `).run(status, linkId);
  }

  /** Update last_seen_at timestamp. */
  touchLink(linkId: string): void {
    this.db.prepare(`
      UPDATE federation_links SET last_seen_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
    `).run(linkId);
  }

  /** Delete a link and its shadow agents. Returns true if deleted. */
  deleteLink(linkId: string): boolean {
    const txn = this.db.transaction(() => {
      // Remove shadow agents first
      this.db.prepare('DELETE FROM agents WHERE federation_link_id = ?').run(linkId);
      // Remove the link
      const result = this.db.prepare('DELETE FROM federation_links WHERE id = ?').run(linkId);
      return result.changes > 0;
    });
    return txn();
  }

  /** Revoke a link — sets status to 'revoked' and removes shadow agents. */
  revokeLink(linkId: string): boolean {
    const txn = this.db.transaction(() => {
      this.db.prepare('DELETE FROM agents WHERE federation_link_id = ?').run(linkId);
      const result = this.db.prepare(`
        UPDATE federation_links SET status = 'revoked', updated_at = datetime('now') WHERE id = ?
      `).run(linkId);
      return result.changes > 0;
    });
    return txn();
  }

  // ── Shadow Agents ────────────────────────────────────────────────────────

  /** Create a shadow agent from a remote agent manifest entry. */
  createShadowAgent(opts: {
    linkId: string;
    remoteAgentId: string;
    name: string;
    emoji: string;
    role: string;
    model?: string;
  }): string {
    // Namespaced ID: fed:{peerInstancePrefix}:{remoteAgentId} — prevents collisions
    const link = this.getLink(opts.linkId);
    const peerPrefix = link?.peerInstanceId?.slice(0, 8) ?? 'unknown';
    const shadowId = `fed:${peerPrefix}:${opts.remoteAgentId}`;

    this.db.prepare(`
      INSERT OR REPLACE INTO agents (id, name, emoji, role, model_preference, engine_version, is_shadow, federation_link_id, remote_agent_id)
      VALUES (?, ?, ?, ?, ?, 2, 1, ?, ?)
    `).run(shadowId, opts.name, opts.emoji, opts.role, opts.model ?? 'remote', opts.linkId, opts.remoteAgentId);

    return shadowId;
  }

  /** List shadow agents for a federation link. */
  getShadowAgents(linkId: string): Array<{ id: string; name: string; emoji: string; remoteAgentId: string }> {
    return this.db.prepare(`
      SELECT id, name, emoji, remote_agent_id as remoteAgentId
      FROM agents WHERE federation_link_id = ? AND is_shadow = 1
    `).all(linkId) as Array<{ id: string; name: string; emoji: string; remoteAgentId: string }>;
  }

  /** Check if an agent is a shadow (federated remote). */
  isShadowAgent(agentId: string): boolean {
    const row = this.db.prepare('SELECT is_shadow FROM agents WHERE id = ?').get(agentId) as { is_shadow: number } | undefined;
    return row?.is_shadow === 1;
  }

  /** Get the federation link for a shadow agent. */
  getShadowAgentLink(agentId: string): FederationLink | null {
    const row = this.db.prepare('SELECT federation_link_id FROM agents WHERE id = ? AND is_shadow = 1').get(agentId) as { federation_link_id: string } | undefined;
    if (!row?.federation_link_id) return null;
    return this.getLink(row.federation_link_id);
  }

  /** Remove all shadow agents for a link. */
  removeShadowAgents(linkId: string): number {
    const result = this.db.prepare('DELETE FROM agents WHERE federation_link_id = ? AND is_shadow = 1').run(linkId);
    return result.changes;
  }
}
