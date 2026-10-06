'use client';

// ---------------------------------------------------------------------------
// /observe/[address]/[coin] — the shareable "watch this trade" view.
//
// One URL that tells the whole story of a single wallet's position in one
// market: a PnL progress line across the trade's life, the price chart with
// entry/liq/mark and every fill marked, and a chronological event rail
// (opened → added → reduced → closed). Reconstructed entirely from BULK's
// fill history + OHLC candles (buildTradeLifecycle) — nothing is stored on
// our side, so any trade anyone can see on the wallet page is shareable here.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Check, Share2, Loader2, CircleDot, ExternalLink,
  CandlestickChart, Activity, Wallet, ListOrdered, Flag, Plus, Minus, ArrowUpRight, ArrowDownRight, type LucideIcon,
} from 'lucide-react';
import { wallet, formatNumber, formatCompact, formatAddress, type WalletData, type WalletFill } from '@/lib/api';
import { buildTradeLifecycle, formatDuration, type TradeLifecycle, type TradeEventPoint } from '@/lib/positionWalk';
import { TradeJourneyChart, type JourneyMarker } from '@/components/TradeJourneyChart';
import { TradeCandlePanel } from '@/components/TradeCandlePanel';
import { TradeShareCard } from '@/components/TradeShareCard';
import { getCoinColor } from '@/lib/coins';
import { Image as ImageIcon } from 'lucide-react';

