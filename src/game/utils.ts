export const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

export const dist = (ax: number, ay: number, bx: number, by: number) =>
  Math.hypot(ax - bx, ay - by);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** move (x,y) toward (tx,ty) by at most `max` px; returns the step */
export function steer(
  x: number,
  y: number,
  tx: number,
  ty: number,
  max: number
): { vx: number; vy: number } {
  const dx = tx - x;
  const dy = ty - y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-3 || d <= max) return { vx: dx, vy: dy };
  return { vx: (dx / d) * max, vy: (dy / d) * max };
}

let seed = 0x9e3779b9;
export function rng(): number {
  // deterministic xorshift so behaviour is reproducible across runs
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) % 100000) / 100000;
}
