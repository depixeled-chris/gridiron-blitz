# Run Fits & Ball-Carrier Vision

> System spec — Gridiron Blitz rebuild. Auto-generated from the parallel research workflow; grounded in the cited sources below.

## Summary
A two-sided run system. DEFENSE: every front-seven/support defender owns a numbered gap with a fit-role (FORCE = set the edge, SPILL = wrong-arm/squeeze the ball back inside, FILL/ALLEY = pursue inside-out), holding the gap until the back commits then attacking downhill on an inside-out leverage angle; Play Recognition gates how fast they read and re-fit when blockers stretch them. BALL CARRIER: a Tecmo-style read engine that picks BANG/BEND/BOUNCE by scoring lane "openness" through developing blocks (gated by Ball Carrier Vision), then commits with one cut and chooses contact actions (juke/spin/truck/stiff-arm) by the closing defender's angle and leverage. Every contact is one weighted roll on a shared kernel: P = sigmoid(k * (attackerRating - defenderRating + situational)); variance (extreme tails — blow-bys and pancakes) scales with the rating MISMATCH, so big gaps reliably produce dramatic readable outcomes while even matchups grind with rare X-factor tails.

## Inputs (read each tick / decision)
- Ball-carrier state: x,y,vx,vy, hasBall, controlled, ratings (SPD/ACC/AGI/ELU/TRK/BCV/JKM/SPM/SFA/CAR/BTK/STR)
- Each defender: x,y,vx,vy, gap (lateral yards from center), fitRole (force/spill/fill/alley/contain), defRole, job, blocked, shed, engaged, stun, ratings (PRC/PUR/TAK/POW/STR/SPD/ACC)
- Play context: offPlay.runner, offPlay.hole (designed aim point lateral yds), offPlay.pull, offDir (+1/-1), los (line of scrimmage X)
- Blocker states each frame: which OL/lead blocker is engaged with which defender, engaged seconds, shed flag (from the existing block-matchup system)
- Per-frame geometry: defender->carrier distance and bearing, defender leverage side (is defender inside or outside the carrier relative to play direction), gap occupancy (is a defender currently sitting in each lane)
- dt (frame seconds), deterministic rng() in [0,1)
- userTurbo/input axis when the carrier is human-controlled (human steers path; ratings still bind the contests)

