/// <reference lib="dom" />
// ============================================================
// Browser Pool — Pluggable browser session manager
// Supports: fetch (fallback) + Playwright (full automation)
// ============================================================

import { logger } from '../lib/logger.js';

import { randomUUID } from 'crypto';

export interface BrowserSession {
  id: string;
  url: string;
  title: string;
  cookies: Array<{ name: string; value: string; domain: string }>;
  localStorage: Record<string, string>;
  createdAt: string;
  lastActivity: string;
}

export interface PageContent {
  url: string;
  title: string;
  text: string;
  html: string;
  links: Array<{ text: string; href: string }>;
  screenshotUrl?: string;
  screenshotBase64?: string;
}

// Playwright types (lazy-imported)
type PwBrowser = import('playwright').Browser;
type PwPage = import('playwright').Page;

export class BrowserPool {
  private sessions: Map<string, BrowserSession> = new Map();
  private pages: Map<string, PwPage> = new Map();
  private browser: PwBrowser | null = null;
  private browserLaunching: Promise<PwBrowser> | null = null;
  private maxSessions: number;
  private engine: 'fetch' | 'playwright';
  private ready: Promise<void>;

  constructor(options?: { maxSessions?: number }) {
    this.maxSessions = options?.maxSessions ?? 8;
    this.engine = 'fetch';

    // Async Playwright detection (ESM-compatible)
    this.ready = import('playwright')
      .then(() => { this.engine = 'playwright'; })
      .catch(() => { /* Playwright not installed — use fetch fallback */ });
  }

  /** Wait for engine detection to complete */
  async ensureReady(): Promise<void> {
    await this.ready;
  }

  // ── Playwright lifecycle ───────────────────────────────────────────────────

