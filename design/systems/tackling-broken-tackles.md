# Tackling, Broken Tackles & Pursuit

> System spec — Gridiron Blitz rebuild. Auto-generated from the parallel research workflow; grounded in the cited sources below.

## Summary
A unified contest model where every defender's attempt to bring down the ball carrier resolves as a single weighted logistic roll: defender tackling power vs. carrier break-tackle power, modified by approach geometry (closing speed, hit angle), the human stick input (juke/sprint/truck shifts the matchup and the move's own success), and gang-tackle stacking. Pursuit is a continuous intercept-lead steering layer that decides WHERE/HOW HARD the collision happens; the tackle roll decides WHAT happens. Variance is governed by a single steepness constant so big rating gaps produce reliable blow-bys/pancakes while even matchups grind with occasional dramatic tails. The outcome is sampled from a weighted spectrum (clean stop, wrap-drag, stumble, shrug-off, broken tackle, truck-pancake) rather than a binary, with big-hit and fumble tails on the strong-defender end and blow-by tails on the strong-carrier end.

## Inputs (read each tick / decision)
- Ball carrier position (x,y) and velocity (vx,vy) in px/s
- Each defender position (x,y) and velocity (vx,vy)
- Defender top speed (pps) and current speed/momentum magnitude
- Carrier top speed and current speed/momentum magnitude
- Closing distance defender->carrier (px / yards)
- Approach/hit angle: angle between defender's velocity and carrier's velocity (head-on vs from-behind vs side)
- Whether defender is FREE or neutralized/engaged by a block (existing neutralized() flag)
- Human stick state for the carrier: turbo/sprint held, juke axis flick (left/right), truck input, spin input, stiff-arm input, and timing of that input relative to contact
- Number of defenders already inside the contact window on this carrier this frame (gang-tackle count)
- Defender ratings: TKL (tackle), HIT (hit power), STR, PUR (pursuit), ACC
- Carrier ratings: BTK (break tackle), TRK (trucking), ELU (elusiveness/juke), SPN (spin), SFA (stiff arm), STR, AGI, CAR (carrying/ball security)
- Leverage/situation flags: near sideline, near goal line, near first-down marker (affects desired aggression, not the core roll)
- dt (frame time)
- RNG stream (seeded per the two pre-rolled POC teams for determinism)

