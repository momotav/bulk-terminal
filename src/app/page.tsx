'use client';

import { VolumeHero } from '@/components/VolumeHero';
import { TodayPanel } from '@/components/TodayPanel';
import { TelemetryPanel } from '@/components/TelemetryPanel';
import { RecentActivity } from '@/components/RecentActivity';
import { MarketTicker } from '@/components/MarketTicker';
import { MarketsTable } from '@/components/MarketsTable';
import { LiquidationBreakdown } from '@/components/LiquidationBreakdown';
import { cn } from '@/lib/api';
import { useTickers } from '@/hooks/useTickers';

export default function HomePage() {
  // One ticker poll feeds both the strip and the markets table.
  const { tickers, loading: tickersLoading } = useTickers();

  return (
    /* LAYOUT
       Three zones, each with its own rhythm rather than one uniform
       stack:

         1. Command bar   search + network telemetry, side by side
         2. Overview      the KPI band
         3. Market        the two data panels

       Zones 1 and 2 are coupled (both are "state of the exchange right
       now") and sit 12px apart. Zone 3 opens a new idea and gets 32px
       plus a labelled masthead. Everything measures against
       .responsive-container, which runs to 120rem with fluid gutters -
       on any display up to 1920px the grid fills the viewport instead
       of stranding margin at the edges. */
    <main className="responsive-container flex-1 py-3 lg:py-4">
      {/* Market tape — every active perp, last price and 24h change,
          running full width across the very top, under the nav. */}
      <MarketTicker tickers={tickers} loading={tickersLoading} />

      {/* Page header — a calm sentence-case heading. Search lives in the top-nav
          ⌘K command palette (wallets, markets, pages), so no separate field
          here. */}
      <header className="mt-4">
        <h1 className="font-sans text-2xl font-semibold leading-none tracking-tight text-[var(--role-content)] sm:text-[28px]">
          Overview
        </h1>
        <p className="mt-1.5 text-[13px] text-[var(--role-content-muted)]">
          Real-time analytics for BULK Exchange
        </p>
      </header>

      {/* TODAY — the exchange at a glance. A lead Volume hero (big number over a
          full history bar chart, with timeframe pills) beside the three
          remaining KPIs stacked in the right third. ASXN/Hyperliquid-style
          asymmetric hero. Stacks to a single column below lg. */}
      <SectionLabel className="mt-6">Today</SectionLabel>
      <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Left: Total Volume hero. Right: two metric cards + a wide Revenue
            card, ASXN-style. */}
        <div className="min-h-[320px] lg:min-h-[440px]">
          <VolumeHero />
        </div>
        <div className="min-h-[320px] lg:min-h-[440px]">
          <TodayPanel />
        </div>
      </div>

      {/* Markets + telemetry — the markets table narrowed to 8/12 with the
          network telemetry graphed in the freed 4/12: a tabbed live chart
          of TPS / APS instead of plain KPI text. Stacks below lg. */}
      <SectionLabel className="mt-8">Markets</SectionLabel>
      <section aria-label="Markets" className="mt-2">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="h-[480px] lg:col-span-8">
            <MarketsTable tickers={tickers} loading={tickersLoading} />
          </div>
          <div className="h-[480px] lg:col-span-4">
            <TelemetryPanel />
          </div>
        </div>
      </section>

      {/* Market activity — the live trade/liquidation feed beside the 24h
          liquidation split per market, 8/4 from lg.

          (The former Top Traders / Whale Watch / Hall of Shame ranking
          panels ran on BULK's official indexer leaderboard, disabled when
          the trading competition ended. These two run on our OWN collected
          data and work today.) */}
      <SectionLabel className="mt-8">Activity</SectionLabel>
      <section aria-label="Market activity" className="mt-2">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="h-[420px] sm:h-[480px] lg:col-span-8">
            <RecentActivity />
          </div>
          <div className="h-[420px] sm:h-[480px] lg:col-span-4">
            <LiquidationBreakdown />
          </div>
        </div>
      </section>
    </main>
  );
}

// Quiet eyebrow label that segments the page into scannable chapters
// (Today / Markets / Activity) — the editorial rhythm ASXN uses.
function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={cn('text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--role-content-subtle)]', className)}>
      {children}
    </h2>
  );
}
