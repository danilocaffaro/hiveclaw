/**
 * HiveClaw — Remote Access Tunnel Manager
 *
 * Manages a cloudflared quick-tunnel or ngrok tunnel to expose the local
 * HiveClaw server to the internet.  100 % generic — no hardcoded paths,
 * works in any workspace, any user, any machine.
 *
 * Features:
 *   - Auto-detects cloudflared / ngrok in PATH
 *   - Parses tunnel URL from stdout
 *   - Auth token required for remote access (security)
 *   - Auto-reconnect with exponential backoff (max 3 attempts)
 *   - URL persistence in settings table
 *   - ngrok auth token check + warning
 */

import { spawn, type ChildProcess } from 'child_process';
import { execSync } from 'child_process';
import { randomBytes } from 'crypto';
import { getDb } from '../db/schema.js';

/* ── Types ─────────────────────────────────────────────────────────────── */

export type TunnelProvider = 'cloudflared' | 'ngrok';

export interface TunnelStatus {
  active: boolean;
  url: string | null;
  provider: TunnelProvider | null;
  startedAt: string | null;
  accessToken: string | null;
  reconnectAttempts: number;
  ngrokAuthConfigured: boolean | null;
}

/* ── Settings persistence helpers ──────────────────────────────────────── */

function saveSetting(key: string, value: string): void {
  try {
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
  } catch { /* non-fatal */ }
}

function loadSetting(key: string): string | null {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  } catch { return null; }
}

function deleteSetting(key: string): void {
  try {
    const db = getDb();
    db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  } catch { /* non-fatal */ }
}

/* ── TunnelManager ─────────────────────────────────────────────────────── */

export class TunnelManager {
  private proc: ChildProcess | null = null;
  private _url: string | null = null;
  private _provider: TunnelProvider | null = null;
  private _startedAt: string | null = null;
  private _accessToken: string | null = null;
  private _reconnectAttempts = 0;
  private _maxReconnectAttempts = 3;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _port = 4070;
  private _autoReconnect = true;

  /* ── Public getters ─────────────────────────────────────────────────── */

  get status(): TunnelStatus {
    return {
      active: this.proc !== null && this._url !== null,
      url: this._url,
      provider: this._provider,
      startedAt: this._startedAt,
      accessToken: this._accessToken,
      reconnectAttempts: this._reconnectAttempts,
      ngrokAuthConfigured: this._provider === 'ngrok' ? this.isNgrokAuthConfigured() : null,
    };
  }

  /* ── Detect available providers ──────────────────────────────────────── */

  detectProviders(): TunnelProvider[] {
    const available: TunnelProvider[] = [];
    for (const bin of ['cloudflared', 'ngrok'] as const) {
      try {
        execSync(`which ${bin}`, { stdio: 'ignore' });
        available.push(bin);
      } catch { /* not found */ }
    }
    return available;
  }

  /* ── Check ngrok auth token ─────────────────────────────────────────── */

