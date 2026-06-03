# Zone coverage

> System spec — Gridiron Blitz rebuild. Auto-generated from the parallel research workflow; grounded in the cited sources below.

## Summary
A zone defender runs a 4-phase loop each tick: DROP to a coverage landmark (Cover 2/3/4 + underneath zones, computed from LOS, hash, direction), READ the QB while squeezing the most dangerous threat in the zone, MATCH/PASS-OFF receivers crossing zone boundaries (spot-drop carries the threat only inside the zone; pattern-match converts to man when a receiver goes vertical past a carry depth), and DRIVE on the throw with a weighted-roll contest that decides PBU vs INT vs caught-in-window vs blown-by. Variance scales with the rating gap between the defender's coverage rating and the receiver's separation rating: big gaps yield deterministic jumps (picks) or blow-bys; even matchups grind to a contested catch with occasional X-factor tails. Output feeds the shared contest kernel as a single weighted roll on (coverRating - receiverRating + leverage + ballError - reactionLag).

## Inputs (read each tick / decision)
- Defender pos/vel (x,y,vx,vy) and snap origin (ox,oy)
- Defender defRole (DL/LB/CB/S) and job=zone
- Assigned zone landmark {x,y} and zone type (deep-half/third/quarter, curl-flat, hook-curl, flat, MOF-hook)
- LOS (this.los), offense direction (dir), hash/numbers landmarks derived from WORLD_W/H
- Ball state: inAir, t (flight progress), sx/sy launch, tx/ty land, targetId, peak
- All eligible receivers' pos/vel and their route depth (how far past LOS, vertical vs breaking)
- QB pos + facing/aim (for read-the-QB drift and shoulder-turn cue)
- dt (tick seconds), player top speed (yards/sec from SPEED table)
- Ratings: defender ZCV, AWR/PRC (reaction), SPD, PRESS; receiver SEP/route, SPD, CTH; QB throw accuracy/power

## Contest model
```
// ---- PER-TICK ZONE LOOP (each zone defender) ----
// dir = offDir(); Y = YARD(=22px); midY = WORLD_H/2
// 1) LANDMARK (set at assignment, in yards relative to LOS):
//   deepFwd: cover2=16, cover3=16, cover4=14 ; underFwd: flat=5, curl/hook=10, MOF-hook=12
//   lateral landmarks (yards from midY): deep-half=+/-6 (top of numbers), deep-third edge=+/-9, deep-third middle=0,
//     deep-quarter=+/-4.5 and +/-9, curl-flat=+/-7 (2yd inside numbers), hook-curl=+/-3 (2yd outside hash), flat=+/-10
//   zone.x = clamp(los + dir*fwd*Y), zone.y = clamp(midY + lat*Y)
//
// 2) DROP / DRIFT (no ball in air):
//   thr = mostDangerous(receivers in zone)  // nearest to landmark within zoneRadius, weighted to deeper threat
//   read = clamp01((AWR-50)/50)             // 0..1 QB-reading skill
//   carryDepth (pattern-match only): deepZone=permanent (caps at top); underneath curl-flat=12-15yd
//   if patternMatch and thr goes vertical past carryDepth:
//       job -> "man" on thr (convert; plaster)   // Saban Rip/Liz seam rule
//   else (spot-drop or thr breaking off):
//       if thr present: aim = lerp(landmark, squeeze(thr), 0.35 + 0.45*read)
//          // squeeze = stay landmark-side & on the up-field shoulder (leverage)
//       else: drift toward QB key: aim = landmark + dir*read*1.5*Y (deep zones cap drift if no vertical threat)
//       moveToward(p, aim, dt, 0.78 + 0.10*read)   // not full speed while reading
//   PASS-OFF: when thr exits zone toward an adjacent zone, drop thr, re-acquire next threat (banjo handoff).
//
// 3) BREAK ON THROW (ball.inAir && deep enough / toward this area):
//   reactLag = lerp(0.42, 0.10, clamp01((max(ZCV,AWR)-50)/49)) seconds  // delay before driving
//   if elapsedSinceThrow < reactLag: keep covering (don't drive yet)  // bites pump fakes
//   else: aim = ballLandingLead(tx,ty, defender)         // close to catch point
//         moveToward(p, aim, dt, 1.0 + 0.08*(ZCV>=85?1:0)) // elite closing burst
//
// 4) CONTEST AT CATCH POINT (defender within DEFLECT_R of ball at arrival):
//   sep = signedSeparation(defender, receiver, ballPath)  // + = receiver open
//   C = ZCV + 0.5*AWR + leverage*8                        // coverage score
//   R = receiver.SEP + 0.4*route + 0.4*receiver.SPD       // separation score
//   ballErr = throwAccPenalty (0..15, worse throw helps D)
//   delta = (C - R) + ballErr - reactLag*40 + noise        // noise ~ N(0, sigma)
//   contestRoll = sigmoid(delta / 14)                       // -> shared kernel as weighted roll
//   resolve via OUTCOME SPECTRUM weights below.
```