  private async ensureBrowser(): Promise<PwBrowser> {
    if (this.browser?.isConnected()) return this.browser;
    if (this.browserLaunching) return this.browserLaunching;

    this.browserLaunching = (async () => {
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      });
      this.browser = browser;
      this.browserLaunching = null;
      return browser;
    })();

    return this.browserLaunching;
  }

  // ── Session management ─────────────────────────────────────────────────────

  async createSession(url?: string): Promise<BrowserSession> {
    await this.ensureReady();
    // LRU eviction when at capacity
    if (this.sessions.size >= this.maxSessions) {
      const oldest = [...this.sessions.entries()].sort(
        (a, b) =>
          new Date(a[1].lastActivity).getTime() - new Date(b[1].lastActivity).getTime(),
      )[0];
      if (oldest) {
        await this.closeSession(oldest[0]);
      }
    }

    const session: BrowserSession = {
      id: randomUUID(),
      url: url ?? '',
      title: '',
      cookies: [],
      localStorage: {},
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    };
    this.sessions.set(session.id, session);

    // If playwright, create a real page
    if (this.engine === 'playwright') {
      try {
        const browser = await this.ensureBrowser();
        const context = await browser.newContext({
          userAgent: 'HiveClaw/0.2 (Browser Automation)',
          viewport: { width: 1280, height: 800 },
        });
        const page = await context.newPage();
        this.pages.set(session.id, page);

        if (url) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          // Wait for SPA hydration without blocking on persistent connections (SSE/WS)
          await page.waitForTimeout(2_000);
          session.url = page.url();
          session.title = await page.title();
        }
      } catch (err) {
        // Fallback: session still created, navigate will use fetch
        logger.warn(`[BrowserPool] Playwright page creation failed: ${(err as Error).message}`);
      }
    }

    return session;
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  async navigate(sessionId: string, url: string): Promise<PageContent> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    session.url = url;
    session.lastActivity = new Date().toISOString();

    const page = this.pages.get(sessionId);
    if (page && this.engine === 'playwright') {
      return this.playwrightNavigate(page, url);
    }
    return this.fetchNavigate(url);
  }

  private async playwrightNavigate(page: PwPage, url: string): Promise<PageContent> {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Extra wait for SPA hydration (React, Next.js etc.) — don't use networkidle
    // as SPAs with SSE/WebSocket connections never settle
    await page.waitForTimeout(2_000);

    const title = await page.title();
    const html = await page.content();

    // Extract visible text
    const text = await page.evaluate(() => {
      return document.body?.innerText?.slice(0, 10_000) ?? '';
    });

    // Extract links
    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]'))
        .slice(0, 50)
        .map((a) => ({
          href: (a as HTMLAnchorElement).href,
          text: (a as HTMLAnchorElement).innerText?.trim() || (a as HTMLAnchorElement).href,
        }));
    });

    // Screenshot as base64
    let screenshotBase64: string | undefined;
    try {
      const buf = await page.screenshot({ type: 'jpeg', quality: 70, fullPage: false });
      screenshotBase64 = buf.toString('base64');
    } catch { /* screenshot optional */ }

    return {
      url: page.url(),
      title,
      text,
      html: html.slice(0, 50_000),
      links,
      screenshotBase64,
    };
  }

  private async fetchNavigate(url: string): Promise<PageContent> {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'HiveClaw/0.2 (Browser Automation)' },
        signal: AbortSignal.timeout(15_000),
      });
      const html = await res.text();

      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch?.[1]?.trim() ?? url;

      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 10_000);

      const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
      const links: Array<{ text: string; href: string }> = [];
      let m: RegExpExecArray | null;
      while ((m = linkRegex.exec(html)) !== null && links.length < 50) {
        links.push({ href: m[1], text: m[2].trim() || m[1] });
      }

      const encoded = encodeURIComponent(url);
      const screenshotUrl = `https://image.thum.io/get/width/1280/crop/800/${encoded}`;

      return { url, title, text, html: html.slice(0, 50_000), links, screenshotUrl };
    } catch (e) {
      throw new Error(`Failed to navigate to ${url}: ${(e as Error).message}`);
    }
  }

  // ── Interactions ───────────────────────────────────────────────────────────

  async click(sessionId: string, selector: string): Promise<PageContent> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.lastActivity = new Date().toISOString();

    const page = this.pages.get(sessionId);
    if (page && this.engine === 'playwright') {
      await page.click(selector, { timeout: 10_000 });
      await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});

      const title = await page.title();
      const text = await page.evaluate(() => document.body?.innerText?.slice(0, 10_000) ?? '');
      const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]'))
          .slice(0, 50)
          .map((a) => ({
            href: (a as HTMLAnchorElement).href,
            text: (a as HTMLAnchorElement).innerText?.trim() || (a as HTMLAnchorElement).href,
          })),
      );

      session.url = page.url();
      session.title = title;

      return { url: page.url(), title, text, html: '', links };
    }

    return {
      url: session.url,
      title: 'Click Action',
      text: `Click on "${selector}" requires Playwright engine. Install with: npm install playwright`,
      html: '',
      links: [],
    };
  }

  async type(sessionId: string, selector: string, text: string): Promise<PageContent> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.lastActivity = new Date().toISOString();

    const page = this.pages.get(sessionId);
    if (page && this.engine === 'playwright') {
      await page.fill(selector, text, { timeout: 10_000 });

      const title = await page.title();
      const pageText = await page.evaluate(() => document.body?.innerText?.slice(0, 10_000) ?? '');

      return { url: page.url(), title, text: pageText, html: '', links: [] };
    }

    return {
      url: session.url,
      title: 'Type Action',
      text: `Type on "${selector}" requires Playwright engine. Install with: npm install playwright`,
      html: '',
      links: [],
    };
  }

  // ── Screenshot (standalone) ────────────────────────────────────────────────

  async screenshot(sessionId: string): Promise<{ base64: string; mimeType: string } | null> {
    const page = this.pages.get(sessionId);
    if (!page) return null;

    const buf = await page.screenshot({ type: 'jpeg', quality: 80, fullPage: false });
    return { base64: buf.toString('base64'), mimeType: 'image/jpeg' };
  }

  // ── Evaluate JavaScript ────────────────────────────────────────────────────

  async evaluate(sessionId: string, expression: string): Promise<unknown> {
    const page = this.pages.get(sessionId);
    if (!page) throw new Error(`No Playwright page for session ${sessionId}`);

    return page.evaluate(expression);
  }

  // ── Session queries ────────────────────────────────────────────────────────

  getSession(sessionId: string): BrowserSession | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(): BrowserSession[] {
    return Array.from(this.sessions.values());
  }

  async closeSession(sessionId: string): Promise<void> {
    const page = this.pages.get(sessionId);
    if (page) {
      try {
        const ctx = page.context();
        await page.close();
        await ctx.close();
      } catch { /* already closed */ }
      this.pages.delete(sessionId);
    }
    this.sessions.delete(sessionId);
  }

  async getStatusAsync(): Promise<{ engine: string; activeSessions: number; maxSessions: number }> {
    await this.ensureReady();
    return this.getStatus();
  }

  getStatus(): { engine: string; activeSessions: number; maxSessions: number } {
    return {
      engine: this.engine,
      activeSessions: this.sessions.size,
      maxSessions: this.maxSessions,
    };
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  async destroyAll(): Promise<void> {
    for (const id of this.sessions.keys()) {
      await this.closeSession(id);
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _pool: BrowserPool | null = null;

export function getBrowserPool(): BrowserPool {
  if (!_pool) _pool = new BrowserPool();
  return _pool;
}
