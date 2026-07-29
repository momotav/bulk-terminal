'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft, Hash, Clock, Activity, Zap, Loader2, AlertCircle,
  Copy, Check, Shield,
} from 'lucide-react';
import { explorer, type ExplorerBlockDetail, formatAddress } from '@/lib/api';
import { getActionLabel, isKnownAction } from '@/lib/explorerActions';
import { isBulkPrefixedAccount } from '@/lib/systemWallets';

function shortHash(hash: string): string {
  if (!hash || hash.length <= 12) return hash;
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

// Convert BULK's nanosecond timestamp to a human-readable date+time.
// Nanosecond precision is overkill for a UI label, but we keep ms
// for "X seconds ago" style if needed.
function formatTimestamp(timestampNs: number): { date: string; relative: string } {
  if (!timestampNs) return { date: '-', relative: '-' };
  const ms = timestampNs / 1_000_000;
  const date = new Date(ms);
  const ageMs = Date.now() - ms;

  let relative: string;
  if (ageMs < 1000) relative = 'just now';
  else if (ageMs < 60_000) relative = `${Math.floor(ageMs / 1000)}s ago`;
  else if (ageMs < 3_600_000) relative = `${Math.floor(ageMs / 60_000)}m ago`;
  else relative = `${Math.floor(ageMs / 3_600_000)}h ago`;

  return {
    date: date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    }),
    relative,
  };
}

// Small inline component for copy-to-clipboard with a 2s checkmark
// state. Used a few times on this page for hashes/addresses.
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={onClick}
      className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
      title={copied ? 'Copied!' : 'Copy'}
    >
      {copied ? <Check className="w-3.5 h-3.5 text-bulk-accent" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export default function BlockDetailPage() {
  const params = useParams();
  const hash = params?.hash as string;

  const [block, setBlock] = useState<ExplorerBlockDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchBlock = async () => {
      try {
        setLoading(true);
        const data = await explorer.getBlock(hash);
        if (!cancelled) {
          setBlock(data);
          setError(null);
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Block not found');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchBlock();
    return () => { cancelled = true; };
  }, [hash]);

  if (loading) {
    return (
      <main className="responsive-container py-12 text-center">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-[var(--text-tertiary)] mb-3" />
        <p className="text-sm text-[var(--text-tertiary)]">Loading block…</p>
      </main>
    );
  }

  if (error || !block) {
    return (
      <main className="responsive-container py-6">
        <Link
          href="/explorer"
          className="inline-flex items-center gap-1 text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Explorer
        </Link>
        <div className="border border-bulk-red/30 bg-bulk-red/10 text-bulk-red rounded-lg p-6 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Block not found</p>
            <p className="text-sm mt-1 opacity-75">{error || `No block with hash ${shortHash(hash)}`}</p>
          </div>
        </div>
      </main>
    );
  }

  const ts = formatTimestamp(block.timestampNs);

  return (
    <main className="responsive-container py-6 space-y-6">
        <Link
          href="/explorer"
          className="inline-flex items-center gap-1 text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Explorer
        </Link>

        <div>
          <p className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
            Block
          </p>
          <h1 className="text-2xl font-semibold text-bulk-accent tabular-nums">
            #{block.round.toLocaleString()}
          </h1>
        </div>

        {/* Block metadata grid */}
        <div className="glass-card p-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2 items-center">
            <span className="text-xs uppercase tracking-wider text-[var(--text-tertiary)]">Block Hash</span>
            <div className="flex items-center gap-2 font-mono text-sm text-[var(--text-primary)] break-all">
              <span>{block.blockhash}</span>
              <CopyButton text={block.blockhash} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2 items-center">
            <span className="text-xs uppercase tracking-wider text-[var(--text-tertiary)]">Timestamp</span>
            <div className="flex items-center gap-2 text-sm">
              <Clock className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
              <span className="text-[var(--text-primary)]">{ts.date}</span>
              <span className="text-[var(--text-tertiary)]">({ts.relative})</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2 items-center">
            <span className="text-xs uppercase tracking-wider text-[var(--text-tertiary)]">Transactions</span>
            <div className="flex items-center gap-2 text-sm">
              <Activity className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
              <span className="text-[var(--text-primary)] tabular-nums">{block.txCount}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2 items-center">
            <span className="text-xs uppercase tracking-wider text-[var(--text-tertiary)]">Actions</span>
            <div className="flex items-center gap-2 text-sm">
              <Zap className="w-3.5 h-3.5 text-bulk-accent" />
              <span className="text-bulk-accent tabular-nums">{block.actionCount}</span>
            </div>
          </div>

          {block.previousRoundHash && (
            <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2 items-center">
              <span className="text-xs uppercase tracking-wider text-[var(--text-tertiary)]">Previous</span>
              <Link
                href={`/explorer/block/${block.previousRoundHash}`}
                className="font-mono text-sm text-bulk-accent hover:underline truncate flex items-center gap-1"
              >
                <Hash className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{shortHash(block.previousRoundHash)}</span>
              </Link>
            </div>
          )}
        </div>

        {/* Transactions list */}
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-3">
            Transactions ({block.transactions.length})
          </h2>

          {block.transactions.length === 0 ? (
            <div className="glass-card p-8 text-center text-sm text-[var(--text-tertiary)]">
              This block has no transactions.
            </div>
          ) : (
            <div className="glass-card">
              <div className="grid grid-cols-[1fr_2fr_100px] gap-3 px-4 py-2.5 border-b border-[var(--border-color)] text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                <div>Tx Hash</div>
                <div>Account · Actions</div>
                <div className="text-right">Nonce</div>
              </div>
              {block.transactions.map((tx) => (
                <Link
                  key={tx.hash}
                  href={`/explorer/tx/${tx.hash}`}
                  prefetch={false}
                  className="grid grid-cols-[1fr_2fr_100px] gap-3 px-4 py-3 items-center hover:bg-[var(--role-surface-raised)] transition-colors group border-b border-[var(--border-color)] last:border-b-0"
                >
                  <div className="font-mono text-sm text-[var(--text-secondary)] truncate flex items-center gap-1.5 group-hover:text-[var(--text-primary)]">
                    <Hash className="w-3.5 h-3.5 text-[var(--text-tertiary)] shrink-0" />
                    {shortHash(tx.hash)}
                  </div>
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="font-mono text-[var(--text-tertiary)] truncate">
                        {formatAddress(tx.account)}
                      </span>
                      {isBulkPrefixedAccount(tx.account) && (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-bulk-blue/10 text-bulk-blue border border-bulk-blue/20 shrink-0"
                          title="BULK protocol-owned account"
                        >
                          <Shield className="w-2.5 h-2.5" /> BULK
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {tx.actions.slice(0, 6).map((code, i) => (
                        <span
                          key={i}
                          className={
                            isKnownAction(code)
                              ? 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-bulk-accent/10 text-bulk-accent border border-bulk-accent/20'
                              : 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--bg-secondary-20)] text-[var(--text-tertiary)] border border-[var(--border-color)]'
                          }
                          title={isKnownAction(code) ? getActionLabel(code) : `unknown action: ${code}`}
                        >
                          {isKnownAction(code) ? getActionLabel(code) : code}
                        </span>
                      ))}
                      {tx.actions.length > 6 && (
                        <span className="text-[10px] text-[var(--text-tertiary)] self-center">
                          +{tx.actions.length - 6} more
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right text-xs text-[var(--text-tertiary)] font-mono tabular-nums truncate">
                    {tx.nonce.toString().slice(-8)}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
  );
}
