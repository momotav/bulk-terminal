// The liquidation share card treats the card as a pane of glass: slices chip it, the
// last one shatters it. The fracture is a spider web (spokes plus broken rings) around
// the impact, and its inner cells are real pieces of the rendered card that fall out.
//
// Geometry is fixed by a seed and everything else is a function of elapsed time, so
// the preview and the recorded video match and any frame can be redrawn on its own.
// Colours are fixed too: the site's accent is grey on some palettes, and fire isn't.

export const STAMP_MS = 380;   // when the stamp lands, after the impact
export const FREEZE_MS = 1900; // how long the replay holds on the impact

type Pt = [number, number];
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

interface Edge { a: Pt; b: Pt; from: number; to: number; weight: number; goneAt: number }
interface Cell {
  points: Pt[]; center: Pt; dist: number;
  /** Null stays in the pane, slightly knocked out of line. */
  fall: { delay: number; vx: number; vy: number; spin: number } | null;
  shift: Pt; tilt: number;
}
export interface Glass { edges: Edge[]; cells: Cell[]; sparks: { angle: number; speed: number; life: number }[] }

const polar = (r: number, a: number): Pt => [Math.cos(a) * r, Math.sin(a) * r];
const dist = ([x, y]: Pt) => Math.hypot(x, y);

/** The fracture around an impact at (0, 0). */
export function makeGlass(seed: string): Glass {
  const r = rng(seed);
  const spokes = 11;
  const rings = [13, 30, 56, 96, 158];
  // Uneven on purpose: real cracks crowd together in places and leave wide gaps in others.
  const angles = Array.from({ length: spokes }, (_, j) => ((j + (r() - 0.5) * 0.9) / spokes) * Math.PI * 2).sort((p, q) => p - q);
  // Rings aren't circles: each vertex lands at its own distance along the spoke.
  const verts = rings.map((radius) => angles.map((a) => polar(radius * (0.66 + r() * 0.72), a + (r() - 0.5) * 0.12)));

  const edges: Edge[] = [];
  const edge = (a: Pt, b: Pt, weight: number) => edges.push({ a, b, from: dist(a), to: dist(b), weight, goneAt: Infinity });

  for (let j = 0; j < spokes; j++) {
    let prev: Pt = [0, 0];
    for (let k = 0; k < rings.length; k++) { edge(prev, verts[k][j], 1 - k * 0.1); prev = verts[k][j]; }
    // Past the last ring a spoke runs on, thinning, and sometimes forks.
    let a = angles[j];
    let reach = 164;
    const end = 215 + r() * 240;
    while (reach < end) {
      a += (r() - 0.5) * 0.3;
      const step = 26 + r() * 34;
      const next: Pt = [prev[0] + Math.cos(a) * step, prev[1] + Math.sin(a) * step];
      edge(prev, next, 0.5);
      if (r() > 0.72) {
        const fa = a + (r() > 0.5 ? 1 : -1) * (0.4 + r() * 0.5);
        edge(next, [next[0] + Math.cos(fa) * (20 + r() * 34), next[1] + Math.sin(fa) * (20 + r() * 34)], 0.34);
      }
      prev = next;
      reach += step;
    }
  }
  // Glass fractures along the spokes first. Cross cracks only link some of them, which
  // is what keeps this from reading as a web.
  const crossing = [0.72, 0.56, 0.42, 0.3, 0.16];
  rings.forEach((_, k) => {
    for (let j = 0; j < spokes; j++) if (r() < crossing[k]) edge(verts[k][j], verts[k][(j + 1) % spokes], 0.7 - k * 0.1);
  });
  edges.sort((p, q) => Math.min(p.from, p.to) - Math.min(q.from, q.to));

  const cells: Cell[] = [];
  const add = (points: Pt[], ring: number) => {
    const center: Pt = [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length];
    const d = dist(center);
    const falls = ring === 0 || (ring === 1 && r() < 0.8) || (ring === 2 && r() < 0.14);
    const out = Math.atan2(center[1], center[0]);
    cells.push({
      points, center, dist: d,
      fall: falls ? { delay: 45 + d * 1.1 + r() * 90, vx: Math.cos(out) * (30 + r() * 80), vy: Math.sin(out) * 40 - 30 - r() * 60, spin: (r() - 0.5) * 7 } : null,
      shift: polar(0.6 + r() * 2.2, out + (r() - 0.5) * 1.6), tilt: (r() - 0.5) * 0.012,
    });
  };
  for (let j = 0; j < spokes; j++) {
    const n = (j + 1) % spokes;
    add([[0, 0], verts[0][j], verts[0][n]], 0);
    for (let k = 0; k < 3; k++) add([verts[k][j], verts[k][n], verts[k + 1][n], verts[k + 1][j]], k + 1);
  }

  // A crack with fallen glass on both sides has nothing left to run through.
  const inside = ([px, py]: Pt, poly: Pt[]) => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  const fallenAt = (p: Pt) => cells.find((c) => c.fall && inside(p, c.points))?.fall?.delay ?? null;
  for (const e of edges) {
    const mid: Pt = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
    const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) || 1;
    const nx = (-(e.b[1] - e.a[1]) / len) * 2.5;
    const ny = ((e.b[0] - e.a[0]) / len) * 2.5;
    const one = fallenAt([mid[0] + nx, mid[1] + ny]);
    const two = fallenAt([mid[0] - nx, mid[1] - ny]);
    if (one !== null && two !== null) e.goneAt = Math.max(one, two);
  }

  const sparks = Array.from({ length: 20 }, () => ({ angle: r() * Math.PI * 2, speed: 180 + r() * 340, life: 170 + r() * 240 }));
  return { edges, cells, sparks };
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Card shake: the impact, then a smaller knock when the stamp lands. */
export function shakeAt(ms: number, calm: boolean): [number, number] {
  if (calm) return [0, 0];
  const blast = 9 * Math.exp(-ms / 130);
  const knock = ms >= STAMP_MS ? 5 * Math.exp(-(ms - STAMP_MS) / 90) : 0;
  const amp = blast + knock;
  return [Math.sin(ms * 0.13) * amp, Math.cos(ms * 0.1) * amp * 0.8];
}

