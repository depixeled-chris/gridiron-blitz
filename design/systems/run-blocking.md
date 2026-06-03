# Run Blocking

> System spec — Gridiron Blitz rebuild. Auto-generated from the parallel research workflow; grounded in the cited sources below.

## Summary
A per-frame weighted-roll contest layer for the offensive line on run plays. Each blocker is assigned a defender by scheme (zone = block first defender flowing into your play-side gap; gap = fixed down-block / kick-out / wrap to a designed point of attack), and the engagement resolves as a continuous tug-of-war (drive vs anchor vs shed) driven by the RBK-vs-(BSH+STR) rating delta. The same delta drives the full outcome spectrum: instant pancake that caves a lane, sustained drive that widens the hole, stalemate grind, quick shed, and contact-whiff blow-by. Variance scales with |delta|: even matchups are mostly grind with rare X-factor tails; large gaps flip to near-certain pancakes or blow-bys. The ball-carrier AI reads the ACTUAL resolved lane (widest unblocked seam near the designed hole), not just the play-called hole. This system currently exists in stub form in Game.ts but the contest() kernel is dead code on runs — wiring it in is the core deliverable.

## Inputs (read each tick / decision)
- Each blocker (5 OL + FB/TE): world x/y, snap origin ox/oy, slot id (LT/LG/CEN/RG/RT/F), runBlock rating RBK, strength STR, weight WT
- Each front defender (DL/LB): x/y, gap ownership (lateral yds from center), blockShed BSH, strength STR, weight WT, power-move tendency, current engaged-time, shed flag
- Play data: scheme tag (zone|gap), designed hole (lateral yds from center), pull slot (LG/RG/none), play direction dir (+1/-1), line of scrimmage los
- Carrier x/y/vx and which defenders are flagged unblocked-by-design
- dt (frame seconds), liveTime (seconds since snap), per-engagement accumulated drive distance and leverage state (sealed/inside/outside)

## Contest model
```
// ---- 1. ASSIGNMENT (who blocks whom) -------------------------------
// holeY = WORLD_H/2 + hole*YARD ; dir = +1 home / -1 away
// ZONE scheme (dive/draw/sweep w/o pull, stretch):
//   each OL takes a play-side zone step (lateral toward hole by ~0.5yd),
//   then blocks the FIRST defender whose x is within los±1.5yd AND whose
//   y falls in [self.y - 0.5yd*dirToHole , self.y + 1.5yd]. Two OL whose
//   target is the SAME DL form a COMBO: nearer-to-hole = POST (holds DL),
//   away-from-hole = DRIVE (gets vertical push). If a LB shows in the
//   combo's climb window, the DRIVE man CLIMBS (see below).
// GAP scheme (power/counter/iso/trap, pull set):
//   covered OL DOWN-BLOCK the defender in the gap AWAY from play side
//   (aim point tgt.x - dirToHole*0.4yd, sealing inside). The PULL guard
//   skips the LOS, runs flat ~1.0yd deep to the hole, KICK-OUT blocks the
//   first defender outside the hole (end/force) OR WRAPs to the first LB
//   inside if edge is already sealed. FB/lead ISO-blocks the play-side LB.
//
// ---- 2. PER-ENGAGEMENT CONTEST (the kernel) ------------------------
// Unified weighted roll, shared with pass-pro / tackle / block-shed:
//   delta = (BSH_def + 0.35*(STR_def - STR_ol) + 0.10*(WT_def - WT_ol))
//           - RBK_ol            // >0 favors defender
//   combo: delta -= 14 while BOTH blockers engaged (post+drive)
//   reach (outside run, OL must reach play-side of a wider DL):
//           delta += 6  (reach is hard; favors defender holding edge)
//   down-block (angle/leverage advantage on covered gap defender):
//           delta -= 5
//   moving/at-2nd-level (impact block in space): use IBL in place of RBK,
//           variance higher (see varianceModel).
//
// CONTACT EVENT (fires once, when engaged crosses 0 -> first frame):
//   pWhiff   = clamp((delta - 6) * 0.030, 0, 0.55)   // blocker misses -> instant blow-by
//   pPancake = clamp((-delta - 6) * 0.022, 0, 0.40)  // blocker caves him -> instant lane
//   roll r in [0,1): r<pPancake -> def.pancaked=true (removed 1.6s, shoved
//                    2.0yd away from hole, lane opens);
//                    r<pPancake+pWhiff -> def.shed=true (comes free clean);
//                    else -> normal engagement begins.
//
// SUSTAIN (every frame while engaged & not shed/pancaked):
//   shedPerSec = clamp(0.42 + delta*0.020, 0.04, 2.2)   // base run grind
//   pShed = shedPerSec * dt ;  if rng() < pShed -> def.shed = true
//   DRIVE (push the defender off the LOS, widening/creating the hole):
//     drivePerSec = clamp(0.9 - delta*0.05, -0.6, 2.2) yards/sec
//     def.x += dir * drivePerSec * dt        // negative = defender stuffs OL
//     def.y += sign(def.y-holeY) * 0.5*drivePerSec*dt   // wash away from hole
//   engaged += dt   // fatigue: shedPerSec += 0.06*max(0,engaged-2.5)
//
// CLIMB (combo only): once def driven dir*0.8yd past los AND a LB is within
//   3yd of the drive man's path, DRIVE man releases: engaged DL stays with
//   POST (now solo, delta += 6 since lost help), DRIVE man re-targets LB and
//   runs a fresh CONTACT event vs that LB using IBL.
//
// ---- 3. CARRIER READ (read the ACTUAL block results) ---------------
// Don't blindly aim at designed holeY. Each frame while behind+near LOS:
//   for candidate lateral lanes Y in {holeY, holeY±1.5yd, holeY±3yd}:
//     laneScore(Y) = (nearest unblocked/shed defender's distance to (los+2yd,Y))
//                    - 0.7*|Y - holeY|         // bias to the design
//                    + 1.0*(pancake bonus if a def near Y is pancaked)
//   aim at argmax laneScore; once dir*(x-los) > 2yd, switch to open-field
//   pursuit-avoid (existing runToGoal repulsion).
```

