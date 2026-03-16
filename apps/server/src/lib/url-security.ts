// ============================================================
// URL Security — SSRF Protection for WebFetch & Browser Tools
// S1: Sprint Security Hardening
// ============================================================

/**
 * Validates a URL for SSRF prevention.
 * Blocks:
 * - Private IPs (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x)
 * - Link-local addresses
 * - Non-HTTP(S) protocols
 * - Cloud metadata endpoints
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

  // Block localhost (IPv4, IPv6, and name)
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname.startsWith('::1')
  ) {
    throw new Error('Localhost access not allowed (SSRF protection)');
  }

  // Block private IP ranges (IPv4)
  const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const ipMatch = hostname.match(ipv4Pattern);
  
  if (ipMatch) {
    const [, a, b, c, d] = ipMatch.map(Number);
    
    // 10.0.0.0/8
    if (a === 10) {
      throw new Error('Private IP range 10.x.x.x not allowed (SSRF protection)');
    }
    
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) {
      throw new Error('Private IP range 172.16-31.x.x not allowed (SSRF protection)');
    }
    
    // 192.168.0.0/16
    if (a === 192 && b === 168) {
      throw new Error('Private IP range 192.168.x.x not allowed (SSRF protection)');
    }
    
    // 127.0.0.0/8 (additional localhost check)
    if (a === 127) {
      throw new Error('Localhost IP 127.x.x.x not allowed (SSRF protection)');
    }
    
    // 169.254.0.0/16 (link-local / AWS metadata)
    if (a === 169 && b === 254) {
      throw new Error('Link-local IP 169.254.x.x not allowed (AWS metadata protection)');
    }
    
    // 0.0.0.0/8
    if (a === 0) {
      throw new Error('Reserved IP 0.x.x.x not allowed');
    }
  }

  // Block cloud metadata endpoints by hostname
  const blockedHosts = [
    'metadata.google.internal',
    'instance-data',
    'metadata',
  ];
  
  if (blockedHosts.some(blocked => hostname.includes(blocked))) {
    throw new Error(`Cloud metadata endpoint not allowed (SSRF protection)`);
  }
}
