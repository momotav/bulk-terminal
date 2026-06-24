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
    // Reveal the export-only title, wait two frames for it to paint, capture,
    // then hide it again.
    setExporting(true);
    await new Promise<void>((res) =>
      requestAnimationFrame(() => requestAnimationFrame(() => res())),
    );
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

      {/* Captured region: watermark (behind) + chart + (export-only) title. */}
      <div ref={captureRef} className="relative h-full">
        {/* Themed text watermark, centered behind the data. */}
        <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
          <span
            className="font-bold tracking-[0.18em] select-none whitespace-nowrap"
            style={{
              color: 'var(--text-primary)',
              opacity: watermarkOpacity,
              fontSize: 'clamp(28px, 8vw, 60px)',
            }}
          >
            BULKSTATS
          </span>
        </div>

        {/* Chart name — shown only while exporting, so it lands in the PNG. */}
        {exporting && title && (
          <div className="absolute top-2 left-3 z-20 text-sm font-semibold text-[var(--text-primary)]">
            {title}
          </div>
        )}

        <div className="relative z-10 h-full">{children}</div>
      </div>
    </div>
  );
}