const cellPath = (ctx: CanvasRenderingContext2D, points: Pt[]) => {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
};

/** One line of a crack: a bright edge with a dark one beside it, so it reads on any card. */
function crackLine(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, alpha: number, width: number) {
  ctx.globalAlpha = alpha * 0.55;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = width + 0.5;
  ctx.beginPath(); ctx.moveTo(a[0] + 0.6, a[1] + 0.7); ctx.lineTo(b[0] + 0.6, b[1] + 0.7); ctx.stroke();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
}

/** A chip left in the glass by one slice of a liquidation. */
export function drawChip(ctx: CanvasRenderingContext2D, seed: number, age: number, x: number, y: number) {
  const r = rng(String(seed));
  const grown = clamp01(age / 110);
  ctx.save();
  ctx.translate(x, y);
  ctx.lineCap = 'round';
  // Two or three cracks of very different lengths, not a star.
  const legs = 2 + Math.floor(r() * 2);
  const start = r() * Math.PI * 2;
  for (let i = 0; i < legs; i++) {
    let a = start + i * (1.5 + r() * 1.4);
    let at: Pt = [0, 0];
    const reach = (i === 0 ? 20 + r() * 14 : 6 + r() * 9) * grown;
    for (let s = 0; s < 4; s++) {
      a += (r() - 0.5) * 0.9;
      const next: Pt = [at[0] + Math.cos(a) * reach / 4, at[1] + Math.sin(a) * reach / 4];
      crackLine(ctx, at, next, 0.6 - s * 0.12, 0.7);
      at = next;
    }
  }
  ctx.restore();
}

/**
 * The shattered pane, drawn over the finished card. `src` is a copy of that frame in
 * device pixels; pieces are cut from it, so what falls away is the chart itself.
 */