## Contest model
```
// ============ LAYER 1: PURSUIT (continuous steering; runs every frame) ============
// Lead-pursuit intercept (already in codebase as intercept()): aim where carrier WILL be.
// Refine the existing 3-iteration solver; clamp t so a slower defender can't aim past a reachable point.
function pursuitAim(def, car):
  sp = max(defTopSpeed * (0.85 + 0.15*PUR/99), 1)   // PUR sharpens the angle a fast defender can afford
  t  = dist(def,car)/sp
  repeat 3: t = dist(def, car.pos + car.vel*t)/sp
  t = min(t, 0.9)
  return car.pos + car.vel*t
// "Slower players need a WIDER angle" (coaching): if defTopSpeed < carTopSpeed, bias aim point
// further downfield (toward carrier's goal) by (carTopSpeed-defTopSpeed)*k so he cuts off rather than chases.
// PUR also drives how quickly the defender re-solves his angle when the carrier cuts (reaction lag in frames).

// ============ LAYER 2: CONTACT DETECTION (per frame) ============
// Contact window = within CONTACT_R (1.5 yd, from Big Data Bowl). TACKLE_R (0.95yd) = "in the wrap".
// Only FREE defenders (!neutralized) can initiate. Collect all defenders currently in CONTACT_R -> gang set G.

// ============ LAYER 3: THE TACKLE CONTEST (the shared kernel) ============
// ONE weighted logistic roll. Returns P(defender wins this collision).
// power = attacker rating composite; resist = carrier rating composite; both 0..99.

defPower(def, geo):
  base = 0.55*TKL + 0.25*HIT + 0.20*STR
  // geometry modifiers (BOOM Tech: weight/speed/angle/timing):
  base += closingBonus(def, geo)      // +0..+12 from defender momentum into the carrier
  base += angleBonus(geo)             // +8 head-on/squared, 0 side, -10 chasing from behind
  base += min(G.count-1,3)*GANG_STEP  // each extra hat in window: +9 (gang tackle)
  return base

carResist(car, stick):
  base = stick.truck ? (0.65*TRK+0.20*BTK+0.15*STR)        // truck contest -> power resist
       : stick.juke  ? (0.65*ELU+0.25*AGI+0.10*BTK)         // juke -> elusive resist (vs angle)
       : stick.spin  ? (0.60*SPN+0.25*AGI+0.15*BTK)
       : stick.stiff ? (0.55*SFA+0.25*STR +0.20*BTK)
       :               (0.60*BTK+0.25*STR+0.15*AGI)         // no move: passive break-tackle
  base += carMomentumBonus(car)        // +0..+10 from carrier speed (a back at full gallop is harder)
  return base

// SINGLE WEIGHTED ROLL (the kernel, shared across systems):
delta = defPower - carResist            // >0 favors defender
P_win = 1 / (1 + exp(-K * (delta - BIAS)))   // logistic. K=steepness=variance knob. BIAS tilts toward broken tackles.
roll  = rng()                            // [0,1)

// ============ LAYER 4: OUTCOME SELECTION (spectrum, not binary) ============
// Map (delta, roll, stickMove, G.count) to a band. margin = |delta|, m = margin scaled 0..1 (m=clamp(margin/40,0,1)).
// Defender side (roll < P_win): bigger delta+HIT -> harder outcome.
//   if delta>HIT_THRESH(18) and HIT high and angle head-on: BIG_HIT_STOP (+ fumbleChance)
//   elif delta>6: CLEAN_WRAP_STOP
//   else: WRAP_DRAG (carrier falls forward fallFwd = 0.4..1.4 yd by carrier STR/momentum)
// Carrier side (roll >= P_win):
//   if -delta>BLOWBY_THRESH(18) and stickMove succeeded cleanly: BROKEN_TACKLE / TRUCK_PANCAKE (defender stunned, knocked back)
//   elif -delta>6: SHED/SHRUG (defender grazes, carrier slows ~15%, keeps going)
//   else: STUMBLE (both: carrier loses 25-40% speed for STUMBLE_T, defender misses but recovers) -> the grind tail
// MISSED-MOVE PENALTY: a juke/spin/truck that LOSES (roll lands carrier-side-fail region) costs the carrier
//   momentum (slow to 35-50% for moveWhiff_T 0.25s) -> the risk that balances the reward.

// Human stick feeds in three ways: (1) swaps which carResist composite is used,
// (2) on a WIN multiplies the carrier-side outcome severity (full truck pancake vs mere shed),
// (3) on a LOSS applies the missed-move momentum penalty + raises fumbleChance if STR/CAR low.

// Determinism: rng is the seeded per-game stream so the two pre-rolled POC teams replay identically headless.
```

## Outcome spectrum
### BIG_HIT_STOP (pancake the carrier, possible forced fumble) — most exciting defender tail
- **When:** FREE defender with high HIT, head-on/squared angle, strong closing momentum, delta>18 over carrier; roll well under P_win
- **Weighting:** +HIT, +TKL, +STR, head-on angleBonus, high closing speed, low carrier CAR/STR raises fumbleChance (~6% base, up to ~20% on a perfect hit-stick mismatch). Hit-stick TIMING window gates the bonus (early/late = reduced power, BOOM Tech).

### CLEAN_WRAP_STOP — textbook tackle at the spot
- **When:** delta 6..18 favoring defender, decent angle, roll under P_win
- **Weighting:** +TKL dominant, moderate angle/closing; the default 'good defense' band on a rating edge

### WRAP_DRAG / DRAG_DOWN — defender wraps but carrier falls forward 0.4–1.4 yd, or is dragged a beat before going down
- **When:** delta near even (0..6) defender-favored, or 1 defender vs a strong carrier where a 2nd hat is arriving
- **Weighting:** carrier STR & momentum extend fallFwd; gang count >=2 converts a would-be break into a drag-down (each extra hat +9 power)

### STUMBLE / GRIND — glancing contact, carrier survives but loses 25–40% speed; defender misses but recovers
- **When:** |delta|<6 even matchup, roll lands in the central uncertainty band; the dominant outcome between evenly-rated players
- **Weighting:** near-zero delta widens this band; low K (variance) would widen further. This is the 'mostly a grind' core for even teams

### SHED / SHRUG-OFF — carrier breaks the arm tackle, slows ~15%, stays upright
- **When:** -delta 6..18 (carrier favored), passive break-tackle or a move that partially won
- **Weighting:** +BTK, +STR, +carrier momentum; weak-tackling defender (low TKL) or bad chasing angle pushes here

