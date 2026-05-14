'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
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

// Truncate a hex hash for table display. Block hashes are 64 chars,
// way too long to fit. Show first 6 + last 4 for visual continuity.
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

  useEffect(() => {
    let cancelled = false;

    const fetchBlocks = async () => {
      try {
        const res = await explorer.getRecentBlocks(BLOCK_LIMIT);
        if (cancelled) return;
        setBlocks(res.blocks);
        setLoading(false);
        setError(null);
      } catch (err: any) {
        if (cancelled) return;
        // Don't blow away existing blocks on a transient fetch fail —
        // they're more useful than an error state. Just record the
        // problem and keep polling.
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
            <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
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
            blocks.map((b) => (
              <Link
                key={b.blockhash || b.round}
                href={`/explorer/block/${b.blockhash}`}
                prefetch={false}
                className="grid grid-cols-[110px_1fr_80px_80px_120px] gap-3 px-4 py-2.5 items-center hover:bg-[var(--bg-secondary-20)] transition-colors group border-b border-[var(--border-color)] last:border-b-0"
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
            ))
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
