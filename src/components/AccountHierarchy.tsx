'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Layers, CornerLeftUp, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/api';
import { money, pnlColor, signed } from '@/lib/walletFormat';
import { accountValue, familyTotals, useAccountFamily } from '@/lib/accountFamily';

// Account family badge for the wallet rail. Shows where this wallet sits (master
// or which sub-account), opens a compact list of every account in the family, and
// hands off to the Accounts tab for the full combined portfolio.

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const pill = 'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] border border-[var(--border-color)] text-[var(--role-content-muted)] hover:text-[var(--role-content)] hover:bg-[var(--role-surface-raised)] transition-colors';

export function AccountHierarchy({ address, onOpenPortfolio }: { address: string; onOpenPortfolio?: () => void }) {
  const router = useRouter();
  const { loading, family } = useAccountFamily(address);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);

  if (loading) return <div className="h-9 w-full rounded-lg bg-[var(--role-surface-raised)] animate-pulse" />;
  if (!family) return null;

  const me = family.accounts.find((a) => a.pubkey === address);
  const isSub = !!me && !me.isMaster;
  const subs = family.accounts.length - 1;
  const totals = familyTotals(family.accounts);

  return (
    <div className="relative w-full" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog"
        className={cn(pill, 'w-full h-9 px-3 text-[13px]', open && 'text-[var(--role-content)] bg-[var(--role-surface-raised)]')}>
        <Layers className="w-3.5 h-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left" title={isSub ? me!.name : undefined}>
          {isSub ? <>Sub-account · <span className="text-[var(--role-content)]">{me!.name}</span></> : <>Master · {subs} sub-account{subs === 1 ? '' : 's'}</>}
        </span>
        <ChevronDown className={cn('w-3.5 h-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div role="dialog" aria-label="Account family"
          className="absolute left-0 z-50 mt-2 w-full min-w-[min(320px,calc(100vw-32px))] overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--role-surface)] shadow-[0_18px_48px_-12px_rgb(0_0_0/0.45)] animate-[ws-pop_.14s_ease-out]">
          <div className="px-4 pt-3.5 pb-3 border-b border-[var(--border-color)]">
            <div className="text-[12px] text-[var(--role-content-muted)]">Family value</div>
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <span className="text-[22px] leading-none font-medium tabular-nums tracking-tight text-[var(--role-content)]">{money(totals.value)}</span>
              <span className="text-[13px] tabular-nums" style={{ color: pnlColor(totals.pnl) }}>{signed(totals.pnl)} PnL</span>
            </div>
          </div>

          <div className="max-h-[320px] overflow-y-auto py-1">
            {family.accounts.map((a) => {
              const here = a.pubkey === address;
              const pnl = a.summary ? a.summary.realizedPnl + a.summary.unrealizedPnl : null;
              return (
                <button key={a.pubkey} type="button"
                  onClick={() => { setOpen(false); if (!here) router.push(`/wallet/${a.pubkey}`); }}
                  className={cn('w-full flex items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-[var(--role-surface-raised)]', here && 'bg-[var(--role-surface-raised)]')}>
                  <span className={cn('w-4 shrink-0 flex justify-center', !a.isMaster && 'pl-1')}>
                    {a.isMaster ? <Layers className="w-3.5 h-3.5 text-[var(--accent)]" /> : <span className="block w-2 h-2 rounded-[2px] border border-[var(--role-content-subtle)]" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[14px] text-[var(--role-content)] truncate">{a.name}</span>
                      {here && <span className="text-[11px] text-[var(--role-content-subtle)]">Viewing</span>}
                    </span>
                    <span className="block text-[11px] font-mono text-[var(--role-content-subtle)]">{short(a.pubkey)}</span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-[13px] tabular-nums text-[var(--role-content)]">{a.summary ? money(accountValue(a.summary)) : '—'}</span>
                    {pnl !== null && <span className="block text-[11px] tabular-nums" style={{ color: pnlColor(pnl) }}>{signed(pnl)}</span>}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 border-t border-[var(--border-color)] p-2">
            {isSub && (
              <button type="button" onClick={() => { setOpen(false); router.push(`/wallet/${family.master}`); }}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] text-[var(--role-content-muted)] hover:text-[var(--role-content)] hover:bg-[var(--role-surface-raised)] transition-colors">
                <CornerLeftUp className="w-3.5 h-3.5" />Master
              </button>
            )}
            {onOpenPortfolio && (
              <button type="button" onClick={() => { setOpen(false); onOpenPortfolio(); }}
                className="ml-auto inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-medium bg-[var(--accent)] text-[var(--accent-text)] hover:brightness-110 transition">
                Family portfolio <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
