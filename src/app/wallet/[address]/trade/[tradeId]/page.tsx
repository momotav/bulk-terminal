import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { CoinIcon } from '@/components/CoinIcon';
import { CopyLinkButton } from '@/components/CopyLinkButton';
import { ExecChart } from '@/components/ExecChart';
import { TradeContext } from '@/components/TradeContext';
import { fmtPx, fmtUsd, getTrade, lookupTrade, shortAddr, sideWord } from '@/lib/positionShare';
import { LoadRetry } from '@/components/LoadRetry';

export const maxDuration = 30;

// One execution (a fill), shareable by BULK's trade id "<slot>:<sequence>".
// Server-rendered from BULK through our backend; the link unfolds into a card.

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.bulkstats.com';
type Props = { params: { address: string; tradeId: string } };
const ids = (p: Props['params']) => ({ address: decodeURIComponent(p.address), tradeId: decodeURIComponent(p.tradeId) });

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { address, tradeId } = ids(params);
  const f = await getTrade(address, tradeId).catch(() => null);
  const coin = f?.symbol.replace(/-USD$/, '') ?? '';
  const title = f ? `${sideWord(f.isBuy)} ${coin} · ${fmtUsd(Math.abs(f.size) * f.price)} at ${fmtPx(f.price)} · bulkstats` : 'Trade · bulkstats';
  const description = f ? `${shortAddr(address)} ${f.isBuy ? 'bought' : 'sold'} ${coin} on BULK as ${f.isMaker ? 'maker' : 'taker'}. Trade ${tradeId}.` : `Trade ${tradeId} on BULK.`;
  const image = `${SITE}/api/og/exec?k=trade&a=${address}&id=${encodeURIComponent(tradeId)}`;
  const url = `${SITE}/wallet/${address}/trade/${tradeId}`;
  return {
    title, description, alternates: { canonical: url },
    openGraph: { title, description, url, siteName: 'bulkstats', images: [{ url: image, width: 1200, height: 630, alt: title }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

export default async function TradePage({ params }: Props) {
  const { address, tradeId } = ids(params);
  const res = await lookupTrade(address, tradeId);
  if (res.status === 'missing') notFound();
  if (res.status === 'error') {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <Link href={`/wallet/${address}`} className="inline-flex items-center gap-1.5 text-[13px] text-[var(--role-content-muted)] hover:text-[var(--role-content)] transition-colors"><ArrowLeft className="w-4 h-4" />Wallet {shortAddr(address)}</Link>
        <div className="mt-4"><LoadRetry what="trade" /></div>
      </div>
    );
  }
  const f = res.data;
  const coin = f.symbol.replace(/-USD$/, '');
  const value = Math.abs(f.size) * f.price;
  const own = f.isMaker ? f.orderIdMaker : f.orderIdTaker;
  const other = f.isMaker ? f.taker : f.maker;
  const special = f.reasonCode && f.reasonCode !== 'trade' ? ({ liq: 'Liquidation', liq_sweep: 'Liquidation sweep', adl: 'Auto-deleverage' } as Record<string, string>)[f.reasonCode] ?? f.reasonCode : null;
  const when = new Date(f.timestamp);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <Link href={`/wallet/${address}`} className="inline-flex items-center gap-1.5 text-[13px] text-[var(--role-content-muted)] hover:text-[var(--role-content)] transition-colors">
        <ArrowLeft className="w-4 h-4" />Wallet {shortAddr(address)}
      </Link>

      <section className="mt-4 rounded-2xl border border-[var(--border-color)] bg-[var(--role-surface)] overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-6 pt-6">
          <CoinIcon symbol={f.symbol} size={28} />
          <h1 className="text-[22px] font-medium text-[var(--role-content)]">{coin}-USD</h1>
          <span className="text-[13px] px-2.5 py-1 rounded-lg" style={{ color: f.isBuy ? 'var(--pos)' : 'var(--neg)', background: f.isBuy ? 'rgb(var(--pos-rgb) / 0.12)' : 'rgb(var(--neg-rgb) / 0.12)' }}>{sideWord(f.isBuy)}</span>
          <span className="text-[13px] px-2.5 py-1 rounded-lg border border-[var(--border-color)] text-[var(--role-content-muted)]">{f.isMaker ? 'Maker' : 'Taker'}</span>
          {special && <span className="text-[13px] px-2.5 py-1 rounded-lg text-[var(--neg)] bg-[rgb(var(--neg-rgb)/0.12)]">{special}</span>}
          <div className="ml-auto flex items-center gap-2">
            <Link href={`/observe/${address}/${coin}`} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] text-[var(--role-content-muted)] hover:text-[var(--role-content)] hover:bg-[var(--role-surface-raised)] transition-colors">
              Position <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
            <CopyLinkButton path={`/wallet/${address}/trade/${tradeId}`} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] items-center gap-x-6 gap-y-3 px-6 pt-4 pb-5">
          <div>
            <div className="text-[13px] text-[var(--role-content-muted)]">Filled</div>
            <div className="mt-1 text-[34px] sm:text-[40px] leading-tight font-medium tabular-nums tracking-tight text-[var(--role-content)]">{fmtUsd(value)}</div>
            <div className="mt-1 text-[14px] tabular-nums text-[var(--role-content-muted)]">
              {Math.abs(f.size).toLocaleString('en-US', { maximumFractionDigits: 6 })} {coin} at {fmtPx(f.price)}
            </div>
          </div>
          <ExecChart symbol={f.symbol} marks={[{ t: f.timestamp, price: f.price, buy: f.isBuy, size: Math.abs(f.size), coin }]} from={f.timestamp - 25 * 60e3} to={f.timestamp + 25 * 60e3} className="h-[150px] -mr-2" />
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 border-t border-[var(--border-color)] text-[14px]">
          {[
            ['Time', `${when.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'UTC' })} UTC`],
            ['Fee', f.fee ? `${f.fee > 0 ? '+' : '−'}${Math.abs(f.fee) < 0.01 ? `$${Math.abs(f.fee).toPrecision(2)}` : fmtUsd(Math.abs(f.fee))}${f.fee > 0 ? ' rebate' : ''}` : '—'],
            ['Trade ID', <span key="t" className="font-mono text-[13px]">{tradeId}</span>],
            ['Counterparty', other ? <Link key="c" href={`/wallet/${other}`} className="font-mono text-[13px] hover:underline">{shortAddr(other)}</Link> : '—'],
            ['Order', own ? <Link key="o" href={`/wallet/${address}/order/${own}${f.slot ? `?slot=${f.slot}` : ''}`} className="font-mono text-[13px] hover:underline">{shortAddr(own)}</Link> : '—'],
            ['Slot', f.slot ? <span key="s" className="font-mono text-[13px]">{f.slot.toLocaleString('en-US')}</span> : '—'],
          ].map(([k, v], i) => (
            <div key={String(k)} className={`flex items-center justify-between gap-4 px-6 py-3 border-[var(--border-color)] ${i > 0 ? 'border-t' : ''} ${i === 1 ? 'sm:border-t-0' : ''} ${i % 2 === 1 ? 'sm:border-l' : ''}`}>
              <dt className="text-[var(--role-content-muted)]">{k}</dt>
              <dd className="text-right text-[var(--role-content)] tabular-nums min-w-0 truncate">{v}</dd>
            </div>
          ))}
        </dl>

      </section>

      <TradeContext address={address} symbol={f.symbol} tradeId={tradeId} />
    </div>
  );
}
