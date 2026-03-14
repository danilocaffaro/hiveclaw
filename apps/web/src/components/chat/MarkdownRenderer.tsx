'use client';

import React, { type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import DOMPurify from 'dompurify';
import { CodeBlock } from './CodeBlock';

// ─── Markdown Renderer ─────────────────────────────────────────────────────────

/**
 * Sanitize content before rendering. Defense-in-depth:
 * ReactMarkdown already strips raw HTML, but DOMPurify catches edge cases.
 * We strip dangerous HTML tags/attrs but preserve markdown-safe content.
 */
function sanitize(content: string): string {
  // Strip script/iframe/object tags and event handlers, keep text + basic formatting
  return DOMPurify.sanitize(content, {
    ALLOWED_TAGS: [],     // No HTML tags pass through (markdown handles formatting)
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true,   // Keep text content of stripped tags
  });
}

/**
 * Pre-process content to convert file:// references to renderable URLs.
 * ReactMarkdown sanitizes file:// URLs, so we convert them before rendering:
 * - [Image: X](file:///path/Y.ext) → ![X](/api/files/uploads/Y.ext)
 * - [File: X](file:///path/Y.ext) → 📄 X
 */
function preprocessFileRefs(content: string): string {
  // Convert image file refs to markdown images
  return content
    .replace(
      /\[Image:\s*([^\]]+)\]\(file:\/\/\/[^)]*\/([^/)]+)\)/g,
      (_match, label, filename) => `![${label}](/api/files/uploads/${filename})`
    )
    .replace(
      /\[File:\s*([^\]]+)\]\(file:\/\/\/[^)]*\/([^/)]+)\)/g,
      (_match, label, _filename) => `📄 ${label}`
    );
}

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '');
          const lang = match ? match[1] : '';
          const codeString = String(children).replace(/\n$/, '');
          const isBlock = lang || codeString.includes('\n');

          if (isBlock) {
            return <CodeBlock lang={lang} codeString={codeString} />;
          }

          return (
            <code style={{
              padding: '2px 6px', borderRadius: 4,
              background: 'var(--surface)', color: 'var(--coral)',
              fontFamily: 'var(--font-mono)', fontSize: '0.9em'
            }} {...props}>
              {children}
            </code>
          );
        },
        p: ({ children }) => <p style={{ marginBottom: 8, lineHeight: 1.6 }}>{children as ReactNode}</p>,
        ul: ({ children }) => <ul style={{ paddingLeft: 20, marginBottom: 8 }}>{children as ReactNode}</ul>,
        ol: ({ children }) => <ol style={{ paddingLeft: 20, marginBottom: 8 }}>{children as ReactNode}</ol>,
        li: ({ children }) => <li style={{ marginBottom: 4, lineHeight: 1.6 }}>{children as ReactNode}</li>,
        img: ({ src, alt }) => {
          // Render uploaded images inline
          const srcStr = typeof src === 'string' ? src : '';
          const resolvedSrc = srcStr.startsWith('file://')
            ? `/api/files/uploads/${srcStr.split('/').pop()}`
            : srcStr;
          return (
            <img src={resolvedSrc} alt={alt || 'image'}
              style={{
                maxWidth: '100%', maxHeight: 300, borderRadius: 8,
                margin: '6px 0', display: 'block',
              }}
              loading="lazy"
            />
          );
        },
        a: ({ href, children }) => {
          // If it's a file:// link, render as a file chip
          if (href?.startsWith('file://')) {
            const filename = href.split('/').pop() || 'file';
            const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(filename);
            if (isImage) {
              const imgSrc = `/api/files/uploads/${filename}`;
              return (
                <span style={{ display: 'block', margin: '6px 0' }}>
                  <img src={imgSrc} alt={String(children) || 'image'}
                    style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 8 }}
                    loading="lazy" />
                </span>
              );
            }
            return (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 10px', borderRadius: 6,
                background: 'var(--surface)', border: '1px solid var(--border)',
                fontSize: 13, color: 'var(--text-secondary)',
              }}>
                📄 {children as ReactNode}
              </span>
            );
          }
          return (
            <a href={href} target="_blank" rel="noopener noreferrer"
              style={{ color: 'var(--blue)', textDecoration: 'none' }}
              onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
              onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}>
              {children as ReactNode}
            </a>
          );
        },
        strong: ({ children }) => <strong style={{ fontWeight: 600, color: 'var(--text)' }}>{children as ReactNode}</strong>,
        em: ({ children }) => <em style={{ color: 'var(--text-secondary)' }}>{children as ReactNode}</em>,
        blockquote: ({ children }) => (
          <blockquote style={{
            borderLeft: '3px solid var(--border)', paddingLeft: 12,
            color: 'var(--text-secondary)', margin: '8px 0'
          }}>{children as ReactNode}</blockquote>
        ),
        h1: ({ children }) => <h1 style={{ fontSize: 20, fontWeight: 700, margin: '12px 0 8px', color: 'var(--text)' }}>{children as ReactNode}</h1>,
        h2: ({ children }) => <h2 style={{ fontSize: 17, fontWeight: 700, margin: '10px 0 6px', color: 'var(--text)' }}>{children as ReactNode}</h2>,
        h3: ({ children }) => <h3 style={{ fontSize: 15, fontWeight: 600, margin: '8px 0 4px', color: 'var(--text)' }}>{children as ReactNode}</h3>,
        table: ({ children }) => (
          <div style={{ overflowX: 'auto', margin: '8px 0', maxWidth: '100%' }}>
            <table style={{ minWidth: 300, borderCollapse: 'collapse', fontSize: 13 }}>{children as ReactNode}</table>
          </div>
        ),
        th: ({ children }) => (
          <th style={{
            textAlign: 'left', padding: '6px 12px',
            borderBottom: '2px solid var(--border)', fontWeight: 600,
            color: 'var(--text)', fontSize: 12
          }}>{children as ReactNode}</th>
        ),
        td: ({ children }) => (
          <td style={{
            padding: '6px 12px', borderBottom: '1px solid var(--border)',
            color: 'var(--text-secondary)', fontSize: 13
          }}>{children as ReactNode}</td>
        ),
        hr: () => <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '12px 0' }} />,
      }}
    >
      {sanitize(preprocessFileRefs(content))}
    </ReactMarkdown>
  );
}

