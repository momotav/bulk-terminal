// The liquidation share card treats the card as a pane of glass that the last slice
// shatters. The fracture is a spider web (spokes plus broken rings) around
// the impact, and its inner cells are real pieces of the rendered card that fall out.
//
// Geometry is fixed by a seed and everything else is a function of elapsed time, so
// the preview and the recorded video match and any frame can be redrawn on its own.
// Colours are fixed too: the site's accent is grey on some palettes, and fire isn't.

export const TILE_MS = 520;    // when the closing tile eases in, after the impact
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

interface Edge { a: Pt; b: Pt; path: Pt[]; from: number; to: number; weight: number; goneAt: number }
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
  const spokes = 9;
  const rings = [13, 30, 56, 96, 158];
  // Uneven on purpose: real cracks crowd together in places and leave wide gaps in others.
  const angles = Array.from({ length: spokes }, (_, j) => ((j + (r() - 0.5) * 0.9) / spokes) * Math.PI * 2).sort((p, q) => p - q);
  // Rings aren't circles: each vertex lands at its own distance along the spoke.
  const verts = rings.map((radius) => angles.map((a) => polar(radius * (0.66 + r() * 0.72), a + (r() - 0.5) * 0.12)));

  const edges: Edge[] = [];
  const edge = (a: Pt, b: Pt, weight: number) => {
    // Glass never breaks in a ruled line: the crack wanders a little along its length.
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const parts = Math.max(1, Math.round(len / 9));
    const nx = (-(b[1] - a[1]) / (len || 1));
    const ny = (b[0] - a[0]) / (len || 1);
    const path: Pt[] = Array.from({ length: parts + 1 }, (_, i) => {
      const t = i / parts;
      const off = i === 0 || i === parts ? 0 : (r() - 0.5) * 2.4;
      return [a[0] + (b[0] - a[0]) * t + nx * off, a[1] + (b[1] - a[1]) * t + ny * off];
    });
    edges.push({ a, b, path, from: dist(a), to: dist(b), weight, goneAt: Infinity });
  };

  for (let j = 0; j < spokes; j++) {
    let prev: Pt = [0, 0];
    for (let k = 0; k < rings.length; k++) { edge(prev, verts[k][j], 1 - k * 0.1); prev = verts[k][j]; }
    // Past the last ring a spoke runs on, thinning, and sometimes forks.
    let a = angles[j];
    let reach = 164;
    // Most cracks die quickly and a couple run long.
    const end = 180 + r() * r() * 300;
    while (reach < end) {
      a += (r() - 0.5) * 0.3;
      const step = 26 + r() * 34;
      const next: Pt = [prev[0] + Math.cos(a) * step, prev[1] + Math.sin(a) * step];
      edge(prev, next, 0.5);
      if (r() > 0.78) {
        const fa = a + (r() > 0.5 ? 1 : -1) * (0.4 + r() * 0.5);
        edge(next, [next[0] + Math.cos(fa) * (20 + r() * 34), next[1] + Math.sin(fa) * (20 + r() * 34)], 0.34);
      }
      prev = next;
      reach += step;
    }
  }
  // Glass fractures along the spokes first. Cross cracks only link some of them, which
  // is what keeps this from reading as a web.
  const crossing = [0.64, 0.46, 0.3, 0.2, 0.08];
  rings.forEach((_, k) => {
    for (let j = 0; j < spokes; j++) if (r() < crossing[k]) edge(verts[k][j], verts[k][(j + 1) % spokes], 0.7 - k * 0.1);
  });
  // The crushed zone: fine hairlines packed around the impact, which is what makes the
  // long cracks read as coming from a point and not just crossing the card.
  for (let i = 0; i < 46; i++) {
    const a = r() * Math.PI * 2;
    const start = 26 + r() * 38;
    edge(polar(start, a), polar(start + 5 + r() * 15, a + (r() - 0.5) * 0.22), 0.26);
  }
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

/** Card shake on impact. */
export function shakeAt(ms: number, calm: boolean): [number, number] {
  if (calm) return [0, 0];
  const blast = 9 * Math.exp(-ms / 130);
  return [Math.sin(ms * 0.13) * blast, Math.cos(ms * 0.1) * blast * 0.8];
}

const cellPath = (ctx: CanvasRenderingContext2D, points: Pt[]) => {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
};

/** Thickness of a crack at a distance from the impact: heavy near it, hair-thin far out. */
const crackWidth = (d: number, weight: number) => (0.25 + 1.5 * (1 - clamp01(d / 240))) * (0.45 + 0.55 * weight);

