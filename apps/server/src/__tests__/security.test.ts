import { describe, it, expect } from 'vitest';
import { validateToolPath, isCommandSafe, isPublicRoute } from '../config/security.js';
import { homedir } from 'os';
import { join } from 'path';

const workspace = process.env.SUPERCLAW_WORKSPACE ?? join(homedir(), '.superclaw', 'workspace');

describe('Security — validateToolPath', () => {
  it('should allow paths within workspace', () => {
    const result = validateToolPath(join(workspace, 'test.txt'));
    expect(result.allowed).toBe(true);
  });

  it('should block .ssh directory', () => {
    const result = validateToolPath(join(homedir(), '.ssh', 'id_rsa'), 'read');
    expect(result.allowed).toBe(false);
    expect(result.allowed === false && result.reason).toContain('.ssh');
  });

  it('should block .env files', () => {
    const result = validateToolPath(join(homedir(), 'project', '.env'), 'read');
    expect(result.allowed).toBe(false);
  });

  it('should block /etc/shadow', () => {
    const result = validateToolPath('/etc/shadow', 'read');
    expect(result.allowed).toBe(false);
  });

  it('should block write outside workspace (even to /tmp)', () => {
    const result = validateToolPath('/tmp/test.txt', 'write');
    expect(result.allowed).toBe(false);
  });

  it('should allow read from /tmp', () => {
    const result = validateToolPath('/tmp/test.txt', 'read');
    expect(result.allowed).toBe(true);
  });

  it('should allow CWD paths', () => {
    const result = validateToolPath(join(process.cwd(), 'package.json'));
    expect(result.allowed).toBe(true);
  });

  it('should block path traversal attempts', () => {
    const result = validateToolPath(join(workspace, '../../.ssh/id_rsa'));
    // Traversal resolves to homedir/.ssh — should be blocked
    expect(result.allowed).toBe(false);
  });
});

describe('Security — isCommandSafe', () => {
  it('should allow normal commands', () => {
    expect(isCommandSafe('ls -la').safe).toBe(true);
    expect(isCommandSafe('cat package.json').safe).toBe(true);
    expect(isCommandSafe('npm install').safe).toBe(true);
    expect(isCommandSafe('curl https://example.com').safe).toBe(true);
  });

  it('should block rm -rf /', () => {
    const result = isCommandSafe('rm -rf /');
    expect(result.safe).toBe(false);
  });

  it('should block rm -rf ~/', () => {
    const result = isCommandSafe('rm -rf ~/');
    expect(result.safe).toBe(false);
  });

  it('should block fork bomb', () => {
    const result = isCommandSafe(':(){ :|:& };:');
    expect(result.safe).toBe(false);
  });

  it('should block mkfs', () => {
    expect(isCommandSafe('mkfs.ext4 /dev/sda').safe).toBe(false);
  });

  it('should block shutdown', () => {
    expect(isCommandSafe('shutdown -h now').safe).toBe(false);
  });

  it('should block cat ~/.ssh/id_rsa', () => {
    expect(isCommandSafe('cat ~/.ssh/id_rsa').safe).toBe(false);
  });

  it('should block cat /etc/shadow', () => {
    expect(isCommandSafe('cat /etc/shadow').safe).toBe(false);
  });

  it('should block xmrig (crypto miner)', () => {
    expect(isCommandSafe('./xmrig --pool stratum+tcp://pool.example.com').safe).toBe(false);
  });

  it('should allow rm of specific files (not /', () => {
    expect(isCommandSafe('rm -rf /tmp/test-dir').safe).toBe(true);
  });
});

describe('Security — isPublicRoute', () => {
  it('should allow /api/health', () => {
    expect(isPublicRoute('/api/health')).toBe(true);
  });

  it('should allow /healthz', () => {
    expect(isPublicRoute('/healthz')).toBe(true);
  });

  it('should allow /setup/* routes', () => {
    expect(isPublicRoute('/setup/status')).toBe(true);
    expect(isPublicRoute('/setup/complete')).toBe(true);
  });

  it('should allow /public/* routes', () => {
    expect(isPublicRoute('/public/chat/abc123')).toBe(true);
  });

  it('should NOT allow /api/agents', () => {
    expect(isPublicRoute('/api/agents')).toBe(false);
  });

  it('should NOT allow /api/sessions', () => {
    expect(isPublicRoute('/api/sessions')).toBe(false);
  });

  it('should NOT allow /api/analytics', () => {
    expect(isPublicRoute('/api/analytics/usage')).toBe(false);
  });

  it('should strip query params when checking', () => {
    expect(isPublicRoute('/healthz?format=json')).toBe(true);
  });
});
