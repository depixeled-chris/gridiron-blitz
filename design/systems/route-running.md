# Route Running

> System spec — Gridiron Blitz rebuild. Auto-generated from the parallel research workflow; grounded in the cited sources below.

## Summary
Receivers run as a state machine along stem/break waypoints, but the engine layers a "release contest" at the line (press vs beat-press) and a continuous "separation" model at each break and through the stem. Separation is a scalar (yards of daylight between WR and his nearest man defender at the catch point) produced by a single weighted-roll contest kernel: it is driven by rating deltas (route-running, agility, speed, release vs press/man-coverage/play-recognition), modulated by route geometry (sharp breaks generate more instantaneous separation than speed cuts), and scaled by leverage. Variance scales with the magnitude of the rating mismatch, so a 25-point edge frequently produces blow-by separation (3+ yd) while even matchups grind to ~1 yd with occasional RNG tails. The QB/catch system consumes the separation scalar to size a catch window; this spec exposes the contest math so the synthesis pass can fold press/break/separation rolls into the shared kernel.

## Inputs (read each tick / decision)
- WR position/velocity (x,y,vx,vy) and snap origin (ox,oy)
- Assigned man defender position/velocity, or in zone the nearest zone defender and his landmark
- Current route waypoint (fwd/lat in yards) and route segment type (stem / break / settle / vertical)
- Route depth class (quick 0-5yd, intermediate 6-15yd, deep 15+yd) -> selects SRR/MRR/DRR rating
- Defender leverage sign (inside/outside) relative to WR and break direction
- press tightness from DefensePlay.press (0..1) and coverage type (man/cover2/3/4)
- WR ratings: SPD, ACC, AGI (change-of-direction), RLS (release/beat-press), RRS/RRM/RRD (route running by depth), CTH/CIT (catch), STR
- DB ratings: SPD, ACC, AGI, PRS (press), MCV (man cover), ZCV (zone cover), PRC (play recognition), STR
- Time since snap (liveTime) and time since the WR entered the current break
- Distance WR-to-defender (current cushion), ball-in-air flag and predicted catch point
- Deterministic seed via existing rng() for reproducible pre-rolled-team tests

## Contest model
```
// All contests use the shared weighted-roll kernel:
//   win(att,def, base, k) -> delta = att-def (clamped -40..40)
//   p = clamp(base + k*delta/100, 0.02, 0.98)
//   roll = rng(); won = roll < p ; margin = (p - roll)  // signed quality of result
//
// ---- 1. RELEASE CONTEST (only when press>0.5 and defender within 1.5yd at snap) ----
// att = 0.6*WR.RLS + 0.4*WR.STR ;  def = 0.6*DB.PRS + 0.4*DB.STR
// pRelease = clamp(0.5 + 0.7*(att-def)/100, 0.05, 0.95)  // base .5, k=70 (high stakes)
// Apply press tightness: pRelease -= (press-0.5)*0.25
// Outcomes by margin m=(pRelease-roll):
//   m < -0.25 : JAMMED  -> WR speed *0.45 for 0.4s, route start delayed ~0.4s, jamYards=+0.5 toward DB leverage
//   -0.25..0  : RE-ROUTED -> WR speed *0.7 for 0.25s, knocked ~0.4yd off intended release lane
//   0..0.25   : CLEAN -> no penalty, normal stem
//   m > 0.25  : QUICK WIN -> WR carries +0.4yd built-in separation into the stem (releaseSep)
//
// ---- 2. STEM TRACKING (continuous, every tick during route, no press or post-release) ----
// Defender mirrors via existing intercept(); the model adds a separation accumulator:
//   trail = signed downfield gap (yd) of DB behind WR along route tangent
//   In man, DB closes at speedMul = clamp(0.97 + 0.06*(DB.SPD-WR.SPD)/100, 0.90, 1.04)  (speed/strength bound to ratings, not skill)
//
// ---- 3. BREAK CONTEST (fires once when WR reaches a waypoint that changes heading >35deg) ----
// rr = depth-appropriate route rating: <=5yd SRR, 6-15 MRR, >15 DRR
// att = 0.55*rr + 0.45*WR.AGI ;  def = 0.55*DB.MCV + 0.45*DB.AGI   (zone: def=0.5*DB.ZCV+0.3*DB.PRC+0.2*DB.AGI)
// breakAngle in deg; cutType: speedCut if angle<=45 else sharpCut
// sepGain (yards of instantaneous separation created at the break):
//   base = sharpCut ? 1.6 : 0.9    // sharp 90deg cut throttles down 2-3 steps but snaps open; speed cut rounds, less sep
//   sepGain = base * (0.5 + clamp(0.5 + 0.8*(att-def)/100, 0.05, 1.2))
//   leverageBonus: if WR breaks AWAY from DB leverage, *1.35 ; if INTO leverage (DB sitting on it), *0.6
//   WR pays a re-accel cost: WR speed *= (sharpCut?0.78:0.90) for (sharpCut?0.45:0.25)s, scaled by ACC:
//     speedFloor = lerp(0.70, 0.85, WR.ACC/99) ; recovery time *= lerp(1.2,0.8,WR.ACC/99)
//   DB break-react lag: DB cannot redirect for reactLag = lerp(0.30,0.08,DB.PRC/99) s after WR's cut -> DB keeps old heading, separation opens
//
// ---- 4. SEPARATION SCALAR (consumed by catch system at predicted catch point) ----
// separation(yd) = baseCushion + accumulatedBreakSep + releaseSep - dbClose
//   where dbClose grows when DB.SPD>WR.SPD over the route duration.
//   Clamp 0..6. This is the single number the catch/throw system reads to size the window.
//
// ---- 5. SIGHT ADJUST (vs coverage, only on adjustable routes: hitch/curl/option/seam) ----
// read DB depth+leverage + safety presence at stemEnd:
//   if coverage deep-shell (cover2/3/4 safety over top) AND route was vertical -> convert to settle/comeback at stemDepth (sit in window)
//   if man with inside leverage AND route is option -> break outside, vice versa
//   adjust success gated by min(WR.RRx, QB sees same read) ; mismatch -> WR & QB disagree (rare bad-timing incompletion tail)
```

