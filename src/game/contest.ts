// The ONE shared contest kernel. Every physical interaction (block, shed, rush
// win, jam, cut, tackle, catch, coverage) resolves through this single weighted
// roll, so behaviour is consistent and tunable instead of bespoke per system.
//
// Design: design/contest-kernel.md + design/decisions.md. Grounded in how
// football games model rating-delta-driven win/loss with fat tails.
//
//  - mean win probability is a logistic on the effective rating delta (SCALE pts
//    per e-fold): even = coin flip, big gap = near lock.
//  - an INSTANT EXTREME channel (fires once, at first contact) is zero inside a
//    deadzone and ramps with the mismatch -> pancakes / blow-bys happen OFTEN on
//    big gaps, almost never on even matchups. Sign of delta picks which extreme.
//  - CONTINUOUS contests (pass pro, run shed) use a per-frame hazard so things
//    like time-to-pressure EMERGE from the matchup rather than a fixed timer.
//  - severity (0..1) drives the kinematic payload (burst/stun/knockback/sep) and
//    carries a fat tail so even matchups still throw ~6% dramatic X-factor moments.
//
// All entropy comes from one seeded xorshift stream -> deterministic, so the
// pre-baked POC teams replay identically in headless tests.

let seed = 0x9e3779b9 >>> 0;

/** reseed the deterministic stream (call before a reproducible sim/play) */
export function reseed(s: number) {
  seed = (s >>> 0) || 1;
}

/** deterministic xorshift32 in [0,1) */
export function rng(): number {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export type ContestKind =
  | "block"
  | "shed"
  | "rush"
  | "jam"
  | "cut"
  | "tackle"
  | "catch"
  | "coverage"
  | "throw";

export interface ContestCtx {
  /** attacker's contextual rating 0..99 (composited by the caller) */
  atk: number;
  /** defender's contextual rating 0..99 */
  def: number;
  /** signed situational bias in RATING POINTS (geometry/leverage/scheme/timing) */
  leverage?: number;
  /** down/distance/clock clutch bias, points */
  situation?: number;
  /** closing-speed / gang / double-team bias, points */
  momentum?: number;
  /** gate the instant blow-by/pancake channel (use on first contact only) */
  firstContact?: boolean;
  /** dt seconds for a CONTINUOUS (per-frame hazard) contest; omit for INSTANT */
  perFrame?: number;
  kind: ContestKind;
}

export interface ContestResult {
  /** did the ATTACKER win this resolution? */
  win: boolean;
  /** the mean win probability used */
  p: number;
  /** 0..1 dramatic severity -> scales burst/stun/knockback/separation */
  sev: number;
  /** the instant extreme channel fired (pancake or blow-by) */
  extreme: boolean;
  /** effective signed delta after all biases (attacker-positive) */
  delta: number;
}

// global knobs (design/contest-kernel.md, reconciled to the build-plan bands)
const SCALE = 16; // rating pts per e-fold: +16 ~0.73, +32 ~0.88, +48 ~0.95
const EXTREME_DEAD = 8; // no extremes inside an even matchup
const EXTREME_SLOPE = 0.01; // +48 mismatch -> ~0.40 extreme rate
const EXTREME_CAP = 0.55;
const TAIL = 0.1; // base severity noise (+-)
const XFACTOR_RATE = 0.065; // even-matchup dramatic-tail frequency (~6.5%)
const XFACTOR_MIN = 0.5;
const XFACTOR_SPAN = 0.3;

// per-kind hazard base rate (/sec at delta 0) for CONTINUOUS contests
const HZ_BASE: Record<ContestKind, number> = {
  block: 0.26, // even pass-pro hold: median ln2/0.26 ~= 2.7s (sim-leaning)
  rush: 0.26,
  shed: 0.45, // run grind sheds quicker (median ~1.5s)
  coverage: 0,
  jam: 0,
  cut: 0,
  tackle: 0,
  catch: 0,
  throw: 0,
};
const HZ_SLOPE = 0.021; // each rating pt ~2%/sec swing

export function contest(c: ContestCtx): ContestResult {
  // 1. effective delta — every situational factor expressed in rating points
  const delta =
    c.atk - c.def + (c.leverage ?? 0) + (c.situation ?? 0) + (c.momentum ?? 0);
  const mm = Math.abs(delta);

  // 2. mean win probability (shared logistic)
  const p = 1 / (1 + Math.exp(-delta / SCALE));

  // 3. INSTANT EXTREME channel — at most once, at first contact
  if (c.firstContact) {
    const pExtreme = clamp((mm - EXTREME_DEAD) * EXTREME_SLOPE, 0, EXTREME_CAP);
    if (rng() < pExtreme) {
      return {
        win: delta > 0,
        p,
        sev: clamp(mm / 64 + 0.35, 0, 1),
        extreme: true,
        delta,
      };
    }
  }

  // 4. resolve — continuous hazard, or a single instant roll
  let win: boolean;
  if (c.perFrame !== undefined) {
    let hz = HZ_BASE[c.kind] + delta * HZ_SLOPE;
    hz *= 1 + (mm / 40) * (rng() * 2 - 1) * 0.6; // variance widens with mismatch
    hz = clamp(hz, 0.03, 2.2);
    win = rng() < hz * c.perFrame;
  } else {
    win = rng() < p;
  }

  // 5. severity — mostly small, with a fat X-factor tail so even matchups still
  //    occasionally produce a dramatic, readable spike
  let tail = (rng() * 2 - 1) * TAIL;
  if (rng() < XFACTOR_RATE) tail += XFACTOR_MIN + rng() * XFACTOR_SPAN;
  const sev = clamp(mm / 99 + tail, 0, 1);

  return { win, p, sev, extreme: false, delta };
}
