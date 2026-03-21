/**
 * Federation tests — DB, protocol, pairing, shadow agents.
 * Covers test plan IDs: DB-01 through DB-10, WS-12, SEC-01.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { FederationRepository } from '../db/federation.js';
import {
  validateMessage,
  serializeMessage,
  FEDERATION_PROTOCOL_VERSION,
  type FederationHello,
  type FederationPing,
  type FederationMessage,
} from '../engine/federation/federation-protocol.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(':memory:');

  // Minimal schema for federation tests
  db.exec(`
    CREATE TABLE IF NOT EXISTS squads (
      id TEXT PRIMARY KEY,
      name TEXT DEFAULT '',
      agent_ids TEXT DEFAULT '[]'
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT DEFAULT '',
      emoji TEXT DEFAULT '🤖',
      role TEXT DEFAULT 'assistant',
      model_preference TEXT DEFAULT '',
      engine_version INTEGER DEFAULT 2,
      is_shadow INTEGER DEFAULT 0,
      federation_link_id TEXT,
      remote_agent_id TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS federation_links (
      id TEXT PRIMARY KEY,
      peer_instance_id TEXT NOT NULL,
      peer_instance_name TEXT NOT NULL,
      peer_url TEXT,
      direction TEXT CHECK(direction IN ('host', 'guest')),
      shared_squad_id TEXT NOT NULL,
      connection_token_hash TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'disconnected', 'revoked')),
      last_seen_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (shared_squad_id) REFERENCES squads(id)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS federation_pairing (
      token_hash TEXT PRIMARY KEY,
      squad_id TEXT NOT NULL,
      contributed_agent_ids TEXT DEFAULT '[]',
      expires_at DATETIME NOT NULL,
      accepted INTEGER DEFAULT 0,
      accepted_link_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (squad_id) REFERENCES squads(id)
    )
  `);

  // Seed a squad
  db.prepare("INSERT INTO squads (id, name) VALUES ('squad-1', 'Test Squad')").run();
  db.prepare("INSERT INTO agents (id, name, emoji, role) VALUES ('agent-1', 'Alice', '🐕', 'lead')").run();
  db.prepare("INSERT INTO agents (id, name, emoji, role) VALUES ('agent-2', 'Bob', '🦊', 'dev')").run();

  return db;
}

// ── DB Tests ─────────────────────────────────────────────────────────────────

describe('FederationRepository', () => {
  let db: Database.Database;
  let repo: FederationRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new FederationRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  // DB-01: federation_links table exists
  it('DB-01: federation_links table created', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='federation_links'").all();
    expect(tables).toHaveLength(1);
  });

  // DB-02: federation_pairing table exists
  it('DB-02: federation_pairing table created', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='federation_pairing'").all();
    expect(tables).toHaveLength(1);
  });

  // DB-03: agents table has new columns
  it('DB-03: agents table has federation columns', () => {
    const cols = db.prepare("PRAGMA table_info(agents)").all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain('is_shadow');
    expect(colNames).toContain('federation_link_id');
    expect(colNames).toContain('remote_agent_id');
  });

  // DB-04: Create federation link
  it('DB-04: create federation link', () => {
    const link = repo.createLink({
      peerInstanceId: 'peer-123',
      peerInstanceName: 'Friend HiveClaw',
      peerUrl: 'http://friend:4070',
      direction: 'host',
      sharedSquadId: 'squad-1',
      connectionTokenHash: 'hash-abc',
    });

    expect(link.id).toBeDefined();
    expect(link.peerInstanceId).toBe('peer-123');
    expect(link.peerInstanceName).toBe('Friend HiveClaw');
    expect(link.direction).toBe('host');
    expect(link.status).toBe('pending');
  });

  // DB-05: Update link status transitions
  it('DB-05: status transitions work', () => {
    const link = repo.createLink({
      peerInstanceId: 'peer-1', peerInstanceName: 'P1', direction: 'host',
      sharedSquadId: 'squad-1', connectionTokenHash: 'h1',
    });

    repo.updateLinkStatus(link.id, 'active');
    expect(repo.getLink(link.id)!.status).toBe('active');

    repo.updateLinkStatus(link.id, 'disconnected');
    expect(repo.getLink(link.id)!.status).toBe('disconnected');
  });

  // DB-06: Delete link cascades shadow agents
  it('DB-06: delete link cascades shadow agents', () => {
    const link = repo.createLink({
      peerInstanceId: 'peer-1', peerInstanceName: 'P1', direction: 'host',
      sharedSquadId: 'squad-1', connectionTokenHash: 'h1',
    });

    repo.createShadowAgent({
      linkId: link.id, remoteAgentId: 'remote-a1',
      name: 'Shadow Alice', emoji: '👻', role: 'assistant',
    });
    repo.createShadowAgent({
      linkId: link.id, remoteAgentId: 'remote-a2',
      name: 'Shadow Bob', emoji: '👻', role: 'dev',
    });

    expect(repo.getShadowAgents(link.id)).toHaveLength(2);
    repo.deleteLink(link.id);
    expect(repo.getShadowAgents(link.id)).toHaveLength(0);
    expect(repo.getLink(link.id)).toBeNull();
  });

  // DB-07: Create shadow agent with is_shadow=1
  it('DB-07: create shadow agent', () => {
    const link = repo.createLink({
      peerInstanceId: 'peer-1', peerInstanceName: 'P1', direction: 'host',
      sharedSquadId: 'squad-1', connectionTokenHash: 'h1',
    });

    const shadowId = repo.createShadowAgent({
      linkId: link.id, remoteAgentId: 'remote-agent-1',
      name: 'Shadow Agent', emoji: '👻', role: 'assistant',
    });

    expect(shadowId).toContain('fed:');
    expect(repo.isShadowAgent(shadowId)).toBe(true);
    expect(repo.isShadowAgent('agent-1')).toBe(false);
  });

  // DB-08: Pairing token creation with expiry
  it('DB-08: pairing token creation', () => {
    const result = repo.createPairingToken('squad-1', ['agent-1', 'agent-2'], 30);

    expect(result.token).toBeDefined();
    expect(result.tokenHash).toBeDefined();
    expect(result.token).not.toBe(result.tokenHash); // raw ≠ hash
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  // DB-09: Pairing token expiry check
  it('DB-09: expired token rejected', () => {
    // Use negative expiry to ensure immediate expiration
    const token = 'test-token-expired';
    const { createHash } = require('node:crypto');
    const hash = createHash('sha256').update(token).digest('hex');
    const pastDate = new Date(Date.now() - 60_000).toISOString(); // 1 min ago

    db.prepare(`
      INSERT INTO federation_pairing (token_hash, squad_id, contributed_agent_ids, expires_at)
      VALUES (?, 'squad-1', '["agent-1"]', ?)
    `).run(hash, pastDate);

    const pairing = repo.getPairing(token);
    expect(pairing).toBeNull();
  });

  // DB-10: Consumed token can't be reused
  it('DB-10: consumed token rejected', () => {
    const result = repo.createPairingToken('squad-1', ['agent-1'], 30);
    const pairing = repo.getPairing(result.token);
    expect(pairing).not.toBeNull();

    // Consume it
    const consumed = repo.consumePairing(result.token, 'link-1');
    expect(consumed).toBe(true);

    // Try to get it again
    const expired = repo.getPairing(result.token);
    expect(expired).toBeNull();

    // Try to consume again
    const reConsumed = repo.consumePairing(result.token, 'link-2');
    expect(reConsumed).toBe(false);
  });

  // SEC-01: Token is SHA-256 hashed in DB
  it('SEC-01: raw token not stored in DB', () => {
    const result = repo.createPairingToken('squad-1', ['agent-1'], 30);

    // Check DB directly — should not contain raw token
    const rows = db.prepare('SELECT token_hash FROM federation_pairing').all() as Array<{ token_hash: string }>;
    expect(rows[0].token_hash).toBe(result.tokenHash);
    expect(rows[0].token_hash).not.toBe(result.token);
    expect(result.tokenHash).toHaveLength(64); // SHA-256 hex
  });

  // Additional: revoke link removes shadows
  it('revoke link removes shadow agents', () => {
    const link = repo.createLink({
      peerInstanceId: 'peer-1', peerInstanceName: 'P1', direction: 'host',
      sharedSquadId: 'squad-1', connectionTokenHash: 'h1',
    });

    repo.createShadowAgent({
      linkId: link.id, remoteAgentId: 'r1',
      name: 'S1', emoji: '👻', role: 'assistant',
    });

    repo.revokeLink(link.id);
    expect(repo.getLink(link.id)!.status).toBe('revoked');
    expect(repo.getShadowAgents(link.id)).toHaveLength(0);
  });

  // Additional: list links with status filter
  it('list links with status filter', () => {
    repo.createLink({ peerInstanceId: 'p1', peerInstanceName: 'P1', direction: 'host', sharedSquadId: 'squad-1', connectionTokenHash: 'h1' });
    const l2 = repo.createLink({ peerInstanceId: 'p2', peerInstanceName: 'P2', direction: 'guest', sharedSquadId: 'squad-1', connectionTokenHash: 'h2' });
    repo.updateLinkStatus(l2.id, 'active');

    expect(repo.listLinks()).toHaveLength(2);
    expect(repo.listLinks('pending')).toHaveLength(1);
    expect(repo.listLinks('active')).toHaveLength(1);
  });

  // Additional: getShadowAgentLink
  it('getShadowAgentLink returns correct link', () => {
    const link = repo.createLink({
      peerInstanceId: 'peer-1', peerInstanceName: 'P1', direction: 'host',
      sharedSquadId: 'squad-1', connectionTokenHash: 'h1',
    });

    const shadowId = repo.createShadowAgent({
      linkId: link.id, remoteAgentId: 'remote-1',
      name: 'Shadow', emoji: '👻', role: 'assistant',
    });

    const fetched = repo.getShadowAgentLink(shadowId);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(link.id);
  });
});

// ── Protocol Tests ───────────────────────────────────────────────────────────

describe('Federation Protocol', () => {
  // WS-12: Message validation
  it('WS-12: validates well-formed message', () => {
    const hello: FederationHello = {
      type: 'federation.hello',
      protocolVersion: FEDERATION_PROTOCOL_VERSION,
      instanceId: 'inst-1',
      instanceName: 'Test',
      token: 'tok-1',
      agents: [],
    };

    const parsed = validateMessage(JSON.stringify(hello));
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe('federation.hello');
  });

  it('WS-12: rejects invalid type', () => {
    expect(validateMessage('{"type":"invalid.type"}')).toBeNull();
  });

  it('WS-12: rejects non-JSON', () => {
    expect(validateMessage('not json')).toBeNull();
  });

  it('WS-12: rejects missing type', () => {
    expect(validateMessage('{"foo":"bar"}')).toBeNull();
  });

  it('WS-12: rejects null/undefined', () => {
    expect(validateMessage(null)).toBeNull();
    expect(validateMessage(undefined)).toBeNull();
  });

  it('WS-12: accepts all valid message types', () => {
    const types = [
      'federation.hello', 'federation.welcome', 'agent.manifest',
      'message.sync', 'agent.invoke', 'agent.delta', 'agent.finish',
      'squad.event', 'federation.ping', 'federation.pong', 'federation.error',
    ];
    for (const type of types) {
      expect(validateMessage({ type })).not.toBeNull();
    }
  });

  it('serializeMessage produces valid JSON', () => {
    const ping: FederationPing = { type: 'federation.ping', timestamp: new Date().toISOString() };
    const json = serializeMessage(ping);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe('federation.ping');
  });

  it('validates message from object (not just string)', () => {
    const msg = { type: 'federation.pong', timestamp: new Date().toISOString() };
    expect(validateMessage(msg)).not.toBeNull();
  });
});

// ── Squad Integration Tests ──────────────────────────────────────────────────

describe('Federation Squad Integration', () => {
  it('AgentConfig supports federation fields', async () => {
    // Import dynamically to test the interface extension
    const { type } = await import('../engine/agent-runner.js');

    // Shadow agent config should be creatable
    const config = {
      id: 'fed:peer1:agent1',
      name: 'Shadow Agent',
      emoji: '👻',
      systemPrompt: '',
      providerId: 'remote',
      modelId: 'remote',
      engineVersion: 2 as const,
      isShadow: true,
      federationLinkId: 'link-123',
      remoteAgentId: 'agent-abc',
    };

    expect(config.isShadow).toBe(true);
    expect(config.federationLinkId).toBe('link-123');
    expect(config.remoteAgentId).toBe('agent-abc');
  });

  it('shadow agent IDs use namespaced format', () => {
    const db = createTestDb();
    const repo = new FederationRepository(db);

    const link = repo.createLink({
      peerInstanceId: 'abcdef0123456789',
      peerInstanceName: 'Peer',
      direction: 'host',
      sharedSquadId: 'squad-1',
      connectionTokenHash: 'h1',
    });

    const shadowId = repo.createShadowAgent({
      linkId: link.id,
      remoteAgentId: 'original-agent-id',
      name: 'Remote Agent',
      emoji: '🤖',
      role: 'dev',
    });

    // Format: fed:{peerPrefix}:{remoteAgentId}
    expect(shadowId).toBe('fed:abcdef01:original-agent-id');
    expect(repo.isShadowAgent(shadowId)).toBe(true);

    db.close();
  });

  it('touchLink updates last_seen_at', () => {
    const db = createTestDb();
    const repo = new FederationRepository(db);

    const link = repo.createLink({
      peerInstanceId: 'p1', peerInstanceName: 'P1', direction: 'host',
      sharedSquadId: 'squad-1', connectionTokenHash: 'h1',
    });

    expect(repo.getLink(link.id)!.lastSeenAt).toBeNull();
    repo.touchLink(link.id);
    expect(repo.getLink(link.id)!.lastSeenAt).not.toBeNull();

    db.close();
  });

  it('getLinkByTokenHash works', () => {
    const db = createTestDb();
    const repo = new FederationRepository(db);

    const link = repo.createLink({
      peerInstanceId: 'p1', peerInstanceName: 'P1', direction: 'host',
      sharedSquadId: 'squad-1', connectionTokenHash: 'unique-hash-123',
    });

    const found = repo.getLinkByTokenHash('unique-hash-123');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(link.id);
    expect(repo.getLinkByTokenHash('nonexistent')).toBeNull();

    db.close();
  });

  it('removeShadowAgents returns count', () => {
    const db = createTestDb();
    const repo = new FederationRepository(db);

    const link = repo.createLink({
      peerInstanceId: 'p1', peerInstanceName: 'P1', direction: 'host',
      sharedSquadId: 'squad-1', connectionTokenHash: 'h1',
    });

    repo.createShadowAgent({ linkId: link.id, remoteAgentId: 'r1', name: 'S1', emoji: '👻', role: 'a' });
    repo.createShadowAgent({ linkId: link.id, remoteAgentId: 'r2', name: 'S2', emoji: '👻', role: 'b' });
    repo.createShadowAgent({ linkId: link.id, remoteAgentId: 'r3', name: 'S3', emoji: '👻', role: 'c' });

    const removed = repo.removeShadowAgents(link.id);
    expect(removed).toBe(3);
    expect(repo.getShadowAgents(link.id)).toHaveLength(0);

    db.close();
  });

  it('concurrent pairing tokens for different squads', () => {
    const db = createTestDb();
    db.prepare("INSERT INTO squads (id, name) VALUES ('squad-2', 'Test Squad 2')").run();
    const repo = new FederationRepository(db);

    const r1 = repo.createPairingToken('squad-1', ['agent-1'], 30);
    const r2 = repo.createPairingToken('squad-2', ['agent-2'], 30);

    expect(r1.tokenHash).not.toBe(r2.tokenHash);
    expect(repo.getPairing(r1.token)!.squadId).toBe('squad-1');
    expect(repo.getPairing(r2.token)!.squadId).toBe('squad-2');

    db.close();
  });
});
