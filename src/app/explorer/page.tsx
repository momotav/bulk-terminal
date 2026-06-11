'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Hash, Activity, Zap, ChevronRight, Loader2 } from 'lucide-react';
import { explorer, type ExplorerBlock } from '@/lib/api';

// How many blocks to show in the list. Backend buffer caps at 1000,
// frontend caps the visible list at 50 — shorter feels snappier and
// older blocks aren't valuable without a search bar.
const BLOCK_LIMIT = 50;

// Poll cadence for the block list. Fast enough that users see blocks
// stream in live, slow enough that we're not hammering our own backend
// from a passive viewing page.
const POLL_INTERVAL_MS = 2_000;

// How long the "just arrived" green flash lingers on a row before it
// settles into normal styling. Long enough for the eye to catch it,
// short enough that with 150 blocks/sec the page isn't constantly
// strobing.
const FLASH_DURATION_MS = 1500;

function shortHash(hash: string): string {
  if (!hash || hash.length <= 12) return hash;
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

// Render time since block. We compare BULK's nanosecond timestamp to
// our local clock — there can be skew but for a "X seconds ago" label
// that's fine. Sub-second precision matters here because blocks are
// 7ms apart; "just now" is the most honest label for recent blocks.
function relativeTime(timestampNs: number): string {
  if (!timestampNs) return '—';
  const ageMs = Date.now() - timestampNs / 1_000_000;
  if (ageMs < 1000) return 'just now';
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1000)}s ago`;
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m ago`;
  return `${Math.floor(ageMs / 3_600_000)}h ago`;
}

export default function ExplorerPage() {
  const [blocks, setBlocks] = useState<ExplorerBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track which rounds we've ALREADY seen, so on each poll we know
  // which blocks are NEW (and get the flash animation) vs which were
  // already visible (and stay calm). Using a ref instead of state
  // because mutations don't need to trigger re-renders.
  const seenRoundsRef = useRef<Set<number>>(new Set());
  const [flashingRounds, setFlashingRounds] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;

    const fetchBlocks = async () => {
      try {
        const res = await explorer.getRecentBlocks(BLOCK_LIMIT);
        if (cancelled) return;

        // Identify rounds we haven't seen before — those are the
        // "new arrivals" that should flash. On first load EVERY block
        // is technically new but we don't want a wall of flashes, so
        // the initial state pre-populates `seenRounds` from the first
        // batch and only flashes subsequent arrivals.
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
          // Clear the flash for these specific rounds after the
          // animation duration. We use a per-batch timeout so flashes
          // overlap naturally rather than all resetting together.
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

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title text-[var(--text-primary)]">
            Block Explorer
          </h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            Live block stream from BULK's network. Last {BLOCK_LIMIT} blocks shown.
          </p>
        </div>
        {!loading && blocks.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
            <Loader2 className="w-3 h-3 animate-spin text-bulk-green" />
            <span>Live</span>
          </div>
        )}
      </div>

      {error && blocks.length === 0 && (
        <div className="border border-red-500/30 bg-red-500/10 text-red-400 rounded-lg p-4 text-sm">
          {error}
        </div>
      )}

      <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[110px_1fr_80px_80px_120px] gap-3 px-4 py-2.5 border-b border-[var(--border-color)] text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
          <div>Round</div>
          <div>Block Hash</div>
          <div className="text-right">Txs</div>
          <div className="text-right">Actions</div>
          <div className="text-right">Age</div>
        </div>

        {loading && blocks.length === 0 ? (
          <div className="px-4 py-12 text-center text-[var(--text-tertiary)]">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 opacity-50" />
            <p className="text-sm">Loading blocks…</p>
          </div>
        ) : blocks.length === 0 ? (
          <div className="px-4 py-12 text-center text-[var(--text-tertiary)] text-sm">
            No blocks yet. The explorer connects on backend boot and
            fills as new blocks stream in.
          </div>
        ) : (
          // AnimatePresence wraps the list so freshly-added rows get an
          // enter animation (slide down from top + opacity fade). Rows
          // that fall off the bottom (older than the 50-row cap) just
          // unmount — no exit animation to keep the visual clean.
          //
          // `layout` on the row enables Framer's auto-translate when
          // rows are pushed down by a new arrival, so the existing list
          // slides smoothly instead of jumping.
          <AnimatePresence initial={false}>
            {blocks.map((b) => {
              const isFlashing = flashingRounds.has(b.round);
              return (
                <motion.div
                  key={b.blockhash || b.round}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    backgroundColor: isFlashing
                      ? 'rgba(34, 197, 94, 0.12)'
                      : 'rgba(0,0,0,0)',
                  }}
                  transition={{
                    opacity: { duration: 0.2 },
                    y: { type: 'spring', stiffness: 380, damping: 30 },
                    backgroundColor: { duration: 1.2 },
                    layout: { type: 'spring', stiffness: 380, damping: 30 },
                  }}
                  className="border-b border-[var(--border-color)] last:border-b-0"
                >
                  <Link
                    href={`/explorer/block/${b.blockhash}`}
                    prefetch={false}
                    className="grid grid-cols-[110px_1fr_80px_80px_120px] gap-3 px-4 py-2.5 items-center hover:bg-[var(--bg-secondary-20)] transition-colors group"
                  >
                    <div className="font-mono text-sm text-blue-400 tabular-nums">
                      {b.round.toLocaleString()}
                    </div>
                    <div className="font-mono text-sm text-[var(--text-secondary)] truncate flex items-center gap-1.5 group-hover:text-[var(--text-primary)] transition-colors">
                      <Hash className="w-3.5 h-3.5 text-[var(--text-tertiary)] shrink-0" />
                      <span className="truncate">{shortHash(b.blockhash)}</span>
                    </div>
                    <div className="text-right font-mono text-sm tabular-nums">
                      <span className={b.txCount > 0 ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'}>
                        {b.txCount}
                      </span>
                    </div>
                    <div className="text-right font-mono text-sm tabular-nums">
                      <span className={b.actionCount > 0 ? 'text-bulk-green' : 'text-[var(--text-tertiary)]'}>
                        {b.actionCount}
                      </span>
                    </div>
                    <div className="text-right text-xs text-[var(--text-tertiary)] flex items-center justify-end gap-1">
                      {relativeTime(b.timestampNs)}
                      <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      {/* Legend / glossary at the bottom — explorer terminology
          isn't intuitive to most users, so a small key helps. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-[var(--text-tertiary)]">
        <div className="flex items-start gap-2">
          <Hash className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            <span className="text-[var(--text-secondary)] font-medium">Round</span>{' '}
            — block height. BULK produces a block every ~7ms.
          </span>
        </div>
        <div className="flex items-start gap-2">
          <Activity className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            <span className="text-[var(--text-secondary)] font-medium">Txs</span>{' '}
            — transactions in this block.
          </span>
        </div>
        <div className="flex items-start gap-2">
          <Zap className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            <span className="text-[var(--text-secondary)] font-medium">Actions</span>{' '}
            — sub-tx units (e.g. price updates, matches, range computations).
          </span>
        </div>
      </div>
    </main>
  );
}
