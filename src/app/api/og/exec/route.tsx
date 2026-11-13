import { ImageResponse } from 'next/og';
import { fmtPx as fmtPxU, fmtUsd as fmtUsdU, getOrder, getTrade, orderStatus, shortAddr } from '@/lib/positionShare';

// Preview image for a shared trade (?k=trade&id=<slot:seq>) or order (?k=order&id=<orderId>).
// Same look as the position card. Plain hyphens only: the BULK font has no U+2212.

export const runtime = 'edge';

const C = { bg: '#14130F', line: '#2E2C24', text: '#F2ECD8', muted: '#9A9282', pos: '#3DBF84', neg: '#E5484D', gold: '#F3B65B' };
const ascii = (s: string) => s.replace(/−/g, '-');
const fmtUsd = (n: number, signed = false) => ascii(fmtUsdU(n, signed));
const fmtPx = (n: number) => ascii(fmtPxU(n));

export async function GET(req: Request) {
  const u = new URL(req.url);
  const kind = u.searchParams.get('k') === 'order' ? 'order' : 'trade';
  const address = u.searchParams.get('a') ?? '';
  const id = u.searchParams.get('id') ?? '';
  const slot = Number(u.searchParams.get('slot')) || 0;

  const [data, medium, regular] = await Promise.all([
    kind === 'trade' ? getTrade(address, id).then((f) => (f ? { f } : null)) : getOrder(address, id, slot).then((r) => (r ? { o: r } : null)),
    fetch(new URL('/fonts/BULK-Medium.otf', u.origin)).then((r) => r.arrayBuffer()).catch(() => null),
    fetch(new URL('/fonts/BULK-Regular.otf', u.origin)).then((r) => r.arrayBuffer()).catch(() => null),
  ]).catch(() => [null, null, null] as const);
  const fonts = [
    ...(regular ? [{ name: 'BULK', data: regular, weight: 400 as const }] : []),
    ...(medium ? [{ name: 'BULK', data: medium, weight: 500 as const }] : []),
  ];

  let priceLabel = 'Filled';
  let symbol = '', buy = true, badge = '', big = '', sub = '', facts: [string, string][] = [], progress: number | null = null, idLabel = '';
  if (data && 'f' in data && data.f) {
    const f = data.f;
    symbol = f.symbol; buy = f.isBuy;
    badge = f.isMaker ? 'Maker' : 'Taker';
    big = fmtUsd(Math.abs(f.size) * f.price);
    sub = `${Math.abs(f.size).toLocaleString('en-US', { maximumFractionDigits: 4 })} ${f.symbol.replace(/-USD$/, '')} at ${fmtPx(f.price)}`;
    facts = [['Fee', f.fee ? `${f.fee > 0 ? '+' : '-'}${fmtUsd(Math.abs(f.fee))}` : '-'], ['Time', `${new Date(f.timestamp).toISOString().slice(0, 16).replace('T', ' ')} UTC`]];
    idLabel = `Trade ${id}`;
  } else if (data && 'o' in data && data.o) {
    const o = data.o.order;
    symbol = o.symbol; buy = o.side.toLowerCase().startsWith('b');
    badge = orderStatus(o.status);
    const px = o.trigger?.px ?? o.price;
    big = px ? fmtPx(px) : 'Market';
    const type = o.orderType.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase() || 'order';
    sub = `${type[0].toUpperCase()}${type.slice(1)}${o.reduceOnly ? ', reduce only' : ''} · ${fmtUsd(o.originalSize * (px || o.vwap))}`;
    priceLabel = o.trigger?.px ? `Trigger ${o.trigger.isAbove ? 'above' : 'below'}` : 'Limit price';
    progress = o.originalSize > 0 ? Math.min(1, o.executedSize / o.originalSize) : 0;
    facts = [['Average fill', o.vwap && o.executedSize > 0 ? fmtPx(o.vwap) : '-'], ['Fills', String(data.o.fills.length)]];
    idLabel = `Order ${shortAddr(id)}`;
  }
  const coin = symbol.replace(/-USD$/, '');
  const sc = buy ? C.pos : C.neg;

  return new ImageResponse(
    !symbol ? (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 80, background: C.bg, color: C.text, fontFamily: 'BULK' }}>
        <div style={{ display: 'flex', fontSize: 30, color: C.muted, letterSpacing: 6 }}>BULKSTATS</div>
        <div style={{ display: 'flex', fontSize: 76, marginTop: 24 }}>{kind === 'order' ? 'Order on BULK' : 'Trade on BULK'}</div>
        <div style={{ display: 'flex', fontSize: 32, color: C.muted, marginTop: 16 }}>{address ? shortAddr(address) : ''}</div>
      </div>
    ) : (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: '56px 80px 48px', background: C.bg, color: C.text, fontFamily: 'BULK' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${u.origin}/coins/${coin}.svg`} width={56} height={56} style={{ borderRadius: 12 }} alt="" />
          <div style={{ display: 'flex', fontSize: 44, fontWeight: 500 }}>{`${coin}-USD`}</div>
          <div style={{ display: 'flex', fontSize: 28, padding: '6px 16px', borderRadius: 10, color: sc, background: buy ? 'rgba(61,191,132,0.14)' : 'rgba(229,72,77,0.14)' }}>{buy ? 'Buy' : 'Sell'}</div>
          <div style={{ display: 'flex', fontSize: 26, padding: '6px 16px', borderRadius: 10, color: C.muted, border: `2px solid ${C.line}` }}>{badge}</div>
          <div style={{ display: 'flex', flex: 1 }} />
          <div style={{ display: 'flex', fontSize: 26, color: C.muted, letterSpacing: 5 }}>BULKSTATS</div>
        </div>

        <div style={{ display: 'flex', fontSize: 26, color: C.muted, marginTop: 44 }}>{priceLabel}</div>
        <div style={{ display: 'flex', fontSize: 112, fontWeight: 500, lineHeight: 1, marginTop: 8, letterSpacing: -2 }}>{big}</div>
        <div style={{ display: 'flex', fontSize: 30, color: C.muted, marginTop: 14 }}>{sub}</div>

        {progress !== null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 30 }}>
            <div style={{ display: 'flex', flex: 1, height: 14, borderRadius: 7, background: C.line }}>
              <div style={{ display: 'flex', width: `${Math.max(progress * 100, progress > 0 ? 1.5 : 0)}%`, height: 14, borderRadius: 7, background: C.gold }} />
            </div>
            <div style={{ display: 'flex', fontSize: 28 }}>{`${Math.round(progress * 100)}% filled`}</div>
          </div>
        )}

        <div style={{ display: 'flex', marginTop: 'auto', paddingTop: 22, borderTop: `2px solid ${C.line}`, fontSize: 28 }}>
          {facts.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', flexDirection: 'column', marginRight: 64 }}>
              <span style={{ color: C.muted, fontSize: 22 }}>{k}</span>
              <span style={{ marginTop: 4 }}>{v}</span>
            </div>
          ))}
          <div style={{ display: 'flex', flex: 1 }} />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <span style={{ color: C.muted, fontSize: 22 }}>{idLabel}</span>
            <span style={{ marginTop: 4 }}>{shortAddr(address)}</span>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, fonts, headers: { 'Cache-Control': kind === 'trade' ? 'public, max-age=86400, s-maxage=604800' : 'public, max-age=60, s-maxage=300' } },
  );
}
