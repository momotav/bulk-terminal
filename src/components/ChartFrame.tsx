'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  /** Series labels drawn in the top-right of the EXPORT only (not the live chart). */
  legend?: { label: string; color: string }[];
}

/**
 * Wraps a chart with a centered BULKSTATS watermark and a hover toolbar that
 * exports the chart as a PNG (download or copy).
 *
 * Watermark centering is automatic: instead of per-chart offsets, the
 * component measures the rendered recharts axes (left/right y-axis gutters
 * and x-axis label height) and centers the watermark over the PLOT area, not
 * the whole frame. So single-axis, dual-axis, and wide-label charts all
 * self-center. Re-measured on resize and again right before each export.
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
  legend,
}: ChartFrameProps) {
  const captureRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  // Watermark shift in px to center it over the plot: +x right, +y up.
  const [wm, setWm] = useState({ x: 0, y: 0 });

  const cssVar = (name: string, fallback: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

  // Measure recharts axes and center the watermark over the plot area.
  const measure = useCallback(() => {
    const node = captureRef.current;
    if (!node) return;
    const nodeRect = node.getBoundingClientRect();
    if (!nodeRect.width) return;

    let leftG = 0;
    let rightG = 0;
    node.querySelectorAll('.recharts-yAxis').forEach((ax) => {
      const r = ax.getBoundingClientRect();
      const center = r.left + r.width / 2 - nodeRect.left;
      if (center < nodeRect.width / 2) {
        leftG = Math.max(leftG, r.right - nodeRect.left); // left gutter
      } else {
        rightG = Math.max(rightG, nodeRect.right - r.left); // right gutter
      }
    });

    const xAxis = node.querySelector('.recharts-xAxis');
    const xH = xAxis ? xAxis.getBoundingClientRect().height : 0;

    const next = { x: (leftG - rightG) / 2, y: xH / 2 };
    setWm((prev) =>
      Math.abs(prev.x - next.x) > 0.5 || Math.abs(prev.y - next.y) > 0.5 ? next : prev,
    );
  }, []);

  useEffect(() => {
    // recharts renders async — measure a couple of times, then track resizes.
    const t1 = setTimeout(measure, 60);
    const t2 = setTimeout(measure, 350);
    const ro = new ResizeObserver(() => measure());
    if (captureRef.current) ro.observe(captureRef.current);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      ro.disconnect();
    };
  }, [measure]);

  /** Rasterize the chart (with watermark), then composite a title bar on top. */
  const buildCanvas = useCallback(async (): Promise<HTMLCanvasElement | null> => {
    const node = captureRef.current;
    if (!node) return null;

    // Re-center the watermark against the current axis layout, then let the
    // transform repaint before rasterizing.
    measure();
    await new Promise<void>((res) =>
      requestAnimationFrame(() => requestAnimationFrame(() => res())),
    );

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

    const hasLegend = !!legend && legend.length > 0;
    if (!title && !hasLegend) return chart;

    const titleH = Math.round(38 * ratio);
    const padX = Math.round(18 * ratio);
    const out = document.createElement('canvas');
    out.width = chart.width;
    out.height = chart.height + titleH;

    const ctx = out.getContext('2d');
    if (!ctx) return chart;

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, out.width, out.height);

    const fontFamily = getComputedStyle(node).fontFamily || 'sans-serif';
    const cy = Math.round(titleH / 2);

    // Title — top-left.
    if (title) {
      ctx.fillStyle = cssVar('--text-primary', '#ffffff');
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.font = `600 ${Math.round(15 * ratio)}px ${fontFamily}`;
      ctx.fillText(title, padX, cy);
    }

    // Legend — top-right. Resolve CSS-var colours to concrete values so the
    // canvas can fill them.
    if (hasLegend) {
      const resolveColor = (c: string) =>
        c.startsWith('var(') ? cssVar(c.slice(4, -1).trim(), '#888888') : c;

      ctx.font = `500 ${Math.round(13 * ratio)}px ${fontFamily}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';

      const dotR = 4.5 * ratio;
      const dotGap = 6 * ratio; // dot → its label
      const itemGap = 16 * ratio; // between items
      const widths = legend!.map(
        (it) => dotR * 2 + dotGap + ctx.measureText(it.label).width,
      );
      const total =
        widths.reduce((a, b) => a + b, 0) + itemGap * (legend!.length - 1);

      let x = out.width - padX - total;
      legend!.forEach((it, i) => {
        ctx.beginPath();
        ctx.fillStyle = resolveColor(it.color);
        ctx.arc(x + dotR, cy, dotR, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = cssVar('--text-secondary', '#aaaaaa');
        ctx.fillText(it.label, x + dotR * 2 + dotGap, cy);
        x += widths[i] + itemGap;
      });
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(chart, 0, titleH);
    return out;
  }, [title, legend, measure]);

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
        <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
          <div
            className="w-1/3 max-w-[260px] aspect-square"
            style={{
              transform: `translate(${wm.x}px, ${-wm.y}px)`,
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
        {/* Absolutely positioned so the chart SVG fills the box but never
            contributes to layout height — otherwise recharts' ResponsiveContainer
            props the container open and the height can be grown but not shrunk. */}
        <div className="relative z-10 h-full">
          <div className="absolute inset-0">{children}</div>
        </div>
      </div>
    </div>
  );
}
