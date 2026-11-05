'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatCompact } from '@/lib/api';
import { smoothCurve, type PnlPoint } from '@/lib/walletMetrics';

// Top clears ChartFrame's export buttons, which sit over the plot's corner.
const PAD = { top: 44, right: 58, bottom: 24, left: 0 };

export interface PnlHover { point: PnlPoint }

const axisMoney = (v: number) => `${v < 0 ? '−' : v > 0 ? '+' : ''}$${formatCompact(Math.abs(v)).replace(/\.0+(?=[A-Za-z]*$)/, '')}`;

const HOUR = 3_600_000;
const TICK_STEPS = [1, 2, 3, 4, 6, 12, 24, 48, 72, 168, 336, 720, 1440, 2160].map((n) => n * HOUR);

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
 * fail to resolve. Hover is reported up to the panel's headline, no floating tooltip.
 */
export function PnlChart({ points, onHover, ariaLabel }: {
  points: PnlPoint[];
  onHover: (hover: PnlHover | null) => void;
  ariaLabel: string;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [active, setActive] = useState<number | null>(null);
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

  // The data refreshes on a timer; a stale index must not outlive the range it came from.
  useEffect(() => { setActive(null); onHover(null); }, [points.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const line = useMemo(() => smoothCurve(points), [points]);

  const { w, h } = size;
  const plotW = Math.max(0, w - PAD.left - PAD.right);
  const plotH = Math.max(0, h - PAD.top - PAD.bottom);

  const t0 = points[0]?.t ?? 0;
  const t1 = points[points.length - 1]?.t ?? 1;
  const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0 || 1)) * plotW;

  const vals = line.map((p) => p.v);
  const yTicks = niceTicks(Math.min(...vals), Math.max(...vals), h < 340 ? 3 : 4);
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];
  const y = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
  const zero = y(0);
  const zeroAt = `${(((zero - PAD.top) / (plotH || 1)) * 100).toFixed(2)}%`;

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

  /** The line's sample nearest a time. */
  const sampleAt = (t: number) => line.reduce((best, p) => (Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best), line[0]);

  const track = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || !plotW) return;
    const t = t0 + ((clientX - rect.left - PAD.left) / plotW) * (t1 - t0);
    let lo = 0;
    let hi = points.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (points[mid].t <= t) lo = mid; else hi = mid;
    }
    const i = t - points[lo].t <= points[hi].t - t ? lo : hi;
    setActive(i);
    onHover({ point: points[i] });
  };
  const clear = () => { setActive(null); onHover(null); };

  const hovered = active !== null ? points[active] : null;
  const marker = hovered ? sampleAt(hovered.t) : line[line.length - 1];
  const markerColor = marker && marker.v < 0 ? 'var(--neg)' : 'var(--pos)';
  const text = { fill: 'var(--text-tertiary)', fontSize: 11 } as const;
  const stop = (color: string, opacity: number) => ({ stopColor: color, stopOpacity: opacity });

  return (
    <div ref={box} className="absolute inset-0 select-none" style={{ touchAction: 'pan-y' }}
      onPointerDown={(e) => track(e.clientX)} onPointerMove={(e) => track(e.clientX)} onPointerLeave={clear} onPointerCancel={clear}>
      {w > 0 && h > 0 && line.length > 1 && (
        <svg width={w} height={h} role="img" aria-label={ariaLabel} className="block">
          <defs>
            {/* One hard stop at zero splits the line's colour without a second path. */}
            <linearGradient id={`${id}line`} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={PAD.top} y2={PAD.top + plotH}>
              <stop offset={zeroAt} style={stop('var(--pos)', 1)} />
              <stop offset={zeroAt} style={stop('var(--neg)', 1)} />
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

          {yTicks.map((v) => (
            <g key={v}>
              {v !== 0 && <line x1={PAD.left} x2={PAD.left + plotW} y1={y(v)} y2={y(v)} style={{ stroke: 'var(--border-color)', strokeOpacity: 0.45 }} />}
              <text x={PAD.left + plotW + 10} y={y(v) + 4} style={text} className="tabular-nums">{axisMoney(v)}</text>
            </g>
          ))}

          <path d={area} style={{ fill: `url(#${id}tint)` }} />
          <g mask={`url(#${id}mask)`}>
            <path d={area} clipPath={`url(#${id}up)`} style={{ fill: `url(#${id}pos)` }} />
            <path d={area} clipPath={`url(#${id}down)`} style={{ fill: `url(#${id}neg)` }} />
          </g>

          <line x1={PAD.left} x2={PAD.left + plotW} y1={zero} y2={zero} strokeDasharray="3 4" style={{ stroke: 'var(--role-content-muted)', strokeOpacity: 0.5 }} />
          <path d={curve} style={{ fill: 'none', stroke: `url(#${id}line)`, strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' }} />

          {xTicks.map((t) => (
            <text key={t} x={x(t)} y={h - 6} textAnchor={x(t) < PAD.left + 20 ? 'start' : 'middle'} style={text}>{tickLabel(t)}</text>
          ))}

          {hovered && <line x1={x(hovered.t)} x2={x(hovered.t)} y1={PAD.top} y2={PAD.top + plotH} style={{ stroke: 'var(--role-content-muted)', strokeOpacity: 0.5 }} />}
          {marker && (
            <>
              <circle cx={x(marker.t)} cy={y(marker.v)} r={8} style={{ fill: markerColor, fillOpacity: 0.22 }} />
              <circle cx={x(marker.t)} cy={y(marker.v)} r={3.5} style={{ fill: markerColor }} />
            </>
          )}
        </svg>
      )}
    </div>
  );
}
