'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Star, StarOff, Copy, Check, ExternalLink, AlertCircle, Loader2, UserCheck, Shield, Image as ImageIcon } from 'lucide-react';
import { wallet, analytics, formatNumber, formatCompact, formatAddress, formatPercent, type WalletData, type ClosedPosition, type ActivityEvent, type WalletFunding, userApi } from '@/lib/api';
import { isSystemWallet } from '@/lib/systemWallets';
import type { WalletFill } from '@/lib/api';
import { computePositionOpenTime, formatDuration, buildTradeLifecycle, type PositionOpenInfo } from '@/lib/positionWalk';
import { anchorFills, buildPnlCurve, dailyNetPnl, marketBreakdown, maxDrawdownUsd, summarizeFills, thinCurve, trackRecord, trimQuietTail, type PnlCurve, type WalletFillLite } from '@/lib/walletMetrics';
import { coinOf, formatPx, money, pnlColor, shortDate, signed } from '@/lib/walletFormat';
import { FillsTable, FundingPanel, GrossToNet, MakerTaker, MarketBreakdown, PanelLoading, PartialNote, PnlCalendar, StatStrip } from '@/components/wallet/WalletPanels';
import { ClosedPositionsList } from '@/components/ClosedPositionsList';
import { TradeShareCard, type ShareCardData } from '@/components/TradeShareCard';
import { useStore } from '@/store';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { AccountHierarchy } from '@/components/AccountHierarchy';
import { BulkRankBadge } from '@/components/BulkRankBadge';
import { ActivityFeed } from '@/components/ActivityFeed';
import { RiskEventsList } from '@/components/RiskEventsList';
import { PositionChartModal, type PositionForChart } from '@/components/PositionChartModal';
import { ChartFrame } from '@/components/ChartFrame';
import { PnlChart, type PnlHover } from '@/components/wallet/PnlChart';
import { CoinIcon } from '@/components/CoinIcon';
import { clampWicks } from '@/lib/candles';

// X (Twitter) icon component
const XIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

interface WalletProfile {
  wallet_address: string;
  twitter_handle?: string;
  twitter_name?: string;
  twitter_avatar?: string;
  display_name?: string;
  avatar_url?: string;
  created_at?: string;
}

function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
// ============================================================================
// Wallet page
//
// Answers three questions about a trader, in this order: are they any good, what
// are they holding, how close are they to blowing up. One figure per fact: if a
// number appears twice on this page, one of them should go.
//   rail — who this is, the big PnL, overview and performance
//   tabs — overview, positions, trades, calendar, funding, transfers
// ============================================================================

type WalletTab = 'overview' | 'positions' | 'trades' | 'calendar' | 'funding' | 'transfers' | 'liquidations';
type OpenPos = NonNullable<WalletData['live']>['positions'][number];
type OpenOrder = NonNullable<NonNullable<WalletData['live']>['openOrders']>[number];

const fmtLev = (x: number) => `${Number(x.toFixed(1))}×`;

/** BULK's own fair price on the position. The page-level markPrices map comes
 *  from the ticker feed, which is sometimes partial, so it is only a fallback. */
const markOf = (p: OpenPos, marks: Record<string, number>) => p.fairPrice || marks[p.symbol] || p.price;

/** Fraction the mark can move against the position before liquidation. */
function liqDistance(p: OpenPos, mark: number): number | null {
  if (!p.liquidationPrice || !mark) return null;
  return Math.max(0, (p.size > 0 ? mark - p.liquidationPrice : p.liquidationPrice - mark) / mark);
}
const liqColor = (d: number) => (d < 0.05 ? 'var(--neg)' : d < 0.15 ? 'var(--warn, var(--neg))' : 'var(--role-content)');

/** A flush panel: separated by hairlines, not floated as a card. */
function Card({ title, right, children }: { title?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-[var(--bg-muted)] border-b border-[var(--border-color)] flex flex-col min-w-0">
      {(title || right) && (
        <div className="flex items-center justify-between gap-x-3 gap-y-2 px-5 min-h-12 py-2 flex-wrap border-b border-[var(--border-color)] shrink-0">
          <div className="min-w-0">{title}</div>
          {right}
        </div>
      )}
      {/* min-w-0 is load-bearing: without it a wide child (the positions table,
          the calendar's week columns) grows the panel instead of scrolling inside
          its own overflow container, and the page overflows on a phone. */}
      <div className="flex-1 min-h-0 min-w-0">{children}</div>
    </section>
  );
}

/** A soft tile in the rail. */
function Tile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-[var(--role-surface-raised)] px-4 py-3">
      <div className="text-[13px] text-[var(--role-content-muted)]">{label}</div>
      <div className="mt-1.5 text-[20px] leading-none font-medium tabular-nums tracking-tight text-[var(--role-content)] truncate">{value}</div>
    </div>
  );
}