## Contest model
```
// ===== SHARED CONTEST KERNEL (single weighted roll) =====
// All run contests resolve through one function so synthesis can unify them.
function contest(atk, def, base=0, k=0.045) {
  const delta = atk - def + base;            // rating advantage, -99..+99
  const p = 1 / (1 + Math.exp(-k * delta));  // logistic, p in (0,1)
  return { p, win: rng() < p, delta };
}
// k=0.045 => +15 rating edge ~64% win, +30 ~79%, +45 ~88%, +60 ~93% (saturating tails)

// ===== DEFENSE: GAP FIT + LEVERAGE =====
// Assign fitRoles per play side (set in setJobs, extends existing d.gap loop):
//   FORCE  = widest box defender on play side (EDGE DL / strong LB / SS in support)
//   SPILL  = interior DL/LB inside the force; wrong-arms blocks, attacks INSIDE half of gap
//   FILL/ALLEY = remaining LBs; flow inside-out, fit first open gap
//   CONTAIN = backside EDGE + backside DB own cutback/reverse
// holdGap: stay at gapX (= los + dir*0.5yd, gapY = center + gap*1.5yd) until
//   commit = dist(carrier, gapPoint) < COMMIT_R(=2.5yd) OR carrier crosses LOS in this gap.
// PRC gates read speed: commitDelay = lerp(0.45s, 0.05s, PRC/99); a low-PRC LB
//   holds an extra ~0.4s and is slower to re-fit when zone-stretched (false-step
//   probability per frame = clamp(0.25 - PRC/400, 0, 0.25)).
// LEVERAGE (inside-out): pursuit aim = carrier + lead, but clamp the aim so the
//   defender keeps required leverage:
//   FORCE  -> must stay OUTSIDE shoulder: aimY = clamp toward sideline of carrier (no inside release)
//   SPILL  -> must stay INSIDE: aimY pinned to inside half; forces bounce
//   FILL   -> pure inside-out intercept (existing intercept()), but never cross face to wrong side
//   wrongLeverage if defender is on the wrong side of carrier for his fitRole.
// EDGE/CONTAIN integrity: a FORCE defender who loses outside leverage = the carrier
//   has bounced the edge (blow-by); a SPILL who loses inside = cutback lane opens.

// ===== BALL CARRIER: VISION READ ENGINE (bang/bend/bounce) =====
// Sample 3 candidate lanes off the designed hole each decision tick (every 0.12s
// until past LOS, "3 steps and a decision"):
//   BANG  = designed hole lateral (offPlay.hole)
//   BEND  = hole - 1.5 gaps (cutback, behind center)
//   BOUNCE= outside the force defender (toward sideline on play side)
// laneScore(lane) =
//   + DOWNFIELD_GAIN   (free yards before first unblocked defender intersects)
//   - DEFENDER_DENSITY (sum over defenders within 4yd of lane path, weighted by
//                       how "free" they are: blocked&!shed => *0.15, shed => *0.7, free => *1.0)
//   + BLOCK_LEVERAGE   (+ if our blocker is between lane and nearest threat = a sealed crease)
//   + EDGE_BONUS for BOUNCE only if force defender is sealed/outflanked (carrier.SPD edge)
// vision gate: choose argmax(laneScore) with prob pVision = 0.55 + 0.45*BCV/99;
//   else pick 2nd-best (a misread). Low BCV => more misreads into traffic.
// commit: once chosen, set aimPoint, run NORTH-SOUTH (one cut); re-read only if the
//   chosen lane's score collapses by >40% (lane closed) -> allow one re-cut.
// AGI caps cut sharpness: maxTurnRate = lerp(6 rad/s, 13 rad/s, AGI/99); low AGI
//   rounds off cuts (overshoots the crease).

// ===== CONTACT RESOLUTION (replaces/augments lines 1519-1545 tackle loop) =====
// When a FREE defender (!neutralized) reaches TACKLE_R of carrier:
//   1) pick ball-carrier action by defender APPROACH ANGLE (the "ideal zone"):
//      head-on & defender slower / carrier STR>def => TRUCK
//      defender to the side, carrier has space => JUKE (lateral) or SPIN (if wrapped/trailing)
//      defender reaching from flank => STIFF-ARM
//      no time/space => brace (plain tackle contest)
//   2) attackerRating by action: JUKE->JKM, SPIN->SPM, TRUCK->TRK, STIFFARM->SFA,
//      brace/default-> BTK (break tackle), all +0.5*ELU blended.
//   3) defenderRating = TAK, with POW as a fumble side-roll, plus leverage modifier:
//      base += LEVERAGE_BONUS: defender wrongLeverage (carrier attacking his blind/open
//        side) => +18 to carrier; defender squared-up with help nearby => -12 to carrier.
//      base += SPEED_GAP: (carrier closing speed - defender)/yps * 6, capped +-15.
//   4) roll = contest(attacker, TAK, base):
//      WIN  => defender stun = 0.35..0.7s, knocked back; carrier continues (juke/truck through).
//              big delta (>+35) => PANCAKE/posterized: stun 0.9s, defender knocked 1.5yd.
//      LOSE => TACKLE (existing endPlay tackle). If POW contest also wins
//              (contest(POW,CAR,base=-30).win) => FUMBLE (loose ball, existing fumble path).
//   5) gang tackle: each additional free defender within TACKLE_R adds +10 to def side
//      this frame (stacking), so breaking 2+ men needs a big rating edge or X-factor tail.
```

## Outcome spectrum
### PANCAKE / blow-up tackle (defense, ~no gain or TFL)
- **When:** Free defender wins contact contest by a wide margin; or a SPILL/FORCE defender meets the carrier squared-up with inside-out leverage before the crease opens
- **Weighting:** def TAK/POW >> carrier BTK/ELU (delta < -30); defender correct leverage (+12 def); gang tackle (+10/extra man); carrier low momentum

### Clean tackle for short gain
- **When:** Free defender reaches carrier and wins a near-even contest after the carrier took the designed lane for a few yards
- **Weighting:** delta near 0; even fit; blocks held only briefly; this is the modal grind outcome

