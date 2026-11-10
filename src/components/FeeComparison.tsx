'use client';

// BULK's fees against Hyperliquid's published schedule, over 14-day volume. Hyperliquid
// is the closest like-for-like: a high-performance on-chain perp exchange with volume
// tiers on the same 14-day window. Its numbers are copied from its docs and dated,
// so they can go stale: keep HL_CHECKED honest when updating.

import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn, formatCompact, formatNumber, type FeeTierRow } from '@/lib/api';
import { feeOn, tierIndex } from '@/lib/fees';

/** Hyperliquid perps, base rates before HYPE staking discounts (up to 40%). */
export const HL_TIERS: FeeTierRow[] = [
  { thresholdVolume: 0, takerBps: 4.5, makerBps: 1.5 },
  { thresholdVolume: 5e6, takerBps: 4.0, makerBps: 1.2 },
  { thresholdVolume: 25e6, takerBps: 3.5, makerBps: 0.8 },
  { thresholdVolume: 100e6, takerBps: 3.0, makerBps: 0.4 },
  { thresholdVolume: 500e6, takerBps: 2.8, makerBps: 0 },
  { thresholdVolume: 2e9, takerBps: 2.6, makerBps: 0 },
  { thresholdVolume: 7e9, takerBps: 2.4, makerBps: 0 },
];
const HL_SOURCE = 'https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees';
const HL_CHECKED = 'Nov 10, 2026';
const X_MIN = 1e4;
const X_MAX = 1e10;

const bps = (n: number) => `${n.toFixed(2)} bps`;
const usd = (n: number) => `$${formatNumber(Math.abs(n), Math.abs(n) < 1000 ? 2 : 0)}`;
const at = (tiers: FeeTierRow[], v: number) => tiers[tierIndex(tiers, v)];

