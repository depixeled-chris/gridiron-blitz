# QB AI — CPU quarterback decision-making (progression reads, throw timing, pressure response, target selection)

> System spec — Gridiron Blitz rebuild. Auto-generated from the parallel research workflow; grounded in the cited sources below.

## Summary
The CPU QB runs a per-tick decision loop over the dropback: it advances through an ordered progression (primary → secondary → checkdown) on a clock gated by AWR, scores each read's "openness" from receiver separation, defender leverage, and the closing-defender window, and fires a weighted throw-roll the instant a read crosses a confidence threshold or its route hits its break point. A parallel pressure model converts nearest-rusher distance/time into a fear value that can override the progression (climb, scramble, throwaway, or panic-throw). Throw outcome (on-target / inaccurate / batted / picked) is a single weighted roll feeding the shared contest kernel, where the spread of dramatic outcomes scales with the QB-rating-vs-coverage mismatch — a great QB vs soft coverage hits dimes into tight windows, a weak QB under pressure sails picks. Ratings bind the SPEED and CONFIDENCE of decisions and the accuracy of the ball; human skill (for the controlled team) bypasses this, but the 10 AI teammates and the opposing QB all run this model.

## Inputs (read each tick / decision)
- Ball/QB state: QB x,y,vx,vy, time since snap (snapElapsed), whether ball still carried
- Dropback phase: dropping | set | scanning | scrambling | throwing
- Per-receiver: current x,y, routeIdx, route node list (break points in yards converted to px), hasReachedBreak, downfield depth
- Per-receiver nearest defender: distance (px), defender closing velocity toward receiver, defender leverage side (inside/outside relative to receiver-vs-QB line), defender speed rating, whether defender's back is turned / trailing
- Coverage shell (man/cover2/cover3/cover4) and press flag from DefensePlay — used for pre-snap MOFO/MOFC bias and zone-window vs man-trail openness
- Pass-rush state: nearest unblocked or shed rusher distance to QB, that rusher's closing speed, count of shed/engaged DL (Player.shed, Player.engaged already in types), pocket integrity (lateral room left/right)
- Play context: down, toGo, ballOn (field position), clock — biases checkdown vs shot and throwaway legality
- QB ratings: AWR, THP, SAC/MAC/DAC (short/mid/deep accuracy), SPD/ACC (scramble), PLZ (pocket presence), PBK is OL not QB
- Designed progression order for the called play (primary/secondary/checkdown receiver keys), with per-read 'open-by' timing offset
- Pre-rolled determinism seed (per-snap RNG stream) for reproducible headless tests