### BROKEN_TACKLE (juke/spin slips the defender clean) — carrier blow-by tail
- **When:** -delta>18, successful juke/spin against a slow/over-pursuing defender; roll above P_win
- **Weighting:** +ELU/SPN/AGI vs low TKL/PUR; defender chasing from behind (angle penalty) or beaten on his pursuit angle; big speed gap

### TRUCK_PANCAKE (run THROUGH the defender, knock him down/stun) — power blow-by tail
- **When:** -delta>18 with truck input, carrier TRK/STR >> defender TKL/HIT, carrier at speed
- **Weighting:** +TRK, +STR, +closing momentum vs low HIT/STR/TKL defender (Madden: 'low Hit power vs high truck = broken tackle'); defender knocked back + stunned for ~0.5s

### MISSED-MOVE WHIFF — carrier stutters/loses momentum because his juke/truck/spin FAILED
- **When:** carrier used a stick move but lost the roll (carrier-side-fail region)
- **Weighting:** the balancing risk: high when carrier spams a move into a well-rated defender; drops carrier to 35–50% speed ~0.25s, lets pursuit catch up, raises fumbleChance if CAR low

## Concrete numbers / heuristics
- CONTACT_R = 1.5 yd (33 px) — contact window; covers ~95% of first-contact distances (Big Data Bowl).
- TACKLE_R = 0.95 yd (existing) — the 'in the wrap' radius where the roll actually fires.
- Logistic steepness K = 0.11 per rating point (variance knob). At delta=20, P_win≈0.90 (reliable blow-by/pancate territory). At delta=0, P_win≈0.5−BIAS.
- BIAS = ~3 rating-points toward the carrier (so dead-even contact slightly favors the offense breaking the FIRST hat → forward progress feels alive; tune 0–5).
- defPower weights: 0.55*TKL + 0.25*HIT + 0.20*STR.
- carResist passive: 0.60*BTK + 0.25*STR + 0.15*AGI. Truck: 0.65*TRK+0.20*BTK+0.15*STR. Juke: 0.65*ELU+0.25*AGI+0.10*BTK. Spin: 0.60*SPN+0.25*AGI+0.15*BTK. Stiff: 0.55*SFA+0.25*STR+0.20*BTK.
- angleBonus: +8 head-on (squared up), 0 from the side (±60°), −10 chasing from directly behind. Lerp by the angle between velocity vectors.
- closingBonus: +0..+12, = 12 * clamp(defSpeed/defTopSpeed,0,1) * (component of closing toward carrier). carMomentumBonus & carMomentumResist symmetric, +0..+10.
- GANG_STEP = +9 power per extra defender in the contact window, capped at 3 extra (+27). Two evenly-matched hats reliably beat almost any carrier (gang tackle).
- HIT_THRESH (big-hit) = delta>18 AND HIT>=80 AND head-on. BLOWBY_THRESH = -delta>18.
- fumbleChance: base 0.06 on any stop; +scaled by (HIT−CAR)/99 up to ~0.20 on a clean hit-stick; +0.05 if carrier whiffed a stick move; stiff-arm with extra hats nearby +0.04.
- Momentum penalties: STUMBLE drops carrier to 60–75% speed for STUMBLE_T=0.30s; MISSED-MOVE whiff drops to 35–50% for 0.25s; TRUCK_PANCAKE stuns defender 0.5s (reuse existing stun field) and knocks him back ~0.6 yd.
- SHED slows carrier ~15% (one-time) and lets the defender re-pursue. WRAP_DRAG fallFwd = 0.4–1.4 yd by carrier STR/momentum.
- Calibration intent (averages are NOT the goal, spread is): 99-vs-50 mismatch → desired band hit ~85–90% of the time (dramatic, readable); 75-vs-75 even → STUMBLE/GRIND ~55–60%, with ~8–12% dramatic tails (broken tackle or big hit) for the X-factor moments.
- Existing turbo break-tackle hack (rng()<0.12 while sprinting) should be REPLACED by this contest so sprint feeds closingBonus + carMomentum instead of a flat 12%.
- Pursuit PUR speed factor: effective angle-solve speed = defTopSpeed*(0.85+0.15*PUR/99); PUR also sets cut-reaction lag ~ (1 − PUR/99)*0.18s.

