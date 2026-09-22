'use client';

// Coin logo with graceful fallbacks, tried in order:
//   1) /coins/<SYMBOL>.svg  then  /coins/<SYMBOL>.png   (put BULK's own logos
//      here — public/coins/BTC.svg etc. — to match the exchange exactly)
//   2) the cryptocurrency-icons CDN (covers the majors automatically)
//   3) a colored monogram (first letter on the coin's palette colour)
//
// So majors light up with zero setup; drop a file into public/coins to add or
// override any coin; anything still missing shows a tidy monogram, never a
// broken image.

import { useMemo, useState } from 'react';
import { getCoinColor } from '@/lib/coins';

// Symbols the cryptocurrency-icons CDN is known to carry (BULK's current list
// + common majors). Others skip the CDN and fall straight to the monogram so
// we don't fire a request that's guaranteed to 404.
const CDN_HAS = new Set([
  'BTC', 'ETH', 'SOL', 'BNB', 'DOGE', 'AAVE', 'XRP', 'ZEC',
  'LINK', 'AVAX', 'ADA', 'LTC', 'DOT', 'UNI', 'ATOM', 'XLM', 'TRX', 'BCH', 'ETC', 'FIL',
]);

const coinOf = (symbol: string) => symbol.replace(/-USD$/i, '').toUpperCase();

export function CoinIcon({ symbol, size = 20, className = '' }: { symbol: string; size?: number; className?: string }) {
  const coin = coinOf(symbol);
  const sources = useMemo(() => {
    const s = [`/coins/${coin}.svg`, `/coins/${coin}.png`];
    if (CDN_HAS.has(coin)) s.push(`https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/${coin.toLowerCase()}.svg`);
    return s;
  }, [coin]);
  const [idx, setIdx] = useState(0);

  if (idx >= sources.length) {
    return (
      <span
        aria-hidden
        className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold leading-none text-white ${className}`}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.44), background: getCoinColor(coin) }}
      >
        {coin.slice(0, 1)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={sources[idx]}
      src={sources[idx]}
      alt={coin}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setIdx((i) => i + 1)}
      className={`shrink-0 rounded-full ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
