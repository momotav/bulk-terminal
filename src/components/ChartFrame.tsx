'use client';

import { useCallback, useRef, useState } from 'react';
import { Download, Copy, Check } from 'lucide-react';
import { toBlob } from 'html-to-image';

interface ChartFrameProps {
  children: React.ReactNode;
  /** Chart name. Baked into the top-left of the exported image + filename. */
  title?: string;
  /** Classes for the outer wrapper — pass sizing here (e.g. "h-full"). */
  className?: string;
  /** Watermark opacity. Subtle by default so it sits behind the data. */
  watermarkOpacity?: number;
}

/**
 * Wraps a chart with a centered BULKSTATS watermark (themed text, so it shows
 * on both light and dark) and a hover toolbar that exports the chart as a PNG
 * (download or copy). The chart's name is injected top-left only during the
 * capture, so in-app the chart stays clean but shared screenshots are titled
 * and branded. The toolbar lives outside the captured node, so it's never in
 * the export.
 */
export function ChartFrame({ children, title, className = '', watermarkOpacity = 0.06 }: ChartFrameProps) {
  const captureRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const themedBg = () =>
    getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim() || '#141310';

  const render = useCallback(async (): Promise<Blob | null> => {
    const node = captureRef.current;
    if (!node) return null;
    // Reveal the export-only title strip, wait for the chart to re-layout to
    // the reduced height (recharts resizes via its own observer), then capture.
    setExporting(true);
    await new Promise<void>((res) => setTimeout(res, 180));
    try {
      return await toBlob(node, {
        pixelRatio: 2,
        backgroundColor: themedBg(),
        filter: (el) => !(el instanceof HTMLElement && el.dataset.noExport === 'true'),
      });
    } finally {
      setExporting(false);
    }
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

      {/* Captured region: watermark (behind) + (export-only) title strip + chart. */}
      <div ref={captureRef} className="relative h-full flex flex-col">
        {/* Watermark — spans the whole captured area, behind everything. */}
        <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
          <div
            className="w-1/3 max-w-[260px] aspect-square"
            style={{
              backgroundColor: 'var(--text-primary)',
              opacity: watermarkOpacity,
              WebkitMaskImage: 'url(/chartlogo.png)',
              maskImage: 'url(/chartlogo.png)',
              WebkitMaskRepeat: 'no-repeat',
              maskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center',
              maskPosition: 'center',
              WebkitMaskSize: 'contain',
              maskSize: 'contain',
            }}
          />
        </div>

        {/* Title strip — only present while exporting, so it reserves space
            above the chart in the PNG without overlapping the plot (and
            leaves the in-app chart untouched). */}
        {exporting && title && (
          <div className="relative z-10 shrink-0 px-3 pt-1 pb-2 text-sm font-semibold text-[var(--text-primary)]">
            {title}
          </div>
        )}

        <div className="relative z-10 flex-1 min-h-0">{children}</div>
      </div>
    </div>
  );
}
