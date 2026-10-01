'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Hash, Activity, Zap, ChevronRight, Info } from 'lucide-react';
import { BarChart, Bar, ResponsiveContainer, YAxis, Cell, Area, AreaChart, Tooltip } from 'recharts';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { explorer, formatCompact, type ExplorerBlock } from '@/lib/api';

// How many blocks to show in the list. Backend buffer caps at 1000,
// frontend caps the visible list at 50 — shorter feels snappier and
// older blocks aren't valuable without a search bar.
const BLOCK_LIMIT = 50;

// How many of the visible blocks feed the activity chart. Fewer than the
// table so each bar stays wide enough to read as it streams.
const CHART_LIMIT = 44;

// Poll cadence for the block list. Fast enough that users see blocks
// stream in live, slow enough that we're not hammering our own backend
// from a passive viewing page.
const POLL_INTERVAL_MS = 2_000;

// How long the "just arrived" flash lingers on a row before it settles
// into normal styling.
const FLASH_DURATION_MS = 1500;

// Table feed accumulates across polls (deduped by round) so rows persist and
// animate instead of the whole list being replaced every tick.
const FEED_CAP = 100;
// Points kept in the blocks/sec sparkline, and where it's cached so a
// returning visitor sees a populated chart on first paint.
const SPARK_CAP = 44;
const BPS_CACHE_KEY = 'bulkstats:explorer:bps';

type Metric = 'txCount' | 'actionCount';

// Blocks/sec from a CONTIGUOUS window (one poll's consecutive blocks). Never
// compute this from the accumulated feed — its between-poll gaps would deflate
// the rate badly.
function computeBps(bs: ExplorerBlock[]): number {
  if (bs.length < 2) return 0;
  const span = (bs[0].timestampNs - bs[bs.length - 1].timestampNs) / 1e9;
  return span > 0 ? (bs.length - 1) / span : 0;
}

function shortHash(hash: string): string {
  if (!hash || hash.length <= 12) return hash;
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

// Render time since block. We compare BULK's nanosecond timestamp to our
// local clock — there can be skew but for a "X seconds ago" label that's
// fine. Sub-second precision matters here because blocks are ~7ms apart.
function relativeTime(timestampNs: number): string {
  if (!timestampNs) return '-';
  const ageMs = Date.now() - timestampNs / 1_000_000;
  if (ageMs < 1000) return 'just now';
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1000)}s ago`;
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m ago`;
  return `${Math.floor(ageMs / 3_600_000)}h ago`;
}

// Reads a palette CSS custom property as a resolved hex and keeps it in
// sync when the active palette or theme changes on <html>. recharts sets
// fill as an SVG presentation attribute, which doesn't resolve var(--…),
// so the bar colour has to be a concrete value re-read on palette swaps.
function usePaletteColor(cssVar: string, fallback: string): string {
  const [color, setColor] = useState(fallback);
  useEffect(() => {
    const read = () => {
      const v = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
      if (v) setColor(v);
    };
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'data-palette'],
    });
    return () => obs.disconnect();
  }, [cssVar]);
  return color;
}