/** A crack as a filled sliver, tapering along its path, with a dark edge so it reads on any card. */
function crackShape(ctx: CanvasRenderingContext2D, pts: Pt[], x: number, y: number, weight: number, alpha: number) {
  if (pts.length < 2) return;
  const left: Pt[] = [];
  const right: Pt[] = [];
  pts.forEach(([px, py], i) => {
    const [ax, ay] = pts[Math.max(0, i - 1)];
    const [bx, by] = pts[Math.min(pts.length - 1, i + 1)];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const half = crackWidth(Math.hypot(px, py), weight) / 2;
    left.push([px - ((by - ay) / len) * half, py + ((bx - ax) / len) * half]);
    right.push([px + ((by - ay) / len) * half, py - ((bx - ax) / len) * half]);
  });
  const outline = [...left, ...right.reverse()];
  const trace = (dx: number, dy: number) => {
    ctx.beginPath();
    outline.forEach(([px, py], i) => (i ? ctx.lineTo(px + x + dx, py + y + dy) : ctx.moveTo(px + x + dx, py + y + dy)));
    ctx.closePath();
  };
  ctx.globalAlpha = alpha * 0.5;
  ctx.fillStyle = '#000';
  trace(0.7, 0.8);
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#f4f6f8';
  trace(0, 0);
  ctx.fill();
}

/**
 * The shattered pane, drawn over the finished card. `src` is a copy of that frame in
 * device pixels; pieces are cut from it, so what falls away is the chart itself.
 */
export function drawShatter(ctx: CanvasRenderingContext2D, glass: Glass, src: CanvasImageSource, ms: number, x: number, y: number, w: number, h: number) {
  const reached = ms * 1.5; // how far the fracture has run, in pixels

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
  const depth = ctx.createRadialGradient(0, 0, 0, 0, 0, 20);
  depth.addColorStop(0, 'rgba(0,0,0,0.9)');
  depth.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = clamp01(ms / 200);
  ctx.fillStyle = depth;
  ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // The fracture, running out from the impact and thinning away.
  ctx.save();
  for (const e of glass.edges) {
    const near = Math.min(e.from, e.to);
    if (near > reached || ms >= e.goneAt) continue;
    const far = Math.max(e.from, e.to);
    const grown = clamp01((reached - near) / Math.max(1, far - near));
    const path = e.from <= e.to ? e.path : [...e.path].reverse();
    const shown = path.slice(0, Math.max(2, Math.ceil(path.length * grown)));
    crackShape(ctx, shown, x, y, e.weight, (0.34 + 0.58 * e.weight) * (1 - clamp01((near - 50) / 240)));
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

/** The closing tile, built like the site's stat cards: label, big figure, caption. */
export function drawLiqTile(ctx: CanvasRenderingContext2D, ms: number, x: number, y: number, figure: string | null, caption: string | null,
  c: { red: string; muted: string; surface: string; line: string }, font: string) {
  const t = ms - TILE_MS;
  if (t < 0) return;
  const shown = clamp01(t / 260);
  const eased = 1 - (1 - shown) ** 3;

  ctx.font = `500 13px ${font}`;
  const captionW = caption ? ctx.measureText(caption).width : 0;
  ctx.font = `500 34px ${font}`;
  const figureW = ctx.measureText(figure ?? 'Liquidated').width;
  const padX = 18;
  const w = Math.max(captionW, figureW, 92) + padX * 2;
  const h = figure ? 112 : 78;
  const left = x - w / 2;
  const top = y - h / 2 + (1 - eased) * 10;

  ctx.save();
  ctx.globalAlpha = eased;
  ctx.beginPath();
  ctx.roundRect(left, top, w, h, 14);
  ctx.fillStyle = c.surface;
  ctx.fill();
  ctx.strokeStyle = c.line;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if (figure) {
    ctx.fillStyle = c.muted;
    ctx.font = `500 13px ${font}`;
    ctx.fillText('Liquidated', left + padX, top + 28);
    ctx.fillStyle = c.red;
    ctx.font = `500 34px ${font}`;
    ctx.fillText(figure, left + padX, top + 68);
    if (caption) {
      ctx.fillStyle = c.muted;
      ctx.font = `500 13px ${font}`;
      ctx.fillText(caption, left + padX, top + 92);
    }
  } else {
    ctx.fillStyle = c.red;
    ctx.font = `500 34px ${font}`;
    ctx.fillText('Liquidated', left + padX, top + 51);
  }
  ctx.restore();
}