### Broken tackle, stumble-forward (carrier wins one contest, slowed)
- **When:** Carrier wins the contact roll but with small margin; defender stunned 0.35-0.5s, carrier loses speed through contact
- **Weighting:** carrier BTK/TRK slightly > TAK (delta +5..+20); STR edge on TRUCK; modest leverage edge

### Juke/spin/stiff-arm beats the first man, gets to 2nd level
- **When:** Carrier picks the right action for the defender's approach angle in the ideal zone and wins; OR vision read found a sealed crease so the first free defender arrives off-balance
- **Weighting:** action rating (JKM/SPM/SFA) + ELU > TAK; defender wrongLeverage (+18 carrier); carrier AGI high (sharp cut); BCV high (good read, defender out of position)

### BOUNCE to the edge for a chunk (force defender outflanked)
- **When:** Vision engine reads everything crashing inside, bounces outside the force defender who lost outside leverage; carrier SPD wins the edge race
- **Weighting:** carrier SPD/ACC > force defender PUR/SPD; force defender low PRC (slow to set edge) or sealed by a blocker; BCV high enough to pick BOUNCE correctly

### Cutback / bend house-run (backside blow-by)
- **When:** SPILL defenders over-pursue play side, backside CONTAIN loses gap, carrier bends behind center into green grass and breaks the safety's angle
- **Weighting:** def front-seven low PRC (over-flow); backside contain wrongLeverage; carrier BCV high (sees the bend) + BTK to beat the last man; large overall rating mismatch -> extreme tail

