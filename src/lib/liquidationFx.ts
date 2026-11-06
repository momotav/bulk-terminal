// The liquidation share card, drawn as a comic panel: flat colour, thick ink outlines,
// no gradients. Motion runs on twos, stepping at 12 frames a second the way hand-drawn
// animation does, which is most of what stops it reading as a realistic effect.
//
// Shapes are fixed by a seed and everything else is a function of elapsed time, so the
// preview and the recorded video match and any frame can be redrawn on its own. Colours
// are fixed too: the site's accent is grey on some palettes, and ink works on any card.

export const LABEL_MS = 300;   // when the label lands, after the impact
export const FREEZE_MS = 1900; // how long the replay holds on the impact

const INK = '#15100d';
const PAPER = '#fff6e6';
const YELLOW = '#ffd23f';
const ORANGE = '#ff7a2f';
const FRAME_MS = 1000 / 12;

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

export interface Toon {
  hole: Pt[];
  cracks: Pt[][];
  chunks: { points: Pt[]; angle: number; speed: number; spin: number; tone: 'pos' | 'neg' | 'paper' }[];
  burst: number[];
  focus: { angle: number; width: number }[];
  plate: number[];
}

const polar = (r: number, a: number): Pt => [Math.cos(a) * r, Math.sin(a) * r];

