'use client';

// ---------------------------------------------------------------------------
// PortfolioShareCard
//
// The trade card's sibling for a whole account: a hedged trader's story isn't in
// any one position (the long wins, the short loses), it's in the net. So this
// card draws the wallet's total PnL over a chosen window, the line running up and
// down as it plays, and the legs underneath follow the playhead: a position shows
// up when it was opened, and when it's closed its result flashes and it leaves.
// The last frame settles on the open book (or, with nothing open, what closed).
//
// Same frame, fonts, share options and video export as TradeShareCard. Drawn on a
// canvas so the preview and the downloaded video are the same pixels.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Play, Download, Loader2 } from 'lucide-react';
import { formatNumber, formatCompact, formatAddress, cn } from '@/lib/api';
import { avatarHues, pickMime, roundRect } from '@/components/TradeShareCard';

export interface PortfolioLeg { coin: string; side: 'long' | 'short'; notional: number; pnl: number }
/** One position's life: opened, maybe closed, and its PnL (realized, or unrealized if still open). */
export interface PortfolioTrade { coin: string; side: 'long' | 'short'; notional: number; openedAt: number | null; closedAt: number | null; pnl: number }
export interface PortfolioRange { key: string; label: string; short: string; points: { t: number; v: number }[] }

interface Props {
  address: string;
  ranges: PortfolioRange[];
  initial: string;
  /** Every position: the closed ones and the open ones. */
  trades: PortfolioTrade[];
  /** Margin on the open book right now: what BULK asks for the whole book (its own
   *  figure) against each position on its own (size ÷ its leverage, summed). */
  margin?: { bulk: number; separate: number } | null;
  onClose: () => void;
}

