'use client';

import { useEffect, useState } from 'react';
import { cn, formatNumber } from '@/lib/api';
import { useMarkets, price } from '../parts';
import { useLivePrice } from '../live';
import { CoinPick } from './CoinPick';

// BULK's base taker fee (tier 1), in bps. A market order in and out pays it twice.
const TAKER_BPS = 3.5;
const money = (n: number, sign = false) => `${sign ? (n >= 0 ? '+' : '−') : n < 0 ? '−' : ''}$${formatNumber(Math.abs(n), Math.abs(n) >= 1000 ? 0 : 2)}`;

/**
 * Position maths before you trade: margin, an estimated liquidation price, fees in
 * and out, and the result at a target. Entry starts at the live mark.
 */
export function CalcView({ coin, onCoin }: { coin: string; onCoin: (c: string) => void }) {
  const { maxLev } = useMarkets();
  const cap = maxLev(coin);
  const tick = useLivePrice(coin, 1000);
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [size, setSize] = useState('10000');
  const [lev, setLev] = useState(5);
  const [entry, setEntry] = useState('');
  const [target, setTarget] = useState('');
  const [entryTouched, setEntryTouched] = useState(false);

  useEffect(() => { setEntryTouched(false); setEntry(''); setTarget(''); }, [coin]);
  useEffect(() => { if (!entryTouched && tick) setEntry(String(Number(tick.price.toPrecision(7)))); }, [tick, entryTouched]);
  useEffect(() => { setLev((l) => Math.min(l, cap)); }, [cap]);

  const n = Number(size) || 0, e = Number(entry) || 0, t = Number(target) || 0;
  const sign = side === 'long' ? 1 : -1;
  const margin = lev > 0 ? n / lev : 0;
  // Isolated estimate: liquidation where the loss eats the margin down to maintenance,
  // taken as half the initial margin at the market's max leverage.
  const mm = 1 / (2 * Math.max(1, cap));
  const liq = e > 0 && lev > 0 ? e * (1 - sign * (1 / lev - mm)) : 0;
  const units = e > 0 ? n / e : 0;
  const feeIn = n * TAKER_BPS / 1e4;
  const exitNotional = t > 0 ? units * t : n;
  const feeOut = exitNotional * TAKER_BPS / 1e4;
  const gross = t > 0 && e > 0 ? sign * (t - e) * units : null;
  const net = gross === null ? null : gross - feeIn - feeOut;
  const roe = net === null || margin <= 0 ? null : (net / margin) * 100;

  const field = 'w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-muted)] px-2.5 py-1.5 text-[13px] tabular-nums text-[var(--text-primary)] outline-none focus:border-[var(--accent)]';
  const Row = ({ k, v, color }: { k: string; v: string; color?: string }) => (
    <div className="flex items-center justify-between py-1 text-[12px]"><span className="text-[var(--text-tertiary)]">{k}</span><span className="tabular-nums" style={{ color: color ?? 'var(--text-primary)' }}>{v}</span></div>
  );

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <div className="flex items-center gap-2">
        <CoinPick value={coin} onChange={onCoin} />
        <span className="text-[11px] text-[var(--text-tertiary)]">max {cap}×</span>
        <div className="ml-auto flex rounded-lg bg-[var(--bg-muted)] p-0.5">
          {(['long', 'short'] as const).map((s) => (
            <button key={s} type="button" onClick={() => setSide(s)}
              className={cn('rounded-md px-3 py-1 text-[12px] font-medium transition-colors', side === s ? (s === 'long' ? 'bg-[var(--pos)] text-white' : 'bg-[var(--neg)] text-white') : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]')}>
              {s === 'long' ? 'Long' : 'Short'}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-[var(--text-tertiary)]">Size (USD)<input className={field} inputMode="decimal" value={size} onChange={(ev) => setSize(ev.target.value.replace(/[^\d.]/g, ''))} /></label>
        <label className="text-[11px] text-[var(--text-tertiary)]">Entry<input className={field} inputMode="decimal" value={entry} onChange={(ev) => { setEntryTouched(true); setEntry(ev.target.value.replace(/[^\d.]/g, '')); }} /></label>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--text-tertiary)]"><span>Leverage</span><span className="tabular-nums text-[var(--text-primary)]">{lev}×</span></div>
        <input type="range" min={1} max={cap} step={1} value={lev} onChange={(ev) => setLev(Number(ev.target.value))} className="w-full" style={{ accentColor: 'var(--accent)' }} aria-label="Leverage" />
      </div>
      <div className="rounded-xl border border-[var(--border-color)] px-3 py-1.5">
        <Row k="Margin" v={money(margin)} />
        <Row k="Est. liquidation" v={liq > 0 ? price(liq) : '—'} color="var(--neg)" />
        <Row k={`Fee to open (${TAKER_BPS} bps)`} v={money(feeIn)} />
        <Row k="Size in units" v={units ? formatNumber(units, units < 10 ? 4 : 2) : '—'} />
      </div>
      <label className="text-[11px] text-[var(--text-tertiary)]">Target price<input className={field} inputMode="decimal" placeholder="e.g. take profit" value={target} onChange={(ev) => setTarget(ev.target.value.replace(/[^\d.]/g, ''))} /></label>
      <div className="rounded-xl border border-[var(--border-color)] px-3 py-1.5">
        <Row k="Price move" v={t && e ? `${t >= e ? '+' : '−'}${Math.abs((t / e - 1) * 100).toFixed(2)}%` : '—'} />
        <Row k="Fees in + out" v={money(feeIn + feeOut)} />
        <Row k="PnL at target" v={net === null ? '—' : money(net, true)} color={net === null ? undefined : net >= 0 ? 'var(--pos)' : 'var(--neg)'} />
        <Row k="Return on margin" v={roe === null ? '—' : `${roe >= 0 ? '+' : '−'}${Math.abs(roe).toFixed(1)}%`} color={roe === null ? undefined : roe >= 0 ? 'var(--pos)' : 'var(--neg)'} />
      </div>
      <p className="text-[10px] leading-snug text-[var(--text-tertiary)]">
        Liquidation is an isolated-margin estimate. BULK margins portfolios together, so a real account&apos;s liquidation also depends on its other positions. Fees at the base taker rate; funding not included.
      </p>
    </div>
  );
}
