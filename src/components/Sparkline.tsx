'use client';

// Sparkline — a tiny inline trend line for the dashboard KPI cards.
//
// Shows the SHAPE of a metric's recent history (hourly volume/OI, daily
// traders/liquidations) beside its headline number, filling the space a bare
// label+value leaves empty. Deliberately neutral in colour: these are magnitude
// metrics (volume, OI, traders, liq value), not directional P&L, so a red/green
// verdict would be dishonest — the line just traces the real values.
//
// Motion: the line draws itself left→right on mount (stroke-dashoffset) and the
// area fades up under it. One authored moment, keyed to real data — not decor.
// Falls back to nothing when there's too little data to trace a line.

import { useEffect, useId, useMemo, useRef, useState } from 'react';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  /** Palette colour for the stroke + gradient. Defaults to the accent. */
  color?: string;
  className?: string;
}

export function Sparkline({ data, width = 132, height = 40, color = 'var(--accent)', className }: SparklineProps) {
  const gradId = useId();
  const pathRef = useRef<SVGPathElement>(null);
  const [len, setLen] = useState(0);

  const { line, area, ok } = useMemo(() => {
    const pts = data.filter((n) => Number.isFinite(n));
    if (pts.length < 2) return { line: '', area: '', ok: false };
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const span = max - min || 1;
    // Small vertical inset so the peak/trough don't touch the edges.
    const pad = 3;
    const h = height - pad * 2;
    const step = width / (pts.length - 1);
    const xy = pts.map((v, i) => [i * step, pad + h - ((v - min) / span) * h] as const);
    const line = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const area = `${line} L${width},${height} L0,${height} Z`;
    return { line, area, ok: true };
  }, [data, width, height]);

  // Measure the drawn path length so the draw-on animation covers exactly it.
  useEffect(() => {
    if (pathRef.current) setLen(pathRef.current.getTotalLength());
  }, [line]);

  if (!ok) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.18} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} className="spark-area" />
      <path
        ref={pathRef}
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="spark-line"
        style={len ? ({ '--spark-len': len } as React.CSSProperties) : undefined}
      />
    </svg>
  );
}
