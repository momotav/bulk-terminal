'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export interface Series { key: string; label: string; color: string; values: (number | null)[]; dashed?: boolean }

/**
 * A light multi-line time chart: shared x (ms timestamps), one y-axis, hover line
 * with a frosted readout. Plain SVG so theme colours (CSS vars) always resolve.
 */
export function SeriesChart({ times, series, height = 240, format = (v) => v.toFixed(2), zeroLine = false, emptyText = 'No data yet', animKey }: {
  times: number[]; series: Series[]; height?: number; format?: (v: number) => string; zeroLine?: boolean; emptyText?: string;
  /** Change it (market, range…) to fade the chart and draw its lines in again. Data refreshes don't. */
  animKey?: string;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(800);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const padL = 8, padR = 56, padT = 10, padB = 24;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
  const { lo, hi } = useMemo(() => {
    if (!all.length) return { lo: 0, hi: 1 };
    let a = Math.min(...all), b = Math.max(...all);
    if (zeroLine) { a = Math.min(a, 0); b = Math.max(b, 0); }
    if (a === b) { a -= Math.abs(a) * 0.1 || 1; b += Math.abs(b) * 0.1 || 1; }
    const pad = (b - a) * 0.08;
    return { lo: a - pad, hi: b + pad };
  }, [all.join(','), zeroLine]); // eslint-disable-line react-hooks/exhaustive-deps

  if (times.length < 2 || !all.length) {
    return <div ref={box} className="flex items-center justify-center text-center text-[13px] text-[var(--text-tertiary)]" style={{ height }}>{emptyText}</div>;
  }
  const t0 = times[0], t1 = times[times.length - 1];
  const x = (t: number) => padL + ((t - t0) / Math.max(1, t1 - t0)) * (w - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (height - padT - padB);
  const path = (vals: (number | null)[]) => {
    let d = '', pen = false;
    vals.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(times[i]).toFixed(1)},${y(v).toFixed(1)} `; pen = true;
    });
    return d;
  };
  const ticks = [0, 0.5, 1].map((f) => lo + (hi - lo) * (0.1 + 0.8 * f));
  const span = t1 - t0;
  const fmtT = (t: number) => new Date(t).toLocaleString('en-US', span > 3 * 86_400_000 ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const idx = hover;

  return (
    <div ref={box} className="relative select-none" style={{ height }}
      onMouseLeave={() => setHover(null)}
      onMouseMove={(e) => {
        const r = box.current?.getBoundingClientRect(); if (!r) return;
        const t = t0 + ((e.clientX - r.left - padL) / Math.max(1, w - padL - padR)) * (t1 - t0);
        let best = 0, bd = Infinity;
        times.forEach((tt, i) => { const d = Math.abs(tt - t); if (d < bd) { bd = d; best = i; } });
        setHover(best);
      }}>
      <svg width={w} height={height} className="block">
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={w - padR} y1={y(v)} y2={y(v)} strokeDasharray="2 5" style={{ stroke: 'var(--border-color)' }} />
            <text x={w - padR + 6} y={y(v) + 3} fontSize={10} style={{ fill: 'var(--text-tertiary)' }}>{format(v)}</text>
          </g>
        ))}
        {zeroLine && lo < 0 && hi > 0 && <line x1={padL} x2={w - padR} y1={y(0)} y2={y(0)} style={{ stroke: 'var(--text-tertiary)', opacity: 0.5 }} />}
        <g key={animKey ?? 'static'} className="animate-[chart-fade_.35s_ease-out]">
          {series.map((s) => s.dashed
            // Dashed lines keep their dashes (draw-in uses the dash array), so they fade in instead.
            ? <path key={s.key} d={path(s.values)} fill="none" strokeWidth={2} strokeLinejoin="round" strokeDasharray="5 4" style={{ stroke: s.color }} />
            : <path key={s.key} d={path(s.values)} pathLength={1} className={animKey ? 'series-draw' : undefined} fill="none" strokeWidth={2} strokeLinejoin="round" style={{ stroke: s.color }} />)}
        </g>
        <text x={padL} y={height - 6} fontSize={10} style={{ fill: 'var(--text-tertiary)' }}>{fmtT(t0)}</text>
        <text x={w - padR} y={height - 6} fontSize={10} textAnchor="end" style={{ fill: 'var(--text-tertiary)' }}>{fmtT(t1)}</text>
        {idx !== null && (
          <g>
            <line x1={x(times[idx])} x2={x(times[idx])} y1={padT} y2={height - padB} style={{ stroke: 'var(--text-primary)', opacity: 0.3 }} />
            {series.map((s) => { const v = s.values[idx]; return v === null || !Number.isFinite(v) ? null : <circle key={s.key} cx={x(times[idx])} cy={y(v)} r={3.5} strokeWidth={2} style={{ fill: 'var(--bg-muted)', stroke: s.color }} />; })}
          </g>
        )}
      </svg>
      {idx !== null && (
        <div className="liq-tip pointer-events-none absolute top-2 z-10 rounded-lg px-3 py-2 text-[12px]"
          style={{ left: Math.min(Math.max(0, x(times[idx]) + (x(times[idx]) > w / 2 ? -200 : 14)), w - 190), width: 186 }}>
          <div className="mb-1 text-[11px] text-[var(--text-tertiary)]">{new Date(times[idx]).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</div>
          {series.map((s) => { const v = s.values[idx]; return (
            <div key={s.key} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-[var(--text-secondary)]"><span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.label}</span>
              <span className="tabular-nums text-[var(--text-primary)]">{v === null || !Number.isFinite(v) ? '—' : format(v)}</span>
            </div>
          ); })}
        </div>
      )}
    </div>
  );
}

export function Legend({ series }: { series: Pick<Series, 'key' | 'label' | 'color'>[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
      {series.map((s) => <span key={s.key} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.label}</span>)}
    </div>
  );
}
