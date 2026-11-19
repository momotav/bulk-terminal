'use client';

// Controls for the share cards: a switch, an anchored popover, a styled date-range
// calendar and the action bar (Customise · window on the left; replay, copy image,
// share on X and download on the right). One look for every card.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, Download, Loader2 } from 'lucide-react';
import { cn } from '@/lib/api';

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 py-2 text-[13px] text-[var(--text-primary)] disabled:opacity-40">
      <span>{label}</span>
      <span className={cn('relative h-6 w-10 shrink-0 rounded-full border transition-colors duration-200', checked ? 'border-transparent bg-[var(--text-primary)]' : 'border-[var(--border-color)] bg-[var(--bg-base)]')}>
        <span className={cn('absolute top-1/2 h-[18px] w-[18px] -translate-y-1/2 rounded-full shadow-sm transition-[left,background-color] duration-200 ease-out', checked ? 'left-[19px] bg-[var(--bg-muted)]' : 'left-[2px] bg-[var(--text-tertiary)]')} />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, disabled }: { value: T; options: [T, string][]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-[var(--bg-base)] p-0.5">
      {options.map(([k, label]) => (
        <button key={k} type="button" disabled={disabled} onClick={() => onChange(k)}
          className={cn('rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors disabled:opacity-40', k === value ? 'bg-[var(--bg-muted)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]')}>
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * A panel that opens BESIDE the card (left of it, else right, bottom edges lined up),
 * so it never covers what it is changing. With no room at the sides (phones) it opens
 * above its trigger. Closes on outside click or Escape.
 */
export function Popover({ trigger, children, open, onOpenChange, align = 'left', width = 300 }: {
  trigger: ReactNode; children: ReactNode; open: boolean; onOpenChange: (v: boolean) => void; align?: 'left' | 'right'; width?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [side, setSide] = useState<React.CSSProperties | null>(null);
  useEffect(() => {
    if (!open) { setSide(null); return; }
    const place = () => {
      const root = ref.current?.closest('[data-card-root]') as HTMLElement | null;
      if (!root) { setSide(null); return; }
      const r = root.getBoundingClientRect();
      const gap = 14, bottom = Math.max(16, window.innerHeight - r.bottom);
      if (r.left - gap - width >= 12) setSide({ position: 'fixed', left: r.left - gap - width, bottom, width });
      else if (window.innerWidth - r.right - gap - width >= 12) setSide({ position: 'fixed', left: r.right + gap, bottom, width });
      else setSide(null);
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, width]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false); };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open, onOpenChange]);
  return (
    <div ref={ref} className="relative">
      {trigger}
      {open && (
        <div className={cn('z-30 max-h-[calc(100vh-32px)] overflow-y-auto rounded-2xl border border-[var(--border-color)] bg-[var(--bg-muted)] p-3 shadow-[0_18px_50px_-12px_rgb(0_0_0/0.45)] animate-[ws-pop_.14s_ease-out]',
          !side && 'absolute bottom-full mb-2', !side && (align === 'left' ? 'left-0' : 'right-0'))}
          style={side ?? { width: `min(${width}px, calc(100vw - 32px))` }}>
          {children}
        </div>
      )}
    </div>
  );
}

export const barBtn = 'inline-flex h-9 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-xl border border-[var(--border-color)] bg-[var(--bg-muted)] px-3 text-[13px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-base)] disabled:opacity-45';
const iconBtn = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-muted)] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-base)] disabled:opacity-45';

const XLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
);

