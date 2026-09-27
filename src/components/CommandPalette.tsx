'use client';

// Global ⌘K / Ctrl-K command palette.
//
// One search surface reachable from anywhere on the site — the "search across
// the whole site" that a stats product is expected to have. It searches three
// things at once and lets you jump with the keyboard:
//   • Pages    — every route (Analytics, Liquidations, Risk, Order Book, …)
//   • Markets  — every active perp (→ the Order Book page for that coin)
//   • Wallets  — @username / address lookup (→ the whale page), via userApi
//
// Mounted once in the root layout. Opens on ⌘K/Ctrl-K or the header button,
// closes on Esc / backdrop / select. Arrow keys move, Enter selects.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Loader2, ArrowRight, TrendingUp, Wallet as WalletIcon, LayoutGrid, BarChart3, CornerDownLeft } from 'lucide-react';
import { userApi, formatAddress, formatCompact, cn, type UserSearchResult } from '@/lib/api';
import { withNetwork } from '@/lib/network';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.bulkstats.com';

// Top-level destinations — plain names, no "Analytics · " prefix.
const PAGES: { label: string; href: string; hint?: string }[] = [
  { label: 'Dashboard', href: '/', hint: 'Overview' },
  { label: 'Analytics', href: '/analytics/general', hint: 'Volume · OI · Funding · Trades' },
  { label: 'Liquidations', href: '/analytics/liquidations' },
  { label: 'Risk', href: '/analytics/risk', hint: 'Spread · Volatility · Margin' },
  { label: 'Staking', href: '/analytics/staking' },
  { label: 'Pre-Deposit', href: '/analytics/predeposit' },
  { label: 'Network', href: '/analytics/network', hint: 'Sequencer performance' },
  { label: 'Order Book', href: '/analytics/orderbook', hint: 'Depth · Slippage' },
  { label: 'Leaderboard', href: '/leaderboard' },
  { label: 'Whale Tracker', href: '/whales' },
  { label: 'Explorer', href: '/explorer' },
  { label: 'Following', href: '/following' },
  { label: 'Profile', href: '/profile' },
];

// Individual charts & tools, searchable by name (each jumps to the page it
// lives on). Names match the on-page headings.
const CHARTS: { label: string; href: string; on: string }[] = [
  // Analytics (general)
  { label: 'Total Volume', on: 'Analytics', href: '/analytics/general' },
  { label: 'Open Interest', on: 'Analytics', href: '/analytics/general' },
  { label: 'Funding Rate', on: 'Analytics', href: '/analytics/general' },
  { label: 'Number of Trades', on: 'Analytics', href: '/analytics/general' },
  { label: 'Auto-Deleveraging (ADL)', on: 'Analytics', href: '/analytics/general' },
  { label: 'Daily Active Users', on: 'Analytics', href: '/analytics/general' },
  { label: 'Cumulative New Users', on: 'Analytics', href: '/analytics/general' },
  { label: 'Unique Traders by Coin', on: 'Analytics', href: '/analytics/general' },
  { label: 'Protocol Revenue', on: 'Analytics', href: '/analytics/general' },
  // Liquidations
  { label: 'Total Liquidations', on: 'Liquidations', href: '/analytics/liquidations' },
  { label: 'Liquidation Heatmap', on: 'Liquidations', href: '/analytics/liquidations' },
  // Risk
  { label: 'Market Regime', on: 'Risk', href: '/analytics/risk' },
  { label: 'Fair vs Mark Spread', on: 'Risk', href: '/analytics/risk' },
  { label: 'Volatility History', on: 'Risk', href: '/analytics/risk' },
  { label: 'Volatility Heatmap', on: 'Risk', href: '/analytics/risk' },
  { label: 'Correlation Matrix', on: 'Risk', href: '/analytics/risk' },
  { label: 'Margin Surface', on: 'Risk', href: '/analytics/risk' },
  { label: 'Portfolio Margin', on: 'Risk', href: '/analytics/risk' },
  // Staking
  { label: 'TVL Over Time', on: 'Staking', href: '/analytics/staking' },
  { label: 'Native vs Liquid Share', on: 'Staking', href: '/analytics/staking' },
  { label: 'Validator Distribution', on: 'Staking', href: '/analytics/staking' },
  { label: 'Wallet Distribution', on: 'Staking', href: '/analytics/staking' },
  { label: 'Stakes vs Unstakes', on: 'Staking', href: '/analytics/staking' },
  // Pre-Deposit
  { label: 'TVL History', on: 'Pre-Deposit', href: '/analytics/predeposit' },
  { label: 'Daily Deposits / Withdrawals', on: 'Pre-Deposit', href: '/analytics/predeposit' },
  { label: 'New Depositors per Day', on: 'Pre-Deposit', href: '/analytics/predeposit' },
  { label: 'Net Flow per Day', on: 'Pre-Deposit', href: '/analytics/predeposit' },
  { label: 'Withdrawal Rate', on: 'Pre-Deposit', href: '/analytics/predeposit' },
  { label: 'Deposit Size Trend', on: 'Pre-Deposit', href: '/analytics/predeposit' },
  { label: 'Cohort Analysis', on: 'Pre-Deposit', href: '/analytics/predeposit' },
  { label: 'Gini Coefficient', on: 'Pre-Deposit', href: '/analytics/predeposit' },
  { label: 'Deposit Heatmap', on: 'Pre-Deposit', href: '/analytics/predeposit' },
  // Network
  { label: 'Consensus Latency', on: 'Network', href: '/analytics/network' },
  { label: 'Account Growth', on: 'Network', href: '/analytics/network' },
  { label: 'Reward Pool', on: 'Network', href: '/analytics/network' },
  // Order Book
  { label: 'Order Book Depth', on: 'Order Book', href: '/analytics/orderbook' },
  { label: 'Slippage & Impact', on: 'Order Book', href: '/analytics/orderbook' },
];

