// ============================================================
// Screenshot Tool — Capture screen or browser screenshots
// Uses macOS screencapture or Playwright page.screenshot()
// ============================================================

import type { Tool, ToolInput, ToolOutput, ToolDefinition, ToolContext } from './types.js';
import { execSync } from 'child_process';
import { readFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../../lib/logger.js';

export class ScreenshotTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'screenshot',
    description:
      'Take a screenshot of the desktop screen or a specific browser page. Returns base64-encoded image. ' +
      'Use source="screen" for full desktop, source="browser" to screenshot a URL via headless browser.',
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          enum: ['screen', 'browser'],
          description: 'Screenshot source: "screen" for desktop, "browser" for headless browser page',
        },
        url: {
          type: 'string',
          description: 'URL to screenshot (required when source=browser)',
        },
        selector: {
          type: 'string',
          description: 'Optional CSS selector to screenshot a specific element (browser only)',
        },
        fullPage: {
          type: 'boolean',
          description: 'Capture full scrollable page (browser only, default: false)',
        },
        delay: {
          type: 'number',
          description: 'Wait N milliseconds before capturing (default: 1000 for browser, 0 for screen)',
        },
      },
      required: ['source'],
    },
  };

  async execute(input: ToolInput, _context?: ToolContext): Promise<ToolOutput> {
    const source = input['source'] as string;

    try {
      if (source === 'screen') {
        return this.captureScreen();
      } else if (source === 'browser') {
        const url = input['url'] as string | undefined;
        if (!url) return { success: false, error: 'url required for browser screenshots' };
        const selector = input['selector'] as string | undefined;
        const fullPage = (input['fullPage'] as boolean) ?? false;
        const delay = (input['delay'] as number) ?? 2000;
        return this.captureBrowser(url, { selector, fullPage, delay });
      } else {
        return { success: false, error: `Unknown source: ${source}. Use "screen" or "browser".` };
      }
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  private captureScreen(): ToolOutput {
    const tmpDir = join(process.env['HOME'] ?? '/tmp', '.hiveclaw', 'screenshots');
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
    const filePath = join(tmpDir, `screen-${randomUUID()}.png`);

    try {
      execSync(`/usr/sbin/screencapture -x "${filePath}"`, { timeout: 10_000 });
      const buf = readFileSync(filePath);
      const base64 = buf.toString('base64');
      unlinkSync(filePath);

      return {
        success: true,
        result: {
          source: 'screen',
          format: 'png',
          size: buf.length,
          base64,
        },
      };
    } catch (err) {
      // Cleanup on failure
      try { unlinkSync(filePath); } catch { /* ignore */ }
      return { success: false, error: `Screen capture failed: ${(err as Error).message}` };
    }
  }

  private async captureBrowser(
    url: string,
    opts: { selector?: string; fullPage?: boolean; delay?: number },
  ): Promise<ToolOutput> {
    try {
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'HiveClaw/0.2 (Screenshot Tool)',
      });
      const page = await context.newPage();

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      if (opts.delay) await page.waitForTimeout(opts.delay);

      let buf: Buffer;
      if (opts.selector) {
        const el = page.locator(opts.selector).first();
        buf = await el.screenshot({ type: 'png' }) as Buffer;
      } else {
        buf = await page.screenshot({
          type: 'png',
          fullPage: opts.fullPage ?? false,
        }) as Buffer;
      }

      await browser.close();

      return {
        success: true,
        result: {
          source: 'browser',
          url,
          format: 'png',
          size: buf.length,
          base64: buf.toString('base64'),
        },
      };
    } catch (err) {
      return { success: false, error: `Browser screenshot failed: ${(err as Error).message}` };
    }
  }
}