## Outcome spectrum
### PRESS PANCAKE / JAMMED OFF ROUTE
- **When:** Press defender with big PRS+STR edge wins the release roll by a large margin; WR stuck at the line, route killed, QB has no one to throw to on that side
- **Weighting:** DB(PRS,STR) >> WR(RLS,STR); high press tightness (>0.8); becomes frequent at >20pt delta, rare/near-zero at even or negative delta

### RE-ROUTED / OFF-TIMING
- **When:** DB wins release modestly; WR gets into route 0.25-0.4s late and a half-yard off track, breaks land out of rhythm
- **Weighting:** Small positive DB release delta; intermediate press; common in even matchups as the grind outcome

### CLEAN RELEASE, COVERED BREAK (~1yd sep)
- **When:** Even matchup: WR releases clean but DB mirrors the break; ~1yd window, contested throw
- **Weighting:** Near-zero deltas across release/break; this is the modal even-matchup result

### SEPARATION AT THE BREAK (1.5-3yd open)
- **When:** WR wins the break roll: sharp cut away from DB leverage, DB react-lag, WR snaps open in the window
- **Weighting:** WR(RR_depth,AGI) > DB(MCV,AGI); breaking away from leverage (*1.35); sharp cut; low DB.PRC (long reactLag)

### BLOW-BY / TOASTED (3-6yd, uncovered)
- **When:** WR with speed+release edge wins release clean then stacks the DB vertically or double-moves; DB trails badly, wide-open deep shot
- **Weighting:** WR(SPD,RLS,DRR) >> DB(SPD,MCV,PRC); deep route; happens often at >25pt speed/route delta, the high tail of the distribution

### SIGHT-ADJUST CONVERSION (settle in zone window)
- **When:** WR reads deep shell, converts vertical to comeback/sit in the soft spot; QB agrees, easy completion in the hole
- **Weighting:** WR.RRx high enough to make the read; zone coverage with safety over top; rewards smart play over raw athletic delta

### PICK-PRONE / READ MISMATCH (bad-timing tail)
- **When:** WR and QB disagree on a sight adjust, or WR loses break badly and DB (high PRC/MCV) jumps the route
- **Weighting:** DB(PRC,MCV) >> WR(RRx); option/adjustable routes; rare exciting negative tail, more likely at large negative WR delta

