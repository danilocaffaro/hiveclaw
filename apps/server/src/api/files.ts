import type { FastifyInstance } from 'fastify';
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, extname, relative, basename, dirname } from 'path';
import { resolve } from 'path';
import { randomUUID } from 'node:crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
  children?: FileNode[];
  language?: string;
}

// ─── Language Detection ───────────────────────────────────────────────────────

const LANGUAGE_MAP: Record<string, string> = {
  '.ts':         'typescript',
  '.tsx':        'typescriptreact',
  '.js':         'javascript',
  '.jsx':        'javascriptreact',
  '.json':       'json',
  '.css':        'css',
  '.scss':       'scss',
  '.sass':       'sass',
  '.less':       'less',
  '.html':       'html',
  '.md':         'markdown',
  '.mdx':        'mdx',
  '.py':         'python',
  '.rs':         'rust',
  '.go':         'go',
  '.yaml':       'yaml',
  '.yml':        'yaml',
  '.toml':       'toml',
  '.sql':        'sql',
  '.sh':         'bash',
  '.bash':       'bash',
  '.zsh':        'bash',
  '.env':        'plaintext',
  '.gitignore':  'plaintext',
  '.dockerignore': 'plaintext',
  '.lock':       'plaintext',
  '.txt':        'plaintext',
  '.xml':        'xml',
  '.svg':        'svg',
};

function detectLanguage(filename: string): string {
  const ext = extname(filename);
  if (ext) return LANGUAGE_MAP[ext] ?? 'plaintext';
  // Handle files with no extension but known names
  const base = basename(filename);
  const knownNoExt: Record<string, string> = {
    Dockerfile: 'dockerfile',
    Makefile:   'makefile',
    '.env':     'plaintext',
  };
  return knownNoExt[base] ?? 'plaintext';
}

// ─── Directory Exclusions ─────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.git', '.turbo', 'build', 'out', 'coverage', '.cache']);
const SKIP_PREFIX = '.';

// ─── Tree Builder ─────────────────────────────────────────────────────────────

function buildTree(dirPath: string, depth: number, maxDepth: number, rootPath: string): FileNode[] {
  if (depth >= maxDepth) return [];
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true })
      .filter(e => {
        if (e.name.startsWith(SKIP_PREFIX)) return false;
        if (e.isDirectory() && SKIP_DIRS.has(e.name)) return false;
        return true;
      })
      .sort((a, b) => {
        // Directories before files, then alphabetical
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

    const result: FileNode[] = [];
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      const relPath = relative(rootPath, fullPath);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (entry.isDirectory()) {
        result.push({
          name: entry.name,
          path: relPath,
          type: 'directory',
          modified: stat.mtime.toISOString(),
          children: buildTree(fullPath, depth + 1, maxDepth, rootPath),
        });
      } else {
        result.push({
          name: entry.name,
          path: relPath,
          type: 'file',
          size: stat.size,
          modified: stat.mtime.toISOString(),
          language: detectLanguage(entry.name),
        });
      }
    }
    return result;
  } catch {
    return [];
  }
}

// ─── Security Guard ───────────────────────────────────────────────────────────

function guardPath(requestedPath: string, workspacePath: string): string | null {
  // Block path traversal attempts (.. escaping)
  if (requestedPath.includes('..')) return null;

  const resolved = requestedPath.startsWith('/')
    ? resolve(requestedPath)
    : resolve(join(workspacePath, requestedPath));

  // Absolute paths must still be within workspace root or common safe dirs
  const allowedRoots = [
    resolve(workspacePath),
    resolve(join(workspacePath, '..')),  // parent for monorepo project selector
  ];

  // Block sensitive system paths regardless
  const blocked = ['/etc', '/var', '/usr', '/bin', '/sbin', '/root', '/home',
    '/private/etc', '/System', '/Library'];
  for (const b of blocked) {
    if (resolved.startsWith(b + '/') || resolved === b) return null;
  }

  // Allow paths within workspace or its parent (project selector)
  const inAllowed = allowedRoots.some(root => resolved.startsWith(root + '/') || resolved === root);
  if (!inAllowed) return null;

  return resolved;
}

// ─── Route Registration ───────────────────────────────────────────────────────

