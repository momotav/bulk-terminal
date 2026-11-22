// BULK-style avatars: soft blurred colour fields in BULK's palette (cream, taupe,
// mauve-grey, plum), laid out differently for every wallet. The same seed always
// gives the same picture; the colours never leave the palette.

const PALETTE = ['#F6EEDC', '#EFE2C6', '#C9BEB6', '#A2979A', '#857A80', '#6C6267', '#564D53', '#433B41', '#7E6F75'];
const LIGHT = PALETTE.slice(0, 3);
const DARK = PALETTE.slice(5);

export interface AvatarBlob { x: number; y: number; r: number; color: string }
export interface AvatarSpec { base: string; blobs: AvatarBlob[]; angle: number }

/** Small seeded RNG (mulberry32) so a wallet's avatar never changes. */
function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function avatarSpec(seed: string): AvatarSpec {
  const r = rng(seed || 'bulker');
  const pick = (arr: string[]) => arr[Math.floor(r() * arr.length)];
  // Mostly-light, mostly-dark or mid-tone, like BULK's own set.
  const mood = r();
  const base = mood < 0.4 ? pick(LIGHT) : mood < 0.75 ? pick(PALETTE.slice(3, 6)) : pick(DARK);
  const n = 3 + Math.floor(r() * 2);
  const blobs: AvatarBlob[] = [];
  for (let i = 0; i < n; i++) {
    // Always one light and one dark field, so every avatar has depth.
    const color = i === 0 ? pick(DARK) : i === 1 ? pick(LIGHT) : pick(PALETTE);
    blobs.push({ x: -0.15 + r() * 1.3, y: -0.15 + r() * 1.3, r: 0.55 + r() * 0.5, color });
  }
  return { base, blobs, angle: Math.floor(r() * 360) };
}

/** As a CSS background (blobs on top of the base). */
export function avatarBackground(seed: string): string {
  const s = avatarSpec(seed);
  const layers = s.blobs.map((b) => `radial-gradient(circle at ${(b.x * 100).toFixed(1)}% ${(b.y * 100).toFixed(1)}%, ${b.color} 0%, ${b.color}00 ${(b.r * 100).toFixed(0)}%)`);
  layers.push(`linear-gradient(${s.angle}deg, rgba(255,255,255,0.06), rgba(0,0,0,0.06))`);
  return `${layers.join(', ')}, ${s.base}`;
}

/** Drawn on a canvas (share cards), clipped to a rounded square at x,y of size. */
export function drawAvatar(ctx: CanvasRenderingContext2D, seed: string, x: number, y: number, size: number, radius = size * 0.24) {
  const s = avatarSpec(seed);
  ctx.save();
  ctx.beginPath();
  if (typeof (ctx as unknown as { roundRect?: unknown }).roundRect === 'function') (ctx as unknown as { roundRect: (...a: number[]) => void }).roundRect(x, y, size, size, radius);
  else ctx.rect(x, y, size, size);
  ctx.clip();
  ctx.fillStyle = s.base; ctx.fillRect(x, y, size, size);
  for (const b of s.blobs) {
    const cx = x + b.x * size, cy = y + b.y * size, rr = b.r * size;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
    g.addColorStop(0, b.color); g.addColorStop(1, `${b.color}00`);
    ctx.fillStyle = g; ctx.fillRect(x, y, size, size);
  }
  ctx.restore();
}
