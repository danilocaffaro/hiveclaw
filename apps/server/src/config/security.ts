/**
 * config/security.ts — Security configuration (single source of truth)
 *
 * All sandboxing, blocking, and access control rules live here.
 */

import { resolve, normalize, sep } from 'path';
import { homedir, tmpdir } from 'os';

const IS_WINDOWS = process.platform === 'win32';

// ─── Workspace Sandbox ──────────────────────────────────────────────────────────

/**
 * Resolve the workspace root.
 * Priority: HIVECLAW_WORKSPACE env > SUPERCLAW_WORKSPACE (legacy) > ~/.hiveclaw/workspace > cwd
 */
export function getWorkspaceRoot(): string {
  return process.env.HIVECLAW_WORKSPACE
    || process.env.SUPERCLAW_WORKSPACE // legacy fallback
    || resolve(homedir(), '.hiveclaw', 'workspace');
}

/**
 * Directories that tools can always read (even outside workspace).
 * Computed at runtime for cross-platform compatibility.
 */
export const READABLE_ALLOWLIST: string[] = IS_WINDOWS
  ? [
      resolve(tmpdir()),                    // e.g. C:\Users\<user>\AppData\Local\Temp
      resolve(process.env.TEMP ?? tmpdir()),
      resolve(process.env.TMP ?? tmpdir()),
    ]
  : [
      '/tmp',
      '/var/tmp',
    ];

/**
 * Sensitive paths that must NEVER be read/written by tools.
 * Includes both Unix and Windows-style paths.
 */
export const SENSITIVE_PATHS = [
  // Unix
  '.ssh',
  '.gnupg',
  '.aws/credentials',
  '.config/gcloud',
  '.kube/config',
  '.npmrc',
  '.env',
  '/etc/shadow',
  '/etc/passwd',
  '/etc/sudoers',
  // Windows
  'AppData\\Roaming\\Microsoft\\Credentials',
  'AppData\\Roaming\\Microsoft\\Protect',
  '.azure',
];

/**
 * Validate a file path against the workspace sandbox.
 * Returns { allowed: true, resolved } or { allowed: false, reason }.
 */
export function validateToolPath(
  requestedPath: string,
  mode: 'read' | 'write' = 'read',
): { allowed: true; resolved: string } | { allowed: false; reason: string } {
  const resolved = resolve(requestedPath);
  const normalized = normalize(resolved);

  // Block sensitive paths always
  for (const sensitive of SENSITIVE_PATHS) {
    // Normalize separator for matching on both platforms
    const normalizedSensitive = sensitive.replace(/[\\/]/g, sep);
    if (
      normalized.includes(`${sep}${normalizedSensitive}`) ||
      normalized.endsWith(`${sep}${normalizedSensitive}`)
    ) {
      return { allowed: false, reason: `Access denied: ${sensitive} is a protected path` };
    }
  }

  const workspace = getWorkspaceRoot();

  // Workspace is always allowed
  if (normalized.startsWith(workspace)) {
    return { allowed: true, resolved: normalized };
  }

  // Readable allowlist (read-only)
  if (mode === 'read') {
    for (const dir of READABLE_ALLOWLIST) {
      if (normalized.startsWith(dir)) {
        return { allowed: true, resolved: normalized };
      }
    }
  }

  // CWD is allowed (agent's working directory)
  const cwd = process.cwd();
  if (normalized.startsWith(cwd)) {
    return { allowed: true, resolved: normalized };
  }

  return {
    allowed: false,
    reason: `Access denied: path '${requestedPath}' is outside the workspace (${workspace}). ` +
      `Set HIVECLAW_WORKSPACE env to expand access.`,
  };
}

// ─── Command Blocking ───────────────────────────────────────────────────────────

/**
 * Dangerous command patterns.
 * Uses blocklist approach — blocks known destructive patterns.
 * Does NOT block general utilities (curl, wget, etc.) as they're needed for agent work.
 * Includes both Unix and Windows patterns.
 */