  isNgrokAuthConfigured(): boolean {
    try {
      const home = process.env.HOME || process.env.USERPROFILE || '';
      const { existsSync, readFileSync } = require('fs');
      const { join } = require('path');
      // ngrok stores config in ~/.config/ngrok/ngrok.yml or ~/.ngrok2/ngrok.yml
      const paths = [
        join(home, '.config', 'ngrok', 'ngrok.yml'),
        join(home, '.ngrok2', 'ngrok.yml'),
      ];
      for (const p of paths) {
        if (existsSync(p)) {
          const content = readFileSync(p, 'utf-8');
          if (content.includes('authtoken:') && !content.includes('authtoken: ""')) {
            return true;
          }
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /* ── Start tunnel ────────────────────────────────────────────────────── */

  async start(provider?: TunnelProvider, port?: number): Promise<string> {
    if (this.proc) throw new Error('Tunnel already running');

    this._port = port || 4070;
    this._reconnectAttempts = 0;

    const available = this.detectProviders();
    const chosen = provider ?? available[0];
    if (!chosen) throw new Error('No tunnel provider found. Install cloudflared or ngrok.');
    if (!available.includes(chosen)) throw new Error(`${chosen} not found in PATH`);

    // ngrok without auth token warning
    if (chosen === 'ngrok' && !this.isNgrokAuthConfigured()) {
      // Still allow it, but it'll be rate-limited
      console.warn('[tunnel] ⚠️  ngrok auth token not configured — connections will be rate-limited. Run: ngrok config add-authtoken <TOKEN>');
    }

    // Generate access token for this tunnel session
    this._accessToken = randomBytes(24).toString('base64url');

    // Persist access token
    saveSetting('tunnel_access_token', this._accessToken);

    return this._spawn(chosen);
  }

  /* ── Internal spawn ──────────────────────────────────────────────────── */

  private _spawn(provider: TunnelProvider): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.stop();
        reject(new Error(`Tunnel failed to start within 30 s`));
      }, 30_000);

      const args =
        provider === 'cloudflared'
          ? ['tunnel', '--url', `http://127.0.0.1:${this._port}`]
          : ['http', String(this._port)];

      this.proc = spawn(provider, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      this._provider = provider;
      this._startedAt = new Date().toISOString();

      const onData = (chunk: Buffer) => {
        const line = chunk.toString();
        const urlMatch = line.match(
          provider === 'cloudflared'
            ? /https:\/\/[a-z0-9-]+\.trycloudflare\.com/
            : /https:\/\/[a-z0-9-]+\.ngrok[a-z-]*\.\w+/,
        );
        if (urlMatch && !this._url) {
          this._url = urlMatch[0];
          clearTimeout(timeout);
          // Persist URL to DB
          saveSetting('tunnel_url', this._url);
          saveSetting('tunnel_provider', provider);
          saveSetting('tunnel_started_at', this._startedAt!);
          resolve(this._url);
        }
      };

      this.proc.stdout?.on('data', onData);
      this.proc.stderr?.on('data', onData);

      this.proc.on('error', err => {
        clearTimeout(timeout);
        this.cleanup();
        reject(err);
      });

      this.proc.on('exit', (code) => {
        clearTimeout(timeout);
        const wasActive = this._url !== null;
        this.cleanup();

        if (wasActive && this._autoReconnect && this._reconnectAttempts < this._maxReconnectAttempts) {
          // Auto-reconnect with exponential backoff
          this._reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts), 30_000);
          console.log(`[tunnel] Process exited (code ${code}). Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts}/${this._maxReconnectAttempts})...`);

          this._reconnectTimer = setTimeout(async () => {
            try {
              await this._spawn(provider);
              console.log(`[tunnel] Reconnected successfully: ${this._url}`);
            } catch (err) {
              console.error(`[tunnel] Reconnect failed:`, err);
            }
          }, delay);
        } else if (wasActive) {
          console.log(`[tunnel] Process exited (code ${code}). Max reconnect attempts reached.`);
          this.clearPersistedState();
        }
      });
    });
  }

  /* ── Stop tunnel ─────────────────────────────────────────────────────── */

  stop(): void {
    this._autoReconnect = false;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.proc) {
      this.proc.kill('SIGTERM');
      this.proc = null;
    }
    this.cleanup();
    this.clearPersistedState();
    // Reset auto-reconnect for next start
    this._autoReconnect = true;
  }

  /* ── Verify access token ─────────────────────────────────────────────── */

  verifyAccessToken(token: string | undefined): boolean {
    if (!this._accessToken) return false;
    if (!token) return false;
    // Constant-time comparison
    const a = Buffer.from(this._accessToken);
    const b = Buffer.from(token);
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) result |= a[i]! ^ b[i]!;
    return result === 0;
  }

  /* ── Restore from persisted state (on server restart) ────────────────── */

  restoreFromSettings(): TunnelStatus {
    const url = loadSetting('tunnel_url');
    const provider = loadSetting('tunnel_provider') as TunnelProvider | null;
    const token = loadSetting('tunnel_access_token');
    const startedAt = loadSetting('tunnel_started_at');

    // We have persisted state but no running process — just return info
    // The tunnel process doesn't survive server restart, so this is informational only
    return {
      active: false,
      url,
      provider,
      startedAt,
      accessToken: token,
      reconnectAttempts: 0,
      ngrokAuthConfigured: null,
    };
  }

  /* ── Helpers ─────────────────────────────────────────────────────────── */

  private cleanup(): void {
    this.proc = null;
    this._url = null;
    this._provider = null;
    this._startedAt = null;
    // Don't clear _accessToken here — keep it for reconnect
  }

  private clearPersistedState(): void {
    this._accessToken = null;
    deleteSetting('tunnel_url');
    deleteSetting('tunnel_provider');
    deleteSetting('tunnel_access_token');
    deleteSetting('tunnel_started_at');
  }
}

export const tunnelManager = new TunnelManager();
