'use client';

import { useState, useEffect, useRef } from 'react';

type DeviceType = 'desktop' | 'tablet' | 'mobile';

const DEVICE_SIZES: Record<DeviceType, { width: string; height: string; label: string }> = {
  desktop: { width: '100%', height: '100%', label: 'Full width' },
  tablet:  { width: '768px', height: '1024px', label: '768 × 1024' },
  mobile:  { width: '375px', height: '812px', label: '375 × 812' },
};

function getPersistedDevice(): DeviceType {
  if (typeof window === 'undefined') return 'desktop';
  return (localStorage.getItem('sc-preview-device') as DeviceType) || 'desktop';
}

function DeviceChrome({ device, children }: { device: DeviceType; children: React.ReactNode }) {
  if (device === 'desktop') return <>{children}</>;

  const isMobile = device === 'mobile';
  const frameRadius = isMobile ? 32 : 16;
  const bezelTop = isMobile ? 48 : 32;
  const bezelBottom = isMobile ? 24 : 20;
  const bezelSide = isMobile ? 12 : 10;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      background: '#1A1A2E',
      borderRadius: frameRadius,
      border: '2px solid #30363D',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)',
      overflow: 'hidden',
      maxWidth: '100%',
      maxHeight: '100%',
    }}>
      {/* Top bezel with notch/camera */}
      <div style={{
        width: '100%', height: bezelTop,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', flexShrink: 0,
      }}>
        {isMobile ? (
          /* Dynamic Island style notch */
          <div style={{
            width: 80, height: 22, borderRadius: 12,
            background: '#000', border: '1px solid #30363D',
          }} />
        ) : (
          /* Tablet camera dot */
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: '#30363D', border: '1px solid #444',
          }} />
        )}
      </div>

      {/* Screen area */}
      <div style={{
        width: DEVICE_SIZES[device].width,
        height: DEVICE_SIZES[device].height,
        overflow: 'hidden',
        paddingLeft: bezelSide,
        paddingRight: bezelSide,
        boxSizing: 'content-box',
      }}>
        {children}
      </div>

      {/* Bottom bezel */}
      <div style={{
        width: '100%', height: bezelBottom,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        {isMobile && (
          <div style={{
            width: 100, height: 4, borderRadius: 2,
            background: '#30363D',
          }} />
        )}
      </div>
    </div>
  );
}

