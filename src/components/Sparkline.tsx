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
  const rawId = useId();
  const gradId = `g${rawId.replace(/[:]/g, '')}`;
  const dotsId = `d${rawId.replace(/[:]/g, '')}`;
  const clipId = `c${rawId.replace(/[:]/g, '')}`;
  const pathRef = useRef<SVGPathElement>(null);
  const [len, setLen] = useState(0);

  const { line, area, ok, end } = useMemo(() => {
    const pts = data.filter((n) => Number.isFinite(n));
    if (pts.length < 2) return { line: '', area: '', ok: false, end: null as null | [number, number] };
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const span = max - min || 1;
    // Vertical inset so the peak/trough — and the end dot — never clip the edges.
    const pad = 4;
    const h = height - pad * 2;
    const step = width / (pts.length - 1);
    const xy = pts.map((v, i) => [i * step, pad + h - ((v - min) / span) * h] as const);
    const line = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const area = `${line} L${width},${height} L0,${height} Z`;
    const last = xy[xy.length - 1];
    // Pull the end dot in a hair so its halo doesn't get clipped by the viewBox.
    return { line, area, ok: true, end: [Math.min(last[0], width - 3), last[1]] as [number, number] };
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
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="60%" stopColor={color} stopOpacity={0.08} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
        {/* Fine diagonal engraved hatch — the filled area reads like a printed
            financial chart (etched, editorial) rather than a flat wash. A hatch,
            not a dot-grid, so it's our own texture, not a borrowed one. Clipped
            to the area so it never spills. */}
        <pattern id={dotsId} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="4" stroke={color} strokeWidth="0.6" strokeOpacity={0.2} />
        </pattern>
        <clipPath id={clipId}>
          <path d={area} />
        </clipPath>
      </defs>
      <path d={area} fill={`url(#${gradId})`} className="spark-area" />
      <rect x={0} y={0} width={width} height={height} fill={`url(#${dotsId})`} clipPath={`url(#${clipId})`} className="spark-area" />
      <path
        ref={pathRef}
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="spark-line"
        style={len ? ({ '--spark-len': len } as React.CSSProperties) : undefined}
      />
      {/* End marker at the current value — a soft halo + a solid dot. This is
          what makes a sparkline read as finished rather than a stray line. It
          fades in after the line finishes drawing. */}
      {end && (
        <g className="spark-end">
          <circle cx={end[0]} cy={end[1]} r={4} fill={color} opacity={0.18} />
          <circle cx={end[0]} cy={end[1]} r={2} fill={color} />
        </g>
      )}
    </svg>
  );
}
