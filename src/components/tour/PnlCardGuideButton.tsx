'use client';

import { startPnlCardTour } from './PnlCardTour';

/** The home page's way into the PnL card guide: a soft pill with the site's mark on an accent badge. */
export function PnlCardGuideButton() {
  return (
    <button
      type="button"
      onClick={startPnlCardTour}
      className="group inline-flex shrink-0 items-center gap-2.5 h-9 pl-1.5 pr-4 rounded-full border border-[var(--role-line)] bg-[var(--role-surface-raised)] text-[13px] font-medium uppercase tracking-[0.07em] text-[var(--role-content)] transition-colors hover:border-[var(--accent)]"
    >
      <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--accent)] transition-transform group-hover:scale-110">
        {/* The mark as a mask, filled with the page colour, so it reads on the accent in any theme. */}
        <span aria-hidden className="block h-3.5 w-3.5 bg-[var(--bg-base)]"
          style={{ WebkitMaskImage: 'url(/stats-mark-light.png)', maskImage: 'url(/stats-mark-light.png)', WebkitMaskSize: 'contain', maskSize: 'contain', WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat', WebkitMaskPosition: 'center', maskPosition: 'center' }} />
      </span>
      Make a PnL card
    </button>
  );
}
