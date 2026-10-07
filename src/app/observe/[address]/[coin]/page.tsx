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
    (async () => {
      let wd: WalletData | null = null;
      try { wd = await wallet.getWallet(address); } catch { wd = null; }

      // Server-side symbol filter — an active wallet's per-coin fills get pushed
      // out of an unfiltered recent window by other markets, so ask BULK for
      // this coin's fills directly. RETRY until we get a non-empty result: the
      // fills call can transiently 429 to EMPTY, and a one-shot empty wrongly
      // reads as "No <coin> trade found" for a coin the wallet actually traded
      // (the position modal, fetched separately, shows the fills fine). We keep
      // the last response so a genuinely-empty coin still resolves after retries.
      let fl: WalletFill[] = [];
      for (let attempt = 0; attempt < 4 && !cancelled; attempt++) {
        try {
          const r = await wallet.getFills(address, { symbol: `${coin}-USD`, limit: 1000 });
          fl = r.fills || [];
          if (fl.length > 0) break;
        } catch { /* transient — retry below */ }
        if (attempt < 3) await new Promise((res) => setTimeout(res, 700 * (attempt + 1)));
      }
      if (cancelled) return;
      setWalletData(wd);
      setFills(fl);
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <div className="flex h-[60vh] items-center justify-center gap-2 text-[var(--text-tertiary)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Reconstructing trade…
        </div>
      </Shell>
    );
  }

  if (error || !life) {
    return (
      <Shell>
        <div className="mx-auto mt-16 max-w-md rounded-xl border border-[var(--border-color)] bg-[var(--bg-muted)] p-6 text-center">
          <p className="text-sm text-[var(--text-primary)]">
            {error ?? `No ${coin} trade found for this wallet in the available fill history.`}
          </p>
          <p className="mt-2 text-xs text-[var(--text-tertiary)]">
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
      {/* Back link */}
      <Link href={`/whales/${address}`} className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to wallet
      </Link>

      {/* Header card — coin + pair + side/status, actions on the right */}
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-muted)] px-4 py-3.5">
        <span className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full" style={{ background: coinColor }}>
          <span className="text-sm font-semibold text-white">{coin.slice(0, 1)}</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/coins/${coin}.svg`}
            alt=""
            className="absolute inset-0 h-9 w-9 object-cover"
            onError={(e) => {
              const el = e.currentTarget as HTMLImageElement;
              if (!el.dataset.triedPng) { el.dataset.triedPng = '1'; el.src = `/coins/${coin}.png`; }
              else { el.style.display = 'none'; }
            }}
          />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-lg font-medium text-[var(--text-primary)]">{coin}/USD</span>
            <span
              className="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
              style={{ color: life.side === 'long' ? 'var(--pos)' : 'var(--neg)', borderColor: life.side === 'long' ? 'var(--pos)' : 'var(--neg)', background: `color-mix(in srgb, ${life.side === 'long' ? 'var(--pos)' : 'var(--neg)'} 14%, transparent)` }}
            >
              {life.side === 'long' ? 'Long' : 'Short'}{livePos?.leverage ? ` ${Number(livePos.leverage.toFixed(1))}×` : ''}
            </span>
            {/* Open/Closed — a real pill so it doesn't blend into the bg */}
            <span
              className="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
              style={life.isOpen
                ? { color: 'var(--accent-text)', borderColor: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 16%, transparent)' }
                : { color: 'var(--text-secondary)', borderColor: 'var(--border-color)', background: 'var(--bg-base)' }}
            >
              {life.isOpen ? '● Open' : 'Closed'}
            </span>
          </div>
          <div className="mt-1 font-mono text-[11px] leading-snug text-[var(--text-tertiary)] break-all">
            {address}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowCard(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_26%,transparent)]"
          >
            <ImageIcon className="h-3.5 w-3.5" /> Card
          </button>
          <button
            onClick={share}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
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
            events: life.events.map((e) => ({ t: e.t, price: e.price, buy: e.sizeDelta > 0, action: e.action, label: e.actionLabel, realized: e.realizedDelta, units: Math.abs(e.sizeDelta) })),
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
              <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
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

              <div className="mt-3 border-t border-[var(--border-color)]">
                <DataRow label="Avg Entry" value={`$${formatNumber(life.avgEntry, life.avgEntry < 10 ? 4 : 2)}`} />
                <DataRow label={life.isOpen ? 'Mark' : 'Exit'} value={lastPrice ? `$${formatNumber(lastPrice, lastPrice < 10 ? 4 : 2)}` : '—'} />
                <DataRow label="Size" value={`${formatNumber(life.peakSize, 4)} ${coin}`} />
                {/* Notional = position VALUE (size × avg entry). Margin needs
                    leverage, which BULK only reports on LIVE positions — so it's
                    "—" for reconstructed/closed trades rather than wrong. */}
                <DataRow label="Notional" value={`$${formatCompact(notionalPeak)}`} />
                <DataRow
                  label="Leverage"
                  value={livePos && livePos.leverage > 0 ? `${Number(livePos.leverage.toFixed(1))}×` : '—'}
                />
                {livePos && livePos.leverage > 0 && (
                  <DataRow label="Margin" value={`$${formatCompact(notionalPeak / livePos.leverage)}`} />
                )}
                {life.isOpen && livePos && livePos.liquidationPrice > 0 && (
                  <DataRow label="Liq." value={`$${formatNumber(livePos.liquidationPrice, 2)}`} valueClass="text-[var(--neg)]" />
                )}
                <DataRow label="Realized" value={`${life.realizedTotal >= 0 ? '+' : '−'}$${formatNumber(Math.abs(life.realizedTotal), 2)}`} valueClass={life.realizedTotal >= 0 ? 'text-[var(--pos)]' : 'text-[var(--neg)]'} />
                <DataRow label="Fills" value={String(life.events.length)} />
              </div>
            </div>
          </TermPanel>

          <TermPanel title="Lifecycle" icon={ListOrdered} right={`${life.events.length}`}>
            <ol className="max-h-[320px] overflow-y-auto overscroll-contain lg:max-h-[380px]">
              {isFallback && (
                <li className="border-b border-[var(--border-color)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                  Per-fill history unavailable (opened beyond BULK&apos;s window, or rate-limited) — live position marked to market.
                </li>
              )}
              {life.events.map((e, i) => (
                <TermEventRow key={`${e.t}-${i}`} e={e} coin={coin} />
              ))}
              {life.isOpen && (
                <li className="flex items-center gap-2 border-t border-[var(--border-color)] px-3 py-2 text-[11px]">
                  <CircleDot className="h-3.5 w-3.5 text-[var(--accent-text)]" />
                  <span className="font-medium text-[var(--text-primary)]">tracking live</span>
                  <span className="ml-auto tabular-nums text-[var(--text-tertiary)]">now</span>
                </li>
              )}
            </ol>
          </TermPanel>
        </div>
      </div>

      {/* Honest scope note */}
      <p className="mt-6 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
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

// A clean rounded card panel — matches the share-card aesthetic.
function TermPanel({ title, icon: Icon, right, children }: { title: string; icon: LucideIcon; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-muted)]">
      <header className="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
        <Icon className="h-3.5 w-3.5 text-[var(--accent)]" />
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-tertiary)]">{title}</span>
        {right != null && <span className="ml-auto text-[11px] font-medium tabular-nums text-[var(--text-tertiary)]">{right}</span>}
      </header>
      {children}
    </section>
  );
}

// LABEL ............ value row for the position readout.
function DataRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border-color)]/60 py-2 text-[13px] last:border-b-0">
      <span className="text-[var(--text-tertiary)]">{label}</span>
      <span className={`font-medium tabular-nums ${valueClass ?? 'text-[var(--text-primary)]'}`}>{value}</span>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-base)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">{label}</div>
      <div className="mt-0.5 text-[14px] font-medium tabular-nums" style={tone ? { color: tone === 'pos' ? 'var(--pos)' : 'var(--neg)' } : undefined}>
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
    <li className="flex items-center gap-2 border-b border-[var(--border-color)] px-3 py-2 text-[11px] last:border-b-0">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ background: 'color-mix(in srgb, currentColor 14%, transparent)', color: tint }}>
        <Icon className="h-3 w-3" />
      </span>
      <span className="shrink-0 tabular-nums text-[var(--text-tertiary)]">{time}</span>
      <span className="shrink-0 font-medium uppercase tracking-wide" style={{ color: building ? 'var(--accent-text)' : 'var(--text-primary)' }}>
        {e.actionLabel}
      </span>
      <span className="truncate tabular-nums text-[var(--text-tertiary)]">
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
