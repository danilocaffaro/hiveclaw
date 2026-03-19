/**
 * Canvas Host — serves static content + WebSocket live-reload for agent visual output.
 *
 * Architecture:
 *   Fastify routes:
 *     GET  /canvas/*        → serve files from rootDir (~/.hiveclaw/canvas/)
 *     POST /canvas/push     → agent pushes HTML content
 *     GET  /canvas/status   → current canvas state
 *
 *   WebSocket:
 *     /canvas/ws → live-reload notifications to connected browsers
 *
 * Phase 2 of HiveClaw Platform Blueprint.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, resolve, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Server as HttpServer } from 'node:http';
import { logger } from '../../lib/logger.js';

// ─── Types ────────────────────────────────────────────────────────────────

export interface CanvasConfig {
  rootDir: string;
  maxFileSizeBytes: number;
  maxTotalSizeBytes: number;
  liveReload: boolean;
}

interface CanvasEntry {
  id: string;
  title: string;
  path: string;        // relative to rootDir
  contentType: string;
  createdAt: string;
  updatedAt: string;
  sizeBytes: number;
}

interface CanvasState {
  entries: CanvasEntry[];
  totalSizeBytes: number;
  activePath: string | null;  // currently "presented" canvas
}

type WSMessage =
  | { type: 'reload'; path: string }
  | { type: 'navigate'; path: string }
  | { type: 'update'; path: string; content: string };

// ─── Constants ────────────────────────────────────────────────────────────

const DEFAULT_ROOT_DIR = join(
  process.env.HOME ?? process.env.USERPROFILE ?? '.',
  '.hiveclaw',
  'canvas',
);

const DEFAULT_CONFIG: CanvasConfig = {
  rootDir: process.env.HIVECLAW_CANVAS_DIR ?? DEFAULT_ROOT_DIR,
  maxFileSizeBytes: 5 * 1024 * 1024,      // 5 MB per file
  maxTotalSizeBytes: 50 * 1024 * 1024,     // 50 MB total
  liveReload: true,
};

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const LIVE_RELOAD_SCRIPT = `
<script>
(function() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(proto + '//' + location.host + '/canvas/ws');
  ws.onmessage = function(e) {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'reload') location.reload();
      if (msg.type === 'navigate') location.href = '/canvas/' + msg.path;
    } catch {}
  };
  ws.onclose = function() {
    setTimeout(function() { location.reload(); }, 2000);
  };
})();
</script>
`;

// ─── CSP Header ───────────────────────────────────────────────────────────

const CANVAS_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",  // agents may push inline scripts
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

// ─── Canvas Host Class ───────────────────────────────────────────────────

export class CanvasHost {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private config: CanvasConfig;
  private state: CanvasState;

  constructor(config?: Partial<CanvasConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = { entries: [], totalSizeBytes: 0, activePath: null };

    // Ensure root dir exists
    if (!existsSync(this.config.rootDir)) {
      mkdirSync(this.config.rootDir, { recursive: true });
      logger.info(`[Canvas] Created root dir: ${this.config.rootDir}`);
    }

    // Scan existing files
    this.scanEntries();
  }

  // ─── WebSocket Setup ──────────────────────────────────────────────────

  /**
   * Attach WebSocket server to existing HTTP server (from Fastify).
   */
  attachWebSocket(server: HttpServer): void {
    this.wss = new WebSocketServer({ server, path: '/canvas/ws' });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      logger.debug(`[Canvas] WS client connected (total: ${this.clients.size})`);

      ws.on('close', () => {
        this.clients.delete(ws);
        logger.debug(`[Canvas] WS client disconnected (total: ${this.clients.size})`);
      });

      ws.on('error', () => {
        this.clients.delete(ws);
      });
    });

    logger.info(`[Canvas] WebSocket live-reload attached at /canvas/ws`);
  }

  /**
   * Broadcast message to all connected WS clients.
   */
  private broadcast(message: WSMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === 1 /* OPEN */) {
        client.send(data);
      }
    }
  }

  // ─── File Operations ──────────────────────────────────────────────────

  /**
   * Scan rootDir for existing canvas entries.
   */
  private scanEntries(): void {
    const entries: CanvasEntry[] = [];
    let totalSize = 0;

    const scan = (dir: string): void => {
      if (!existsSync(dir)) return;
      for (const name of readdirSync(dir)) {
        const fullPath = join(dir, name);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          scan(fullPath);
        } else {
          const relPath = relative(this.config.rootDir, fullPath);
          const ext = extname(name);
          entries.push({
            id: relPath,
            title: name,
            path: relPath,
            contentType: MIME_TYPES[ext] ?? 'application/octet-stream',
            createdAt: stat.birthtime.toISOString(),
            updatedAt: stat.mtime.toISOString(),
            sizeBytes: stat.size,
          });
          totalSize += stat.size;
        }
      }
    };

    scan(this.config.rootDir);
    this.state = { ...this.state, entries, totalSizeBytes: totalSize };
  }

  /**
   * Push content to canvas (create or update a file).
   */
  pushContent(opts: {
    path?: string;
    content: string;
    title?: string;
    contentType?: string;
  }): { path: string; url: string } {
    const fileName = opts.path ?? `${randomUUID()}.html`;
    const safePath = this.sanitizePath(fileName);
    const fullPath = join(this.config.rootDir, safePath);
    const contentBuffer = Buffer.from(opts.content, 'utf-8');

    // Size checks
    if (contentBuffer.byteLength > this.config.maxFileSizeBytes) {
      throw new CanvasError(
        'FILE_TOO_LARGE',
        `Content exceeds max file size (${(this.config.maxFileSizeBytes / 1024 / 1024).toFixed(1)} MB)`,
      );
    }

    const existingSize = existsSync(fullPath) ? statSync(fullPath).size : 0;
    const newTotalSize = this.state.totalSizeBytes - existingSize + contentBuffer.byteLength;
    if (newTotalSize > this.config.maxTotalSizeBytes) {
      throw new CanvasError(
        'STORAGE_FULL',
        `Canvas storage would exceed limit (${(this.config.maxTotalSizeBytes / 1024 / 1024).toFixed(0)} MB)`,
      );
    }

    // Ensure parent dir
    const parentDir = join(fullPath, '..');
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    // Inject live-reload script if HTML and enabled
    let finalContent = opts.content;
    if (
      this.config.liveReload &&
      (safePath.endsWith('.html') || (opts.contentType ?? '').includes('text/html'))
    ) {
      finalContent = injectLiveReload(opts.content);
    }

    writeFileSync(fullPath, finalContent, 'utf-8');
    this.scanEntries(); // refresh state

    logger.info(`[Canvas] Pushed content → ${safePath} (${contentBuffer.byteLength} bytes)`);

    // Notify clients
    this.broadcast({ type: 'reload', path: safePath });

    return { path: safePath, url: `/canvas/${safePath}` };
  }

  /**
   * Read a file from canvas.
   */
  readFile(filePath: string): { content: Buffer; contentType: string } | null {
    const safePath = this.sanitizePath(filePath);
    const fullPath = join(this.config.rootDir, safePath);

    if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
      return null;
    }

    // Double-check path didn't escape rootDir
    const resolved = resolve(fullPath);
    if (!resolved.startsWith(resolve(this.config.rootDir))) {
      return null;
    }

    const ext = extname(safePath);
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    const content = readFileSync(fullPath);

    return { content, contentType };
  }

  /**
   * Navigate: set active canvas and notify clients.
   */
  navigate(path: string): void {
    const safePath = this.sanitizePath(path);
    this.state = { ...this.state, activePath: safePath };
    this.broadcast({ type: 'navigate', path: safePath });
    logger.info(`[Canvas] Navigate → ${safePath}`);
  }

  /**
   * Get current state.
   */
  getState(): CanvasState {
    return { ...this.state };
  }

  // ─── Path Safety ──────────────────────────────────────────────────────

  /**
   * Sanitize a path to prevent traversal attacks.
   */
  private sanitizePath(inputPath: string): string {
    // Remove leading slashes, collapse double slashes, block traversal
    let safe = inputPath
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+/g, '/')
      .replace(/\.\./g, '');

    // Remove null bytes
    safe = safe.replace(/\0/g, '');

    // Final check — resolve and verify containment
    const resolved = resolve(this.config.rootDir, safe);
    if (!resolved.startsWith(resolve(this.config.rootDir))) {
      throw new CanvasError('PATH_TRAVERSAL', 'Invalid path');
    }

    return safe;
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────

  close(): void {
    if (this.wss) {
      for (const client of this.clients) {
        client.close();
      }
      this.clients.clear();
      this.wss.close();
      this.wss = null;
    }
    logger.info('[Canvas] Host closed');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Inject live-reload WebSocket script before </body> or at end of HTML.
 */
function injectLiveReload(html: string): string {
  if (html.includes('</body>')) {
    return html.replace('</body>', `${LIVE_RELOAD_SCRIPT}</body>`);
  }
  if (html.includes('</html>')) {
    return html.replace('</html>', `${LIVE_RELOAD_SCRIPT}</html>`);
  }
  // No closing tags — append
  return html + LIVE_RELOAD_SCRIPT;
}

// ─── Errors ───────────────────────────────────────────────────────────────

export class CanvasError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CanvasError';
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────

let _canvasHost: CanvasHost | null = null;

export function getCanvasHost(config?: Partial<CanvasConfig>): CanvasHost {
  if (!_canvasHost) {
    _canvasHost = new CanvasHost(config);
  }
  return _canvasHost;
}

export function resetCanvasHost(): void {
  if (_canvasHost) {
    _canvasHost.close();
    _canvasHost = null;
  }
}

// ─── Fastify Registration ─────────────────────────────────────────────────

export function registerCanvasRoutes(app: FastifyInstance): void {
  const canvas = getCanvasHost();

  // Attach WS once server is listening
  app.addHook('onReady', async () => {
    const server = app.server as HttpServer;
    canvas.attachWebSocket(server);
  });

  // ─── GET /canvas/status ──────────────────────────────────────────────
  app.get('/canvas/status', async (_req: FastifyRequest, reply: FastifyReply) => {
    const state = canvas.getState();
    return reply.send({
      entries: state.entries.length,
      totalSizeBytes: state.totalSizeBytes,
      activePath: state.activePath,
      files: state.entries.map(e => ({
        path: e.path,
        title: e.title,
        contentType: e.contentType,
        sizeBytes: e.sizeBytes,
        updatedAt: e.updatedAt,
      })),
    });
  });

  // ─── POST /canvas/push ──────────────────────────────────────────────
  app.post('/canvas/push', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      content?: string;
      path?: string;
      title?: string;
      contentType?: string;
      navigate?: boolean;
    } | null;

    if (!body?.content) {
      return reply.status(400).send({
        error: { code: 'MISSING_CONTENT', message: 'Body must include "content" field' },
      });
    }

    try {
      const result = canvas.pushContent({
        path: body.path,
        content: body.content,
        title: body.title,
        contentType: body.contentType,
      });

      if (body.navigate !== false) {
        canvas.navigate(result.path);
      }

      return reply.send({
        success: true,
        path: result.path,
        url: result.url,
      });
    } catch (err) {
      if (err instanceof CanvasError) {
        return reply.status(400).send({
          error: { code: err.code, message: err.message },
        });
      }
      throw err;
    }
  });

  // ─── POST /canvas/navigate ──────────────────────────────────────────
  app.post('/canvas/navigate', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { path?: string } | null;
    if (!body?.path) {
      return reply.status(400).send({
        error: { code: 'MISSING_PATH', message: 'Body must include "path" field' },
      });
    }

    canvas.navigate(body.path);
    return reply.send({ success: true, activePath: body.path });
  });

  // ─── GET /canvas/* — static file serving ─────────────────────────────
  app.get('/canvas/*', async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url.split('?')[0];
    let filePath = url.replace(/^\/canvas\/?/, '') || 'index.html';

    // If requesting directory, try index.html
    const result = canvas.readFile(filePath) ?? canvas.readFile(join(filePath, 'index.html'));

    if (!result) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: `Canvas file not found: ${filePath}` },
      });
    }

    // CSP header for sandboxing
    reply.header('Content-Security-Policy', CANVAS_CSP);
    reply.header('Content-Type', result.contentType);
    reply.header('X-Content-Type-Options', 'nosniff');

    // Cache static assets, no-cache for HTML
    if (result.contentType === 'text/html') {
      reply.header('Cache-Control', 'no-cache');
    } else {
      reply.header('Cache-Control', 'public, max-age=3600');
    }

    return reply.send(result.content);
  });

  logger.info(`[Canvas] Routes registered: GET /canvas/*, POST /canvas/push, POST /canvas/navigate, GET /canvas/status`);
}
