'use client';

// ---------------------------------------------------------------------------
// TradeShareCard
//
// An animated, downloadable "share this trade" card in the fomo style. The
// whole card is drawn on a <canvas>, so one draw function powers the live
// preview AND a downloadable video (MediaRecorder on the capture stream).
//
// The replay is a smooth LIVE-FEED scroll: candles stream in at the right and
// older ones slide off the left (camera follows the newest bar). The PnL is
// read from the trade's reconstructed PnL curve — it stays flat at $0 until the
// position actually opens, then tracks, then snaps to realized at the close.
// Fill markers (open / add / partial-close / close) fade in and out over ~1s.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Play, Download, Loader2 } from 'lucide-react';
import { analytics, formatNumber, formatCompact, formatAddress, type Candle } from '@/lib/api';
import { getCoinColor } from '@/lib/coins';

export interface ShareCardEvent { t: number; price: number; buy: boolean; action: string; label: string; value: number }
export interface ShareCardData {
  address: string;
  symbol: string;        // "BTC-USD"
  coin: string;          // "BTC"
  side: 'long' | 'short';
  isOpen: boolean;
  openedAt: number;      // ms
  closedAt: number | null;
  avgEntry: number;
  size: number;          // absolute (peak) size
  leverage: number;      // 0 if unknown
  markPrice: number | null;
  exitPrice: number | null;
  pnl: number;           // life.finalPnl (realized for closed)
  events: ShareCardEvent[];        // fills → markers
  pnlCurve: { t: number; pnl: number }[]; // PnL journey over time
}

interface Props { data: ShareCardData; onClose: () => void; }

const W = 440, H = 540, SCALE = 2, PAD = 20;
const FONT = 'ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif';
const VISIBLE = 22;          // candles on screen at once (the scrolling window)
const SECONDS_PER_SCREEN = 3.2; // how long a screenful takes to scroll past
const HOLD_MS = 1100;        // linger on the final frame
const FADE_SEC = 1.0;        // marker fade in/out duration
const LABEL_SEC = 1.3;       // how long a fill's pop-up label stays up
// Chart band + body layout (taller chart, tighter bottom gap).
const CHART_Y = 78, CHART_H = 204;
const BODY_Y = 302, BODY_H = 206;

const IV_SECONDS: [string, number][] = [['1m', 60], ['5m', 300], ['15m', 900], ['1h', 3600], ['4h', 14400], ['1d', 86400]];
// Finest interval that keeps the trade itself under ~70 candles.
function pickInterval(tradeMs: number): [string, number] {
  for (const iv of IV_SECONDS) if (tradeMs / 1000 / iv[1] <= 70) return iv;
  return IV_SECONDS[IV_SECONDS.length - 1];
}