export default function ObserveTradePage() {
  const params = useParams<{ address: string; coin: string }>();
  const address = String(params.address || '');
  const coin = String(params.coin || '').toUpperCase().replace(/-USD$/, '');
  // Optional ?from=<openMs>&to=<closeMs> pins ONE specific trade (one open→close
  // instance) rather than the coin's whole position history. `from` alone pins a
  // still-open trade; both pin a closed one.
  const searchParams = useSearchParams();
  const fromMs = Number(searchParams.get('from')) || 0;
  const toMs = Number(searchParams.get('to')) || 0;
  const pinned = fromMs > 0;

  const [walletData, setWalletData] = useState<WalletData | null>(null);
  const [fills, setFills] = useState<WalletFill[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showCard, setShowCard] = useState(false);

  // Resolve the full symbol ("BTC" → "BTC-USD") from the wallet's own fills so
  // we never guess a quote the market doesn't use.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      wallet.getWallet(address).catch(() => null),
      // Server-side symbol filter — an active wallet's per-coin fills get pushed
      // out of an unfiltered recent window by other markets, so ask BULK for
      // this coin's fills directly (the backend proxies BULK's symbol filter).
      wallet.getFills(address, { symbol: `${coin}-USD`, limit: 1000 }).then((r) => r.fills).catch(() => [] as WalletFill[]),
    ])
      .then(([wd, fl]) => {
        if (cancelled) return;
        setWalletData(wd);
        setFills(fl);
      })
      .catch(() => { if (!cancelled) setError('Could not load this wallet.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [address]);

  const symbol = useMemo(() => {
    const hit = (fills ?? []).find((f) => f.symbol.replace(/-USD$/, '').toUpperCase() === coin);
    return hit?.symbol ?? `${coin}-USD`;
  }, [fills, coin]);

  const coinFills = useMemo(
    () => (fills ?? []).filter((f) => f.symbol.replace(/-USD$/, '').toUpperCase() === coin),
    [fills, coin],
  );

  // Pin the trade instance the URL points at. Unpinned → the whole coin history
  // (buildTradeLifecycle shows the most recent instance).
  //
  // CLOSED (to set): keep every fill UP TO the close and let buildTradeLifecycle
  // slice back to the real open (the last flat→non-flat before the close). We do
  // NOT filter on `from` because BULK's reported openTime often doesn't match the
  // position's actual first fill — it can sit days late, or (as for continuously-
  // held positions it splits into lot-records) land mid-position. Filtering on it
  // dropped the opening fills and left a degenerate 1–2 fill fragment with wrong/
  // missing markers. Trusting only the close reconstructs the whole real trade.
  //
  // OPEN (from only): fills from `from` onward — the current instance.
  const tradeFills = useMemo(() => {
    if (!pinned) return coinFills;
    if (toMs > 0) return coinFills.filter((f) => f.timestamp <= toMs + 2000);
    return coinFills.filter((f) => f.timestamp >= fromMs - 2000);
  }, [coinFills, pinned, fromMs, toMs]);

  // Live position + mark (if this market is currently open in the wallet).
  const livePos = useMemo(
    () => walletData?.live?.positions.find((p) => p.symbol.replace(/-USD$/, '').toUpperCase() === coin) ?? null,
    [walletData, coin],
  );
  const markPrice = walletData?.markPrices?.[symbol] ?? livePos?.price ?? null;

  // The journey curve needs candles too. Rather than fetch them twice, the
  // candle panel reports the candles it loaded back up here via a shared
  // module cache, which bumps candleTick to rebuild the lifecycle with prices.
  const [candleTick, setCandleTick] = useState(0);

  const life = useMemo<TradeLifecycle | null>(() => {
    const candles = candleCache.get(symbol) ?? [];
    // Candles are fetched inside TradeCandlePanel; the journey curve is built
    // against the same candle set once it arrives (see candleCache below).
    if (tradeFills.length) {
      const l = buildTradeLifecycle(tradeFills, candles, { markPrice });
      if (l) return l;
    }
    // Fills unavailable (aged out of BULK's window, or a transient 429) but the
    // wallet DOES have a live position here — reconstruct what we can from the
    // live snapshot so an open trade never reads as "not found". The journey is
    // marked-to-market against candles (constant size/entry); there are no
    // per-fill events, so the lifecycle rail is empty. Not for a pinned CLOSED
    // trade (to set) — the live position is a DIFFERENT, later instance.
    if (!toMs && livePos && Math.abs(livePos.size) > 1e-9) {
      return liveFallbackLifecycle(symbol, livePos, candles, markPrice);
    }
    return null;
  }, [tradeFills, symbol, markPrice, candleTick, livePos, toMs]); // eslint-disable-line react-hooks/exhaustive-deps

  const journeyMarkers = useMemo<JourneyMarker[]>(() => {
    if (!life || !life.pnlCurve.length) return [];
    const curve = life.pnlCurve;
    const pnlAt = (t: number): number => {
      // nearest curve sample
      let best = curve[0];
      let bd = Math.abs(best.t - t);
      for (const p of curve) { const d = Math.abs(p.t - t); if (d < bd) { bd = d; best = p; } }
      return best.pnl;
    };
    return life.events.map((e) => ({
      t: e.t,
      pnl: pnlAt(e.t),
      label: e.actionLabel,
      tone: (e.action === 'reduce' || e.action === 'close') ? 'out' : 'in',
    }));
  }, [life]);

  if (loading) {
    return (
      <Shell>
        <div className="flex h-[60vh] items-center justify-center gap-2 text-[var(--role-content-subtle)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Reconstructing trade…
        </div>
      </Shell>
    );
  }

  if (error || !life) {
    return (
      <Shell>
        <div className="mx-auto mt-16 max-w-md rounded-xl border border-[var(--role-line)] bg-[var(--role-surface)] p-6 text-center">
          <p className="text-sm text-[var(--role-content)]">
            {error ?? `No ${coin} trade found for this wallet in the available fill history.`}
          </p>
          <p className="mt-2 text-xs text-[var(--role-content-subtle)]">
            BULK keeps a limited window of fills — very old trades may have aged out.
          </p>
          <Link href={`/whales/${address}`} className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent-text)] hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to wallet
          </Link>
        </div>
      </Shell>
    );
  }

  const coinColor = getCoinColor(coin);
  const isUp = life.finalPnl >= 0;
  const notionalPeak = life.peakSize * life.avgEntry;
  const roi = notionalPeak > 0 ? (life.finalPnl / (livePos?.leverage ? notionalPeak / livePos.leverage : notionalPeak)) * 100 : null;
  // Fallback = live position with no fill history; we don't know when it opened,
  // so "Held" is unknown and the lifecycle rail is empty.
  const isFallback = life.events.length === 0;
  const heldMs = (life.closedAt ?? Date.now()) - life.openedAt;
  // For a closed trade show the exit price (last fill), not the live mark.
  const lastPrice = life.isOpen ? markPrice : (life.events.length ? life.events[life.events.length - 1].price : markPrice);

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked — no-op */ }
  };

  return (
    <Shell>
      {/* Top bar — terminal status line */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--role-line)] pb-3">
        <Link href={`/whales/${address}`} className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider text-[var(--role-content-subtle)] transition-colors hover:text-[var(--role-content)]">
          <ArrowLeft className="h-3.5 w-3.5" /> Wallet
        </Link>
        <span className="text-[var(--role-line)]">/</span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: coinColor }} />
          <span className="text-sm font-medium tracking-wide text-[var(--role-content)]">{coin}</span>
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: life.side === 'long' ? 'var(--pos)' : 'var(--neg)' }}>
          {life.side}
        </span>
        <span className={`text-[11px] uppercase tracking-wider ${life.isOpen ? 'text-[var(--accent-text)]' : 'text-[var(--role-content-subtle)]'}`}>
          {life.isOpen ? '● open' : 'closed'}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <Link href={`/whales/${address}`} className="hidden items-center gap-1 text-[11px] text-[var(--role-content-subtle)] hover:text-[var(--role-content)] sm:inline-flex">
            {formatAddress(address)} <ExternalLink className="h-3 w-3" />
          </Link>
          <button
            onClick={() => setShowCard(true)}
            className="inline-flex items-center gap-1.5 border border-[var(--role-line)] px-2.5 py-1 text-[11px] uppercase tracking-wider text-[var(--role-content)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-text)]"
          >
            <ImageIcon className="h-3.5 w-3.5" /> Card
          </button>
          <button
            onClick={share}
            className="inline-flex items-center gap-1.5 border border-[var(--role-line)] px-2.5 py-1 text-[11px] uppercase tracking-wider text-[var(--role-content)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-text)]"
          >
            {copied ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Share2 className="h-3.5 w-3.5" /> Share</>}
          </button>
        </div>
      </div>

      {showCard && (
        <TradeShareCard
          onClose={() => setShowCard(false)}
          data={{
            address,
            symbol,
            coin,
            side: life.side,
            isOpen: life.isOpen,
            openedAt: life.openedAt,
            closedAt: life.closedAt,
            avgEntry: life.avgEntry,
            size: life.peakSize,
            leverage: livePos?.leverage ?? 0,
            markPrice,
            exitPrice: life.isOpen ? markPrice : lastPrice,
            pnl: life.finalPnl,
            events: life.events.map((e) => ({ t: e.t, price: e.price, buy: e.sizeDelta > 0, action: e.action })),
            pnlCurve: life.pnlCurve.map((p) => ({ t: p.t, pnl: p.pnl })),
          }}
        />
      )}

      {/* Terminal grid — big chart left, data readout right. */}
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* LEFT: price (big) + journey */}
        <div className="flex min-w-0 flex-col gap-3">
          <TermPanel title="Price & Fills" icon={CandlestickChart}>
            <div className="h-[380px] p-1.5 sm:h-[460px] lg:h-[560px]">
              <TradeCandlePanel
                symbol={symbol}
                side={life.side}
                avgEntry={life.avgEntry}
                liqPrice={livePos?.liquidationPrice}
                markPrice={markPrice}
                events={life.events}
                openedAt={life.openedAt}
                closedAt={life.closedAt}
                isOpen={life.isOpen}
                onCandles={(cs) => {
                  if (cs.length && candleCache.get(symbol)?.length !== cs.length) {
                    candleCache.set(symbol, cs);
                    setCandleTick((n) => n + 1);
                  }
                }}
              />
            </div>
          </TermPanel>

          <TermPanel title="PnL Journey" icon={Activity}>
            <div className="h-[240px] p-1.5 pt-2">
              <TradeJourneyChart curve={life.pnlCurve.map((p) => ({ t: p.t, pnl: p.pnl }))} markers={journeyMarkers} />
            </div>
          </TermPanel>
        </div>

        {/* RIGHT: position readout + lifecycle */}
        <div className="flex min-w-0 flex-col gap-3">
          <TermPanel title="Position" icon={Wallet}>
            <div className="p-3">
              <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--role-content-subtle)]">
                {life.isOpen ? 'Unrealized PnL' : 'Realized PnL'}
              </div>
              <div className="mt-1 flex items-end gap-2">
                <span className="text-[32px] font-medium leading-none tracking-tight tabular-nums" style={{ color: isUp ? 'var(--pos)' : 'var(--neg)' }}>
                  {isUp ? '+' : '−'}${formatNumber(Math.abs(life.finalPnl), 2)}
                </span>
                {roi != null && Number.isFinite(roi) && (
                  <span className="pb-0.5 text-[12px] font-medium tabular-nums" style={{ color: roi >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                    {roi >= 0 ? '+' : ''}{roi.toFixed(1)}%
                  </span>
                )}
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <MiniStat label="Peak" value={`+$${formatCompact(Math.max(0, life.peakPnl))}`} tone="pos" />
                <MiniStat label="Draw" value={`-$${formatCompact(Math.abs(Math.min(0, life.troughPnl)))}`} tone="neg" />
                <MiniStat label="Held" value={isFallback ? 'live' : formatDuration(heldMs)} />
              </div>

              <div className="mt-3 border-t border-[var(--role-line)]">
                <DataRow label="Avg Entry" value={`$${formatNumber(life.avgEntry, life.avgEntry < 10 ? 4 : 2)}`} />
                <DataRow label={life.isOpen ? 'Mark' : 'Exit'} value={lastPrice ? `$${formatNumber(lastPrice, lastPrice < 10 ? 4 : 2)}` : '—'} />
                <DataRow label="Size" value={`${formatNumber(life.peakSize, 4)} ${coin}`} />
                <DataRow label="Notional" value={`$${formatCompact(notionalPeak)}`} />
                {life.isOpen && livePos ? (
                  <>
                    <DataRow label="Leverage" value={livePos.leverage > 0 ? `${livePos.leverage}×` : '—'} />
                    <DataRow label="Liq." value={livePos.liquidationPrice > 0 ? `$${formatNumber(livePos.liquidationPrice, 2)}` : '—'} valueClass="text-[var(--neg)]" />
                  </>
                ) : (
                  <>
                    <DataRow label="Realized" value={`${life.realizedTotal >= 0 ? '+' : '−'}$${formatNumber(Math.abs(life.realizedTotal), 2)}`} valueClass={life.realizedTotal >= 0 ? 'text-[var(--pos)]' : 'text-[var(--neg)]'} />
                    <DataRow label="Fills" value={String(life.events.length)} />
                  </>
                )}
              </div>
            </div>
          </TermPanel>

          <TermPanel title="Lifecycle" icon={ListOrdered} right={`${life.events.length}`}>
            <ol className="max-h-[320px] overflow-y-auto overscroll-contain lg:max-h-[380px]">
              {isFallback && (
                <li className="border-b border-[var(--role-line-subtle)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--role-content-subtle)]">
                  Per-fill history unavailable (opened beyond BULK&apos;s window, or rate-limited) — live position marked to market.
                </li>
              )}
              {life.events.map((e, i) => (
                <TermEventRow key={`${e.t}-${i}`} e={e} coin={coin} />
              ))}
              {life.isOpen && (
                <li className="flex items-center gap-2 border-t border-[var(--role-line-subtle)] px-3 py-2 text-[11px]">
                  <CircleDot className="h-3.5 w-3.5 text-[var(--accent-text)]" />
                  <span className="font-medium text-[var(--role-content)]">tracking live</span>
                  <span className="ml-auto tabular-nums text-[var(--role-content-subtle)]">now</span>
                </li>
              )}
            </ol>
          </TermPanel>
        </div>
      </div>

      {/* Honest scope note */}
      <p className="mt-6 text-[11px] leading-relaxed text-[var(--role-content-subtle)]">
        Reconstructed from BULK fills and candles. Take-profit / stop-loss placements and isolated-margin
        top-ups aren&apos;t exposed by any BULK feed we read yet, so they aren&apos;t shown here.
      </p>
    </Shell>
  );
}