export const BLOCKED_COMMAND_PATTERNS: RegExp[] = [
  // ── Unix destructive filesystem ──
  /\brm\s+-rf\s+\/(?!\w)/,        // rm -rf / (root)
  /\brm\s+-rf\s+~\//,             // rm -rf ~/ (home)
  /\brm\s+-rf\s+\$HOME/,          // rm -rf $HOME
  /\bmkfs\b/,                      // format filesystem
  /\bdd\s+.*of=\/dev/,             // dd to device

  // ── Windows destructive filesystem ──
  /\brd\s+\/s\s+\/q\s+[A-Z]:\\/i,    // rd /s /q C:\ (recursive delete drive root)
  /\brmdir\s+\/s\s+\/q\s+[A-Z]:\\/i, // rmdir /s /q C:\
  /\bdel\s+\/f\s+\/s\s+\/q\s+[A-Z]:\\/i, // del /f /s /q C:\
  /\bformat\s+[A-Z]:/i,               // format C:

  // ── System destabilization (cross-platform) ──
  /:(){ :|:& };:/,                  // fork bomb (bash)
  /\bshutdown\b/,                   // shutdown (both platforms)
  /\breboot\b/,                     // reboot
  /\bhalt\b/,                       // halt
  /\bsystemctl\s+(stop|disable)\s+(sshd|network|firewall)/,  // critical services
  /\bStop-Service\s+(sshd|W32Time|Winmgmt|wuauserv)/i,       // Windows critical services

  // ── Credential exfiltration patterns ──
  /\bcat\s+.*\/\.ssh\//,           // cat ~/.ssh/*
  /\bcat\s+.*\/\.env\b/,           // cat .env files
  /\bcat\s+\/etc\/(shadow|sudoers)/,  // system secrets
  /\bbase64\s+.*\.ssh\//,          // base64 encode ssh keys
  /\bcurl\s+.*-d\s+.*\$\(/,        // curl -d $(command) — exfil via POST
  /\bwget\s+.*--post-data/,        // wget exfil
  /\btype\s+.*\\\.ssh\\/i,         // Windows: type ..\.ssh\*
  /\bGet-Content\s+.*\\\.ssh\\/i,  // PowerShell: Get-Content ~/.ssh/*

  // ── Privilege escalation ──
  /\bchmod\s+[0-7]*777\s+\//,     // chmod 777 on root paths
  /\bchown\s+root/,                // chown to root
  /\bsudo\s+chmod\s+u\+s/,        // setuid bit
  /\bSet-ExecutionPolicy\s+Unrestricted/i, // PowerShell unrestricted exec

  // ── Crypto mining patterns ──
  /\bxmrig\b/,                     // XMRig miner
  /\bminerd\b/,                    // CPU miner
  /stratum\+tcp:\/\//,             // Mining pool connection


];

/**
 * Check if a command is safe to execute.
 */
export function isCommandSafe(command: string): { safe: true } | { safe: false; reason: string } {
  for (const pattern of BLOCKED_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return { safe: false, reason: `Command blocked by safety policy: matches pattern ${pattern.source}` };
    }
  }
  return { safe: true };
}

// ─── Auth Configuration ─────────────────────────────────────────────────────────

/**
 * Routes that do NOT require authentication.
 * Everything else requires x-api-key header (in production).
 */
export const PUBLIC_ROUTES: string[] = [
  // Health check
  '/api/health',
  '/healthz',

  // Setup wizard (needed before any user exists)
  '/setup/status',
  '/setup/validate-provider',
  '/setup/complete',

  // Public chat (token-gated, not API-key-gated)
  '/public/',
  '/shared-links',

  // S1: Removed /sse from public routes — requires auth now
  // '/sse', // REMOVED: SSE endpoint must be authenticated
  '/agents/status/stream', // Keep: lightweight polling endpoint

  // Channel webhooks (inbound from Telegram/Discord/Slack — no API key, platform-verified)
  // Only the /webhook suffix — managed via isPublicRoute regex check below
  '/routing/',
  '/analytics/',
  '/embeddings/status',
];

/**
 * Check if a route is public (no auth required).
 */
export function isPublicRoute(url: string): boolean {
  const path = url.split('?')[0];

  // Regex patterns for dynamic public routes
  if (/^\/channels\/[^/]+\/webhook$/.test(path)) return true; // Platform webhooks
  if (/^\/external-agents\/[^/]+\/callback$/.test(path)) return true; // External agent callbacks (token-authed)
  if (/^\/automations\/[^/]+\/webhook$/.test(path)) return true; // Automation webhooks (R19 — n8n/Zapier/Make)

  for (const publicRoute of PUBLIC_ROUTES) {
    if (publicRoute.endsWith('/')) {
      if (path.startsWith(publicRoute)) return true;
    } else {
      if (path === publicRoute) return true;
    }
  }
  return false;
}

// ─── Security Headers ───────────────────────────────────────────────────────────

/**
 * Security headers to add to all responses.
 * These provide defense-in-depth against XSS, clickjacking, MIME sniffing.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '0',  // Modern browsers: CSP is better, this is deprecated
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  // CSP: allow 'self' + inline styles (React needs them) + data: URIs (base64 images)
  'Content-Security-Policy':
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self' ws: wss: https:; " +
    "font-src 'self' data:; " +
    "frame-ancestors 'none';",
};

// ─── SSE Connection Limits ──────────────────────────────────────────────────────

export const SSE_MAX_CONNECTIONS_PER_IP = 10;
export const SSE_MAX_TOTAL_CONNECTIONS = 100;
