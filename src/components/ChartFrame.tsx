'use client';

import { useCallback, useRef, useState } from 'react';
import { Download, Copy, Check } from 'lucide-react';
import { toCanvas } from 'html-to-image';

interface ChartFrameProps {
  children: React.ReactNode;
  /** Chart name. Drawn above the chart in the exported image + used for the filename. */
  title?: string;
  /** Classes for the outer wrapper — pass sizing here (e.g. "h-full"). */
  className?: string;
  /** Watermark opacity. Subtle by default so it sits behind the data. */
  watermarkOpacity?: number;
  /** Shifts the watermark right to center it over the plot, past the y-axis labels. */
  watermarkOffsetX?: string;
  /** Shifts the watermark up (positive raises it). */
  watermarkOffsetY?: string;
}

/**
 * Wraps a chart with a centered BULKSTATS watermark and a hover toolbar that
 * exports the chart as a PNG (download or copy).
 *
 * The export is composited entirely off-screen: we rasterize the chart node
 * to a canvas (the watermark is part of that node, so it comes along), then
 * draw a titled header bar above it on a second canvas. Nothing in the live
 * DOM is mutated, so there's no flash / resize / scale jump while exporting.
 */
export function ChartFrame({
  children,
  title,
  className = '',
  watermarkOpacity = 0.06,
  watermarkOffsetX = '7%',
  watermarkOffsetY = '8%',
}: ChartFrameProps) {
  const captureRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const cssVar = (name: string, fallback: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

  /** Rasterize the chart (with watermark), then composite a title bar on top. */
  const buildCanvas = useCallback(async (): Promise<HTMLCanvasElement | null> => {
    const node = captureRef.current;
    if (!node) return null;

    // Derive the scale so the export is ~4K wide regardless of how small the
    // chart is on-screen (these sit half-width in a row, so a fixed ratio
    // wouldn't get there). Capped to keep memory sane.
    const rect = node.getBoundingClientRect();
    const ratio = Math.min(6, Math.max(3, 3840 / Math.max(rect.width, 1)));
    const bg = cssVar('--bg-base', '#141310');

    const chart = await toCanvas(node, {
      pixelRatio: ratio,
      backgroundColor: bg,
      filter: (el) => !(el instanceof HTMLElement && el.dataset.noExport === 'true'),
    });

    if (!title) return chart;

    const titleH = Math.round(38 * ratio);
    const padX = Math.round(18 * ratio);
    const out = document.createElement('canvas');
    out.width = chart.width;
    out.height = chart.height + titleH;

    const ctx = out.getContext('2d');
    if (!ctx) return chart;

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, out.width, out.height);

    ctx.fillStyle = cssVar('--text-primary', '#ffffff');
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(15 * ratio)}px ${getComputedStyle(node).fontFamily || 'sans-serif'}`;
    ctx.fillText(title, padX, Math.round(titleH / 2));

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(chart, 0, titleH);
    return out;
  }, [title]);

  const toBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
    new Promise((res) => canvas.toBlob(res, 'image/png'));

  const download = useCallback(async () => {
    setBusy(true);
    try {
      const canvas = await buildCanvas();
      if (!canvas) return;
      const blob = await toBlob(canvas);
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
  }, [buildCanvas, title]);

  const copy = useCallback(async () => {
    setBusy(true);
    try {
      const canvas = await buildCanvas();
      if (!canvas) return;
      const blob = await toBlob(canvas);
      if (!blob) return;
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard image write unsupported in some browsers — silently ignore */
    } finally {
      setBusy(false);
    }
  }, [buildCanvas]);

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

      {/* Captured region: watermark (behind) + chart. */}
      <div ref={captureRef} className="relative h-full">
        <div
          className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center"
          style={{ paddingLeft: watermarkOffsetX, paddingBottom: watermarkOffsetY }}
        >
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
        <div className="relative z-10 h-full">{children}</div>
      </div>
    </div>
  );
}