// Module-scope cache so the candle panel and the journey builder share one
// candle fetch per symbol without prop-drilling a fetch up the tree.
const candleCache = new Map<string, { t: number; o: number; h: number; l: number; c: number }[]>();

type LivePos = NonNullable<NonNullable<WalletData['live']>['positions']>[number];

// Fallback lifecycle for a LIVE position whose fills we couldn't load (aged out
// of BULK's window, or a transient 429). We can't reconstruct per-fill events,
// but the live snapshot gives us side/size/entry — enough to show the position
// and mark its unrealized PnL to market against the candle closes.
function liveFallbackLifecycle(
  symbol: string,
  pos: LivePos,
  candles: { t: number; o: number; h: number; l: number; c: number }[],
  markPrice: number | null,
): TradeLifecycle {
  const size = pos.size; // signed: + long, − short
  const entry = pos.price;
  const side: 'long' | 'short' = size > 0 ? 'long' : 'short';
  const now = Date.now();
  const mark = markPrice && markPrice > 0 ? markPrice : entry;
  const valid = candles.filter((c) => Number.isFinite(c.c) && c.c > 0);
  const openedAt = valid.length ? valid[0].t : now - 24 * 3_600_000;
  const curve = valid.map((c) => ({ t: c.t, realized: 0, pnl: size * (c.c - entry), price: c.c }));
  curve.push({ t: now, realized: 0, pnl: size * (mark - entry), price: mark });
  let peak = -Infinity;
  let trough = Infinity;
  for (const p of curve) { if (p.pnl > peak) peak = p.pnl; if (p.pnl < trough) trough = p.pnl; }
  return {
    symbol,
    side,
    openedAt,
    closedAt: null,
    isOpen: true,
    openPrice: entry,
    avgEntry: entry,
    peakSize: Math.abs(size),
    currentSize: size,
    events: [],
    pnlCurve: curve,
    realizedTotal: pos.realizedPnl ?? 0,
    peakPnl: peak,
    troughPnl: trough,
    finalPnl: curve.length ? curve[curve.length - 1].pnl : (pos.unrealizedPnl ?? 0),
  };
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[1760px] px-4 py-6 sm:px-6 lg:px-8">{children}</div>;
}

