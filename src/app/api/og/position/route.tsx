import { ImageResponse } from 'next/og';
import { fmtPx, fmtUsd as fmtUsdU, held, priceLine, resolvePosition, shortAddr } from '@/lib/positionShare';

// The BULK font has no U+2212 minus; a missing glyph drops to a fallback font with taller
// lines, which pushes the whole card down. Plain hyphens only in the image.
const fmtUsd = (n: number, signed = false) => fmtUsdU(n, signed).replace(/\u2212/g, '-');

// The preview image for a shared position link (what X, Telegram and Discord show
// when /observe/<wallet>/<coin> is pasted). 1200×630, drawn from live BULK data.

export const runtime = 'edge';

const C = { bg: '#14130F', panel: '#1C1B16', line: '#2E2C24', text: '#F2ECD8', muted: '#9A9282', pos: '#3DBF84', neg: '#E5484D', gold: '#F3B65B' };

export async function GET(req: Request) {
  const u = new URL(req.url);
  const address = u.searchParams.get('a') ?? '';
  const coin = (u.searchParams.get('c') ?? '').toUpperCase();
  const from = Number(u.searchParams.get('from')) || 0;
  const to = Number(u.searchParams.get('to')) || 0;

  const [pos, medium, regular] = await Promise.all([
    address && coin ? resolvePosition(address, coin, from, to) : Promise.resolve(null),
    fetch(new URL('/fonts/BULK-Medium.otf', u.origin)).then((r) => r.arrayBuffer()).catch(() => null),
    fetch(new URL('/fonts/BULK-Regular.otf', u.origin)).then((r) => r.arrayBuffer()).catch(() => null),
  ]);
  const fonts = [
    ...(regular ? [{ name: 'BULK', data: regular, weight: 400 as const }] : []),
    ...(medium ? [{ name: 'BULK', data: medium, weight: 500 as const }] : []),
  ];
  const icon = `${u.origin}/coins/${coin}.svg`;

  if (!pos) {
    return new ImageResponse(
      (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 80, background: C.bg, color: C.text, fontFamily: 'BULK' }}>
          <div style={{ fontSize: 30, color: C.muted, letterSpacing: 6 }}>BULKSTATS</div>
          <div style={{ fontSize: 76, marginTop: 24 }}>{coin ? `${coin}-USD position` : 'Position'}</div>
          <div style={{ fontSize: 32, color: C.muted, marginTop: 16 }}>{`${address ? `${shortAddr(address)} · ` : ''}every fill, replayed on bulkstats`}</div>
        </div>
      ),
      { width: 1200, height: 630, fonts, headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60' } },
    );
  }

  const up = pos.pnl >= 0;
  const pc = up ? C.pos : C.neg;
  const end = pos.closedAt ?? Date.now();
  const start = pos.openedAt ?? end - 86_400_000;
  const line = await priceLine(pos.coin, start, end);

  // Price line as an SVG path, entry level dashed.
  const W = 1040, H = 170;
  let path = '', entryY = H / 2, lastXY: [number, number] | null = null;
  if (line.length > 1) {
    const lo = Math.min(...line, pos.entry), hi = Math.max(...line, pos.entry);
    const y = (v: number) => H - 8 - ((v - lo) / (hi - lo || 1)) * (H - 16);
    path = line.map((v, i) => `${i ? 'L' : 'M'}${((i / (line.length - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    entryY = y(pos.entry);
    lastXY = [W, y(line[line.length - 1])];
  }
  const statusLabel = pos.status === 'open' ? 'Open' : pos.status === 'liquidated' ? 'Liquidated' : 'Closed';
  const sideLabel = `${pos.side === 'long' ? 'Long' : 'Short'}${pos.leverage ? ` ${Math.round(pos.leverage)}x` : ''}`;
  const duration = pos.openedAt ? held(end - pos.openedAt) : null;

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: '56px 80px 48px', background: C.bg, color: C.text, fontFamily: 'BULK' }}>
        {/* Header: market, side, status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={icon} width={56} height={56} style={{ borderRadius: 12 }} alt="" />
          <div style={{ display: 'flex', fontSize: 44, fontWeight: 500 }}>{`${pos.coin}-USD`}</div>
          <div style={{ display: 'flex', fontSize: 28, padding: '6px 16px', borderRadius: 10, color: pos.side === 'long' ? C.pos : C.neg, background: pos.side === 'long' ? 'rgba(61,191,132,0.14)' : 'rgba(229,72,77,0.14)' }}>{sideLabel}</div>
          <div style={{ display: 'flex', fontSize: 26, padding: '6px 16px', borderRadius: 10, color: C.muted, border: `2px solid ${C.line}` }}>{statusLabel}</div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 26, color: C.muted, letterSpacing: 5 }}>BULKSTATS</div>
        </div>

        {/* PnL */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24, marginTop: 30 }}>
          <div style={{ fontSize: 112, fontWeight: 500, lineHeight: 1, color: pc, letterSpacing: -2 }}>{fmtUsd(pos.pnl, true)}</div>
          <div style={{ display: 'flex', flexDirection: 'column', fontSize: 28, color: C.muted, paddingBottom: 10 }}>
            <span style={{ color: pc }}>{`${pos.movePct >= 0 ? '+' : '-'}${Math.abs(pos.movePct).toFixed(2)}% price move`}</span>
            <span>{`${pos.status === 'open' ? 'Unrealized PnL' : 'Realized PnL, after fees'}${duration ? ` · held ${duration}` : ''}`}</span>
          </div>
        </div>

        {/* Price over the trade */}
        <div style={{ display: 'flex', marginTop: 26, height: H, position: 'relative' }}>
          {path ? (
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
              <line x1={0} x2={W} y1={entryY} y2={entryY} stroke={C.muted} strokeWidth={2} strokeDasharray="8 8" opacity={0.6} />
              <path d={path} fill="none" stroke={pc} strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
              {lastXY && <circle cx={lastXY[0] - 6} cy={lastXY[1]} r={9} fill={pc} />}
            </svg>
          ) : <div style={{ display: 'flex', flex: 1, borderTop: `2px dashed ${C.line}` }} />}
        </div>

        {/* Facts */}
        <div style={{ display: 'flex', marginTop: 'auto', paddingTop: 22, borderTop: `2px solid ${C.line}`, fontSize: 28 }}>
          {[
            ['Entry', fmtPx(pos.entry)],
            [pos.status === 'open' ? 'Mark' : 'Exit', fmtPx(pos.last)],
            ['Size', fmtUsd(pos.sizeUsd)],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', flexDirection: 'column', marginRight: 64 }}>
              <span style={{ color: C.muted, fontSize: 22 }}>{k}</span>
              <span style={{ marginTop: 4 }}>{v}</span>
            </div>
          ))}
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <span style={{ color: C.muted, fontSize: 22 }}>Wallet</span>
            <span style={{ marginTop: 4 }}>{shortAddr(address)}</span>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200, height: 630, fonts,
      // An open position moves; a closed one never changes.
      headers: { 'Cache-Control': pos.status === 'open' ? 'public, max-age=60, s-maxage=120' : 'public, max-age=86400, s-maxage=604800' },
    },
  );
}
