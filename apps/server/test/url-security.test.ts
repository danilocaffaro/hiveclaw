import { describe, it, expect } from 'vitest';
import { validateUrl, validateUrlWithDns } from '../src/lib/url-security.js';

describe('URL Security (SSRF Protection)', () => {
  describe('validateUrl (sync)', () => {
    it('allows valid HTTPS URLs', () => {
      expect(() => validateUrl('https://example.com')).not.toThrow();
      expect(() => validateUrl('https://api.github.com/repos')).not.toThrow();
      expect(() => validateUrl('https://duckduckgo.com/?q=test')).not.toThrow();
    });

    it('allows valid HTTP URLs', () => {
      expect(() => validateUrl('http://example.com')).not.toThrow();
      expect(() => validateUrl('http://httpbin.org/get')).not.toThrow();
    });

    it('blocks localhost by name', () => {
      expect(() => validateUrl('http://localhost:4070')).toThrow('Localhost access not allowed');
      expect(() => validateUrl('https://localhost')).toThrow('Localhost access not allowed');
    });

    it('blocks localhost by IPv4', () => {
      expect(() => validateUrl('http://127.0.0.1:4070')).toThrow('Localhost');
      expect(() => validateUrl('http://127.1.1.1')).toThrow('Localhost');
    });

    it('blocks localhost by IPv6', () => {
      expect(() => validateUrl('http://[::1]:4070')).toThrow('Localhost access not allowed');
    });

    it('blocks private IP ranges — 10.x.x.x', () => {
      expect(() => validateUrl('http://10.0.0.1')).toThrow('Private IP range 10.x.x.x');
      expect(() => validateUrl('http://10.123.45.67')).toThrow('Private IP range 10.x.x.x');
    });

    it('blocks private IP ranges — 172.16-31.x.x', () => {
      expect(() => validateUrl('http://172.16.0.1')).toThrow('Private IP range 172.16-31');
      expect(() => validateUrl('http://172.31.255.255')).toThrow('Private IP range 172.16-31');
      expect(() => validateUrl('http://172.20.1.1')).toThrow('Private IP range 172.16-31');
    });

    it('allows 172.x outside 16-31 range', () => {
      expect(() => validateUrl('http://172.15.0.1')).not.toThrow();
      expect(() => validateUrl('http://172.32.0.1')).not.toThrow();
    });

    it('blocks private IP ranges — 192.168.x.x', () => {
      expect(() => validateUrl('http://192.168.0.1')).toThrow('Private IP range 192.168');
      expect(() => validateUrl('http://192.168.1.100')).toThrow('Private IP range 192.168');
    });

    it('blocks link-local — 169.254.x.x (AWS metadata)', () => {
      expect(() => validateUrl('http://169.254.169.254/latest/meta-data')).toThrow('Link-local IP');
    });

    it('blocks cloud metadata endpoints by hostname', () => {
      expect(() => validateUrl('http://metadata.google.internal')).toThrow('Cloud metadata endpoint');
      expect(() => validateUrl('http://instance-data.ec2.internal')).toThrow('Cloud metadata endpoint');
    });

    it('blocks non-HTTP(S) protocols', () => {
      expect(() => validateUrl('file:///etc/passwd')).toThrow('Protocol file: not allowed');
      expect(() => validateUrl('ftp://example.com')).toThrow('Protocol ftp: not allowed');
      expect(() => validateUrl('gopher://example.com')).toThrow('Protocol gopher: not allowed');
      expect(() => validateUrl('javascript:alert(1)')).toThrow('Protocol javascript: not allowed');
    });

    it('rejects invalid URL formats', () => {
      expect(() => validateUrl('not a url')).toThrow('Invalid URL format');
      // Note: URL constructor parses 'htp://typo.com' as valid, so it throws protocol error instead
      expect(() => validateUrl('htp://typo.com')).toThrow('Protocol htp: not allowed');
    });

    it('blocks reserved IP — 0.x.x.x', () => {
      expect(() => validateUrl('http://0.0.0.0')).toThrow('Reserved IP 0.x.x.x');
    });

    // S1.1: Hex/octal/integer IP bypass tests (Sherlock's suggestion)
    it('blocks hex-encoded localhost (0x7f000001)', () => {
      expect(() => validateUrl('http://0x7f000001/')).toThrow('Localhost');
    });

    it('blocks decimal integer localhost (2130706433)', () => {
      expect(() => validateUrl('http://2130706433/')).toThrow('Localhost');
    });

    it('blocks octal-encoded localhost (017700000001)', () => {
      expect(() => validateUrl('http://017700000001/')).toThrow('Localhost');
    });

    it('blocks hex-encoded private IP (0x0a000001 = 10.0.0.1)', () => {
      expect(() => validateUrl('http://0x0a000001/')).toThrow('Private IP range 10.x.x.x');
    });

    it('blocks decimal integer private IP (3232235521 = 192.168.0.1)', () => {
      expect(() => validateUrl('http://3232235521/')).toThrow('Private IP range 192.168');
    });

    it('blocks hex-encoded metadata IP (0xa9fea9fe = 169.254.169.254)', () => {
      expect(() => validateUrl('http://0xa9fea9fe/')).toThrow('Link-local IP');
    });

    // DNS rebinding domains
    it('blocks nip.io DNS rebinding', () => {
      expect(() => validateUrl('http://127.0.0.1.nip.io/')).toThrow('DNS rebinding domain');
    });

    it('blocks sslip.io DNS rebinding', () => {
      expect(() => validateUrl('http://10.0.0.1.sslip.io/')).toThrow('DNS rebinding domain');
    });

    it('blocks xip.io DNS rebinding', () => {
      expect(() => validateUrl('http://192.168.1.1.xip.io/')).toThrow('DNS rebinding domain');
    });

    it('blocks localtest.me DNS rebinding', () => {
      expect(() => validateUrl('http://localtest.me/')).toThrow('DNS rebinding domain');
    });

    it('blocks lvh.me DNS rebinding', () => {
      expect(() => validateUrl('http://foo.lvh.me/')).toThrow('DNS rebinding domain');
    });

    it('allows legitimate hex-looking hostnames that are not IPs', () => {
      // 0xdeadbeef.com is a valid domain, not an IP
      expect(() => validateUrl('https://0xdeadbeef.com/')).not.toThrow();
    });
  });

  describe('validateUrlWithDns (async)', () => {
    it('allows valid public URLs', async () => {
      await expect(validateUrlWithDns('https://example.com')).resolves.toBeUndefined();
    });

    it('blocks localhost by name (sync check)', async () => {
      await expect(validateUrlWithDns('http://localhost:4070')).rejects.toThrow('Localhost');
    });

    it('blocks hex IP (sync check)', async () => {
      await expect(validateUrlWithDns('http://0x7f000001/')).rejects.toThrow('Localhost');
    });

    it('blocks rebinding domains (sync check)', async () => {
      await expect(validateUrlWithDns('http://127.0.0.1.nip.io/')).rejects.toThrow('DNS rebinding');
    });
  });
});