/** A closed star: alternating points around an ellipse, scaled by `spikes` radii. */
function starPath(ctx: CanvasRenderingContext2D, radii: number[], rx: number, ry: number) {
  ctx.beginPath();
  radii.forEach((f, i) => {
    const a = (i / radii.length) * Math.PI * 2;
    const x = Math.cos(a) * rx * f;
    const y = Math.sin(a) * ry * f;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  ctx.closePath();
}

/** One card's shapes, fixed by its seed so every replay plays the same drawing. */
export function makeToon(seed: string): Toon {
  const r = rng(seed);

  const hole: Pt[] = Array.from({ length: 16 }, (_, i) => polar(i % 2 ? 15 + r() * 8 : 33 + r() * 17, (i / 16) * Math.PI * 2 + (r() - 0.5) * 0.14));

  // Lightning shapes: a zigzag spine, wide at the hole and tapering to a point.
  const cracks = Array.from({ length: 6 }, (_, i) => {
    const heading = (i / 6) * Math.PI * 2 + (r() - 0.5) * 0.6;
    const steps = 4;
    const reach = 76 + r() * 74;
    const spine: Pt[] = [polar(26, heading)];
    for (let s = 1; s <= steps; s++) {
      const a = heading + (s % 2 ? 0.5 : -0.5) * (0.6 + r() * 0.5);
      const [px, py] = spine[s - 1];
      const [dx, dy] = polar(reach / steps, a);
      spine.push([px + dx, py + dy]);
    }
    const side = (sign: number) => spine.slice(0, -1).map(([x, y], s): Pt => {
      const half = 5.5 * (1 - s / steps);
      return [x + Math.cos(heading + Math.PI / 2) * half * sign, y + Math.sin(heading + Math.PI / 2) * half * sign];
    });
    return [...side(1), spine[steps], ...side(-1).reverse()];
  });

  const tones = ['neg', 'paper', 'pos', 'neg', 'paper', 'neg', 'pos', 'paper', 'neg', 'neg'] as const;
  const chunks = tones.map((tone) => {
    const size = 7 + r() * 9;
    const corners = 3 + Math.floor(r() * 2);
    return {
      points: Array.from({ length: corners }, (_, i): Pt => polar(size * (0.7 + r() * 0.6), (i / corners) * Math.PI * 2)),
      angle: -Math.PI * r() - 0.1, speed: 150 + r() * 210, spin: (r() - 0.5) * 11, tone,
    };
  });

  const burst = Array.from({ length: 22 }, (_, i) => (i % 2 ? 0.5 + r() * 0.08 : 0.86 + r() * 0.24));
  const focus = Array.from({ length: 26 }, (_, i) => ({ angle: (i / 26) * Math.PI * 2 + (r() - 0.5) * 0.12, width: 0.022 + r() * 0.03 }));
  const plate = Array.from({ length: 30 }, (_, i) => (i % 2 ? 0.83 + r() * 0.04 : 0.98 + r() * 0.09));
  return { hole, cracks, chunks, burst, focus, plate };
}

const step = (ms: number) => Math.floor(ms / FRAME_MS) * FRAME_MS;

/** Card shake, in steps: the hit, then a smaller knock when the label lands. */
export function shakeAt(ms: number, calm: boolean): [number, number] {
  if (calm) return [0, 0];
  const t = Math.floor(ms / 42) * 42;
  const hit = 8 * Math.exp(-t / 120);
  const knock = t >= LABEL_MS ? 4 * Math.exp(-(t - LABEL_MS) / 80) : 0;
  const side = Math.floor(ms / 42) % 2 ? 1 : -1;
  return [side * (hit + knock), -side * (hit + knock) * 0.7];
}

function outlined(ctx: CanvasRenderingContext2D, points: Pt[], fill: string, line: number) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = line;
  ctx.stroke();
}

/** The hit and what it leaves behind: hole, cracks, flying chunks, burst, focus lines. */
export function drawToon(ctx: CanvasRenderingContext2D, toon: Toon, ms: number, x: number, y: number, w: number, h: number,
  c: { red: string; green: string }, calm: boolean) {
  const t = step(ms);
  const frame = Math.round(t / FRAME_MS);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Focus lines, the comic way of saying everything just went that way.
  if (!calm && frame < 3) {
    ctx.fillStyle = frame === 0 ? INK : PAPER;
    const far = Math.hypot(w, h);
    for (const f of toon.focus) {
      const near = 96 + (frame + 1) * 26;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(f.angle) * near, y + Math.sin(f.angle) * near);
      ctx.lineTo(x + Math.cos(f.angle - f.width) * far, y + Math.sin(f.angle - f.width) * far);
      ctx.lineTo(x + Math.cos(f.angle + f.width) * far, y + Math.sin(f.angle + f.width) * far);
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.save();
  ctx.translate(x, y);

  // Cracks grow in three drawn steps.
  const grown = Math.min(3, frame) / 3;
  if (grown > 0) {
    for (const crack of toon.cracks) {
      outlined(ctx, crack.map(([px, py]): Pt => [px * grown, py * grown]), PAPER, 2);
    }
  }

  // The hole pops open past its size and settles.
  const open = [0.45, 1.16, 0.96][frame] ?? 1;
  ctx.save();
  ctx.scale(open, open);
  outlined(ctx, toon.hole, INK, 0);
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 3 / open;
  ctx.stroke();
  ctx.restore();
  ctx.restore();

  // Chunks thrown up, tumbling in steps, falling off the card.
  for (const k of toon.chunks) {
    const sec = t / 1000;
    if (sec > 1.15) continue;
    const px = x + Math.cos(k.angle) * k.speed * sec;
    const py = y + Math.sin(k.angle) * k.speed * sec + 720 * sec * sec;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(k.spin * sec);
    outlined(ctx, k.points, k.tone === 'pos' ? c.green : k.tone === 'neg' ? c.red : PAPER, 2.2);
    ctx.restore();
  }

  // The burst: three flat layers for the first few frames.
  if (frame < 4) {
    const size = [0.72, 1.2, 1, 0.66][frame];
    ctx.save();
    ctx.translate(x, y);
    for (const [fill, scale] of [[c.red, 118], [ORANGE, 88], [YELLOW, 60], ['#fff', 30]] as const) {
      starPath(ctx, toon.burst, scale * size, scale * size);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.6;
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

/** Comic title: a red burst lands, the letters drop in one by one, then the tag. */
export function drawLabel(ctx: CanvasRenderingContext2D, toon: Toon, ms: number, x: number, y: number, title: string, sub: string | null,
  red: string, font: string) {
  const t = step(ms) - LABEL_MS;
  if (t < 0) return;
  const size = t < FRAME_MS ? 0.62 : t < FRAME_MS * 2 ? 1.14 : t < FRAME_MS * 3 ? 0.97 : 1;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.07);
  ctx.lineJoin = 'round';

  ctx.save();
  ctx.scale(size, size);
  ctx.translate(5, 6);
  starPath(ctx, toon.plate, 172, 72);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.translate(-5, -6);
  starPath(ctx, toon.plate, 172, 72);
  ctx.fillStyle = red;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.restore();

  // Letters land left to right, each with its own small tilt.
  ctx.font = `600 35px ${font}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const gap = 1.5;
  const letters = [...title];
  const widths = letters.map((l) => ctx.measureText(l).width + gap);
  let at = -widths.reduce((s, v) => s + v, 0) / 2;
  const line = sub ? -9 : 0;
  letters.forEach((letter, i) => {
    const age = t - FRAME_MS - i * 22;
    const lw = widths[i];
    if (age >= 0) {
      const pop = age < FRAME_MS ? 1.45 : 1;
      ctx.save();
      ctx.translate(at + lw / 2, line + (i % 2 ? -2 : 2));
      ctx.rotate(i % 2 ? 0.05 : -0.05);
      ctx.scale(pop, pop);
      ctx.translate(-lw / 2, 0);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 7;
      ctx.strokeText(letter, 2, 3);
      ctx.strokeText(letter, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.fillText(letter, 0, 0);
      ctx.restore();
    }
    at += lw;
  });

  if (sub && t > FRAME_MS * 4) {
    ctx.font = `500 12.5px ${font}`;
    const tw = ctx.measureText(sub).width + 22;
    const ty = 15;
    ctx.fillStyle = INK;
    ctx.fillRect(-tw / 2 + 3, ty + 3, tw, 23);
    ctx.fillStyle = PAPER;
    ctx.fillRect(-tw / 2, ty, tw, 23);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.2;
    ctx.strokeRect(-tw / 2, ty, tw, 23);
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.fillText(sub, 0, ty + 12);
  }
  ctx.restore();
}