export function FeeComparison({ crypto, tradfiTakerBps, volume, takerShare, comparing }: {
  crypto: FeeTierRow[];
  tradfiTakerBps: number | null;
  volume: number;
  takerShare: number;
  /** False when the calculator is on a TradFi market, which Hyperliquid prices differently. */
  comparing: boolean;
}) {
  const [side, setSide] = useState<'taker' | 'maker'>('taker');
  const key = side === 'taker' ? 'takerBps' : 'makerBps';

  // One row per threshold of either schedule, drawn as steps on a log volume axis.
  const data = useMemo(() => {
    const xs = Array.from(new Set([X_MIN, ...crypto.map((t) => t.thresholdVolume), ...HL_TIERS.map((t) => t.thresholdVolume), X_MAX]))
      .filter((x) => x >= X_MIN && x <= X_MAX).sort((a, b) => a - b);
    return xs.map((x) => ({
      x,
      bulk: at(crypto, x)[key],
      tradfi: side === 'taker' ? tradfiTakerBps : 0,
      hl: at(HL_TIERS, x)[key],
    }));
  }, [crypto, tradfiTakerBps, key, side]);

  const yTop = Math.max(1, Math.ceil(Math.max(...data.map((d) => Math.max(d.bulk, d.hl, d.tradfi ?? 0))) + 0.5));
  const v = Math.min(X_MAX, Math.max(X_MIN, volume));
  const bulkTier = at(crypto, volume);
  const hlTier = at(HL_TIERS, volume);
  const bulkCost = feeOn(volume, takerShare, bulkTier.takerBps, bulkTier.makerBps);
  const hlCost = feeOn(volume, takerShare, hlTier.takerBps, hlTier.makerBps);
  const tick = { fill: 'var(--text-tertiary)', fontSize: 11 };

  const keys = [
    { title: 'Free to make', body: `0 bps maker fee on every tier. Hyperliquid charges makers ${bps(HL_TIERS[0].makerBps)} to start.` },
    [...crypto, ...HL_TIERS].every((t) => at(crypto, t.thresholdVolume).takerBps < at(HL_TIERS, t.thresholdVolume).takerBps)
      ? { title: 'Lower taker fee at every volume', body: `From ${bps(crypto[0].takerBps)} against ${bps(HL_TIERS[0].takerBps)}, and still lower at the top tiers.` }
      : { title: 'Lower taker fee to start', body: `${bps(crypto[0].takerBps)} against ${bps(HL_TIERS[0].takerBps)} on the first tier.` },
    ...(tradfiTakerBps !== null ? [{ title: 'Stocks and indices for less', body: `TradFi markets are a flat ${bps(tradfiTakerBps)} taker, under half the crypto rate.` }] : []),
    { title: 'Paid to make, at size', body: 'Market makers above a share of all maker volume earn a rebate on top.' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {keys.map((k) => (
          <div key={k.title} className="rounded-lg bg-[var(--bg-muted)] px-4 py-3">
            <div className="text-[14px] font-medium text-[var(--text-primary)]">{k.title}</div>
            <div className="mt-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">{k.body}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-[var(--text-secondary)]">
          <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-[var(--accent)]" />BULK crypto</span>
          {tradfiTakerBps !== null && side === 'taker' && <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: 'var(--coin-3)' }} />BULK TradFi</span>}
          <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-[var(--text-tertiary)]" />Hyperliquid</span>
        </div>
        <div className="flex items-center gap-0.5 bg-[var(--bg-muted)] rounded-lg p-0.5">
          {(['taker', 'maker'] as const).map((s) => (
            <button key={s} type="button" onClick={() => setSide(s)}
              className={cn('px-3 py-1 text-xs font-medium rounded transition-colors', side === s ? 'bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border-color)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]')}>
              {s === 'taker' ? 'Taker fee' : 'Maker fee'}
            </button>
          ))}
        </div>
      </div>

      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--role-line-subtle)" strokeOpacity={0.5} />
            <XAxis dataKey="x" type="number" scale="log" domain={[X_MIN, X_MAX]} ticks={[1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10]} tick={tick} axisLine={false} tickLine={false}
              tickFormatter={(x) => `$${formatCompact(Number(x)).replace(/\.0+(?=[A-Za-z]*$)/, '')}`} />
            <YAxis tick={tick} axisLine={false} tickLine={false} width={52} domain={[0, yTop]} ticks={Array.from({ length: yTop + 1 }, (_, i) => i)} tickFormatter={(y) => `${y} bps`} />
            <ReferenceLine x={v} stroke="var(--text-secondary)" strokeDasharray="3 3"
              label={{ value: 'You', position: 'insideTopRight', fill: 'var(--text-secondary)', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'var(--bg-overlay)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12 }}
              labelFormatter={(x) => `14-day volume from $${formatCompact(Number(x))}`}
              formatter={(val: number, name: string) => [bps(val), name === 'bulk' ? 'BULK crypto' : name === 'tradfi' ? 'BULK TradFi' : 'Hyperliquid']} />
            <Line dataKey="hl" type="stepAfter" stroke="var(--text-tertiary)" strokeWidth={2} dot={false} isAnimationActive={false} />
            {tradfiTakerBps !== null && side === 'taker' && <Line dataKey="tradfi" type="stepAfter" stroke="var(--coin-3)" strokeWidth={2} dot={false} isAnimationActive={false} />}
            <Line dataKey="bulk" type="stepAfter" stroke="var(--accent)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-lg border border-[var(--border-color)] px-4 py-3 text-[14px] text-[var(--text-secondary)]">
        {comparing ? (
          <>On ${formatCompact(volume)} over 14 days at {Math.round(takerShare * 100)}% taker: <span className="text-[var(--text-primary)] tabular-nums">{usd(bulkCost)}</span> in fees on BULK,{' '}
            <span className="text-[var(--text-primary)] tabular-nums">{usd(hlCost)}</span> on Hyperliquid
            {hlCost > bulkCost && <>, <span className="text-[var(--pos)] tabular-nums">{usd(hlCost - bulkCost)}</span> less on BULK</>}.</>
        ) : 'Pick Crypto in the calculator to compare costs: Hyperliquid prices stock markets on a different basis.'}
      </div>

      <p className="text-[12px] leading-relaxed text-[var(--text-tertiary)]">
        Hyperliquid base rates from <a href={HL_SOURCE} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-[var(--text-secondary)]">its fee docs</a>, checked {HL_CHECKED},
        before its staking discounts of up to 40% for HYPE holders. Some exchanges, Lighter for one, charge nothing on standard accounts in exchange for slower order handling.
      </p>
    </div>
  );
}
