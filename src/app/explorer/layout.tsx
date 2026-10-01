'use client';

// The Explorer section renders BULK CHAIN data (blocks, transactions, rounds,
// throughput) streamed from the explorer WS (see bulkExplorer.ts on the
// backend, gated by EXPLORER_ENABLED).
//
// This was a "coming soon" placeholder during mainnet's first weeks, while
// BULK wasn't running a mainnet explorer WS. As of 2026-10-01 the feed is live
// again (status:live, ~50 tps) so the real pages render for every network. If
// the feed ever goes dark, the page itself shows an empty/"no blocks yet"
// state rather than a section-wide gate.

export default function ExplorerLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
