'use client';

import { memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatCompact } from '@/lib/api';
import { smoothCurve, type PnlPoint } from '@/lib/walletMetrics';

// Top clears ChartFrame's export buttons, which sit over the plot's corner.
const PAD = { top: 44, right: 58, bottom: 24, left: 0 };
const LINE_BLEED = 10;

export interface PnlHover { point: PnlPoint }

const axisMoney = (v: number) => `${v < 0 ? '−' : v > 0 ? '+' : ''}$${formatCompact(Math.abs(v)).replace(/\.0+(?=[A-Za-z]*$)/, '')}`;

const HOUR = 3_600_000;
const TICK_STEPS = [1 / 60, 2 / 60, 5 / 60, 10 / 60, 15 / 60, 30 / 60, 1, 2, 3, 4, 6, 12, 24, 48, 72, 168, 336, 720, 1440, 2160].map((n) => n * HOUR);

/** Round tick values covering [min, max], always including zero. */
function niceTicks(min: number, max: number, count: number): number[] {
  const lo = Math.min(min, 0);
  const hi = Math.max(max, 0);
  const raw = (hi - lo || 1) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v < hi + step; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : v);
  return ticks;
}

/** Monotone cubic through the points: soft corners that never overshoot the data. */
function monotonePath(xy: [number, number][]): string {
  const n = xy.length;
  const slope = (i: number) => (xy[i + 1][1] - xy[i][1]) / (xy[i + 1][0] - xy[i][0] || 1);
  const tangent = xy.map((_, i) => {
    if (i === 0) return slope(0);
    if (i === n - 1) return slope(n - 2);
    const a = slope(i - 1);
    const b = slope(i);
    return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  });
  let d = `M${xy[0][0].toFixed(1)} ${xy[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = (xy[i + 1][0] - xy[i][0]) / 3;
    d += `C${(xy[i][0] + h).toFixed(1)} ${(xy[i][1] + tangent[i] * h).toFixed(1)} ${(xy[i + 1][0] - h).toFixed(1)} ${(xy[i + 1][1] - tangent[i + 1] * h).toFixed(1)} ${xy[i + 1][0].toFixed(1)} ${xy[i + 1][1].toFixed(1)}`;
  }
  return d;
}

/**
 * PnL line split green and red at zero, filled back to the zero line with a tint
 * and an engraved hatch that both fade out as they reach it.
 *
 * The drawn line is smoothed; hover reports the real figure, not the smoothed one.
 * Hand-drawn SVG so colours stay CSS variables, which recharts' SVG attributes can
 * fail to resolve. Hover is reported up to the panel's headline, no floating tooltip,
 * and only when the figure changes. The line and dot are moved directly, so a mouse
 * move redraws nothing: slow frames stall hover, see FreeChartCursor.
 */
export const PnlChart = memo(function PnlChart({ points, onHover, ariaLabel }: {
  points: PnlPoint[];
  onHover: (hover: PnlHover | null) => void;
  ariaLabel: string;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const cursorLine = useRef<SVGLineElement | null>(null);
  const dot = useRef<SVGGElement | null>(null);
  const shown = useRef(-1);
  const touchedAt = useRef(0);
  const id = useId().replace(/:/g, '');

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

    const line = useMemo(() => smoothCurve(points), [points]);

  const { w, h } = size;
  const plotW = Math.max(0, w - PAD.left - PAD.right);
  const plotH = Math.max(0, h - PAD.top - PAD.bottom);

  const t0 = points[0]?.t ?? 0;
  const t1 = points[points.length - 1]?.t ?? 1;
  const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0 || 1)) * plotW;

  const vals = line.map((p) => p.v);
  const vMin = Math.min(...vals);
  const vMax = Math.max(...vals);
  // Nothing moved: a level line through the middle, with no colour for gain or loss.
  const flat = vMax === vMin;
  const yTicks = flat ? [-1, 0, 1] : niceTicks(vMin, vMax, h < 340 ? 3 : 4);
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];
  const y = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
  const zero = y(0);
  const zeroAt = `${(((zero - PAD.top) / (plotH || 1)) * 100).toFixed(2)}%`;
  // Neutral in a thin band around zero: a stretch sitting on it is neither gain nor loss.
  // Its gradient overshoots the plot by LINE_BLEED, or the band clips when zero is the top edge.
  const offsetAt = (px: number) => `${(((zero + px - PAD.top + LINE_BLEED) / (plotH + 2 * LINE_BLEED || 1)) * 100).toFixed(2)}%`;

  const curve = monotonePath(line.map((p) => [x(p.t), y(p.v)]));
  const area = `${curve}L${x(t1).toFixed(1)} ${zero.toFixed(1)}L${x(t0).toFixed(1)} ${zero.toFixed(1)}Z`;

  // Ticks on round local times, so the gap between dates stays even.
  const xStep = TICK_STEPS.find((step) => (t1 - t0) / step <= (w < 480 ? 3 : 7)) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const tickLabel = (t: number) => new Date(t).toLocaleString('en-US', xStep < 24 * HOUR ? { hour: '2-digit', minute: '2-digit', hour12: false } : { month: 'short', day: 'numeric' });
  const tzOffset = new Date(t0).getTimezoneOffset() * 60_000;
  const xTicks: number[] = [];
  for (let t = Math.ceil((t0 - tzOffset) / xStep) * xStep + tzOffset; t <= t1; t += xStep) {
    // A clock change shifts midnight by an hour, which would print the day before.
    const tick = xStep >= 24 * HOUR ? new Date(t + 12 * HOUR).setHours(0, 0, 0, 0) : t;
    if (tick >= t0 && x(tick) <= PAD.left + plotW - 16) xTicks.push(tick);
  }

  /** The drawn line's height at any moment, between its points. */
  const lineAt = (t: number) => {
    const i = Math.max(1, line.findIndex((p) => p.t >= t));
    const a = line[i - 1];
    const b = line[i] ?? a;
    return a.v + (b.v - a.v) * Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t || 1)));
  };

  const track = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || !plotW) return;
    const t = Math.min(t1, Math.max(t0, t0 + ((clientX - rect.left - PAD.left) / plotW) * (t1 - t0)));
    let lo = 0;
    let hi = points.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (points[mid].t <= t) lo = mid; else hi = mid;
    }
    // The latest figure at or before the mouse: PnL holds its level between closes.
    const i = t >= points[hi].t ? hi : lo;
    // The dot rides the drawn line under the mouse; the headline reads the real figure.
    moveMarker(t, lineAt(t));
    cursorLine.current?.setAttribute('x1', String(x(t)));
    cursorLine.current?.setAttribute('x2', String(x(t)));
    cursorLine.current?.style.setProperty('display', 'block');
    if (i !== shown.current) {
      shown.current = i;
      onHover({ point: points[i] });
    }
  };
  const clear = () => {
    shown.current = -1;
    cursorLine.current?.style.setProperty('display', 'none');
    if (end) moveMarker(end.t, end.v);
    onHover(null);
  };

  const end = line[line.length - 1];
  const markerTone = (v: number) => (flat ? 'var(--role-content-muted)' : v < 0 ? 'var(--neg)' : 'var(--pos)');
  const moveMarker = (t: number, v: number) => {
    const g = dot.current;
    if (!g) return;
    g.setAttribute('transform', `translate(${x(t)} ${y(v)})`);
    g.style.setProperty('fill', markerTone(v));
  };
  const text = { fill: 'var(--text-tertiary)', fontSize: 11 } as const;
  const stop = (color: string, opacity: number) => ({ stopColor: color, stopOpacity: opacity });

  return (
    // Mouse and touch events, not pointer events: the recharts charts, which hover
    // fine everywhere, use these, and pointer moves didn't arrive for one user until
    // they pressed the button. A tap leaves its reading up, as recharts tooltips do.
    <div ref={box} className="absolute inset-0 select-none" style={{ touchAction: 'pan-y' }}
      onMouseMove={(e) => track(e.clientX)} onMouseDown={(e) => track(e.clientX)}
      // Phones follow a tap with emulated mouse events, a leave among them; that one isn't the user leaving.
      onMouseLeave={() => { if (Date.now() - touchedAt.current > 800) clear(); }}
      onTouchStart={(e) => { touchedAt.current = Date.now(); track(e.touches[0].clientX); }}
      onTouchMove={(e) => { touchedAt.current = Date.now(); track(e.touches[0].clientX); }}>
      {w > 0 && h > 0 && line.length > 1 && (
        <svg width={w} height={h} role="img" aria-label={ariaLabel} className="block">
          <defs>
            {/* Hard stops at zero split the line's colour without a second path. */}
            <linearGradient id={`${id}line`} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={PAD.top - LINE_BLEED} y2={PAD.top + plotH + LINE_BLEED}>
              <stop offset={offsetAt(-1.5)} style={stop('var(--pos)', 1)} />
              <stop offset={offsetAt(-1.5)} style={stop('var(--role-content-muted)', 1)} />
              <stop offset={offsetAt(1.5)} style={stop('var(--role-content-muted)', 1)} />
              <stop offset={offsetAt(1.5)} style={stop('var(--neg)', 1)} />
            </linearGradient>
            <linearGradient id={`${id}tint`} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={PAD.top} y2={PAD.top + plotH}>
              <stop offset="0%" style={stop('var(--pos)', 0.26)} />
              <stop offset={zeroAt} style={stop('var(--pos)', 0.02)} />
              <stop offset={zeroAt} style={stop('var(--neg)', 0.02)} />
              <stop offset="100%" style={stop('var(--neg)', 0.26)} />
            </linearGradient>
            <linearGradient id={`${id}fade`} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={PAD.top} y2={PAD.top + plotH}>
              <stop offset="0%" stopColor="#fff" />
              <stop offset={zeroAt} stopColor="#000" />
              <stop offset="100%" stopColor="#fff" />
            </linearGradient>
            <mask id={`${id}mask`} maskUnits="userSpaceOnUse" x={0} y={0} width={w} height={h}>
              <rect x={0} y={0} width={w} height={h} fill={`url(#${id}fade)`} />
            </mask>
            {(['pos', 'neg'] as const).map((tone) => (
              <pattern key={tone} id={`${id}${tone}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" style={{ stroke: `var(--${tone})`, strokeWidth: 1, strokeOpacity: 0.55 }} />
              </pattern>
            ))}
            <clipPath id={`${id}up`}><rect x={0} y={0} width={w} height={zero} /></clipPath>
            <clipPath id={`${id}down`}><rect x={0} y={zero} width={w} height={h} /></clipPath>
          </defs>

          {yTicks.filter((v) => !flat || v === 0).map((v) => (
            <g key={v}>
              {v !== 0 && <line x1={PAD.left} x2={PAD.left + plotW} y1={y(v)} y2={y(v)} style={{ stroke: 'var(--border-color)', strokeOpacity: 0.45 }} />}
              <text x={PAD.left + plotW + 10} y={y(v) + 4} style={text} className="tabular-nums">{axisMoney(v)}</text>
            </g>
          ))}

          {!flat && (
            <>
              <path d={area} style={{ fill: `url(#${id}tint)` }} />
              <g mask={`url(#${id}mask)`}>
                <path d={area} clipPath={`url(#${id}up)`} style={{ fill: `url(#${id}pos)` }} />
                <path d={area} clipPath={`url(#${id}down)`} style={{ fill: `url(#${id}neg)` }} />
              </g>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={zero} y2={zero} strokeDasharray="3 4" style={{ stroke: 'var(--role-content-muted)', strokeOpacity: 0.5 }} />
            </>
          )}
          <path d={curve} style={{ fill: 'none', stroke: flat ? 'var(--role-content-muted)' : `url(#${id}line)`, strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' }} />

          {xTicks.map((t) => (
            <text key={t} x={x(t)} y={h - 6} textAnchor={x(t) < PAD.left + 20 ? 'start' : 'middle'} style={text}>{tickLabel(t)}</text>
          ))}

        </svg>
      )}
      {/* Hover marks live on their own layer, so moving them never redraws the chart. */}
      {w > 0 && h > 0 && line.length > 1 && (
        <svg width={w} height={h} aria-hidden className="absolute inset-0 pointer-events-none">
          <line ref={cursorLine} y1={PAD.top} y2={PAD.top + plotH} style={{ display: 'none', stroke: 'var(--role-content-muted)', strokeOpacity: 0.5 }} />
          {end && (
            <g ref={dot} transform={`translate(${x(end.t)} ${y(end.v)})`} style={{ fill: markerTone(end.v) }}>
              <circle r={8} style={{ fillOpacity: 0.22 }} />
              <circle r={3.5} />
            </g>
          )}
        </svg>
      )}
    </div>
  );
});
