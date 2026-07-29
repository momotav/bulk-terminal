'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Hash, Activity, Zap, ChevronRight, Layers } from 'lucide-react';
import { BarChart, Bar, ResponsiveContainer, YAxis, Cell } from 'recharts';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { StatCard } from '@/components/StatCard';
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

type Metric = 'txCount' | 'actionCount';

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
  const [blocks, setBlocks] = useState<ExplorerBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>('actionCount');

  // Track which rounds we've ALREADY seen, so on each poll we know which
  // blocks are NEW (and get the flash animation) vs which were already
  // visible (and stay calm). A ref because mutations needn't re-render.
  const seenRoundsRef = useRef<Set<number>>(new Set());
  const [flashingRounds, setFlashingRounds] = useState<Set<number>>(new Set());

  const barColor = usePaletteColor('--accent', '#FFB457');

  useEffect(() => {
    let cancelled = false;

    const fetchBlocks = async () => {
      try {
        const res = await explorer.getRecentBlocks(BLOCK_LIMIT);
        if (cancelled) return;

        // Identify rounds we haven't seen before — those are the "new
        // arrivals" that should flash. On first load EVERY block is new,
        // but we don't want a wall of flashes, so the initial batch just
        // seeds `seenRounds` and only subsequent arrivals flash.
        const isFirstLoad = seenRoundsRef.current.size === 0;
        const newRounds = new Set<number>();
        for (const b of res.blocks) {
          if (!seenRoundsRef.current.has(b.round)) {
            seenRoundsRef.current.add(b.round);
            if (!isFirstLoad) newRounds.add(b.round);
          }
        }

        setBlocks(res.blocks);
        setLoading(false);
        setError(null);

        if (newRounds.size > 0) {
          setFlashingRounds(prev => {
            const next = new Set(prev);
            for (const r of newRounds) next.add(r);
            return next;
          });
          window.setTimeout(() => {
            setFlashingRounds(prev => {
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

  // Derived live stats for the KPI strip + activity chart. All computed
  // from the visible window so they stay in lockstep with the table.
  const stats = useMemo(() => {
    if (blocks.length === 0) {
      return { latestRound: 0, blocksPerSec: 0, avgTxs: 0, totalActions: 0 };
    }
    const totalTxs = blocks.reduce((s, b) => s + b.txCount, 0);
    const totalActions = blocks.reduce((s, b) => s + b.actionCount, 0);
    const newest = blocks[0].timestampNs;
    const oldest = blocks[blocks.length - 1].timestampNs;
    const spanSec = newest && oldest ? (newest - oldest) / 1e9 : 0;
    const blocksPerSec = spanSec > 0 ? (blocks.length - 1) / spanSec : 0;
    return {
      latestRound: blocks[0].round,
      blocksPerSec,
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

  const liveBadge = !loading && blocks.length > 0 && (
    <span className="flex items-center gap-1.5">
      <span className="relative flex h-1.5 w-1.5">
        <span
          className="live-halo absolute inline-flex h-full w-full rounded-full"
          style={{ backgroundColor: 'var(--role-signal-positive)' }}
        />
        <span
          className="live-core relative inline-flex h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: 'var(--role-signal-positive)' }}
        />
      </span>
      <span className="text-[11px] font-medium text-[var(--role-content-muted)]">Live</span>
    </span>
  );

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
        {liveBadge}
      </div>

      {error && blocks.length === 0 && (
        <div className="rounded-[var(--radius-md)] border border-[rgb(var(--neg-rgb)/0.3)] bg-[rgb(var(--neg-rgb)/0.1)] px-4 py-3 text-sm text-[var(--role-signal-negative)]">
          {error}
        </div>
      )}

      {/* KPI strip — live network stats derived from the visible window. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Latest round" value={<AnimatedNumber value={stats.latestRound} format={(n) => Math.round(n).toLocaleString()} />} />
        <StatCard label="Blocks / sec" value={<AnimatedNumber value={stats.blocksPerSec} format={(n) => n.toFixed(1)} />} sub="rolling, this window" />
        <StatCard label="Avg txs / block" value={<AnimatedNumber value={stats.avgTxs} format={(n) => n.toFixed(2)} />} />
        <StatCard label="Actions" value={<AnimatedNumber value={stats.totalActions} format={(n) => formatCompact(Math.round(n))} />} sub={`last ${blocks.length || BLOCK_LIMIT} blocks`} />
      </div>

      {/* Block activity — live histogram of txs / actions per block. */}
      <section className="glass-card">
        <div className="panel-header">
          <h2 className="panel-title t-h2">Block activity</h2>
          <div className="toggle-group shrink-0">
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
        <div className="h-32 px-2 py-3">
          {chartData.length < 2 ? (
            <div className="flex h-full items-center justify-center text-[11px] text-[var(--role-content-subtle)]">
              Collecting blocks…
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }} barCategoryGap={2}>
                <YAxis hide domain={[0, 'dataMax']} />
                <Bar dataKey={metric} radius={[2, 2, 0, 0]} isAnimationActive={false}>
                  {chartData.map((d, i) => (
                    <Cell
                      key={i}
                      fill={barColor}
                      fillOpacity={d[metric] > 0 ? (i === chartData.length - 1 ? 1 : 0.55) : 0.12}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="border-t border-[var(--role-line)] px-4 py-2">
          <p className="text-[11px] text-[var(--role-content-subtle)]">
            {metricLabel} per block · newest on the right
          </p>
        </div>
      </section>

      {/* Recent blocks — the live streaming table. */}
      <section className="glass-card">
        <div className="panel-header">
          <h2 className="panel-title t-h2 flex items-center gap-2">
            <Layers className="h-3.5 w-3.5 text-[var(--role-content-subtle)]" />
            Recent blocks
          </h2>
          {liveBadge}
        </div>

        {/* Column header */}
        <div className="grid grid-cols-[110px_1fr_72px_84px_112px] gap-3 border-b border-[var(--role-line)] px-4 py-2">
          <span className="t-label">Round</span>
          <span className="t-label">Block hash</span>
          <span className="t-label text-right">Txs</span>
          <span className="t-label text-right">Actions</span>
          <span className="t-label text-right">Age</span>
        </div>

        {loading && blocks.length === 0 ? (
          <div className="px-4 py-14 text-center text-[var(--role-content-subtle)]">
            <div className="mx-auto mb-3 h-5 w-5 animate-spin rounded-full border-2 border-[var(--role-line)] border-t-[var(--role-chrome)]" />
            <p className="text-sm">Loading blocks…</p>
          </div>
        ) : blocks.length === 0 ? (
          <div className="px-4 py-14 text-center text-sm text-[var(--role-content-subtle)]">
            No blocks yet. The explorer connects on backend boot and fills as new blocks stream in.
          </div>
        ) : (
          // AnimatePresence with `initial={false}` suppresses the first-load
          // wall of fades; freshly-added rows then fade in (opacity only — no
          // layout/slide, since rows turn over almost entirely each poll). The
          // arrival colour flash rides an overlay so the resting fill stays
          // exactly the panel background. Rows that fall off the bottom just
          // unmount (no exit animation).
          <AnimatePresence initial={false}>
            {blocks.map((b) => {
              const isFlashing = flashingRounds.has(b.round);
              return (
                <motion.div
                  key={b.blockhash || b.round}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                  // Opaque resting fill == the panel's own background, held as a
                  // live var so it re-tints with the palette and never bakes a
                  // hex — rows stay invisible against the panel in every theme.
                  // (No layout/slide: with near-total row turnover each poll the
                  // push-down reorder isn't worth the churn.)
                  style={{ backgroundColor: 'var(--bg-muted)' }}
                  className="relative border-b border-[var(--role-line-subtle)] last:border-b-0"
                >
                  {/* Arrival flash — a positive-tinted overlay that fades out,
                      leaving the resting fill exactly var(--bg-muted). */}
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
