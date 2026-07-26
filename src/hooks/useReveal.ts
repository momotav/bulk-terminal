'use client';

// Scroll-triggered reveal via Intersection Observer.
//
// Returns a ref to attach to the section and a boolean for whether it
// has entered the viewport. Pair with the `.reveal` / `.reveal-visible`
// classes in globals.css.
//
// Design notes:
//   - One-shot. The observer disconnects after the first intersection,
//     so a revealed section carries zero ongoing cost and never
//     re-animates when scrolled back past.
//   - Fails open. If the browser lacks IntersectionObserver, or the user
//     prefers reduced motion, the section is marked visible immediately
//     rather than staying hidden. Content is never gated on animation.
//   - Use below the fold only. Live market data at the top of the page
//     must be readable on first paint; those elements use the load-time
//     stagger instead.

import { useEffect, useRef, useState } from 'react';

interface UseRevealOptions {
  // Fraction of the element that must be visible before it reveals.
  threshold?: number;
  // Shrinks the viewport from the bottom so a section starts animating
  // slightly before it is fully on screen. Negative bottom inset.
  rootMargin?: string;
}

export function useReveal<T extends HTMLElement = HTMLDivElement>({
  threshold = 0.05,
  rootMargin = '0px 0px -8% 0px',
}: UseRevealOptions = {}) {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Fail open on both counts — an unreadable panel is a worse outcome
    // than a missing animation.
    const prefersReduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
          }
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, rootMargin]);

  return { ref, visible };
}
