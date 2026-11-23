'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Search, X, Loader2, ArrowUpRight } from 'lucide-react';
import { leaderboard, formatCompact, formatAddress, type WalletRankData } from '@/lib/api';
import { BulkAvatar } from '@/components/BulkAvatar';

const top = (rank: number, total: number) => {
  const p = (rank / Math.max(1, total)) * 100;
  return p < 0.1 ? 'top 0.1%' : `top ${p < 10 ? p.toFixed(1) : Math.round(p)}%`;
};

/** Find any wallet's rank on each board. Compact field; results open below it. */
export function WalletRankSearch() {
  const [wallet, setWallet] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WalletRankData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const open = !!(result || error);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setResult(null); setError(null); } };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open]);

  const search = async () => {
    const w = wallet.trim();
    if (w.length < 32) { setError('Paste a full wallet address'); setResult(null); return; }
    setLoading(true); setError(null); setResult(null);
    try {
      const d = await leaderboard.getWalletRank(w);
      if (d.found) setResult(d); else setError('This wallet hasn’t traded on BULK yet');
    } catch { setError('Couldn’t look that up. Try again in a moment.'); }
    finally { setLoading(false); }
  };

  const r = result?.rankings;
  return (
    <div ref={ref} className="relative w-full md:w-[380px]">
      <form onSubmit={(e) => { e.preventDefault(); void search(); }}
        className="flex h-10 items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-muted)] px-3 focus-within:border-[var(--text-tertiary)]">
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-[var(--text-tertiary)]" /> : <Search className="h-4 w-4 text-[var(--text-tertiary)]" />}
        <input value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="Find a wallet’s rank"
          className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-[var(--text-primary)] outline-none placeholder:font-sans placeholder:text-[var(--text-tertiary)]" />
        {wallet && (
          <button type="button" aria-label="Clear" onClick={() => { setWallet(''); setResult(null); setError(null); }} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            <X className="h-4 w-4" />
          </button>
        )}
      </form>

      {open && (
        <div className="glass-pop absolute right-0 top-full z-30 mt-2 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--bg-muted)] p-3 shadow-2xl md:w-[440px]">
          {error && <p className="px-1 py-2 text-[13px] text-[var(--text-secondary)]">{error}</p>}
          {result && r && (
            <>
              <Link href={`/wallet/${result.wallet_address}`} className="mb-3 flex items-center justify-between rounded-xl px-1 py-1 hover:bg-[var(--bg-base)]">
                <span className="flex items-center gap-2.5">
                  <BulkAvatar seed={result.wallet_address} size={28} />
                  <span className="font-mono text-[13px] text-[var(--text-primary)]">{formatAddress(result.wallet_address)}</span>
                </span>
                <span className="inline-flex items-center gap-0.5 text-[12px] text-[var(--text-tertiary)]">Open wallet<ArrowUpRight className="h-3.5 w-3.5" /></span>
              </Link>
              <div className="grid grid-cols-2 gap-2">
                <Tile k="Volume" rank={r.volume} v={r.volume ? `$${formatCompact(r.volume.value)}` : null} />
                <Tile k="PnL" rank={r.pnl} v={r.pnl ? `${r.pnl.value >= 0 ? '+' : '−'}$${formatCompact(Math.abs(r.pnl.value))}` : null}
                  color={r.pnl ? (r.pnl.value >= 0 ? 'var(--pos)' : 'var(--neg)') : undefined} />
                <Tile k="Trades" rank={r.trades} v={r.trades ? `${r.trades.value.toLocaleString()} trades` : null} />
                <Tile k="Liquidations" rank={r.liquidations} v={r.liquidations ? `$${formatCompact(r.liquidations.value)} liquidated` : 'Never liquidated'}
                  color={r.liquidations ? 'var(--neg)' : undefined} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Tile({ k, rank, v, color }: { k: string; rank: { rank: number; total: number } | null; v: string | null; color?: string }) {
  return (
    <div className="rounded-xl bg-[var(--bg-base)] px-3 py-2.5">
      <div className="text-[11px] text-[var(--text-tertiary)]">{k}</div>
      <div className="mt-0.5 text-[18px] font-medium tabular-nums text-[var(--text-primary)]">{rank ? `#${rank.rank.toLocaleString()}` : '—'}</div>
      <div className="text-[11px] tabular-nums text-[var(--text-tertiary)]">{rank ? `${top(rank.rank, rank.total)} of ${rank.total.toLocaleString()}` : ''}</div>
      {v && <div className="mt-1 truncate text-[12px] tabular-nums" style={{ color: color ?? 'var(--text-secondary)' }}>{v}</div>}
    </div>
  );
}