## Ratings used
- DEFENDER: TKL (tackle) — primary, anchors defPower
- DEFENDER: HIT (hit power) — drives big-hit band + forced-fumble tail
- DEFENDER: STR (strength) — drag-down/anchor and resists truck
- DEFENDER: PUR (pursuit) — sharpens intercept angle + cut-reaction speed (Layer 1)
- DEFENDER: ACC/SPD — feeds closing speed bonus and whether the angle is reachable
- CARRIER: BTK (break tackle) — primary passive resist
- CARRIER: TRK (trucking) — power-move resist + truck-pancake tail
- CARRIER: ELU (elusiveness/juke) — juke resist + broken-tackle tail
- CARRIER: SPN (spin), SFA (stiff arm) — their respective stick-move composites
- CARRIER: STR — power resist, drag-down survival, fallFwd
- CARRIER: AGI/SPD — feeds elusive moves + momentum bonus
- CARRIER: CAR (carrying/ball security) — lowers fumbleChance on big hits and missed moves

## Variance model
A SINGLE logistic with steepness K=0.11/pt converts the rating delta into P_win, so variance is fully governed by where on the curve a matchup sits. Big mismatch (|delta|>=18): the curve is near-saturated (P≈0.9), so the dramatic band (blow-by, pancake) fires reliably and looks deterministic to the player — exactly the design ask. Even matchup (|delta|<6): P sits near 0.5 and the OUTCOME-SELECTION bands are widest around zero, so most reps land in STUMBLE/GRIND, yet the same uniform roll occasionally lands in a tail band → the X-factor moment between equals. The tails are intrinsic to the logistic+band mapping, not a separate RNG: lowering K flattens everything toward 50/50 (more grind, fewer dramatic outcomes); raising K makes ratings more deterministic and tails rarer for even teams but more extreme for mismatches. BIAS shifts the whole field toward broken tackles so forward progress stays lively. Geometry (angle, closing, gang count) shifts delta per-collision, so the SAME two players produce different spreads depending on leverage — a clean head-on hit-stick vs a desperate from-behind chase — which is what makes outcomes readable. fumbleChance and the missed-move penalty are the only auxiliary rolls, and both scale off the same delta so they too sharpen with mismatch.

## Dependencies
- Shared CONTEST KERNEL: the logistic roll P_win=1/(1+exp(-K*(delta-BIAS))) MUST be the same function the block-shedding system (existing shedRating/blockRating delta) and the rush/catch contests use, so K and the rating scale stay consistent game-wide.
- Blocking/shed system: this system only fires for FREE defenders — relies on the existing neutralized()/blocked/shed flags to decide who can attempt a tackle. A shed defender becomes a tackler input.
- Player movement/steering: pursuit Layer 1 writes the steering target; consumes pps()/SPEED and the existing intercept() solver (to be upgraded with PUR + wider-angle-for-slower).
- Human input system: reads turbo/juke/spin/truck/stiff-arm + timing; the existing rng()<0.12 turbo hack must be removed in favor of this contest.
- Ratings/roster source of truth: needs TKL,HIT,PUR,STR,BTK,TRK,ELU,SPN,SFA,CAR,AGI per player added to the data model (current code has no per-player ratings beyond hardcoded BLOCK_RATING/shedRating tables — those should fold into the same ratings struct).
- Fumble/loose-ball system: fumbleChance output feeds the existing BallState tip/loose-ball handling.
- endPlay({type:'tackle'}): consumes the final go-down event and spot (existing).
- Seeded RNG stream: same per-game seed used elsewhere so the two pre-rolled POC teams stay deterministic in headless tests.

## Sources
- https://www.thegamer.com/madden-25-boom-tech-hit-stick-explained/
- https://www.ea.com/technology//news/boom-tech-ea-sports-madden-nfl-25
- https://www.ea.com/en/games/madden-nfl/madden-nfl-25/news/gridiron-notes-madden-25-gameplay-deep-dive
- https://madden.fandom.com/wiki/Attributes
- https://www.madden-school.com/madden-17-ball-carrier-special-moves-details/
- https://www.dexerto.com/madden/how-to-juke-in-madden-25-every-skill-move-and-setup-state-explained-2863098/
- https://realsport101.com/article/madden-22-running-guide-controls-how-to-juke-truck-spin-stiff-arm-sprint-hurdle-jurdle-protect-ball
- https://sportmentary.com/football/football-basics/footballs-angle-of-pursuit/
- https://www.xandolabs.com/the-lab/defense/fundamentals/pursuit/6-in-season-pursuit-drill-progressions/
- https://www.nature.com/articles/s41598-025-85993-1
- https://arxiv.org/html/2403.14769v2
- https://www.sportsdefinitions.com/american-football/gang-tackle/
- https://gamefaqs.gamespot.com/nes/587686-tecmo-super-bowl/faqs/44195
- https://tecmobowl.org/forums/topic/4870-button-mashing/
