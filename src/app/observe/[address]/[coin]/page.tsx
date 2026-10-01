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
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Check, Share2, Loader2, CircleDot, ExternalLink } from 'lucide-react';
import { wallet, formatNumber, formatCompact, formatAddress, type WalletData, type WalletFill } from '@/lib/api';
import { buildTradeLifecycle, formatDuration, type TradeLifecycle, type TradeEventPoint } from '@/lib/positionWalk';
import { TradeJourneyChart, type JourneyMarker } from '@/components/TradeJourneyChart';
import { TradeCandlePanel } from '@/components/TradeCandlePanel';
import { getCoinColor } from '@/lib/coins';

export default function ObserveTradePage() {
  const params = useParams<{ address: string; coin: string }>();
  const address = String(params.address || '');
  const coin = String(params.coin || '').toUpperCase().replace(/-USD$/, '');

  const [walletData, setWalletData] = useState<WalletData | null>(null);
  const [fills, setFills] = useState<WalletFill[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
    if (coinFills.length) {
      const l = buildTradeLifecycle(coinFills, candles, { markPrice });
      if (l) return l;
    }
    // Fills unavailable (aged out of BULK's window, or a transient 429) but the
    // wallet DOES have a live position here — reconstruct what we can from the
    // live snapshot so an open trade never reads as "not found". The journey is
    // marked-to-market against candles (constant size/entry); there are no
    // per-fill events, so the lifecycle rail is empty.
    if (livePos && Math.abs(livePos.size) > 1e-9) {
      return liveFallbackLifecycle(symbol, livePos, candles, markPrice);
    }
    return null;
  }, [coinFills, symbol, markPrice, candleTick, livePos]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--role-line)] pb-3 font-mono">
        <Link href={`/whales/${address}`} className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider text-[var(--role-content-subtle)] transition-colors hover:text-[var(--role-content)]">
          <ArrowLeft className="h-3.5 w-3.5" /> Wallet
        </Link>
        <span className="text-[var(--role-line)]">/</span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: coinColor }} />
          <span className="text-sm font-semibold tracking-wide text-[var(--role-content)]">{coin}</span>
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: life.side === 'long' ? 'var(--pos)' : 'var(--neg)' }}>
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
            onClick={share}
            className="inline-flex items-center gap-1.5 border border-[var(--role-line)] px-2.5 py-1 text-[11px] uppercase tracking-wider text-[var(--role-content)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-text)]"
          >
            {copied ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Share2 className="h-3.5 w-3.5" /> Share</>}
          </button>
        </div>
      </div>

      {/* Terminal grid — big chart left, data readout right. */}
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* LEFT: price (big) + journey */}
        <div className="flex min-w-0 flex-col gap-3">
          <TermPanel title="Price & Fills">
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

          <TermPanel title="PnL Journey">
            <div className="h-[240px] p-1.5 pt-2">
              <TradeJourneyChart curve={life.pnlCurve.map((p) => ({ t: p.t, pnl: p.pnl }))} markers={journeyMarkers} />
            </div>
          </TermPanel>
        </div>

        {/* RIGHT: position readout + lifecycle */}
        <div className="flex min-w-0 flex-col gap-3">
          <TermPanel title="Position">
            <div className="p-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--role-content-subtle)]">
                {life.isOpen ? 'Unrealized PnL' : 'Realized PnL'}
              </div>
              <div className="mt-1 flex items-end gap-2">
                <span className="font-mono text-[30px] font-semibold leading-none tabular-nums" style={{ color: isUp ? 'var(--pos)' : 'var(--neg)' }}>
                  {isUp ? '+' : '−'}${formatNumber(Math.abs(life.finalPnl), 2)}
                </span>
                {roi != null && Number.isFinite(roi) && (
                  <span className="pb-0.5 font-mono text-[12px] tabular-nums" style={{ color: roi >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
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
                <DataRow label={life.isOpen ? 'Mark' : 'Last'} value={markPrice ? `$${formatNumber(markPrice, markPrice < 10 ? 4 : 2)}` : '—'} />
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

          <TermPanel title="Lifecycle" right={`${life.events.length}`}>
            <ol className="max-h-[320px] overflow-y-auto overscroll-contain lg:max-h-[380px]">
              {isFallback && (
                <li className="border-b border-[var(--role-line-subtle)] px-3 py-2.5 font-mono text-[11px] leading-relaxed text-[var(--role-content-subtle)]">
                  Per-fill history unavailable (opened beyond BULK&apos;s window, or rate-limited) — live position marked to market.
                </li>
              )}
              {life.events.map((e, i) => (
                <TermEventRow key={`${e.t}-${i}`} e={e} coin={coin} />
              ))}
              {life.isOpen && (
                <li className="flex items-center gap-2 border-t border-[var(--role-line-subtle)] px-3 py-2 font-mono text-[11px]">
                  <CircleDot className="h-3 w-3 text-[var(--accent-text)]" />
                  <span className="text-[var(--role-content)]">tracking live</span>
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
  return <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">{children}</div>;
}

// A bordered terminal panel with a mono uppercase title bar.
function TermPanel({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-[var(--role-line)] bg-[var(--role-surface)]">
      <header className="flex items-center gap-2 border-b border-[var(--role-line)] px-3 py-1.5">
        <span className="h-1.5 w-1.5 rounded-[1px]" style={{ background: 'var(--accent)' }} />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--role-content-subtle)]">{title}</span>
        {right != null && <span className="ml-auto font-mono text-[11px] tabular-nums text-[var(--role-content-subtle)]">{right}</span>}
      </header>
      {children}
    </section>
  );
}

// LABEL ............ value row for the position readout.
function DataRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--role-line-subtle)] py-1.5 font-mono text-[12px] last:border-b-0">
      <span className="uppercase tracking-wider text-[var(--role-content-subtle)]">{label}</span>
      <span className={`tabular-nums ${valueClass ?? 'text-[var(--role-content)]'}`}>{value}</span>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="rounded border border-[var(--role-line-subtle)] px-2 py-1.5">
      <div className="font-mono text-[9px] uppercase tracking-wider text-[var(--role-content-subtle)]">{label}</div>
      <div className="mt-0.5 font-mono text-[12px] font-semibold tabular-nums" style={tone ? { color: tone === 'pos' ? 'var(--pos)' : 'var(--neg)' } : undefined}>
        {value}
      </div>
    </div>
  );
}

// Compact one-line terminal event row: time · action · size @ price · realized.
function TermEventRow({ e, coin }: { e: TradeEventPoint; coin: string }) {
  const time = new Date(e.t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const building = e.action === 'open' || e.action === 'add';
  return (
    <li className="flex items-center gap-2 border-b border-[var(--role-line-subtle)] px-3 py-1.5 font-mono text-[11px] last:border-b-0">
      <span className="shrink-0 tabular-nums text-[var(--role-content-subtle)]">{time}</span>
      <span className="shrink-0 uppercase tracking-wide" style={{ color: building ? 'var(--accent-text)' : 'var(--role-content)' }}>
        {e.actionLabel}
      </span>
      <span className="truncate tabular-nums text-[var(--role-content-subtle)]">
        {formatNumber(Math.abs(e.sizeDelta), 4)} @ {formatNumber(e.price, e.price < 10 ? 4 : 2)}
      </span>
      {Math.abs(e.realizedDelta) > 1e-6 && (
        <span className="ml-auto shrink-0 tabular-nums" style={{ color: e.realizedDelta >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
          {e.realizedDelta >= 0 ? '+' : '−'}${formatNumber(Math.abs(e.realizedDelta), 2)}
        </span>
      )}
    </li>
  );
}