function PreviewPanel() {
  const [previewUrl, setPreviewUrl] = useState('');
  const [inputUrl, setInputUrl] = useState('http://localhost:3000');
  const [device, setDevice] = useState<DeviceType>(getPersistedDevice);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoReload, setAutoReload] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sseRef = useRef<EventSource | null>(null);

  // Persist device selection
  const selectDevice = (d: DeviceType) => {
    setDevice(d);
    if (typeof window !== 'undefined') localStorage.setItem('sc-preview-device', d);
  };

  const loadPreview = () => {
    setIsLoading(true);
    setError(null);
    setPreviewUrl(inputUrl);
  };

  const reloadIframe = () => {
    if (iframeRef.current) {
      try { iframeRef.current.contentWindow?.location.reload(); } catch { /* cross-origin */ }
      // Fallback: re-set src
      const current = iframeRef.current.src;
      iframeRef.current.src = '';
      setTimeout(() => { if (iframeRef.current) iframeRef.current.src = current; }, 50);
    }
  };

  // Hot-reload via SSE (Item 3 integration point)
  useEffect(() => {
    if (!autoReload || !previewUrl) {
      sseRef.current?.close();
      sseRef.current = null;
      return;
    }
    const es = new EventSource('/api/preview/events');
    es.addEventListener('file-change', () => {
      reloadIframe();
    });
    es.onerror = () => {
      // SSE disconnected — will auto-reconnect
    };
    sseRef.current = es;
    return () => { es.close(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoReload, previewUrl]);

  const goBack = () => {
    try { iframeRef.current?.contentWindow?.history.back(); } catch { /* cross-origin */ }
  };
  const goForward = () => {
    try { iframeRef.current?.contentWindow?.history.forward(); } catch { /* cross-origin */ }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* URL Bar */}
      <div style={{
        display: 'flex', gap: 6, padding: '8px 12px',
        borderBottom: '1px solid var(--border)',
        alignItems: 'center',
      }}>
        <button onClick={goBack} title="Back" aria-label="Back" style={{
          padding: '4px 6px', borderRadius: 6, background: 'var(--surface-hover)',
          border: '1px solid var(--border)', color: 'var(--text-secondary)',
          fontSize: 13, cursor: 'pointer', lineHeight: 1,
        }}>←</button>
        <button onClick={goForward} title="Forward" aria-label="Forward" style={{
          padding: '4px 6px', borderRadius: 6, background: 'var(--surface-hover)',
          border: '1px solid var(--border)', color: 'var(--text-secondary)',
          fontSize: 13, cursor: 'pointer', lineHeight: 1,
        }}>→</button>
        <button onClick={reloadIframe} title="Reload" aria-label="Reload" style={{
          padding: '4px 6px', borderRadius: 6, background: 'var(--surface-hover)',
          border: '1px solid var(--border)', color: 'var(--text-secondary)',
          fontSize: 13, cursor: 'pointer', lineHeight: 1,
        }}>↻</button>
        <input
          value={inputUrl}
          onChange={e => setInputUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && loadPreview()}
          placeholder="http://localhost:3000"
          style={{
            flex: 1, padding: '6px 10px', borderRadius: 6,
            background: 'var(--bg)', border: '1px solid var(--border)',
            color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)',
            outline: 'none',
          }}
        />
        <button onClick={loadPreview} style={{
          padding: '6px 12px', borderRadius: 6,
          background: 'var(--blue-subtle)', border: '1px solid rgba(88,166,255,0.3)',
          color: 'var(--blue)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
        }}>Go</button>
      </div>

      {/* Device Toggle + Auto-reload */}
      <div style={{
        display: 'flex', gap: 4, padding: '6px 12px',
        borderBottom: '1px solid var(--border)', alignItems: 'center',
      }}>
        {(['desktop', 'tablet', 'mobile'] as const).map(d => (
          <button key={d} onClick={() => selectDevice(d)} style={{
            padding: '3px 10px', borderRadius: 'var(--radius-sm)',
            background: device === d ? 'var(--blue-subtle)' : 'transparent',
            color: device === d ? 'var(--blue)' : 'var(--text-muted)',
            border: device === d ? '1px solid rgba(88,166,255,0.3)' : '1px solid transparent',
            fontSize: 11, fontWeight: 500, cursor: 'pointer', textTransform: 'capitalize' as const,
          }}>{d === 'desktop' ? '🖥' : d === 'tablet' ? '📱' : '📲'} {d}</button>
        ))}
        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>
          {DEVICE_SIZES[device].label}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={() => setAutoReload(v => !v)} style={{
            padding: '3px 8px', borderRadius: 'var(--radius-sm)',
            background: autoReload ? 'rgba(63,185,80,0.15)' : 'transparent',
            color: autoReload ? 'var(--green)' : 'var(--text-muted)',
            border: autoReload ? '1px solid rgba(63,185,80,0.3)' : '1px solid transparent',
            fontSize: 10, fontWeight: 500, cursor: 'pointer',
          }}>
            {autoReload ? '⚡ Auto' : '⚡ Auto'}
          </button>
        </div>
      </div>

      {/* Preview Area */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'auto',
        background: device !== 'desktop' ? '#0A0A14' : undefined,
        padding: device !== 'desktop' ? 20 : 0,
      }}>
        {previewUrl ? (
          <DeviceChrome device={device}>
            <div style={{
              width: device === 'desktop' ? '100%' : DEVICE_SIZES[device].width,
              height: device === 'desktop' ? '100%' : DEVICE_SIZES[device].height,
              position: 'relative',
              overflow: 'hidden',
              borderRadius: device === 'mobile' ? 4 : device === 'tablet' ? 2 : 0,
            }}>
              {isLoading && (
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  background: 'var(--surface)', zIndex: 10,
                }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading preview…</span>
                </div>
              )}
              <iframe
                ref={iframeRef}
                src={previewUrl}
                onLoad={() => setIsLoading(false)}
                onError={() => { setIsLoading(false); setError('Failed to load'); }}
                style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
                sandbox="allow-scripts allow-forms allow-popups"
              />
            </div>
          </DeviceChrome>
        ) : (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🌐</div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 8 }}>
              Enter a URL above to preview
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              Supports localhost dev servers and public URLs
            </p>
          </div>
        )}
      </div>

      {/* Status Bar */}
      {previewUrl && (
        <div style={{
          padding: '4px 12px', borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between',
          fontSize: 11, color: 'var(--text-muted)',
        }}>
          <span>{error ? `❌ ${error}` : isLoading ? '⏳ Loading…' : '✅ Loaded'}</span>
          <span style={{ fontFamily: 'var(--font-mono)' }}>{previewUrl}</span>
        </div>
      )}
    </div>
  );
}

// ─── Browser Panel ────────────────────────────────────────────────────────────

export default PreviewPanel;