## Outcome spectrum
### PANCAKE — blocker flattens defender at contact, lane blown wide open (def removed ~1.6s, shoved 2yd from hole)
- **When:** first-contact roll, delta strongly negative (blocker much better) or combo/down-block bonus stacking
- **Weighting:** pPancake = clamp((-delta-6)*0.022,0,0.40); maximized by high RBK vs low BSH+STR, combo (-14), down-block (-5); ~0 in even matchups

### DRIVE / SEAL — blocker steadily pushes defender off the ball, hole widens 1-2yd over the play
- **When:** sustained engagement, delta moderately negative, no shed
- **Weighting:** drivePerSec = 0.9 - delta*0.05; biggest when RBK > BSH+STR by 8-20; combos almost always drive

### STALEMATE GRIND — blocker neutralizes defender at the LOS, hole is exactly as designed, no give either way
- **When:** even matchup, delta near 0, neither shed nor pancake fires
- **Weighting:** |delta| < 5; this is the modal outcome for the two pre-rolled even POC teams

### SLOW SHED — defender works off the block mid-play and makes a delayed play on the carrier
- **When:** sustain roll hits after ~1-2.5s of engagement
- **Weighting:** shedPerSec = 0.42 + delta*0.020; rises with positive delta and with fatigue (engaged>2.5s)

### QUICK SHED — defender disengages within ~0.5s and clogs the lane early
- **When:** early sustain roll, delta positive (defender better)
- **Weighting:** high BSH+STR vs low RBK; reach-block penalty (+6) makes outside runs shed fast vs wide DL

### WHIFF / BLOW-BY — block never connects, defender runs free into the backfield, blows the play up (TFL/no gain)
- **When:** first-contact roll on a clear mismatch
- **Weighting:** pWhiff = clamp((delta-6)*0.030,0,0.55); maximized by elite edge DL/blitzer vs weak OL (esp. FB/TE in space) and reach blocks

### PULLER LATE / MISTIMED — gap-scheme pull guard arrives a beat late or kicks the wrong man, hole closes
- **When:** pull path obstructed or kick-out target ambiguous; modeled as pull-block delta +4 and a small (8%) mis-ID re-target
- **Weighting:** low AGI/AWR puller, traffic in the hole, defender penetration before puller arrives

