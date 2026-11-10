'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/api';

export interface SelectOption { value: string; label: string; hint?: string; icon?: ReactNode }

/**
 * The site's own dropdown, in place of the browser's: options can carry an icon and a
 * hint, and it opens in the page's style. Arrow keys, Enter, Escape and type-to-jump work.
 */
export function OptionSelect({ id, value, options, onChange, className }: {
  id?: string; value: string; options: SelectOption[]; onChange: (v: string) => void; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement | null>(null);
  const list = useRef<HTMLUListElement | null>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const pick = (i: number) => { onChange(options[i].value); setOpen(false); };
  const onKey = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(true); return; }
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(options.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(active); }
    else if (e.key.length === 1) {
      const i = options.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (i >= 0) setActive(i);
    }
  };

  return (
    <div ref={root} className={cn('relative', className)}>
      <button id={id} type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} onKeyDown={onKey}
        className={cn('w-full h-10 flex items-center gap-2.5 rounded-lg border outline-none focus-visible:border-[var(--accent)] bg-[var(--bg-base)] px-3 text-left text-[14px] text-[var(--text-primary)] transition-colors',
          open ? 'border-[var(--accent)]' : 'border-[var(--border-color)] hover:border-[var(--text-tertiary)]')}>
        {current?.icon}
        <span className="flex-1 truncate">{current?.label}</span>
        {current?.hint && <span className="text-[12px] text-[var(--text-tertiary)] tabular-nums">{current.hint}</span>}
        <ChevronDown className={cn('w-4 h-4 text-[var(--text-tertiary)] transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul ref={list} role="listbox" aria-activedescendant={`${id}-opt-${active}`}
          className="absolute z-30 mt-1.5 w-full max-h-[300px] overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-muted)] p-1 shadow-2xl">
          {options.map((o, i) => (
            <li key={o.value} id={`${id}-opt-${i}`} role="option" aria-selected={o.value === value}
              onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); pick(i); }}
              className={cn('flex items-center gap-2.5 rounded-md px-2.5 py-2 cursor-pointer text-[14px]', i === active ? 'bg-[var(--bg-base)]' : '')}>
              {o.icon}
              <span className="flex-1 truncate text-[var(--text-primary)]">{o.label}</span>
              {o.hint && <span className="text-[12px] text-[var(--text-tertiary)] tabular-nums">{o.hint}</span>}
              <Check className={cn('w-3.5 h-3.5 text-[var(--accent)]', o.value === value ? 'opacity-100' : 'opacity-0')} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