const W = 440, H = 540, SCALE = 2, PAD = 20;
const FONT = "'BULK', ui-sans-serif, -apple-system, \"Segoe UI\", Roboto, sans-serif";
const CHART_Y = 80, CHART_H = 176;
const BODY_Y = 272, BODY_H = 236;
/** How long one play (and the video) runs. */
const LENGTHS = [['short', 'Short', 5000], ['normal', 'Normal', 9000], ['long', 'Long', 16000]] as const;
type Length = (typeof LENGTHS)[number][0];
const HOLD_MS = 2200;
const MAX_LEGS = 4;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const pad2 = (n: number) => String(n).padStart(2, '0');
const fmtDate = (t: number) => { const d = new Date(t); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`; };
const money = (n: number) => `${n >= 0 ? '+' : '−'}$${Math.abs(n) >= 100_000 ? formatCompact(Math.abs(n)) : formatNumber(Math.abs(n), 2)}`;
const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

export function PortfolioShareCard({ address, ranges, initial, trades, margin, onClose }: Props) {
  const open = useMemo(() => trades.filter((t) => t.closedAt == null), [trades]);
  const closed = useMemo(() => trades.filter((t): t is PortfolioTrade & { closedAt: number } => t.closedAt != null), [trades]);
  const [length, setLength] = useState<Length>('normal');
  const playMs = LENGTHS.find(([k]) => k === length)?.[2] ?? 9000;
  const usable = ranges.filter((r) => r.points.length >= 2);
  const [rangeKey, setRangeKey] = useState(usable.some((r) => r.key === initial) ? initial : usable[0]?.key ?? initial);
  const range = ranges.find((r) => r.key === rangeKey) ?? ranges[0];
  const points = range.points;
  const t0 = points[0]?.t ?? Date.now();

  // The legs: what's open now, or with nothing open, what closed in the window,
  // summed per market so a trade cut into pieces reads as one.
  const legs = useMemo(() => {
    if (open.length) {
      return { title: 'Open positions', rows: [...open].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)), net: open.reduce((s, l) => s + l.pnl, 0) };
    }
    const by = new Map<string, PortfolioLeg>();
    for (const c of closed) {
      if (c.closedAt < t0) continue;
      const k = `${c.coin}:${c.side}`;
      const cur = by.get(k) ?? { coin: c.coin, side: c.side, notional: 0, pnl: 0 };
      cur.pnl += c.pnl; by.set(k, cur);
    }
    const rows = Array.from(by.values()).sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
    return { title: 'Closed in this window', rows, net: rows.reduce((s, l) => s + l.pnl, 0) };
  }, [open, closed, t0]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [converting, setConverting] = useState(false);
  const [convertPct, setConvertPct] = useState(0);
  const [hideWallet, setHideWallet] = useState(false);
  const [showRef, setShowRef] = useState(false);
  const [refCode, setRefCode] = useState('');
  const optRef = useRef({ hideWallet, showRef, refCode });
  optRef.current = { hideWallet, showRef, refCode };
  const rafRef = useRef<number | null>(null);
  const holdRef = useRef<number | null>(null);
  const varsRef = useRef<Record<string, string> | null>(null);
  const lastPRef = useRef(1);
  const settleAtRef = useRef(0);
  const lockupLightRef = useRef<HTMLImageElement | null>(null);
  const lockupDarkRef = useRef<HTMLImageElement | null>(null);
  const logosRef = useRef<Record<string, HTMLImageElement>>({});
  const canExport = pickMime() !== '';

  const resolveVars = useCallback(() => {
    const probe = document.createElement('span');
    probe.style.display = 'none';
    document.body.appendChild(probe);
    const get = (expr: string, fb: string) => { probe.style.color = ''; probe.style.color = expr; return getComputedStyle(probe).color || fb; };
    const v = {
      bgBase: get('var(--bg-base)', 'rgb(13,13,16)'), bgMuted: get('var(--bg-muted)', 'rgb(22,22,26)'), border: get('var(--border-color)', 'rgb(42,42,48)'),
      text: get('var(--text-primary)', 'rgb(232,232,234)'), text2: get('var(--text-secondary)', 'rgb(176,176,180)'), text3: get('var(--text-tertiary)', 'rgb(138,138,144)'),
      pos: get('var(--pos)', 'rgb(33,192,122)'), neg: get('var(--neg)', 'rgb(229,72,77)'), accent: get('var(--accent)', 'rgb(255,180,87)'), accentText: get('var(--accent-text)', 'rgb(255,180,87)'),
    };
    document.body.removeChild(probe);
    return v;
  }, []);
  const alpha = (rgb: string, a: number) => rgb.replace(/rgba?\(([^,]+),([^,]+),([^,)]+).*\)/, `rgba($1,$2,$3,${a})`);

  // PnL at a fraction of the window's time span (the line is drawn up to it).
  const valueAt = useCallback((t: number) => {
    if (!points.length) return 0;
    if (t <= points[0].t) return points[0].v;
    if (t >= points[points.length - 1].t) return points[points.length - 1].v;
    let lo = 0, hi = points.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (points[mid].t <= t) lo = mid; else hi = mid; }
    const span = points[hi].t - points[lo].t || 1;
    return points[lo].v + (points[hi].v - points[lo].v) * ((t - points[lo].t) / span);
  }, [points]);

  const draw = useCallback((p: number) => {
    const canvas = canvasRef.current, V = varsRef.current;
    if (!canvas || !V || points.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    lastPRef.current = p;
    const opt = optRef.current;
    const tA = points[0].t, tB = points[points.length - 1].t;
    const headT = tA + (tB - tA) * p;
    const now = valueAt(headT);
    const final = points[points.length - 1].v;
    const tone = now >= 0 ? V.pos : V.neg;

    ctx.save();
    ctx.scale(SCALE, SCALE);
    ctx.clearRect(0, 0, W, H);
    roundRect(ctx, 0, 0, W, H, 22); ctx.fillStyle = V.accent; ctx.fill();
    roundRect(ctx, 3, 3, W - 6, H - 6, 19); ctx.fillStyle = V.bgBase; ctx.fill();

    // header
    const [a1, a2, initials] = avatarHues(opt.hideWallet ? 'bulker' : address);
    const ax = PAD + 24, ay = PAD + 24, ar = 24;
    const g = ctx.createLinearGradient(ax - ar, ay - ar, ax + ar, ay + ar);
    g.addColorStop(0, a1); g.addColorStop(1, a2);
    ctx.beginPath(); ctx.arc(ax, ay, ar, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `600 ${opt.hideWallet ? 17 : 15}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(opt.hideWallet ? 'B' : initials, ax, ay + 1);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = V.text; ctx.font = `600 18px ${FONT}`; ctx.fillText(opt.hideWallet ? 'bulker' : formatAddress(address), PAD + 58, PAD + 18);
    const badge = 'PORTFOLIO';
    ctx.font = `600 11px ${FONT}`;
    const bw = ctx.measureText(badge).width + 16;
    roundRect(ctx, PAD + 58, PAD + 28, bw, 18, 5); ctx.fillStyle = V.accent; ctx.globalAlpha = 0.18; ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = V.accentText; ctx.fillText(badge, PAD + 66, PAD + 41);
    const bgLum = (() => { const m = V.bgBase.match(/\d+/g); if (!m) return 20; const [r, gr, b] = m.slice(0, 3).map(Number); return 0.299 * r + 0.587 * gr + 0.114 * b; })();
    const lockup = bgLum > 140 ? lockupDarkRef.current : lockupLightRef.current;
    if (lockup && lockup.complete && lockup.naturalWidth > 0) {
      const lw = 98, lh = lw * (lockup.naturalHeight / lockup.naturalWidth);
      ctx.drawImage(lockup, W - PAD - lw, PAD - 4, lw, lh);
    }

    // chart: fixed scale over the whole window, zero line dotted, drawn up to the head
    const cx0 = PAD + 4, cw = W - 2 * PAD - 62, cy0 = CHART_Y, ch = CHART_H;
    let lo = Math.min(0, ...points.map((q) => q.v)), hi = Math.max(0, ...points.map((q) => q.v));
    if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
    const padV = (hi - lo) * 0.12; lo -= padV; hi += padV;
    const xOf = (t: number) => cx0 + ((t - tA) / (tB - tA || 1)) * cw;
    const yOf = (v: number) => cy0 + ch - ((v - lo) / (hi - lo)) * ch;
    const zeroY = yOf(0);

    // gridlines + right axis
    ctx.font = `500 10px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    // The top and bottom lines go when they'd crowd the zero line (a window that
    // barely dipped below zero drew "−$388" right on top of "$0").
    for (const v of [hi - padV, 0, lo + padV].filter((v) => v === 0 || Math.abs(yOf(v) - yOf(0)) >= 22)) {
      const y = yOf(v);
      ctx.strokeStyle = alpha(V.border, v === 0 ? 0.9 : 0.5); ctx.lineWidth = 1;
      ctx.setLineDash(v === 0 ? [3, 4] : []);
      ctx.beginPath(); ctx.moveTo(cx0, y); ctx.lineTo(cx0 + cw, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = V.text3; ctx.fillText(v === 0 ? '$0' : `${v > 0 ? '+' : '−'}$${formatCompact(Math.abs(v))}`, cx0 + cw + 8, y);
    }
    ctx.textBaseline = 'alphabetic';

    // the line so far
    const shown = points.filter((q) => q.t <= headT);
    shown.push({ t: headT, v: now });
    const path = new Path2D();
    shown.forEach((q, i) => { const x = xOf(q.t), y = yOf(q.v); if (i === 0) path.moveTo(x, y); else path.lineTo(x, y); });
    const stop = clamp01((zeroY - cy0) / ch);
    // area to zero, green above and red below
    const area = new Path2D(path);
    area.lineTo(xOf(headT), zeroY); area.lineTo(xOf(shown[0].t), zeroY); area.closePath();
    const fillG = ctx.createLinearGradient(0, cy0, 0, cy0 + ch);
    fillG.addColorStop(0, alpha(V.pos, 0.30)); fillG.addColorStop(stop, alpha(V.pos, 0.04));
    fillG.addColorStop(stop, alpha(V.neg, 0.04)); fillG.addColorStop(1, alpha(V.neg, 0.30));
    ctx.fillStyle = fillG; ctx.fill(area);
    const lineG = ctx.createLinearGradient(0, cy0, 0, cy0 + ch);
    lineG.addColorStop(0, V.pos); lineG.addColorStop(stop, V.pos); lineG.addColorStop(stop, V.neg); lineG.addColorStop(1, V.neg);
    ctx.strokeStyle = lineG; ctx.lineWidth = 2.25; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(path);
    // where positions opened (filled) and closed (ring), when there aren't too many to read
    const marks = trades.flatMap((t) => [
      ...(t.openedAt != null && t.openedAt >= tA && t.openedAt <= headT ? [{ t: t.openedAt, side: t.side, open: true }] : []),
      ...(t.closedAt != null && t.closedAt >= tA && t.closedAt <= headT ? [{ t: t.closedAt, side: t.side, open: false }] : []),
    ]);
    if (marks.length && trades.filter((t) => (t.openedAt ?? 0) >= tA || (t.closedAt ?? 0) >= tA).length <= 30) {
      for (const m of marks) {
        const x = xOf(m.t), y = yOf(valueAt(m.t)); const c = m.side === 'long' ? V.pos : V.neg;
        ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        if (m.open) { ctx.fillStyle = c; ctx.fill(); } else { ctx.fillStyle = V.bgBase; ctx.fill(); ctx.strokeStyle = c; ctx.lineWidth = 1.5; ctx.stroke(); }
      }
    }
    // head
    const hx = xOf(headT), hy = yOf(now);
    ctx.beginPath(); ctx.arc(hx, hy, 7, 0, Math.PI * 2); ctx.fillStyle = alpha(tone, 0.22); ctx.fill();
    ctx.beginPath(); ctx.arc(hx, hy, 3.5, 0, Math.PI * 2); ctx.fillStyle = tone; ctx.fill();
    // date under the chart, start and head
    ctx.font = `500 10px ${FONT}`; ctx.fillStyle = V.text3;
    ctx.textAlign = 'left'; ctx.fillText(fmtDate(tA), cx0, cy0 + ch + 14);
    ctx.textAlign = 'right'; ctx.fillText(fmtDate(headT), cx0 + cw, cy0 + ch + 14);

    // body
    const by = BODY_Y, bh = BODY_H;
    roundRect(ctx, PAD, by, W - 2 * PAD, bh, 16); ctx.fillStyle = V.bgMuted; ctx.fill();
    ctx.strokeStyle = V.border; ctx.lineWidth = 1; ctx.stroke();
    // row: range + market logos
    ctx.textAlign = 'left'; ctx.fillStyle = V.text; ctx.font = `500 16px ${FONT}`;
    ctx.fillText(range.label, PAD + 18, by + 30);
    const lw0 = ctx.measureText(range.label).width;
    // Every market traded in the window, not just what's still open.
    const coins = Array.from(new Set(trades
      .filter((t) => (t.openedAt ?? tA) <= tB && (t.closedAt == null || t.closedAt >= tA))
      .sort((a, b) => (a.openedAt ?? 0) - (b.openedAt ?? 0))
      .map((t) => t.coin))).slice(0, 8);
    coins.forEach((c, i) => {
      const img = logosRef.current[c]; const x = PAD + 18 + lw0 + 12 + i * 14, y = by + 15;
      ctx.beginPath(); ctx.arc(x + 9, y + 9, 10, 0, Math.PI * 2); ctx.fillStyle = V.bgMuted; ctx.fill();
      if (img && img.complete) { ctx.save(); ctx.beginPath(); ctx.arc(x + 9, y + 9, 9, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(img, x, y, 18, 18); ctx.restore(); }
      else { ctx.beginPath(); ctx.arc(x + 9, y + 9, 9, 0, Math.PI * 2); ctx.fillStyle = V.border; ctx.fill(); }
    });
    // referral, right side
    const refShown = opt.showRef && opt.refCode.trim().length > 0;
    if (refShown) {
      ctx.textAlign = 'right'; ctx.fillStyle = V.text3; ctx.font = `400 9px ${FONT}`; ctx.fillText('referral code', W - PAD - 16, by + 20);
      let fs = 14, code = opt.refCode.trim(); ctx.font = `500 ${fs}px ${FONT}`;
      while (fs > 10 && ctx.measureText(code).width > 140) { fs -= 1; ctx.font = `500 ${fs}px ${FONT}`; }
      while (code.length > 4 && ctx.measureText(code).width > 140) code = code.slice(0, -2) + '…';
      ctx.fillStyle = V.text; ctx.fillText(code, W - PAD - 16, by + 36);
    }
    // headline: PnL over the window, counting along with the line
    ctx.textAlign = 'left'; ctx.fillStyle = tone; ctx.font = `600 40px ${FONT}`;
    ctx.fillText(money(now), PAD + 18, by + 78);
    ctx.fillStyle = V.text3; ctx.font = `500 12px ${FONT}`;
    ctx.fillText(p >= 1 ? `Net PnL, ${range.short}` : `Net PnL so far`, PAD + 18, by + 98);

    // legs: the live feed while playing, then a hand-off to the settled book. Rows
    // in both glide to their new place and "Open" crossfades into the PnL; rows
    // only in one fade out or in. `st` runs 0→1 over the hand-off.
    const ly = by + 112, lh = bh - 124;
    roundRect(ctx, PAD + 12, ly, W - 2 * PAD - 24, lh, 12); ctx.strokeStyle = V.border; ctx.lineWidth = 1; ctx.stroke();
    const span = tB - tA || 1;
    type Row = { key: string; coin: string; side: 'long' | 'short'; notional: number; pnl: number | null; alpha: number; closedNow: boolean };
    const feedAt = (at: number): { rows: Row[]; title: string } => {
      const fadeIn = span * 0.025, linger = span * 0.08;
      const active = trades
        .filter((t) => (t.openedAt ?? tA) <= at && (t.closedAt == null || t.closedAt > at))
        .sort((a, b) => (b.openedAt ?? tA) - (a.openedAt ?? tA));
      const gone = closed
        .filter((t) => t.closedAt <= at && t.closedAt > at - linger && t.closedAt >= tA)
        .sort((a, b) => b.closedAt - a.closedAt);
      return {
        rows: [
          ...active.map((t) => ({ key: `${t.coin}:${t.side}`, coin: t.coin, side: t.side, notional: t.notional, pnl: null, alpha: clamp01((at - (t.openedAt ?? tA)) / fadeIn), closedNow: false })),
          ...gone.map((t) => ({ key: `${t.coin}:${t.side}:x${t.closedAt}`, coin: t.coin, side: t.side, notional: t.notional, pnl: t.pnl, alpha: 1 - clamp01((at - t.closedAt) / linger) * 0.75, closedNow: true })),
        ],
        title: `POSITIONS · ${active.length} OPEN`,
      };
    };
    // The margin BULK saves on the open book, as the last line once the card settles.
    const saved = margin && open.length > 1 && margin.separate > margin.bulk * 1.01 ? margin.separate - margin.bulk : 0;
    const settledMax = saved > 0 ? MAX_LEGS - 1 : MAX_LEGS;
    const settledRows: Row[] = legs.rows.map((l) => ({ key: `${l.coin}:${l.side}`, coin: l.coin, side: l.side, notional: l.notional, pnl: l.pnl, alpha: 1, closedNow: false }));
    const settledTitle = `${legs.title.toUpperCase()}${legs.rows.length > settledMax ? ` · ${legs.rows.length}` : ''}`;
    const settledRight = legs.rows.length ? `${open.length ? 'OPEN PnL' : 'TOTAL'} ${money(legs.net)}` : '';
    const st = p < 1 ? 0 : clamp01((performance.now() - settleAtRef.current) / 1000);
    // Three beats, so nothing crosses: leavers go, stayers move, newcomers arrive.
    const leave = easeInOut(clamp01(st / 0.3)), move = easeInOut(clamp01((st - 0.25) / 0.45)), arrive = clamp01((st - 0.65) / 0.35);
    const feed = feedAt(p < 1 ? headT : tB);
    const rowH = 20;
    const yRow = (i: number) => ly + 36 + i * rowH;

    // header: crossfade the titles
    ctx.font = `500 10px ${FONT}`; ctx.fillStyle = V.text3;
    if (move < 1) { ctx.globalAlpha = 1 - move; ctx.textAlign = 'left'; ctx.fillText(feed.title, PAD + 26, ly + 17); }
    if (move > 0) {
      ctx.globalAlpha = move; ctx.textAlign = 'left'; ctx.fillText(settledTitle, PAD + 26, ly + 17);
      if (settledRight) { ctx.textAlign = 'right'; ctx.fillText(settledRight, W - PAD - 26, ly + 17); }
    }
    ctx.globalAlpha = 1;

    const drawRow = (l: Row, y: number, a: number, openMix: number) => {
      if (a <= 0.01 || y > ly + lh - 6) return;
      ctx.globalAlpha = a;
      const img = logosRef.current[l.coin];
      if (img && img.complete) { ctx.save(); ctx.beginPath(); ctx.arc(PAD + 33, y - 4, 7.5, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(img, PAD + 25.5, y - 11.5, 15, 15); ctx.restore(); }
      ctx.textAlign = 'left'; ctx.fillStyle = V.text; ctx.font = `500 13px ${FONT}`; ctx.fillText(l.coin, PAD + 47, y);
      const cwid = ctx.measureText(l.coin).width;
      ctx.fillStyle = l.side === 'long' ? V.pos : V.neg; ctx.font = `500 11px ${FONT}`; ctx.fillText(l.side === 'long' ? 'Long' : 'Short', PAD + 47 + cwid + 8, y);
      ctx.textAlign = 'right'; ctx.font = `500 11px ${FONT}`; ctx.fillStyle = V.text3;
      if (l.closedNow) ctx.fillText('Closed', W - PAD - 118, y);
      else if (l.notional > 0) ctx.fillText(`$${formatCompact(l.notional)}`, W - PAD - 118, y);
      // right column: "Open" (with a live dot) fading into the PnL as openMix goes 1→0
      if (openMix > 0.01) {
        ctx.globalAlpha = a * openMix;
        ctx.fillStyle = V.text2; ctx.font = `500 12px ${FONT}`; ctx.fillText('Open', W - PAD - 26, y);
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 220);
        ctx.beginPath(); ctx.arc(W - PAD - 26 - ctx.measureText('Open').width - 8, y - 4, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = alpha(V.accent, 0.4 + 0.6 * pulse); ctx.fill();
      }
      if (l.pnl !== null && openMix < 0.99) {
        ctx.globalAlpha = a * (1 - openMix);
        ctx.fillStyle = l.pnl >= 0 ? V.pos : V.neg; ctx.font = `500 13px ${FONT}`; ctx.fillText(money(l.pnl), W - PAD - 26, y);
      }
      ctx.globalAlpha = 1;
    };

    if (st === 0) {
      feed.rows.slice(0, MAX_LEGS).forEach((l, i) => drawRow(l, yRow(i), l.alpha, l.pnl === null ? 1 : 0));
    } else {
      const fromIdx = new Map(feed.rows.slice(0, MAX_LEGS).map((r, i) => [r.key, i]));
      const toIdx = new Map(settledRows.slice(0, settledMax).map((r, i) => [r.key, i]));
      // leaving: feed rows with no place in the settled list
      feed.rows.slice(0, MAX_LEGS).forEach((r, i) => { if (!toIdx.has(r.key)) drawRow(r, yRow(i) - 6 * leave, r.alpha * (1 - leave), r.pnl === null ? 1 : 0); });
      // staying or arriving
      settledRows.slice(0, settledMax).forEach((r, i) => {
        const fi = fromIdx.get(r.key);
        if (fi !== undefined) drawRow(r, yRow(fi) + (yRow(i) - yRow(fi)) * move, 1, 1 - move);
        else { const a = easeInOut(clamp01(arrive * 1.3 - i * 0.1)); drawRow(r, yRow(i) + 6 * (1 - a), a, 0); }
      });
    }
    if (saved > 0 && margin && arrive > 0) {
      const a = easeInOut(clamp01(arrive * 1.2 - 0.2));
      const y = yRow(settledMax) + 4;
      ctx.globalAlpha = a;
      ctx.strokeStyle = alpha(V.text3, 0.25); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD + 26, y - 15); ctx.lineTo(W - PAD - 26, y - 15); ctx.stroke();
      ctx.textAlign = 'left'; ctx.fillStyle = V.text3; ctx.font = `500 10px ${FONT}`;
      ctx.fillText(`BULK MARGIN $${formatCompact(margin.bulk)} · SEPARATE $${formatCompact(margin.separate)}`, PAD + 26, y);
      ctx.textAlign = 'right'; ctx.fillStyle = V.accent; ctx.font = `500 12px ${FONT}`;
      ctx.fillText(`Saved $${formatCompact(saved)} · ${Math.round((saved / margin.separate) * 100)}%`, W - PAD - 26, y);
      ctx.globalAlpha = 1;
    }
    const emptyNow = st < 0.5 ? feed.rows.length === 0 : settledRows.length === 0;
    if (emptyNow) {
      ctx.textAlign = 'center'; ctx.fillStyle = V.text3; ctx.font = `500 12px ${FONT}`;
      ctx.fillText(st < 0.5 ? 'Nothing open yet' : 'No positions in this window', W / 2, ly + lh / 2 + 6);
    }

    // footer
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = V.text3; ctx.font = `500 13px ${FONT}`;
    ctx.fillText('bulkstats.com', W / 2, (BODY_Y + BODY_H + H) / 2);
    ctx.textBaseline = 'alphabetic';
    void final;
    ctx.restore();
  }, [points, valueAt, address, range.label, range.short, legs, open.length, trades, closed, margin]);

  const play = useCallback((): Promise<void> => new Promise((resolve) => {
    const start = performance.now();
    let settledAt = 0;
    const frame = (t: number) => {
      const e = t - start;
      if (e < playMs) { draw(easeInOut(e / playMs)); rafRef.current = requestAnimationFrame(frame); return; }
      // The last frame's rows come in one after another, then it holds.
      if (!settledAt) { settledAt = t; settleAtRef.current = t; }
      draw(1);
      if (t - settledAt < HOLD_MS) rafRef.current = requestAnimationFrame(frame);
      else resolve();
    };
    rafRef.current = requestAnimationFrame(frame);
  }), [draw, playMs]);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (holdRef.current) clearTimeout(holdRef.current);
    rafRef.current = null; holdRef.current = null;
  }, []);

  // Images: both BULK lockups and every leg's coin logo (same origin, so the canvas stays exportable).
  useEffect(() => {
    const load = (src: string, done: (img: HTMLImageElement) => void) => { const img = new Image(); img.onload = () => { done(img); draw(lastPRef.current); }; img.src = src; };
    load('/bulk-lockup-light.png', (i) => { lockupLightRef.current = i; });
    load('/bulk-lockup-dark.png', (i) => { lockupDarkRef.current = i; });
    for (const c of new Set(trades.map((l) => l.coin))) {
      if (logosRef.current[c]) continue;
      const img = new Image();
      img.onload = () => { logosRef.current[c] = img; draw(lastPRef.current); };
      img.onerror = () => { const png = new Image(); png.onload = () => { logosRef.current[c] = png; draw(lastPRef.current); }; png.src = `/coins/${c}.png`; };
      img.src = `/coins/${c}.svg`;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (Re)start the playback when the window changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || points.length < 2) return;
    canvas.width = W * SCALE; canvas.height = H * SCALE;
    varsRef.current = resolveVars();
    let cancelled = false;
    const go = () => { if (cancelled) return; stop(); draw(0); setPlaying(true); play().then(() => { if (!cancelled) setPlaying(false); }); };
    const fonts = (document as any).fonts;
    if (fonts?.load) Promise.all([fonts.load('500 16px BULK'), fonts.load('600 16px BULK')]).then(go).catch(go); else go();
    return () => { cancelled = true; stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey, length]);

  useEffect(() => { if (!playing && !recording) draw(lastPRef.current); }, [hideWallet, showRef, refCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const replay = () => { if (playing || recording) return; stop(); setPlaying(true); play().then(() => setPlaying(false)); };

  const download = async () => {
    const canvas = canvasRef.current; const mime = pickMime();
    if (!canvas || !mime || recording) return;
    stop(); setRecording(true);
    try {
      draw(0);
      const stream = (canvas as any).captureStream(30) as MediaStream;
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
      const stopped = new Promise<void>((res) => { rec.onstop = () => res(); });
      rec.start(); await play(); rec.stop(); await stopped;
      let out = new Blob(chunks, { type: mime }); let ext = 'webm';
      setRecording(false); setConverting(true); setConvertPct(0);
      try { const { webmToMp4 } = await import('@/lib/webmToMp4'); out = await webmToMp4(out, (r) => setConvertPct(Math.round(r * 100))); ext = 'mp4'; } catch { /* keep the WebM */ }
      finally { setConverting(false); }
      const url = URL.createObjectURL(out);
      const a = document.createElement('a');
      a.href = url; a.download = `bulkstats-portfolio-${range.key}-${new Date().toISOString().slice(0, 10)}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } finally { setRecording(false); setConverting(false); }
  };

  const busy = playing || recording || converting;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !recording) onClose(); }}>
      <div className="relative flex flex-col items-center gap-3">
        <button onClick={onClose} aria-label="Close" className="absolute -top-3 -right-3 z-10 rounded-full border border-[var(--border-color)] bg-[var(--bg-muted)] p-1.5 text-[var(--text-secondary)] shadow-lg transition-colors hover:text-[var(--text-primary)]">
          <X className="h-4 w-4" />
        </button>
        <canvas ref={canvasRef} style={{ width: W, height: H }} className="rounded-[22px] shadow-2xl max-w-[calc(100vw-32px)] h-auto" />

        <div className="flex w-full max-w-[420px] flex-col gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-muted)] px-3.5 py-2.5">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>Window</span>
            <div className="flex items-center gap-0.5 rounded-md bg-[var(--bg-base)] p-0.5">
              {ranges.map((r) => (
                <button key={r.key} type="button" disabled={recording || converting || r.points.length < 2} onClick={() => setRangeKey(r.key)}
                  className={cn('px-2 py-0.5 rounded text-[11px] font-medium transition-colors disabled:opacity-35', r.key === rangeKey ? 'bg-[var(--bg-muted)] text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]')}>
                  {r.key === 'all' ? 'All' : r.key}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>Length</span>
            <div className="flex items-center gap-0.5 rounded-md bg-[var(--bg-base)] p-0.5">
              {LENGTHS.map(([k, label, ms]) => (
                <button key={k} type="button" disabled={recording || converting} onClick={() => setLength(k)} title={`${ms / 1000}s`}
                  className={cn('px-2 py-0.5 rounded text-[11px] font-medium transition-colors disabled:opacity-35', k === length ? 'bg-[var(--bg-muted)] text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]')}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <label className="flex cursor-pointer items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>Hide wallet</span>
            <input type="checkbox" checked={hideWallet} onChange={(e) => setHideWallet(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
          </label>
          <label className="flex cursor-pointer items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>Show referral code</span>
            <input type="checkbox" checked={showRef} onChange={(e) => setShowRef(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
          </label>
          {showRef && (
            <input value={refCode} onChange={(e) => setRefCode(e.target.value)} placeholder="your referral code" maxLength={48}
              className="mt-0.5 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]" />
          )}
        </div>

        <div className="flex items-center gap-2">
          <button onClick={replay} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-muted)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-50">
            <Play className="h-3.5 w-3.5" /> Replay
          </button>
          <button onClick={download} disabled={busy || !canExport} title={canExport ? 'Download as video' : 'Video recording not supported in this browser'} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_28%,transparent)] disabled:opacity-50">
            {recording ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Recording…</>
              : converting ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Converting{convertPct ? ` ${convertPct}%` : ''}…</>
              : <><Download className="h-3.5 w-3.5" /> Download video</>}
          </button>
        </div>
      </div>
    </div>
  );
}
