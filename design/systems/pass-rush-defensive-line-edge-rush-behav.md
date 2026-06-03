# Pass Rush — defensive line / edge rush behavior (moves, blocker contest, contain, scramble reaction)

> System spec — Gridiron Blitz rebuild. Auto-generated from the parallel research workflow; grounded in the cited sources below.

## Summary
A pass rusher resolves a continuous block contest against his assigned blocker each tick: he picks a MOVE (speed/edge, bull, swim, spin, rip) biased by his rating profile and his leverage vs the blocker, then rolls a single weighted contest (rusherWin = sigmoid of a move-specific rating delta, scaled by a per-tick hazard). The delta of the rusher's move rating vs the blocker's pass-block rating drives a 4-band outcome spectrum from PANCAKE (rusher stoned/driven back) to SUPER WIN (instant blow-by) with variance that GROWS as |delta| grows — big gaps blow by or pancake often, even matchups grind with rare RNG tails. A won rusher then takes a pursuit angle to the QB's launch point; edge rushers hold CONTAIN (stay upfield-outside the QB) unless told to crash, and all rushers re-trigger fresh contest urgency + abandon contain when the QB breaks the pocket to scramble. This extends the existing per-frame `contest()`/`shed` model in Game.ts and is built on the same weighted-roll kernel as block-shedding, tackling, and catch contests.

## Inputs (read each tick / decision)
- Rusher position/velocity (p.x,p.y,p.vx,p.vy) and origin (ox,oy)
- Assigned blocker position/velocity, or null if unblocked/free
- Blocker pass-block rating (PBK)
- Rusher ratings: PMV (power move), FMV (finesse move), BSH (block shed), STR, SPD/ACC, AWR
- Rusher alignment: edge vs interior (|oy - midfield| > 2.4yd => edge), and which gap/side
- engaged (seconds in current block), shed (already-won flag), stun, blocked (this-frame contact flag)
- Whether this is a double-team (two blockers on one rusher)
- QB/carrier launch point: ball.z>release height vs in-hand, QB x,y,vx,vy
- QB state: in-pocket vs scrambling (QB vx magnitude / lateral drift past tackle box), pocket depth
- liveTime / throwTimer (how long since snap — sets baseline pocket-hold expectation)
- Rusher's job: rush vs spy vs contain flag
- dt (frame delta seconds)

## Contest model
```
// ---- 1. MOVE SELECTION (once per engagement, re-pick on stalemate every ~0.6s) ----
// Each rusher has a profile. Pick move weighted by profile fit + leverage vs blocker.
edge = abs(rusher.oy - MIDFIELD) > 2.4*YARD
lever = sign of rusher's beat-angle: if rusher.x already past blocker.x toward QB => "winning edge"
// base weights, then multiply:
w.speed = (edge?1.6:0.7) * (FMV/70) * (SPD/70)
w.rip   = (edge?1.3:1.0) * (FMV/70) * (STR/70)
w.swim  = (FMV/70) * (winningEdge?1.4:1.0)
w.spin  = (FMV/70) * (blockerOverextended?1.8:0.6)   // blockerOverextended = blocker.v toward rusher's old lane
w.bull  = (edge?0.6:1.4) * (PMV/70) * (STR/70)
move = weightedPick(w)   // store on rusher for the engagement

// ---- 2. THE CONTEST (per frame; one weighted roll, shared kernel) ----
// Pick the rating that governs THIS move:
attack = (move==bull) ? 0.7*PMV+0.3*STR
       : (move==speed||move==swim) ? 0.7*FMV+0.3*SPD
       : (move==rip)  ? 0.55*FMV+0.45*PMV
       : (move==spin) ? 0.6*FMV+0.4*AWR
defend = PBK + (interior? +3 : 0)          // guards/center anchor better inside
delta  = attack - defend                    // >0 favors rusher
if (doubleTeam) delta -= 22

// SUPER-WIN (instant blow-by / "ankle-breaker") — only at first contact, not on dbl team
if (firstContact && !doubleTeam) {
  pSuper = clamp((delta - 8) * 0.018, 0, 0.40)   // 8-rating edge ~0%, +30 => ~0.40
  if (rng() < pSuper) { rusher.shed=true; rusher.beat="super"; return }   // free, full speed, blocker stumbles (stun)
  // PANCAKE (rusher stoned & briefly planted) — mirror tail for the blocker
  pPancake = clamp((-delta - 10) * 0.012, 0, 0.30)
  if (rng() < pPancake) { rusher.stun = 0.5 + 0.5*rng(); rusher.engaged += 0.8; return }
}

// PER-FRAME SHED HAZARD (the grind). Even matchup pass-pro holds ~2.6-2.9s.
baseHazard = 0.30                      // /sec at delta 0, pass pro
hazard = baseHazard + delta*0.021      // each rating point ~2% /sec swing
hazard *= moveTempo[move]              // speed/swim 1.15, spin 1.1, rip 1.0, bull 0.85 (slower but pushes pocket)
if (doubleTeam) hazard *= 0.18
hazard = clamp(hazard, 0.03, 2.2)
// VARIANCE WIDENS WITH MISMATCH: add a noise term whose AMPLITUDE scales with |delta|
hazard *= 1 + (|delta|/40) * (rng()*2 - 1) * 0.6
if (rng() < hazard*dt) { rusher.shed=true; rusher.beat="clean" }

// BULL RUSH special: even while NOT shed, a winning bull pushes the pocket.
// blocker (and the protect point) get shoved back toward QB by bullPush*dt, collapsing depth.

// ---- 3. POST-WIN PURSUIT + CONTAIN + SCRAMBLE ----
// won rusher: intercept(QB launch point). super-win => +12% closing speed for 0.4s.
if (rusher.beat && !contain) aim = intercept(rusher, qb)            // attack launch point
if (contain && !qbScrambling) aim = pocketCorner(qb, rusher.side)   // stay upfield+outside, squeeze
qbScrambling = abs(qb.vx) > 0.45*qb.speed OR qb drifted past tackle-box lateral
if (qbScrambling) { contain=false; allRushers re-aim = intercept(qb); freeRushers get +0.5s urgency }
// QB launch point: once ball.z rises (throw), rushers within 1.0yd still contest the throw (knockdown), else converge for sack.
```

