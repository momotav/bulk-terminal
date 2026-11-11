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
import { ArrowLeft, Check, Share2, Loader2, Image as ImageIcon } from 'lucide-react';
import { wallet, cn, formatNumber, formatCompact, formatAddress, type WalletData, type WalletFill, type ClosedPosition } from '@/lib/api';
import { buildTradeLifecycle, closedTradeLifecycle, formatDuration, type TradeLifecycle } from '@/lib/positionWalk';
import { anchorFills } from '@/lib/walletMetrics';
import { pnlColor } from '@/lib/walletFormat';
import { TradeCandlePanel } from '@/components/TradeCandlePanel';
import { TradeShareCard } from '@/components/TradeShareCard';
import { CoinIcon } from '@/components/CoinIcon';
import { PnlChart, type PnlHover } from '@/components/wallet/PnlChart';

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
  // Closed-position records for this coin (only fetched for a pinned CLOSED
  // trade). For high-frequency wallets the net position never goes flat, so
  // fills-reconstruction can't isolate one lot — BULK's own closed record is the
  // authoritative source for that trade's realized PnL / entry / exit / size.
  const [closedPositions, setClosedPositions] = useState<ClosedPosition[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showCard, setShowCard] = useState(false);
  const [tab, setTab] = useState<'journey' | 'fills'>('journey');
  const [journeyHover, setJourneyHover] = useState<PnlHover | null>(null);

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
          const r = await wallet.getFills(address, { symbol: `${coin}-USD`, limit: 40000 });
          fl = r.fills || [];
          if (fl.length > 0) break;
        } catch { /* transient — retry below */ }
        if (attempt < 3) await new Promise((res) => setTimeout(res, 700 * (attempt + 1)));
      }
      // For a pinned CLOSED trade (both from & to), also pull BULK's closed
      // positions for this coin so we can anchor the view to the exact lot
      // record rather than a fills reconstruction (which merges with the live
      // position on wallets that never flatten). Non-blocking — the page still
      // renders from fills if this fails.
      let cp: ClosedPosition[] | null = null;
      if (toMs > 0) {
        for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
          try {
            const r = await wallet.getClosedPositions(address, { symbol: `${coin}-USD`, limit: 10000 });
            cp = r.positions || [];
            if (cp.length > 0) break;
          } catch { /* transient — retry */ }
          if (attempt < 2) await new Promise((res) => setTimeout(res, 600 * (attempt + 1)));
        }
      }
      if (cancelled) return;
      setWalletData(wd);
      // Very busy wallets outrun BULK's fill history, so seed the walk from the
      // live position rather than letting it start flat and guess the side.
      const live = wd?.live?.positions?.find((p) => p.symbol === `${coin}-USD`);
      setFills(live ? anchorFills(fl, live.size, live.price).fills : fl);
      setClosedPositions(cp);
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

  // For a pinned CLOSED trade, find the matching BULK closed-position record.
  // Match by CLOSE time (the URL's `to`) — BULK's openTime can be unreliable but
  // the close time is solid. This is the exact lot the wallet row linked to, and
  // its realized PnL / entry / exit / size are authoritative (unlike a fills
  // reconstruction, which on a scalping wallet merges into the live open book).
  const pinnedRecord = useMemo<ClosedPosition | null>(() => {
    if (!pinned || toMs <= 0 || !closedPositions || !closedPositions.length) return null;
    let best: ClosedPosition | null = null;
    let bestDiff = Infinity;
    for (const p of closedPositions) {
      const d = Math.abs(p.closedAt - toMs);
      if (d < bestDiff) { bestDiff = d; best = p; }
    }
    return best && bestDiff <= 5000 ? best : null;
  }, [pinned, toMs, closedPositions]);

  // Leverage. BULK's closed-position records carry NO leverage, and the only
  // leverage-like value the API exposes for a market is `leverageSettings` — but
  // that's the exchange-wide MAX leverage for the coin (identical across every
  // wallet), NOT the user's actual chosen leverage. So the real per-position
  // leverage is only knowable for a LIVE position. For a CLOSED trade we can only
  // state a BOUND: actual leverage ≤ maxLeverage ⟹ actual margin ≥ notional/max.
  const maxLeverage = useMemo(() => {
    const s = walletData?.live?.leverageSettings?.find(
      (e) => e.symbol.replace(/-USD$/, '').toUpperCase() === coin,
    );
    return s?.leverage ?? 0;
  }, [walletData, coin]);
  // Use the live position's actual leverage ONLY when we're showing that live
  // position — never for a pinned CLOSED trade (that's a different, earlier lot;
  // the live 20× would be misleading). Closed trades fall back to the max bound.
  const liveLeverage = !pinnedRecord && livePos?.leverage && livePos.leverage > 0 ? livePos.leverage : 0;
  // What we display per row: the actual live leverage when we have it, else the
  // market max as an explicit bound (relabeled "Max leverage" / "Min margin").
  const shownLeverage = liveLeverage || maxLeverage;
  const leverageIsBound = liveLeverage === 0 && maxLeverage > 0;

  // The journey curve needs candles too. Rather than fetch them twice, the
  // candle panel reports the candles it loaded back up here via a shared
  // module cache, which bumps candleTick to rebuild the lifecycle with prices.
  const [candleTick, setCandleTick] = useState(0);

  const life = useMemo<TradeLifecycle | null>(() => {
    const candles = candleCache.get(symbol) ?? [];
    // Pinned CLOSED trade. PREFER the fills reconstruction when it reproduces the
    // record's realized PnL — only it carries the liquidation markers + liq-price
    // line. Fall back to the authoritative BULK record for high-frequency / scalper
    // lots where fills can't cleanly isolate the trade (the original reason this
    // path existed — fills merge into the live book there).
    if (pinnedRecord) {
      return closedTradeLifecycle(pinnedRecord, symbol, tradeFills, candles, { markPrice, leverage: maxLeverage });
    }
    // Candles are fetched inside TradeCandlePanel; the journey curve is built
    // against the same candle set once it arrives (see candleCache below).
    if (tradeFills.length) {
      // Pass leverage (actual for a live position, else the market-max bound) and
      // the live liq price so the lifecycle can reconstruct the liquidation-price
      // line — it widens at partial liquidations.
      const l = buildTradeLifecycle(tradeFills, candles, {
        markPrice,
        leverage: liveLeverage || maxLeverage,
        liqPrice: livePos?.liquidationPrice ?? null,
      });
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
  }, [tradeFills, symbol, markPrice, candleTick, livePos, toMs, pinnedRecord]); // eslint-disable-line react-hooks/exhaustive-deps


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
          <Link href={`/wallet/${address}`} className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent-text)] hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to wallet
          </Link>
        </div>
      </Shell>
    );
  }

  // BULK leaves closeReason 'normal' on these, so the liquidation fills are the signal.
  const liquidated = !life.isOpen && (pinnedRecord?.liquidated || life.events.some((e) => e.liq === 'partial' || e.liq === 'full'));
  // For a LIVE position, prefer BULK's authoritative unrealized PnL over the
  // fills-reconstructed value so the number matches the wallet page exactly.
  const displayPnl = (life.isOpen && livePos && Number.isFinite(livePos.unrealizedPnl))
    ? livePos.unrealizedPnl
    : life.finalPnl;
  const isUp = displayPnl >= 0;
  const notionalPeak = life.peakSize * life.avgEntry;
  const roi = notionalPeak > 0 ? (displayPnl / (liveLeverage > 0 ? notionalPeak / liveLeverage : notionalPeak)) * 100 : null;
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

  const money = (n: number) => `$${formatNumber(n, n < 10 ? 4 : 2)}`;
  const curve = life.pnlCurve.map((p) => ({ t: p.t, v: p.pnl }));
  const shown = journeyHover ? journeyHover.point.v : displayPnl;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] lg:min-h-[calc(100vh-57px)]">
      {/* Left rail: the trade at a glance, same structure as the wallet page. */}
      <aside className="bg-[var(--role-surface-raised)] lg:border-r border-b lg:border-b-0 border-[var(--border-color)] px-5 py-5 flex flex-col gap-5 min-w-0">
        <Link href={`/wallet/${address}`} className="inline-flex items-center gap-1.5 self-start text-[13px] text-[var(--role-content-muted)] hover:text-[var(--role-content)] transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" /> {formatAddress(address)}
        </Link>

        <div className="flex items-center gap-3 min-w-0">
          <CoinIcon symbol={symbol} size={32} className="shrink-0" />
          <div className="min-w-0">
            <div className="text-[18px] leading-tight text-[var(--role-content)]">{coin}/USD</div>
            <div className="mt-0.5 text-[13px] text-[var(--role-content-muted)]">
              <span style={{ color: life.side === 'long' ? 'var(--pos)' : 'var(--neg)' }}>{life.side === 'long' ? 'Long' : 'Short'}</span>
              {liveLeverage > 0 ? ` ${Number(liveLeverage.toFixed(1))}×` : ''} · {liquidated ? 'Liquidated' : life.isOpen ? 'Open' : 'Closed'}
            </div>
          </div>
        </div>

        <div>
          <div className="text-[13px] text-[var(--role-content-muted)]">{life.isOpen ? 'Unrealized PnL' : 'Realized PnL'}</div>
          <div className="mt-1.5 text-[40px] leading-none font-medium tabular-nums tracking-tight" style={{ color: pnlColor(displayPnl) }}>{signed2(displayPnl)}</div>
          {roi != null && Number.isFinite(roi) && (
            <div className="mt-2 text-[13px] tabular-nums text-[var(--role-content-muted)]">
              {roi >= 0 ? '+' : '−'}{Math.abs(roi).toFixed(2)}% on {liveLeverage > 0 ? 'margin' : 'position size'}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={() => setShowCard(true)}
            className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-[var(--role-content)] text-[var(--bg-base)] text-[13px] transition-opacity hover:opacity-90">
            <ImageIcon className="h-3.5 w-3.5" /> Card
          </button>
          <button type="button" onClick={share}
            className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg border border-[var(--border-color)] text-[13px] text-[var(--role-content)] hover:bg-[var(--bg-muted)] transition-colors">
            {copied ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Share2 className="h-3.5 w-3.5" /> Share</>}
          </button>
        </div>

        <div>
          <Row label="Avg. entry" value={money(life.avgEntry)} />
          <Row label={life.isOpen ? 'Mark' : 'Exit'} value={lastPrice ? money(lastPrice) : '—'} />
          <Row label="Size" value={`${formatNumber(life.peakSize, 4)} ${coin}`} />
          <Row label="Value" value={`$${formatCompact(notionalPeak)}`} />
          {/* BULK records no leverage on a closed trade. The only figure it exposes is
              the market maximum, so a closed trade shows that bound, not the trader's pick. */}
          <Row label={leverageIsBound ? 'Max leverage' : 'Leverage'} value={shownLeverage > 0 ? `${Number(shownLeverage.toFixed(1))}×` : '—'} />
          {shownLeverage > 0 && <Row label={leverageIsBound ? 'Min margin' : 'Margin'} value={`${leverageIsBound ? '≥ ' : ''}$${formatCompact(notionalPeak / shownLeverage)}`} />}
          {life.isOpen && livePos && livePos.liquidationPrice > 0 && <Row label="Liq. price" value={money(livePos.liquidationPrice)} color="var(--neg)" />}
          {life.isOpen && <Row label="Realized" value={signed2(life.realizedTotal)} color={pnlColor(life.realizedTotal)} />}
          <Row label="Best" value={signed2(Math.max(0, life.peakPnl))} />
          <Row label="Worst" value={signed2(Math.min(0, life.troughPnl))} />
          <Row label="Held" value={isFallback ? 'Live' : formatDuration(heldMs)} />
        </div>

        <p className="mt-auto text-[12px] leading-relaxed text-[var(--role-content-subtle)]">Rebuilt from BULK fills and candles.</p>
      </aside>

      {/* Right: flush panels separated by hairlines. */}
      <div className="min-w-0 flex flex-col bg-[var(--bg-muted)]">
        <section className="border-b border-[var(--border-color)]">
          <div className="h-[420px] sm:h-[520px]">
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
                // The journey is marked against these. Keep the finest set seen for this
                // trade, or switching the chart to 1D would flatten it to a straight line.
                const end = life.closedAt ?? Date.now();
                const inTrade = (list: { t: number }[]) => list.filter((c) => c.t >= life.openedAt && c.t <= end).length;
                if (cs.length && inTrade(cs) > inTrade(candleCache.get(symbol) ?? [])) {
                  candleCache.set(symbol, cs);
                  setCandleTick((n) => n + 1);
                }
              }}
            />
          </div>
        </section>

        <section className="flex-1 min-h-0 flex flex-col">
          <div role="tablist" className="flex items-center gap-5 px-5 min-h-12 border-b border-[var(--border-color)]">
            {([['journey', 'PnL journey'], ['fills', `Fills ${life.events.length}`]] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                className={cn('h-12 -mb-px border-b-2 text-[15px] transition-colors', tab === id ? 'border-[var(--role-content)] text-[var(--role-content)]' : 'border-transparent text-[var(--role-content-muted)] hover:text-[var(--role-content)]')}>
                {label}
              </button>
            ))}
            {tab === 'journey' && (
              <span className="ml-auto text-[13px] tabular-nums text-[var(--role-content-muted)]">
                <span style={{ color: pnlColor(shown) }}>{signed2(shown)}</span>
                {journeyHover && ` · ${when(journeyHover.point.t)}`}
              </span>
            )}
          </div>

          {tab === 'journey' ? (
            curve.length < 2 ? (
              <div className="grid place-items-center min-h-[260px] text-[13px] text-[var(--role-content-subtle)]">Not enough price history to chart this trade.</div>
            ) : (
              <div className="relative h-[280px] mx-5 my-2">
                <PnlChart points={curve} onHover={setJourneyHover} ariaLabel={`PnL over the trade, ending ${signed2(displayPnl)}`} />
              </div>
            )
          ) : (
            <div className="overflow-x-auto">
              {isFallback && <p className="px-5 py-4 text-[13px] text-[var(--role-content-muted)]">No fill history for this position. BULK only keeps a limited window.</p>}
              {life.events.length > 0 && (
                <table className="w-full min-w-[520px] text-[13px]">
                  <thead>
                    <tr className="text-left text-[12px] text-[var(--role-content-subtle)]">
                      <th className="px-5 py-2.5 font-normal">Time</th>
                      <th className="px-3 py-2.5 font-normal">Action</th>
                      <th className="px-3 py-2.5 font-normal text-right">Size</th>
                      <th className="px-3 py-2.5 font-normal text-right">Price</th>
                      <th className="px-5 py-2.5 font-normal text-right">Realized</th>
                    </tr>
                  </thead>
                  <tbody>
                    {life.events.map((e, i) => {
                      const liq = e.liq === 'partial' || e.liq === 'full';
                      return (
                        <tr key={`${e.t}-${i}`} className="border-t border-[var(--role-line-subtle)]">
                          <td className="px-5 py-2.5 tabular-nums text-[var(--role-content-muted)] whitespace-nowrap">{when(e.t)}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: liq ? 'var(--neg)' : 'var(--role-content)' }}>{e.actionLabel}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-[var(--role-content)]">{formatNumber(Math.abs(e.sizeDelta), 4)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-[var(--role-content)]">{money(e.price)}</td>
                          <td className="px-5 py-2.5 text-right tabular-nums" style={{ color: Math.abs(e.realizedDelta) > 1e-6 ? pnlColor(e.realizedDelta) : 'var(--role-content-subtle)' }}>
                            {Math.abs(e.realizedDelta) > 1e-6 ? signed2(e.realizedDelta) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </section>
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
            leverage: liveLeverage || 0,
            markPrice,
            exitPrice: life.isOpen ? markPrice : (pinnedRecord?.closePrice ?? lastPrice),
            liquidated: pinnedRecord?.liquidated,
            pnl: displayPnl,
            events: life.events.map((e) => ({ t: e.t, price: e.price, buy: e.sizeDelta > 0, action: e.action, label: e.actionLabel, realized: e.realizedDelta, units: Math.abs(e.sizeDelta), liq: e.liq ?? null })),
            pnlCurve: life.pnlCurve.map((p) => ({ t: p.t, pnl: p.pnl })),
            liqCurve: life.liqCurve,
          }}
        />
      )}
    </div>
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
    liqCurve: (pos.liquidationPrice && pos.liquidationPrice > 0)
      ? [{ t: openedAt, price: pos.liquidationPrice }, { t: now, price: pos.liquidationPrice }]
      : [],
    realizedTotal: pos.realizedPnl ?? 0,
    peakPnl: peak,
    troughPnl: trough,
    finalPnl: curve.length ? curve[curve.length - 1].pnl : (pos.unrealizedPnl ?? 0),
  };
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[1760px] px-4 py-6 sm:px-6 lg:px-8">{children}</div>;
}

/** Label and value on one line, as in the wallet page's rail. */
function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-[14px]">
      <span className="text-[var(--role-content-muted)] truncate">{label}</span>
      <span className="font-medium tabular-nums shrink-0" style={{ color: color ?? 'var(--role-content)' }}>{value}</span>
    </div>
  );
}

const signed2 = (n: number) => (Math.abs(n) < 0.005 ? '$0.00' : `${n >= 0 ? '+' : '−'}$${formatNumber(Math.abs(n), 2)}`);
const when = (t: number) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