type Market = { symbol: string; lastPrice: number; changePct: number };

type Row =
  | { kind: 'page'; key: string; label: string; sub?: string; href: string }
  | { kind: 'chart'; key: string; label: string; sub?: string; href: string }
  | { kind: 'market'; key: string; label: string; sub?: string; symbol: string }
  | { kind: 'wallet'; key: string; label: string; sub?: string; address: string; avatar?: string };

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [markets, setMarkets] = useState<Market[]>([]);
  const [wallets, setWallets] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const [isMac, setIsMac] = useState(true);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const marketsLoaded = useRef(false);

  useEffect(() => {
    if (typeof navigator !== 'undefined') setIsMac(/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent));
  }, []);

  // Global hotkey: ⌘K / Ctrl-K toggles; Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    // Let the header button (and anything else) open it via a custom event.
    const openEvt = () => setOpen(true);
    window.addEventListener('bulkstats:open-command', openEvt);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('bulkstats:open-command', openEvt);
    };
  }, []);

  // On open: focus the field, reset, lock body scroll, and lazily load the
  // markets list ONCE (so the palette doesn't poll tickers in the background).
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setWallets([]);
    setActive(0);
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    document.body.style.overflow = 'hidden';

    if (!marketsLoaded.current) {
      marketsLoaded.current = true;
      fetch(`${API_URL}${withNetwork('/api/analytics/tickers-bulk')}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!j?.tickers) return;
          setMarkets(
            (j.tickers as any[])
              .map((t) => ({ symbol: String(t.symbol ?? ''), lastPrice: Number(t.lastPrice) || 0, changePct: Number(t.priceChangePercent) || 0 }))
              .filter((m: Market) => m.symbol),
          );
        })
        .catch(() => { marketsLoaded.current = false; });
    }
    return () => { clearTimeout(t); document.body.style.overflow = ''; };
  }, [open]);

  // Debounced wallet / @username search (only when the query is substantial).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2 || q.length >= 40) { setWallets([]); setSearching(false); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await userApi.search(q);
        setWallets(res.slice(0, 6));
      } catch { setWallets([]); }
      finally { setSearching(false); }
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // Build the flat, ordered result set from the current query.
  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const out: Row[] = [];

    const pages = (q
      ? PAGES.filter((p) => p.label.toLowerCase().includes(q) || p.hint?.toLowerCase().includes(q) || p.href.includes(q))
      : PAGES
    ).slice(0, q ? 5 : PAGES.length);
    for (const p of pages) out.push({ kind: 'page', key: `p:${p.href}`, label: p.label, sub: p.hint, href: p.href });

    if (q) {
      const ch = CHARTS.filter((c) => c.label.toLowerCase().includes(q) || c.on.toLowerCase().includes(q)).slice(0, 8);
      for (const c of ch) out.push({ kind: 'chart', key: `c:${c.label}`, label: c.label, sub: `Chart · ${c.on}`, href: c.href });

      const mk = markets.filter((m) => m.symbol.toLowerCase().includes(q)).slice(0, 6);
      for (const m of mk) {
        out.push({ kind: 'market', key: `m:${m.symbol}`, label: m.symbol, sub: `$${formatCompact(m.lastPrice)} · ${m.changePct >= 0 ? '+' : ''}${m.changePct.toFixed(2)}%`, symbol: m.symbol });
      }
    }

    for (const w of wallets) {
      const name = w.twitter_name || (w.twitter_handle ? `@${w.twitter_handle}` : formatAddress(w.wallet_address));
      const parts: string[] = [formatAddress(w.wallet_address)];
      if (w.total_pnl != null) parts.push(`PnL ${w.total_pnl >= 0 ? '+' : ''}$${formatCompact(w.total_pnl)}`);
      out.push({ kind: 'wallet', key: `w:${w.wallet_address}`, label: name, sub: parts.join(' · '), address: w.wallet_address, avatar: w.twitter_avatar });
    }

    return out;
  }, [query, markets, wallets]);

  // Keep the active index in range as the result set changes.
  useEffect(() => { setActive((a) => Math.min(a, Math.max(0, rows.length - 1))); }, [rows.length]);

  const go = useCallback((row: Row) => {
    setOpen(false);
    if (row.kind === 'page' || row.kind === 'chart') router.push(row.href);
    else if (row.kind === 'market') router.push(`/analytics/orderbook?coin=${encodeURIComponent(row.symbol)}`);
    else router.push(`/whales/${row.address}`);
  }, [router]);

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = rows[active]; if (r) go(r); }
  };

  // Scroll the active row into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  // Section boundaries for headers (first row of each kind gets a label).
  const firstOf = (kind: Row['kind']) => rows.findIndex((r) => r.kind === kind);
  const firstPage = firstOf('page'), firstChart = firstOf('chart'), firstMarket = firstOf('market'), firstWallet = firstOf('wallet');

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh] animate-modal-backdrop"
      style={{ background: 'rgb(var(--p-bg) / 0.55)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div className="w-full max-w-[560px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--role-line)] bg-[var(--role-surface)] shadow-[var(--shadow-lg)] animate-modal-panel">
        {/* Input */}
        <div className="flex items-center gap-2.5 border-b border-[var(--role-line)] px-4">
          <Search className="h-4 w-4 shrink-0 text-[var(--role-content-subtle)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onInputKey}
            placeholder="Search pages, markets, wallets or @username…"
            className="w-full bg-transparent py-3.5 text-sm text-[var(--role-content)] placeholder-[var(--role-content-subtle)] focus:outline-none"
          />
          {searching && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--role-content-subtle)]" />}
          <kbd className="hidden shrink-0 rounded border border-[var(--role-line)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--role-content-subtle)] sm:block">esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1.5">
          {rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-[var(--role-content-subtle)]">
              {query.trim() ? 'No matches.' : 'Type to search.'}
            </div>
          ) : (
            rows.map((row, i) => (
              <div key={row.key}>
                {i === firstPage && <SectionLabel>Pages</SectionLabel>}
                {i === firstChart && <SectionLabel>Charts &amp; Tools</SectionLabel>}
                {i === firstMarket && <SectionLabel>Markets</SectionLabel>}
                {i === firstWallet && <SectionLabel>Wallets</SectionLabel>}
                <button
                  data-idx={i}
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(row)}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
                    active === i ? 'bg-[var(--role-surface-raised)]' : 'hover:bg-[var(--role-surface-raised)]/60',
                  )}
                >
                  <RowIcon row={row} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-[var(--role-content)]">{row.label}</div>
                    {row.sub && <div className="truncate text-[11px] tabular-nums text-[var(--role-content-subtle)]">{row.sub}</div>}
                  </div>
                  {active === i ? (
                    <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-[var(--role-content-subtle)]" />
                  ) : (
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-transparent" />
                  )}
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between border-t border-[var(--role-line)] px-4 py-2 text-[10px] text-[var(--role-content-subtle)]">
          <span className="flex items-center gap-2">
            <span><kbd className="rounded border border-[var(--role-line)] px-1">↑</kbd> <kbd className="rounded border border-[var(--role-line)] px-1">↓</kbd> navigate</span>
            <span><kbd className="rounded border border-[var(--role-line)] px-1">↵</kbd> open</span>
          </span>
          <span>{isMac ? '⌘' : 'Ctrl'} K</span>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--role-content-subtle)]">{children}</div>;
}

function RowIcon({ row }: { row: Row }) {
  const base = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-md';
  if (row.kind === 'wallet') {
    return row.avatar
      ? <img src={row.avatar} alt="" className="h-7 w-7 shrink-0 rounded-md border border-[var(--role-line)] object-cover" />
      : <span className={cn(base, 'bg-[var(--role-surface-raised)] text-[var(--role-content-subtle)]')}><WalletIcon className="h-3.5 w-3.5" /></span>;
  }
  if (row.kind === 'market') return <span className={cn(base, 'bg-[var(--role-surface-raised)] text-[var(--pos)]')}><TrendingUp className="h-3.5 w-3.5" /></span>;
  if (row.kind === 'chart') return <span className={cn(base, 'bg-[var(--role-surface-raised)] text-[var(--accent)]')}><BarChart3 className="h-3.5 w-3.5" /></span>;
  return <span className={cn(base, 'bg-[var(--role-surface-raised)] text-[var(--role-content-subtle)]')}><LayoutGrid className="h-3.5 w-3.5" /></span>;
}
