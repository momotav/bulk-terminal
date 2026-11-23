'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A small "i" that holds an explanation, so sections can stay short. Opens on hover
 * (desktop) or tap (phone); the note floats in a frosted panel next to it.
 */
export function InfoTip({ children, label = 'More info', width = 300 }: { children: ReactNode; label?: string; width?: number }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btn = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);

  const place = () => {
    const r = btn.current?.getBoundingClientRect(); if (!r) return;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - width / 2), window.innerWidth - width - 8);
    setPos({ left, top: r.bottom + 8 });
  };
  useEffect(() => {
    if (!open) return;
    place();
    const close = (e: MouseEvent) => { if (!btn.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node)) setOpen(false); };
    const off = () => setOpen(false);
    document.addEventListener('mousedown', close); window.addEventListener('scroll', off, true);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', off, true); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <button ref={btn} type="button" aria-label={label} aria-expanded={open}
        onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onClick={() => setOpen((o) => !o)}
        className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-[var(--border-color)] align-middle text-[11px] font-medium italic leading-none text-[var(--text-tertiary)] transition-colors hover:border-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
        i
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal(
        <div ref={panel} role="tooltip" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
          className="glass-pop fixed z-[200] rounded-xl border border-[var(--border-color)] bg-[var(--bg-muted)] px-3.5 py-3 text-[12px] font-normal not-italic leading-relaxed text-[var(--text-secondary)] shadow-2xl"
          style={{ left: pos.left, top: pos.top, width }}>
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}