function RailGroup({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <h2 className="text-[15px] font-medium text-[var(--role-content)]">{title}</h2>
        {hint && <span className="text-[12px] text-[var(--role-content-subtle)]">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** Label and value on one line, for the side column. */
function Row({ label, value, color, title }: { label: string; value: ReactNode; color?: string; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-[14px]" title={title}>
      <span className="text-[var(--role-content-muted)] truncate">{label}</span>
      <span className="tabular-nums font-medium shrink-0" style={{ color: color ?? 'var(--role-content)' }}>{value}</span>
    </div>
  );
}

const RANGES = [['24h', 86_400_000], ['7d', 7 * 86_400_000], ['30d', 30 * 86_400_000], ['all', Infinity]] as const;
type Range = (typeof RANGES)[number][0];
const RANGE_LABEL: Record<Range, string> = { '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days', all: 'All time' };

/** The page's one rich element: the total-PnL curve, with the calendar as its other view. */
function PnlPanel({ curve, address }: { curve: PnlCurve; address: string }) {
  // The rail already carries the all-time figure, so open on the last week and
  // show something new. A wallet that didn't move this week opens on everything instead.
  const [picked, setPicked] = useState<Range | null>(null);
  const week = curve.points.filter((p) => p.t >= Date.now() - 7 * 86_400_000).map((p) => p.v);
  const range: Range = picked ?? (week.length >= 2 && Math.max(...week) - Math.min(...week) >= 0.01 ? '7d' : 'all');

  const [hover, setHover] = useState<PnlHover | null>(null);

  // The line is PnL made inside the window, so it starts at zero and ends on the
  // headline. All time starts from zero too: the wallet's first day.
  const { data, quietSince } = useMemo(() => {
    const span = RANGES.find(([r]) => r === range)?.[1] ?? Infinity;
    const cutoff = Date.now() - span;
    const thinned = thinCurve(curve.points.filter((p) => p.t >= cutoff), curve.realizedOnlyUntil);
    if (!thinned.length) return { data: [], quietSince: null };
    const { points: inside, quietSince } = range === 'all' ? trimQuietTail(thinned) : { points: thinned, quietSince: null };
    const before = curve.points.filter((p) => p.t < cutoff).pop();
    // All time rises from zero just ahead of the first close, not in one vertical jump.
    const lead = (inside[inside.length - 1].t - inside[0].t) * 0.03;
    const start = before ? { t: cutoff, v: before.v } : range === 'all' ? { t: inside[0].t - lead, v: 0 } : inside[0];
    // Whole cents: stored and live figures can disagree by a fraction of one, and
    // the chart would stretch that fraction to full height.
    const cents = (v: number) => Math.round(v * 100) / 100;
    return { data: [start, ...inside].map((p) => ({ t: p.t, v: cents(p.v - start.v) })), quietSince };
  }, [curve.points, curve.realizedOnlyUntil, range]);

  const headline = data.length ? data[data.length - 1].v : 0;
  const showsGap = !quietSince && curve.realizedOnlyUntil !== null && data.length > 0 && data[0].t < curve.realizedOnlyUntil;
  const shown = hover ? hover.point.v : headline;

  const ranges = (
    <div className="flex items-center rounded-lg border border-[var(--border-color)] p-0.5 text-[12px]">
      {RANGES.map(([r]) => (
        <button key={r} type="button" onClick={() => setPicked(r)}
          className={cn('px-2.5 py-1 rounded-md transition-colors', range === r ? 'text-[var(--role-content)] bg-[var(--role-surface-raised)]' : 'text-[var(--role-content-muted)] hover:text-[var(--role-content)]')}>
          {r === 'all' ? 'All' : r}
        </button>
      ))}
    </div>
  );

  return (
    <Card title={<span className="text-[15px] text-[var(--role-content)]">Performance</span>} right={ranges}>
      {data.length < 2 ? (
        <div className="grid place-items-center min-h-[360px] p-8 text-center text-[14px] text-[var(--role-content-subtle)]">
          {curve.points.length < 2 ? 'No PnL history yet. The curve starts with this wallet’s first closed trade.' : 'Nothing recorded in this range.'}
        </div>
      ) : (
        <div className="px-5 pb-3 pt-4">
          <div className="text-[28px] leading-none font-medium tabular-nums tracking-tight" style={{ color: pnlColor(shown) }}>{signed(shown)}</div>
          <div className="mt-2 mb-4 text-[13px] text-[var(--role-content-muted)] truncate">
            {hover ? (
              new Date(hover.point.t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
            ) : (
              <>
                {RANGE_LABEL[range]}
                {showsGap && <span className="text-[var(--role-content-subtle)]"> · realized only before {shortDate(curve.realizedOnlyUntil as number)}</span>}
                {quietSince && <span className="text-[var(--role-content-subtle)]"> · no trades since {shortDate(quietSince)}</span>}
              </>
            )}
          </div>
          <ChartFrame title="PnL history" className="h-[280px] sm:h-[400px]" walletAddress={address}>
            <PnlChart points={data}
              onHover={setHover} ariaLabel={`PnL ${RANGE_LABEL[range].toLowerCase()}: ${signed(headline)}`} />
          </ChartFrame>
        </div>
      )}
    </Card>
  );
}

function ShareButton({ symbol, onShare }: { symbol: string; onShare: (symbol: string) => void }) {
  return (
    <button type="button" title="Share card" aria-label={`Share ${symbol}`} onClick={(e) => { e.stopPropagation(); onShare(symbol); }}
      className="p-1.5 rounded-md text-[var(--role-content-subtle)] hover:text-[var(--accent)] hover:bg-[var(--role-surface-raised)] transition-colors"><ImageIcon className="w-3.5 h-3.5" /></button>
  );
}

/** Open positions: a table where it fits, a list of cards on a phone. */
function PositionsTable({ positions, markPrices, openTimes, onOpen, onShare }: {
  positions: OpenPos[]; markPrices: Record<string, number>; openTimes: Record<string, PositionOpenInfo | null>;
  onOpen: (p: OpenPos) => void; onShare: (symbol: string) => void;
}) {
  if (positions.length === 0) {
    return <div className="p-10 text-center text-[14px] text-[var(--role-content-subtle)]">No open positions</div>;
  }
  const rows = [...positions].sort((a, b) => Math.abs(b.notional || 0) - Math.abs(a.notional || 0)).map((p) => {
    const mark = markOf(p, markPrices);
    const basis = Math.abs(p.size * p.price);
    return { p, mark, long: p.size > 0, dist: liqDistance(p, mark), pct: basis ? (p.unrealizedPnl / basis) * 100 : 0, opened: openTimes[p.symbol] };
  });
  const market = (r: (typeof rows)[number]) => (
    <span className="flex items-center gap-2 min-w-0">
      <CoinIcon symbol={r.p.symbol} size={18} />
      <span className="font-medium text-[var(--role-content)] truncate">{coinOf(r.p.symbol)}</span>
      <span className="text-[12px] whitespace-nowrap" style={{ color: r.long ? 'var(--pos)' : 'var(--neg)' }}>{r.long ? 'Long' : 'Short'} {fmtLev(r.p.leverage)}</span>
    </span>
  );
  return (
    <>
      <div className="md:hidden divide-y divide-[var(--role-line-subtle)]">
        {rows.map((r) => (
          <div key={r.p.symbol} role="button" tabIndex={0} onClick={() => onOpen(r.p)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(r.p); }} className="px-4 py-3 cursor-pointer">
            <div className="flex items-center justify-between gap-3">
              {market(r)}
              <span className="tabular-nums text-[14px] shrink-0" style={{ color: pnlColor(r.p.unrealizedPnl) }}>{signed(r.p.unrealizedPnl)}</span>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2 text-[12px]">
              {([['Value', `$${formatCompact(Math.abs(r.p.notional))}`], ['Entry', formatPx(r.p.price)], ['Mark', formatPx(r.mark)]] as const).map(([k, v]) => (
                <span key={k} className="min-w-0"><span className="block text-[var(--role-content-subtle)]">{k}</span><span className="block tabular-nums text-[var(--role-content)] truncate">{v}</span></span>
              ))}
              <span className="min-w-0 text-right"><span className="block text-[var(--role-content-subtle)]">To liq.</span><span className="tabular-nums" style={{ color: r.dist === null ? 'var(--role-content-subtle)' : liqColor(r.dist) }}>{r.dist === null ? '—' : `${(r.dist * 100).toFixed(1)}%`}</span></span>
            </div>
          </div>
        ))}
      </div>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="text-[12px] text-[var(--role-content-muted)] border-b border-[var(--border-color)]">
              <th className="text-left font-normal px-5 py-3">Market</th>
              <th className="text-right font-normal px-3 py-3">Value</th>
              <th className="text-right font-normal px-3 py-3">Entry</th>
              <th className="text-right font-normal px-3 py-3">Mark</th>
              <th className="text-right font-normal px-3 py-3">PnL</th>
              <th className="text-right font-normal px-3 py-3">Liquidation</th>
              <th className="text-right font-normal px-3 py-3 hidden xl:table-cell">Funding</th>
              <th className="text-right font-normal px-3 py-3 hidden xl:table-cell">Opened</th>
              <th className="w-px px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--role-line-subtle)]">
            {rows.map((r) => (
              <tr key={r.p.symbol} className="cursor-pointer hover:bg-[var(--role-surface-raised)]/50 transition-colors" onClick={() => onOpen(r.p)}>
                <td className="px-5 py-3 whitespace-nowrap">{market(r)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-[var(--role-content)] whitespace-nowrap">${formatCompact(Math.abs(r.p.notional))}<span className="block text-[11px] text-[var(--role-content-subtle)]">{formatNumber(Math.abs(r.p.size), Math.abs(r.p.size) < 100 ? 2 : 0)} {coinOf(r.p.symbol)}</span></td>
                <td className="px-3 py-3 text-right tabular-nums text-[var(--role-content-muted)]">{formatPx(r.p.price)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-[var(--role-content)]">{formatPx(r.mark)}</td>
                <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap" style={{ color: pnlColor(r.p.unrealizedPnl) }}>{signed(r.p.unrealizedPnl)}<span className="block text-[11px] opacity-80">{formatPercent(r.pct, 1)}</span></td>
                <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
                  {r.dist === null ? <span className="text-[var(--role-content-subtle)]">—</span> : <>
                    <span style={{ color: liqColor(r.dist) }}>{(r.dist * 100).toFixed(1)}%</span>
                    <span className="block text-[11px] text-[var(--role-content-subtle)]">{formatPx(r.p.liquidationPrice)}</span>
                  </>}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-[var(--role-content-muted)] whitespace-nowrap hidden xl:table-cell">{r.p.funding ? money(r.p.funding) : '—'}</td>
                <td className="px-3 py-3 text-right text-[12px] text-[var(--role-content-subtle)] whitespace-nowrap hidden xl:table-cell">{r.opened ? `${formatDuration(Date.now() - r.opened.openedAt)} ago` : '—'}</td>
                <td className="px-3 py-3 text-right"><ShareButton symbol={r.p.symbol} onShare={onShare} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Resting orders, which is where a trader's stops and targets show up. */
function OrdersList({ orders }: { orders: OpenOrder[] }) {
  if (orders.length === 0) {
    return <div className="p-10 text-center text-[14px] text-[var(--role-content-subtle)]">No open orders</div>;
  }
  return (
    <div className="divide-y divide-[var(--role-line-subtle)]">
      {orders.map((o) => {
        const price = o.trigger?.px ?? o.price;
        const type = (o.orderType || 'limit').replace(/_/g, ' ');
        return (
          <div key={o.orderId} className="flex items-center justify-between gap-3 px-4 md:px-5 py-3 text-[14px]">
            <span className="flex items-center gap-2 min-w-0">
              <CoinIcon symbol={o.symbol} size={18} />
              <span className="font-medium text-[var(--role-content)]">{coinOf(o.symbol)}</span>
              <span className="text-[12px] text-[var(--role-content-muted)] truncate first-letter:uppercase">{type} {o.size < 0 ? 'sell' : 'buy'}{o.reduceOnly ? ', reduce only' : ''}</span>
            </span>
            <span className="tabular-nums text-right shrink-0 text-[var(--role-content)]">{formatPx(price)}<span className="block text-[11px] text-[var(--role-content-subtle)]">${formatCompact(Math.abs(o.size) * price)}</span></span>
          </div>
        );
      })}
    </div>
  );
}

export default function WalletPage() {
  const params = useParams();
  const router = useRouter();
  const address = params.address as string;
  // Wallet positions/PnL are per-network — refetch when the network changes.
  const { network } = useCurrentNetwork();
  
  const { following, addFollowing, removeFollowing, user, claimedWallet, setClaimedWallet, setUser } = useStore();
  const { authenticated, login, getAccessToken, user: privyUser } = usePrivy();
  const { wallets: solanaWallets } = useSolanaWallets();
  
  const [data, setData] = useState<WalletData | null>(null);
  const [profile, setProfile] = useState<WalletProfile | null>(null);
  const [loading, setLoading] = useState(true);
  // Reveal gate: the page's data arrives in several async waves (wallet +
  // positions, fills/volume, BULK rank, then the PnL-chart candles). Revealing
  // on the first wave flashed incomplete numbers ($0 volume, 0 trades, empty
  // chart) that only filled in after a refresh. Instead we hold the animated
  // logo loader until EVERY key wave has landed, then reveal the whole page at
  // once. A safety timeout guarantees we never hang on a slow/failed fetch.
  const [mainDone, setMainDone] = useState(false);
  const [fillsDone, setFillsDone] = useState(false);
  const [revealTimedOut, setRevealTimedOut] = useState(false);
  useEffect(() => {
    setMainDone(false); setFillsDone(false); setRevealTimedOut(false);
    // Last-resort reveal cap. The waves now retry until COMPLETE before flipping
    // their done flags, so this only fires if the backend stays down — a longer
    // wait than before, but the user asked for complete info over a fast reveal.
    const t = window.setTimeout(() => setRevealTimedOut(true), 55_000);
    return () => window.clearTimeout(t);
  }, [address]);
  const [followLoading, setFollowLoading] = useState(false);
  const [claimLoading, setClaimLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Closed positions used for Tier-1 derived stats (performance bar,
  // win streak, trade durations, PnL/size cohorts). Fetched in parallel
  // with the live wallet data. Backend caches this for 60s so a wallet
  // page that also opens the Recent Trades panel doesn't double-fetch.
  // Empty array while loading or for new wallets — derivations downstream
  // guard against zero-length arrays.
  const [closedPositions, setClosedPositions] = useState<ClosedPosition[]>([]);
  // Raw fills: position open times, the share card and lifetime volume.
  const [allFills, setAllFills] = useState<WalletFillLite[]>([]);
  // Position currently being inspected in the price-chart modal. null means
  // closed. Set when the user clicks any position card.
  const [chartPosition, setChartPosition] = useState<PositionForChart | null>(null);

  // Which section of the page is showing.
  const [tab, setTab] = useState<WalletTab>('overview');
  const [tradeView, setTradeView] = useState<'fills' | 'closed'>('fills');
  const [funding, setFunding] = useState<WalletFunding | null>(null);
  const [transfers, setTransfers] = useState<ActivityEvent[] | null>(null);
  // Share-card state: reconstruct a trade's lifecycle (fills + klines) and open
  // the animated card for it — same card the observe page uses.
  const [cardData, setCardData] = useState<ShareCardData | null>(null);

  // Per-symbol "when did this position open" map. We compute this client-side
  // by walking the wallet's fill history for each symbol — BULK doesn't
  // expose a per-position timestamp on the position object. Null entries
  // mean we tried but couldn't determine (e.g. no fills, or position is
  // older than BULK's 5000-fill window). Undefined means we haven't fetched
  // yet, so the UI shows "—" instead of a wrong value.
  const [positionOpenTimes, setPositionOpenTimes] = useState<
    Record<string, PositionOpenInfo | null>
  >({});

  // Volume summed from the wallet's OWN fills, maker and taker sides.
  const [lifetimeFillVol, setLifetimeFillVol] = useState<number | null>(null);

  // Get current user's wallet address from multiple sources
  const solanaWalletAddress = solanaWallets?.[0]?.address;
  const privyWalletAddress = privyUser?.wallet?.address;
  const linkedSolanaWallet = privyUser?.linkedAccounts?.find(
    (account: any) => account.type === 'wallet' && account.chainType === 'solana'
  ) as any;
  const linkedWalletAddress = linkedSolanaWallet?.address;
  const storeWalletAddress = user?.wallet_address;
  
  // Connected wallet (via Phantom etc)
  const connectedWallet = solanaWalletAddress || privyWalletAddress || linkedWalletAddress || '';
  
  // User's effective wallet (connected OR claimed)
  const currentUserWallet = connectedWallet || claimedWallet || user?.claimed_wallet || storeWalletAddress || '';
  
  // Check if user logged in via email (no connected wallet)
  const emailAccount = privyUser?.linkedAccounts?.find(
    (account): account is any => account.type === 'email'
  );
  const isEmailUser = authenticated && !connectedWallet && !!emailAccount;
  
  // Check if this is user's claimed wallet
  const isClaimedWallet = !!(claimedWallet && address && 
    claimedWallet.toLowerCase() === address.toLowerCase());
  
  // Check if viewing own wallet (connected OR claimed)
  const isOwnWallet = !!(currentUserWallet && address && 
    currentUserWallet.toLowerCase() === address.toLowerCase());
  
  // Can claim: email user, no claimed wallet yet, not viewing already claimed wallet
  const canClaimWallet = isEmailUser && !claimedWallet && !user?.claimed_wallet;
  
  // Check if following this wallet
  const isFollowing = following.some(w => 
    w.wallet_address.toLowerCase() === address.toLowerCase()
  );

  useEffect(() => {
    if (!address) return;
    let cancelledMain = false;

    // One fetch attempt of the main account data. Returns true only when the
    // data we need to render a COMPLETE page actually came back — i.e. the live
    // account loaded AND the closed-position fetch succeeded (a genuine 200,
    // even if empty). The `silent` flag suppresses the spinner on background
    // ticks.
    const fetchData = async (silent: boolean): Promise<boolean> => {
      if (!silent) setError('');
      try {
        // Three parallel fetches:
        //  - wallet.getWallet:        live BULK account + tracked DB row
        //  - userApi.getWalletProfile: claimed username if any
        //  - wallet.getClosedPositions: closed-position history (Recent Trades,
        //    PnL heatmap, per-trade chart, win-rate stats).
        const [walletResult, profileResult, closedResult] = await Promise.all([
          wallet.getWallet(address),
          userApi.getWalletProfile(address).catch(() => ({ profile: null })),
          // null (not { positions: [] }) on failure so a THROWN fetch (network /
          // 429) is distinguishable from a genuine empty.
          // Full history: BULK returns every closed position in one response
          // (thousands of rows back to mainnet launch). The old limit of 200 cut
          // a seven-week record down to days, which skewed win rate, profit
          // factor, streaks and the daily-PnL calendar.
          wallet.getClosedPositions(address, { limit: 10000 }).catch(() => null),
        ]);

        setData(walletResult);
        setProfile((profileResult as any)?.profile || null);
        // Overwrite closed positions when the fetch SUCCEEDED. On a failure
        // (null) keep what we have. On a silent tick only overwrite with a
        // non-empty list (a mid-session empty success is almost always a hiccup).
        if (closedResult && (!silent || (closedResult.positions?.length ?? 0) > 0)) {
          setClosedPositions(closedResult.positions || []);
        }
        // Complete = account came back AND closed-positions fetch succeeded.
        return !!walletResult && closedResult !== null;
      } catch {
        if (!silent) setError('Failed to load wallet data');
        return false;
      }
    };

    // Initial load — keep retrying until the data is COMPLETE before revealing,
    // so the page never flashes a half-empty state that heals on the next poll.
    // The reveal timeout is the ultimate safety net if the backend stays down.
    (async () => {
      setLoading(true);
      let ok = false;
      for (let attempt = 0; attempt < 9 && !cancelledMain && !ok; attempt++) {
        ok = await fetchData(false);
        if (!ok && !cancelledMain) await new Promise((r) => setTimeout(r, Math.min(3000, 500 * (attempt + 1))));
      }
      if (cancelledMain) return;
      await wallet.trackWallet(address).catch(() => {}); // track once, after load
      setLoading(false);
      setMainDone(true); // only now — we have complete data (or exhausted retries)
    })();

    // Background refresh every 10 seconds. Cleared on unmount or when the
    // wallet address changes. We don't visualize the refresh (no spinner,
    // no toast) — positions and PnL just update in place. This is the
    // behavior the BULK dev specifically asked for: live-feeling without
    // user action.
    const tick = window.setInterval(() => fetchData(true), 10_000);
    return () => { cancelledMain = true; window.clearInterval(tick); };
  }, [address, network]);

  // Fetch fills for each open position and compute when it was opened.
  // BULK doesn't expose a per-position open timestamp on the position
  // object, so we derive it client-side from the wallet's fill history:
  // walk fills chronologically and find the most recent moment net size
  // went from 0 to non-zero. That timestamp is the position's open time.
  //
  // We fire one /fills request per open symbol. Backend caches 60s so
  // re-renders are cheap. We don't refetch on the 10s tick because open
  // times don't change for an existing position — only when a new one
  // is added or an old one is closed, which the dependency on the
  // joined symbol list handles.
  const openSymbolKey = (data?.live?.positions || [])
    .map((p) => p.symbol)
    .sort()
    .join(',');

  // Derive each open position's open-time from the SINGLE all-fills set we
  // already fetch (allFills), instead of firing one getFills per open position.
  // That per-position fan-out was a burst of BULK /account calls on page load
  // (18+ for a multi-position wallet) that the backend now has to serialize —
  // slow and pointless when allFills already contains these symbols' fills.
  // computePositionOpenTime returns null when the fills don't cover the open
  // (e.g. a master account whose subs traded, or older than the fill window).
  useEffect(() => {
    const positions = data?.live?.positions || [];
    if (positions.length === 0) { setPositionOpenTimes({}); return; }
    if (allFills.length === 0) return; // wait for the fills to land
    const bySymbol: Record<string, WalletFill[]> = {};
    for (const f of allFills) (bySymbol[f.symbol] ??= []).push(f);
    const next: Record<string, PositionOpenInfo | null> = {};
    for (const pos of positions) {
      const { fills, openedBefore } = anchorFills(bySymbol[pos.symbol] || [], pos.size, pos.price);
      const open = computePositionOpenTime(fills);
      // Opened before BULK's history starts: the real time is unknown, so say so.
      next[pos.symbol] = open && open.openedAt === openedBefore ? null : open;
    }
    setPositionOpenTimes(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSymbolKey, allFills]);

  // One unfiltered /fills call (capped at 1000) covers most wallets; for very
  // active accounts the volume sum is a lower bound. Volume = |size| × price.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    // Retry until the fills fetch succeeds before marking this wave done — lifetime
    // volume and position open-times depend on it, and (unlike the main data) nothing re-fetches fills on a timer, so a
    // one-shot failure would leave those permanently empty.
    (async () => {
      for (let attempt = 0; attempt < 9 && !cancelled; attempt++) {
        try {
          const res = await wallet.getFills(address, { limit: 40000, lite: true });
          if (cancelled) return;
          const fills = res.fills || [];
          setAllFills(fills);
          const lifetime = fills.reduce((s, f) => s + Math.abs(f.size || 0) * (f.price || 0), 0);
          setLifetimeFillVol(lifetime);
          break; // success (even if genuinely empty)
        } catch {
          if (attempt < 8) await new Promise((r) => setTimeout(r, Math.min(3000, 500 * (attempt + 1))));
        }
      }
      if (!cancelled) setFillsDone(true);
    })();
    return () => { cancelled = true; };
  }, [address, network]);

  // Each tab loads only what it shows. Funding feeds the Overview's per-market
  // breakdown, so it follows the fills; transfers load the first time their tab opens.
  // Spacing them after the page's own calls also keeps a cold load from bursting BULK.
  const [fundingDone, setFundingDone] = useState(false);
  useEffect(() => { setFunding(null); setTransfers(null); setFundingDone(false); }, [address, network]);
  const retryLoad = async <T,>(load: () => Promise<T>, done: (v: T) => void, cancelled: () => boolean) => {
    for (let attempt = 0; attempt < 6 && !cancelled(); attempt++) {
      try { const v = await load(); if (!cancelled()) done(v); return; }
      catch { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); }
    }
  };
  useEffect(() => {
    if (!mainDone || !fillsDone) return;
    let cancelled = false;
    (async () => {
      await retryLoad(() => wallet.getFunding(address), setFunding, () => cancelled);
      if (!cancelled) setFundingDone(true);
    })();
    return () => { cancelled = true; };
  }, [address, network, mainDone, fillsDone]); // eslint-disable-line react-hooks/exhaustive-deps
  const wantsTransfers = tab === 'transfers';
  useEffect(() => {
    if (!wantsTransfers || transfers !== null) return;
    let cancelled = false;
    void retryLoad(() => wallet.getActivity(address, 200), (r) => setTransfers(r.data || []), () => cancelled);
    return () => { cancelled = true; };
  }, [address, network, wantsTransfers, transfers]); // eslint-disable-line react-hooks/exhaustive-deps

  const copyAddress = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleFollow = async () => {
    // If not authenticated, prompt login
    if (!authenticated) {
      console.log('[Follow] Not authenticated, prompting login');
      login();
      return;
    }

    setFollowLoading(true);
    
    try {
      // ALWAYS get fresh token from Privy (ES256 signed)
      console.log('[Follow] Getting fresh Privy access token...');
      const token = await getAccessToken();
      
      if (!token) {
        console.error('[Follow] Failed to get Privy access token');
        alert('Please reconnect your wallet to follow users');
        setFollowLoading(false);
        return;
      }

      if (isFollowing) {
        console.log('[Follow] Unfollowing wallet:', address);
        await userApi.unfollowWallet(token, address);
        removeFollowing(address);
        console.log('[Follow] Successfully unfollowed');
      } else {
        console.log('[Follow] Following wallet:', address);
        await userApi.followWallet(token, address);
        addFollowing({
          wallet_address: address,
          followed_at: new Date().toISOString(),
        });
        console.log('[Follow] Successfully followed');
      }
    } catch (err: any) {
      console.error('[Follow] Failed to update follow:', err);
      
      if (err.message?.includes('401') || err.message?.includes('expired') || err.message?.includes('Invalid')) {
        alert('Session expired. Please reconnect your wallet.');
      } else {
        alert(err.message || 'Failed to update follow status');
      }
    } finally {
      setFollowLoading(false);
    }
  };

  const handleClaimWallet = async () => {
    if (!authenticated) {
      login();
      return;
    }

    setClaimLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) {
        alert('Please log in again');
        return;
      }

      console.log('[Claim] Claiming wallet:', address);
      const response = await userApi.claimWallet(token, address) as { user?: any; success?: boolean };
      
      if (response?.success) {
        setClaimedWallet(address);
        if (response.user) {
          setUser(response.user);
        }
        console.log('[Claim] Wallet claimed successfully');
      }
    } catch (err: any) {
      console.error('[Claim] Failed to claim wallet:', err);
      alert(err.message || 'Failed to claim wallet');
    } finally {
      setClaimLoading(false);
    }
  };

  const margin = data?.live?.margin;
  const positions = data?.live?.positions || [];
  const markPrices = data?.markPrices || {};
  const tracked = data?.tracked;
  const history = data?.history || [];

  // Reconstruct and open the share card for a market's current instance.
  const openShareCard = async (sym: string) => {
    const coin2 = sym.replace(/-USD$/, '');
    const lp = data?.live?.positions.find((p) => p.symbol === sym);
    const symbolFills = allFills.filter((f) => f.symbol === sym);
    if (symbolFills.length === 0) return;
    const tf = lp ? anchorFills(symbolFills, lp.size, lp.price).fills : symbolFills;
    const mark = lp ? markOf(lp, markPrices) : data?.markPrices?.[sym] ?? null;
    // Candles only for the market being shared, and only when asked. Snapped to
    // the hour so repeat views hit the backend's candle cache.
    const HOUR = 3_600_000;
    const startTime = Math.floor(Math.min(...tf.map((f) => f.timestamp)) / HOUR) * HOUR;
    const endTime = Math.ceil(Date.now() / HOUR) * HOUR;
    const limit = Math.min(1000, Math.max(24, Math.ceil((endTime - startTime) / HOUR) + 6));
    const res = await analytics.getCandles(sym, '1h', limit, { startTime, endTime }).catch(() => null);
    const life = buildTradeLifecycle(tf, clampWicks(res?.candles || []), {
      markPrice: mark, leverage: lp?.leverage ?? 0, liqPrice: lp?.liquidationPrice ?? null,
    });
    if (!life) return;
    const lastPrice = life.isOpen ? mark : (life.events.length ? life.events[life.events.length - 1].price : mark);
    setCardData({
      address, symbol: sym, coin: coin2,
      // An open position's facts come from BULK, not from replaying fills.
      side: lp ? (lp.size > 0 ? 'long' : 'short') : life.side, isOpen: life.isOpen, openedAt: life.openedAt, closedAt: life.closedAt,
      avgEntry: lp ? lp.price : life.avgEntry, size: lp ? Math.abs(lp.size) : life.peakSize, leverage: lp ? Number(lp.leverage.toFixed(1)) : 0,
      markPrice: mark, exitPrice: life.isOpen ? mark : lastPrice, pnl: lp ? lp.unrealizedPnl : life.finalPnl,
      events: life.events.map((e) => ({ t: e.t, price: e.price, buy: e.sizeDelta > 0, action: e.action, label: e.actionLabel, realized: e.realizedDelta, units: Math.abs(e.sizeDelta), liq: e.liq ?? null })),
      pnlCurve: life.pnlCurve.map((p) => ({ t: p.t, pnl: p.pnl })),
      liqCurve: life.liqCurve,
    });
  };

  // Total PnL over time, ending on the live account. See buildPnlCurve.
  const snapshots = data?.snapshots;
  const realizedLive = margin?.realizedPnl ?? null;
  const unrealizedLive = margin?.unrealizedPnl ?? null;
  const curve = useMemo(() => buildPnlCurve({
    snapshots: snapshots ?? [], history, realizedNow: realizedLive, unrealizedNow: unrealizedLive, now: Date.now(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [snapshots, data?.history, realizedLive, unrealizedLive]);

  const dailyPnlFromSeries = useMemo<Map<string, number> | null>(() => {
    // Daily change of the total-PnL curve, so the calendar covers every recorded
    // day and works for a wallet that only has open positions.
    const src = curve.points;
    if (src.length < 2) return null;
    // Last cumulative value seen on each local calendar day.
    const lastByDay = new Map<string, number>();
    for (const p of src) {
      const d = new Date(p.t);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      lastByDay.set(key, p.v);
    }
    const days = Array.from(lastByDay.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const out = new Map<string, number>();
    // A curve that starts at the first close starts from zero, so its first day counts
    // too. Leaving it out dropped a whole trading day from the calendar.
    let prev: number | null = curve.startsFromZero ? 0 : null;
    for (const [key, v] of days) { if (prev !== null) out.set(key, v - prev); prev = v; }
    return out;
  }, [curve.points, curve.startsFromZero]);

  // Everything below reads the live account first. `tracked` is our DB row and
  // only fills in for a wallet BULK has no live account for.
  const realizedNow = margin?.realizedPnl ?? null;
  const unrealizedNow = margin?.unrealizedPnl ?? null;
  const totalPnl = margin ? margin.realizedPnl + margin.unrealizedPnl : Number(tracked?.total_pnl ?? 0);

  const hasLiveData = margin !== null && margin !== undefined;
  const hasTrackedData = tracked !== null && tracked !== undefined;

  // The fill sum matches BULK's portfolio when the wallet's whole history is
  // available; BULK only serves the latest ~5,000 fills of a very busy wallet, and
  // our DB figure is the better one there. Each is a lower bound, so take the larger.
  const lifetimeVolume = Math.max(lifetimeFillVol ?? 0, Number(tracked?.total_volume ?? 0));
  // BULK's own rolling volume and fee tier, exact however busy the wallet is.
  const feeTier = data?.live?.feeTiers?.find((t) => t.symbol === 'global') ?? data?.live?.feeTiers?.[0] ?? null;

  // Display name priority: Twitter name > display name > null
  const displayName = profile?.twitter_name || profile?.display_name || null;
  const twitterHandle = profile?.twitter_handle;
  const twitterAvatar = profile?.twitter_avatar;

  const totalNotional = positions.reduce((sum, p) => sum + Math.abs(p.notional || 0), 0);
  const longNotional = positions.reduce((sum, p) => sum + (p.size > 0 ? Math.abs(p.notional || 0) : 0), 0);
  const longShare = totalNotional > 0 ? longNotional / totalNotional : null;
  // BULK's totalMargin is cash: net deposits plus net realized, to the cent. Open
  // PnL sits on top of it, so what the account is worth is the two together.
  const accountValue = margin ? margin.totalBalance + margin.unrealizedPnl : null;
  const netDeposited = margin ? margin.totalBalance - margin.realizedPnl : null;
  const leverage = accountValue !== null && accountValue > 0 && totalNotional > 0 ? totalNotional / accountValue : null;

  // The position most likely to take the wallet down next.
  const closestLiq = positions.reduce<{ symbol: string; dist: number; price: number } | null>((best, p) => {
    const dist = liqDistance(p, markOf(p, markPrices));
    return dist !== null && (!best || dist < best.dist) ? { symbol: p.symbol, dist, price: p.liquidationPrice } : best;
  }, null);

  const openOrders = data?.live?.openOrders ?? [];
  const record = useMemo(() => trackRecord(closedPositions), [closedPositions]);
  const fillSummary = useMemo(() => summarizeFills(allFills), [allFills]);
  // Margin's realized figure is net, so fees and funding come back out for gross.
  const grossRealized = margin ? margin.realizedPnl - margin.fees - margin.funding : null;
  const positionPnlKey = positions.map((p) => `${p.symbol}:${Math.round(p.unrealizedPnl)}`).join();
  const breakdown = useMemo(
    () => marketBreakdown({ summary: fillSummary, grossRealized, closed: closedPositions, open: positions, funding: funding?.bySymbol ?? {} }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fillSummary, grossRealized, closedPositions, positionPnlKey, funding],
  );
  // The calendar's days. Exact when the whole fill history is here: each day is what
  // happened on it (realized and fees from the fills, funding from the payments). The
  // total-PnL curve has no fees in its older stretch and spreads them evenly over time,
  // which put a day's fees on the wrong day; it's the fallback when the history is cut.
  const dailyPnl = useMemo(() => {
    const complete = funding && funding.recent.length >= funding.count;
    const exact = breakdown.exact && complete
      ? dailyNetPnl({ summary: fillSummary, funding: funding.recent, unrealizedNow: margin?.unrealizedPnl ?? 0, totalNow: totalPnl, now: Date.now() })
      : null;
    return exact ?? dailyPnlFromSeries;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakdown.exact, funding, fillSummary, dailyPnlFromSeries, totalPnl]);
  const longValue = longNotional;
  const shortValue = totalNotional - longNotional;
  const transferTotals = useMemo(() => {
    let inn = 0, out = 0;
    for (const e of transfers ?? []) {
      if (e.status && e.status !== 'completed') continue;
      const amount = Number(e.amount) || 0;
      if (e.activityType === 'deposit' || (e.to === address && e.from !== address && /transfer/i.test(e.activityType))) inn += amount;
      else if (e.activityType === 'withdrawal' || (e.from === address && e.to !== address && /transfer/i.test(e.activityType))) out += amount;
    }
    return { inn, out };
  }, [transfers, address]);
  const drawdown = useMemo(() => maxDrawdownUsd(curve.points), [curve.points]);
  const openLiveChart = (pos: OpenPos) => {
    const isLong = pos.size > 0;
    const markPrice = markOf(pos, markPrices);
    setChartPosition({
      kind: 'live', walletAddress: address, symbol: pos.symbol, side: isLong ? 'long' : 'short',
      entryPrice: pos.price, markPrice, liquidationPrice: pos.liquidationPrice,
      size: Math.abs(pos.size), leverage: pos.leverage, unrealizedPnl: pos.unrealizedPnl,
    });
  };
  const openClosedChart = (p: ClosedPosition) => setChartPosition({
    kind: 'closed', walletAddress: address, symbol: p.symbol, side: p.side, entryPrice: p.openPrice, closePrice: p.closePrice,
    size: p.size, leverage: p.leverage, realizedPnl: p.realizedPnl, fees: p.fees, funding: p.funding,
    openedAt: p.openedAt, closedAt: p.closedAt, liquidated: p.liquidated,
  });

  // Reveal as soon as the account is in. Fill history is the slow part (a busy wallet
  // is several sequential BULK pages), and only some panels need it: those show a
  // loading state in place, never a partial figure, until it lands.
  const ready = revealTimedOut || mainDone;
  const analysisReady = fillsDone && fundingDone;

  // Hold the animated logo loader until the account has landed.
  if (!ready) {
    return (
      <div className="fixed inset-0 z-[9999] grid place-items-center bg-[var(--bg-base)]">
        <div className="flex flex-col items-center gap-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-loader.svg" alt="Loading" className="h-20 w-auto select-none" />
          <p className="text-[13px] text-[var(--role-content-subtle)]">Loading wallet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-base)] animate-[whale-reveal_0.45s_ease-out]">
      {cardData && <TradeShareCard data={cardData} onClose={() => setCardData(null)} />}
      <main className="flex-1 w-full">
        {error && !hasTrackedData ? (
          <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-10 text-center max-w-xl mx-auto mt-8">
            <AlertCircle className="w-10 h-10 mx-auto mb-3 text-bulk-red opacity-60" />
            <h2 className="text-lg font-medium mb-1">Wallet not found</h2>
            <p className="text-[14px] text-[var(--role-content-muted)] mb-5">{error}</p>
            <Link href="/whales" className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-[14px] border border-[var(--border-color)] hover:bg-[var(--role-surface-raised)] transition-colors"><ArrowLeft className="w-4 h-4" /> Whale Tracker</Link>
          </div>
        ) : (
          // Three blocks, in phone reading order: who and how much, the chart and
          // positions, then the full stats. On desktop the first and last stack
          // into one rail and the middle block takes the rest of the width.
          <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] lg:grid-rows-[auto_1fr] min-h-[calc(100vh-57px)]">

            {/* ── RAIL, TOP ────────────────────────────────────────────── */}
            <section className="bg-[var(--bg-muted)] lg:border-r border-[var(--border-color)] px-5 pt-5 pb-5 flex flex-col gap-5 min-w-0">
              <div className="flex items-center gap-3 min-w-0">
                <Link href="/whales" aria-label="Back to Whale Tracker" title="Whale Tracker" className="p-1 -ml-1 rounded-md text-[var(--role-content-subtle)] hover:text-[var(--role-content)] transition-colors"><ArrowLeft className="w-4 h-4" /></Link>
                {twitterAvatar && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={twitterAvatar} alt="" width={36} height={36} loading="eager" decoding="async" className="w-9 h-9 rounded-lg object-cover shrink-0" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <h1 className="text-[20px] leading-tight font-medium text-[var(--role-content)] truncate">{displayName || formatAddress(address)}</h1>
                    <button onClick={copyAddress} className="p-1 shrink-0 rounded hover:bg-[var(--role-surface-raised)] transition-colors" title="Copy address" aria-label="Copy address">
                      {copied ? <Check className="w-3.5 h-3.5 text-bulk-green" /> : <Copy className="w-3.5 h-3.5 text-[var(--role-content-subtle)]" />}
                    </button>
                    {isOwnWallet && <span className="text-[12px] text-[var(--role-content-muted)]">You</span>}
                  </div>
                  {twitterHandle ? (
                    <a href={`https://twitter.com/${twitterHandle}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] text-[var(--role-content-muted)] hover:text-[var(--role-content)]"><XIcon className="w-3 h-3" />@{twitterHandle}</a>
                  ) : tracked?.first_seen ? (
                    <div className="text-[12px] text-[var(--role-content-subtle)] truncate">First seen {new Date(tracked.first_seen).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 empty:hidden">
                {isSystemWallet(address) ? (
                  <span className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] border border-[var(--border-color)] text-[var(--role-content-muted)]" title="Operated by the BULK exchange protocol"><Shield className="w-3.5 h-3.5" />BULK System</span>
                ) : <BulkRankBadge address={address} />}
                <AccountHierarchy address={address} />
              </div>

              <div>
                <div className="text-[14px] text-[var(--role-content-muted)]">Total PnL</div>
                <div className="mt-2 text-[44px] leading-none font-medium tabular-nums tracking-tight" style={{ color: totalPnl === 0 ? 'var(--role-content)' : pnlColor(totalPnl) }}>{totalPnl === 0 ? '$0' : signed(totalPnl)}</div>
                {margin && (
                  <div className="mt-3 text-[13px] text-[var(--role-content-muted)] tabular-nums">{signed(margin.realizedPnl)} realized · {signed(margin.unrealizedPnl)} open</div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                {isClaimedWallet && <span className="inline-flex items-center justify-center gap-2 h-9 text-[13px] text-[var(--role-content-muted)]"><UserCheck className="w-4 h-4" />Your claimed wallet</span>}
                {canClaimWallet && (
                  <button onClick={handleClaimWallet} disabled={claimLoading} className="inline-flex items-center justify-center gap-2 h-10 rounded-xl text-[14px] border border-[var(--border-color)] hover:bg-[var(--role-surface-raised)] transition-colors disabled:opacity-50">
                    {claimLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}This is my wallet
                  </button>
                )}
                {!isOwnWallet && (
                  <button onClick={toggleFollow} disabled={followLoading}
                    className={cn('inline-flex items-center justify-center gap-2 h-10 rounded-xl text-[14px] font-medium border transition-colors disabled:opacity-50',
                      isFollowing ? 'border-[var(--border-color)] text-[var(--role-content)] hover:bg-[var(--role-surface-raised)]' : 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)] hover:brightness-110')}>
                    {followLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : isFollowing ? <StarOff className="w-4 h-4" /> : <Star className="w-4 h-4" />}
                    {isFollowing ? 'Following' : 'Follow'}
                  </button>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <a href={`https://explorer.bulk.trade/address/${address}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1.5 h-10 rounded-xl text-[14px] border border-[var(--border-color)] text-[var(--role-content)] hover:bg-[var(--role-surface-raised)] transition-colors">Explorer <ExternalLink className="w-3.5 h-3.5 text-[var(--role-content-subtle)]" /></a>
                  <a href={`https://solscan.io/account/${address}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1.5 h-10 rounded-xl text-[14px] border border-[var(--border-color)] text-[var(--role-content)] hover:bg-[var(--role-surface-raised)] transition-colors">Solscan <ExternalLink className="w-3.5 h-3.5 text-[var(--role-content-subtle)]" /></a>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-1 gap-2">
                <Tile label="Account value" value={accountValue !== null ? money(accountValue) : '—'} />
                <Tile label={`Volume (${feeTier?.windowDays ?? 14}d)`} value={feeTier ? money(feeTier.rollingVolume) : '—'} />
              </div>
            </section>

            {/* ── MAIN ─────────────────────────────────────────────────── */}
            <div className="flex flex-col min-w-0 lg:col-start-2 lg:row-start-1 lg:row-span-2">
              {/* Scrolls rather than overflowing: these tabs don't fit a phone. */}
              <div className="px-3 bg-[var(--bg-muted)] border-b border-[var(--border-color)] flex items-end gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>button]:shrink-0" role="tablist">
                {([
                  ['overview', 'Overview'],
                  ['positions', `Positions (${positions.length})`],
                  ['trades', 'Trade history'],
                  ['calendar', 'PnL calendar'],
                  ['funding', 'Funding'],
                  ['transfers', 'Deposits & withdrawals'],
                  ['liquidations', 'Liquidations'],
                ] as const).map(([k, label]) => (
                  <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-tour={k === 'trades' ? 'tab-trades' : undefined}
                    className={cn('relative px-2 pt-3.5 pb-3 text-[15px] transition-colors whitespace-nowrap', tab === k ? 'text-[var(--role-content)]' : 'text-[var(--role-content-muted)] hover:text-[var(--role-content)]')}>
                    {label}
                    {tab === k && <span className="absolute left-1/2 -translate-x-1/2 bottom-0 h-[3px] w-6 bg-[var(--accent)]" />}
                  </button>
                ))}
              </div>

              <div className="flex-1 min-w-0 bg-[var(--bg-muted)]">
                {tab === 'overview' && (
                  <>
                    <PnlPanel curve={curve} address={address} />
                    {analysisReady ? (
                      <MarketBreakdown rows={breakdown.rows} exact={breakdown.exact} fills={allFills.length} oldest={fillSummary.oldest}
                        totalVolume={fillSummary.volume} makerShare={fillSummary.volume > 0 ? fillSummary.maker.volume / fillSummary.volume : 0} />
                    ) : <PanelLoading title="Market breakdown" className="h-[445px] sm:h-[527px]" />}
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-px bg-[var(--border-color)]">
                      {margin && <GrossToNet gross={(grossRealized ?? 0) + margin.unrealizedPnl} fees={margin.fees} funding={margin.funding} net={totalPnl} />}
                      {fillsDone
                        ? <MakerTaker maker={fillSummary.maker} taker={fillSummary.taker} partial={!breakdown.exact} fills={allFills.length} oldest={fillSummary.oldest} />
                        : <PanelLoading title="Maker / taker" className="h-[220px]" />}
                    </div>
                  </>
                )}

                {tab === 'positions' && (
                  <>
                    <StatStrip items={[
                      { label: 'Open', hint: 'Positions', value: String(positions.length) },
                      { label: 'Gross', hint: 'Long + short', value: `$${formatCompact(totalNotional)}`, bar: { pct: 1, color: 'var(--accent)' } },
                      { label: 'Long', hint: `${positions.filter((p) => p.size > 0).length} markets`, value: `$${formatCompact(longValue)}`, color: 'var(--pos)', bar: { pct: totalNotional ? longValue / totalNotional : 0, color: 'var(--pos)' } },
                      { label: 'Short', hint: `${positions.filter((p) => p.size < 0).length} markets`, value: `$${formatCompact(shortValue)}`, color: 'var(--neg)', bar: { pct: totalNotional ? shortValue / totalNotional : 0, color: 'var(--neg)' } },
                    ]} />
                    {!hasLiveData && positions.length === 0 ? (
                      <div className="p-6 text-[14px] text-[var(--role-content-muted)] flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />Fetching positions</div>
                    ) : <PositionsTable positions={positions} markPrices={markPrices} openTimes={positionOpenTimes} onOpen={openLiveChart} onShare={openShareCard} />}
                    {openOrders.length > 0 && (
                      <>
                        <h2 className="px-5 pt-5 pb-2 text-[15px] text-[var(--role-content)] border-t border-[var(--border-color)]">Open orders ({openOrders.length})</h2>
                        <OrdersList orders={openOrders} />
                      </>
                    )}
                  </>
                )}

                {tab === 'trades' && (
                  <>
                    <StatStrip items={[
                      { label: 'Fills', hint: breakdown.exact ? 'All time' : 'Latest available', value: fillsDone ? allFills.length.toLocaleString('en-US') : '—' },
                      { label: 'Volume', hint: 'All time', value: fillsDone ? `$${formatCompact(lifetimeVolume)}` : '—' },
                      { label: 'Realized PnL', hint: 'After fees', value: margin ? signed(margin.realizedPnl) : '—', color: margin ? pnlColor(margin.realizedPnl) : undefined },
                      { label: 'Fees', hint: 'Net of rebates', value: margin ? signed(margin.fees) : '—', color: margin ? pnlColor(margin.fees) : undefined },
                    ]} />
                    <div className="flex items-center gap-1 px-4 pt-3">
                      {([['fills', 'Fills'], ['closed', `Closed trades (${closedPositions.length})`]] as const).map(([k, label]) => (
                        <button key={k} type="button" onClick={() => setTradeView(k)} data-tour={k === 'closed' ? 'closed-trades' : undefined}
                          className={cn('px-2.5 py-1 rounded-md text-[13px] transition-colors', tradeView === k ? 'text-[var(--role-content)] bg-[var(--role-surface-raised)]' : 'text-[var(--role-content-muted)] hover:text-[var(--role-content)]')}>{label}</button>
                      ))}
                    </div>
                    {tradeView === 'fills' && !fillsDone ? (
                      <PanelLoading title="Fills" className="h-[320px]" />
                    ) : tradeView === 'fills' ? (
                      <>
                        <FillsTable fills={allFills} />
                        {!breakdown.exact && allFills.length > 0 && <div className="pt-3"><PartialNote fills={allFills.length} oldest={fillSummary.oldest} /></div>}
                      </>
                    ) : <ClosedPositionsList address={address} provided={closedPositions} limit={1000} density="table" onSelect={openClosedChart} />}
                  </>
                )}

                {tab === 'calendar' && (analysisReady
                  ? <PnlCalendar daily={dailyPnl} volume={fillSummary.dailyVolume} />
                  : <PanelLoading title="PnL calendar" className="h-[360px]" />)}

                {tab === 'funding' && <FundingPanel funding={funding} />}

                {tab === 'transfers' && (
                  <>
                    <StatStrip items={[
                      { label: 'In', hint: 'Deposits and transfers', value: transfers ? money(transferTotals.inn) : '—' },
                      { label: 'Out', hint: 'Withdrawals and transfers', value: transfers ? money(transferTotals.out) : '—' },
                      { label: 'Net deposited', value: netDeposited !== null ? money(netDeposited) : '—' },
                      { label: 'Return on deposits', hint: 'Total PnL', value: netDeposited !== null && netDeposited > 0 ? `${totalPnl >= 0 ? '+' : '−'}${Math.abs((totalPnl / netDeposited) * 100).toFixed(1)}%` : '—', color: netDeposited !== null && netDeposited > 0 ? pnlColor(totalPnl) : undefined },
                    ]} />
                    <ActivityFeed address={address} flush provided={transfers ?? undefined} />
                  </>
                )}

                {tab === 'liquidations' && <RiskEventsList address={address} bare />}
              </div>
            </div>

            {/* ── RAIL, STATS ──────────────────────────────────────────── */}
            <aside className="bg-[var(--role-surface-raised)] lg:border-r border-t border-[var(--border-color)] px-5 py-4 flex flex-col gap-4 min-w-0">
              <RailGroup title="Overview">
                <Row label="Available" value={margin ? money(margin.availableBalance) : '—'} />
                {netDeposited !== null && netDeposited > 0 && <Row label="Net deposited" value={money(netDeposited)} title="Deposits less withdrawals" />}
                {netDeposited !== null && netDeposited > 0 && <Row label="Return on deposits" value={`${totalPnl >= 0 ? '+' : '−'}${Math.abs((totalPnl / netDeposited) * 100).toFixed(1)}%`} color={pnlColor(totalPnl)} title="Total PnL ÷ net deposited. Doesn't weight for when money came in or out." />}
                <Row label="Exposure" value={totalNotional > 0 ? money(totalNotional) : '—'} />
                {leverage !== null && <Row label="Leverage" value={`${leverage.toFixed(1)}×`} />}
                {longShare !== null && <Row label="Direction" value={`${(longShare * 100).toFixed(0)}% long`} />}
                {closestLiq && <Row label={`Liquidation, ${coinOf(closestLiq.symbol)}`} value={`${(closestLiq.dist * 100).toFixed(1)}% away`} color={liqColor(closestLiq.dist)} title={`Liquidates at ${formatPx(closestLiq.price)}`} />}
                <Row label="All-time volume" value={!fillsDone ? '—' : lifetimeVolume > 0 ? money(lifetimeVolume) : '$0'} />
              </RailGroup>
              <div className="border-t border-[var(--border-color)]" />
              <RailGroup title="Performance" hint={record ? `${record.count.toLocaleString('en-US')} closed` : undefined}>
                {record ? (
                  <>
                    <Row label="Win rate" value={`${(record.winRate * 100).toFixed(1)}%`} />
                    {record.profitFactor !== null && <Row label="Profit factor" value={record.profitFactor.toFixed(2)} title="Dollars won for every dollar lost, before fees" />}
                    {record.avgWin !== null && <Row label="Average win" value={signed(record.avgWin)} />}
                    {record.avgLoss !== null && <Row label="Average loss" value={signed(record.avgLoss)} />}
                    {record.best && <Row label={`Best, ${coinOf(record.best.symbol)}`} value={signed(record.best.pnl)} />}
                    {record.worst && <Row label={`Worst, ${coinOf(record.worst.symbol)}`} value={signed(record.worst.pnl)} />}
                    {record.medianHoldMs !== null && <Row label="Typical hold" value={formatDuration(record.medianHoldMs)} title="Median time a position stayed open" />}
                  </>
                ) : <p className="py-1 text-[14px] text-[var(--role-content-subtle)]">No closed trades yet</p>}
                {drawdown !== null && <Row label="Max drawdown" value={money(-drawdown)} title="Largest fall in total PnL from an earlier high" />}
                {margin && <Row label="Fees" value={money(margin.fees)} />}
                {margin && <Row label="Funding" value={money(margin.funding)} />}
                {feeTier && <Row label="Fee rate (taker / maker)" value={`${(feeTier.takerBps / 100).toFixed(3)}% / ${(feeTier.makerBps / 100).toFixed(3)}%`} />}
                <Row label="Liquidations" value={String(tracked?.total_liquidations ?? 0)} color={(tracked?.total_liquidations ?? 0) > 0 ? 'var(--neg)' : undefined} />
                {Number(tracked?.adl_value ?? 0) > 0 && <Row label="Auto-deleveraged" value={money(Number(tracked?.adl_value))} title="Position closed by the exchange to cover another account" />}
              </RailGroup>
            </aside>
          </div>
        )}
      </main>

      {/* Position-detail chart modal, opened by clicking a position row. */}
      <PositionChartModal
        position={chartPosition}
        onClose={() => setChartPosition(null)}
      />
    </div>
  );
}
