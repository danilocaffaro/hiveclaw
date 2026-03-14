'use client';

import React, { useEffect, useState } from 'react';

/**
 * F10 — Link preview card (OG tags).
 * Detects URLs in message text and renders a preview card.
 */

interface OGData {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  url: string;
}

// Cache previews to avoid refetching
const ogCache = new Map<string, OGData | null>();

const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/gi;

export function extractUrls(text: string): string[] {
  return [...text.matchAll(URL_REGEX)].map((m) => m[0]).slice(0, 3); // Max 3 previews per message
}

function LinkPreviewCard({ url }: { url: string }) {
  const [og, setOg] = useState<OGData | null>(ogCache.get(url) ?? null);
  const [loading, setLoading] = useState(!ogCache.has(url));

  useEffect(() => {
    if (ogCache.has(url)) {
      setOg(ogCache.get(url) ?? null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    fetch(`/api/preview/og?url=${encodeURIComponent(url)}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((json) => {
        const data = json.data as OGData | null;
        ogCache.set(url, data);
        setOg(data);
      })
      .catch(() => {
        ogCache.set(url, null);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [url]);

  if (loading) return null; // Don't show skeleton — too noisy
  if (!og || (!og.title && !og.description)) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'block',
        border: '1px solid var(--border)',
        borderRadius: 10,
        overflow: 'hidden',
        marginTop: 6,
        textDecoration: 'none',
        color: 'inherit',
        maxWidth: 400,
        background: 'var(--surface)',
        transition: 'border-color 150ms',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--coral)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
    >
      {og.image && (
        <img
          src={og.image}
          alt=""
          style={{
            width: '100%',
            maxHeight: 160,
            objectFit: 'cover',
            display: 'block',
          }}
          loading="lazy"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      )}
      <div style={{ padding: '8px 12px' }}>
        {og.siteName && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
            {og.siteName}
          </div>
        )}
        {og.title && (
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3 }}>
            {og.title.slice(0, 100)}
          </div>
        )}
        {og.description && (
          <div style={{
            fontSize: 12, color: 'var(--text-secondary)', marginTop: 3,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {og.description.slice(0, 200)}
          </div>
        )}
      </div>
    </a>
  );
}

/**
 * Renders link previews for all URLs found in message content.
 */
export function LinkPreviews({ content }: { content: string }) {
  const urls = extractUrls(content);
  if (urls.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {urls.map((url) => (
        <LinkPreviewCard key={url} url={url} />
      ))}
    </div>
  );
}