// A bordered terminal panel with an icon + uppercase title bar (BULK font).
function TermPanel({ title, icon: Icon, right, children }: { title: string; icon: LucideIcon; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-[var(--role-line)] bg-[var(--role-surface)]">
      <header className="flex items-center gap-2 border-b border-[var(--role-line)] px-3 py-2">
        <Icon className="h-3.5 w-3.5 text-[var(--accent-text)]" />
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--role-content-subtle)]">{title}</span>
        {right != null && <span className="ml-auto text-[11px] font-medium tabular-nums text-[var(--role-content-subtle)]">{right}</span>}
      </header>
      {children}
    </section>
  );
}

// LABEL ............ value row for the position readout.
function DataRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--role-line-subtle)] py-1.5 text-[12px] last:border-b-0">
      <span className="font-medium uppercase tracking-wider text-[var(--role-content-subtle)]">{label}</span>
      <span className={`font-medium tabular-nums ${valueClass ?? 'text-[var(--role-content)]'}`}>{value}</span>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="rounded border border-[var(--role-line-subtle)] px-2 py-1.5">
      <div className="text-[9px] font-medium uppercase tracking-wider text-[var(--role-content-subtle)]">{label}</div>
      <div className="mt-0.5 text-[13px] font-medium tabular-nums" style={tone ? { color: tone === 'pos' ? 'var(--pos)' : 'var(--neg)' } : undefined}>
        {value}
      </div>
    </div>
  );
}

