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
  const [box, setBox] = useState<Box | null>(null);
  const [missing, setMissing] = useState(false);
  const [view, setView] = useState({ w: 0, h: 0 });
  const shown = useRef<Box | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const searchedAt = useRef(0);

  const onWalletPage = pathname?.startsWith('/whales/') ?? false;
  const current = step === null ? null : STEPS[step];
  // Step one sends you through search; until a wallet page opens, the guide stands aside.
  const waitingForWallet = current !== null && current.onWalletPage && !onWalletPage;
  const paletteOpen = step === 0 && searchedAt.current > 0;

  const stop = useCallback(() => { setStep(null); setBox(null); shown.current = null; searchedAt.current = 0; }, []);

  useEffect(() => {
    const begin = () => { searchedAt.current = 0; setMissing(false); setStep(window.location.pathname.startsWith('/whales/') ? 1 : 0); };
    window.addEventListener(START_EVENT, begin);
    return () => window.removeEventListener(START_EVENT, begin);
  }, []);

  // Reaching a wallet page from step one moves the guide on.
  useEffect(() => {
    if (step === 0 && onWalletPage) { searchedAt.current = 0; setStep(1); }
  }, [step, onWalletPage]);

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !paletteOpen) stop(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, paletteOpen, stop]);

  // Follow the target every frame: it can scroll, load late, or move with the layout.
  // The frame glides to it rather than jumping between steps.
  useEffect(() => {
    if (!current || waitingForWallet) return;
    setMissing(false);
    const since = performance.now();
    let scrolled = false;
    let frame = 0;
    const tick = () => {
      const el = document.querySelector<HTMLElement>(current.target);
      targetRef.current = el;
      setView((v) => (v.w === window.innerWidth && v.h === window.innerHeight ? v : { w: window.innerWidth, h: window.innerHeight }));
      if (el && el.offsetParent !== null) {
        // From its start, not its middle: a table row wider than a phone would otherwise
        // scroll to its prices and hide which trade it is.
        if (!scrolled) { el.scrollIntoView({ block: 'center', inline: 'start', behavior: 'smooth' }); scrolled = true; }
        const r = el.getBoundingClientRect();
        // Kept on screen, so the frame around something wider than the viewport still shows.
        const left = Math.max(4, r.left - PAD);
        const right = Math.min(window.innerWidth - 4, r.right + PAD);
        const want = { x: left, y: r.top - PAD, w: Math.max(0, right - left), h: r.height + PAD * 2 };
        const prev = shown.current ?? want;
        const k = 0.28;
        const next = { x: prev.x + (want.x - prev.x) * k, y: prev.y + (want.y - prev.y) * k, w: prev.w + (want.w - prev.w) * k, h: prev.h + (want.h - prev.h) * k };
        shown.current = next;
        setBox(next);
      } else if (performance.now() - since > MISSING_AFTER_MS) {
        setMissing(true);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [current, waitingForWallet]);

  // Clicking the framed element yourself counts as doing the step.
  useEffect(() => {
    const el = targetRef.current;
    if (!current?.next || !el || waitingForWallet) return;
    const onClick = () => advance(false);
    el.addEventListener('click', onClick, { capture: true });
    return () => el.removeEventListener('click', onClick, { capture: true });
  });

  const advance = (perform: boolean) => {
    if (step === null || !current) return;
    const el = targetRef.current;
    if (perform && el) el.click();
    if (step === 0) { searchedAt.current = Date.now(); setBox(null); shown.current = null; return; }
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

  const vw = view.w || (typeof window !== 'undefined' ? window.innerWidth : 0);
  const vh = view.h || (typeof window !== 'undefined' ? window.innerHeight : 0);
  const phone = vw < 640;
  const cardW = phone ? vw - 32 : 340;
  // The explanation sits under the frame, or over it when there's no room below.
  const below = box ? box.y + box.h + 14 : vh / 2;
  const placeAbove = box ? below + 210 > vh && box.y > 240 : false;
  const cardStyle: React.CSSProperties = phone
    ? { left: 16, bottom: 16 }
    : box
      ? { left: Math.max(16, Math.min(vw - cardW - 16, box.x + box.w / 2 - cardW / 2)), ...(placeAbove ? { bottom: vh - box.y + 14 } : { top: below }) }
      : { left: vw / 2 - cardW / 2, top: vh / 2 - 90 };

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label="PnL card guide">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[6px] transition-[clip-path]"
        style={box ? { clipPath: holePath(box, vw, vh) } : undefined} onClick={stop} />
      {box && (
        <div className="pointer-events-none absolute rounded-xl"
          style={{ left: box.x, top: box.y, width: box.w, height: box.h, boxShadow: '0 0 0 2px var(--accent), 0 0 28px 4px color-mix(in srgb, var(--accent) 45%, transparent)' }} />
      )}
      <div className="absolute rounded-2xl border border-[var(--border-color)] bg-[var(--bg-muted)] p-4 shadow-2xl" style={{ width: cardW, ...cardStyle }}>
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
            <button type="button" onClick={() => advance(true)} disabled={!box} className="h-9 px-4 rounded-lg bg-[var(--role-content)] text-[var(--bg-base)] text-[13px] font-medium disabled:opacity-40">{current.next}</button>
          )}
        </div>
      </div>
    </div>
  );
}
