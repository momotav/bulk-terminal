'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { Users, X } from 'lucide-react';
import { cn, formatAddress, formatNumber, leaderboard, wallet as walletApi } from '@/lib/api';
import { useStore } from '@/store';
import { CoinIcon } from '@/components/CoinIcon';
import { price } from '../parts';
import { CoinPick } from './CoinPick';

type Row = { key: string; t: number; coin: string; side: 'buy' | 'sell' | 'long' | 'short'; value: number; px: number; wallet: string; liq: boolean };
const MIN = [[0, 'All'], [1_000, '$1K'], [10_000, '$10K'], [50_000, '$50K'], [100_000, '$100K']] as const;
const BUFFER = 600;
const usd = (n: number) => `$${n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : formatNumber(n, 0)}`;
const ago = (t: number) => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? `${Math.floor(s)}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };
const isAddr = (a: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);

function parse(raw: unknown[], liq: boolean): Row[] {
  return (raw as Record<string, unknown>[]).map((r) => {
    const t = new Date(String(r.timestamp)).getTime();
    const coin = String(r.symbol ?? '').replace(/-USD$/, '');
    return { key: `${liq ? 'L' : 'T'}${r.id ?? `${t}${r.wallet_address}`}`, t, coin, side: String(r.side) as Row['side'], value: Number(r.value) || 0, px: Number(r.price) || 0, wallet: String(r.wallet_address ?? ''), liq };
  }).filter((r) => r.coin && Number.isFinite(r.t));
}

/** Merge new rows into a buffer (newest first, no repeats, capped). */
function merge(prev: Row[], add: Row[]): Row[] {
  const m = new Map(prev.map((r) => [r.key, r]));
  add.forEach((r) => m.set(r.key, r));
  return Array.from(m.values()).sort((a, b) => b.t - a.t).slice(0, BUFFER);
}

/**
 * Trades and liquidations as they happen: every market, or one, above a size, or only
 * the wallets you pick. Rows build up while the window is open.
 */
export function TapeView() {
  const { following } = useStore();
  const [trades, setTrades] = useState<Row[]>([]);
  const [liqs, setLiqs] = useState<Row[]>([]);
  const [full, setFull] = useState(false);
  const [min, setMin] = useState<number>(1_000);
  const [coin, setCoin] = useState<string>('All');
  const [showLiq, setShowLiq] = useState(true);
  const [wallets, setWallets] = useState<string[]>([]);
  const [pick, setPick] = useState(false);
  const [draft, setDraft] = useState('');
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [, tick] = useState(0);
  const pickRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; h: number } | null>(null);
  const wkey = wallets.join(',');

  // Reload from scratch whenever the source changes; then poll and build up.
  useEffect(() => {
    let alive = true;
    const seen = new Set<string>();
    setTrades([]); setLiqs([]); setFull(false);
    const mark = (rows: Row[]) => {
      const first = seen.size === 0;
      const added = rows.filter((r) => !seen.has(r.key)).map((r) => r.key);
      rows.forEach((r) => seen.add(r.key));
      if (!first && added.length) {
        setFresh((f) => new Set([...f, ...added]));
        setTimeout(() => setFresh((f) => { const n = new Set(f); added.forEach((k) => n.delete(k)); return n; }), 2500);
      }
    };
    const sym = coin === 'All' ? undefined : coin;
    const loadT = wallets.length
      ? () => Promise.all(wallets.map((a) => walletApi.getFills(a, { limit: 60, lite: true }).then((r) => (r.fills ?? []).map((f): Row => {
          const c = f.symbol.replace(/-USD$/, '');
          const k = (f as { tradeId?: string }).tradeId ?? `${f.timestamp}-${f.price}-${f.size}`;
          return { key: `W${a}${k}`, t: f.timestamp, coin: c, side: f.isBuy ? 'buy' : 'sell', value: Math.abs(f.size) * f.price, px: f.price, wallet: a, liq: f.reasonCode === 'liq' };
        })).catch(() => [] as Row[])))
          .then((lists) => { if (!alive) return; const r = lists.flat(); mark(r); setTrades((p) => merge(p, r)); })
      : () => leaderboard.getRecentTrades(200, { minValue: min || undefined, symbol: sym }).then((d) => {
          if (!alive) return;
          const r = parse(Array.isArray(d) ? d : [], false);
          mark(r); setTrades((p) => merge(p, r)); if (r.length >= 100) setFull(true);
        }).catch(() => {});
    const loadL = () => leaderboard.getRecentLiquidations(100).then((d) => { if (!alive) return; const r = parse(Array.isArray(d) ? d : [], true); mark(r); setLiqs((p) => merge(p, r)); }).catch(() => {});
    loadT(); loadL();
    const a = window.setInterval(loadT, wallets.length ? 8000 : 3000), b = window.setInterval(loadL, 6000), c = window.setInterval(() => tick((n) => n + 1), 5000);
    return () => { alive = false; window.clearInterval(a); window.clearInterval(b); window.clearInterval(c); };
  }, [min, coin, wkey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pick) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (pickRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setPick(false);
    };
    document.addEventListener('mousedown', down);
    // Sits beside the window (right, or left when there's no room) and follows it.
    let raf = 0;
    const place = () => {
      const win = pickRef.current?.closest('[data-win-kind]') as HTMLElement | null;
      const r = (win ?? pickRef.current)?.getBoundingClientRect();
      if (r) {
        const W = 280, gap = 10;
        const left = r.right + gap + W <= window.innerWidth - 8 ? r.right + gap : Math.max(8, r.left - gap - W);
        const top = Math.max(8, r.top);
        const h = Math.min(r.height, window.innerHeight - top - 8);
        setPos((p) => (p && p.left === left && p.top === top && p.h === h ? p : { left, top, h }));
      }
      raf = requestAnimationFrame(place);
    };
    place();
    return () => { document.removeEventListener('mousedown', down); cancelAnimationFrame(raf); };
  }, [pick]);

  const rows = useMemo(() => {
    const ws = new Set(wallets);
    // When the trade feed is cut off at its limit, older liquidations would sit after
    // a time jump; keep both to the span the trades cover.
    const oldest = full && trades.length ? trades[trades.length - 1].t : -Infinity;
    const lq = showLiq ? liqs.filter((r) => (ws.size ? ws.has(r.wallet) : r.t >= oldest)) : [];
    const tr = trades.filter((r) => showLiq || !r.liq);
    const seenLiq = new Set(lq.map((r) => `${r.wallet}${r.t}`));
    return [...tr.filter((r) => !(r.liq && seenLiq.has(`${r.wallet}${r.t}`))), ...lq]
      .filter((r) => r.value >= min && (coin === 'All' || r.coin === coin))
      .sort((a, b) => b.t - a.t).slice(0, 200);
  }, [trades, liqs, min, coin, showLiq, wallets, full]);

  const add = (a: string) => { const v = a.trim(); if (isAddr(v) && !wallets.includes(v)) setWallets((w) => [...w, v]); setDraft(''); };
  const since = rows.length ? rows[rows.length - 1].t : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border-color)] px-3 py-2">
        <div className="flex rounded-lg bg-[var(--bg-muted)] p-0.5">
          {MIN.map(([v, label]) => (
            <button key={v} type="button" onClick={() => setMin(v)}
              className={cn('rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors', min === v ? 'bg-[var(--bg-base)] text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]')}>{label}</button>
          ))}
        </div>
        <CoinPick value={coin} onChange={setCoin} allLabel="All markets" />
        <div ref={pickRef} className="relative">
          <button type="button" onClick={() => setPick((o) => !o)}
            className={cn('flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-medium', wallets.length ? 'border-[var(--accent)] text-[var(--text-primary)]' : 'border-[var(--border-color)] bg-[var(--bg-muted)] text-[var(--text-secondary)]')}>
            <Users className="h-3 w-3" />{wallets.length ? `${wallets.length} wallet${wallets.length > 1 ? 's' : ''}` : 'Wallets'}
          </button>
        </div>
        <button type="button" onClick={() => setShowLiq((v) => !v)}
          className={cn('ml-auto rounded-lg border px-2 py-0.5 text-[11px] transition-colors', showLiq ? 'border-[var(--neg)] text-[var(--neg)]' : 'border-[var(--border-color)] text-[var(--text-tertiary)]')}>Liquidations</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 && <p className="px-3 py-8 text-center text-[12px] text-[var(--text-tertiary)]">{trades.length || liqs.length ? (wallets.length ? 'No trades from these wallets yet.' : 'Nothing this big yet. Lower the size filter.') : 'Loading…'}</p>}
        {rows.map((r) => {
          const buy = r.side === 'buy' || r.side === 'long';
          return (
            <div key={r.key} className="flex items-center gap-2 border-b border-[var(--border-color)] px-3 py-1.5 text-[11px] transition-colors duration-700"
              style={{ background: fresh.has(r.key) ? `color-mix(in srgb, var(${r.liq ? '--neg' : '--accent'}) 14%, transparent)` : undefined }}>
              <span className="w-7 tabular-nums text-[var(--text-tertiary)]">{ago(r.t)}</span>
              <CoinIcon symbol={r.coin} size={13} />
              <span className="w-14 truncate font-medium text-[var(--text-primary)]">{r.coin}</span>
              {r.liq
                ? <span className="w-14 rounded px-1 text-center text-[10px] font-medium text-white" style={{ background: 'var(--neg)' }}>LIQ {r.side === 'long' ? 'long' : r.side === 'short' ? 'short' : ''}</span>
                : <span className="w-14" style={{ color: buy ? 'var(--pos)' : 'var(--neg)' }}>{buy ? 'Buy' : 'Sell'}</span>}
              <span className="w-14 text-right font-medium tabular-nums text-[var(--text-primary)]">{usd(r.value)}</span>
              <span className="flex-1 text-right tabular-nums text-[var(--text-tertiary)]">{price(r.px)}</span>
              <Link href={`/wallet/${r.wallet}`} className="w-[70px] truncate text-right font-mono text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">{formatAddress(r.wallet)}</Link>
            </div>
          );
        })}
      </div>
      {since && (
        <p className="border-t border-[var(--border-color)] px-3 py-1 text-[10px] text-[var(--text-tertiary)]">
          {rows.length} {wallets.length ? `from ${wallets.length} wallet${wallets.length > 1 ? 's' : ''}` : 'rows'} · since {new Date(since).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })} · builds up while open
        </p>
      )}
      {pick && pos && typeof document !== 'undefined' && createPortal(
            <div ref={panelRef} style={{ position: 'fixed', left: pos.left, top: pos.top, maxHeight: pos.h, width: 280, zIndex: 9999 }}
              className="glass-pop flex flex-col overflow-y-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-muted)] p-2 shadow-2xl">
              <div className="mb-1.5 px-0.5 text-[11px] font-medium text-[var(--text-secondary)]">Filter by wallet</div>
              <form onSubmit={(e) => { e.preventDefault(); add(draft); }} className="flex gap-1.5">
                <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Paste a wallet address" ref={(el) => { if (el && !el.dataset.f) { el.dataset.f = "1"; el.focus({ preventScroll: true }); } }} 
                  onPaste={(e) => { const t = e.clipboardData.getData('text'); const many = t.split(/[\s,]+/).filter(isAddr); if (many.length > 1) { e.preventDefault(); setWallets((w) => Array.from(new Set([...w, ...many]))); } }}
                  className="min-w-0 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-base)] px-2 py-1.5 text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]" />
                <button type="submit" disabled={!isAddr(draft.trim())} className="rounded-md bg-[var(--accent)] px-2.5 text-[11px] font-medium text-[var(--accent-text)] disabled:opacity-40">Add</button>
              </form>
              {wallets.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {wallets.map((w) => (
                    <span key={w} className="inline-flex items-center gap-1 rounded-md bg-[var(--bg-base)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-primary)]">
                      {formatAddress(w)}
                      <button type="button" aria-label="Remove" onClick={() => setWallets((ws) => ws.filter((x) => x !== w))} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"><X className="h-3 w-3" /></button>
                    </span>
                  ))}
                  <button type="button" onClick={() => setWallets([])} className="px-1 text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">Clear · all wallets</button>
                </div>
              )}
              {following.length > 0 && (
                <div className="mt-2 border-t border-[var(--border-color)] pt-1.5">
                  <div className="px-1 pb-1 text-[10px] text-[var(--text-tertiary)]">Wallets you follow</div>
                  {following.map((f) => {
                    const on = wallets.includes(f.wallet_address);
                    return (
                      <button key={f.wallet_address} type="button" onClick={() => setWallets((w) => (on ? w.filter((x) => x !== f.wallet_address) : [...w, f.wallet_address]))}
                        className="flex w-full items-center justify-between rounded-md px-1.5 py-1 text-left text-[11px] hover:bg-[var(--bg-base)]">
                        <span className="font-mono text-[var(--text-primary)]">{f.nickname || formatAddress(f.wallet_address)}</span>
                        <span className={cn('h-3.5 w-3.5 rounded border', on ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[var(--border-color)]')} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>,
            document.body,
      )}
    </div>
  );
}
