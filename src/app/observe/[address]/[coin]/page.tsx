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
import {
  ArrowLeft, Check, Copy, Share2, TrendingUp, TrendingDown, Loader2,
  ArrowUpRight, ArrowDownRight, Flag, Plus, Minus, CircleDot, ExternalLink,
} from 'lucide-react';
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
      wallet.getFills(address, { limit: 2000 }).then((r) => r.fills).catch(() => [] as WalletFill[]),
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
    if (!coinFills.length) return null;
    // Candles are fetched inside TradeCandlePanel; the journey curve is built
    // against the same candle set once it arrives (see candleCache below).
    return buildTradeLifecycle(coinFills, candleCache.get(symbol) ?? [], { markPrice });
  }, [coinFills, symbol, markPrice, candleTick]); // eslint-disable-line react-hooks/exhaustive-deps

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
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/whales/${address}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--role-content-subtle)] transition-colors hover:text-[var(--role-content)]">
          <ArrowLeft className="h-3.5 w-3.5" /> Wallet
        </Link>
        <span className="text-[var(--role-line)]">/</span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: coinColor }} />
          <span className="font-sans text-lg font-medium">{coin}</span>
        </span>
        <SidePill side={life.side} />
        <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${life.isOpen ? 'bg-[var(--accent)]/15 text-[var(--accent-text)]' : 'bg-[var(--bg-muted)] text-[var(--role-content-subtle)]'}`}>
          {life.isOpen ? 'OPEN' : 'CLOSED'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Link href={`/whales/${address}`} className="hidden items-center gap-1 text-[11px] text-[var(--role-content-subtle)] hover:text-[var(--role-content)] sm:inline-flex">
            {formatAddress(address)} <ExternalLink className="h-3 w-3" />
          </Link>
          <button
            onClick={share}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--role-line)] bg-[var(--role-surface)] px-3 py-1.5 text-xs font-medium text-[var(--role-content)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-text)]"
          >
            {copied ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Share2 className="h-3.5 w-3.5" /> Share</>}
          </button>
        </div>
      </div>

      {/* Hero PnL */}
      <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--role-content-subtle)]">
            {life.isOpen ? 'Unrealized PnL' : 'Realized PnL'}
          </p>
          <p className="font-sans text-[44px] font-medium leading-none tracking-tight tabular-nums" style={{ color: isUp ? 'var(--pos)' : 'var(--neg)' }}>
            {isUp ? '+' : '−'}${formatNumber(Math.abs(life.finalPnl), 2)}
          </p>
        </div>
        {roi != null && Number.isFinite(roi) && (
          <HeroStat label="Return" value={`${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%`} tone={roi >= 0 ? 'pos' : 'neg'} />
        )}
        <HeroStat label="Peak" value={`+$${formatCompact(Math.max(0, life.peakPnl))}`} tone="pos" />
        <HeroStat label="Drawdown" value={`-$${formatCompact(Math.abs(Math.min(0, life.troughPnl)))}`} tone="neg" />
        <HeroStat label="Held" value={formatDuration(heldMs)} />
      </div>

      {/* Stat strip */}
      <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[var(--role-line)] bg-[var(--role-line-subtle)] sm:grid-cols-4 lg:grid-cols-6">
        <Cell label="Avg Entry" value={`$${formatNumber(life.avgEntry, life.avgEntry < 10 ? 4 : 2)}`} />
        <Cell label={life.isOpen ? 'Mark' : 'Last'} value={markPrice ? `$${formatNumber(markPrice, markPrice < 10 ? 4 : 2)}` : '—'} />
        <Cell label="Peak Size" value={`${formatNumber(life.peakSize, 4)} ${coin}`} />
        <Cell label="Peak Notional" value={`$${formatCompact(notionalPeak)}`} />
        {life.isOpen && livePos ? (
          <>
            <Cell label="Leverage" value={livePos.leverage > 0 ? `${livePos.leverage}×` : '—'} />
            <Cell label="Liq. Price" value={livePos.liquidationPrice > 0 ? `$${formatNumber(livePos.liquidationPrice, 2)}` : '—'} valueClass="text-[var(--neg)]" />
          </>
        ) : (
          <>
            <Cell label="Realized" value={`${life.realizedTotal >= 0 ? '+' : '−'}$${formatNumber(Math.abs(life.realizedTotal), 2)}`} valueClass={life.realizedTotal >= 0 ? 'text-[var(--pos)]' : 'text-[var(--neg)]'} />
            <Cell label="Fills" value={String(life.events.length)} />
          </>
        )}
      </div>

      {/* Journey + price */}
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <SectionLabel>PnL journey</SectionLabel>
          <div className="rounded-xl border border-[var(--role-line)] bg-[var(--role-surface)] p-2 pt-3">
            <TradeJourneyChart curve={life.pnlCurve.map((p) => ({ t: p.t, pnl: p.pnl }))} markers={journeyMarkers} height={300} />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--role-content-subtle)]">
            Realized steps are booked at each reduce/close; the open leg is marked against hourly closes in between. Dots mark every fill.
          </p>
        </section>

        <section className="lg:col-span-2">
          <SectionLabel>Price &amp; fills</SectionLabel>
          <div className="h-[300px] rounded-xl border border-[var(--role-line)] bg-[var(--role-surface)] p-2 sm:h-[342px]">
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
        </section>
      </div>

      {/* Event rail */}
      <section className="mt-6">
        <SectionLabel>Lifecycle</SectionLabel>
        <ol className="overflow-hidden rounded-xl border border-[var(--role-line)]">
          {life.events.map((e, i) => (
            <EventRow key={`${e.t}-${i}`} e={e} coin={coin} first={i === 0} last={i === life.events.length - 1} />
          ))}
          {life.isOpen && (
            <li className="flex items-center gap-3 border-t border-[var(--role-line-subtle)] bg-[var(--role-surface)] px-4 py-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)]/15 text-[var(--accent-text)]">
                <CircleDot className="h-3.5 w-3.5" />
              </span>
              <span className="text-sm text-[var(--role-content)]">Still open — tracking live</span>
              <span className="ml-auto text-xs tabular-nums text-[var(--role-content-subtle)]">now</span>
            </li>
          )}
        </ol>
      </section>

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

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">{children}</div>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-3">
      <h2 className="text-[11px] font-medium uppercase tracking-wider text-[var(--role-content-subtle)]">{children}</h2>
      <span className="h-px flex-1 bg-[var(--role-line)]" />
    </div>
  );
}

function SidePill({ side }: { side: 'long' | 'short' }) {
  const long = side === 'long';
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide"
      style={{ background: long ? 'rgb(var(--pos-rgb,33 192 122)/0.15)' : 'rgb(var(--neg-rgb,229 72 77)/0.15)', color: long ? 'var(--pos)' : 'var(--neg)' }}
    >
      {long ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {side}
    </span>
  );
}

function HeroStat({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--role-content-subtle)]">{label}</p>
      <p className="mt-0.5 font-sans text-xl font-medium tabular-nums" style={tone ? { color: tone === 'pos' ? 'var(--pos)' : 'var(--neg)' } : undefined}>
        {value}
      </p>
    </div>
  );
}

function Cell({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="bg-[var(--role-surface)] px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--role-content-subtle)]">{label}</p>
      <p className={`mt-0.5 text-sm font-medium tabular-nums ${valueClass ?? 'text-[var(--role-content)]'}`}>{value}</p>
    </div>
  );
}

function EventRow({ e, coin, first, last }: { e: TradeEventPoint; coin: string; first: boolean; last: boolean }) {
  const icon =
    e.action === 'open' ? <Flag className="h-3.5 w-3.5" /> :
    e.action === 'add' ? <Plus className="h-3.5 w-3.5" /> :
    e.action === 'reduce' ? <Minus className="h-3.5 w-3.5" /> :
    e.action === 'flip' ? (e.positionAfter > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />) :
    <CircleDot className="h-3.5 w-3.5" />;
  const building = e.action === 'open' || e.action === 'add';
  const tint = building ? 'var(--accent-text)' : (e.realizedDelta >= 0 ? 'var(--pos)' : 'var(--neg)');
  const bg = building ? 'bg-[var(--accent)]/15' : (e.realizedDelta >= 0 ? 'bg-[var(--pos)]/12' : 'bg-[var(--neg)]/12');
  return (
    <li className={`flex items-center gap-3 bg-[var(--role-surface)] px-4 py-3 ${first ? '' : 'border-t border-[var(--role-line-subtle)]'}`}>
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${bg}`} style={{ color: tint }}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--role-content)]">{e.actionLabel}</p>
        <p className="text-[11px] tabular-nums text-[var(--role-content-subtle)]">
          {formatNumber(Math.abs(e.sizeDelta), 4)} {coin} @ ${formatNumber(e.price, e.price < 10 ? 4 : 2)}
          {' · '}net {formatNumber(Math.abs(e.positionAfter), 4)}
        </p>
      </div>
      <div className="ml-auto text-right">
        {Math.abs(e.realizedDelta) > 1e-6 && (
          <p className="text-sm font-medium tabular-nums" style={{ color: e.realizedDelta >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
            {e.realizedDelta >= 0 ? '+' : '−'}${formatNumber(Math.abs(e.realizedDelta), 2)}
          </p>
        )}
        <p className="text-[11px] tabular-nums text-[var(--role-content-subtle)]">
          {new Date(e.t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </li>
  );
}
