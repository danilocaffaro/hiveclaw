// ============================================================
// Web Search Tool — Search the web using DuckDuckGo or Brave
// No API key required for DuckDuckGo HTML scraping
// ============================================================

import type { Tool, ToolInput, ToolOutput, ToolDefinition, ToolContext } from './types.js';
import { logger } from '../../lib/logger.js';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export class WebSearchTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'web_search',
    description:
      'Search the web for information. Returns titles, URLs, and snippets. ' +
      'Use this to find current information, documentation, answers, news, or any web content.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query string',
        },
        count: {
          type: 'number',
          description: 'Number of results to return (default: 5, max: 10)',
        },
      },
      required: ['query'],
    },
  };

  async execute(input: ToolInput, _context?: ToolContext): Promise<ToolOutput> {
    const query = input['query'] as string;
    if (!query || query.trim() === '') {
      return { success: false, error: 'query is required' };
    }

    const count = Math.min((input['count'] as number) ?? 5, 10);

    try {
      // Try Brave API first if key is available
      const braveKey = process.env['BRAVE_API_KEY'] ?? process.env['BRAVE_SEARCH_API_KEY'];
      if (braveKey) {
        return this.searchBrave(query, count, braveKey);
      }

      // Fallback: DuckDuckGo HTML scraping (no API key needed)
      return this.searchDuckDuckGo(query, count);
    } catch (err) {
      return { success: false, error: `Search failed: ${(err as Error).message}` };
    }
  }

  private async searchBrave(query: string, count: number, apiKey: string): Promise<ToolOutput> {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new Error(`Brave API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json() as {
      web?: { results?: Array<{ title: string; url: string; description: string }> };
    };

    const results: SearchResult[] = (data.web?.results ?? []).slice(0, count).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }));

    return {
      success: true,
      result: {
        engine: 'brave',
        query,
        count: results.length,
        results,
      },
    };
  }

  private async searchDuckDuckGo(query: string, count: number): Promise<ToolOutput> {
    // DuckDuckGo Lite HTML endpoint — no JS required
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'HiveClaw/0.2 (Agent Search Tool)',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new Error(`DuckDuckGo error: ${res.status}`);
    }

    const html = await res.text();
    const results = this.parseDDGResults(html, count);

    if (results.length === 0) {
      // Fallback: try DuckDuckGo JSON API (limited but sometimes works)
      return this.searchDDGJson(query, count);
    }

    return {
      success: true,
      result: {
        engine: 'duckduckgo',
        query,
        count: results.length,
        results,
      },
    };
  }

  private async searchDDGJson(query: string, count: number): Promise<ToolOutput> {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'HiveClaw/0.2' },
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json() as {
      AbstractText?: string;
      AbstractURL?: string;
      AbstractSource?: string;
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
    };

    const results: SearchResult[] = [];

    if (data.AbstractText && data.AbstractURL) {
      results.push({
        title: data.AbstractSource ?? 'Summary',
        url: data.AbstractURL,
        snippet: data.AbstractText,
      });
    }

    for (const topic of (data.RelatedTopics ?? []).slice(0, count - results.length)) {
      if (topic.Text && topic.FirstURL) {
        results.push({
          title: topic.Text.split(' - ')[0] ?? topic.Text.slice(0, 60),
          url: topic.FirstURL,
          snippet: topic.Text,
        });
      }
    }

    return {
      success: true,
      result: {
        engine: 'duckduckgo-instant',
        query,
        count: results.length,
        results,
      },
    };
  }

  private parseDDGResults(html: string, count: number): SearchResult[] {
    const results: SearchResult[] = [];

    // DDG Lite returns results in a table structure
    // Each result has a link and a snippet in subsequent rows
    const linkRegex = /<a[^>]+class="result-link"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
    const snippetRegex = /<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

    const links: Array<{ url: string; title: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = linkRegex.exec(html)) !== null) {
      links.push({ url: m[1], title: m[2].trim() });
    }

    const snippets: string[] = [];
    while ((m = snippetRegex.exec(html)) !== null) {
      const clean = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      snippets.push(clean);
    }

    for (let i = 0; i < Math.min(links.length, count); i++) {
      results.push({
        title: links[i].title,
        url: links[i].url,
        snippet: snippets[i] ?? '',
      });
    }

    return results;
  }
}
