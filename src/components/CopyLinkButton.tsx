'use client';

import { useState } from 'react';
import { Check, Link2 } from 'lucide-react';
import { cn } from '@/lib/api';

/** Copies an absolute link to a site path. Pasted on X or Telegram it unfolds into a preview card. */
export function CopyLinkButton({ path, label, className, iconOnly = false }: { path: string; label?: string; className?: string; iconOnly?: boolean }) {
  const [done, setDone] = useState(false);
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault();
    try { await navigator.clipboard.writeText(`${window.location.origin}${path}`); setDone(true); setTimeout(() => setDone(false), 1600); } catch { /* clipboard blocked */ }
  };
  return (
    <button type="button" onClick={copy} title={done ? 'Copied' : label ?? 'Copy link'} aria-label={label ?? 'Copy link'}
      className={cn('inline-flex items-center justify-center gap-1.5 rounded-md text-[var(--role-content-subtle)] hover:text-[var(--role-content)] hover:bg-[var(--role-surface-raised)] transition-colors', iconOnly ? 'w-7 h-7' : 'h-8 px-2.5 text-[13px] border border-[var(--border-color)]', className)}>
      {done ? <Check className="w-3.5 h-3.5 text-[var(--pos)]" /> : <Link2 className="w-3.5 h-3.5" />}
      {!iconOnly && <span>{done ? 'Copied' : label ?? 'Copy link'}</span>}
    </button>
  );
}