## Contest model
```
// ===== Per-tick QB decision loop (runs every frame while ball is carried by QB) =====
// All distances in px; 1 yd = PX_PER_YD (read from constants.ts). Ratings 0..99.
r(x) = clamp((x-50)/50, -1, 1)   // normalize a rating to ~[-1,1] around average 50

// ---- 1. Progression clock (AWR gates read SPEED) ----
// Base time to "process" one read before eyes move on:
readDwell = 0.62 - 0.28*r(AWR)          // sec/read: AWR99 ~0.34s, AWR50 0.62s, AWR20 ~0.79s
setTime   = 0.9 - 0.25*r(PLZ)           // drop+set before scanning begins (~0.65..1.15s)
currentReadIndex = floor((snapElapsed - setTime) / readDwell)   // 0=primary,1=secondary,2=checkdown
maxReads = (AWR>=80?4 : AWR>=60?3 : AWR>=40?2 : 1)              // low AWR never reaches deep reads
activeRead = progression[min(currentReadIndex, maxReads-1, progression.length-1)]

// ---- 2. Openness score per read (target selection) ----
// sep      = receiver-to-nearestDefender distance in YARDS
// breakBonus: route just broke → defender momentarily out of phase
// leverage: +good if defender is on wrong side of the throwing lane
// closing: defender velocity component toward the catch point shrinks the window
openness(rec) =
    SEP_W   * clamp(sep/3.0, 0, 1.4)                 // 3 yd of separation = "open" (1.0)
  + BREAK_W * (rec.hasReachedBreak && timeSinceBreak<0.35 ? 1 : 0)
  + LEV_W   * leverageSign(rec)                      // +0.5 throwing away from defender, -0.5 into him
  - CLOSE_W * clamp(defClosingYpS/6.0, 0, 1)         // fast-closing defender kills the window
  - ZONE_W  * zoneSink(rec)                          // throwing into a sitting zone defender's landmark
  + MATCH_W * r(rec.SPD - nearestDef.SPD)            // receiver vs DB speed mismatch (Madden 'matchup' logic)
// weights: SEP_W=1.0 BREAK_W=0.45 LEV_W=0.5 CLOSE_W=0.6 ZONE_W=0.4 MATCH_W=0.35

// ---- 3. Throw trigger ----
// Confidence to pull trigger rises with AWR and aggressiveness, falls with INT-risk + situation.
throwThreshold = 0.95 - 0.20*r(AWR) - 0.25*aggression + situationGuard
  // aggression: trait knob [-1 conservative .. +1 gunslinger]; conservative QB demands more openness
  // situationGuard: +0.15 if 3rd&long shot needed less; +0.25 near own goal (protect ball)
FIRE when (openness(activeRead) >= throwThreshold)
       OR (activeRead.hasReachedBreak AND openness>=throwThreshold-0.2)   // anticipation throw on break
       OR (pressureFear >= PANIC and bestAvailableOpenness>0)             // pressured throw to best read so far
// If currentReadIndex exhausts maxReads AND nothing open → go to checkdown/scramble/throwaway branch.

// ---- 4. Pressure model (parallel, can override progression) ----
rusherTime = nearestRusherDist / max(nearestRusherClosingSpeed, 0.1)   // sec until contact
pressureFear = clamp( (1.6 - rusherTime)/1.6 , 0, 1) * (1 - 0.4*r(PLZ)) // PLZ buys composure
// Branch on rising fear, modulated by pocket room:
if pressureFear>0.35 and pocketRoomForward>2yd: action=CLIMB (step up, +0.5s clock)
elif pressureFear>0.55 and edgeOpen:            action=SCRAMBLE (if SPD>70 or scrambleEV>throwEV)
elif pressureFear>0.75 and noOpenRead:          action=THROWAWAY (if outsidePocket & past LOS legal) else SACK-take-or-PANIC
panicThrow chance = aggression>0.3 ? clamp(pressureFear-0.5,0,1) : 0   // gunslingers force it (Panic Button trait)

// ---- 5. Throw outcome = SINGLE weighted roll into shared contest kernel ----
// distanceBand: 'short'(<20yd) 'mid'(20-40) 'deep'(>40) selects accuracy rating ACC{S,M,D}
baseAcc = ACC_band/100
onRunPenalty = movingFast ? 0.18 : 0;  pressurePenalty = 0.22*pressureFear
windowPenalty = 0.15*(1 - clamp(sep/3,0,1))          // tight window = lower placement
placement = clamp(baseAcc - onRunPenalty - pressurePenalty - windowPenalty + 0.10*r(AWR), 0.05, 0.99)
// contest kernel weighted roll over {ON_TARGET, INACCURATE, BATTED, INTERCEPTED}:
wON  = placement
wOFF = (1-placement)*0.55
wBAT = (1-placement)*0.15 * batRiskFromRusherInLane
wINT = (1-placement)*0.30 * (0.3 + 0.7*defClosingFactor) * (aggression>0?1.3:1.0)
roll ~ weightedPick({ON_TARGET:wON, INACCURATE:wOFF, BATTED:wBAT, INTERCEPTED:wINT}, seedRNG)
// THP sets ball flight speed (px/s) and arc: ballSpeed = 22 + 0.30*THP (yd/s); deep throws need THP≥85 to not 'hang'.
```

## Outcome spectrum
### Strip-sack / panic interception (worst for offense)
- **When:** pressureFear>0.85 with no open read and aggression>0.3 forces a blind throw, or QB holds past 3.5s and a shed DL arrives
- **Weighting:** Big NEGATIVE mismatch: low QB AWR/PLZ vs high DL shed rate and high DB closing; gunslinger trait + 3rd&long; near own goal multiplies the disaster

