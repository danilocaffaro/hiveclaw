/**
 * Runtime API base URL resolver.
 * 
 * When running locally (served by HiveClaw server), API is at /api.
 * When running on GitHub Pages or other static host, the user configures
 * the server URL (tunnel) and we store it in localStorage.
 * 
 * Discovery flow:
 * 1. Check localStorage for 'hiveclaw_server_url'
 * 2. If not set and on external host, try Gist discovery
 * 3. Fall back to /api (local)
 */

const STORAGE_KEY = 'hiveclaw_server_url';
const GIST_ID_KEY = 'hiveclaw_gist_id';
const TOKEN_KEY = 'hiveclaw_auth_token';

let _resolvedBase: string | null = null;
let _resolving: Promise<string> | null = null;

/** Check if we're running on an external static host (not the HiveClaw server) */
function isExternalHost(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  // GitHub Pages or any non-localhost host
  return host.includes('github.io') || 
         host.includes('netlify') || 
         host.includes('vercel') ||
         host.includes('pages.dev') ||
         // If there's a stored server URL, we're probably external
         !!localStorage.getItem(STORAGE_KEY);
}

/** Try to discover server URL from a GitHub Gist */
async function discoverFromGist(): Promise<string | null> {
  const gistId = localStorage.getItem(GIST_ID_KEY);
  if (!gistId) return null;
  
  try {
    const res = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: { 'Accept': 'application/vnd.github.v3+json' },
    });
    if (!res.ok) return null;
    const gist = await res.json();
    const file = gist.files?.['hiveclaw-discovery.json'];
    if (!file?.content) return null;
    const data = JSON.parse(file.content);
    if (data.url && data.status === 'online') {
      // Auto-save discovered URL
      localStorage.setItem(STORAGE_KEY, data.url);
      if (data.token) localStorage.setItem(TOKEN_KEY, data.token);
      return data.url;
    }
  } catch {
    // Discovery failed silently
  }
  return null;
}

/** 
 * Get the API base URL. Returns immediately if already resolved,
 * otherwise resolves asynchronously (Gist discovery).
 */
export function getApiBase(): string {
  if (_resolvedBase) return _resolvedBase;
  
  if (typeof window === 'undefined') return '/api';
  
  // Check localStorage first (instant)
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    _resolvedBase = stored.replace(/\/$/, '');
    return _resolvedBase;
  }
  
  // Not external host? Use local /api
  if (!isExternalHost()) {
    _resolvedBase = '/api';
    return _resolvedBase;
  }
  
  // External host without stored URL — return /api as fallback
  // The connect page should have set it before reaching here
  return '/api';
}

/**
 * Async version — tries Gist discovery if needed.
 * Use this on app init / connect page.
 */
export async function resolveApiBase(): Promise<string> {
  if (_resolvedBase) return _resolvedBase;
  
  if (typeof window === 'undefined') return '/api';
  
  // Check localStorage
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    _resolvedBase = stored.replace(/\/$/, '');
    return _resolvedBase;
  }
  
  // Try Gist discovery
  if (_resolving) return _resolving;
  _resolving = (async () => {
    const discovered = await discoverFromGist();
    if (discovered) {
      _resolvedBase = discovered.replace(/\/$/, '');
      return _resolvedBase;
    }
    _resolvedBase = '/api';
    return _resolvedBase;
  })();
  
  return _resolving;
}

/** Get stored auth token (for tunnel access) */
export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

/** Set server URL manually (from Settings or connect page) */
export function setServerUrl(url: string, token?: string): void {
  const clean = url.replace(/\/$/, '');
  localStorage.setItem(STORAGE_KEY, clean);
  if (token) localStorage.setItem(TOKEN_KEY, token);
  _resolvedBase = clean;
}

/** Clear stored server URL (disconnect) */
export function clearServerUrl(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(TOKEN_KEY);
  _resolvedBase = null;
}

/** Set Gist ID for auto-discovery */
export function setGistId(gistId: string): void {
  localStorage.setItem(GIST_ID_KEY, gistId);
}

/** Check if connected to a remote server */
export function isRemoteConnection(): boolean {
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem(STORAGE_KEY);
}
