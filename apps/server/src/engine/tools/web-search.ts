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
      let result: ToolOutput | null = null;

      // Priority cascade: Gemini Grounding > Brave > Serper > Tavily > Google HTML > DuckDuckGo
      const geminiKey = process.env['GEMINI_API_KEY'] ?? process.env['GOOGLE_API_KEY'] ?? process.env['GOOGLE_GENERATIVE_AI_API_KEY'];
      const braveKey = process.env['BRAVE_API_KEY'] ?? process.env['BRAVE_SEARCH_API_KEY'];
      const serperKey = process.env['SERPER_API_KEY'];
      const tavilyKey = process.env['TAVILY_API_KEY'];

      if (geminiKey) {
        result = await this.searchGeminiGrounding(query, count, geminiKey);
      } else if (braveKey) {
        result = await this.searchBrave(query, count, braveKey);
      } else if (serperKey) {
        result = await this.searchSerper(query, count, serperKey);
      } else if (tavilyKey) {
        result = await this.searchTavily(query, count, tavilyKey);
      } else {
        // Free tier: try Google HTML scrape first, fall back to DDG
        try {
          result = await this.searchGoogleHTML(query, count);
          const googleResults = (result.result as { results?: SearchResult[] })?.results ?? [];
          if (googleResults.length === 0) throw new Error('No Google HTML results');
        } catch {
          result = await this.searchDuckDuckGo(query, count);
        }
      }

      // ── GitHub Search fallback ──────────────────────────────────────────────
      // If primary search returned few/no results, try GitHub Search API.
      // This catches project names, repos, and tools that web search engines miss.
      const primaryResults = (result.result as { results?: SearchResult[] })?.results ?? [];
      const hasRelevantResults = primaryResults.length >= 2 &&
        primaryResults.some(r => r.title.toLowerCase().includes(query.toLowerCase().split(/\s+/)[0]));

      if (!hasRelevantResults) {
        try {
          const ghResults = await this.searchGitHub(query, Math.min(count, 3));
          if (ghResults.length > 0) {
            const engine = (result.result as { engine?: string })?.engine ?? 'unknown';
            const merged = [...ghResults, ...primaryResults].slice(0, count);
            logger.info('[WebSearch] GitHub fallback added %d results for "%s"', ghResults.length, query);
            return {
              success: true,
              result: {
                engine: `${engine}+github`,
                query,
                count: merged.length,
                results: merged,
                note: 'Primary search had weak results — GitHub Search added as fallback.',
              },
            };
          }
        } catch (err) {
          logger.debug('[WebSearch] GitHub fallback failed: %s', (err as Error).message);
        }
      }

      return result;
    } catch (err) {
      return { success: false, error: `Search failed: ${(err as Error).message}` };
    }
  }

  // ── Gemini Search Grounding (Google Search via Gemini API) ─────────────────

  private async searchGeminiGrounding(query: string, count: number, apiKey: string): Promise<ToolOutput> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Search the web and return factual results for: ${query}` }] }],
        tools: [{ google_search: {} }],
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      logger.warn('[WebSearch] Gemini Grounding error (%d): %s', res.status, errText.slice(0, 200));
      throw new Error(`Gemini API error: ${res.status}`);
    }

    const data = await res.json() as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        groundingMetadata?: {
          groundingChunks?: Array<{
            web?: { uri?: string; title?: string };
          }>;
          searchEntryPoint?: { renderedContent?: string };
          webSearchQueries?: string[];
        };
      }>;
    };

    const candidate = data.candidates?.[0];
    const groundingChunks = candidate?.groundingMetadata?.groundingChunks ?? [];
    const answerText = candidate?.content?.parts?.map(p => p.text).join('\n') ?? '';

    const results: SearchResult[] = groundingChunks.slice(0, count).map((chunk) => ({
      title: chunk.web?.title ?? 'Result',
      url: chunk.web?.uri ?? '',
      snippet: '',
    }));

    // If we got grounding chunks, add the synthesized answer as context
    if (results.length > 0 && answerText) {
      results[0].snippet = answerText.slice(0, 500);
    }

    // Fallback: if no grounding chunks but we got a text answer, return it as a single result
    if (results.length === 0 && answerText) {
      results.push({
        title: `Gemini answer for: ${query}`,
        url: '',
        snippet: answerText.slice(0, 1000),
      });
    }

    return {
      success: true,
      result: {
        engine: 'gemini-grounding',
        query,
        count: results.length,
        results,
      },
    };
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

  // ── Google HTML Scrape (free, no API key) ──────────────────────────────────

  private async searchGoogleHTML(query: string, count: number): Promise<ToolOutput> {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${count}&hl=en`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new Error(`Google HTML error: ${res.status}`);
    }

    const html = await res.text();

    // Detect bot/captcha block
    if (html.includes('detected unusual traffic') || html.includes('/sorry/index')) {
      logger.warn('[WebSearch] Google HTML returned captcha/bot challenge');
      throw new Error('Google captcha detected');
    }

    const results = this.parseGoogleResults(html, count);

    return {
      success: true,
      result: {
        engine: 'google-html',
        query,
        count: results.length,
        results,
      },
    };
  }

  private parseGoogleResults(html: string, count: number): SearchResult[] {
    const results: SearchResult[] = [];

    // Google wraps each result in <div class="g"> or similar.
    // Extract <a href="..."><h3>title</h3></a> patterns + snippet spans.

    // Pattern 1: <a href="/url?q=ACTUAL_URL&..."><h3...>TITLE</h3></a>
    const resultBlockRegex = /<a[^>]+href="\/url\?q=([^"&]+)[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/gi;
    let m: RegExpExecArray | null;

    while ((m = resultBlockRegex.exec(html)) !== null && results.length < count) {
      const rawUrl = decodeURIComponent(m[1]);
      const title = m[2].replace(/<[^>]+>/g, '').trim();

      if (!rawUrl.startsWith('http') || !title) continue;
      // Skip Google's own pages
      if (rawUrl.includes('google.com/') && !rawUrl.includes('github.com')) continue;

      // Try to find a snippet near this result
      const snippetAfter = html.slice(m.index + m[0].length, m.index + m[0].length + 2000);
      // Snippets are often in <span> or <div> with class containing "st" or data-content-feature
      const snippetMatch = snippetAfter.match(/<(?:span|div)[^>]*class="[^"]*(?:st|IsZvec|VwiC3b)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/i);
      const snippet = snippetMatch
        ? snippetMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 300)
        : '';

      results.push({ title, url: rawUrl, snippet });
    }

    // Fallback pattern: direct href (no /url?q= redirect)
    if (results.length === 0) {
      const directRegex = /<a[^>]+href="(https?:\/\/(?!www\.google)[^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/gi;
      while ((m = directRegex.exec(html)) !== null && results.length < count) {
        const rawUrl = m[1];
        const title = m[2].replace(/<[^>]+>/g, '').trim();
        if (title) results.push({ title, url: rawUrl, snippet: '' });
      }
    }

    return results;
  }

  // ── GitHub Search API (free, no key required for public repos) ─────────────

  private async searchGitHub(query: string, count: number): Promise<SearchResult[]> {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${count}`;
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'HiveClaw/1.2',
    };
    // Use GitHub token if available (higher rate limit)
    const ghToken = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'];
    if (ghToken) {
      headers['Authorization'] = `Bearer ${ghToken}`;
    }

    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status}`);
    }

    const data = await res.json() as {
      items?: Array<{
        full_name: string;
        html_url: string;
        description: string | null;
        stargazers_count: number;
        language: string | null;
        topics?: string[];
      }>;
    };

    return (data.items ?? []).slice(0, count).map((r) => ({
      title: `${r.full_name} ⭐${r.stargazers_count}${r.language ? ` (${r.language})` : ''}`,
      url: r.html_url,
      snippet: r.description ?? 'No description',
    }));
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
