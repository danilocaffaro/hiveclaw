/**
 * Token Vault — Layer 2 (pre-flight) + Layer 3 (post-creation verifier)
 *
 * Layer 2: resolveGithubToken(db, account?) — finds the correct GitHub token,
 *          verifies it via GET /user, warns on mismatch.
 * Layer 3: verifyPublicUrl(url) — unauthenticated check that a URL is truly public.
 */

import type Database from 'better-sqlite3';
import { decrypt } from './credential-manager.js';

interface VaultRow {
  id: string;
  label: string;
  service: string;
  account: string;
  encrypted_value: string;
  iv: string;
  salt: string;
}

// ── Layer 2: Resolve GitHub token for a specific account ─────────────────────

export async function resolveGithubToken(
  db: Database.Database,
  requestedAccount?: string,
): Promise<{ token: string; account: string; source: 'vault' | 'env' }> {
  const passphrase =
    process.env['HIVECLAW_VAULT_KEY'] ??
    process.env['SUPERCLAW_VAULT_KEY'] ??
    'default-hiveclaw-key';

  if (requestedAccount) {
    const row = db
      .prepare(
        `SELECT id, label, service, account, encrypted_value, iv, salt
         FROM credential_vault
         WHERE service = 'github' AND account = ? AND used = 0
         LIMIT 1`,
      )
      .get(requestedAccount) as VaultRow | undefined;

    if (row) {
      try {
        const token = decrypt(row.encrypted_value, row.iv, row.salt, passphrase);
        const login = await verifyGithubLogin(token);
        if (login === requestedAccount) {
          return { token, account: login, source: 'vault' };
        }
        console.warn(
          `[TokenVault] Vault token for ${requestedAccount} resolved to account '${login}' — mismatch, falling back to env`,
        );
      } catch (err) {
        console.warn(`[TokenVault] Failed to use vault token for ${requestedAccount}:`, err);
      }
    }
  }

  // Fall back to env token
  const envToken =
    process.env['GITHUB_TOKEN'] ??
    process.env['GH_TOKEN'] ??
    process.env['GITHUB_ACCESS_TOKEN'] ??
    '';

  if (!envToken) {
    throw new Error(
      `[TokenVault] No GitHub token available${requestedAccount ? ` for account '${requestedAccount}'` : ''}. ` +
        `Store one via POST /api/token-vault or set GITHUB_TOKEN env var.`,
    );
  }

  try {
    const login = await verifyGithubLogin(envToken);
    if (requestedAccount && login !== requestedAccount) {
      console.warn(
        `[TokenVault] ⚠️  GITHUB_TOKEN belongs to '${login}', not '${requestedAccount}'. ` +
          `Resources created will appear under '${login}', not '${requestedAccount}'.`,
      );
    }
    return { token: envToken, account: login, source: 'env' };
  } catch {
    return { token: envToken, account: 'unknown', source: 'env' };
  }
}

async function verifyGithubLogin(token: string): Promise<string> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `token ${token}`,
      'User-Agent': 'HiveClaw-TokenVault/1.0',
    },
  });
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
  const data = (await res.json()) as { login: string };
  return data.login;
}

// ── Layer 3: Post-creation public URL verifier ────────────────────────────────

export interface VerifyResult {
  ok: boolean;
  status: number;
  reason?: string;
}

export async function verifyPublicUrl(url: string): Promise<VerifyResult> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'HiveClaw-URLVerifier/1.0',
        Accept: 'application/json,text/html,*/*',
        // Explicitly no Authorization header — simulates unauthenticated access
      },
      redirect: 'follow',
    });

    // GitHub API (gists, etc)
    if (url.includes('api.github.com')) {
      if (res.status === 404) {
        return { ok: false, status: 404, reason: 'Not found (GitHub API 404)' };
      }
      if (!res.ok) {
        return { ok: false, status: res.status, reason: `GitHub API error ${res.status}` };
      }
      const body = (await res.json()) as Record<string, unknown>;
      if (body['message'] === 'Not Found') {
        return { ok: false, status: res.status, reason: 'GitHub API returned message: "Not Found"' };
      }
      return { ok: true, status: res.status };
    }

    // GitHub Gist raw / HTML URLs
    if (url.includes('github.com') || url.includes('githubusercontent.com')) {
      if (res.status === 404) {
        return { ok: false, status: 404, reason: 'Not found (404)' };
      }
      if (!res.ok) {
        return { ok: false, status: res.status, reason: `HTTP error ${res.status}` };
      }
      const body = await res.text();
      // GitHub sometimes returns 200 with "404: Not Found" body text
      if (body.trim() === '404: Not Found' || body.trim() === 'Not Found') {
        return { ok: false, status: res.status, reason: 'URL returned "Not Found" body despite HTTP 200' };
      }
      return { ok: true, status: res.status };
    }

    // Generic URL
    if (!res.ok) {
      return { ok: false, status: res.status, reason: `HTTP error ${res.status}` };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      reason: `Network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
