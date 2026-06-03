# Man Coverage

> System spec — Gridiron Blitz rebuild. Auto-generated from the parallel research workflow; grounded in the cited sources below.

## Summary
Man coverage is modeled as a continuous per-frame "phase" pursuit: the defender targets a point relative to the receiver's hips (leverage offset + cushion), and his ability to hold that point is a weighted roll between his coverage ratings and the receiver's release/agility/speed. Two discrete contests punctuate it: the line-of-scrimmage JAM (press only, a one-time strength/press vs release contest) and the BREAK contest at each route cut (where bite/recovery decides separation). Variance scales with the rating mismatch: even matchups grind in-phase with rare RNG tails, while big gaps reliably produce blanket coverage (pancake-equivalent: the receiver erased) or blow-bys (defender torched, multi-yard separation). It reuses the engine's existing weighted-roll kernel (delta -> per-second probability) so it drops into the shared contest model.

## Inputs (read each tick / decision)
- Defender pos/vel (x,y,vx,vy) and receiver pos/vel each tick
- Defender top speed (yd/s) and receiver top speed (yd/s)
- Defender ratings: MCV (man coverage), PRS (press), SPD, ACC, AGI, STR, AWR/PRC (play recognition)
- Receiver ratings: RLS (release/beat-press), SPD, ACC, AGI, STR, route-running/quickness
- press parameter (0..1) from DefensePlay -> press vs off alignment
- Leverage side: inside/outside, derived from safety help (coverage shell: Cover-1 has deep help -> outside leverage; Cover-0 no help -> inside/trail leverage)
- Receiver's current route node / break direction (hip cue): is the receiver stemming vertical, breaking in, or breaking out, and whether the upcoming node is a sharp cut (double-move flag)
- Current cushion (yards of separation along the route axis) and phase state (in-phase / trailing / beaten)
- dt (frame seconds), seeded rng()
- Ball state (whether ball is in air / thrown) to trigger the play-on-ball break

## Contest model
```
// ---- STATE per man defender ----
// phase: -1=beaten(torched), 0=trailing/out-of-phase, 1=in-phase/blanket
// cushion: signed yards of separation along WR's facing (goal-side +)
// leverage: dir*1 (outside) or dir*-1 (inside) chosen from coverage shell

// ---- 0. ALIGNMENT (presnap) ----
pressMode = press > 0.5
align_depth = pressMode ? 0.5yd : lerp(7,5, press)  // off = 5-7yd cushion
leverage = helpInside ? OUTSIDE : INSIDE            // play opposite your help
lev_off  = 0.6yd toward leverage side               // 1-2yd in real ball, compress for arcade

// ---- 1. JAM CONTEST (press only, once, at LOS contact within 0.5yd) ----
// reuse block-kernel shape: delta drives a single weighted roll
jamDelta = (def.PRS*0.6 + def.STR*0.4) - (wr.RLS*0.6 + wr.STR*0.4)   // >0 = DB favored
pJamWin  = clamp(0.5 + jamDelta*0.020, 0.05, 0.95)
if def.PRS>=90: pJamWin += 0.08            // elite-press threshold (Madden)
roll = rng()
if roll < pJamWin:   wr.stun += jamWinStun (0.25..0.55s scaled by jamDelta); phase=1; cushion-=0.5
elif roll > 1-pWhiff(jamDelta): def whiffs -> wr free release, phase=0, cushion+=0.7  // press tail risk
else: glancing jam, wr.stun += 0.12, phase stays

// ---- 2. PHASE PURSUIT (every tick) ----
// aim at the receiver's projected hip point, biased by leverage + cushion target
aim = interceptLead(def, wr)                 // existing pure-pursuit lead
target_cushion = pressMode ? 0.3yd : 1.2yd   // how tight DB wants to ride the hip
aimX = aim.x + dir*target_cushion + lev_off_x
moveToward(def, aimX, aim.y, dt, gain=0.99)
// continuous phase erosion/recovery from a speed+MCV roll:
covDelta = (def.MCV*0.5 + def.SPD*0.3 + def.ACC*0.2)
         - (wr.AGI*0.4 + wr.SPD*0.35 + wr.ACC*0.25)
// per-tick drift of cushion (yards/sec) toward WR favor when covDelta<0:
cushion += (-covDelta * 0.004) * dt          // negative covDelta => WR pulls away
cushion = clamp(cushion, -0.3, beatenCap)

// ---- 3. BREAK CONTEST (fires at each route node / sharp cut) ----
// the moment the WR's hips turn: DB must read & drive. This is the big separation event.
breakDelta = (def.MCV*0.55 + def.AGI*0.30 + def.PRC*0.15)
           - (wr.AGI*0.55 + wr.ACC*0.30 + wr.route*0.15)
isDouble   = node.flaggedDoubleMove
pBite      = clamp(0.5 - breakDelta*0.018 + (isDouble?0.20:0) + (pressMode?0.10:0), 0.02, 0.95)
// pressMode & double moves raise bite risk; off coverage & high MCV lower it
if rng() < pBite:
    sep = baseSep(0.8..3.5yd) * biteSeverity(breakDelta, isDouble)  // DB bites -> WR separates
    cushion += sep ; phase = (sep>2.0 ? -1 : 0)                     // big sep = torched
    def applies recovery: closing_speed = def.SPD*(1 + ACC bonus); regains cushion over time
else:
    // DB drives on the break, stays in phase
    cushion = max(cushion-0.3, target_cushion); phase = 1
    if breakDelta>15 && rng()<0.10: def UNDERCUTS -> jump the route (INT chance / PBU)

// ---- 4. RECOVERY (post-break / deep) ----
// closing rate bound to ratings, not skill:
closeRate = (def.SPD - wr.SPD) + (def.ACC-wr.ACC)*0.3   // yd/s net
cushion -= closeRate*0.10*dt                            // DB reels WR back if faster
if cushion<=target_cushion: phase=1 (back in pocket)
// if DB slower (closeRate<0) and beaten: cushion grows -> blow-by, no recovery

// ---- 5. PLAY THE BALL (ball in air) ----
if phase==1 or cushion<DEFLECT window: enter existing INT/TIP/PBU contest
if phase==-1: WR has separation -> contested-catch favors WR, DB can only chase tackle
```

