'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCw } from 'lucide-react';

/** Shown when a trade/order couldn't be fetched (BULK busy, timeout): never a false
 *  "not found". Retries on its own a few times, and offers a button. */
export function LoadRetry({ what }: { what: string }) {
  const router = useRouter();
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (tries >= 3) return;
    const t = setTimeout(() => { setTries((n) => n + 1); router.refresh(); }, 2500 + tries * 2000);
    return () => clearTimeout(t);
  }, [tries, router]);
  return (
    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--role-surface)] px-6 py-10 text-center">
      <div className="text-[16px] text-[var(--role-content)]">Couldn&apos;t load this {what} right now</div>
      <p className="mt-1.5 text-[13px] text-[var(--role-content-muted)]">BULK is busy for a moment. {tries < 3 ? 'Trying again…' : 'Try again in a few seconds.'}</p>
      <button type="button" onClick={() => { setTries(0); router.refresh(); }}
        className="mt-4 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] border border-[var(--border-color)] text-[var(--role-content)] hover:bg-[var(--role-surface-raised)] transition-colors">
        <RotateCw className="w-3.5 h-3.5" />Retry
      </button>
    </div>
  );
}
