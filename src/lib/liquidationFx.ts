// The explosion on the liquidation share card. Everything here is a pure function
// of elapsed time: particles have fixed launch values and are placed by formula, so
// the preview and the recorded video match and any frame can be redrawn on its own.

export const STAMP_MS = 420;   // when the stamp lands, after the blast
export const FREEZE_MS = 1900; // how long the replay holds on the blast

type Rng = () => number;

function rng(seedText: string): Rng {
  let a = 2166136261;
  for (const c of seedText) a = Math.imul(a ^ c.charCodeAt(0), 16777619);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface FxScene {
  sparks: { angle: number; speed: number; life: number; size: number; hot: boolean }[];
  shards: { angle: number; speed: number; life: number; w: number; h: number; spin: number; up: boolean }[];
  cracks: { points: [number, number][]; delay: number }[];
  embers: { x: number; speed: number; sway: number; phase: number; size: number }[];
}

/** One card's particles, fixed by its seed so every replay plays the same blast. */
export function makeFxScene(seed: string): FxScene {
  const r = rng(seed);
  const sparks = Array.from({ length: 110 }, () => ({
    angle: r() * Math.PI * 2, speed: 90 + r() * 420, life: 450 + r() * 900, size: 1 + r() * 2.2, hot: r() > 0.55,
  }));
  const shards = Array.from({ length: 26 }, () => ({
    angle: -Math.PI * r(), speed: 120 + r() * 300, life: 900 + r() * 800,
    w: 3 + r() * 5, h: 7 + r() * 16, spin: (r() - 0.5) * 16, up: r() > 0.5,
  }));
  const cracks = Array.from({ length: 9 }, (_, i) => {
    let angle = (i / 9) * Math.PI * 2 + r() * 0.5;
    const length = 90 + r() * 230;
    const points: [number, number][] = [[0, 0]];
    for (let d = 26; d < length; d += 22 + r() * 22) {
      angle += (r() - 0.5) * 0.75;
      const [px, py] = points[points.length - 1];
      points.push([px + Math.cos(angle) * 28, py + Math.sin(angle) * 28]);
    }
    return { points, delay: r() * 90 };
  });
  const embers = Array.from({ length: 34 }, () => ({
    x: r(), speed: 16 + r() * 34, sway: 5 + r() * 12, phase: r(), size: 0.8 + r() * 1.8,
  }));
  return { sparks, shards, cracks, embers };
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Card shake: the blast, then a smaller knock when the stamp lands. */
export function shakeAt(ms: number, calm: boolean): [number, number] {
  if (calm) return [0, 0];
  const blast = 11 * Math.exp(-ms / 170);
  const knock = ms >= STAMP_MS ? 6 * Math.exp(-(ms - STAMP_MS) / 110) : 0;
  const amp = blast + knock;
  return [Math.sin(ms * 0.11) * amp, Math.cos(ms * 0.087) * amp * 0.8];
}

/** Rising shake and red edges as the price closes in on the blast. */
export function drawTension(ctx: CanvasRenderingContext2D, w: number, h: number, level: number, now: number, red: string) {
  if (level <= 0) return;
  const pulse = 0.55 + 0.45 * Math.sin(now * (0.006 + level * 0.012));
  const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.34, w / 2, h / 2, h * 0.78);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, red);
  ctx.save();
  ctx.globalAlpha = level * pulse * 0.6;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** A small hit for each slice of a liquidation on the way down. */
export function drawHit(ctx: CanvasRenderingContext2D, age: number, x: number, y: number, red: string) {
  const t = clamp01(age);
  ctx.save();
  ctx.globalAlpha = (1 - t) * 0.9;
  ctx.strokeStyle = red;
  ctx.lineWidth = 2.5 * (1 - t) + 0.5;
  ctx.beginPath();
  ctx.arc(x, y, 8 + easeOut(t) * 34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Cracks spreading from the blast through the chart, which stay on the card. */
export function drawCracks(ctx: CanvasRenderingContext2D, scene: FxScene, ms: number, x: number, y: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const crack of scene.cracks) {
    const grown = clamp01((ms - 60 - crack.delay) / 240);
    if (grown <= 0) continue;
    const last = Math.max(1, Math.floor(crack.points.length * grown));
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    crack.points.slice(0, last + 1).forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.stroke();
  }
  ctx.restore();
}

/** The blast itself: fireball, shockwaves, sparks, flying candle pieces, the flash. */
export function drawBlast(ctx: CanvasRenderingContext2D, scene: FxScene, ms: number, x: number, y: number, w: number, h: number,
  c: { red: string; green: string; hot: string }, calm: boolean) {
  ctx.save();

  // Fireball.
  if (ms < 900) {
    const t = ms / 900;
    const r = 40 + easeOut(t) * 200;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,245,220,0.95)');
    g.addColorStop(0.28, c.hot);
    g.addColorStop(0.6, c.red);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = (1 - t) ** 1.6;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // Shockwaves.
  for (const [delay, reach, width] of [[0, 330, 5], [110, 250, 3], [240, 190, 2]] as const) {
    const t = (ms - delay) / 750;
    if (t <= 0 || t >= 1) continue;
    ctx.globalAlpha = (1 - t) ** 1.5;
    ctx.strokeStyle = delay ? c.red : '#fff';
    ctx.lineWidth = width * (1 - t) + 0.5;
    ctx.beginPath(); ctx.arc(x, y, easeOut(t) * reach, 0, Math.PI * 2); ctx.stroke();
  }

  // Sparks: short streaks along their path, pulled down by gravity.
  ctx.lineCap = 'round';
  for (const s of scene.sparks) {
    if (ms >= s.life) continue;
    const sec = ms / 1000;
    const drag = 1 - Math.exp(-sec * 3.2);
    const dist = (s.speed / 3.2) * drag;
    const sx = x + Math.cos(s.angle) * dist;
    const sy = y + Math.sin(s.angle) * dist + 240 * sec * sec;
    const tail = 0.03;
    const px = x + Math.cos(s.angle) * (s.speed / 3.2) * (1 - Math.exp(-(sec - tail) * 3.2));
    const py = y + Math.sin(s.angle) * (s.speed / 3.2) * (1 - Math.exp(-(sec - tail) * 3.2)) + 240 * (sec - tail) ** 2;
    ctx.globalAlpha = 1 - ms / s.life;
    ctx.strokeStyle = s.hot ? '#ffe9b8' : c.hot;
    ctx.lineWidth = s.size;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(sx, sy); ctx.stroke();
  }

  // Candle pieces, thrown up and tumbling back down.
  for (const p of scene.shards) {
    if (ms >= p.life) continue;
    const sec = ms / 1000;
    const sx = x + Math.cos(p.angle) * p.speed * sec;
    const sy = y + Math.sin(p.angle) * p.speed * sec + 460 * sec * sec;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(p.spin * sec);
    ctx.globalAlpha = clamp01((p.life - ms) / 300);
    ctx.fillStyle = p.up ? c.green : c.red;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }

  // One flash, skipped for anyone who asked for less motion.
  if (!calm && ms < 300) {
    ctx.globalAlpha = ms < 70 ? 0.85 : 0.85 * (1 - (ms - 70) / 230);
    ctx.fillStyle = ms < 70 ? '#fff' : c.red;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

/** The stamp slams down, overshoots, settles. */
export function drawStamp(ctx: CanvasRenderingContext2D, ms: number, x: number, y: number, title: string, sub: string | null,
  c: { red: string; bg: string }, font: string) {
  const t = ms - STAMP_MS;
  if (t < 0) return;
  const land = 150;
  const scale = t < land ? 2.8 - 1.9 * (t / land) ** 2 : 0.9 + 0.1 * clamp01((t - land) / 130);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.12);
  ctx.scale(scale, scale);
  ctx.globalAlpha = clamp01(t / 60);

  ctx.font = `600 37px ${font}`;
  const wide = ctx.measureText(title).width;
  const boxW = wide + 34;
  const boxH = sub ? 84 : 62;
  ctx.fillStyle = c.bg;
  ctx.globalAlpha *= 0.86;
  ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
  ctx.globalAlpha = clamp01(t / 60);
  ctx.strokeStyle = c.red;
  ctx.lineWidth = 3.5;
  ctx.strokeRect(-boxW / 2, -boxH / 2, boxW, boxH);
  ctx.lineWidth = 1;
  ctx.strokeRect(-boxW / 2 + 5, -boxH / 2 + 5, boxW - 10, boxH - 10);

  ctx.fillStyle = c.red;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 0, sub ? -11 : 2);
  if (sub) {
    ctx.font = `500 13px ${font}`;
    ctx.fillText(sub, 0, 22);
  }
  ctx.restore();
}

/** Embers drifting up off the wreck for the rest of the replay. */
export function drawEmbers(ctx: CanvasRenderingContext2D, scene: FxScene, ms: number, area: { x: number; y: number; w: number; h: number }, hot: string) {
  const fade = clamp01((ms - 500) / 500);
  if (fade <= 0) return;
  ctx.save();
  ctx.fillStyle = hot;
  for (const e of scene.embers) {
    const travel = ((ms / 1000) * e.speed + e.phase * area.h) % area.h;
    const life = travel / area.h;
    ctx.globalAlpha = fade * Math.sin(Math.PI * life) * 0.85;
    ctx.beginPath();
    ctx.arc(area.x + e.x * area.w + Math.sin(ms / 420 + e.phase * 9) * e.sway, area.y + area.h - travel, e.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
