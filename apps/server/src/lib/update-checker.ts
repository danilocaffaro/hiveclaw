/**
 * Update Checker — checks GitHub Releases for newer versions.
 * Caches result for 24h. Non-blocking, non-fatal.
 */

import { getVersion } from './version.js';
import { logger } from './logger.js';

const REPO = 'danilocaffaro/hiveclaw';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface UpdateInfo {
  available: boolean;
  current: string;
  latest: string;
  url: string;
  publishedAt: string;
  checkedAt: string;
}

let _cache: UpdateInfo | null = null;
let _lastCheck = 0;

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function checkForUpdate(force = false): Promise<UpdateInfo> {
  const now = Date.now();

  // Return cache if fresh
  if (!force && _cache && (now - _lastCheck) < CACHE_TTL_MS) {
    return _cache;
  }

  const current = getVersion();
  const defaultResult: UpdateInfo = {
    available: false,
    current,
    latest: current,
    url: `https://github.com/${REPO}/releases`,
    publishedAt: '',
    checkedAt: new Date().toISOString(),
  };

  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'HiveClaw-UpdateChecker',
        },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (response.status === 404) {
      // No releases yet
      _cache = defaultResult;
      _lastCheck = now;
      return _cache;
    }

    if (!response.ok) {
      logger.debug('[update-check] GitHub API returned %d', response.status);
      _cache = defaultResult;
      _lastCheck = now;
      return _cache;
    }

    const data = await response.json() as {
      tag_name?: string;
      html_url?: string;
      published_at?: string;
    };

    const latestTag = data.tag_name ?? '';
    const latestVersion = latestTag.replace(/^v/, '');
    const isNewer = compareSemver(current, latestVersion) > 0;

    _cache = {
      available: isNewer,
      current,
      latest: latestVersion,
      url: data.html_url ?? defaultResult.url,
      publishedAt: data.published_at ?? '',
      checkedAt: new Date().toISOString(),
    };
    _lastCheck = now;

    if (isNewer) {
      logger.info('[update-check] New version available: %s → %s', current, latestVersion);
    } else {
      logger.debug('[update-check] Up to date (%s)', current);
    }

    return _cache;
  } catch (err) {
    logger.debug({ err }, '[update-check] Check failed (non-fatal)');
    _cache = defaultResult;
    _lastCheck = now;
    return _cache;
  }
}

export function getCachedUpdate(): UpdateInfo | null {
  return _cache;
}
