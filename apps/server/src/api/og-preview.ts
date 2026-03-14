import type { FastifyInstance } from 'fastify';

/**
 * F10 — Link preview / OG card metadata fetcher.
 * GET /preview/og?url=... → { title, description, image, siteName, url }
 */
export function registerOGPreviewRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: { url: string };
  }>('/preview/og', async (req, reply) => {
    const { url } = req.query;
    if (!url || typeof url !== 'string') {
      return reply.status(400).send({ error: 'url required' });
    }

    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'HiveClaw/1.0 (LinkPreview)',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!resp.ok) {
        return reply.send({ data: null });
      }

      const html = await resp.text();

      // Parse OG tags with simple regex (no DOM parser needed)
      const getOG = (property: string): string | null => {
        const re = new RegExp(`<meta[^>]*property=["']og:${property}["'][^>]*content=["']([^"']*)["']`, 'i');
        const altRe = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:${property}["']`, 'i');
        return re.exec(html)?.[1] ?? altRe.exec(html)?.[1] ?? null;
      };

      const getTag = (name: string): string | null => {
        const re = new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i');
        const altRe = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${name}["']`, 'i');
        return re.exec(html)?.[1] ?? altRe.exec(html)?.[1] ?? null;
      };

      const title = getOG('title') ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? null;
      const description = getOG('description') ?? getTag('description');
      const image = getOG('image');
      const siteName = getOG('site_name');

      return reply.send({
        data: { title, description, image, siteName, url },
      });
    } catch {
      return reply.send({ data: null });
    }
  });
}
