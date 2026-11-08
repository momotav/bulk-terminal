'use client';

import { Sparkles } from 'lucide-react';
import { startPnlCardTour } from './PnlCardTour';

/** The home page's way into the PnL card guide: a soft pill with an accent badge. */
export function PnlCardGuideButton() {
  return (
    <button
      type="button"
      onClick={startPnlCardTour}
      className="group inline-flex shrink-0 items-center gap-2.5 h-9 pl-1.5 pr-4 rounded-full border border-[var(--role-line)] bg-[var(--role-surface-raised)] text-[13px] font-medium uppercase tracking-[0.07em] text-[var(--role-content)] transition-colors hover:border-[var(--accent)]"
    >
      <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--accent)] text-[var(--bg-base)] transition-transform group-hover:scale-110">
        <Sparkles className="h-3.5 w-3.5" strokeWidth={2.2} />
      </span>
      Make a PnL card
    </button>
  );
}