## Outcome spectrum
### Blow-by / receiver wide open (chunk gain or TD)
- **When:** Defender bites a double-move or breaks late; pattern-match conversion missed on a vertical; deep zone drifted off with no carry
- **Weighting:** R - C >= +20 -> ~55% of catches uncontested; +reactLag(low AWR), -ZCV, +receiver SEP/SPD, +play-action (low PRC). Tail even when even: ~3-5% on a clean double-move.

### Caught in window, contested completion (catch + immediate tackle, short/medium)
- **When:** Defender squeezed the throwing lane but receiver wins the catch; the grind outcome of even matchups
- **Weighting:** |C - R| <= 10 -> dominant (~45-60%); rises as matchup evens; mild ballErr. This is the modal result of a competent spot-drop.

### PBU / pass defensed (incomplete, defender knocks it away)
- **When:** Defender drives in-phase and arrives at the catch point on time
- **Weighting:** C - R >= +8 and reactLag low; +ZCV, +AWR, +ballErr (bad throw). ~25-40% when defender wins the leverage battle.

### Interception (defender catches; possible return)
- **When:** Defender reads QB early, undercuts the route in-phase, ball arrives to his hands
- **Weighting:** C - R >= +18 AND reactLag<0.18 AND inLane; pick chance = INT_CHANCE(0.3) * sigmoid((C-R-14)/10). Big positive gap -> picks spike; near-even -> rare X-factor tail ~2-4%.

### Tip / deflection -> loose ball (live, anyone grabs)
- **When:** Defender gets a hand on a contested ball but can't secure
- **Weighting:** Borderline C-R near +8..+14 with high ballErr; TIP_CHANCE(0.5) of non-clean deflections. Most exciting in even matchups.

### Pancake-equivalent: jumped route / clean pick-six setup
- **When:** Elite zone defender vs weak QB+receiver, telegraphed throw into a sat-on landmark
- **Weighting:** C - R >= +28 AND low QB acc -> defender sits on the spot and beats the receiver to it; deterministic at extreme gaps.

## Concrete numbers / heuristics
- YARD=22px; deep zone fwd: cover2=16yd, cover3=16yd, cover4=14yd; underneath: flat=5yd, curl/hook=10yd, MOF-hook=12yd
- Lateral landmarks (yd from midY): deep-half +/-6, deep-third edges +/-9 & middle 0, deep-quarter +/-4.5 & +/-9, curl-flat +/-7, hook-curl +/-3, flat +/-10
- zoneRadius (threat acquisition) = 5.5yd base, scaled 4.0..6.5 by AWR; current code uses fixed 4.5yd break radius (widen it)
- Drop speedMul = 0.78 + 0.10*read (was flat 0.85/0.95); reading drop is deliberately sub-max
- reactLag after throw: lerp(0.42s low-skill -> 0.10s elite) on max(ZCV,AWR); elapsedSinceThrow gate bites pump fakes
- Pattern-match carry depth: deep zones carry vertical permanently; curl-flat converts to man at 12-15yd vertical
- Contest: delta = (ZCV + 0.5*AWR + 8*leverage) - (SEP + 0.4*route + 0.4*SPD) + ballErr(0..15) - 40*reactLag + noise; contestRoll = sigmoid(delta/14)
- noise sigma scales with closeness: sigma = 6 + 8*(1 - |delta|/40) clamped, so even matchups are noisier (more tails)
- INT: base INT_CHANCE=0.3 (existing const) * sigmoid((delta-14)/10); TIP_CHANCE=0.5 (existing) for non-clean deflections
- Rating scale 0-99 (matches existing BLOCK/SHED tables ~64-84); POC teams: bake ZCV/AWR/SEP per player for determinism
- Drift cap: deep zone may not advance past its landmark fwd unless a receiver is within 8yd vertical (anti-drift, Madden drift-logic)

