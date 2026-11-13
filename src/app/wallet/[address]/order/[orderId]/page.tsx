import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { CoinIcon } from '@/components/CoinIcon';
import { CopyLinkButton } from '@/components/CopyLinkButton';
import { fmtPx, fmtUsd, getOrder, orderStatus, shortAddr } from '@/lib/positionShare';

// One order, shareable by its BULK order id: what it asked for, how much filled,
// at what average, and every fill (each linking to its own trade page).

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.bulkstats.com';
type Props = { params: { address: string; orderId: string }; searchParams: Record<string, string | string[] | undefined> };
const ids = ({ params, searchParams }: Props) => {
  const s = searchParams.slot; const slot = Number(Array.isArray(s) ? s[0] : s) || 0;
  return { address: decodeURIComponent(params.address), orderId: decodeURIComponent(params.orderId), slot };
};
const typeWord = (t: string, tif: string | null) => {
  const base = t.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase() || 'order';
  return tif === 'postOnly' ? `${base}, post only` : tif === 'ioc' ? `${base}, IOC` : base;
};

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { address, orderId, slot } = ids(props);
  const r = await getOrder(address, orderId, slot).catch(() => null);
  const o = r?.order;
  const coin = o?.symbol.replace(/-USD$/, '') ?? '';
  const buy = o ? o.side.toLowerCase().startsWith('b') : true;
  const title = o
    ? `${buy ? 'Buy' : 'Sell'} ${coin} ${typeWord(o.orderType, null)} · ${fmtUsd(o.originalSize * (o.price || o.vwap))} · ${orderStatus(o.status)} · bulkstats`
    : 'Order · bulkstats';
  const description = o ? `${shortAddr(address)}'s ${coin} order on BULK: ${Math.round((o.executedSize / (o.originalSize || 1)) * 100)}% filled${o.vwap ? ` at ${fmtPx(o.vwap)} average` : ''}.` : `Order ${shortAddr(orderId)} on BULK.`;
  const q = new URLSearchParams({ k: 'order', a: address, id: orderId }); if (slot) q.set('slot', String(slot));
  const image = `${SITE}/api/og/exec?${q}`;
  const url = `${SITE}/wallet/${address}/order/${orderId}${slot ? `?slot=${slot}` : ''}`;
  return {
    title, description, alternates: { canonical: url },
    openGraph: { title, description, url, siteName: 'bulkstats', images: [{ url: image, width: 1200, height: 630, alt: title }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

export default async function OrderPage(props: Props) {
  const { address, orderId, slot } = ids(props);
  const r = await getOrder(address, orderId, slot);
  if (!r) notFound();
  const { order: o, fills } = r;
  const coin = o.symbol.replace(/-USD$/, '');
  const buy = o.side.toLowerCase().startsWith('b');
  const pct = o.originalSize > 0 ? Math.min(1, o.executedSize / o.originalSize) : 0;
  const px = o.trigger?.px ?? o.price;
  const fees = fills.reduce((s, f) => s + (f.fee || 0), 0);
  const path = `/wallet/${address}/order/${orderId}${o.slot ? `?slot=${o.slot}` : ''}`;

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <Link href={`/wallet/${address}`} className="inline-flex items-center gap-1.5 text-[13px] text-[var(--role-content-muted)] hover:text-[var(--role-content)] transition-colors">
        <ArrowLeft className="w-4 h-4" />Wallet {shortAddr(address)}
      </Link>

      <section className="mt-4 rounded-2xl border border-[var(--border-color)] bg-[var(--role-surface)] overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-6 pt-6">
          <CoinIcon symbol={o.symbol} size={28} />
          <h1 className="text-[22px] font-medium text-[var(--role-content)]">{coin}-USD</h1>
          <span className="text-[13px] px-2.5 py-1 rounded-lg" style={{ color: buy ? 'var(--pos)' : 'var(--neg)', background: buy ? 'rgb(var(--pos-rgb) / 0.12)' : 'rgb(var(--neg-rgb) / 0.12)' }}>{buy ? 'Buy' : 'Sell'}</span>
          <span className="text-[13px] px-2.5 py-1 rounded-lg border border-[var(--border-color)] text-[var(--role-content-muted)] first-letter:uppercase">{typeWord(o.orderType, o.tif)}{o.reduceOnly ? ', reduce only' : ''}</span>
          <span className="ml-auto text-[13px] px-2.5 py-1 rounded-lg bg-[var(--role-surface-raised)] text-[var(--role-content)]">{orderStatus(o.status)}</span>
        </div>

        <div className="px-6 pt-5 pb-6">
          <div className="text-[13px] text-[var(--role-content-muted)]">{o.trigger?.px ? `Trigger ${o.trigger.isAbove ? 'above' : 'below'}` : 'Limit price'}</div>
          <div className="mt-1 text-[34px] sm:text-[40px] leading-tight font-medium tabular-nums tracking-tight text-[var(--role-content)]">{px ? fmtPx(px) : 'Market'}</div>
          <div className="mt-4 flex items-center justify-between text-[13px] tabular-nums">
            <span className="text-[var(--role-content-muted)]">Filled {o.executedSize.toLocaleString('en-US', { maximumFractionDigits: 6 })} of {o.originalSize.toLocaleString('en-US', { maximumFractionDigits: 6 })} {coin}</span>
            <span className="text-[var(--role-content)]">{Math.round(pct * 100)}%</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-[var(--role-surface-raised)] overflow-hidden">
            <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct * 100}%` }} />
          </div>
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 border-t border-[var(--border-color)] text-[14px]">
          {[
            ['Average fill', o.vwap && o.executedSize > 0 ? fmtPx(o.vwap) : '—'],
            ['Size', fmtUsd(o.originalSize * (px || o.vwap))],
            ['Placed', o.timestamp ? `${new Date(o.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'UTC' })} UTC` : '—'],
            ['Fees', fills.length ? `${fees >= 0 ? '+' : '−'}${fmtUsd(Math.abs(fees))}` : '—'],
            ['Order ID', <span key="o" className="font-mono text-[13px]" title={orderId}>{shortAddr(orderId)}</span>],
            ['Fills', String(fills.length)],
          ].map(([k, v], i) => (
            <div key={String(k)} className={`flex items-center justify-between gap-4 px-6 py-3 border-[var(--border-color)] ${i > 0 ? 'border-t' : ''} ${i === 1 ? 'sm:border-t-0' : ''} ${i % 2 === 1 ? 'sm:border-l' : ''}`}>
              <dt className="text-[var(--role-content-muted)]">{k}</dt>
              <dd className="text-right text-[var(--role-content)] tabular-nums min-w-0 truncate">{v}</dd>
            </div>
          ))}
        </dl>

        {fills.length > 0 && (
          <div className="border-t border-[var(--border-color)]">
            <h2 className="px-6 pt-4 pb-2 text-[14px] text-[var(--role-content)]">Fills</h2>
            <div className="max-h-[360px] overflow-y-auto">
              <table className="w-full text-[13px] tabular-nums whitespace-nowrap">
                <tbody>
                  {fills.map((f) => (
                    <tr key={f.tradeId ?? `${f.timestamp}-${f.price}`} className="border-t border-[var(--border-color)]">
                      <td className="pl-6 pr-3 py-2.5 text-[var(--role-content-muted)]">{new Date(f.timestamp).toLocaleTimeString('en-US', { hour12: false, timeZone: 'UTC' })} UTC</td>
                      <td className="px-3 py-2.5 text-right text-[var(--role-content)]">{fmtPx(f.price)}</td>
                      <td className="px-3 py-2.5 text-right text-[var(--role-content)]">{fmtUsd(Math.abs(f.size) * f.price)}</td>
                      <td className="px-3 py-2.5 text-right text-[var(--role-content-muted)]">{f.isMaker ? 'Maker' : 'Taker'}</td>
                      <td className="pl-3 pr-6 py-2.5 text-right">
                        {f.tradeId ? <Link href={`/wallet/${address}/trade/${f.tradeId}`} className="font-mono text-[12px] text-[var(--role-content-muted)] hover:text-[var(--role-content)] hover:underline">{f.tradeId}</Link> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 px-6 py-4 border-t border-[var(--border-color)]">
          <CopyLinkButton path={path} />
          <Link href={`/observe/${address}/${coin}`} className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[13px] border border-[var(--border-color)] text-[var(--role-content)] hover:bg-[var(--role-surface-raised)] transition-colors">
            {coin} position <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
          <span className="ml-auto text-[12px] text-[var(--role-content-subtle)]">Data from BULK</span>
        </div>
      </section>
    </div>
  );
}
