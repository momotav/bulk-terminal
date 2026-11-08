'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { X } from 'lucide-react';

// A guided walk through making a PnL card, which takes five steps across two pages
// and isn't obvious to a first-time visitor. Each step blurs the page, frames one
// element, and explains it. "Next" performs the step's click; clicking the framed
// element yourself works too. Mounted once in the root layout, so it carries on
// across navigation: after picking a wallet in search it resumes on the wallet page.

export const START_EVENT = 'bulkstats:pnl-card-tour';
export const startPnlCardTour = () => window.dispatchEvent(new Event(START_EVENT));

// A wallet with plenty of closed trades, for anyone who wants to see it first.
const EXAMPLE_WALLET = 'C8if99SfZ9zfCfh4ecQe3YJr13QnbHMsczha4z3LTwx9';
const PAD = 8;
const RADIUS = 12;
/** One move between targets: short, eased, the same length however far it goes. */
const MOVE_MS = 320;
const MOVE_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const MISSING_AFTER_MS = 20_000;

interface Step {
  target: string;
  title: string;
  body: string;
  /** Next clicks the target for you. Absent on the last step. */
  next?: string;
  onWalletPage: boolean;
}

const STEPS: Step[] = [
  {
    target: '[data-tour="search"]', onWalletPage: false, next: 'Open search',
    title: 'Find your wallet',
    body: 'Open search, paste your BULK wallet address and pick it from the list. The guide carries on from your wallet page.',
  },
  {
    target: '[data-tour="tab-trades"]', onWalletPage: true, next: 'Open it',
    title: 'Your trade history',
    body: 'Everything this wallet has traded lives under Trade history.',
  },
  {
    target: '[data-tour="closed-trades"]', onWalletPage: true, next: 'Show closed trades',
    title: 'Closed trades',
    body: 'Each row is one trade from open to close, with what it made or lost.',
  },
  {
    target: '[data-tour="trade-row"]', onWalletPage: true, next: 'Open this trade',
    title: 'Pick a trade',
    body: 'Choose the trade you want on your card. Its chart opens with every fill marked.',
  },
  {
    target: '[data-tour="card-button"]', onWalletPage: true, next: 'Make the card',
    title: 'Make the card',
    body: 'Card turns this trade into a PnL card: replayed on its own chart, with entry, exit and the result.',
  },
  {
    target: '[data-tour="card-options"]', onWalletPage: true,
    title: 'Make it yours, then share',
    body: 'Hide your wallet or add a referral code if you like, then download it as a video to post.',
  },
];

type Box = { x: number; y: number; w: number; h: number };

/** The page with a rounded hole cut out, as an even-odd path: the hole stays sharp and clickable. */
function holePath(b: Box, vw: number, vh: number) {
  const r = Math.min(RADIUS, b.w / 2, b.h / 2);
  const { x, y, w, h } = b;
  return `path(evenodd, 'M0 0H${vw}V${vh}H0Z M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z')`;
}