### Coverage sack / take-the-sack
- **When:** rusherTime<0.4s, no edge to escape, AWR too low to have reached an open read, throwaway illegal (in pocket)
- **Weighting:** Low AWR (slow reads) + low PLZ (no climb) + low SPD (can't scramble) vs fast pass rush; even matchup makes this rare (~6-8%)

### Forced throw into tight window → contested / batted
- **When:** clock exhausted maxReads, best openness below threshold but pressure forces a throw to the least-bad read
- **Weighting:** Window tightness (sep<1.5yd), defender in throwing lane, mid AWR; raises wBAT/wINT in the kernel roll

### Smart throwaway / live-to-next-down
- **When:** pressureFear>0.75, QB outside pocket past LOS, Throw Away trait, no read open
- **Weighting:** High AWR + conservative aggression + late down where field position matters; mobile QB reaches the edge first

### Checkdown completion (the grind)
- **When:** primary/secondary covered, clock reaches read 2-3, RB/TE underneath has 3+ yd cushion
- **Weighting:** The default even-matchup result; AWR high enough to find read 3; short-accuracy ACC_S drives completion

### On-time intermediate completion
- **When:** anticipation throw fired AT the break point (timeSinceBreak<0.35) before defender recovers
- **Weighting:** High AWR (early trigger) + good MAC; receiver SPD>DB SPD widens the break window; the 'competent opponent' baseline

### Scramble for chunk yards
- **When:** pressureFear>0.55, edge open, SPD>70 and scrambleEV exceeds throwEV (Hero Ball / Eyes Up traits)
- **Weighting:** High SPD/ACC vs collapsed coverage downfield; light box; spread of yards scales with SPD-vs-pursuit mismatch

### Dime into a tight window (best for offense)
- **When:** high AWR fires early anticipation throw, high DAC/THP places ball away from leverage, receiver wins at break
- **Weighting:** Big POSITIVE mismatch: elite QB AWR+ACC+THP vs slow/poor-leverage DB; one-on-one shot opportunity; even matchups still throw this as a rare exciting tail (~3-5%)

## Concrete numbers / heuristics
- readDwell = 0.62 - 0.28*r(AWR): AWR99≈0.34s/read, AWR50≈0.62s, AWR20≈0.79s
- setTime (drop+set) = 0.9 - 0.25*r(PLZ) ≈ 0.65..1.15s before scanning
- maxReads: AWR>=80→4, >=60→3, >=40→2, else 1 (low AWR never reaches deep reads)
- Real NFL anchors: pressure >60% likely past 3.0s; trouble past 3.5s; pocket creation ~0.42s avg (use as climb bonus +0.5s)
- 'Open' separation = 3.0 yd (openness SEP term saturates ~4.2yd); tight window <1.5yd
- Openness weights: SEP_W=1.0, BREAK_W=0.45, LEV_W=0.5, CLOSE_W=0.6, ZONE_W=0.4, MATCH_W=0.35
- throwThreshold = 0.95 - 0.20*r(AWR) - 0.25*aggression (+guards); anticipation allowance -0.2 at the break
- pressureFear = clamp((1.6 - rusherTime)/1.6,0,1)*(1-0.4*r(PLZ)); CLIMB>0.35, SCRAMBLE>0.55(&SPD>70), THROWAWAY/PANIC>0.75
- Accuracy bands: short <20yd, mid 20-40yd, deep >40yd (Madden THA split)
- placement penalties: on-the-run -0.18, pressure -0.22*fear, tight window -0.15, +0.10*r(AWR); clamp 0.05..0.99
- Outcome split of the miss (1-placement): 55% inaccurate, 15% batted*laneRisk, 30% INT*closingFactor; gunslinger INT x1.3
- ballSpeed ≈ 22 + 0.30*THP yd/s; deep throws hang unless THP>=85
- Scramble trigger SPD threshold 70; gunslinger panic-throw aggression>0.3
- Baseline even-matchup mix target: ~55-60% completions, ~6-8% sacks, ~2-3% INT, with fat dramatic tails on mismatch

## Ratings used
- QB AWR (Awareness): read SPEED, max reads reached, trigger confidence, +placement bonus, pressure recognition — the master QB-IQ knob
- QB PLZ (Pocket Presence): composure under pressure (dampens pressureFear), enables climb, lengthens set time tradeoff
- QB ACC_S/ACC_M/ACC_D (short/mid/deep accuracy): base ball placement by throw-distance band
- QB THP (Throw Power): ball flight speed and arc; gates whether deep throws beat closing defenders or hang
- QB SPD/ACC (Speed/Acceleration): scramble viability and scramble-yards spread
- Aggression trait knob [-1..+1] (Conservative/Ideal/Gunslinger; Madden Decision-Making + Panic Button/Throw Away/Hero Ball): shifts threshold, panic-throw, INT multiplier
- DEFENSE side: DB SPD (matchup term + closing speed), defender leverage side, DL shed/engaged (from Player.shed/engaged) for rusherTime, coverage shell for zone-window vs man-trail openness

## Variance model
Variance is injected by widening the outcome-weight spread as a function of the QB-vs-coverage rating delta, not by tweaking averages. Define mismatch M = r(QB_decisionStack) - r(defenseStack), where QB_decisionStack blends AWR/ACC/PLZ on the read being thrown and defenseStack blends covering DB SPD/leverage + rusher pressure. A BIG positive M sharpens placement toward 0.99 AND inflates the BATTED/INT weights to near-zero, so elite-vs-weak produces dimes and blow-by completions frequently (the pancake-equivalent for passing). A BIG negative M does the inverse: placement collapses and INT/batted weights balloon, so weak-QB-vs-strong-coverage throws frequent disasters. Near M≈0 (even matchup) the kernel sits in a tight grind band (checkdowns, contested mids) but retains a fixed small 'X-factor' floor: every weighted roll keeps a minimum 3-5% mass on each dramatic tail (dime AND pick) regardless of M, so even balanced snaps occasionally pop. Concretely, scale the loss-side weights by tailGain = 1 + 1.5*|M| and clamp placement spread by (0.06 + 0.10*|M|) of jitter from seedRNG, with a floor jitter of 0.06 so nothing is ever fully deterministic-feeling except the pre-rolled POC seed. The human-controlled QB bypasses readDwell/threshold (player aims/triggers directly) but the SAME placement and contest-kernel roll apply, so human skill schemes the open man while ratings still bind whether the ball arrives true.

## Dependencies
- Contest kernel (shared weighted-roll model): throw outcome {ON_TARGET, INACCURATE, BATTED, INTERCEPTED} must be a single weighted pick compatible with the synthesis kernel; openness and placement feed it
- Pass-rush / block-shed system: supplies nearestRusherDist, closing speed, shed/engaged DL (Player.shed, Player.engaged) that drive pressureFear and rusherTime
- Coverage/DB AI system: supplies per-receiver nearest defender, leverage side, closing velocity, zone landmarks, and the man/cover2/3/4 shell from DefensePlay
- Receiver route runner: supplies hasReachedBreak / routeIdx timing (break points already encoded as RouteNode fwd/lat in plays.ts) for anticipation throws
- Ball flight system: consumes ballSpeed/arc from THP and the launch/landing points (BallState sx,sy,tx,ty,peak already in types.ts)
- Scramble/ballcarrier system: receives the SCRAMBLE handoff when QB tucks and runs (reuses ballcarrier contest logic)
- Constants (PX_PER_YD, field bounds, clock) from constants.ts for px<->yd conversion and field-position guards
- Per-snap deterministic RNG seed for the two pre-rolled POC teams (headless reproducibility)

## Sources
- https://www.ea.com/games/madden-nfl/madden-nfl-26/news/madden-26-gridiron-notes-gameplay-deep-dive
- https://www.gamesradar.com/games/madden-nfl/madden-26-qb-traits/
- https://www.operationsports.com/madden-26-new-ai-traits/
- http://www.vhpg.com/madden-24-quarterback-ai/
- http://www.megabearsfan.net/post/2020/07/27/How-Madden-Fails-to-Simulate-Football-Quarterback-Progressions.aspx
- https://www.ea.com/news/madden-25-qb-ratings
- https://www.pff.com/news/nfl-the-perfect-timing-a-deeper-dive-into-time-to-throw-data
- https://www.milehighreport.com/denver-broncos-stats/155356/creating-time-in-the-pocket
- https://athletesuntapped.com/blog/deciphering-the-defense-mastering-football-coverage-recognition/
- https://www.sportsunlimitedinc.com/blog/the-complete-guide-to-the-football-route-tree/
- https://ftnfantasy.com/nfl/lessons-from-interception-worthy-throws
