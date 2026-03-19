/**
 * Tests for Canvas Host (Phase 2)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CanvasHost, CanvasError } from '../engine/canvas/canvas-host.js';

const TEST_ROOT = join(import.meta.dirname, '..', '..', '..', '.test-canvas');

function cleanTestDir(): void {
  if (existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  }
}

describe('CanvasHost', () => {
  let canvas: CanvasHost;

  beforeEach(() => {
    cleanTestDir();
    canvas = new CanvasHost({
      rootDir: TEST_ROOT,
      maxFileSizeBytes: 1024 * 1024,       // 1 MB
      maxTotalSizeBytes: 5 * 1024 * 1024,  // 5 MB
      liveReload: true,
    });
  });

  afterEach(() => {
    canvas.close();
    cleanTestDir();
  });

  // ─── Directory Creation ───────────────────────────────────────────────

  it('creates rootDir if it does not exist', () => {
    expect(existsSync(TEST_ROOT)).toBe(true);
  });

  // ─── Push Content ─────────────────────────────────────────────────────

  it('pushes HTML content with auto-generated path', () => {
    const result = canvas.pushContent({
      content: '<h1>Hello</h1>',
    });

    expect(result.path).toMatch(/\.html$/);
    expect(result.url).toMatch(/^\/canvas\//);
    expect(existsSync(join(TEST_ROOT, result.path))).toBe(true);
  });

  it('pushes content with explicit path', () => {
    const result = canvas.pushContent({
      content: '<h1>Dashboard</h1>',
      path: 'dashboard.html',
      title: 'My Dashboard',
    });

    expect(result.path).toBe('dashboard.html');
    expect(result.url).toBe('/canvas/dashboard.html');

    const written = readFileSync(join(TEST_ROOT, 'dashboard.html'), 'utf-8');
    expect(written).toContain('<h1>Dashboard</h1>');
  });

  it('pushes content with nested path', () => {
    const result = canvas.pushContent({
      content: '<p>Report</p>',
      path: 'reports/q1/summary.html',
    });

    expect(result.path).toBe('reports/q1/summary.html');
    expect(existsSync(join(TEST_ROOT, 'reports', 'q1', 'summary.html'))).toBe(true);
  });

  it('overwrites existing file', () => {
    canvas.pushContent({ content: 'v1', path: 'test.html' });
    canvas.pushContent({ content: 'v2', path: 'test.html' });

    const content = readFileSync(join(TEST_ROOT, 'test.html'), 'utf-8');
    expect(content).toContain('v2');
    expect(content).not.toContain('>v1<');
  });

  // ─── Live Reload Injection ────────────────────────────────────────────

  it('injects live-reload script into HTML files', () => {
    canvas.pushContent({
      content: '<html><body><h1>Test</h1></body></html>',
      path: 'reload-test.html',
    });

    const written = readFileSync(join(TEST_ROOT, 'reload-test.html'), 'utf-8');
    expect(written).toContain('/canvas/ws');
    expect(written).toContain('WebSocket');
  });

  it('does NOT inject live-reload into non-HTML files', () => {
    canvas.pushContent({
      content: '{"data": 1}',
      path: 'data.json',
      contentType: 'application/json',
    });

    const written = readFileSync(join(TEST_ROOT, 'data.json'), 'utf-8');
    expect(written).not.toContain('WebSocket');
    expect(written).toBe('{"data": 1}');
  });

  it('injects live-reload when no </body> tag (appends)', () => {
    canvas.pushContent({
      content: '<h1>No body tag</h1>',
      path: 'no-body.html',
    });

    const written = readFileSync(join(TEST_ROOT, 'no-body.html'), 'utf-8');
    expect(written).toContain('/canvas/ws');
  });

  // ─── Read File ────────────────────────────────────────────────────────

  it('reads an existing file', () => {
    canvas.pushContent({ content: '<p>Hello</p>', path: 'read-test.html' });

    const result = canvas.readFile('read-test.html');
    expect(result).not.toBeNull();
    expect(result!.contentType).toBe('text/html');
    expect(result!.content.toString()).toContain('<p>Hello</p>');
  });

  it('returns null for non-existent file', () => {
    const result = canvas.readFile('does-not-exist.html');
    expect(result).toBeNull();
  });

  // ─── Navigate ─────────────────────────────────────────────────────────

  it('sets active path on navigate', () => {
    canvas.pushContent({ content: '<p>A</p>', path: 'a.html' });
    canvas.pushContent({ content: '<p>B</p>', path: 'b.html' });

    canvas.navigate('b.html');
    expect(canvas.getState().activePath).toBe('b.html');

    canvas.navigate('a.html');
    expect(canvas.getState().activePath).toBe('a.html');
  });

  // ─── State ────────────────────────────────────────────────────────────

  it('tracks entries after push', () => {
    canvas.pushContent({ content: '<p>1</p>', path: 'one.html' });
    canvas.pushContent({ content: '<p>2</p>', path: 'two.html' });

    const state = canvas.getState();
    expect(state.entries.length).toBe(2);
    expect(state.totalSizeBytes).toBeGreaterThan(0);
  });

  it('scans existing files on construction', () => {
    // Pre-populate the dir
    mkdirSync(TEST_ROOT, { recursive: true });
    writeFileSync(join(TEST_ROOT, 'existing.html'), '<p>Already here</p>');

    // Create new instance over same dir
    canvas.close();
    canvas = new CanvasHost({ rootDir: TEST_ROOT, maxFileSizeBytes: 1024 * 1024, maxTotalSizeBytes: 5 * 1024 * 1024, liveReload: false });

    const state = canvas.getState();
    expect(state.entries.length).toBe(1);
    expect(state.entries[0].path).toBe('existing.html');
  });

  // ─── Path Sanitization ───────────────────────────────────────────────

  it('blocks path traversal with ..', () => {
    expect(() => {
      canvas.pushContent({ content: 'hack', path: '../../../etc/passwd' });
    }).toThrow();
  });

  it('blocks null bytes in path', () => {
    const result = canvas.pushContent({ content: 'test', path: 'test\x00.html' });
    expect(result.path).toBe('test.html'); // null byte stripped
  });

  it('normalizes backslashes', () => {
    const result = canvas.pushContent({ content: 'test', path: 'dir\\file.html' });
    expect(result.path).toBe('dir/file.html');
  });

  it('strips leading slashes', () => {
    const result = canvas.pushContent({ content: 'test', path: '///leading.html' });
    expect(result.path).toBe('leading.html');
  });

  // ─── Size Limits ──────────────────────────────────────────────────────

  it('rejects files exceeding max size', () => {
    const bigContent = 'x'.repeat(2 * 1024 * 1024); // 2 MB > 1 MB limit
    expect(() => {
      canvas.pushContent({ content: bigContent, path: 'big.html' });
    }).toThrow(CanvasError);
  });

  it('rejects when total storage would exceed limit', () => {
    // Use a canvas with a very small total limit (300 bytes)
    const tiny = new CanvasHost({
      rootDir: join(TEST_ROOT, 'tiny'),
      maxFileSizeBytes: 200,
      maxTotalSizeBytes: 300,
      liveReload: false,
    });

    try {
      tiny.pushContent({ content: 'x'.repeat(150), path: 'a.txt' }); // 150 bytes OK
      tiny.pushContent({ content: 'x'.repeat(150), path: 'b.txt' }); // 300 total OK
      // 3rd push would bring total to 450, exceeding 300 limit
      expect(() => {
        tiny.pushContent({ content: 'x'.repeat(100), path: 'c.txt' });
      }).toThrow(CanvasError);
    } finally {
      tiny.close();
    }
  });

  // ─── Close ────────────────────────────────────────────────────────────

  it('close is idempotent', () => {
    canvas.close();
    canvas.close(); // should not throw
  });
});
