import type { Tool, ToolInput, ToolOutput, ToolDefinition } from './types.js';

const DEFAULT_MAX_CHARS = 50_000;

function stripHtml(html: string): string {
  // Remove script and style blocks entirely
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '');

  // Replace block-level elements with newlines for readability
  text = text
    .replace(/<\/?(p|div|section|article|header|footer|main|nav|aside|h[1-6]|li|tr|blockquote|pre)[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n---\n');

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…');

  // Collapse excessive whitespace / blank lines
  text = text
    .split('\n')
    .map(l => l.trim())
    .filter((l, i, arr) => l !== '' || (arr[i - 1] !== ''))
    .join('\n')
    .trim();

  return text;
}

export class WebFetchTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'webfetch',
    description: 'Fetch a URL and return its readable text content. HTML is stripped for readability.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch' },
        maxChars: {
          type: 'number',
          description: `Maximum characters to return (default ${DEFAULT_MAX_CHARS})`,
        },
      },
      required: ['url'],
    },
  };

  async execute(input: ToolInput): Promise<ToolOutput> {
    const url = input['url'] as string;
    const maxChars = (input['maxChars'] as number | undefined) ?? DEFAULT_MAX_CHARS;

    if (!url) {
      return { success: false, error: 'url is required' };
    }

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; HiveClaw/1.0; +https://github.com/hiveclaw)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status} ${response.statusText} for ${url}`,
        };
      }

      const contentType = response.headers.get('content-type') ?? '';
      const rawText = await response.text();

      let text: string;
      if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
        text = stripHtml(rawText);
      } else {
        text = rawText;
      }

      if (text.length > maxChars) {
        text = text.slice(0, maxChars) + `\n[truncated at ${maxChars} chars]`;
      }

      return { success: true, result: text };
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
  }
}
