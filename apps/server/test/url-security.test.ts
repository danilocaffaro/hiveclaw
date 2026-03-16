import { describe, it, expect } from 'vitest';
import { validateUrl } from '../src/lib/url-security.js';

describe('URL Security (SSRF Protection)', () => {
  describe('validateUrl', () => {
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
  });
});
