# The Contest Kernel

> Synthesized design — Gridiron Blitz. Reconciled from all system specs in `systems/`.

> **IMPLEMENTED & VALIDATED.** Code: `src/game/contest.ts`. Headless validation:
> `npm run sim:kernel` (`scripts/kernel-sweep.ts`) — all acceptance bands pass.
> Tuning reconciled from the draft pseudocode below to hit the build-plan bands
> (sim-leaning, per `decisions.md`):
> - `EXTREME_SLOPE 0.013 → 0.01` (so +48 mismatch ≈ 40% extreme, in the 35–45% band)
> - `HZ_BASE.block 0.32 → 0.26`, `shed 0.50 → 0.45` (even pocket median **2.68s**)
> - severity gets a fat X-factor tail: ~6.5% of even-matchup reps spike `sev` past 0.4
>   (the "exciting tail on a wash"), the rest cluster `<0.2`.
>
> Validated distributions: win@Δ0 49.9% / Δ16 73.1% / Δ48 95.3%; extreme@Δ0 0% / Δ48 39.9%;
> EDGE+22 mismatch → 80% pressure <2.0s + 13.6% instant super-wins. Deterministic via one seeded stream.

## The ONE Contest Kernel — `contest()`

Every physical interaction (block, shed, rush win, jam, mirror-cut, break-tackle, catch, coverage, throw) calls **one** function. No bespoke per-system math. It lives in `utils.ts` next to `rng()` so it shares the deterministic xorshift stream.

### Reconciling the specs
The eleven specs proposed conflicting curves (`sigmoid(delta/18)`, `sigmoid(delta/14)`, `1/(1+10^(-delta/70))`, `logistic(0.045*delta)`, `logistic(0.11*delta)`). I unify on a **logistic in natural-exp form with a single SCALE in rating points**, because it is the most legible to tune and maps cleanly onto the "0-99 rating" scale all systems already assume.

```
SCALE = 16   // rating points per e-fold. +16 delta -> ~0.73 win, +32 -> ~0.88, +48 -> ~0.95
```

This is the geometric mean of the cluster (14, 18, ~15.5-equiv of the 70/ln10 form) and keeps the owner's headline anchors: even = coin flip, big gap = near-lock.

### Signature (single source of truth)

```ts
// kind selects only labels + a few band thresholds; the MATH is identical everywhere.
type ContestKind = 'block'|'shed'|'rush'|'jam'|'cut'|'tackle'|'catch'|'coverage'|'throw';
interface ContestCtx {
  atk: number;          // attacker's contextual rating, 0..99 (already composited by caller)
  def: number;          // defender's contextual rating, 0..99
  leverage?: number;    // signed rating-equivalent situational bias (geometry/angle/scheme), pts. default 0
  situation?: number;   // down/distance/clock clutch bias in pts. default 0
  momentum?: number;    // pts from closing-speed / gang stacking / double-team. default 0
  firstContact?: boolean; // gates the instant blow-by/pancake channel
  perFrame?: number;    // dt in seconds if this is a CONTINUOUS (hazard) contest; omit for INSTANT
  kind: ContestKind;
}
interface ContestResult {
  win: boolean;         // did the ATTACKER win this resolution?
  p: number;            // the win probability used
  sev: number;          // 0..1 dramatic severity (drives burst/stun/separation magnitude)
  extreme: boolean;     // true if the instant channel fired (pancake or blow-by)
  delta: number;        // effective signed delta after all biases
}
```

### The function (pseudocode, exact)

