'use client';

// ---------------------------------------------------------------------------
// TradeShareCard
//
// An animated, downloadable "share this trade" card in the fomo style. The
// whole card is drawn on a <canvas> so the exact same draw function powers:
//   1. the live preview (auto-replays the candles fast, PnL ticking along), and
//   2. a downloadable video (MediaRecorder on the canvas capture stream).
//
// The replay shows a few candles before the entry, the trade itself, and a few
// candles after the close (or up to the latest candle for an open trade), with
// a status-aware headline PnL (unrealized journey → realized for closed).
// All reconstructed client-side from the data the observe page already has.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Play, Download, Loader2 } from 'lucide-react';
import { analytics, formatNumber, formatCompact, formatAddress, type Candle } from '@/lib/api';
import { getCoinColor } from '@/lib/coins';

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
}

interface Props { data: ShareCardData; onClose: () => void; }

// Logical card size; the backing canvas is this × SCALE for a crisp, shareable
// video (880×1240).
const W = 440, H = 620, SCALE = 2, PAD = 20;
const FONT = 'ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif';
const MS_PER_CANDLE = 90;   // replay speed
const HOLD_MS = 800;        // linger on the final frame

const IV_SECONDS: [string, number][] = [['1m', 60], ['5m', 300], ['15m', 900], ['1h', 3600], ['4h', 14400], ['1d', 86400]];
// Pick an interval so the trade itself spans ~16 candles.
function pickInterval(tradeMs: number): [string, number] {
  const target = tradeMs / 1000 / 16;
  for (const iv of IV_SECONDS) if (iv[1] >= target) return iv;
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
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function pickMime(): string {
  const cands = ['video/mp4;codecs=h264', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of cands) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* ignore */ } }
  return '';
}

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

  const canExport = pickMime() !== '';

  // Tight candle window: ~6 candles before the open, the trade, ~6 after the
  // close (or up to the latest candle for an open trade).
  useEffect(() => {
    let cancelled = false;
    const end = isOpen ? Date.now() : (closedAt ?? openedAt + 3_600_000);
    const [iv, sec] = pickInterval(Math.max(end - openedAt, 20 * 60_000));
    const bar = sec * 1000;
    const start = openedAt - bar * 6;
    analytics
      .getCandles(symbol, iv, 500, { startTime: start, endTime: end + bar * 6 })
      .then((res) => { if (!cancelled) setCandles(res.candles.filter((c) => c.o > 0 && c.h > 0 && c.l > 0 && c.c > 0)); })
      .catch(() => { if (!cancelled) setCandles([]); });
    return () => { cancelled = true; };
  }, [symbol, isOpen, openedAt, closedAt]);

  // Resolve the active palette's CSS vars to concrete colours once (canvas can't
  // parse var()).
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

  // Draw the whole card at a given reveal (number of candles shown).
  const draw = useCallback((reveal: number) => {
    const canvas = canvasRef.current;
    const cs = candles;
    const V = varsRef.current;
    if (!canvas || !cs || !V) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const N = cs.length;
    const k = Math.max(1, Math.min(N, Math.round(reveal)));

    ctx.save();
    ctx.scale(SCALE, SCALE);
    ctx.clearRect(0, 0, W, H);

    // Frame + card bg.
    roundRect(ctx, 0, 0, W, H, 22); ctx.fillStyle = V.accent; ctx.fill();
    roundRect(ctx, 3, 3, W - 6, H - 6, 19); ctx.fillStyle = V.bgBase; ctx.fill();

    // ---- Header ----
    const [a1, a2, initials] = avatarHues(address);
    const ax = PAD + 24, ay = PAD + 24, ar = 24;
    const g = ctx.createLinearGradient(ax - ar, ay - ar, ax + ar, ay + ar);
    g.addColorStop(0, a1); g.addColorStop(1, a2);
    ctx.beginPath(); ctx.arc(ax, ay, ar, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `600 15px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(initials, ax, ay + 1);

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = V.text; ctx.font = `600 18px ${FONT}`;
    ctx.fillText(formatAddress(address), PAD + 58, PAD + 18);

    // status badge
    const badge = isOpen ? 'OPEN' : 'CLOSED';
    ctx.font = `600 11px ${FONT}`;
    const bw = ctx.measureText(badge).width + 16;
    roundRect(ctx, PAD + 58, PAD + 28, bw, 18, 5);
    ctx.fillStyle = isOpen ? V.accent : V.border; ctx.globalAlpha = isOpen ? 0.18 : 0.5; ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = isOpen ? V.accentText : V.text3;
    ctx.fillText(badge, PAD + 58 + 8, PAD + 41);

    // date + brand (right)
    const dateStr = new Date(isOpen ? Date.now() : (closedAt ?? openedAt)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    ctx.textAlign = 'right';
    ctx.fillStyle = V.text3; ctx.font = `12px ${FONT}`; ctx.fillText(dateStr, W - PAD, PAD + 14);
    ctx.fillStyle = V.text2; ctx.font = `600 12px ${FONT}`; ctx.fillText('bulkstats', W - PAD, PAD + 33);

    // ---- Chart ----
    const cx0 = PAD, cy0 = 88, cw = W - 2 * PAD - 60, ch = 150;
    const px = (p: number) => `$${formatNumber(p, p < 10 ? 4 : p < 1000 ? 2 : 0)}`;
    // price / pnl at this reveal
    const atEnd = k >= N;
    const lastClose = cs[k - 1].c;
    const price = (!isOpen && atEnd) ? (data.exitPrice ?? lastClose) : lastClose;
    const pnl = (!isOpen && atEnd) ? data.pnl : signedSize * (price - avgEntry);
    const pct = margin > 0 ? (pnl / margin) * 100 : 0;
    const positive = pnl >= 0;
    const tone = positive ? V.pos : V.neg;

    // scale over the FULL window so candles fill a fixed frame left→right
    const lo = Math.min(...cs.map((c) => c.l), price);
    const hi = Math.max(...cs.map((c) => c.h), price);
    const range = (hi - lo) || 1;
    const yOf = (p: number) => cy0 + (1 - (p - lo) / range) * ch;
    const step = cw / N;
    const bodyW = Math.max(2, Math.min(11, step * 0.6));
    for (let i = 0; i < k; i++) {
      const c = cs[i];
      const cxx = cx0 + i * step + step / 2;
      const up = c.c >= c.o;
      ctx.strokeStyle = up ? V.pos : V.neg; ctx.fillStyle = up ? V.pos : V.neg; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cxx, yOf(c.h)); ctx.lineTo(cxx, yOf(c.l)); ctx.stroke();
      const yO = yOf(c.o), yC = yOf(c.c);
      ctx.fillRect(cxx - bodyW / 2, Math.min(yO, yC), bodyW, Math.max(1, Math.abs(yC - yO)));
    }
    // current-price dotted line + pill at the last revealed candle
    const yC = yOf(price);
    ctx.save();
    ctx.strokeStyle = tone; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(cx0, yC); ctx.lineTo(cx0 + cw, yC); ctx.stroke();
    ctx.restore();
    roundRect(ctx, cx0 + cw + 3, yC - 11, 54, 22, 6); ctx.fillStyle = tone; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `600 11px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(px(price), cx0 + cw + 3 + 27, yC + 1);
    ctx.textBaseline = 'alphabetic';
    // sparse time labels
    const fmtT = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    ctx.fillStyle = V.text3; ctx.font = `10px ${FONT}`; ctx.textAlign = 'left';
    ctx.fillText(fmtT(cs[0].t), cx0 + 2, cy0 + ch + 16);
    ctx.textAlign = 'center'; ctx.fillText(fmtT(cs[Math.floor(N / 2)].t), cx0 + cw / 2, cy0 + ch + 16);

    // ---- Body card ----
    const by = 268, bh = 212;
    roundRect(ctx, PAD, by, W - 2 * PAD, bh, 16); ctx.fillStyle = V.bgMuted; ctx.fill();
    ctx.strokeStyle = V.border; ctx.lineWidth = 1; ctx.stroke();

    // coin row
    const coinY = by + 26;
    ctx.beginPath(); ctx.arc(PAD + 20, coinY, 13, 0, Math.PI * 2); ctx.fillStyle = V.coin; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `700 11px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(coin.slice(0, 1), PAD + 20, coinY + 1);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = V.text; ctx.font = `500 18px ${FONT}`; ctx.fillText(coin, PAD + 40, coinY + 6);
    const coinW = ctx.measureText(coin).width;
    const sideTxt = `${side.toUpperCase()}${leverage > 0 ? ` ${leverage}×` : ''}`;
    ctx.font = `600 10px ${FONT}`;
    const stw = ctx.measureText(sideTxt).width + 12;
    const badgeX = PAD + 40 + coinW + 10;
    roundRect(ctx, badgeX, coinY - 7, stw, 16, 4);
    ctx.fillStyle = side === 'long' ? V.pos : V.neg; ctx.globalAlpha = 0.15; ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = side === 'long' ? V.pos : V.neg; ctx.fillText(sideTxt, badgeX + 6, coinY + 5);

    // headline PnL
    ctx.fillStyle = tone; ctx.font = `600 34px ${FONT}`;
    const pnlTxt = `${positive ? '+' : '−'}$${formatNumber(Math.abs(pnl), 2)}`;
    ctx.fillText(pnlTxt, PAD + 18, by + 86);
    ctx.font = `500 17px ${FONT}`;
    const pw = ctx.measureText(pnlTxt).width;
    ctx.fillText(`${positive ? '▲' : '▼'} ${Math.abs(pct).toFixed(2)}%`, PAD + 18 + pw + 10, by + 86);
    ctx.fillStyle = V.text3; ctx.font = `11px ${FONT}`;
    ctx.fillText(isOpen ? 'UNREALIZED PNL' : 'REALIZED PNL', PAD + 18, by + 106);

    // stats grid
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

    // ---- Footer ----
    ctx.textAlign = 'left'; ctx.fillStyle = V.text; ctx.font = `600 16px ${FONT}`;
    ctx.fillText('bulkstats', PAD, H - PAD);
    ctx.textAlign = 'right'; ctx.fillStyle = V.text3; ctx.font = `11px ${FONT}`;
    ctx.fillText('observe on bulkstats.com', W - PAD, H - PAD);

    ctx.restore();
  }, [candles, address, isOpen, openedAt, closedAt, avgEntry, side, leverage, signedSize, margin, coin, data.exitPrice, data.pnl]);

  // Run one replay pass (0→N + hold). Returns a promise that resolves when done.
  const play = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      const cs = candles;
      if (!cs || cs.length < 2) { draw(cs?.length ?? 1); resolve(); return; }
      const N = cs.length;
      const dur = Math.max(1500, N * MS_PER_CANDLE);
      const t0 = performance.now();
      const frame = (t: number) => {
        const e = t - t0;
        if (e < dur) {
          draw(Math.max(1, Math.min(N, Math.ceil((e / dur) * N))));
          rafRef.current = requestAnimationFrame(frame);
        } else {
          draw(N);
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

  // Size the canvas, resolve colours, draw the first frame, auto-play once.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !candles) return;
    canvas.width = W * SCALE; canvas.height = H * SCALE;
    varsRef.current = resolveVars();
    draw(1);
    if (candles.length >= 2) {
      setPlaying(true);
      play().then(() => setPlaying(false));
    }
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles]);

  const replay = () => {
    if (playing || recording) return;
    stop(); setPlaying(true);
    play().then(() => setPlaying(false));
  };

  const download = async () => {
    const canvas = canvasRef.current;
    const mime = pickMime();
    if (!canvas || !mime || recording) return;
    stop();
    setRecording(true);
    try {
      draw(1);
      const stream = (canvas as any).captureStream(30) as MediaStream;
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const stopped = new Promise<void>((res) => { rec.onstop = () => res(); });
      rec.start();
      await play();
      rec.stop();
      await stopped;
      const blob = new Blob(chunks, { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ext = mime.includes('mp4') ? 'mp4' : 'webm';
      a.href = url;
      a.download = `bulkstats-${coin}-${new Date(isOpen ? Date.now() : (closedAt ?? openedAt)).toISOString().slice(0, 10)}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } finally {
      setRecording(false);
    }
  };

  const busy = playing || recording;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !recording) onClose(); }}
    >
      <div className="relative flex flex-col items-center gap-3">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute -top-3 -right-3 z-10 rounded-full border border-[var(--border-color)] bg-[var(--bg-muted)] p-1.5 text-[var(--text-secondary)] shadow-lg transition-colors hover:text-[var(--text-primary)]"
        >
          <X className="h-4 w-4" />
        </button>

        <canvas
          ref={canvasRef}
          style={{ width: W, height: H }}
          className="rounded-[22px] shadow-2xl"
        />
        {!candles && (
          <div className="absolute inset-0 grid place-items-center">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--role-content-subtle)]" />
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={replay}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-muted)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" /> Replay
          </button>
          <button
            onClick={download}
            disabled={busy || !canExport}
            title={canExport ? 'Download as video' : 'Video recording not supported in this browser'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-text)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_25%,transparent)] disabled:opacity-50"
          >
            {recording ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Recording…</> : <><Download className="h-3.5 w-3.5" /> Download video</>}
          </button>
        </div>
      </div>
    </div>
  );
}