export function registerFileRoutes(app: FastifyInstance, workspacePath: string) {
  const root = resolve(workspacePath);

  // ── GET /files/tree ─────────────────────────────────────────────────────────
  app.get<{
    Querystring: { path?: string; depth?: string };
  }>('/files/tree', async (req, reply) => {
    const reqPath = req.query.path ?? '';
    const maxDepth = Math.min(parseInt(req.query.depth ?? '3', 10), 8);

    const basePath = reqPath ? guardPath(reqPath, root) : root;
    if (!basePath) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Path outside workspace' } });
    }

    try {
      const tree = buildTree(basePath, 0, maxDepth, root);
      return reply.send({ data: tree });
    } catch (err) {
      return reply.status(500).send({ error: { code: 'INTERNAL', message: (err as Error).message } });
    }
  });

  // ── GET /files/read ──────────────────────────────────────────────────────────
  app.get<{
    Querystring: { path: string };
  }>('/files/read', async (req, reply) => {
    if (!req.query.path) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'path required' } });
    }

    const fullPath = guardPath(req.query.path, root);
    if (!fullPath) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Path outside workspace' } });
    }

    try {
      const content = readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n').length;
      const filename = basename(fullPath);
      return reply.send({
        data: {
          path: req.query.path,
          content,
          language: detectLanguage(filename),
          size: content.length,
          lines,
        },
      });
    } catch (err) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: (err as Error).message } });
    }
  });

  // ── PUT /files/write ─────────────────────────────────────────────────────────
  app.put<{
    Body: { path: string; content: string };
  }>('/files/write', async (req, reply) => {
    const { path: filePath, content } = req.body ?? {};
    if (!filePath || content === undefined) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'path and content required' } });
    }

    const fullPath = guardPath(filePath, root);
    if (!fullPath) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Path outside workspace' } });
    }

    try {
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, content, 'utf-8');
      return reply.send({ data: { path: filePath, size: content.length } });
    } catch (err) {
      return reply.status(500).send({ error: { code: 'WRITE_ERROR', message: (err as Error).message } });
    }
  });

  // ── GET /files/search ────────────────────────────────────────────────────────
  app.get<{
    Querystring: { query: string; path?: string; ext?: string; limit?: string };
  }>('/files/search', async (req, reply) => {
    const { query } = req.query;
    if (!query) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'query required' } });
    }

    const searchRoot = req.query.path ? guardPath(req.query.path, root) : root;
    if (!searchRoot) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Path outside workspace' } });
    }

    const exts = req.query.ext
      ? req.query.ext.split(',').map(e => e.trim())
      : ['.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.md', '.html', '.py'];
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 200);
    const queryLower = query.toLowerCase();

    const matches: Array<{ file: string; line: number; text: string }> = [];

    function searchDir(dir: string): void {
      if (matches.length >= limit) return;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (matches.length >= limit) return;
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          searchDir(fullPath);
          continue;
        }
        if (!exts.some(ext => entry.name.endsWith(ext))) continue;
        let content: string;
        try {
          content = readFileSync(fullPath, 'utf-8');
        } catch {
          continue;
        }
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(queryLower)) {
            matches.push({
              file: relative(root, fullPath),
              line: i + 1,
              text: lines[i].trim(),
            });
            if (matches.length >= limit) return;
          }
        }
      }
    }

    searchDir(searchRoot);

    return reply.send({ data: { matches, total: matches.length, query } });
  });

  // ── POST /files/upload ──────────────────────────────────────────────────────
  // Upload file(s) for chat attachments. Saves to /tmp/superclaw-uploads/
  // Returns array of { name, path, size, type }
  // Register at BOTH paths to avoid /api/* catch-all breaking multipart
  const UPLOAD_DIR = '/tmp/superclaw-uploads';

  const uploadHandler = async (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
    if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

    const parts = req.parts();
    const uploaded: Array<{ name: string; path: string; size: number; type: string }> = [];

    for await (const part of parts) {
      if (part.type !== 'file') continue;

      const ext = extname(part.filename) || '';
      const safeName = `${randomUUID()}${ext}`;
      const filePath = join(UPLOAD_DIR, safeName);
      const chunks: Buffer[] = [];

      for await (const chunk of part.file) {
        chunks.push(chunk);
      }

      const buf = Buffer.concat(chunks);
      writeFileSync(filePath, buf);

      uploaded.push({
        name: part.filename,
        path: filePath,
        size: buf.length,
        type: part.mimetype,
      });
    }

    return reply.send({ data: uploaded });
  };

  app.post('/files/upload', uploadHandler);
  app.post('/api/files/upload', uploadHandler);

  // ── GET /files/uploads/:filename ────────────────────────────────────────────
  // Serve uploaded files (for image previews in chat)
  app.get<{ Params: { filename: string } }>('/files/uploads/:filename', async (req, reply) => {
    const filePath = join(UPLOAD_DIR, basename(req.params.filename));
    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: 'File not found' });
    }
    const ext = extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
      '.json': 'application/json', '.csv': 'text/csv',
    };
    reply.header('Content-Type', mimeMap[ext] || 'application/octet-stream');
    return reply.send(readFileSync(filePath));
  });
}