export default function ExplorerPage() {
  // `blocks` = the latest poll's contiguous window (drives stats + charts).
  // `feed`   = accumulated, deduped stream (drives the table) so rows persist
  //            across polls and can animate instead of being wholesale replaced.
  const [blocks, setBlocks] = useState<ExplorerBlock[]>([]);
  const [feed, setFeed] = useState<ExplorerBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>('actionCount');

  // Track which rounds we've ALREADY seen, so on each poll we know which
  // blocks are NEW (and get the flash animation) vs which were already
  // visible (and stay calm). A ref because mutations needn't re-render.
  const seenRoundsRef = useRef<Set<number>>(new Set());
  const [flashingRounds, setFlashingRounds] = useState<Set<number>>(new Set());

  // Blocks/sec sparkline history — seeded from localStorage so a returning
  // visitor sees a filled chart on first paint, and pushed on EVERY poll (not
  // only when the value changes) so it never freezes once the rate settles.
  const [bpsHist, setBpsHist] = useState<number[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const arr = JSON.parse(window.localStorage.getItem(BPS_CACHE_KEY) || '[]');
      return Array.isArray(arr) ? arr.filter((n: unknown) => typeof n === 'number' && n > 0).slice(-SPARK_CAP) : [];
    } catch { return []; }
  });

  const barColor = usePaletteColor('--accent', '#FFB457');

  useEffect(() => {
    let cancelled = false;

    const fetchBlocks = async () => {
      try {
        const res = await explorer.getRecentBlocks(BLOCK_LIMIT);
        if (cancelled) return;

        // Rounds we haven't seen before flash on arrival. First load seeds the
        // set without flashing so there's no opening wall of flashes.
        const isFirstLoad = seenRoundsRef.current.size === 0;
        const newRounds = new Set<number>();
        for (const b of res.blocks) {
          if (!seenRoundsRef.current.has(b.round)) {
            seenRoundsRef.current.add(b.round);
            if (!isFirstLoad) newRounds.add(b.round);
          }
        }

        setBlocks(res.blocks);

        // Accumulate the table feed: merge with what's shown, dedupe by round,
        // newest-first, cap. Unchanged rows keep their identity → they animate
        // to new positions rather than the list rebuilding from scratch.
        setFeed((prev) => {
          const map = new Map<number, ExplorerBlock>();
          for (const b of prev) map.set(b.round, b);
          for (const b of res.blocks) map.set(b.round, b);
          return [...map.values()].sort((a, b) => b.round - a.round).slice(0, FEED_CAP);
        });

        // One blocks/sec sample per poll → the sparkline always advances.
        const bps = computeBps(res.blocks);
        if (bps > 0) {
          setBpsHist((h) => {
            const next = [...h, bps].slice(-SPARK_CAP);
            try { window.localStorage.setItem(BPS_CACHE_KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
            return next;
          });
        }

        setLoading(false);
        setError(null);

        if (newRounds.size > 0) {
          setFlashingRounds((prev) => {
            const next = new Set(prev);
            for (const r of newRounds) next.add(r);
            return next;
          });
          window.setTimeout(() => {
            setFlashingRounds((prev) => {
              const next = new Set(prev);
              for (const r of newRounds) next.delete(r);
              return next;
            });
          }, FLASH_DURATION_MS);
        }
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message || 'Failed to load blocks');
      }
    };

    fetchBlocks();
    const tick = window.setInterval(fetchBlocks, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(tick);
    };
  }, []);

  // Stats + activity chart from the latest contiguous poll window.
  const stats = useMemo(() => {
    if (blocks.length === 0) {
      return { latestRound: 0, blocksPerSec: 0, avgTxs: 0, totalActions: 0 };
    }
    const totalTxs = blocks.reduce((s, b) => s + b.txCount, 0);
    const totalActions = blocks.reduce((s, b) => s + b.actionCount, 0);
    return {
      latestRound: blocks[0].round,
      blocksPerSec: computeBps(blocks),
      avgTxs: totalTxs / blocks.length,
      totalActions,
    };
  }, [blocks]);

  // Oldest → newest so the chart reads left-to-right as time advances.
  const chartData = useMemo(
    () => blocks.slice(0, CHART_LIMIT).reverse().map(b => ({
      round: b.round,
      txCount: b.txCount,
      actionCount: b.actionCount,
    })),
    [blocks],
  );

  const metricLabel = metric === 'txCount' ? 'Txs' : 'Actions';

  return (
    <main className="responsive-container py-6 space-y-4">
      {/* Header — serif page title, matching the analytics routes. */}
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title text-[var(--role-content)]">Block Explorer</h1>
          <p className="mt-1 text-[13px] text-[var(--role-content-muted)]">
            Live block stream from BULK&apos;s network - last {BLOCK_LIMIT} blocks.
          </p>
        </div>
      </div>

      {error && feed.length === 0 && (
        <div className="rounded-[var(--radius-md)] border border-[rgb(var(--neg-rgb)/0.3)] bg-[rgb(var(--neg-rgb)/0.1)] px-4 py-3 text-sm text-[var(--role-signal-negative)]">
          {error}
        </div>
      )}

      {/* KPI strip — same card language as the dashboard (big number over a
          full-bleed area backdrop). */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <ExplorerKpi
          label="Latest round"
          value={<AnimatedNumber value={stats.latestRound} format={(n) => Math.round(n).toLocaleString()} />}
          color="var(--role-signal-info)"
          big
        />
        <ExplorerKpi
          label="Blocks / sec"
          value={<AnimatedNumber value={stats.blocksPerSec} format={(n) => n.toFixed(1)} />}
          sub="rolling, this window"
          spark={bpsHist}
          color="var(--accent)"
        />
        <ExplorerKpi
          label="Avg txs / block"
          value={<AnimatedNumber value={stats.avgTxs} format={(n) => n.toFixed(2)} />}
          spark={chartData.map((d) => d.txCount)}
          color="var(--pos)"
        />
        <ExplorerKpi
          label="Actions"
          value={<AnimatedNumber value={stats.totalActions} format={(n) => formatCompact(Math.round(n))} />}
          sub={`last ${blocks.length || BLOCK_LIMIT} blocks`}
          spark={chartData.map((d) => d.actionCount)}
          color="var(--role-signal-info)"
        />
      </div>

      {/* Block activity — live histogram of txs / actions per block. */}
      <section className="glass-card">
        <div className="panel-header">
          <h2 className="panel-title t-h2">Block activity</h2>
          <div className="flex items-center gap-2 shrink-0">
            {/* The orientation hint lives behind an info affordance instead of a
                permanent footer caption. */}
            <span className="group relative inline-flex">
              <Info className="h-3.5 w-3.5 cursor-help text-[var(--role-content-subtle)] transition-colors hover:text-[var(--role-content-muted)]" />
              <span className="pointer-events-none absolute right-0 top-full z-20 mt-1.5 hidden whitespace-nowrap rounded-md border border-[var(--role-line)] bg-[var(--bg-overlay)] px-2.5 py-1.5 text-[11px] text-[var(--role-content-muted)] shadow-lg backdrop-blur-sm group-hover:block">
                {metricLabel} per block · newest on the right
              </span>
            </span>
            <div className="toggle-group">
              {(['actionCount', 'txCount'] as Metric[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMetric(m)}
                  className={`toggle-btn ${metric === m ? 'active' : ''}`}
                >
                  {m === 'txCount' ? 'Txs' : 'Actions'}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="h-40 px-2 pb-2 pt-3">
          {chartData.length < 2 ? (
            <div className="flex h-full items-center justify-center text-[11px] text-[var(--role-content-subtle)]">
              Collecting blocks…
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }} barCategoryGap={2}>
                <defs>
                  <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={barColor} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={barColor} stopOpacity={0.35} />
                  </linearGradient>
                </defs>
                <YAxis hide domain={[0, 'dataMax']} />
                <Tooltip
                  cursor={{ fill: 'var(--role-surface-raised)', opacity: 0.5 }}
                  content={<ActivityTooltip metricLabel={metricLabel} metric={metric} />}
                />
                <Bar dataKey={metric} radius={[2, 2, 0, 0]} isAnimationActive={false}>
                  {chartData.map((d, i) => (
                    <Cell
                      key={i}
                      fill={d[metric] > 0 ? 'url(#barGrad)' : barColor}
                      fillOpacity={d[metric] > 0 ? (i === chartData.length - 1 ? 1 : 0.72) : 0.1}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* Recent blocks — the live streaming table. */}
      <section className="glass-card">
        <div className="panel-header">
          <h2 className="panel-title t-h2">Recent blocks</h2>
        </div>

        {/* Column header */}
        <div className="grid grid-cols-[110px_1fr_72px_84px_112px] gap-3 border-b border-[var(--role-line)] px-4 py-2">
          <span className="t-label">Round</span>
          <span className="t-label">Block hash</span>
          <span className="t-label text-right">Txs</span>
          <span className="t-label text-right">Actions</span>
          <span className="t-label text-right">Age</span>
        </div>

        {loading && feed.length === 0 ? (
          <div className="px-4 py-14 text-center text-[var(--role-content-subtle)]">
            <div className="mx-auto mb-3 h-5 w-5 animate-spin rounded-full border-2 border-[var(--role-line)] border-t-[var(--role-chrome)]" />
            <p className="text-sm">Loading blocks…</p>
          </div>
        ) : feed.length === 0 ? (
          <div className="px-4 py-14 text-center text-sm text-[var(--role-content-subtle)]">
            No blocks yet. The explorer connects on backend boot and fills as new blocks stream in.
          </div>
        ) : (
          // The list lives in its OWN scroll container with a fixed max height,
          // so the feed turning over every poll can never move the PAGE scroll
          // position (the old full-rebuild bug that snapped you to the top).
          // The feed is accumulated + deduped by round, so already-shown rows
          // keep their identity (stable keys) and DON'T re-animate; only the
          // newly-arrived blocks slide+fade in at the top. `initial={false}`
          // suppresses the first-load wall. No `layout` animation — with near-
          // total turnover each poll it would fling surviving rows across the
          // list; a simple enter animation reads like a proper activity feed.
          <div className="max-h-[60vh] overflow-y-auto overscroll-contain" style={{ overflowAnchor: 'none' }}>
            <AnimatePresence initial={false}>
              {feed.map((b) => {
                const isFlashing = flashingRounds.has(b.round);
                return (
                  <motion.div
                    key={b.blockhash || b.round}
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                    // Opaque resting fill == the panel's own background, held as a
                    // live var so it re-tints with the palette and never bakes a hex.
                    style={{ backgroundColor: 'var(--bg-muted)' }}
                    className="relative border-b border-[var(--role-line-subtle)] last:border-b-0"
                  >
                    {/* Arrival flash — a positive-tinted overlay that fades out. */}
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-0"
                      style={{
                        backgroundColor: 'rgb(var(--pos-rgb) / 0.12)',
                        opacity: isFlashing ? 1 : 0,
                        transition: 'opacity 1.2s ease',
                      }}
                    />
                    <Link
                      href={`/explorer/block/${b.blockhash}`}
                      prefetch={false}
                      className="group relative z-[1] grid grid-cols-[110px_1fr_72px_84px_112px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--role-surface-raised)]"
                    >
                    <div className="font-mono text-sm tabular-nums text-[var(--role-chrome)]">
                      {b.round.toLocaleString()}
                    </div>
                    <div className="flex items-center gap-1.5 truncate font-mono text-sm text-[var(--role-content-muted)] transition-colors group-hover:text-[var(--role-content)]">
                      <Hash className="h-3.5 w-3.5 shrink-0 text-[var(--role-content-subtle)]" />
                      <span className="truncate">{shortHash(b.blockhash)}</span>
                    </div>
                    <div className="text-right font-mono text-sm tabular-nums">
                      <span className={b.txCount > 0 ? 'text-[var(--role-content)]' : 'text-[var(--role-content-subtle)]'}>
                        {b.txCount}
                      </span>
                    </div>
                    <div className="text-right font-mono text-sm tabular-nums">
                      <span className={b.actionCount > 0 ? 'text-[var(--role-chrome)]' : 'text-[var(--role-content-subtle)]'}>
                        {b.actionCount}
                      </span>
                    </div>
                    <div className="flex items-center justify-end gap-1 text-right text-xs text-[var(--role-content-subtle)]">
                      {relativeTime(b.timestampNs)}
                      <ChevronRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                    </div>
                    </Link>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </section>

      {/* Glossary — explorer terminology isn't intuitive; a small key helps. */}
      <div className="grid grid-cols-1 gap-3 px-1 text-xs text-[var(--role-content-subtle)] sm:grid-cols-3">
        <div className="flex items-start gap-2">
          <Hash className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-medium text-[var(--role-content-muted)]">Round</span> - block height. BULK produces a block every ~7ms.
          </span>
        </div>
        <div className="flex items-start gap-2">
          <Activity className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-medium text-[var(--role-content-muted)]">Txs</span> - transactions in this block.
          </span>
        </div>
        <div className="flex items-start gap-2">
          <Zap className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-medium text-[var(--role-content-muted)]">Actions</span> - sub-tx units (price updates, matches, range computations).
          </span>
        </div>
      </div>
    </main>
  );
}

// KPI card matching the dashboard's MetricMiniCard: big number over a
// full-bleed area backdrop pinned to the card's lower edge. The backdrop only
// draws when there's a ≥2-point series; otherwise the number sits alone.
function ExplorerKpi({ label, value, spark, color, sub, big }: {
  label: string; value: React.ReactNode; spark?: number[]; color: string; sub?: string;
  /** No sparkline → give the number more room (e.g. Latest round). */
  big?: boolean;
}) {
  const data = (spark ?? []).map((v, i) => ({ i, v }));
  const gid = `ekpi-${label.replace(/[^a-z]/gi, '')}`;
  return (
    <div className={`glass-card relative flex h-[118px] flex-col overflow-hidden p-4 sm:h-[128px] ${big ? 'justify-center' : ''}`}>
      {data.length >= 2 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[62px] opacity-90">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis hide domain={['dataMin', 'dataMax']} />
              {/* Smooth path morph as a new sample appends each poll. */}
              <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#${gid})`} dot={false} isAnimationActive animationDuration={450} animationEasing="ease-out" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="relative z-10">
        <div className="truncate text-[12px] font-medium text-[var(--role-content-subtle)]">{label}</div>
        <div className={`mt-1.5 font-medium font-sans leading-none tracking-tight tabular-nums text-[var(--role-content)] ${big ? 'text-[34px] sm:text-[44px]' : 'text-[26px] sm:text-[30px]'}`}>
          {value}
        </div>
        {sub && <div className="mt-1.5 text-[11px] text-[var(--role-content-subtle)]">{sub}</div>}
      </div>
    </div>
  );
}

// Hover tooltip for the activity histogram — round + the active metric.
function ActivityTooltip({ active, payload, metricLabel, metric }: {
  active?: boolean; payload?: Array<{ payload: { round: number; txCount: number; actionCount: number } }>; metricLabel?: string; metric?: Metric;
}) {
  if (!active || !payload || !payload.length || !metric) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border border-[var(--role-line)] bg-[var(--bg-overlay)] px-2.5 py-1.5 text-[11px] shadow-lg backdrop-blur-sm">
      <div className="font-mono tabular-nums text-[var(--role-content-muted)]">Round {Number(d.round).toLocaleString()}</div>
      <div className="mt-0.5 tabular-nums text-[var(--role-content)]">
        {metricLabel}: <span className="font-medium">{d[metric]}</span>
      </div>
    </div>
  );
}
