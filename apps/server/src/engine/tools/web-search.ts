// ============================================================
// Web Search Tool — Search the web using DuckDuckGo, Brave, Serper, or Tavily
//
// Priority: Brave API > Serper > Tavily > DuckDuckGo (free, no key)
// DuckDuckGo uses POST to lite.duckduckgo.com (GET triggers captcha).
// Users can configure API keys in .env for premium search providers.
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
      // Priority 1: Brave API (if key is set)
      const braveKey = process.env['BRAVE_API_KEY'] ?? process.env['BRAVE_SEARCH_API_KEY'];
      if (braveKey) {
        return this.searchBrave(query, count, braveKey);
      }

      // Priority 2: Serper.dev (if key is set)
      const serperKey = process.env['SERPER_API_KEY'];
      if (serperKey) {
        return this.searchSerper(query, count, serperKey);
      }

      // Priority 3: Tavily (if key is set)
      const tavilyKey = process.env['TAVILY_API_KEY'];
      if (tavilyKey) {
        return this.searchTavily(query, count, tavilyKey);
      }

      // Priority 4: DuckDuckGo HTML scraping (free, no API key)
      return this.searchDuckDuckGo(query, count);
    } catch (err) {
      return { success: false, error: `Search failed: ${(err as Error).message}` };
    }
  }

  // ── Brave Search API ──────────────────────────────────────────────────────────

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

  // ── Serper.dev (Google Search API) ────────────────────────────────────────────

  private async searchSerper(query: string, count: number, apiKey: string): Promise<ToolOutput> {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num: count }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new Error(`Serper API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json() as {
      organic?: Array<{ title: string; link: string; snippet: string }>;
    };

    const results: SearchResult[] = (data.organic ?? []).slice(0, count).map((r) => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet,
    }));

    return {
      success: true,
      result: {
        engine: 'serper',
        query,
        count: results.length,
        results,
      },
    };
  }

  // ── Tavily Search API ─────────────────────────────────────────────────────────

  private async searchTavily(query: string, count: number, apiKey: string): Promise<ToolOutput> {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: count,
        include_answer: false,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new Error(`Tavily API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json() as {
      results?: Array<{ title: string; url: string; content: string }>;
    };

    const results: SearchResult[] = (data.results ?? []).slice(0, count).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
    }));

    return {
      success: true,
      result: {
        engine: 'tavily',
        query,
        count: results.length,
        results,
      },
    };
  }

  // ── DuckDuckGo HTML (free, no API key) ────────────────────────────────────────

  private async searchDuckDuckGo(query: string, count: number): Promise<ToolOutput> {
    // IMPORTANT: Use POST method — GET triggers captcha/bot detection.
    // Also use a real browser User-Agent and Referer to avoid blocking.
    const res = await fetch('https://lite.duckduckgo.com/lite/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://lite.duckduckgo.com/',
      },
      body: `q=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new Error(`DuckDuckGo error: ${res.status}`);
    }

    const html = await res.text();

    // Detect captcha/bot block
    if (html.includes('Unfortunately, bots use DuckDuckGo') || html.includes('anomaly-modal')) {
      logger.warn('[WebSearch] DuckDuckGo returned captcha/bot challenge');
      // Fallback to DDG JSON API (limited but may still work)
      return this.searchDDGJson(query, count);
    }

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
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HiveClaw/1.1)',
      },
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

    // DDG Lite POST returns results as links and snippets.
    // Extract all non-DDG links with their text as titles.
    const linkRegex = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([^<]+)<\/a>/gi;
    const snippetRegex = /<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

    // First try the structured result-link class (classic DDG Lite format)
    const structuredLinkRegex = /<a[^>]+class="result-link"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
    const links: Array<{ url: string; title: string }> = [];
    let m: RegExpExecArray | null;

    while ((m = structuredLinkRegex.exec(html)) !== null) {
      links.push({ url: m[1], title: m[2].trim() });
    }

    // If structured class not found, fall back to extracting all external links
    if (links.length === 0) {
      while ((m = linkRegex.exec(html)) !== null) {
        const url = m[1];
        const title = m[2].trim();
        // Skip DDG internal links and empty titles
        if (url.includes('duckduckgo.com') || !title) continue;
        // Deduplicate by URL
        if (!links.some(l => l.url === url)) {
          links.push({ url, title });
        }
      }
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