export function drawShatter(ctx: CanvasRenderingContext2D, glass: Glass, src: CanvasImageSource, ms: number, x: number, y: number, w: number, h: number) {
  const reached = ms * 1.5; // how far the fracture has run, in pixels
  const atImpact = (p: Pt): Pt => [p[0] + x, p[1] + y];

  // Cells that stay, knocked slightly out of line and catching the light unevenly.
  for (const c of glass.cells) {
    if (c.fall || c.dist > reached) continue;
    const settle = clamp01((reached - c.dist) / 60);
    ctx.save();
    ctx.translate(x, y);
    cellPath(ctx, c.points);
    ctx.clip();
    ctx.translate(c.shift[0] * settle, c.shift[1] * settle);
    ctx.rotate(c.tilt * settle);
    ctx.translate(-x, -y);
    ctx.drawImage(src, 0, 0, w, h);
    ctx.restore();
  }

  // The hole behind the pieces that have gone.
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#080606';
  for (const c of glass.cells) {
    if (!c.fall || ms < c.fall.delay) continue;
    cellPath(ctx, c.points);
    ctx.fill();
    ctx.strokeStyle = '#080606';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  // Depth: a soft dark falloff at the centre, so it reads as a hole and not a black shape.
  const depth = ctx.createRadialGradient(0, 0, 0, 0, 0, 34);
  depth.addColorStop(0, 'rgba(0,0,0,0.9)');
  depth.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = clamp01(ms / 200);
  ctx.fillStyle = depth;
  ctx.beginPath(); ctx.arc(0, 0, 34, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // The fracture, running out from the impact and thinning with distance.
  ctx.save();
  ctx.lineCap = 'round';
  for (const e of glass.edges) {
    const near = Math.min(e.from, e.to);
    if (near > reached || ms >= e.goneAt) continue;
    const far = Math.max(e.from, e.to);
    const grown = clamp01((reached - near) / Math.max(1, far - near));
    const start = e.from <= e.to ? e.a : e.b;
    const stop = e.from <= e.to ? e.b : e.a;
    const end: Pt = [start[0] + (stop[0] - start[0]) * grown, start[1] + (stop[1] - start[1]) * grown];
    const fade = 1 - clamp01((near - 60) / 280);
    crackLine(ctx, atImpact(start), atImpact(end), (0.22 + 0.62 * e.weight) * fade, 0.45 + 0.7 * e.weight * fade);
  }
  ctx.restore();

  // Pieces breaking out and dropping, last so they fall in front of everything.
  for (const c of glass.cells) {
    if (!c.fall) continue;
    const sec = (ms - c.fall.delay) / 1000;
    if (sec >= 1.25) continue;
    const t = Math.max(0, sec);
    const px = x + c.center[0] + c.fall.vx * t;
    const py = y + c.center[1] + c.fall.vy * t + 760 * t * t;
    ctx.save();
    ctx.globalAlpha = clamp01((1.25 - t) / 0.3);
    ctx.translate(px, py);
    ctx.rotate(c.fall.spin * t);
    ctx.translate(-c.center[0], -c.center[1]);
    cellPath(ctx, c.points);
    ctx.save();
    ctx.clip();
    ctx.translate(-x, -y);
    ctx.drawImage(src, 0, 0, w, h);
    ctx.restore();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.stroke();
    ctx.restore();
  }
}

/** The instant of the hit: a hard point of light and a few white-hot streaks. */
export function drawImpact(ctx: CanvasRenderingContext2D, glass: Glass, ms: number, x: number, y: number, w: number, h: number, calm: boolean) {
  ctx.save();
  if (ms < 240) {
    const t = ms / 240;
    const reach = 40 + t * 130;
    const g = ctx.createRadialGradient(x, y, 0, x, y, reach);
    g.addColorStop(0, 'rgba(255,250,240,1)');
    g.addColorStop(0.22, 'rgba(255,170,90,0.85)');
    g.addColorStop(0.55, 'rgba(235,50,30,0.35)');
    g.addColorStop(1, 'rgba(235,50,30,0)');
    ctx.globalAlpha = (1 - t) ** 2;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, reach, 0, Math.PI * 2); ctx.fill();
  }
  ctx.lineCap = 'round';
  for (const s of glass.sparks) {
    if (ms >= s.life) continue;
    const t = ms / 1000;
    const head = s.speed * t;
    const tail = Math.max(0, head - 26);
    ctx.globalAlpha = 1 - ms / s.life;
    ctx.strokeStyle = '#ffd9a0';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(s.angle) * tail, y + Math.sin(s.angle) * tail + 300 * t * t);
    ctx.lineTo(x + Math.cos(s.angle) * head, y + Math.sin(s.angle) * head + 300 * t * t);
    ctx.stroke();
  }
  // One flash, skipped for anyone who asked for less motion.
  if (!calm && ms < 90) {
    ctx.globalAlpha = 0.5 * (1 - ms / 90);
    ctx.fillStyle = '#fff';
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