```ts
const SCALE = 16, SEV_GAIN = 1.0, TAIL = 0.10;     // global knobs
const EXTREME_DEAD = 8, EXTREME_SLOPE = 0.013, EXTREME_CAP = 0.55;

function contest(c: ContestCtx): ContestResult {
  // 1. effective delta: ALL situational factors are expressed in rating points, then added.
  const delta = (c.atk - c.def) + (c.leverage??0) + (c.situation??0) + (c.momentum??0);
  const mm = Math.abs(delta);

  // 2. mean win probability (shared logistic)
  const p = 1 / (1 + Math.exp(-delta / SCALE));

  // 3. INSTANT EXTREME CHANNEL (the pancake / blow-by tail). Fires at most once, at first contact.
  //    Probability is ZERO inside the deadzone and ramps with the mismatch -> big gaps explode often,
  //    even matchups almost never. Sign of delta decides which extreme.
  if (c.firstContact) {
    const pExtreme = clamp((mm - EXTREME_DEAD) * EXTREME_SLOPE, 0, EXTREME_CAP);
    if (rng() < pExtreme) {
      return { win: delta > 0, p, sev: clamp(mm/64 + 0.35, 0, 1), extreme: true, delta };
    }
  }

  // 4. roll. CONTINUOUS contests use a per-frame hazard; INSTANT contests use one roll.
  let win: boolean;
  if (c.perFrame !== undefined) {
    // hazard: base rate + delta tilt, scaled by dt. base passed via kind table below.
    let hz = HZ_BASE[c.kind] + delta * HZ_SLOPE;            // /sec
    hz *= 1 + (mm/40) * (rng()*2 - 1) * 0.6;                // variance widens with mismatch
    hz = clamp(hz, 0.03, 2.2);
    win = rng() < hz * c.perFrame;
  } else {
    win = rng() < p;
  }

  // 5. SEVERITY — how dramatic, also rating-driven, with an even-matchup tail.
  //    sev scales the kinematic payload (burst, stun, knockback, separation yards).
  const tailNoise = (rng()*2 - 1) * TAIL;                   // +-0.10 X-factor on even reps
  const sev = clamp(mm/99 * SEV_GAIN + tailNoise, 0, 1);

  return { win, p, sev, extreme: false, delta };
}

// per-kind hazard base rates (/sec at delta 0) for CONTINUOUS contests:
const HZ_BASE = { block: 0.32 /*pass-pro hold ~2.7s*/, rush: 0.30, shed: 0.50 /*run grind*/,
                  coverage: 0.0 /*coverage uses cushion drift, not a shed hazard*/, jam:0, cut:0, tackle:0, catch:0, throw:0 };
const HZ_SLOPE = 0.021;   // each rating pt ~2%/sec swing
```

### Named outcome bands (read off `delta`/`sev`/`extreme`/`win`)
Every system maps the SAME result into its own flavor. Universal bands:

| Band | Trigger | Meaning |
|---|---|---|
| **PANCAKE** (def-favored extreme) | `extreme && delta<0` | blocker buries rusher / tackler de-cleats carrier / DB blankets. Loser stun `0.5+0.5*sev`s, knockback `1.5*sev` yd |
| **BLOW-BY** (atk-favored extreme) | `extreme && delta>0` | rusher/carrier/WR gone clean. Winner burst `1.05+0.13*sev`x for `0.3s` |
| **CLEAN WIN** | `win && sev>0.35` | decisive but not instant (fast shed, separation 1.5-3yd, clean tackle) |
| **STEP / GRIND-WIN** | `win && sev<=0.35` | half-step edge, ~1yd sep, late shed |
| **STALEMATE / GRIND** | `!win && mm<10` | the modal even-matchup result; pocket holds, mirror coverage, drag-down |
| **HELD / STUFFED** | `!win && delta<-10` | defender-favored sustained win (sticky coverage, sealed lane, TFL) |

**Why this honors the constraints:** mean `p` bends to the favorite with the gap (skill-vs-ratings balance — geometry/scheme enter only as `leverage`/`momentum` point-biases, so a human schemes the *angle* but ratings still decide the *collision*). The instant channel + sev both scale with `mm`, so **big gaps produce frequent AND extreme** events; the `TAIL` noise floor keeps **even matchups throwing ~5-8% dramatic tails**. All entropy is the one seeded `rng()`, so the two pre-baked POC teams replay identically headless.
