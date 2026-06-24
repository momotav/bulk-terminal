'use client';

import { useCallback, useRef, useState } from 'react';
import { Download, Copy, Check } from 'lucide-react';
import { toBlob } from 'html-to-image';

interface ChartFrameProps {
  children: React.ReactNode;
  /** Used for the download filename and (optionally) the export header. */
  title?: string;
  /** Classes for the outer wrapper — pass sizing here (e.g. "h-full"). */
  className?: string;
  /** Watermark opacity. Subtle by default so it sits behind the data. */
  watermarkOpacity?: number;
}

/**
 * Wraps a chart with a DefiLlama-style grayscale watermark and a hover toolbar
 * that exports the chart as a PNG (download or copy-to-clipboard). The captured
 * region includes the watermark + a small bulkstats.com mark, so screenshots
 * shared elsewhere stay branded. The toolbar itself sits outside the captured
 * node, so it never appears in the export.
 */
export function ChartFrame({ children, title, className = '', watermarkOpacity = 0.06 }: ChartFrameProps) {
  const captureRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const themedBg = () =>
    getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim() || '#141310';

  const render = useCallback(async (): Promise<Blob | null> => {
    const node = captureRef.current;
    if (!node) return null;
    return toBlob(node, {
      pixelRatio: 2,
      backgroundColor: themedBg(),
      filter: (el) => !(el instanceof HTMLElement && el.dataset.noExport === 'true'),
    });
  }, []);

  const download = useCallback(async () => {
    setBusy(true);
    try {
      const blob = await render();
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(title || 'bulkstats-chart').replace(/\s+/g, '-').toLowerCase()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }, [render, title]);

  const copy = useCallback(async () => {
    setBusy(true);
    try {
      const blob = await render();
      if (!blob) return;
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard image write unsupported in some browsers — silently ignore */
    } finally {
      setBusy(false);
    }
  }, [render]);

  return (
    <div className={`group relative ${className}`}>
      {/* Hover toolbar — outside the captured node, so never in the export. */}
      <div className="absolute top-1 right-1 z-20 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={copy}
          disabled={busy}
          title="Copy image"
          className="p-1.5 rounded-md bg-[var(--bg-muted)] border border-[var(--border-color)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-bulk-green" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={download}
          disabled={busy}
          title="Download PNG"
          className="p-1.5 rounded-md bg-[var(--bg-muted)] border border-[var(--border-color)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Captured region: watermark (behind) + chart + branding. */}
      <div ref={captureRef} className="relative h-full">
        <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/bulkstats.png"
            alt=""
            draggable={false}
            className="w-1/3 max-w-[180px] select-none"
            style={{ filter: 'grayscale(1)', opacity: watermarkOpacity }}
          />
        </div>
        <div className="relative z-10 h-full">{children}</div>
        <div className="pointer-events-none absolute bottom-1 right-2 z-10 text-[10px] text-[var(--text-tertiary)] opacity-60">
          bulkstats.com
        </div>
      </div>
    </div>
  );
}
