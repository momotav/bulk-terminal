'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Layers } from 'lucide-react';
import { cn, wallet, type WalletData } from '@/lib/api';
import { accountValue, familyTotals, type AccountFamily, type FamilyAccount } from '@/lib/accountFamily';
import { coinOf, formatPx, money, pnlColor, signed } from '@/lib/walletFormat';
import { CoinIcon } from '@/components/CoinIcon';
import { StatStrip } from '@/components/wallet/WalletPanels';

// Combined portfolio for a master wallet and its sub-accounts: one scope switcher
// ("All accounts" or any single account), the totals for that scope, how the
// family's value is split, and every open position with the account it sits in.

type Position = NonNullable<WalletData['live']>['positions'][number];
type Row = Position & { account: FamilyAccount };

const ACCOUNT_COLORS = ['var(--accent)', 'var(--coin-2)', 'var(--coin-4)', 'var(--coin-6)', 'var(--coin-3)', 'var(--coin-5)', 'var(--coin-7)', 'var(--coin-8)'];
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export function FamilyPortfolio({ family, current }: { family: AccountFamily; current: string }) {
  const [scope, setScope] = useState<'all' | string>('all');
  const [positions, setPositions] = useState<Record<string, Position[] | null>>({});

  const colorOf = useMemo(() => {
    const m: Record<string, string> = {};
    family.accounts.forEach((a, i) => { m[a.pubkey] = ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]; });
    return m;
  }, [family]);

  // Positions only for accounts that have any, two at a time so a big family
  // doesn't fire a burst of account lookups at once.
  useEffect(() => {
    let cancelled = false;
    const todo = family.accounts.filter((a) => (a.summary?.positionsCount ?? 0) > 0).map((a) => a.pubkey);
    const empty: Record<string, Position[] | null> = {};
    family.accounts.forEach((a) => { if (!todo.includes(a.pubkey)) empty[a.pubkey] = []; });
    setPositions(empty);
    const run = async () => {
      while (todo.length && !cancelled) {
        const pk = todo.shift()!;
        let got: Position[] | null = null;
        for (let attempt = 0; attempt < 3 && !cancelled && got === null; attempt++) {
          try { got = ((await wallet.getWallet(pk)).live?.positions ?? []) as Position[]; }
          catch { await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); }
        }
        if (!cancelled) setPositions((p) => ({ ...p, [pk]: got ?? [] }));
      }
    };
    run(); run();
    return () => { cancelled = true; };
  }, [family]);

  const inScope = scope === 'all' ? family.accounts : family.accounts.filter((a) => a.pubkey === scope);
  const totals = familyTotals(inScope);
  const allTotals = familyTotals(family.accounts);
  const one = scope === 'all' ? null : inScope[0];

  const rows: Row[] = inScope
    .flatMap((a) => (positions[a.pubkey] ?? []).map((p) => ({ ...p, account: a })))
    .sort((x, y) => Math.abs(y.notional) - Math.abs(x.notional));
  const loadingPositions = inScope.some((a) => positions[a.pubkey] === undefined);

  // Value split: only accounts holding something are drawn; dust is folded away.
  const split = family.accounts
    .map((a) => ({ a, v: Math.max(0, accountValue(a.summary)) }))
    .filter((x) => x.v >= 0.01);
  const splitTotal = split.reduce((s, x) => s + x.v, 0);

  return (
    <div className="flex flex-col">
      {/* Scope switcher */}
      <div className="flex items-center gap-1.5 overflow-x-auto px-5 py-3 border-b border-[var(--border-color)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {[{ key: 'all', label: `All accounts · ${family.accounts.length}`, color: null as string | null }, ...family.accounts.map((a) => ({ key: a.pubkey, label: a.name, color: colorOf[a.pubkey] }))].map((s) => (
          <button key={s.key} type="button" onClick={() => setScope(s.key)} aria-pressed={scope === s.key}
            className={cn('shrink-0 inline-flex items-center gap-2 h-8 px-3 rounded-lg text-[13px] border transition-colors',
              scope === s.key ? 'border-[var(--role-content)] text-[var(--role-content)] bg-[var(--role-surface-raised)]' : 'border-[var(--border-color)] text-[var(--role-content-muted)] hover:text-[var(--role-content)]')}>
            {s.color ? <span className="w-2 h-2 rounded-[2px]" style={{ background: s.color }} /> : <Layers className="w-3.5 h-3.5" />}
            <span className="max-w-[160px] truncate">{s.label}</span>
            {s.key === current && <span className="text-[11px] text-[var(--role-content-subtle)]">you&apos;re here</span>}
          </button>
        ))}
      </div>

      <StatStrip items={[
        { label: 'Account value', hint: one ? one.name : 'All accounts', value: money(totals.value) },
        { label: 'Total PnL', value: signed(totals.pnl), color: pnlColor(totals.pnl) },
        { label: 'Open PnL', hint: `${totals.positions} position${totals.positions === 1 ? '' : 's'}`, value: signed(totals.unrealized), color: pnlColor(totals.unrealized) },
        { label: 'Exposure', hint: totals.value > 0 && totals.notional > 0 ? `${(totals.notional / totals.value).toFixed(1)}x` : undefined, value: money(totals.notional) },
      ]} />

      {family.partial && (
        <div className="px-5 py-2 text-[12px] text-[var(--role-content-subtle)] border-b border-[var(--border-color)]">Some accounts didn&apos;t load, so these totals are low. They refresh on the next visit.</div>
      )}

      {/* Accounts: split bar + table (all) or one account's card */}
      {scope === 'all' ? (
        <section className="px-5 py-4 border-b border-[var(--border-color)]">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[15px] text-[var(--role-content)]">Accounts</h3>
            <span className="text-[12px] text-[var(--role-content-subtle)]">Share of family value</span>
          </div>
          {splitTotal > 0 && (
            <div className="mt-3 flex h-2.5 w-full gap-[2px] overflow-hidden rounded-[4px]" role="img" aria-label="Share of family value by account">
              {split.map(({ a, v }) => (
                <div key={a.pubkey} title={`${a.name}: ${money(v)} (${((v / splitTotal) * 100).toFixed(1)}%)`}
                  className="h-full first:rounded-l-[4px] last:rounded-r-[4px]" style={{ width: `${(v / splitTotal) * 100}%`, minWidth: 3, background: colorOf[a.pubkey] }} />
              ))}
            </div>
          )}

          <div className="mt-4 -mx-5 overflow-x-auto">
            <table className="w-full min-w-[640px] whitespace-nowrap text-[13px] tabular-nums">
              <thead>
                <tr className="text-left text-[12px] text-[var(--role-content-subtle)]">
                  <th className="font-normal pl-5 pr-3 py-2">Account</th>
                  <th className="font-normal px-3 py-2 text-right">Value</th>
                  <th className="font-normal px-3 py-2 text-right">Share</th>
                  <th className="font-normal px-3 py-2 text-right">Total PnL</th>
                  <th className="font-normal px-3 py-2 text-right">Open PnL</th>
                  <th className="font-normal px-3 py-2 text-right">Exposure</th>
                  <th className="font-normal pl-3 pr-5 py-2 text-right">Positions</th>
                </tr>
              </thead>
              <tbody>
                {family.accounts.map((a) => {
                  const s = a.summary;
                  const v = accountValue(s);
                  const pnl = s ? s.realizedPnl + s.unrealizedPnl : null;
                  return (
                    <tr key={a.pubkey} onClick={() => setScope(a.pubkey)} className="cursor-pointer border-t border-[var(--border-color)] hover:bg-[var(--role-surface-raised)] transition-colors">
                      <td className="pl-5 pr-3 py-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-2.5 h-2.5 shrink-0 rounded-[3px]" style={{ background: colorOf[a.pubkey] }} />
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 text-[var(--role-content)]">
                              <span className="truncate max-w-[160px]">{a.name}</span>
                              {a.pubkey === current && <span className="text-[11px] text-[var(--role-content-subtle)]">you&apos;re here</span>}
                            </span>
                            <span className="block text-[11px] font-mono text-[var(--role-content-subtle)]">{short(a.pubkey)}</span>
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right text-[var(--role-content)]">{s ? money(v) : '—'}</td>
                      <td className="px-3 py-2.5 text-right text-[var(--role-content-muted)]">{s && allTotals.value > 0 ? `${Math.max(0, (v / allTotals.value) * 100).toFixed(1)}%` : '—'}</td>
                      <td className="px-3 py-2.5 text-right" style={{ color: pnl === null ? undefined : pnlColor(pnl) }}>{pnl === null ? '—' : signed(pnl)}</td>
                      <td className="px-3 py-2.5 text-right" style={{ color: s ? pnlColor(s.unrealizedPnl) : undefined }}>{s ? signed(s.unrealizedPnl) : '—'}</td>
                      <td className="px-3 py-2.5 text-right text-[var(--role-content)]">{s ? money(Math.abs(s.notional)) : '—'}</td>
                      <td className="pl-3 pr-5 py-2.5 text-right text-[var(--role-content)]">{s ? s.positionsCount : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : one && (
        <section className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-3 h-3 shrink-0 rounded-[3px]" style={{ background: colorOf[one.pubkey] }} />
            <div className="min-w-0">
              <div className="text-[15px] text-[var(--role-content)] truncate">{one.isMaster ? 'Master account' : one.name}</div>
              <div className="text-[12px] font-mono text-[var(--role-content-subtle)]">{one.pubkey}</div>
            </div>
          </div>
          <div className="flex items-center gap-4 text-[13px] tabular-nums">
            <span className="text-[var(--role-content-muted)]">Cash <span className="text-[var(--role-content)]">{money(one.summary?.totalBalance ?? 0)}</span></span>
            <span className="text-[var(--role-content-muted)]">Free <span className="text-[var(--role-content)]">{money(one.summary?.availableBalance ?? 0)}</span></span>
            {one.pubkey !== current && (
              <Link href={`/wallet/${one.pubkey}`} className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-[var(--border-color)] text-[var(--role-content)] hover:bg-[var(--role-surface-raised)] transition-colors">
                Open account <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>
        </section>
      )}

      {/* Open positions across the scope */}
      <section className="px-5 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[15px] text-[var(--role-content)]">Open positions</h3>
          {scope === 'all' && rows.length > 0 && <span className="text-[12px] text-[var(--role-content-subtle)]">Across {new Set(rows.map((r) => r.account.pubkey)).size} account{new Set(rows.map((r) => r.account.pubkey)).size === 1 ? '' : 's'}</span>}
        </div>
        {rows.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-[var(--role-content-muted)]">
            {loadingPositions ? 'Loading positions…' : one ? `${one.name} has no open positions.` : 'No open positions in any account.'}
          </div>
        ) : (
          <div className="mt-3 -mx-5 overflow-x-auto">
            <table className="w-full min-w-[680px] whitespace-nowrap text-[13px] tabular-nums">
              <thead>
                <tr className="text-left text-[12px] text-[var(--role-content-subtle)]">
                  <th className="font-normal pl-5 pr-3 py-2">Market</th>
                  {scope === 'all' && <th className="font-normal px-3 py-2">Account</th>}
                  <th className="font-normal px-3 py-2 text-right">Size</th>
                  <th className="font-normal px-3 py-2 text-right">Entry</th>
                  <th className="font-normal px-3 py-2 text-right">Mark</th>
                  <th className="font-normal px-3 py-2 text-right">Liq. price</th>
                  <th className="font-normal pl-3 pr-5 py-2 text-right">Open PnL</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const long = r.size > 0;
                  return (
                    <tr key={`${r.account.pubkey}:${r.symbol}`} className="border-t border-[var(--border-color)]">
                      <td className="pl-5 pr-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <CoinIcon symbol={r.symbol} size={18} />
                          <span className="text-[var(--role-content)]">{coinOf(r.symbol)}</span>
                          <span className="text-[12px]" style={{ color: long ? 'var(--pos)' : 'var(--neg)' }}>{long ? 'Long' : 'Short'}{r.leverage ? ` ${Math.round(r.leverage)}x` : ''}</span>
                        </div>
                      </td>
                      {scope === 'all' && (
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center gap-1.5 text-[var(--role-content-muted)]">
                            <span className="w-2 h-2 rounded-[2px]" style={{ background: colorOf[r.account.pubkey] }} />
                            <span className="truncate max-w-[120px]">{r.account.name}</span>
                          </span>
                        </td>
                      )}
                      <td className="px-3 py-2.5 text-right text-[var(--role-content)]">{money(Math.abs(r.notional))}</td>
                      <td className="px-3 py-2.5 text-right text-[var(--role-content-muted)]">{formatPx(r.price)}</td>
                      <td className="px-3 py-2.5 text-right text-[var(--role-content-muted)]">{r.fairPrice ? formatPx(r.fairPrice) : '—'}</td>
                      <td className="px-3 py-2.5 text-right text-[var(--role-content-muted)]">{r.liquidationPrice > 0 ? formatPx(r.liquidationPrice) : '—'}</td>
                      <td className="pl-3 pr-5 py-2.5 text-right" style={{ color: pnlColor(r.unrealizedPnl) }}>{signed(r.unrealizedPnl)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