## Ratings used
- DEFENSE ZCV (zone coverage) - primary: closing burst, window squeeze, contest score C
- DEFENSE AWR/PRC (awareness/play-recognition) - reaction lag, QB read depth, play-action immunity, threat-acquisition radius
- DEFENSE SPD (speed, yd/sec from SPEED table) - drop/recovery speed and carry on verticals
- DEFENSE PRESS (existing) - reused as squeeze tightness / leverage hold on a receiver in zone
- OFFENSE SEP (separation/route running) - primary receiver score R
- OFFENSE SPD - widens window vs deep/underneath zones, drives blow-by tail
- OFFENSE CTH (catch) - resolves contested-catch sub-roll after defender arrives
- OFFENSE QB accuracy/power - sets ballErr (bad throw aids defender) and flight time available to react

## Variance model
Variance is a function of the contest delta magnitude. delta = coverScore - receiverScore (+ leverage, ballErr, -reactLag). Outcome = weighted roll on sigmoid(delta/14). The noise term sigma = clamp(6 + 8*(1 - |delta|/40), 6, 14): when |delta| is large (big rating mismatch) sigma shrinks toward 6, so outcomes are near-deterministic — the favored side wins almost every rep (blow-bys for offense at delta<<0, picks/pancakes for defense at delta>>0). When |delta| is small (even matchup) sigma swells toward 14, widening the result distribution so the modal contested-catch is punctuated by occasional dramatic tails: a surprise jumped route (~2-4% INT), a tip into a loose ball, or a busted blow-by on a double-move (~3-5%). Reaction lag injects timing variance independent of position: a low-AWR defender who reads late converts a would-be PBU into a caught-in-window even when athletically even. This keeps even matchups a readable grind while preserving the exciting RNG tails the owner wants, and lets the synthesis pass drive man and zone through one shared weighted-roll kernel by swapping only the C/R term composition.

## Dependencies
- Shared contest kernel (sigmoid(delta/sigma) weighted-roll) - must accept zone's C/R composition; mirrors existing block shed delta model (shedRating-blockRating at Game.ts:751)
- Ball-in-air model (BallState.inAir/t/tx/ty/peak; deflection at DEFLECT_R, INT_CHANCE, TIP_CHANCE in constants.ts) - break-on-throw drives into this
- Route system (RouteNode fwd/lat; player.route resolved px) - pattern-match needs route vertical/break detection
- Coverage assignment (assignJobs at Game.ts:431-540) - this spec replaces the spot-drop landmark math and coverZone() at Game.ts:1065
- moveToward / intercept primitives (Game.ts:1035,1582) - drive and lead-pursuit reused as-is
- Player ratings source - needs per-player ZCV/AWR/SEP/CTH fields (currently only positional BLOCK/SHED tables exist); POC pre-roll bakes these
- Man coverage system - shares the kernel and the pattern-match->man conversion path (coverMan at Game.ts:1052)

## Sources
- https://en.wikipedia.org/wiki/Zone_defense_in_American_football
- https://footballtoolbox.net/drop-zones-and-coverage
- https://www.viqtorysports.com/cover-3-4-6/
- https://www.360player.com/blog/how-to-play-zone-defense-the-strengths-weaknesses-of-cover-2-cover-3-cover-4
- https://blogs.usafootball.com/blog/5615/how-to-understand-nick-saban-s-pattern-match-cover-3-defense
- https://www.catscratchreader.com/2017/11/30/16719216/panthers-film-room-pattern-matching-seam-routes-in-the-cover-3-defense
- https://throwdeeppublishing.com/blogs/football-glossary/what-is-cover-3-in-football
- https://madden.fandom.com/wiki/Attributes
- https://www.ea.com/inside-ea/news/gridiron-notes-madden-nfl-23-gameplay-foundational-football
- https://fenixbazaar.com/2025/07/11/college-football-26-player-attributes/
- https://www.ea.com/games/ea-sports-college-football/college-football-26/news/college-football-26-campus-huddle-gameplay-deep-dive