## Outcome spectrum
### PANCAKE / stonewall — rusher driven back or planted, 0.5-1.0s stun, blocker pins him out of the play
- **When:** First contact when delta strongly negative (blocker much better than rusher's move), or on a failed bull vs an anchored interior lineman
- **Weighting:** pPancake = clamp((-delta-10)*0.012, 0, 0.30). Maximized by large negative delta (PBK >> attack), double-team (delta -22), interior anchor (+3 def). ~0% until rusher is ~10 pts worse.

### STALEMATE / grind — block holds, rusher mirrored, pocket intact; pocket-hold ~2.6-2.9s on even matchup
- **When:** delta near 0; the default state every frame until a shed roll hits. Bull-rush variant still slowly collapses pocket depth even while held.
- **Weighting:** Dominant band when |delta|<~8. Low per-frame hazard (~0.30/s). Double-team forces this band even for good rushers (hazard *0.18).

### CLEAN WIN — rusher sheds after a beat or two, takes pursuit angle to QB; arrives as moderate pressure or sack depending on QB depth/timing
- **When:** Accumulated per-frame hazard fires; likelihood and SPEED of arrival rise with positive delta. Speed/swim moves shed fastest (moveTempo 1.15).
- **Weighting:** hazard = 0.30 + delta*0.021, scaled by move tempo. Positive delta + edge alignment + finesse profile => frequent, fast wins. Throw-timer interaction: late throws convert wins to sacks.

### SUPER WIN — instant blow-by at the snap (ankle-breaker / clean edge), blocker whiffs/stumbles, rusher free at full speed
- **When:** First-contact roll only, when delta is large-positive (elite rusher vs weak/backup tackle, e.g. edge FMV 92 vs RT PBK 68 => delta ~+24)
- **Weighting:** pSuper = clamp((delta-8)*0.018, 0, 0.40). Needs delta>8 to start; +30 delta ~40% per snap. Suppressed entirely on double-team. This is the dramatic offense-worst tail.

## Concrete numbers / heuristics
- Even-matchup pass-pro hold target: 2.6-2.9s (baseHazard 0.30/sec at delta 0) — matches existing SHED_TIME-era feel and gives QB time to read
- Each rating point ~= 0.021/sec hazard swing (~2% per point); ~+24 delta roughly doubles shed rate vs even
- Super-win: pSuper = clamp((delta-8)*0.018, 0, 0.40); ~0% at +8, ~18% at +18, capped 40% at >=+30 (per snap, first contact only)
- Pancake: pPancake = clamp((-delta-10)*0.012, 0, 0.30); ~0% until -10, capped 30%
- Pancake/super stun on loser: 0.5 + 0.5*rng() sec (0.5-1.0s); super-win blocker also +0.8s effective engaged penalty
- Double-team: delta -22 AND hazard *0.18 (pocket holds ~5-6s) — mirrors existing perSec*=0.2
- Variance amplitude term: hazard *= 1 + (|delta|/40)*(rng()*2-1)*0.6 — at delta 0 noise +/-0%, at delta 40 noise up to +/-60% (mismatch widens the spread, even matchups stay tight)
- Edge classification: |oy - WORLD_H/2| > 2.4*YARD => edge rusher (reuses current shedRating heuristic)
- Interior anchor bonus: +3 to blocker defend (guards/center)
- Move tempo multipliers: speed/swim 1.15, spin 1.10, rip 1.00, bull 0.85
- Bull-rush pocket push: ~0.6-1.0 yd/sec collapse of protect-point depth while winning even if not yet shed
- Scramble trigger: |qb.vx| > 0.45*qb.speed (qb.speed=8.2 => ~3.7 yd/s) OR QB lateral drift past tackle box; flips contain off, +0.5s urgency to free rushers
- Super-win closing-speed bonus: +12% for 0.4s after the win
- Move re-pick interval on stalemate: ~0.6s
- Throw-contest radius: rusher within 1.0*YARD of launch point can knock down / hit-as-thrown (reuses BLOCKED_REACH/DEFLECT bandwidth)

## Ratings used
- Rusher PMV (power move) — drives bull rush and rip power component
- Rusher FMV (finesse move) — drives speed/edge, swim, spin, rip finesse component
- Rusher BSH (block shed) — drives shed hazard when re-engaging / fighting off a sustained block and the per-frame grind
- Rusher STR (strength) — secondary in bull/rip; anchors against being pancaked
- Rusher SPD/ACC — speed-rush selection weight and post-win closing speed
- Rusher AWR — spin timing and reading blocker overextension; scramble reaction sharpness
- Blocker PBK (pass block) — the defend value; primary opponent rating (interior +3 anchor)

## Variance model
Variance is a deliberate function of |delta|, not constant. Three layers: (1) Tail probabilities — super-win and pancake chances are zero near even and grow linearly with the mismatch magnitude, so big gaps produce dramatic instant outcomes OFTEN while even matchups almost never do. (2) Hazard noise amplitude — the per-frame shed hazard is multiplied by 1 + (|delta|/40)*uniform(-1,1)*0.6, so at delta 0 the shed time is tight/predictable (a grind) but at large |delta| the outcome timing swings wildly (sometimes instant, sometimes a held block that suddenly breaks). (3) X-factor floor — even at delta 0 the base hazard (0.30/s) plus move-tempo jitter still yields occasional fast wins (~5-10% of even matchups shed inside 1.2s) so an even grind still throws the rare exciting collapse. Net: averages converge near realistic pocket times, but the SPREAD of readable dramatic results widens monotonically with the rating gap, exactly per the owner's variance constraint. All randomness flows through the shared rng() so the two pre-rolled POC teams stay deterministic for headless tests.

## Dependencies
- Shared CONTEST KERNEL (weighted-roll sigmoid/hazard) — must be the same primitive used by block-shedding, broken-tackle, and catch contests so deltas/variance read consistently
- Block-shedding / pass-protection system (passProtect/engageBlock in Game.ts) — supplies blocker assignment, double-team flag, and the protect point; bull-rush pocket-push writes back to it
- Player ratings model — needs PMV/FMV/BSH/STR/SPD/ACC/AWR/PBK fields added to Player or a ratings table (currently only ad-hoc BLOCK_RATING/shedRating constants exist in Game.ts lines 80-91)
- QB / pocket + scramble system — provides launch point, in-pocket vs scrambling state, throwTimer; consumes pressure to trigger throwaway/scramble
- Tackle system — a free/won rusher reaching the QB invokes the sack/tackle contest (checkTackleAndScore)
- Pass / ball-in-air system — rusher-at-launch-point throw knockdown feeds the existing deflect/tip logic (DEFLECT_R, TIP_CHANCE)
- Defensive job assignment (assignJobs, rushers set, contain/spy) — sets which defenders rush and which hold contain

## Sources
- https://www.madden-school.com/block-shedding-power-move-ratings/
- https://madden.fandom.com/wiki/Attributes
- https://www.viqtorysports.com/pass-rush-moves/
- https://dlineexamples.substack.com/p/pass-rush-moves-handbook
- https://www.gooalsocial.com/blogs/view/9394/mmoexp-madden-25-ultimate-pass-rush-guide-dominate-the-pocket
- https://www.ea.com/games/madden-nfl/madden-nfl-26/tips-and-tricks-hub/m26-how-to-stop-quarterback
- https://forums.ea.com/discussions/madden-nfl-26-general-discussion-en/how-to-qb-contain-and-stop-the-qb-in-the-option-game/12492044
- /Users/chrissparks/Documents/code/gridiron-blitz/src/game/Game.ts (contest() lines 738-766, rushPasser 1020-1024, passProtect 1171-1214, shedRating/blockRating 80-91)
