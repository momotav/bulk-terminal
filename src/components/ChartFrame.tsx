'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Copy, Check, Share2, X } from 'lucide-react';
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
  /** Vertical axis description on the left (e.g. "Daily Volume (USD)"). Shows in-app and in exports. */
  yLabel?: string;
  /** Vertical axis description on the right (e.g. "Cumulative Volume (USD)"). For dual-axis charts. */
  yLabelRight?: string;
  /** When set, the toolbar shows a Share button that opens a preview modal with
   *  a "show wallet" toggle; the wallet is composited into a footer on export. */
  walletAddress?: string;
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
  yLabel,
  yLabelRight,
  walletAddress,
}: ChartFrameProps) {
  const captureRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // Watermark shift in px to center it over the plot: +x right, +y up.
  const [wm, setWm] = useState({ x: 0, y: 0 });
  // Vertical lift (px) to move the axis labels from frame-center up to
  // plot-center — the x-axis labels sit below the plot, so half their height
  // is the offset. Same idea as the watermark's `xH/2` term.
  const [axisLift, setAxisLift] = useState(0);

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

    setAxisLift((prev) => (Math.abs(prev - xH / 2) > 0.5 ? xH / 2 : prev));

    // Center over the plot (x-axis labels sit below the plot, so half their
    // height lifts to true plot-center), then a small extra lift so the logo
    // reads a touch above center on every chart.
    const EXTRA_LIFT = 0.07; // fraction of chart height
    const next = { x: (leftG - rightG) / 2, y: xH / 2 + nodeRect.height * EXTRA_LIFT };
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

  /** Rasterize the chart (with watermark), composite a title bar on top, and
   *  optionally a wallet footer at the bottom (for share cards). */
  const buildCanvas = useCallback(async (showWallet = false): Promise<HTMLCanvasElement | null> => {
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

    const fontFamily = getComputedStyle(node).fontFamily || 'sans-serif';
    const padX = Math.round(18 * ratio);
    const hasLegend = !!legend && legend.length > 0;

    // --- Header (title + legend) over the chart, if either is present -------
    let base: HTMLCanvasElement = chart;
    if (title || hasLegend) {
      const baseH = Math.round(38 * ratio);
      const lh = Math.round(24 * ratio); // row height for title / legend rows
      const titleFont = `600 ${Math.round(15 * ratio)}px ${fontFamily}`;
      const legendFont = `500 ${Math.round(13 * ratio)}px ${fontFamily}`;
      const dotR = 4.5 * ratio;
      const dotGap = 6 * ratio; // dot → its label
      const itemGap = 16 * ratio; // between items
      const gapAfterTitle = title ? Math.round(24 * ratio) : 0;
      const resolveColor = (c: string) =>
        c.startsWith('var(') ? cssVar(c.slice(4, -1).trim(), '#888888') : c;

      const out = document.createElement('canvas');
      const ctx = out.getContext('2d');
      if (ctx) {
        ctx.font = titleFont;
        const titleW = title ? ctx.measureText(title).width : 0;
        ctx.font = legendFont;
        const items = (legend ?? []).map((it) => ({
          ...it,
          w: dotR * 2 + dotGap + ctx.measureText(it.label).width,
        }));
        const rightEdge = chart.width - padX;
        const leftBound = (rowIdx: number) => padX + (rowIdx === 0 ? titleW + gapAfterTitle : 0);
        const rows: (typeof items)[] = [];
        let cur: typeof items = [];
        let curW = 0;
        for (const it of items) {
          const add = (cur.length ? itemGap : 0) + it.w;
          const avail = rightEdge - leftBound(rows.length);
          if (cur.length && curW + add > avail) { rows.push(cur); cur = []; curW = 0; }
          cur.push(it);
          curW += (cur.length > 1 ? itemGap : 0) + it.w;
        }
        if (cur.length) rows.push(cur);
        const numRows = Math.max(1, rows.length);
        const titleH = Math.max(baseH, Math.round(9 * ratio) * 2 + numRows * lh);
        out.width = chart.width;
        out.height = chart.height + titleH;
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, out.width, out.height);
        const contentH = numRows * lh;
        const startY = Math.round((titleH - contentH) / 2);
        const rowCenterY = (rowIdx: number) => startY + lh * rowIdx + lh / 2;
        if (title) {
          ctx.fillStyle = cssVar('--text-primary', '#ffffff');
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';
          ctx.font = titleFont;
          ctx.fillText(title, padX, rowCenterY(0));
        }
        if (hasLegend) {
          ctx.font = legendFont;
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';
          rows.forEach((row, r) => {
            const rowW = row.reduce((a, it) => a + it.w, 0) + itemGap * (row.length - 1);
            let x = rightEdge - rowW;
            const y = rowCenterY(r);
            for (const it of row) {
              ctx.beginPath();
              ctx.fillStyle = resolveColor(it.color);
              ctx.arc(x + dotR, y, dotR, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = cssVar('--text-secondary', '#aaaaaa');
              ctx.fillText(it.label, x + dotR * 2 + dotGap, y);
              x += it.w + itemGap;
            }
          });
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(chart, 0, titleH);
        base = out;
      }
    }

    // --- Optional wallet footer (share cards) ------------------------------
    if (showWallet && walletAddress) {
      const footH = Math.round(40 * ratio);
      const f = document.createElement('canvas');
      f.width = base.width;
      f.height = base.height + footH;
      const fx = f.getContext('2d');
      if (fx) {
        fx.fillStyle = bg;
        fx.fillRect(0, 0, f.width, f.height);
        fx.drawImage(base, 0, 0);
        fx.strokeStyle = cssVar('--border-color', '#2a2a2a');
        fx.lineWidth = Math.max(1, ratio);
        fx.beginPath();
        fx.moveTo(0, base.height + ratio / 2);
        fx.lineTo(f.width, base.height + ratio / 2);
        fx.stroke();
        fx.textBaseline = 'middle';
        const fy = base.height + footH / 2;
        const short = walletAddress.length > 14 ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : walletAddress;
        fx.textAlign = 'left';
        fx.font = `500 ${Math.round(13 * ratio)}px ${fontFamily}`;
        fx.fillStyle = cssVar('--text-secondary', '#aaaaaa');
        fx.fillText(`wallet  ${short}`, padX, fy);
        fx.textAlign = 'right';
        fx.fillStyle = cssVar('--text-tertiary', '#888888');
        fx.fillText('bulkstats.com', f.width - padX, fy);
        return f;
      }
    }

    return base;
  }, [title, legend, measure, walletAddress]);

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
        {walletAddress && (
          <button
            onClick={() => setShareOpen(true)}
            disabled={busy}
            title="Share"
            className="p-1.5 rounded-md bg-[var(--bg-muted)] border border-[var(--border-color)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <Share2 className="w-3.5 h-3.5" />
          </button>
        )}
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

      {shareOpen && walletAddress && (
        <ChartShareModal
          title={title}
          walletAddress={walletAddress}
          build={buildCanvas}
          onClose={() => setShareOpen(false)}
        />
      )}

      {/* Captured region: watermark (behind) + optional axis labels + chart. */}
      <div ref={captureRef} className="relative h-full flex">
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

        {/* Left axis description — vertical, in a slim gutter so it's part of
            the captured node (shows in-app AND in the exported PNG). */}
        {yLabel && (
          <div className="relative z-10 shrink-0 w-6 flex items-center justify-center select-none">
            <span
              className="whitespace-nowrap text-[13px] text-[var(--text-secondary)] tracking-wide"
              style={{ transform: `translateY(${-axisLift}px) rotate(-90deg)` }}
            >
              {yLabel}
            </span>
          </div>
        )}

        {/* Chart — flex-1; inner absolute layer keeps recharts from propping
            the height open (grow-but-not-shrink bug). */}
        <div className="relative z-10 flex-1 min-w-0 h-full">
          <div className="absolute inset-0">{children}</div>
        </div>

        {/* Right axis description (dual-axis charts). */}
        {yLabelRight && (
          <div className="relative z-10 shrink-0 w-6 flex items-center justify-center select-none">
            <span
              className="whitespace-nowrap text-[13px] text-[var(--text-secondary)] tracking-wide"
              style={{ transform: `translateY(${-axisLift}px) rotate(90deg)` }}
            >
              {yLabelRight}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// ChartShareModal — preview-and-share popup. Shows the rendered card (built by
// ChartFrame's buildCanvas), a "show wallet" toggle that re-composites the
// footer, and Download / Copy / Share-on-X actions.
// ----------------------------------------------------------------------------
function ChartShareModal({
  title, walletAddress, build, onClose,
}: {
  title?: string;
  walletAddress: string;
  build: (showWallet: boolean) => Promise<HTMLCanvasElement | null>;
  onClose: () => void;
}) {
  const [showWallet, setShowWallet] = useState(true);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Rebuild the preview whenever the wallet toggle flips.
  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    build(showWallet).then((cv) => {
      if (cancelled || !cv) return;
      setPreview(cv.toDataURL('image/png'));
    });
    return () => { cancelled = true; };
  }, [showWallet, build]);

  const fileName = `${(title || 'bulkstats-chart').replace(/\s+/g, '-').toLowerCase()}.png`;

  const withBlob = async (fn: (blob: Blob) => void | Promise<void>) => {
    setBusy(true);
    try {
      const cv = await build(showWallet);
      if (!cv) return;
      const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/png'));
      if (blob) await fn(blob);
    } finally { setBusy(false); }
  };

  const doDownload = () => withBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
  });

  const doCopy = () => withBlob(async (blob) => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard image unsupported — ignore */ }
  });

  const doShareX = () => withBlob(async (blob) => {
    // X can't accept an image via URL, so copy it for the user to paste, then
    // open the composer with prefilled text.
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); } catch { /* ignore */ }
    const text = `${title || 'My BULK stats'} — via bulkstats.com`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
          <span className="text-sm font-semibold text-[var(--text-primary)]">Share {title || 'chart'}</span>
          <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Preview */}
        <div className="p-4">
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] overflow-hidden min-h-[160px] flex items-center justify-center">
            {preview
              ? <img src={preview} alt="Share preview" className="w-full h-auto block" />
              : <span className="text-xs text-[var(--text-tertiary)] py-10">Rendering preview…</span>}
          </div>

          {/* Wallet toggle */}
          <button
            onClick={() => setShowWallet((v) => !v)}
            className="mt-3 w-full flex items-center justify-between px-1 py-1.5"
          >
            <span className="text-sm text-[var(--text-secondary)]">Show wallet address</span>
            <span className={`relative w-9 h-5 rounded-full transition-colors ${showWallet ? 'bg-[var(--accent)]' : 'bg-[var(--bg-secondary-20)]'}`}>
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${showWallet ? 'translate-x-4' : ''}`} />
            </span>
          </button>
        </div>

        {/* Actions */}
        <div className="px-4 pb-4 grid grid-cols-3 gap-2">
          <button onClick={doShareX} disabled={busy} className="flex items-center justify-center gap-1.5 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] text-sm text-[var(--text-primary)] hover:bg-[var(--bg-muted)] transition-colors disabled:opacity-50">
            <Share2 className="w-3.5 h-3.5" /> X
          </button>
          <button onClick={doCopy} disabled={busy} className="flex items-center justify-center gap-1.5 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] text-sm text-[var(--text-primary)] hover:bg-[var(--bg-muted)] transition-colors disabled:opacity-50">
            {copied ? <Check className="w-3.5 h-3.5 text-bulk-green" /> : <Copy className="w-3.5 h-3.5" />} Copy
          </button>
          <button onClick={doDownload} disabled={busy} className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[var(--accent)] text-[var(--accent-text)] text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
            <Download className="w-3.5 h-3.5" /> Save
          </button>
        </div>
      </div>
    </div>
  );
}