/** The bar under a card: the card's own controls on the left, sharing on the right. */
export function CardBar({ left, canvas, shareText, shareUrl, onReplay, onDownload, busy, recording, converting, convertPct, canExport }: {
  left: ReactNode; canvas: () => HTMLCanvasElement | null; shareText: string; shareUrl: string;
  onReplay: () => void; onDownload: () => void; busy: boolean; recording: boolean; converting: boolean; convertPct: number; canExport: boolean;
}) {
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const copyImage = async () => {
    const c = canvas(); if (!c) return;
    try {
      const blob: Blob | null = await new Promise((res) => c.toBlob(res, 'image/png'));
      if (!blob || typeof ClipboardItem === 'undefined') throw new Error('no clipboard');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopied('ok');
    } catch { setCopied('fail'); }
    setTimeout(() => setCopied(null), 1600);
  };
  const shareX = () => {
    const u = `https://x.com/intent/post?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;
    window.open(u, '_blank', 'noopener,noreferrer,width=600,height=520');
  };
  return (
    <div className="flex w-full items-center gap-1.5 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-base)] p-1.5">
      <div className="flex items-center gap-1.5">{left}</div>
      <div className="ml-auto flex items-center gap-1.5">
        <button type="button" onClick={copyImage} disabled={recording || converting} className={iconBtn} title={copied === 'fail' ? 'Copy not supported here' : 'Copy image'} aria-label="Copy image">
          {copied === 'ok' ? <Check className="h-4 w-4 text-[var(--pos)]" /> : <Copy className="h-4 w-4" />}
        </button>
        <button type="button" onClick={shareX} className={iconBtn} title="Share on X" aria-label="Share on X"><XLogo className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={onDownload} disabled={busy || !canExport} className={cn(iconBtn, (recording || converting) && 'w-auto px-3')}
          title={canExport ? 'Download video' : 'Video recording not supported in this browser'} aria-label="Download video">
          {recording ? <><Loader2 className="h-4 w-4 animate-spin" /><span className="ml-1.5 text-[12px]">Recording</span></>
            : converting ? <><Loader2 className="h-4 w-4 animate-spin" /><span className="ml-1.5 text-[12px]">{convertPct ? `${convertPct}%` : 'Saving'}</span></>
            : <Download className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

// ── Date range calendar ───────────────────────────────────────────────────────

const WEEK = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const dayStart = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const short = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Pick a start day, then an end day. Days outside [min, max] are disabled. */
export function DateRange({ from, to, min, max, onChange }: { from: number; to: number; min: number; max: number; onChange: (from: number, to: number) => void }) {
  const [month, setMonth] = useState(() => { const d = new Date(to); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); });
  const [anchor, setAnchor] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const days = useMemo(() => {
    const first = new Date(month); const lead = (first.getDay() + 6) % 7;
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - lead);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i).getTime());
  }, [month]);
  const m = new Date(month);
  const lo = anchor !== null ? Math.min(anchor, hover ?? anchor) : dayStart(from);
  const hi = anchor !== null ? Math.max(anchor, hover ?? anchor) : dayStart(to);
  const step = (n: number) => setMonth(new Date(m.getFullYear(), m.getMonth() + n, 1).getTime());
  const pick = (d: number) => {
    if (anchor === null) { setAnchor(d); return; }
    const a = Math.min(anchor, d), b = Math.max(anchor, d);
    setAnchor(null); setHover(null);
    onChange(a, Math.min(b + 86_400_000 - 1, max));
  };
  return (
    <div className="select-none">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => step(-1)} disabled={new Date(m.getFullYear(), m.getMonth(), 0).getTime() < dayStart(min)}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-base)] disabled:opacity-30" aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
        <span className="text-[13px] font-medium text-[var(--text-primary)]">{m.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
        <button type="button" onClick={() => step(1)} disabled={new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime() > max}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-base)] disabled:opacity-30" aria-label="Next month"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] text-[var(--text-tertiary)]">{WEEK.map((w) => <span key={w} className="py-1">{w}</span>)}</div>
      <div className="grid grid-cols-7 gap-y-0.5" onMouseLeave={() => setHover(null)}>
        {days.map((d) => {
          const inMonth = new Date(d).getMonth() === m.getMonth();
          const off = d + 86_400_000 <= dayStart(min) || d > max;
          const inRange = d >= lo && d <= hi;
          const edge = d === lo || d === hi;
          return (
            <button key={d} type="button" disabled={off} onClick={() => pick(d)} onMouseEnter={() => setHover(d)}
              className={cn('h-8 text-[12px] tabular-nums transition-colors disabled:opacity-25',
                inRange && !edge && 'bg-[color-mix(in_srgb,var(--accent)_16%,transparent)]',
                edge ? 'rounded-lg bg-[var(--accent)] font-medium text-[var(--accent-text)]' : 'rounded-md hover:bg-[var(--bg-base)]',
                !inMonth && !edge && 'text-[var(--text-tertiary)]', inMonth && !edge && 'text-[var(--text-primary)]')}>
              {new Date(d).getDate()}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-center text-[11px] text-[var(--text-tertiary)]">
        {anchor !== null ? 'Now pick the end day' : `${short(from)} – ${short(to)}`}
      </p>
    </div>
  );
}