## Concrete numbers / heuristics
- Press contest fires only if press>0.5 AND DB within 1.5 yd (33px) of WR at snap
- pRelease = 0.5 + 0.70*(attRelease-defPress)/100, clamped 0.05..0.95; press tightness subtracts up to 0.125
- Jam penalty: WR speed *0.45 for 0.4s + ~0.4s route delay; re-route: *0.7 for 0.25s
- Break fires when heading change >35deg at a waypoint; speed cut <=45deg, sharp cut >45deg
- sepGain base: 1.6 yd (sharp) / 0.9 yd (speed cut), scaled 0.5..1.2x by (att-def); leverage *1.35 away / *0.6 into
- WR re-accel after break: speed *0.78 (sharp)/*0.90 (speed) for 0.45/0.25s; floor lerp 0.70..0.85 by ACC
- DB break-react lag = lerp(0.30,0.08,DB.PRC/99) seconds of frozen heading
- Man chase speedMul = clamp(0.97 + 0.06*(DB.SPD-WR.SPD)/100, 0.90, 1.04)
- Separation scalar clamped 0..6 yd; ~1 yd modal at even matchup, 3-6 yd in blow-by tail
- Waypoint arrival threshold 0.5 yd (existing); route depth bins: 0-5 / 6-15 / 15+ yd
- Rating delta clamped to +-40 before use in any roll; base probs 0.5 (release/break), k=70 (release) / variable (break)
- Reuse existing seedable rng() (xorshift, returns 0..1) so pre-rolled teams are deterministic

## Ratings used
- WR: SPD (speed/stem chase), ACC (re-accel out of break), AGI (change-of-direction at break), RLS (release/beat-press)
- WR: RRS/RRM/RRD route running short/med/deep (break separation + sight-adjust reads), CTH/CIT (handoff to catch system), STR (press contest)
- DB: SPD (close cushion), ACC, AGI (mirror breaks), PRS (press/jam at line), MCV (man mirror), ZCV (zone break-on-ball), PRC (play recognition -> break-react lag + jumping routes), STR (press)

## Variance model
Each contest uses roll=rng() vs a probability p set by the rating delta. To make variance scale with mismatch (per owner constraint), the OUTCOME magnitude (not just win/loss) is amplified by |delta|: sepGain and jam penalties multiply by spreadFactor = 1 + 0.9*|att-def|/40, so a 40-pt edge can nearly double the separation (toward blow-by) or the jam severity (toward pancake), while a 0-pt matchup keeps outcomes compressed near the modal ~1yd. Even matchups still get tails: a small uniform jitter is added to sepGain (+-0.5 yd * (1 - |delta|/40)) plus a rare X-factor crit (rng()<0.04 doubles the winner's break sep) so a grind occasionally pops a dramatic, readable result. Win PROBABILITY moves with delta (k=70 for release, ~50 for break) while the SPREAD of the result moves with |delta|; this keeps averages near-realistic but maximizes the dramatic readable spread the owner wants. All randomness flows through the single seedable rng() for reproducible headless tests.

## Dependencies
- Shared contest kernel (synthesis pass): release roll, break roll, and separation accumulation must be expressed as weighted rolls compatible with block-shed and tackle-break kernels
- Catch/throw + ball-flight system: consumes the separation scalar to size catch window, and CTH/CIT/contested-catch at the catch point (separation -> p(complete) and p(INT)) — see constants INT_CHANCE/CATCH_R/REACH
- Coverage AI (man/zone): provides assigned defender, leverage sign, zone landmark, and press flag; reads coverage shell for sight adjusts
- Player movement core: moveToward/steer and pps(p) per-player speed must accept transient speed multipliers from jam and break re-accel
- Ratings model / pre-rolled team data: needs WR (RLS,RRS,RRM,RRD,AGI,ACC,STR) and DB (PRS,MCV,ZCV,PRC,AGI,STR) added to the player rating tables (currently only BLOCK_RATING/shedRating exist)
- Route data format: RouteNode list needs per-node metadata (segment type / adjustable flag / cutType) or the engine must infer break angle from successive nodes

## Sources
- https://maddenunderground.com/new-madden-mechanics-dbwr-interaction/
- https://madden.fandom.com/wiki/Attributes
- https://athletesuntapped.com/blog/breaking-the-coverage-mastering-route-separation-mechanics-in-football/
- https://www.bigblueview.com/2023/5/30/23742809/summer-school-receiver-route-types-and-combinations
- https://blogs.usafootball.com/blog/7085/coaching-the-wide-receiver-the-speed-cut
- https://simplifaster.com/articles/breakpoint-mechanics-separation-football/
- https://old.muthead.com/forums/madden/mut-discussion/168030-fully-detailed-meaning-of-each-attribute-keep-this