## Outcome spectrum
### PANCAKE-EQUIVALENT: receiver erased / blanketed, route never develops
- **When:** Press jam wins big AND high covDelta; WR jammed, stunned, DB rides hip in-phase entire route, 0-0.5yd separation
- **Weighting:** Large positive jamDelta + covDelta (DB MCV/PRS/STR >> WR RLS/AGI). PRS>=90 adds +0.08 jam win. Off coverage lowers jam but raises blanket on breaks via covDelta.

### Blanket / tight window: DB in-phase, QB has tiny throwing lane
- **When:** DB stays in hip pocket (phase=1), cushion 0.3-1.0yd; break contests won, no bite
- **Weighting:** Positive covDelta & breakDelta. High MCV is the dominant driver. Correct leverage (opposite help) funnels WR away from open grass.

### Even grind / in-phase contested: DB trails on hip, catchable but contested
- **When:** covDelta ~0; cushion drifts 1-2yd; break contests near 50/50
- **Weighting:** Matched ratings. This is the modal even-matchup outcome. Small RNG swings on each break decide the rep.

### Step of separation: WR wins a break, DB recovers
- **When:** pBite hits with small/medium breakDelta; sep 0.8-2.0yd; DB closeRate>0 reels WR back
- **Weighting:** Slight WR edge in AGI/route, or DB took a false step. Recovery quality scales with DB SPD/ACC vs WR.

### Beaten on a double move (RNG tail in even matchups)
- **When:** Double-move node fires, pBite +0.20, DB bites the first move
- **Weighting:** isDouble flag + pressMode +0.10. Even elite DBs bite occasionally (pBite floor 0.02 -> rare exciting tail). Off coverage is the antidote (lower bite).

### TORCHED / blow-by: WR gains 2-5+yd, no recovery, wide-open
- **When:** Big negative covDelta/breakDelta OR jam whiff in press AND DB slower (closeRate<0); cushion grows unbounded
- **Weighting:** Large WR advantage in SPD/ACC/AGI/RLS. Press whiff against fast WR is the worst case. DB SPD deficit removes recovery -> permanent separation.

### DB X-FACTOR: undercut / PBU / interception, route jumped
- **When:** breakDelta>15 and 10% roll on a won break, or ball thrown into in-phase coverage
- **Weighting:** DB MCV/PRC >> WR; correct leverage baiting the throw. Rare even when favored (caps keep it a tail), big momentum swing.

