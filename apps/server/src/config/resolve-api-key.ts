/**
 * config/resolve-api-key.ts — Centralized API key resolution
 *
 * B26: Priority order:
 *   1. Credential store (if available, and credential is active/unknown)
 *   2. process.env fallback (backward compatible)
 *
 * Never writes to credential store — read-only.
 */

import { CredentialStoreRepository } from '../db/credential-store.js';
import { logger } from '../lib/logger.js';

// ─── Module-level singleton ─────────────────────────────────────────────────────
// Set once at startup from index.ts. All callers import getCredentialStore().

let _credentialStore: CredentialStoreRepository | null = null;

export function setCredentialStore(store: CredentialStoreRepository): void {
  _credentialStore = store;
}

export function getCredentialStore(): CredentialStoreRepository | null {
  return _credentialStore;
}

// ─── resolveApiKey ──────────────────────────────────────────────────────────────

/**
 * Resolve an API key by name.
 *
 * 1. Try credential store first (skip expired/leaked credentials)
 * 2. Fall back to process.env
 *
 * @param keyName - Environment variable name, e.g. "GEMINI_API_KEY"
 * @param credentialStore - Optional override; defaults to module singleton
 * @returns The resolved key value, or undefined if not found anywhere
 */
export function resolveApiKey(
  keyName: string,
  credentialStore?: CredentialStoreRepository | null,
): string | undefined {
  const store = credentialStore ?? _credentialStore;

  // 1. Try credential store first (if available)
  if (store) {
    try {
      const cred = store.getByKey(keyName);
      if (cred && cred.status !== 'expired' && cred.status !== 'leaked') {
        return cred.value;
      }
    } catch {
      // DB error — fall through to env
    }
  }

  // 2. Fall back to process.env
  return process.env[keyName];
}

// ─── Startup Diagnostics ────────────────────────────────────────────────────────

/**
 * Well-known API key names to check at startup.
 * Only logs — never fails startup if keys are missing.
 */
const WELL_KNOWN_KEYS = [
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GITHUB_TOKEN',
  'N8N_API_KEY',
  'GROQ_API_KEY',
  'DEEPSEEK_API_KEY',
  'MISTRAL_API_KEY',
  'OPENROUTER_API_KEY',
];

/**
 * Log which well-known keys are resolved from credential store vs process.env.
 * Call once at startup after setCredentialStore().
 */
export function logKeyResolution(credentialStore?: CredentialStoreRepository | null): void {
  const store = credentialStore ?? _credentialStore;
  const lines: string[] = [];

  for (const keyName of WELL_KNOWN_KEYS) {
    let source: string | null = null;

    // Check credential store
    if (store) {
      try {
        const cred = store.getByKey(keyName);
        if (cred) {
          if (cred.status === 'expired' || cred.status === 'leaked') {
            source = `credential-store (${cred.status} — SKIPPED)`;
          } else {
            source = `credential-store (${cred.status})`;
          }
        }
      } catch {
        // ignore
      }
    }

    // Check process.env if not resolved from store
    if (!source && process.env[keyName]) {
      source = 'process.env';
    }

    if (source) {
      lines.push(`  ${keyName}: from ${source}`);
    }
  }

  if (lines.length > 0) {
    logger.info(`[Config] API key resolution:\n${lines.join('\n')}`);
  } else {
    logger.info('[Config] No well-known API keys found (credential store or process.env)');
  }
}
