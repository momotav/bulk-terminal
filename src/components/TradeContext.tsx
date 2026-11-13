'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { wallet, formatNumber, type ClosedPosition, type WalletData, type WalletFill } from '@/lib/api';
import { formatPx, money, pnlColor, signed } from '@/lib/walletFormat';

// Context under a trade or order page: the position the fill belongs to (and what
// this fill did to it), and the wallet's fills on that coin either side of it.
//
// Which position: walk the coin's fills BACKWARDS from the live size (0 when flat).
// That stays right even when BULK has cut an old, busy wallet's history short, where
// replaying forward from zero would put every fill in the wrong position.

type Fill = WalletFill & { fee?: number; isMaker?: boolean };
const EPS = 1e-9;
const flat = (n: number) => Math.abs(n) < EPS;
// UTC, like the card above it: one clock on the page.
const when = (t: number) => `${new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'UTC' })} UTC`;

export function TradeContext({ address, symbol, tradeId, showNearby = true }: { address: string; symbol: string; tradeId?: string | null; showNearby?: boolean }) {
  const coin = symbol.replace(/-USD$/, '');
  const [fills, setFills] = useState<Fill[] | null>(null);
  const [live, setLive] = useState<NonNullable<WalletData['live']>['positions'][number] | null | undefined>(undefined);
  const [closed, setClosed] = useState<ClosedPosition[] | null>(null);

  useEffect(() => {
    let alive = true;
    wallet.getFills(address, { symbol, limit: 40000, lite: true }).then((r) => { if (alive) setFills((r.fills ?? []) as Fill[]); }).catch(() => { if (alive) setFills([]); });
    wallet.getWallet(address).then((w) => { if (alive) setLive(w.live?.positions.find((p) => p.symbol === symbol) ?? null); }).catch(() => { if (alive) setLive(null); });
    wallet.getClosedPositions(address, { symbol, limit: 2000 }).then((r) => { if (alive) setClosed(r.positions ?? []); }).catch(() => { if (alive) setClosed([]); });
    return () => { alive = false; };
  }, [address, symbol]);

  const ctx = useMemo(() => {
    if (!fills || live === undefined) return null;
    const asc = [...fills].sort((a, b) => a.timestamp - b.timestamp);
    const i = tradeId ? asc.findIndex((f) => f.tradeId === tradeId) : -1;
    if (i < 0) return { asc, i, seg: null };
    // Net size after each fill, walking back from now.
    const after = new Array<number>(asc.length);
    let net = live?.size ?? 0;
    for (let k = asc.length - 1; k >= 0; k--) { after[k] = net; net -= asc[k].isBuy ? asc[k].size : -asc[k].size; }
    const before = (k: number) => after[k] - (asc[k].isBuy ? asc[k].size : -asc[k].size);
    let s = i; while (s > 0 && !flat(before(s))) s--;
    let e = i; while (e < asc.length - 1 && !flat(after[e])) e++;
    const open = !flat(after[e]);
    const b = before(i), a = after[i];
    const action = flat(b) ? 'opened' : flat(a) ? 'closed' : Math.sign(a) !== Math.sign(b) ? 'flipped' : Math.abs(a) > Math.abs(b) ? 'added to' : 'reduced';
    const side: 'long' | 'short' = (flat(b) ? a : b) > 0 ? 'long' : 'short';
    const startT = asc[s].timestamp, endT = open ? null : asc[e].timestamp;
    return { asc, i, seg: { side, open, action, startT, endT, fillsIn: e - s + 1 } };
  }, [fills, live, tradeId]);

  const record = useMemo(() => {
    if (!ctx?.seg || ctx.seg.open || !closed) return null;
    const end = ctx.seg.endT!;
    return closed.find((c) => Math.abs(c.closedAt - end) <= 2000) ?? null;
  }, [ctx, closed]);

  if (!ctx) {
    return <div className="mt-5 h-[92px] rounded-2xl border border-[var(--border-color)] bg-[var(--role-surface)] animate-pulse" />;
  }

  const seg = ctx.seg;
  const posHref = seg
    ? `/observe/${address}/${coin}?from=${Math.floor(seg.startT)}${seg.endT ? `&to=${Math.floor(seg.endT)}` : ''}`
    : `/observe/${address}/${coin}`;
  const near = ctx.i >= 0 ? ctx.asc.slice(Math.max(0, ctx.i - 3), ctx.i + 4) : [];

  return (
    <>
      {(seg || live) && (
        <Link href={posHref} className="group mt-5 block rounded-2xl border border-[var(--border-color)] bg-[var(--role-surface)] px-6 py-4 hover:bg-[var(--role-surface-raised)] transition-colors">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] text-[var(--role-content-muted)]">Part of this position</span>
            <ArrowUpRight className="w-4 h-4 text-[var(--role-content-subtle)] group-hover:text-[var(--role-content)] transition-colors" />
          </div>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div className="min-w-0">
              <div className="text-[17px] text-[var(--role-content)]">
                <span style={{ color: (seg?.side ?? (live && live.size > 0 ? 'long' : 'short')) === 'long' ? 'var(--pos)' : 'var(--neg)' }}>
                  {(seg?.side ?? (live && live.size > 0 ? 'long' : 'short')) === 'long' ? 'Long' : 'Short'}
                </span>{' '}
                {coin}
                {(seg ? seg.open : true) && live?.leverage ? ` · ${formatNumber(live.leverage, 0)}x` : ''}
                <span className="text-[var(--role-content-muted)]"> · {seg ? (seg.open ? 'Open' : record?.liquidated ? 'Liquidated' : 'Closed') : 'Open'}</span>
              </div>
              <div className="mt-0.5 text-[13px] text-[var(--role-content-muted)]">
                {seg ? `This fill ${seg.action} it · ${seg.fillsIn.toLocaleString('en-US')} fill${seg.fillsIn === 1 ? '' : 's'} · opened ${when(seg.startT)}${seg.endT ? `, closed ${when(seg.endT)}` : ''}` : 'Open now'}
              </div>
            </div>
            {seg?.open || !seg ? (
              live ? (
                <div className="text-right">
                  <div className="text-[20px] font-medium tabular-nums" style={{ color: pnlColor(live.unrealizedPnl) }}>{signed(live.unrealizedPnl)}</div>
                  <div className="text-[12px] text-[var(--role-content-subtle)] tabular-nums">unrealized · entry {formatPx(live.price)} · {money(Math.abs(live.notional))}</div>
                </div>
              ) : null
            ) : record ? (
              <div className="text-right">
                <div className="text-[20px] font-medium tabular-nums" style={{ color: pnlColor(record.realizedPnl) }}>{signed(record.realizedPnl)}</div>
                <div className="text-[12px] text-[var(--role-content-subtle)] tabular-nums">realized · entry {formatPx(record.openPrice)} → exit {formatPx(record.closePrice)}</div>
              </div>
            ) : null}
          </div>
        </Link>
      )}

      {showNearby && near.length > 1 && (
        <section className="mt-5 rounded-2xl border border-[var(--border-color)] bg-[var(--role-surface)] overflow-hidden">
          <h2 className="px-6 pt-4 pb-2 text-[13px] text-[var(--role-content-muted)]">Fills around it</h2>
          <table className="w-full text-[13px] tabular-nums whitespace-nowrap">
            <tbody>
              {near.map((f) => {
                const me = f.tradeId === tradeId;
                return (
                  <tr key={f.tradeId ?? `${f.timestamp}-${f.price}`} className={`border-t border-[var(--border-color)] ${me ? 'bg-[var(--role-surface-raised)]' : ''}`}>
                    <td className="pl-6 pr-3 py-2.5 text-[var(--role-content-muted)]">{when(f.timestamp)}</td>
                    <td className="px-3 py-2.5" style={{ color: f.isBuy ? 'var(--pos)' : 'var(--neg)' }}>{f.isBuy ? 'Buy' : 'Sell'}</td>
                    <td className="px-3 py-2.5 text-right text-[var(--role-content)]">{formatNumber(Math.abs(f.size), 4)} {coin}</td>
                    <td className="px-3 py-2.5 text-right text-[var(--role-content)]">{formatPx(f.price)}</td>
                    <td className="pl-3 pr-6 py-2.5 text-right">
                      {me ? <span className="text-[12px] text-[var(--role-content-subtle)]">This fill</span>
                        : f.tradeId ? <Link href={`/wallet/${address}/trade/${f.tradeId}`} className="inline-flex items-center gap-1 text-[12px] text-[var(--role-content-muted)] hover:text-[var(--role-content)]">Open <ArrowUpRight className="w-3 h-3" /></Link> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