function avatarHues(addr: string): [string, string, string] {
  let h = 7;
  for (const c of addr) h = (h * 31 + c.charCodeAt(0)) | 0;
  const h1 = Math.abs(h) % 360;
  return [`hsl(${h1} 65% 55%)`, `hsl(${(h1 + 48) % 360} 70% 42%)`, addr.replace(/^0x/, '').slice(0, 2).toUpperCase()];
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (typeof (ctx as any).roundRect === 'function') { ctx.beginPath(); (ctx as any).roundRect(x, y, w, h, r); return; }
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function pickMime(): string {
  const cands = ['video/mp4;codecs=h264', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of cands) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* ignore */ } }
  return '';
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function TradeShareCard({ data, onClose }: Props) {
  const { address, symbol, coin, side, isOpen, openedAt, closedAt, avgEntry, size, leverage } = data;
  const signedSize = side === 'long' ? size : -size;
  const notional = size * avgEntry;
  const margin = leverage > 0 ? notional / leverage : notional;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const rafRef = useRef<number | null>(null);
  const holdRef = useRef<number | null>(null);
  const varsRef = useRef<Record<string, string> | null>(null);
  const scaleRef = useRef<{ lo: number; hi: number } | null>(null); // smoothed y-axis

  const canExport = pickMime() !== '';

  // Focused window: lead-in before the entry, the trade, a little after the
  // close (or up to the latest candle for an open trade).
  useEffect(() => {
    let cancelled = false;
    const end = isOpen ? Date.now() : (closedAt ?? openedAt + 3_600_000);
    const [iv, sec] = pickInterval(Math.max(end - openedAt, 20 * 60_000));
    const bar = sec * 1000;
    analytics
      .getCandles(symbol, iv, 500, { startTime: openedAt - bar * 6, endTime: end + bar * 6 })
      .then((res) => { if (!cancelled) setCandles(res.candles.filter((c) => c.o > 0 && c.h > 0 && c.l > 0 && c.c > 0)); })
      .catch(() => { if (!cancelled) setCandles([]); });
    return () => { cancelled = true; };
  }, [symbol, isOpen, openedAt, closedAt]);

  const resolveVars = useCallback(() => {
    const probe = document.createElement('span');
    probe.style.display = 'none';
    document.body.appendChild(probe);
    const get = (expr: string, fb: string) => { probe.style.color = ''; probe.style.color = expr; return getComputedStyle(probe).color || fb; };
    const v = {
      bgBase: get('var(--bg-base)', 'rgb(13,13,16)'),
      bgMuted: get('var(--bg-muted)', 'rgb(22,22,26)'),
      border: get('var(--border-color)', 'rgb(42,42,48)'),
      text: get('var(--text-primary)', 'rgb(232,232,234)'),
      text2: get('var(--text-secondary)', 'rgb(176,176,180)'),
      text3: get('var(--text-tertiary)', 'rgb(138,138,144)'),
      pos: get('var(--pos)', 'rgb(33,192,122)'),
      neg: get('var(--neg)', 'rgb(229,72,77)'),
      accent: get('var(--accent)', 'rgb(255,180,87)'),
      accentText: get('var(--accent-text)', 'rgb(255,180,87)'),
      coin: get(getCoinColor(coin), 'rgb(255,180,87)'),
    };
    document.body.removeChild(probe);
    return v;
  }, [coin]);

  // PnL at a given time, from the reconstructed curve. Flat 0 before the trade
  // opens; clamped to the realized total at/after the close.
  const pnlAt = useCallback((t: number): number => {
    const cv = data.pnlCurve;
    if (!cv.length) return t >= openedAt ? data.pnl : 0;
    if (t <= cv[0].t) return 0;                 // before entry → no position yet
    if (t >= cv[cv.length - 1].t) return cv[cv.length - 1].pnl;
    let lo = 0, hi = cv.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cv[mid].t <= t) lo = mid; else hi = mid; }
    const span = cv[hi].t - cv[lo].t || 1;
    return lerp(cv[lo].pnl, cv[hi].pnl, (t - cv[lo].t) / span);
  }, [data.pnlCurve, data.pnl, openedAt]);

  // Fractional candle index for an arbitrary timestamp (for marker placement).
  const idxAtTime = useCallback((cs: Candle[], t: number): number => {
    if (cs.length === 0) return 0;
    if (t <= cs[0].t) return 0;
    if (t >= cs[cs.length - 1].t) return cs.length - 1;
    let lo = 0, hi = cs.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cs[mid].t <= t) lo = mid; else hi = mid; }
    const span = cs[hi].t - cs[lo].t || 1;
    return lo + (t - cs[lo].t) / span;
  }, []);

  // ---- the single draw function: renders the card at a given scroll head -----
  const draw = useCallback((headF: number) => {
    const canvas = canvasRef.current, cs = candles, V = varsRef.current;
    if (!canvas || !cs || !V) return;
    const ctx = canvas.getContext('2d');
    if (!ctx || cs.length < 2) return;
    const N = cs.length;
    const h = Math.max(0, Math.min(N - 1, headF));
    const intHead = Math.min(N - 1, Math.floor(h));
    const frac = h - intHead;

    ctx.save();
    ctx.scale(SCALE, SCALE);
    ctx.clearRect(0, 0, W, H);
    roundRect(ctx, 0, 0, W, H, 22); ctx.fillStyle = V.accent; ctx.fill();
    roundRect(ctx, 3, 3, W - 6, H - 6, 19); ctx.fillStyle = V.bgBase; ctx.fill();

    // ---- header ----
    const [a1, a2, initials] = avatarHues(address);
    const ax = PAD + 24, ay = PAD + 24, ar = 24;
    const g = ctx.createLinearGradient(ax - ar, ay - ar, ax + ar, ay + ar); g.addColorStop(0, a1); g.addColorStop(1, a2);
    ctx.beginPath(); ctx.arc(ax, ay, ar, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `600 15px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(initials, ax, ay + 1);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = V.text; ctx.font = `600 18px ${FONT}`; ctx.fillText(formatAddress(address), PAD + 58, PAD + 18);
    const badge = isOpen ? 'OPEN' : 'CLOSED';
    ctx.font = `600 11px ${FONT}`;
    const bw = ctx.measureText(badge).width + 16;
    roundRect(ctx, PAD + 58, PAD + 28, bw, 18, 5);
    ctx.fillStyle = isOpen ? V.accent : V.border; ctx.globalAlpha = isOpen ? 0.18 : 0.5; ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = isOpen ? V.accentText : V.text3; ctx.fillText(badge, PAD + 66, PAD + 41);
    const dateStr = new Date(isOpen ? Date.now() : (closedAt ?? openedAt)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    ctx.textAlign = 'right';
    ctx.fillStyle = V.text3; ctx.font = `12px ${FONT}`; ctx.fillText(dateStr, W - PAD, PAD + 14);
    ctx.fillStyle = V.text2; ctx.font = `600 12px ${FONT}`; ctx.fillText('bulkstats', W - PAD, PAD + 33);

    // ---- chart (scrolling feed) ----
    const cx0 = PAD, cy0 = CHART_Y, cw = W - 2 * PAD - 58, ch = CHART_H;
    const px = (p: number) => `$${formatNumber(p, p < 10 ? 4 : p < 1000 ? 2 : 0)}`;
    const step = cw / VISIBLE;
    const headX = cx0 + cw - step * 0.6;          // newest candle sits near the right
    const bodyW = Math.max(2, step * 0.62);
    const camX = (i: number) => headX - (h - i) * step;

    const price = lerp(cs[intHead].c, cs[Math.min(N - 1, intHead + 1)].c, frac);
    const curT = lerp(cs[intHead].t, cs[Math.min(N - 1, intHead + 1)].t, frac);

    // y-scale auto-fits the VISIBLE candles (so they fill the band instead of
    // bunching), smoothed frame-to-frame so it glides rather than jumps.
    const firstIdx = Math.max(0, Math.floor(h) - VISIBLE - 2);
    let vlo = Infinity, vhi = -Infinity;
    for (let i = firstIdx; i <= intHead; i++) { if (cs[i].l < vlo) vlo = cs[i].l; if (cs[i].h > vhi) vhi = cs[i].h; }
    vlo = Math.min(vlo, price); vhi = Math.max(vhi, price);
    const vpad = (vhi - vlo) * 0.12 || Math.max(1, vhi * 0.002);
    const target = { lo: vlo - vpad, hi: vhi + vpad };
    if (!scaleRef.current) scaleRef.current = target;
    else scaleRef.current = { lo: lerp(scaleRef.current.lo, target.lo, 0.18), hi: lerp(scaleRef.current.hi, target.hi, 0.18) };
    const lo = scaleRef.current.lo, hi = scaleRef.current.hi;
    const range = (hi - lo) || 1;
    const yOf = (p: number) => cy0 + (1 - (p - lo) / range) * ch;

    // clip the chart band so candles slide off cleanly at the edges
    ctx.save();
    ctx.beginPath(); ctx.rect(cx0 - 1, cy0 - 6, cw + 2, ch + 12); ctx.clip();

    // avg-entry reference line (muted)
    const yE = yOf(avgEntry);
    ctx.strokeStyle = V.text3; ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.setLineDash([1, 4]);
    ctx.beginPath(); ctx.moveTo(cx0, yE); ctx.lineTo(cx0 + cw, yE); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;

    for (let i = firstIdx; i <= intHead; i++) {
      const x = camX(i);
      if (x < cx0 - step || x > cx0 + cw + step) continue;
      const edge = clamp01((x - cx0) / (step * 1.5));   // fade as it slides off the left
      const c = cs[i];
      const up = c.c >= c.o;
      ctx.globalAlpha = 0.25 + 0.75 * edge;
      ctx.strokeStyle = up ? V.pos : V.neg; ctx.fillStyle = up ? V.pos : V.neg; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, yOf(c.h)); ctx.lineTo(x, yOf(c.l)); ctx.stroke();
      const yO = yOf(c.o), yC = yOf(c.c);
      ctx.fillRect(x - bodyW / 2, Math.min(yO, yC), bodyW, Math.max(1, Math.abs(yC - yO)));
    }
    ctx.globalAlpha = 1;

    // current-price dotted line, tracking the head
    const beforeEntry = curT < (data.pnlCurve[0]?.t ?? openedAt);
    const pnlNow = pnlAt(curT);
    const positive = pnlNow >= 0;
    const tone = beforeEntry ? V.text3 : (positive ? V.pos : V.neg);
    const yC = yOf(price);
    ctx.strokeStyle = tone; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(cx0, yC); ctx.lineTo(headX, yC); ctx.stroke();
    ctx.setLineDash([]);

    // fill markers (fade in over ~1s on reveal, out as they exit left). Also
    // pick the most-recently-revealed fill to show a pop-up label for.
    const candlesPerSec = N / Math.max(2.5, (N / VISIBLE) * SECONDS_PER_SCREEN);
    const fadeBars = Math.max(0.5, candlesPerSec * FADE_SEC);
    const labelBars = Math.max(0.5, candlesPerSec * LABEL_SEC);
    let active: { x: number; my: number; e: ShareCardEvent; op: number } | null = null;
    for (const e of data.events) {
      const eIdx = idxAtTime(cs, e.t);
      if (eIdx > h) continue;                   // not revealed yet
      const x = camX(eIdx);
      if (x < cx0 - step || x > headX + step) continue;
      const since = h - eIdx;
      const appear = clamp01(since / fadeBars);
      const edge = clamp01((x - cx0) / (step * 1.5));
      const op = appear * edge;
      if (op <= 0.02) continue;
      const my = yOf(e.price);
      ctx.globalAlpha = op;
      ctx.beginPath(); ctx.arc(x, my, 8, 0, Math.PI * 2);
      ctx.fillStyle = e.buy ? V.pos : V.neg; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = V.bgBase; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = `700 9px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(e.buy ? 'B' : 'S', x, my + 0.5);
      ctx.textBaseline = 'alphabetic';
      ctx.globalAlpha = 1;
      // the freshest fill still inside its label window owns the pop-up
      if (since <= labelBars && (!active || eIdx > idxAtTime(cs, active.e.t))) {
        // ease in over the first 20%, hold, ease out over the last 30%
        const lop = since < labelBars * 0.2 ? since / (labelBars * 0.2)
          : since > labelBars * 0.7 ? clamp01((labelBars - since) / (labelBars * 0.3)) : 1;
        active = { x, my, e, op: lop * edge };
      }
    }
    ctx.restore(); // end clip

    // price pill (outside the clip, at the right)
    roundRect(ctx, cx0 + cw + 3, yC - 11, 52, 22, 6); ctx.fillStyle = tone; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `600 11px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(px(price), cx0 + cw + 3 + 26, yC + 1); ctx.textBaseline = 'alphabetic';

    // pop-up fill label (speech bubble above the marker): action + $ value
    if (active && active.op > 0.02) {
      const { e, x, my, op } = active;
      const top = (e.label || (e.buy ? 'Buy' : 'Sell')).toUpperCase();
      const val = `${e.buy ? '+' : '−'}$${formatCompact(e.value)}`;
      ctx.font = `600 12px ${FONT}`; const w1 = ctx.measureText(val).width;
      ctx.font = `600 9px ${FONT}`; const w0 = ctx.measureText(top).width;
      const bw = Math.max(w0, w1) + 22, bh = 34;
      let bx = x - bw / 2; bx = Math.max(cx0, Math.min(cx0 + cw - bw, bx));
      const byl = my - 16 - bh;
      ctx.globalAlpha = op;
      roundRect(ctx, bx, byl, bw, bh, 8); ctx.fillStyle = V.bgMuted; ctx.fill();
      ctx.strokeStyle = V.border; ctx.lineWidth = 1; ctx.stroke();
      // caret
      ctx.beginPath(); ctx.moveTo(x - 5, byl + bh); ctx.lineTo(x + 5, byl + bh); ctx.lineTo(x, byl + bh + 6); ctx.closePath();
      ctx.fillStyle = V.bgMuted; ctx.fill();
      ctx.textAlign = 'center';
      ctx.fillStyle = V.text3; ctx.font = `600 9px ${FONT}`; ctx.fillText(top, bx + bw / 2, byl + 13);
      ctx.fillStyle = e.buy ? V.pos : V.neg; ctx.font = `600 12px ${FONT}`; ctx.fillText(val, bx + bw / 2, byl + 27);
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    }

    // time label (head time)
    const fmtT = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    ctx.fillStyle = V.text3; ctx.font = `10px ${FONT}`; ctx.textAlign = 'center';
    ctx.fillText(fmtT(curT), headX, cy0 + ch + 15);

    // ---- body card ----
    const by = BODY_Y, bh = BODY_H;
    roundRect(ctx, PAD, by, W - 2 * PAD, bh, 16); ctx.fillStyle = V.bgMuted; ctx.fill();
    ctx.strokeStyle = V.border; ctx.lineWidth = 1; ctx.stroke();

    // coin row
    const coinY = by + 26;
    ctx.beginPath(); ctx.arc(PAD + 20, coinY, 13, 0, Math.PI * 2); ctx.fillStyle = V.coin; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `700 11px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(coin.slice(0, 1), PAD + 20, coinY + 1);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const pairName = `${coin}/USD`;
    ctx.fillStyle = V.text; ctx.font = `500 18px ${FONT}`; ctx.fillText(pairName, PAD + 40, coinY + 6);
    const coinW = ctx.measureText(pairName).width;
    const sideTxt = `${side.toUpperCase()}${leverage > 0 ? ` ${leverage}×` : ''}`;
    ctx.font = `600 10px ${FONT}`;
    const stw = ctx.measureText(sideTxt).width + 12;
    const badgeX = PAD + 40 + coinW + 10;
    roundRect(ctx, badgeX, coinY - 7, stw, 16, 4);
    ctx.fillStyle = side === 'long' ? V.pos : V.neg; ctx.globalAlpha = 0.15; ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = side === 'long' ? V.pos : V.neg; ctx.fillText(sideTxt, badgeX + 6, coinY + 5);

    // headline PnL (0 before entry) + % — measured so they never overlap
    const pctNow = margin > 0 ? (pnlNow / margin) * 100 : 0;
    const pnlTxt = `${pnlNow >= 0 ? '+' : '−'}$${Math.abs(pnlNow) >= 100000 ? formatCompact(Math.abs(pnlNow)) : formatNumber(Math.abs(pnlNow), 2)}`;
    const pctTxt = `${pnlNow >= 0 ? '▲' : '▼'} ${Math.abs(pctNow).toFixed(2)}%`;
    ctx.fillStyle = tone;
    ctx.font = `600 32px ${FONT}`;
    const pnlW = ctx.measureText(pnlTxt).width;
    ctx.fillText(pnlTxt, PAD + 18, by + 86);
    ctx.font = `500 16px ${FONT}`;
    ctx.fillText(pctTxt, PAD + 18 + pnlW + 12, by + 86);
    ctx.fillStyle = V.text3; ctx.font = `11px ${FONT}`;
    ctx.fillText(isOpen ? 'UNREALIZED PNL' : 'REALIZED PNL', PAD + 18, by + 106);

    // stats
    const gy = by + 124, gh = 62, gw = (W - 2 * PAD - 24) / 3, gx0 = PAD + 12;
    roundRect(ctx, gx0, gy, gw * 3, gh, 12); ctx.strokeStyle = V.border; ctx.lineWidth = 1; ctx.stroke();
    const stats: [string, string][] = [
      ['Invested', `$${formatCompact(margin)}`],
      ['Avg. entry', px(avgEntry)],
      [isOpen ? 'Current' : 'Exit', px(price)],
    ];
    stats.forEach(([label, val], i) => {
      const x = gx0 + gw * i;
      if (i > 0) { ctx.strokeStyle = V.border; ctx.beginPath(); ctx.moveTo(x, gy + 10); ctx.lineTo(x, gy + gh - 10); ctx.stroke(); }
      ctx.textAlign = 'left';
      ctx.fillStyle = V.text3; ctx.font = `11px ${FONT}`; ctx.fillText(label, x + 12, gy + 24);
      ctx.fillStyle = V.text; ctx.font = `500 16px ${FONT}`; ctx.fillText(val, x + 12, gy + 46);
    });

    // footer
    ctx.textAlign = 'left'; ctx.fillStyle = V.text; ctx.font = `600 16px ${FONT}`; ctx.fillText('bulkstats', PAD, H - PAD);
    ctx.textAlign = 'right'; ctx.fillStyle = V.text3; ctx.font = `11px ${FONT}`; ctx.fillText('observe on bulkstats.com', W - PAD, H - PAD);
    ctx.restore();
  }, [candles, address, isOpen, openedAt, closedAt, avgEntry, side, leverage, margin, coin, data.events, data.pnlCurve, data.pnl, pnlAt, idxAtTime]);

  // One smooth replay pass (steady scroll) → resolves after a short end-hold.
  const play = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      const cs = candles;
      if (!cs || cs.length < 2) { draw(cs?.length ? cs.length - 1 : 0); resolve(); return; }
      scaleRef.current = null; // re-init the smoothed y-axis for this pass
      const N = cs.length;
      const screens = N / VISIBLE;
      const dur = Math.max(4500, Math.min(11000, screens * SECONDS_PER_SCREEN * 1000));
      const t0 = performance.now();
      const frame = (t: number) => {
        const e = t - t0;
        if (e < dur) {
          draw((e / dur) * (N - 1)); // linear → steady live-feed scroll
          rafRef.current = requestAnimationFrame(frame);
        } else {
          draw(N - 1);
          holdRef.current = window.setTimeout(resolve, HOLD_MS);
        }
      };
      rafRef.current = requestAnimationFrame(frame);
    });
  }, [candles, draw]);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (holdRef.current) clearTimeout(holdRef.current);
    rafRef.current = null; holdRef.current = null;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !candles) return;
    canvas.width = W * SCALE; canvas.height = H * SCALE;
    varsRef.current = resolveVars();
    scaleRef.current = null;
    draw(0);
    if (candles.length >= 2) { setPlaying(true); play().then(() => setPlaying(false)); }
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles]);

  const replay = () => { if (playing || recording) return; stop(); setPlaying(true); play().then(() => setPlaying(false)); };

  const download = async () => {
    const canvas = canvasRef.current;
    const mime = pickMime();
    if (!canvas || !mime || recording) return;
    stop(); setRecording(true);
    try {
      draw(0);
      const stream = (canvas as any).captureStream(30) as MediaStream;
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
      const stopped = new Promise<void>((res) => { rec.onstop = () => res(); });
      rec.start();
      await play();
      rec.stop();
      await stopped;
      const blob = new Blob(chunks, { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ext = mime.includes('mp4') ? 'mp4' : 'webm';
      a.href = url; a.download = `bulkstats-${coin}-${new Date(isOpen ? Date.now() : (closedAt ?? openedAt)).toISOString().slice(0, 10)}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } finally { setRecording(false); }
  };

  const busy = playing || recording;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !recording) onClose(); }}
    >
      <div className="relative flex flex-col items-center gap-3">
        <button onClick={onClose} aria-label="Close" className="absolute -top-3 -right-3 z-10 rounded-full border border-[var(--border-color)] bg-[var(--bg-muted)] p-1.5 text-[var(--text-secondary)] shadow-lg transition-colors hover:text-[var(--text-primary)]">
          <X className="h-4 w-4" />
        </button>
        <canvas ref={canvasRef} style={{ width: W, height: H }} className="rounded-[22px] shadow-2xl" />
        {!candles && <div className="absolute inset-0 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--role-content-subtle)]" /></div>}
        <div className="flex items-center gap-2">
          <button onClick={replay} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-muted)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-50">
            <Play className="h-3.5 w-3.5" /> Replay
          </button>
          <button onClick={download} disabled={busy || !canExport} title={canExport ? 'Download as video' : 'Video recording not supported in this browser'} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-text)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_25%,transparent)] disabled:opacity-50">
            {recording ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Recording…</> : <><Download className="h-3.5 w-3.5" /> Download video</>}
          </button>
        </div>
      </div>
    </div>
  );
}
