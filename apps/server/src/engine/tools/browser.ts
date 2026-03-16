// ============================================================
// Browser Tool — Agent-accessible browser automation
// Wraps BrowserPool for use inside the agentic loop
// ============================================================

import type { Tool, ToolInput, ToolOutput, ToolDefinition, ToolContext } from './types.js';
import { getBrowserPool } from '../browser-pool.js';
import { validateUrlWithDns } from '../../lib/url-security.js';

export class BrowserTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'browser',
    description:
      'Control a web browser: navigate to URLs, read page content, click elements, type text, take screenshots. Returns page content and screenshot URLs.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['navigate', 'read', 'click', 'type', 'screenshot', 'sessions'],
          description: 'Browser action to perform',
        },
        url: {
          type: 'string',
          description: 'URL to navigate to (required for navigate)',
        },
        sessionId: {
          type: 'string',
          description: 'Browser session ID — auto-created if not provided for navigate',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for click/type actions',
        },
        text: {
          type: 'string',
          description: 'Text to type (required for type action)',
        },
      },
      required: ['action'],
    },
  };

  async execute(input: ToolInput, _context?: ToolContext): Promise<ToolOutput> {
    const pool = getBrowserPool();
    const action = input['action'] as string;
    let sessionId = input['sessionId'] as string | undefined;

    try {
      switch (action) {
        case 'navigate': {
          const url = input['url'] as string | undefined;
          if (!url) return { success: false, error: 'url required for navigate' };

          // S1.1: SSRF protection with DNS rebinding defense
          try {
            await validateUrlWithDns(url);
          } catch (err) {
            return { success: false, error: (err as Error).message };
          }

          if (!sessionId) {
            const session = await pool.createSession(url);
            sessionId = session.id;
          }
          const content = await pool.navigate(sessionId, url);
          return {
            success: true,
            result: {
              sessionId,
              url: content.url,
              title: content.title,
              textPreview: content.text.slice(0, 2000),
              linkCount: content.links.length,
              links: content.links.slice(0, 10),
              screenshotUrl: content.screenshotUrl,
            },
          };
        }

        case 'read': {
          if (!sessionId) return { success: false, error: 'sessionId required for read' };
          const session = pool.getSession(sessionId);
          if (!session) return { success: false, error: 'Session not found' };
          const content = await pool.navigate(sessionId, session.url);
          return {
            success: true,
            result: {
              url: content.url,
              title: content.title,
              text: content.text,
              links: content.links.slice(0, 20),
            },
          };
        }

        case 'click': {
          if (!sessionId) return { success: false, error: 'sessionId required for click' };
          const selector = input['selector'] as string | undefined;
          if (!selector) return { success: false, error: 'selector required for click' };
          const result = await pool.click(sessionId, selector);
          return { success: true, result: result.text };
        }

        case 'type': {
          if (!sessionId) return { success: false, error: 'sessionId required for type' };
          const selector = input['selector'] as string | undefined;
          const text = input['text'] as string | undefined;
          if (!selector || !text)
            return { success: false, error: 'selector and text required for type' };
          const result = await pool.type(sessionId, selector, text);
          return { success: true, result: result.text };
        }

        case 'screenshot': {
          if (!sessionId) return { success: false, error: 'sessionId required for screenshot' };
          const session = pool.getSession(sessionId);
          if (!session?.url) return { success: false, error: 'No URL loaded in session' };
          const encoded = encodeURIComponent(session.url);
          return {
            success: true,
            result: {
              screenshotUrl: `https://image.thum.io/get/width/1280/crop/800/${encoded}`,
              url: session.url,
            },
          };
        }

        case 'sessions': {
          const sessions = pool.listSessions();
          return {
            success: true,
            result: {
              status: pool.getStatus(),
              sessions: sessions.map((s) => ({
                id: s.id,
                url: s.url,
                lastActivity: s.lastActivity,
              })),
            },
          };
        }

        default:
          return {
            success: false,
            error: `Unknown action: ${action}. Available: navigate, read, click, type, screenshot, sessions`,
          };
      }
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}