## Concrete numbers / heuristics
- BLOCK_R engage radius = 1.1*YARD (24.2px); contact event fires when engaged crosses 0 (engaged<0.04 = first contact, matches existing code)
- Base run shedPerSec = 0.42 (pass-pro is lower ~0.32, already in code); clamp(0.04, 2.2)
- pWhiff slope 0.030 per delta-point, cap 0.55; pPancake slope 0.022, cap 0.40; both gated by ±6 delta deadzone so even matchups never auto-explode
- Combo bonus delta -14; reach penalty +6; down-block bonus -5; pull-block penalty +4; lost-help penalty +6 when combo releases
- drivePerSec = 0.9 - delta*0.05 yd/s, clamp(-0.6, 2.2); lateral wash = 0.5*drivePerSec
- Pancake duration ~1.6s removed, shove 2.0yd from hole; whiff/shed = permanent free for the play (def.shed sticky, matches code)
- STR weight 0.35, WT weight 0.10 in delta (strength/weight matter but RBK/BSH dominate)
- Fatigue: shedPerSec += 0.06 per second engaged beyond 2.5s
- Carrier lane candidates at holeY and ±1.5/±3yd; design bias 0.7yd; read window dir*(x-los) < 2yd
- Climb trigger: DL driven dir*0.8yd past LOS AND LB within 3yd of drive man
- Suggested POC ratings (deterministic): even teams RBK 78 / BSH 74 / STR 80 -> delta near +2 (grind); mismatch demo: elite edge BSH 92 STR 92 vs FB RBK 60 -> delta ~+30 -> pWhiff capped 0.55

## Ratings used
- Offense: Run Block (RBK) — primary blocker rating; Impact Block (IBL) — used instead of RBK for second-level/in-space blocks; Strength (STR); Weight (WT); Awareness/Agility (AWR/AGI) — pull-guard mistime & climb timing only
- Defense: Block Shedding (BSH) — primary shed rating; Strength (STR); Weight (WT); Power-Move tendency — biases toward pancake-resisting bull-rush vs quick finesse shed (optional flavor on the sustain roll)

## Variance model
Variance is a direct function of |delta|, per the owner's mandate. In the SUSTAIN roll the per-frame shed is Bernoulli(shedPerSec*dt); near delta=0 the outcome distribution is tight and grind-heavy (most engagements last the play, occasional ~1-2s sheds = the X-factor tail). As |delta| grows, the CONTACT event (pWhiff / pPancake, both ramping ~0.02-0.03 per delta-point past the ±6 deadzone) increasingly front-loads the result into the dramatic tails: at delta>+22 the defender blows by >50% of snaps; at delta<-22 the blocker pancakes ~36%. To keep even matchups from feeling flat, add a small per-engagement X-factor jitter: jitter = N(0, 4) added to delta ONCE at contact (capped ±8), so an even grind still throws the occasional surprise pancake or blow-by (~3-5% of even reps) without distorting the average. Open-field/IBL blocks use 1.5x jitter sigma (space = more boom/bust). The pre-rolled POC teams get fixed ratings + a seeded RNG so the jitter is reproducible for headless tests.

## Dependencies
- Shared contest kernel (synthesis pass): pWhiff/pPancake/perSec formulas must match the single weighted-roll model used by pass-protection, block-shedding-on-pursuit, and tackle/break-tackle so one delta->probability curve is reused everywhere
- Defender pursuit AI (updateDefense/pursue): reads def.shed and def.pancaked to know when to release toward the carrier; neutralized() gate already exists
- Ball-carrier AI (runToGoal): consumes the resolved-lane read instead of the static designed hole; couples to the carrier juke/break-tackle system
- Defensive run-fit / gap assignment (assignDefense): supplies each defender's owned gap so zone OL know who flows into their zone and so unblocked-by-design (flame) defenders are tagged
- Ratings source of truth: needs RBK/IBL/STR/WT on Player (offense) and BSH/STR/WT on Player (defense) — currently hardcoded in BLOCK_RATING/shedRating maps in Game.ts; must move to the per-player rating model
- Seeded RNG (rng) for deterministic pre-rolled POC headless tests

## Sources
- https://www.mut.gg/news/ask-huddle-41-how-run-blocking-actually-works-in-madden/
- https://www.maddenguides.com/run-blocking-schemes/
- https://www.madden-school.com/block-shedding-power-move-ratings/
- https://throwdeeppublishing.com/blogs/football-glossary/the-types-of-blocks-in-football-the-complete-list
- https://www.joedanielfootball.com/blog/combo-blocks
- https://www.milehighreport.com/22451001/difference-between-zone-and-gap-scheme
- https://madden.fandom.com/wiki/Attributes
