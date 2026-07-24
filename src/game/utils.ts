export const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

export const dist = (ax: number, ay: number, bx: number, by: number) =>
  Math.hypot(ax - bx, ay - by);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// NOTE: game randomness lives in contest.ts (one seeded, reseedable stream).
// This module is pure math helpers only — a second rng here once split the
// entropy into a non-reseedable side stream and broke per-play determinism.