export function PnlCardTour() {
  const pathname = usePathname();
  const router = useRouter();
  const [step, setStep] = useState<number | null>(null);
  const [found, setFound] = useState(false);
  const [missing, setMissing] = useState(false);
  const [, setSearching] = useState(false); // re-render when step one hands over to search
  const targetRef = useRef<HTMLElement | null>(null);
  const searchedAt = useRef(0);
  // The moving parts are written straight to the DOM. A React render per frame, and
  // a fresh hole cut in a full-screen blur per frame, is what made the first version
  // drop frames.
  const ringRef = useRef<HTMLDivElement | null>(null);
  const blurRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const lastBox = useRef<Box | null>(null);

  const onWalletPage = pathname?.startsWith('/whales/') ?? false;
  const current = step === null ? null : STEPS[step];
  // Step one sends you through search; until a wallet page opens, the guide stands aside.
  const waitingForWallet = current !== null && current.onWalletPage && !onWalletPage;
  const paletteOpen = step === 0 && searchedAt.current > 0;

  const stop = useCallback(() => { setStep(null); setFound(false); lastBox.current = null; searchedAt.current = 0; setSearching(false); }, []);

  useEffect(() => {
    const begin = () => { searchedAt.current = 0; setSearching(false); setMissing(false); setStep(window.location.pathname.startsWith('/whales/') ? 1 : 0); };
    window.addEventListener(START_EVENT, begin);
    return () => window.removeEventListener(START_EVENT, begin);
  }, []);

  // Reaching a wallet page from step one moves the guide on.
  useEffect(() => {
    if (step === 0 && onWalletPage) { searchedAt.current = 0; setSearching(false); setStep(1); }
  }, [step, onWalletPage]);

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !paletteOpen) stop(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, paletteOpen, stop]);

  // Find the target, glide the frame to it once, then only follow it if it moves.
  useEffect(() => {
    if (!current || waitingForWallet || paletteOpen) return;
    setMissing(false);
    setFound(false);
    const since = performance.now();
    let frame = 0;
    let arriveAt = 0;
    let arrived = false;

    const place = (b: Box, animate: boolean) => {
      const ring = ringRef.current;
      const blur = blurRef.current;
      if (ring) {
        ring.style.transition = animate
          ? `transform ${MOVE_MS}ms ${MOVE_EASE}, width ${MOVE_MS}ms ${MOVE_EASE}, height ${MOVE_MS}ms ${MOVE_EASE}, opacity 200ms ease-out`
          : 'opacity 200ms ease-out';
        ring.style.transform = `translate3d(${b.x}px, ${b.y}px, 0)`;
        ring.style.width = `${b.w}px`;
        ring.style.height = `${b.h}px`;
        ring.style.opacity = '1';
      }
      // The blur keeps still while the frame travels; the hole opens when it lands,
      // so the target comes into focus on arrival.
      if (blur) blur.style.clipPath = animate ? 'none' : holePath(b, window.innerWidth, window.innerHeight);
      placeCard(b);
      lastBox.current = b;
    };

    const placeCard = (b: Box) => {
      const card = cardRef.current;
      if (!card) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (vw < 640) { card.style.left = '16px'; card.style.top = ''; card.style.bottom = '16px'; return; }
      const w = card.offsetWidth || 340;
      const h = card.offsetHeight || 200;
      const roomBelow = vh - (b.y + b.h) - 14;
      const above = roomBelow < h + 16 && b.y > h + 30;
      card.style.left = `${Math.max(16, Math.min(vw - w - 16, b.x + b.w / 2 - w / 2))}px`;
      card.style.top = above ? `${b.y - h - 14}px` : `${Math.min(vh - h - 16, b.y + b.h + 14)}px`;
      card.style.bottom = '';
    };

    const measure = (el: HTMLElement): Box => {
      const r = el.getBoundingClientRect();
      // Kept on screen, so the frame around something wider than the viewport still shows.
      const left = Math.max(4, r.left - PAD);
      const right = Math.min(window.innerWidth - 4, r.right + PAD);
      return { x: left, y: r.top - PAD, w: Math.max(0, right - left), h: r.height + PAD * 2 };
    };

    const tick = () => {
      const el = document.querySelector<HTMLElement>(current.target);
      targetRef.current = el;
      if (el && el.offsetParent !== null) {
        if (!arriveAt) {
          // Scroll first, at once, so the frame travels to where the target will stay
          // rather than chasing it through a smooth scroll. The page is blurred anyway.
          // From its start, not its middle: a row wider than a phone would otherwise
          // scroll to its prices and hide which trade it is.
          el.scrollIntoView({ block: 'center', inline: 'start', behavior: 'instant' as ScrollBehavior });
          const b = measure(el);
          place(b, lastBox.current !== null);
          arriveAt = performance.now() + (lastBox.current ? MOVE_MS : 0);
          setFound(true);
        } else if (!arrived && performance.now() >= arriveAt) {
          arrived = true;
          place(measure(el), false);
        } else if (arrived) {
          const b = measure(el);
          const p = lastBox.current;
          if (!p || Math.abs(p.x - b.x) > 0.5 || Math.abs(p.y - b.y) > 0.5 || Math.abs(p.w - b.w) > 0.5 || Math.abs(p.h - b.h) > 0.5) place(b, false);
        }
      } else if (performance.now() - since > MISSING_AFTER_MS) {
        setMissing(true);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [current, waitingForWallet, paletteOpen]);

  // Clicking the framed element yourself counts as doing the step.
  useEffect(() => {
    const el = targetRef.current;
    if (!current?.next || !el || waitingForWallet || !found) return;
    const onClick = () => advance(false);
    el.addEventListener('click', onClick, { capture: true });
    return () => el.removeEventListener('click', onClick, { capture: true });
  });

  const advance = (perform: boolean) => {
    if (step === null || !current) return;
    const el = targetRef.current;
    if (perform && el) el.click();
    if (step === 0) { searchedAt.current = Date.now(); lastBox.current = null; setSearching(true); return; }
    if (step >= STEPS.length - 1) { stop(); return; }
    setStep(step + 1);
  };

  if (step === null || !current) return null;

  // Step one handed over to search: a small note stays up until a wallet opens.
  if (paletteOpen || waitingForWallet) {
    return (
      <div className="fixed bottom-4 left-1/2 z-[95] -translate-x-1/2 w-[min(440px,calc(100vw-32px))] rounded-xl border border-[var(--border-color)] bg-[var(--bg-muted)] px-4 py-3 shadow-2xl">
        <div className="flex items-start gap-3">
          <p className="flex-1 text-[13px] leading-relaxed text-[var(--role-content-muted)]">
            Paste your wallet in search and open it. The guide carries on from there.
          </p>
          <button type="button" onClick={stop} aria-label="Close guide" className="p-1 -m-1 text-[var(--role-content-subtle)] hover:text-[var(--role-content)]"><X className="h-4 w-4" /></button>
        </div>
        <button type="button" onClick={() => { searchedAt.current = 0; window.dispatchEvent(new Event('bulkstats:close-command')); router.push(`/whales/${EXAMPLE_WALLET}`); }}
          className="mt-2 text-[13px] text-[var(--role-content)] underline underline-offset-4 decoration-[var(--role-line)] hover:decoration-[var(--role-content)]">
          Use an example wallet instead
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label="PnL card guide">
      {/* Blur only. The dimming is the frame's own shadow, so it moves with the frame for free. */}
      <div ref={blurRef} className="absolute inset-0 backdrop-blur-[6px]" onClick={stop} />
      <div ref={ringRef} className="pointer-events-none absolute left-0 top-0 rounded-xl opacity-0 will-change-transform"
        style={{ boxShadow: '0 0 0 2px var(--accent), 0 0 28px 4px color-mix(in srgb, var(--accent) 45%, transparent), 0 0 0 200vmax rgba(0, 0, 0, 0.45)' }} />
      <div ref={cardRef} className="absolute w-[calc(100vw-32px)] sm:w-[340px] rounded-2xl border border-[var(--border-color)] bg-[var(--bg-muted)] p-4 shadow-2xl transition-[top,left,opacity] duration-300 ease-out"
        style={{ left: 16, bottom: 16, opacity: found || missing ? 1 : 0 }}>
        <div className="flex items-start justify-between gap-3">
          <span className="text-[12px] tabular-nums text-[var(--role-content-subtle)]">Step {step + 1} of {STEPS.length}</span>
          <button type="button" onClick={stop} aria-label="Close guide" className="p-1 -m-1 text-[var(--role-content-subtle)] hover:text-[var(--role-content)]"><X className="h-4 w-4" /></button>
        </div>
        <h2 className="mt-1.5 text-[17px] font-medium text-[var(--role-content)]">{missing ? 'Not here yet' : current.title}</h2>
        <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--role-content-muted)]">
          {missing
            ? step === 3
              ? 'This wallet has no closed trades yet. Open positions have a card button too, in the Positions tab.'
              : 'This part of the page didn’t show up. You can carry on by hand, or close the guide.'
            : current.body}
        </p>
        {step === 0 && (
          <button type="button" onClick={() => router.push(`/whales/${EXAMPLE_WALLET}`)}
            className="mt-2 text-[13px] text-[var(--role-content)] underline underline-offset-4 decoration-[var(--role-line)] hover:decoration-[var(--role-content)]">
            Or see it on an example wallet
          </button>
        )}
        <div className="mt-4 flex items-center gap-2">
          {step > 1 && (
            <button type="button" onClick={() => setStep(step - 1)} className="h-9 px-3 rounded-lg text-[13px] text-[var(--role-content-muted)] hover:text-[var(--role-content)]">Back</button>
          )}
          <span className="flex-1" />
          {missing || !current.next ? (
            <button type="button" onClick={stop} className="h-9 px-4 rounded-lg bg-[var(--role-content)] text-[var(--bg-base)] text-[13px] font-medium">Done</button>
          ) : (
            <button type="button" onClick={() => advance(true)} disabled={!found} className="h-9 px-4 rounded-lg bg-[var(--role-content)] text-[var(--bg-base)] text-[13px] font-medium disabled:opacity-40">{current.next}</button>
          )}
        </div>
      </div>
    </div>
  );
}
