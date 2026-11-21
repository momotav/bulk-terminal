'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { wallet, formatAddress, formatNumber, type WalletData, type WalletFill } from '@/lib/api';
import { useStore } from '@/store';
import { CoinIcon } from '@/components/CoinIcon';
import { price } from '../parts';
import { PnlChart, type PnlHover } from '@/components/wallet/PnlChart';
import { buildPnlCurve, thinCurve } from '@/lib/walletMetrics';

const RANGES = [['1D', 86_400_000], ['1W', 7 * 86_400_000], ['1M', 30 * 86_400_000], ['All', Infinity]] as const;

type Pos = NonNullable<WalletData['live']>['positions'][number];
const money = (n: number, sign = false) => `${sign ? (n >= 0 ? '+' : '−') : n < 0 ? '−' : ''}$${Math.abs(n) >= 1e6 ? `${(Math.abs(n) / 1e6).toFixed(2)}M` : Math.abs(n) >= 1e4 ? formatNumber(Math.abs(n), 0) : formatNumber(Math.abs(n), 2)}`;
const pnlColor = (n: number) => (Math.abs(n) < 0.005 ? 'var(--text-primary)' : n > 0 ? 'var(--pos)' : 'var(--neg)');
const ago = (t: number) => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? `${Math.floor(s)}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };

/**
 * A wallet, live: PnL, account value, every open position with its distance to
 * liquidation, and its newest fills as they land. Pick an address or one you follow.
 */
export function WalletWatch({ address, onAddress }: { address?: string; onAddress: (a: string) => void }) {
  const { following } = useStore();
  const [draft, setDraft] = useState('');
  const [data, setData] = useState<WalletData | null>(null);
  const [fills, setFills] = useState<(WalletFill & { fee?: number; isMaker?: boolean })[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef<Set<string>>(new Set());
  const [range, setRange] = useState<(typeof RANGES)[number][0]>('1W');
  const [hover, setHover] = useState<PnlHover | null>(null);

  useEffect(() => {
    if (!address) return;
    let alive = true;
    setData(null); setFills([]); seen.current = new Set();
    const loadAcc = () => wallet.getWallet(address).then((d) => { if (alive) setData(d); }).catch(() => {});
    const loadFills = () => wallet.getFills(address, { limit: 25, lite: true }).then((r) => {
      if (!alive) return;
      const list = [...(r.fills ?? [])].sort((x, y) => y.timestamp - x.timestamp).slice(0, 25);
      const keys = list.map((f) => f.tradeId ?? `${f.timestamp}-${f.price}`);
      const isFirst = seen.current.size === 0;
      const added = new Set(isFirst ? [] : keys.filter((k) => !seen.current.has(k)));
      keys.forEach((k) => seen.current.add(k));
      setFills(list); if (added.size) { setFresh(added); setTimeout(() => setFresh(new Set()), 2500); }
    }).catch(() => {});
    loadAcc(); loadFills();
    const a = window.setInterval(loadAcc, 5000), f = window.setInterval(loadFills, 10000);
    return () => { alive = false; window.clearInterval(a); window.clearInterval(f); };
  }, [address]);

  const m = data?.live?.margin;
  const curve = useMemo(() => (data ? buildPnlCurve({
    snapshots: data.snapshots ?? [], history: data.history ?? [], realizedNow: m?.realizedPnl ?? null, unrealizedNow: m?.unrealizedPnl ?? null, now: Date.now(),
  }) : null), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const pts = useMemo(() => {
    if (!curve) return [];
    const span = RANGES.find(([k]) => k === range)?.[1] ?? Infinity;
    const cut = Date.now() - span;
    const inside = curve.points.filter((p) => p.t >= cut);
    const before = curve.points.filter((p) => p.t < cut).pop();
    const all = before && Number.isFinite(cut) ? [{ t: cut, v: before.v }, ...inside] : inside;
    return thinCurve(all, curve.realizedOnlyUntil, 160);
  }, [curve, range]);
  const change = pts.length >= 2 ? (hover ? hover.point.v : pts[pts.length - 1].v) - pts[0].v : null;

  if (!address) {
    return (
      <div className="flex h-full flex-col gap-3 p-3">
        <form onSubmit={(e) => { e.preventDefault(); const a = draft.trim(); if (a.length >= 32) onAddress(a); }} className="flex gap-2">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Paste a wallet address" autoFocus
            className="min-w-0 flex-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-muted)] px-2.5 py-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]" />
          <button type="submit" disabled={draft.trim().length < 32} className="rounded-lg bg-[var(--accent)] px-3 text-[12px] font-medium text-[var(--accent-text)] disabled:opacity-40">Watch</button>
        </form>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mb-1.5 text-[11px] text-[var(--text-tertiary)]">{following.length ? 'Wallets you follow' : 'Follow wallets to pick them here.'}</div>
          {following.map((w) => (
            <button key={w.wallet_address} type="button" onClick={() => onAddress(w.wallet_address)}
              className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-[12px] hover:bg-[var(--bg-muted)]">
              <span className="font-mono text-[var(--text-primary)]">{w.nickname || formatAddress(w.wallet_address)}</span>
              {w.total_pnl != null && <span className="tabular-nums" style={{ color: pnlColor(Number(w.total_pnl)) }}>{money(Number(w.total_pnl), true)}</span>}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const positions: Pos[] = [...(data?.live?.positions ?? [])].sort((x, y) => Math.abs(y.notional) - Math.abs(x.notional));
  const total = m ? m.realizedPnl + m.unrealizedPnl : null;
  const value = m ? m.totalBalance + m.unrealizedPnl : null;

  return (
    <div className="flex h-full flex-col">
      <div className="grid grid-cols-3 gap-px border-b border-[var(--border-color)] bg-[var(--border-color)]">
        {[['Total PnL', total, true], ['Open PnL', m?.unrealizedPnl ?? null, true], ['Account', value, false]].map(([k, v, signed]) => (
          <div key={String(k)} className="bg-[var(--bg-base)] px-3 py-2">
            <div className="text-[10px] text-[var(--text-tertiary)]">{String(k)}</div>
            <div className="text-[14px] font-medium tabular-nums" style={{ color: signed && v !== null ? pnlColor(Number(v)) : 'var(--text-primary)' }}>
              {v === null ? '—' : money(Number(v), Boolean(signed))}
            </div>
          </div>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-3 pt-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] text-[var(--text-tertiary)]">
              {hover ? new Date(hover.point.t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : 'Performance'}
              {change !== null && <span className="ml-1.5 font-medium tabular-nums" style={{ color: pnlColor(change) }}>{money(change, true)}</span>}
            </div>
            <div className="flex rounded-md bg-[var(--bg-muted)] p-0.5">
              {RANGES.map(([k]) => (
                <button key={k} type="button" onClick={() => setRange(k)}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${range === k ? 'bg-[var(--bg-base)] text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'}`}>{k}</button>
              ))}
            </div>
          </div>
          <div className="relative mt-1 h-[120px]">
            {pts.length >= 2
              ? <div className="absolute inset-0"><PnlChart points={pts} onHover={setHover} ariaLabel={`PnL ${range}`} /></div>
              : <div className="absolute inset-0 flex items-center justify-center text-[11px] text-[var(--text-tertiary)]">{data ? 'No PnL history in this range.' : 'Loading…'}</div>}
          </div>
        </div>
        <div className="flex items-center justify-between px-3 pt-2 pb-1 text-[11px] text-[var(--text-tertiary)]">
          <span>Positions · {positions.length}</span>
          <Link href={`/wallet/${address}`} className="inline-flex items-center gap-0.5 hover:text-[var(--text-primary)]">{formatAddress(address)}<ArrowUpRight className="h-3 w-3" /></Link>
        </div>
        {!data && <p className="px-3 py-4 text-center text-[12px] text-[var(--text-tertiary)]">Loading…</p>}
        {data && positions.length === 0 && <p className="px-3 py-3 text-[12px] text-[var(--text-tertiary)]">No open positions.</p>}
        {positions.map((p) => {
          const long = p.size > 0; const mark = p.fairPrice || p.price;
          const liqDist = p.liquidationPrice > 0 && mark > 0 ? Math.abs(mark - p.liquidationPrice) / mark : null;
          return (
            <div key={p.symbol} className="flex items-center gap-2 border-t border-[var(--border-color)] px-3 py-1.5 text-[12px]">
              <CoinIcon symbol={p.symbol} size={14} />
              <span className="w-16 truncate font-medium text-[var(--text-primary)]">{p.symbol.replace(/-USD$/, '')}</span>
              <span className="w-16" style={{ color: long ? 'var(--pos)' : 'var(--neg)' }}>{long ? 'Long' : 'Short'} {Math.round(p.leverage)}×</span>
              <span className="flex-1 tabular-nums text-[var(--text-secondary)]">{money(Math.abs(p.notional))}</span>
              {liqDist !== null && <span className="tabular-nums text-[11px]" style={{ color: liqDist < 0.05 ? 'var(--neg)' : 'var(--text-tertiary)' }} title="Distance to liquidation">{(liqDist * 100).toFixed(1)}%</span>}
              <span className="w-[76px] text-right tabular-nums" style={{ color: pnlColor(p.unrealizedPnl) }}>{money(p.unrealizedPnl, true)}</span>
            </div>
          );
        })}
        <div className="px-3 pt-3 pb-1 text-[11px] text-[var(--text-tertiary)]">Latest fills</div>
        {fills.map((f) => {
          const k = f.tradeId ?? `${f.timestamp}-${f.price}`;
          return (
            <div key={k} className="flex items-center gap-2 border-t border-[var(--border-color)] px-3 py-1.5 text-[11px] transition-colors duration-700"
              style={{ background: fresh.has(k) ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : undefined }}>
              <span className="w-8 tabular-nums text-[var(--text-tertiary)]">{ago(f.timestamp)}</span>
              <CoinIcon symbol={f.symbol.replace(/-USD$/, '')} size={13} />
              <span className="w-14 truncate font-medium text-[var(--text-primary)]">{f.symbol.replace(/-USD$/, '')}</span>
              <span className="w-8" style={{ color: f.isBuy ? 'var(--pos)' : 'var(--neg)' }}>{f.isBuy ? 'Buy' : 'Sell'}</span>
              <span className="flex-1 tabular-nums text-[var(--text-secondary)]">{money(Math.abs(f.size) * f.price)}</span>
              <span className="tabular-nums text-[var(--text-tertiary)]">{price(f.price)}</span>
            </div>
          );
        })}
      </div>
      <button type="button" onClick={() => onAddress('')} className="border-t border-[var(--border-color)] py-1.5 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">Watch another wallet</button>
    </div>
  );
}
