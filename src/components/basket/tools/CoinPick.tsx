'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { CoinIcon } from '@/components/CoinIcon';
import { CoinSearch, useMarkets } from '../parts';

/** A market button that opens a searchable list under it. */
export function CoinPick({ value, onChange, exclude = [], align = 'left', allLabel }: { value: string; onChange: (c: string) => void; exclude?: string[]; align?: 'left' | 'right'; /** Adds an "all" choice (value 'All'). */ allLabel?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const { markets } = useMarkets();
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-muted)] px-2 text-[12px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-base)]">
        {value === 'All' && allLabel ? allLabel : <><CoinIcon symbol={value} size={14} />{value}</>}<ChevronDown className="h-3 w-3 text-[var(--text-tertiary)]" />
      </button>
      {open && (
        <div className={`glass-pop absolute top-full z-40 mt-1 w-[240px] rounded-xl border border-[var(--border-color)] bg-[var(--bg-muted)] p-1.5 shadow-2xl ${align === 'left' ? 'left-0' : 'right-0'}`}>
          {allLabel && (
            <button type="button" onClick={() => { onChange('All'); setOpen(false); }}
              className="mb-1 w-full rounded-md px-2.5 py-1.5 text-left text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-base)]">{allLabel}</button>
          )}
          <CoinSearch markets={markets} exclude={exclude} onPick={(c) => { onChange(c); setOpen(false); }} maxHeight={220} />
        </div>
      )}
    </div>
  );
}
