'use client';

// ---------------------------------------------------------------------------
// TradeJourneyChart — the headline "progress line" of a trade's PnL.
//
// Plots total PnL (realized + unrealized) across the life of one position.
// The fill/stroke are split at the zero line: green while the trade is up,
// red while it's under water, so the shape tells the whole story at a glance.
// Lifecycle moments (open / add / reduce / close) are dropped onto the curve
// as labelled dots at the PnL they were sitting at when they happened.
// ---------------------------------------------------------------------------

import { useMemo } from 'react';
import {
  Area,
  ComposedChart,
  ReferenceLine,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface JourneyPoint { t: number; pnl: number; }
export interface JourneyMarker {
  t: number;
  pnl: number;
  label: string;
  /** 'in' = opened/added (building), 'out' = reduced/closed (realizing). */
  tone: 'in' | 'out';
}

const fmtUsd = (n: number): string => {
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (a >= 1_000_000) return `${s}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${s}$${(a / 1_000).toFixed(1)}K`;
  return `${s}$${a.toFixed(a < 100 ? 2 : 0)}`;
};

const fmtTime = (ms: number): string =>
  new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function TradeJourneyChart({
  curve,
  markers = [],
}: {
  curve: JourneyPoint[];
  markers?: JourneyMarker[];
}) {
  // Zero-split gradient offset: the fraction of the vertical range that sits
  // above zero. recharts paints the gradient top→bottom, so everything above
  // `off` is green, below is red.
  const off = useMemo(() => {
    if (curve.length === 0) return 1;
    let max = 0;
    let min = 0;
    for (const p of curve) { if (p.pnl > max) max = p.pnl; if (p.pnl < min) min = p.pnl; }
    if (max <= 0) return 0;
    if (min >= 0) return 1;
    return max / (max - min);
  }, [curve]);

  if (curve.length < 2) {
    return (
      <div className="flex h-full min-h-[160px] items-center justify-center text-[12px] text-[var(--role-content-subtle)]">
        Not enough price history to chart this trade.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={curve} margin={{ top: 12, right: 12, bottom: 4, left: 4 }}>
        <defs>
          <linearGradient id="journeyFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset={0} stopColor="var(--pos)" stopOpacity={0.35} />
            <stop offset={off} stopColor="var(--pos)" stopOpacity={0.04} />
            <stop offset={off} stopColor="var(--neg)" stopOpacity={0.04} />
            <stop offset={1} stopColor="var(--neg)" stopOpacity={0.35} />
          </linearGradient>
          <linearGradient id="journeyStroke" x1="0" y1="0" x2="0" y2="1">
            <stop offset={off} stopColor="var(--pos)" />
            <stop offset={off} stopColor="var(--neg)" />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          tickFormatter={(t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          tick={{ fontSize: 10, fill: 'var(--role-content-subtle)' }}
          tickLine={false}
          axisLine={{ stroke: 'var(--role-line-subtle)' }}
          minTickGap={44}
        />
        <YAxis
          tickFormatter={fmtUsd}
          tick={{ fontSize: 10, fill: 'var(--role-content-subtle)' }}
          tickLine={false}
          axisLine={false}
          width={56}
          domain={['auto', 'auto']}
        />
        <ReferenceLine y={0} stroke="var(--role-content-subtle)" strokeDasharray="3 3" strokeOpacity={0.6} />
        <Tooltip
          cursor={{ stroke: 'var(--role-line)', strokeWidth: 1 }}
          contentStyle={{
            background: 'var(--bg-overlay)',
            border: '1px solid var(--role-line)',
            borderRadius: 8,
            fontSize: 12,
            padding: '6px 10px',
          }}
          labelFormatter={(t) => fmtTime(Number(t))}
          formatter={(v: number) => [fmtUsd(v), 'PnL']}
        />
        <Area
          type="monotone"
          dataKey="pnl"
          stroke="url(#journeyStroke)"
          strokeWidth={2}
          fill="url(#journeyFill)"
          isAnimationActive
          animationDuration={650}
          dot={false}
          activeDot={{ r: 3, fill: 'var(--accent)' }}
        />
        {markers.map((m, i) => (
          <ReferenceDot
            key={`${m.t}-${i}`}
            x={m.t}
            y={m.pnl}
            r={4}
            fill={m.tone === 'in' ? 'var(--accent)' : 'var(--role-content)'}
            stroke="var(--bg-overlay)"
            strokeWidth={2}
            isFront
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
