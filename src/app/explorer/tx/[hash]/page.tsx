'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft, Hash, Clock, Zap, Loader2, AlertCircle,
  Copy, Check, Shield, User,
} from 'lucide-react';
import { explorer, type ExplorerTxDetail, formatAddress } from '@/lib/api';
import { getActionLabel, getActionDescription, isKnownAction } from '@/lib/explorerActions';
import { isBulkPrefixedAccount } from '@/lib/systemWallets';

function shortHash(hash: string): string {
  if (!hash || hash.length <= 12) return hash;
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

function formatTimestamp(timestampNs: number): { date: string; relative: string } {
  if (!timestampNs) return { date: '—', relative: '—' };
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
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZoneName: 'short',
    }),
    relative,
  };
}

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
      {copied ? <Check className="w-3.5 h-3.5 text-bulk-green" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export default function TxDetailPage() {
  const params = useParams();
  const hash = params?.hash as string;

  const [tx, setTx] = useState<ExplorerTxDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchTx = async () => {
      try {
        setLoading(true);
        const data = await explorer.getTransaction(hash);
        if (!cancelled) {
          setTx(data);
          setError(null);
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Transaction not found');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchTx();
    return () => { cancelled = true; };
  }, [hash]);

  if (loading) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 text-center">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-[var(--text-tertiary)] mb-3" />
        <p className="text-sm text-[var(--text-tertiary)]">Loading transaction…</p>
      </main>
    );
  }

  if (error || !tx) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Link
          href="/explorer"
          className="inline-flex items-center gap-1 text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Explorer
        </Link>
        <div className="border border-red-500/30 bg-red-500/10 text-red-400 rounded-lg p-6 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Transaction not found</p>
            <p className="text-sm mt-1 opacity-75">{error || `No tx with hash ${shortHash(hash)}`}</p>
          </div>
        </div>
      </main>
    );
  }

  const ts = formatTimestamp(tx.timestampNs);
  const isBulkAccount = isBulkPrefixedAccount(tx.account);

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <Link
          href="/explorer"
          className="inline-flex items-center gap-1 text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Explorer
        </Link>

        <div>
          <p className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
            Transaction
          </p>
          <h1 className="text-2xl font-mono text-[var(--text-primary)] flex items-center gap-2">
            <span className="break-all">{tx.hash}</span>
            <CopyButton text={tx.hash} />
          </h1>
        </div>

        {/* Tx metadata grid */}
        <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2 items-center">
            <span className="text-xs uppercase tracking-wider text-[var(--text-tertiary)]">Block</span>
            <Link
              href={`/explorer/block/${tx.blockhash}`}
              className="text-sm text-blue-400 hover:underline flex items-center gap-1.5"
            >
              <span className="tabular-nums">#{tx.round.toLocaleString()}</span>
              <span className="text-[var(--text-tertiary)]">·</span>
              <Hash className="w-3.5 h-3.5" />
              <span className="font-mono">{shortHash(tx.blockhash)}</span>
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2 items-center">
            <span className="text-xs uppercase tracking-wider text-[var(--text-tertiary)]">Index</span>
            <span className="text-sm text-[var(--text-primary)] tabular-nums">
              {tx.indexInBlock}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2 items-center">
            <span className="text-xs uppercase tracking-wider text-[var(--text-tertiary)]">Timestamp</span>
            <div className="flex items-center gap-2 text-sm">
              <Clock className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
              <span className="text-[var(--text-primary)]">{ts.date}</span>
              <span className="text-[var(--text-tertiary)]">({ts.relative})</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2 items-start">
            <span className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] pt-1">Account</span>
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <Link
                href={`/whales/${tx.account}`}
                className="font-mono text-blue-400 hover:underline break-all"
              >
                {tx.account}
              </Link>
              <CopyButton text={tx.account} />
              {isBulkAccount && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20"
                  title="BULK protocol-owned account"
                >
                  <Shield className="w-3 h-3" /> BULK System
                </span>
              )}
            </div>
          </div>

          {tx.signer !== tx.account && (
            <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2 items-start">
              <span className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] pt-1">Signer</span>
              <div className="flex items-center gap-2 text-sm flex-wrap">
                <User className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                <span className="font-mono text-[var(--text-secondary)] break-all">
                  {tx.signer}
                </span>
                <CopyButton text={tx.signer} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2 items-center">
            <span className="text-xs uppercase tracking-wider text-[var(--text-tertiary)]">Nonce</span>
            <span className="font-mono text-sm text-[var(--text-secondary)] tabular-nums">
              {tx.nonce}
            </span>
          </div>
        </div>

        {/* Actions list */}
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <Zap className="w-5 h-5 text-bulk-green" />
            Actions ({tx.actions.length})
          </h2>

          {tx.actions.length === 0 ? (
            <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-8 text-center text-sm text-[var(--text-tertiary)]">
              No actions in this transaction.
            </div>
          ) : (
            <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg overflow-hidden">
              {tx.actions.map((code, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[40px_1fr] gap-3 px-4 py-3 items-center border-b border-[var(--border-color)] last:border-b-0"
                >
                  <span className="text-xs text-[var(--text-tertiary)] font-mono tabular-nums">
                    #{i}
                  </span>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span
                      className={
                        isKnownAction(code)
                          ? 'inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-bulk-green/10 text-bulk-green border border-bulk-green/20'
                          : 'inline-flex items-center px-2 py-1 rounded text-xs font-mono bg-[var(--bg-secondary-20)] text-[var(--text-tertiary)] border border-[var(--border-color)]'
                      }
                    >
                      {isKnownAction(code) ? getActionLabel(code) : code}
                    </span>
                    {getActionDescription(code) && (
                      <span className="text-xs text-[var(--text-tertiary)]">
                        {getActionDescription(code)}
                      </span>
                    )}
                    {!isKnownAction(code) && (
                      <span className="text-xs text-[var(--text-tertiary)] italic">
                        Unknown action code
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
  );
}