// Small round action icon for a lifecycle event.
function eventIcon(e: TradeEventPoint) {
  if (e.action === 'open') return Flag;
  if (e.action === 'add') return Plus;
  if (e.action === 'reduce') return Minus;
  if (e.action === 'flip') return e.positionAfter > 0 ? ArrowUpRight : ArrowDownRight;
  return CircleDot; // close
}

// Compact one-line event row: icon · time · action · size @ price · realized.
function TermEventRow({ e, coin }: { e: TradeEventPoint; coin: string }) {
  const time = new Date(e.t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const building = e.action === 'open' || e.action === 'add';
  const tint = building ? 'var(--accent-text)' : (e.realizedDelta >= 0 ? 'var(--pos)' : 'var(--neg)');
  const Icon = eventIcon(e);
  return (
    <li className="flex items-center gap-2 border-b border-[var(--role-line-subtle)] px-3 py-2 text-[11px] last:border-b-0">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ background: 'color-mix(in srgb, currentColor 14%, transparent)', color: tint }}>
        <Icon className="h-3 w-3" />
      </span>
      <span className="shrink-0 tabular-nums text-[var(--role-content-subtle)]">{time}</span>
      <span className="shrink-0 font-medium uppercase tracking-wide" style={{ color: building ? 'var(--accent-text)' : 'var(--role-content)' }}>
        {e.actionLabel}
      </span>
      <span className="truncate tabular-nums text-[var(--role-content-subtle)]">
        {formatNumber(Math.abs(e.sizeDelta), 4)} @ {formatNumber(e.price, e.price < 10 ? 4 : 2)}
      </span>
      {Math.abs(e.realizedDelta) > 1e-6 && (
        <span className="ml-auto shrink-0 font-medium tabular-nums" style={{ color: e.realizedDelta >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
          {e.realizedDelta >= 0 ? '+' : '−'}${formatNumber(Math.abs(e.realizedDelta), 2)}
        </span>
      )}
    </li>
  );
}
