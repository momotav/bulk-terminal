import { Suspense } from 'react';
import type { Metadata } from 'next';
import ObserveClient from './ObserveClient';
import { fmtUsd, resolvePosition, shortAddr } from '@/lib/positionShare';

// Server wrapper for the shareable single-position page: the page itself is the
// client view, this only gives the link a title, description and preview image so
// it unfolds into a card on X, Telegram and Discord.

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.bulkstats.com';

type Props = { params: { address: string; coin: string }; searchParams: Record<string, string | string[] | undefined> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const address = decodeURIComponent(params.address);
  const coin = decodeURIComponent(params.coin).toUpperCase().replace(/-USD$/, '');
  const one = (k: string) => { const v = searchParams[k]; return Number(Array.isArray(v) ? v[0] : v) || 0; };
  const from = one('from'); const to = one('to');

  const pos = await resolvePosition(address, coin, from, to).catch(() => null);
  const side = pos ? `${pos.side === 'long' ? 'Long' : 'Short'}${pos.leverage ? ` ${Math.round(pos.leverage)}x` : ''}` : '';
  const title = pos
    ? `${side} ${pos.coin} · ${fmtUsd(pos.pnl, true)}${pos.status === 'open' ? ' open' : pos.status === 'liquidated' ? ' liquidated' : ''} · bulkstats`
    : `${coin}-USD position · ${shortAddr(address)} · bulkstats`;
  const description = pos
    ? `${shortAddr(address)} ${pos.status === 'open' ? 'is' : 'was'} ${side.toLowerCase()} ${pos.coin} on BULK. Every fill, the price path and the PnL, replayed on bulkstats.`
    : `Every fill, the price path and the PnL of this ${coin} position on BULK, replayed on bulkstats.`;

  const q = new URLSearchParams({ a: address, c: coin });
  if (from) q.set('from', String(from));
  if (to) q.set('to', String(to));
  const image = `${SITE}/api/og/position?${q}`;
  const url = `${SITE}/observe/${address}/${coin}${from ? `?from=${from}${to ? `&to=${to}` : ''}` : ''}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: 'bulkstats', type: 'website', images: [{ url: image, width: 1200, height: 630, alt: title }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

export default function ObservePage() {
  return <Suspense fallback={null}><ObserveClient /></Suspense>;
}