### FUMBLE on contact
- **When:** Defender wins a POW-vs-CAR side roll on a big hit (usually concurrent with a stuff or a truck attempt gone wrong)
- **Weighting:** def POW high, carrier CAR low (delta on POW-CAR side roll, base -30 so it's rare ~3-8%); higher on TRUCK attempts and gang tackles

### Misread into traffic (self-inflicted stuff)
- **When:** Low-BCV carrier (AI) picks the 2nd-best lane and runs into an unblocked/shed defender
- **Weighting:** carrier BCV low (pVision miss); AGI low (can't recut); defenders correctly fit gaps (high PRC front)

## Concrete numbers / heuristics
- Contest kernel: k=0.045 logistic; +15 delta=64%, +30=79%, +45=88%, +60=93% win
- Decision tick for vision: every 0.12s until carrier crosses LOS (mirrors '3 steps and a decision'); one allowed re-cut if chosen lane score drops >40%
- Vision correctness: pVision = 0.55 + 0.45*(BCV/99) -> BCV 50 picks best lane ~78%, BCV 99 ~100%, BCV 30 ~69%
- Gap commit radius COMMIT_R = 2.5yd (existing 'threat' check); FORCE defenders use wider start angle (aim 1.5yd outside carrier)
- PRC read delay: commitDelay = lerp(0.45s @PRC0, 0.05s @PRC99); false-step prob/frame = clamp(0.25 - PRC/400, 0, 0.25)
- Break-tackle WIN stun = 0.35-0.7s; PANCAKE (delta>+35 for defense) stun 0.9s + 1.5yd knockback
- Leverage modifiers: wrongLeverage = +18 to carrier; squared-up-with-help = -12 carrier; speed-gap term = clamp((carrierSpd-defSpd)/yps*6, -15, +15)
- Gang tackle: +10 to defender side per extra free defender within TACKLE_R (0.95 yard)
- Fumble side-roll: contest(POW, CAR, base=-30) -> ~3-8% typical, scales up on truck attempts/big hits
- Action->rating map: JUKE=JKM, SPIN=SPM, TRUCK=TRK, STIFFARM=SFA, default=BTK, each blended +0.5*ELU; defender side always TAK
- Cut sharpness: maxTurnRate = lerp(6 rad/s @AGI0, 13 rad/s @AGI99)
- Reuse existing constants: TACKLE_R=0.95yd, SHED_TIME=1.3s, YARD=22px, SPEED table for base yps; rng() deterministic for pre-rolled POC teams

## Ratings used
- BALL CARRIER offense: SPD (edge/breakaway speed), ACC (burst through crease), AGI (cut sharpness/turn rate), ELU (universal evasion blend +0.5x), BCV (vision/lane-read correctness), JKM (juke contest), SPM (spin contest), TRK (truck contest), SFA (stiff-arm contest), BTK (default break-tackle contest), STR (truck/power leverage), CAR (fumble resistance side-roll)
- DEFENSE run support: PRC (read speed, gap re-fit, false-step), PUR (closing/intercept lead quality), TAK (the contested rating on every contact), POW (fumble-forcing side-roll), STR (anchor vs truck), SPD/ACC (edge race, pursuit angle)
- BLOCKERS (from existing block system, feed lane-openness): OL block ratings vs DL shed ratings already drive blocked/shed/engaged which the vision engine reads as lane density weighting

## Variance model
Variance is engineered to GROW with the rating mismatch so dramatic outcomes are reliable, not averaged away. Mechanism: (1) The logistic kernel itself pushes large deltas toward saturated win probabilities (delta +45 => 88%), so a big mismatch BLOWS BY or PANCAKES most reps - the tail becomes the mode. (2) On top of the binary roll, apply a magnitude multiplier so the SIZE of the result scales with |delta|: winMargin = clamp(|delta|/60, 0, 1); on a carrier win, stun/knockback and post-contact speed retention scale with winMargin (small edge = stumble forward; huge edge = posterizing truck + 1.5yd knockback). On a defender win, winMargin scales TFL depth/hit power. (3) EVEN matchups (|delta|<10): the roll sits near 50%, so most reps are the grind (short gains, clean tackles), but an X-FACTOR tail fires: with prob 0.04 add a one-time +25 swing to either side this contact (a flashed juke or a de-cleater), producing the occasional exciting big play even between equals. (4) Compounding chains amplify mismatch: a high-rated back must win N sequential contests to house it; each win probability multiplies, so only true mismatches (or a lucky even-matchup chain) reach the end zone - which keeps blow-by runs rare-but-spectacular for even teams and routine for lopsided ones. Determinism preserved via the seeded rng() for the pre-rolled POC teams.

## Dependencies
- Block-matchup system (Game.ts resolveBlock, lines ~738-765): produces blocked/shed/engaged/stun which the vision engine reads as per-lane defender 'freeness' weighting and which gates neutralized() defenders out of tackles
- Defensive job/gap assignment (setJobs ~line 431-460): must be extended to also stamp fitRole (force/spill/fill/alley/contain) per play side; currently only sets numeric d.gap
- Tackle resolution loop (checkTackle ~lines 1519-1545): the new contact-action contest replaces the flat 0.12 break-tackle hack; routes wins to stun/continue and losses to endPlay/fumble
- Player type (types.ts): add fitRole + per-player rating fields (currently ratings are hardcoded role tables BLOCK_RATING/shedRating - extend to a ratings record for the 22 players, sourced from the pre-rolled POC teams)
- Fumble/loose-ball path (fumble handling ~lines 1444-1492) for the POW-vs-CAR side roll
- intercept()/moveToward()/steer() movement helpers and SPEED table (single source of yps); rng() in utils.ts for the shared deterministic roll
- Synthesis 'contest kernel' pass: this system's contest(atk,def,base,k) must be the same function block-shed, tackle, pass-rush, and coverage systems call

## Sources
- https://www.easports.com/madden-nfl/news/2016/madden-17-gameplay-run-fits-gap-assignments
- https://www.pastapadre.com/2016/05/18/extensive-detail-on-the-advancements-to-defensive-ai-in-madden-nfl-17
- https://oldmansim.wordpress.com/2014/03/27/madden-25-guide-to-player-ratings-attributes-traits/
- https://www.dexerto.com/madden/how-to-juke-in-madden-25-every-skill-move-and-setup-state-explained-2863098/
- https://www.madden-school.com/madden-17-ball-carrier-special-moves-details/
- https://www.joedanielfootball.com/blog/umbrella-principle
- https://throwdeeppublishing.com/blogs/football-glossary/run-fits-in-football-the-complete-guide
- https://theriotreport.com/gap-discipline-what-it-means-and-how-it-defines-your-run-defense/
- https://www.bafca.co.uk/wp-content/uploads/2020/01/FORCE-SPILL-and-LEVERAGE-the-3-keys-to-stopping-the-running-game.pdf
- https://bigskillposition.wordpress.com/run-game/outside-zone/the-outside-zone-article-5/
- http://coachvint.blogspot.com/2020/12/teaching-running-back-to-read-1-to-2-on.html
- https://www.viqtorysports.com/understanding-run-fits-in-football/