## Concrete numbers / heuristics
- Off-coverage align depth: 5-7yd (lerp 7->5 as press 0->1); press depth ~0.5yd
- Leverage offset: real ball 1-2yd inside/outside; compress to ~0.6yd for the 24yd-wide arcade field
- Cushion lost cue: 'receiver can step on your toes' = ~2-3yd is the panic threshold; control-pedal at 75% speed until then
- Target ride cushion: press 0.3yd, off 1.2yd along WR facing
- Jam contest: pJamWin = clamp(0.5 + jamDelta*0.020, 0.05, 0.95); PRS>=90 adds +0.08; jam stun 0.25-0.55s
- Jam whiff (press tail): pWhiff = clamp((-jamDelta-6)*0.03, 0, 0.5) mirrors existing block-whiff curve
- Phase pursuit cushion drift: cushion += (-covDelta*0.004)*dt yd; covDelta scale ~±25 across a max mismatch
- Break bite: pBite = clamp(0.5 - breakDelta*0.018 + (double?0.20:0) + (press?0.10:0), 0.02, 0.95)
- Break separation on bite: 0.8-3.5yd; sep>2.0yd flips phase to beaten(-1)
- Undercut/INT on a won break: 10% when breakDelta>15
- Recovery closeRate = (def.SPD-wr.SPD)+(def.ACC-wr.ACC)*0.3 yd/s; cushion -= closeRate*0.10*dt
- Engine constants in play: YARD=22px, DB top speed 9.6yd/s, WR 9.7yd/s, TE 8.6 (speed deltas are small -> ratings, not base speed, drive contests)
- Rating delta->prob slope ~0.02/pt matches existing shed kernel (perSec = base + delta*0.02)

## Ratings used
- Defender (DB/LB): MCV Man Coverage (primary, drives phase + break read), PRS Press (jam contest), SPD/ACC (recovery + pursuit), AGI (break drive/COD), STR (jam power), PRC/AWR Play Recognition (bite resistance + undercut)
- Receiver (WR/TE/RB): RLS Release/Beat-Press (jam + free release), SPD/ACC (separation + blow-by), AGI Agility (break sharpness, beats coverage on double moves), STR (fight the jam), route-running/quickness (break-contest edge)

## Variance model
All three contests (jam, per-tick phase, break) are weighted rolls whose probability is centered at 0.5 and shifted by a rating delta at slope ~0.018-0.020 per point, then clamped (jam 0.05-0.95, break 0.02-0.95). This makes variance a function of the MISMATCH, not a flat coin flip: near delta=0 every roll is ~50/50 so reps swing on RNG (the even-matchup grind with occasional exciting tails); as |delta| grows the clamp pins outcomes toward one side (blowout reliability) while the non-saturating clamp floor (0.02-0.05) preserves rare dramatic tails even in lopsided matchups (the elite DB who still bites a great double move; the scrub who occasionally blankets). Separation MAGNITUDE on a bite also scales with breakDelta and the double-move flag, so a bad mismatch not only bites more often but separates farther (blow-by vs a recoverable step). Press amplifies variance on both ends: it raises blanket/pancake upside (jam stun) and torched downside (whiff + no recovery vs fast WR), giving the high-variance read the owner wants. Recovery is bound to SPD/ACC deltas so a faster DB caps the downside (separation is temporary) while a slower DB has none (separation is permanent) — variance is asymmetric by speed rating.

## Dependencies
- Shared contest kernel: jam/break/phase all use the same delta->per-second weighted-roll shape as the existing block-shed code (Game.ts ~L750-765), so synthesis can unify them
- Seeded rng() for deterministic pre-rolled POC teams
- Block/pass-rush system: time-to-throw (pocket shed ~1.3-2.7s) sets how long coverage must hold before the ball comes out
- Pass/catch + INT/TIP/PBU system (constants.ts INT_CHANCE 0.3, TIP_CHANCE 0.5, DEFLECT_R, REACH): the ball-in-air contest consumes this system's phase/cushion state
- Route system (RouteNode + double-move flag): break contests fire at route nodes; needs a per-node sharp-cut/double-move marker added
- Zone coverage + safety help: leverage side is chosen from the coverage shell (Cover-1/0) so this couples to the coverage-call/help logic
- DefensePlay.press (0..1) and assignId already exist in types.ts and feed alignment + jam

## Sources
- https://alleyesdbcamp.com/mastering-the-art-of-man-coverage/
- https://maddenunderground.com/new-madden-mechanics-dbwr-interaction/
- https://blogs.usafootball.com/blog/1047/reading-the-wide-receiver-s-hips-to-teach-man-coverage
- https://madden.fandom.com/wiki/Attributes
- https://mgoblog.com/diaries/anatomy-double-move
- https://forums.operationsports.com/forums/madden-nfl-football/1014899-man-coverage-leverage-nuances.html
- https://themaddenacademy.com/2025/01/play-man-coverage-madden-26
