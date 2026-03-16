/**
 * Version source of truth — reads from root package.json at build time.
 * Single source: root package.json "version" field.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

let _version: string | null = null;
let _commit: string | null = null;
let _buildDate: string | null = null;

function findRootPackageJson(): string | null {
  // Walk up from dist/lib/ to find root package.json
  const __filename = fileURLToPath(import.meta.url);
  let dir = dirname(__filename);
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, 'utf-8'));
        if (pkg.name === 'hiveclaw' || pkg.name === '@hiveclaw/server') {
          return candidate;
        }
      } catch { /* skip */ }
    }
    dir = dirname(dir);
  }
  return null;
}

export function getVersion(): string {
  if (_version) return _version;

  const pkgPath = findRootPackageJson();
  if (pkgPath) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      _version = pkg.version ?? '0.0.0';
      return _version!;
    } catch { /* fallback */ }
  }

  _version = '0.0.0';
  return _version;
}

export function getCommit(): string {
  if (_commit) return _commit;

  try {
    _commit = execSync('git rev-parse --short HEAD', {
      timeout: 3000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    _commit = 'unknown';
  }

  return _commit;
}

export function getBuildDate(): string {
  if (_buildDate) return _buildDate;
  _buildDate = new Date().toISOString().split('T')[0];
  return _buildDate;
}

export function getVersionInfo(): { version: string; commit: string; buildDate: string } {
  return {
    version: getVersion(),
    commit: getCommit(),
    buildDate: getBuildDate()
  };
}
