'use client';

// Fees in dollars against 14-day volume, for the calculator's settings. A tier applies
// to the whole volume, so the line drops where a tier starts: trading a little more
// can cost less. Hyperliquid's base schedule runs alongside for crypto.

import { useMemo, useRef } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn, formatCompact, type FeeTierRow } from '@/lib/api';
import { feeOn, tierIndex } from '@/lib/fees';
import { HL_TIERS } from '@/components/FeeComparison';

const SAMPLES = 160;
const usd = (n: number) => `${n < 0 ? '−' : ''}$${formatCompact(Math.abs(n)).replace(/\.0+(?=[A-Za-z]*$)/, '')}`;

/** A round axis end a bit past both the user's volume and the next tier. */
function axisEnd(volume: number, nextThreshold: number | null): number {
  const want = Math.max(volume * 1.6, (nextThreshold ?? 0) * 1.25, 2e6);
  const mag = 10 ** Math.floor(Math.log10(want));
  return ([1, 2, 2.5, 5, 10].find((m) => m * mag >= want) ?? 10) * mag;
}

export function FeeCurve({ tiers, makerBpsAdj, takerShare, volume, onPick, compare, className }: {
  tiers: FeeTierRow[];
  /** Maker rebate (negative bps) added to every tier's maker rate. */
  makerBpsAdj: number;
  takerShare: number;
  volume: number;
  onPick: (v: number) => void;
  compare: boolean;
  className?: string;
}) {
  const next = tiers[tierIndex(tiers, volume) + 1] ?? null;
  // Keep the axis still while the volume moves inside it (a click must not rescale the
  // chart under the cursor); refit only when the volume nears the edge or shrinks far below it.
  const endRef = useRef(0);
  if (!endRef.current || volume > endRef.current * 0.9 || volume < endRef.current * 0.05) endRef.current = axisEnd(volume, next?.thresholdVolume ?? null);
  const end = endRef.current;

  const data = useMemo(() => {
    const cost = (t: FeeTierRow[], v: number, adj: number) => { const r = t[tierIndex(t, v)]; return feeOn(v, takerShare, r.takerBps, r.makerBps + adj); };
    const xs = new Set<number>();
    for (let k = 0; k <= SAMPLES; k++) xs.add((end * k) / SAMPLES);
    // Both sides of every threshold, so the drop is drawn straight down.
    for (const t of [...tiers, ...(compare ? HL_TIERS : [])]) {
      if (t.thresholdVolume > 0 && t.thresholdVolume <= end) { xs.add(t.thresholdVolume - end / 1e6); xs.add(t.thresholdVolume); }
    }
    return Array.from(xs).sort((a, b) => a - b).map((x) => ({
      x, bulk: cost(tiers, x, makerBpsAdj), ...(compare ? { hl: cost(HL_TIERS, x, 0) } : {}),
    }));
  }, [tiers, makerBpsAdj, takerShare, end, compare]);

  const r = tiers[tierIndex(tiers, volume)];
  const you = feeOn(volume, takerShare, r.takerBps, r.makerBps + makerBpsAdj);
  const tick = { fill: 'var(--text-tertiary)', fontSize: 11 };

  return (
    <div className={cn('flex flex-col rounded-lg border border-[var(--border-color)] px-3 pt-3 pb-1', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="text-[13px] text-[var(--text-secondary)]">What you'd pay as you trade more. Click the chart to set a volume.</div>
        <div className="flex items-center gap-4 text-[12px] text-[var(--text-secondary)]">
          <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-[var(--accent)]" />BULK</span>
          {compare && <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-[var(--text-tertiary)]" />Hyperliquid</span>}
        </div>
      </div>
      <div className="relative flex-1 min-h-[220px] cursor-crosshair">
        <div className="absolute inset-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 14, right: 12, bottom: 0, left: 0 }}
            onClick={(e) => { const x = Number(e?.activeLabel); if (Number.isFinite(x) && x >= 0) onPick(Math.round(x / 1000) * 1000); }}>
            <CartesianGrid vertical={false} stroke="var(--role-line-subtle)" strokeOpacity={0.5} />
            <XAxis dataKey="x" type="number" domain={[0, end]} tick={tick} axisLine={false} tickLine={false} tickCount={6}
              tickFormatter={(x) => usd(Number(x))} />
            <YAxis tick={tick} axisLine={false} tickLine={false} width={56} tickFormatter={(y) => usd(Number(y))} />
            {tiers.filter((t) => t.thresholdVolume > 0 && t.thresholdVolume <= end).map((t, k) => (
              <ReferenceLine key={t.thresholdVolume} x={t.thresholdVolume} stroke="var(--border-color)" strokeDasharray="2 4"
                label={{ value: `Tier ${tiers.indexOf(t) + 1}`, position: 'top', fill: 'var(--text-tertiary)', fontSize: 10 }} />
            ))}
            <Tooltip contentStyle={{ background: 'var(--bg-overlay)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12 }}
              labelFormatter={(x) => `$${formatCompact(Number(x))} over 14 days`}
              formatter={(v: number, name: string) => [`$${v.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`, name === 'bulk' ? 'BULK' : 'Hyperliquid']} />
            {compare && <Line dataKey="hl" type="linear" stroke="var(--text-tertiary)" strokeWidth={2} dot={false} isAnimationActive={false} />}
            <Line dataKey="bulk" type="linear" stroke="var(--accent)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
            {volume <= end && <ReferenceDot x={volume} y={you} r={5} fill="var(--accent)" stroke="var(--bg-base)" strokeWidth={2}
              label={{ value: 'You', position: 'top', fill: 'var(--text-primary)', fontSize: 11 }} />}
          </LineChart>
        </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
