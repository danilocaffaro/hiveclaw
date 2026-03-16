// ============================================================
// URL Security — SSRF Protection for WebFetch & Browser Tools
// S1: Sprint Security Hardening
// S1.1: Hex/octal/integer IP bypass + DNS rebinding defense
// ============================================================

import { lookup } from 'node:dns/promises';

/**
 * Check if an IPv4 address (as 4 octets) is in a private/reserved range.
 * @returns error message if blocked, null if allowed
 */
function checkPrivateIp(a: number, b: number, _c: number, _d: number): string | null {
  if (a === 10) return 'Private IP range 10.x.x.x not allowed (SSRF protection)';
  if (a === 172 && b >= 16 && b <= 31) return 'Private IP range 172.16-31.x.x not allowed (SSRF protection)';
  if (a === 192 && b === 168) return 'Private IP range 192.168.x.x not allowed (SSRF protection)';
  if (a === 127) return 'Localhost IP 127.x.x.x not allowed (SSRF protection)';
  if (a === 169 && b === 254) return 'Link-local IP 169.254.x.x not allowed (AWS metadata protection)';
  if (a === 0) return 'Reserved IP 0.x.x.x not allowed';
  return null;
}

/**
 * Parse an IP that may be in hex (0x7f000001), octal (017700000001),
 * decimal integer (2130706433), or dotted-decimal (127.0.0.1) format.
 * Returns [a, b, c, d] octets or null if not an IP.
 */
function parseIpAny(hostname: string): [number, number, number, number] | null {
  // Standard dotted-decimal
  const dotted = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const m = hostname.match(dotted);
  if (m) {
    return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  }

  // Hex IP: 0x7f000001 or 0x7F000001
  const hexMatch = hostname.match(/^0x([0-9a-f]{1,8})$/i);
  if (hexMatch) {
    const num = parseInt(hexMatch[1], 16);
    return [(num >>> 24) & 0xff, (num >>> 16) & 0xff, (num >>> 8) & 0xff, num & 0xff];
  }

  // Octal IP: starts with 0, all digits (0177.0.0.1 or 017700000001)
  if (/^0[0-7]+$/.test(hostname)) {
    const num = parseInt(hostname, 8);
    if (num >= 0 && num <= 0xffffffff) {
      return [(num >>> 24) & 0xff, (num >>> 16) & 0xff, (num >>> 8) & 0xff, num & 0xff];
    }
  }

  // Decimal integer: 2130706433
  if (/^\d+$/.test(hostname)) {
    const num = parseInt(hostname, 10);
    if (num >= 0 && num <= 0xffffffff) {
      return [(num >>> 24) & 0xff, (num >>> 16) & 0xff, (num >>> 8) & 0xff, num & 0xff];
    }
  }

  return null;
}

/** Known DNS rebinding domains that resolve to any IP */
const REBINDING_DOMAINS = [
  'nip.io',
  'sslip.io',
  'xip.io',
  'localtest.me',
  'lvh.me',
  'vcap.me',
];

/**
 * Validates a URL for SSRF prevention (sync check — hostname/IP format).
 * Blocks:
 * - Private IPs in any encoding (dotted, hex, octal, decimal integer)
 * - Link-local addresses (169.254.x.x — AWS/GCP metadata)
 * - Non-HTTP(S) protocols
 * - Cloud metadata hostnames
 * - Known DNS rebinding domains (nip.io, sslip.io, etc.)
 * - IPv6 localhost
 * 
 * @throws Error if URL is dangerous
 */
export function validateUrl(urlString: string): void {
  let parsedUrl: URL;
  
  try {
    parsedUrl = new URL(urlString);
  } catch {
    throw new Error('Invalid URL format');
  }

  // Only http/https allowed
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error(`Protocol ${parsedUrl.protocol} not allowed (only http/https)`);
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  // Block localhost (name + IPv6)
  if (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname.startsWith('::1')
  ) {
    throw new Error('Localhost access not allowed (SSRF protection)');
  }

  // Block IPs in any encoding (dotted, hex, octal, decimal integer)
  const octets = parseIpAny(hostname);
  if (octets) {
    const err = checkPrivateIp(...octets);
    if (err) throw new Error(err);
  }

  // Block known DNS rebinding domains
  if (REBINDING_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d))) {
    throw new Error('DNS rebinding domain not allowed (SSRF protection)');
  }

  // Block cloud metadata endpoints by hostname
  const blockedHosts = [
    'metadata.google.internal',
    'instance-data',
    'metadata',
  ];
  
  if (blockedHosts.some(blocked => hostname.includes(blocked))) {
    throw new Error('Cloud metadata endpoint not allowed (SSRF protection)');
  }
}

/**
 * Validates a URL with DNS resolution check (async).
 * First runs all sync checks from validateUrl(), then resolves the hostname
 * and checks if the resolved IP is private (DNS rebinding defense).
 * 
 * Use this for high-risk operations (webfetch, browser navigate).
 * Falls back to sync-only validation if DNS lookup fails.
 * 
 * @throws Error if URL is dangerous
 */
export async function validateUrlWithDns(urlString: string): Promise<void> {
  // Run all sync checks first
  validateUrl(urlString);

  // DNS resolution check — catch rebinding via non-blocked hostnames
  const parsedUrl = new URL(urlString);
  const hostname = parsedUrl.hostname.toLowerCase();

  // Skip DNS check for raw IPs (already validated above)
  if (parseIpAny(hostname)) return;

  try {
    const result = await lookup(hostname);
    const resolvedIp = result.address;

    // Parse resolved IP and check if private
    const octets = parseIpAny(resolvedIp);
    if (octets) {
      const err = checkPrivateIp(...octets);
      if (err) throw new Error(`${err} (resolved from ${hostname})`);
    }

    // Check IPv6 localhost
    if (resolvedIp === '::1' || resolvedIp === '127.0.0.1') {
      throw new Error(`Localhost access not allowed — ${hostname} resolves to ${resolvedIp}`);
    }
  } catch (e) {
    // Re-throw our SSRF errors, swallow DNS resolution failures (let fetch handle them)
    if ((e as Error).message.includes('SSRF') || (e as Error).message.includes('not allowed') || (e as Error).message.includes('Localhost')) {
      throw e;
    }
    // DNS lookup failed — allow (fetch will fail too)
  }
}
