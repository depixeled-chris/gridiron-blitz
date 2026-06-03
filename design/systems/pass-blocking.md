# Pass Blocking (pass protection mechanics)

> System spec — Gridiron Blitz rebuild. Auto-generated from the parallel research workflow; grounded in the cited sources below.

## Summary
Pass protection is modeled as a continuous per-frame contest between each blocker and the rusher he is assigned, anchored on the segment between the rusher and the QB launch point. Each frame the engagement accumulates "leverage" via a weighted roll: the blocker's pass-block ratings vs. the rusher's pass-rush ratings (split by power/finesse), with variance that grows with the rating mismatch so big gaps produce frequent blow-bys and pancakes while even matchups grind to a stalemate with rare X-factor tails. Time-to-pressure is emergent: it is simply how long it takes a rusher to win his leverage battle and clear the blocker's body to reach the QB, not a timer. Assignment is inside-out (4 DL + identified Mike base, backs/TEs pick up next interior threat), with spare blockers forming double-teams that nearly stonewall a single rusher.

## Inputs (read each tick / decision)
- QB launch/anchor point (current drop spot, updates as QB drops/climbs)
- Each rusher's world position, velocity, and rush vector toward the QB
- Each blocker's world position and velocity
- rushers set (which defenders are rushing this play) from defensive assignment
- Per-engagement state: engaged time (s), leverage value (signed, accumulated), blocked flag, shed flag, doubled flag, side-beaten (which shoulder)
- Blocker ratings: passBlock (base), passBlockPower, passBlockFinesse, strength, awareness/footwork, weight
- Rusher ratings: passRushPower, passRushFinesse, the rusher's chosen move type (power|finesse|none), strength, acceleration, weight, X-factor flag
- Whether the rusher is being double-teamed (count of blockers on him)
- Whether this is a designed quick game / max-protect (extra blockers) vs base 5-man
- dt (frame delta seconds)
- Pre-snap Mike identification + slide direction (defines assignment fan-out)

## Contest model
```
// ---- ASSIGNMENT (inside-out, big-on-big, back-on-Mike) ----
// rushers sorted by THREAT = distance-to-QB-launch (closest = most dangerous),
// tiebreak interior gaps before edges.
// Pool blockers = OL first, then TE/RB. Base: 5 OL take the 4 DL + identified Mike.
// For each rusher (closest-first): assign nearest UNCLAIMED blocker whose lane
// matches (inside-out: a blocker protects his inside gap before widening to edge).
// Leftover blockers => DOUBLE the most dangerous already-engaged rusher.
// Fewer blockers than rushers => the farthest/last rusher comes FREE (unblocked).

// ---- ANCHOR (stay between rusher and QB) ----
// anchorPt = rusher.pos + unit(QB.launch - rusher.pos) * BLOCK_STANDOFF (~0.7*BLOCK_R)
// Blocker steers toward anchorPt at min(blockerSpeed, rusherSpeed*1.05). The blocker
// can mirror lateral rush speed up to a footwork cap; if rusher's lateral velocity
// exceeds cap, blocker loses an edge step (feeds finesse/speed win, see below).
// While within BLOCK_R*1.5 the rusher is "blocked": shove rusher AWAY from QB along
// the anchor axis by SHOVE = strengthFactor * dt so he cannot cross the blocker's body.

// ---- THE CONTEST (per frame, single weighted-roll kernel) ----
// Pick the rusher's effective block-defense rating by move type:
//   if move==power   -> blkDef = 0.7*passBlockPower + 0.3*strength
//   if move==finesse -> blkDef = 0.7*passBlockFinesse + 0.3*awareness   // footwork beats finesse
//   else (none)      -> blkDef = passBlock
// And the rusher's offense rating:
//   rushOff = (move==power? passRushPower : move==finesse? passRushFinesse : 0.5*(power+finesse))
// delta = rushOff - blkDef            // >0 favors rusher
// mismatch = abs(delta)
//
// Per-frame leverage gain (signed; + means rusher gaining):
//   base   = delta * K_LEVER                       // K_LEVER ~ 0.020 per rating pt
//   noise  = gauss(0, sigma) ; sigma = SIGMA0 + mismatch*SIGMA_SLOPE   // variance grows w/ gap
//   gain   = (base + noise) * moveSpeedFactor      // power slower-but-steady, finesse spiky
//   leverage += gain * dt
// where for power: base*1.1, sigma*0.8 (steady grind); finesse: base*0.9, sigma*1.5 (spiky).
//
// DOUBLE TEAM: gain *= 0.20 (stonewall). Also caps leverage so a doubled rusher
// essentially never wins unless one blocker peels to a blitzer.
//
// FIRST-CONTACT TAIL (one-shot at engaged<~1 frame, NOT doubled):
//   pWhiff   = clamp((delta - 6)*0.03, 0, 0.55)   // blocker whiffs -> instant blow-by
//   pPancake = clamp((-delta - 10)*0.025, 0, 0.40)// blocker dominates -> rusher flattened/stunned
//   roll once: whiff => shed=true (free rusher); pancake => rusher stun + leverage locked low.
//
// RESOLUTION THRESHOLDS on accumulated leverage L:
//   L >= WIN_THRESH (~1.0)   => rusher SHEDS: shed=true, clears blocker's shoulder,
//                               now pursues QB at full speed (pressure begins).
//   L <= LOSE_THRESH (~-1.0) => blocker PANCAKES/seals: rusher stun ~0.5s, leverage reset,
//                               re-engage (rusher effectively removed for the rest of the rep).
//   else                     => STALEMATE: rusher held at the anchor (the pocket).
// Once shed=true it stays beaten for the rest of the play (no re-block).
//
// ---- TIME-TO-PRESSURE (emergent, no timer) ----
// Expected time for rusher to reach L=WIN_THRESH from 0:
//   t_win ~= WIN_THRESH / max(eps, base*moveSpeedFactor)   (noise adds spread)
// Even matchup (delta~0): base~0 => only noise drives it => mean ~2.7-3.0s, wide spread.
// Edge mismatch (delta~+15): base~0.30/s => ~3.3s/0.30 ~ wins in ~1.5-2.0s (quick pressure).
// Heavy block edge (delta~-15): rusher rarely reaches threshold => pocket holds 4s+ / pancake.
```

## Outcome spectrum
### Clean blow-by / whiff (rusher free almost instantly)
- **When:** First-contact one-shot roll fires: blocker whiffs the set, or a fast finesse rusher beats the blocker's footwork cap to a shoulder before contact. Rusher shed within ~0.0-0.3s, sprints free at QB.
- **Weighting:** pWhiff = clamp((delta-6)*0.03,0,0.55). More likely as rushOff >> blkDef (esp. finesse rusher vs slow/low-awareness blocker). Effectively impossible when doubled or when blocker rating >= rusher.

### Fast win / pressure (rusher sheds in ~1.0-2.0s)
- **When:** Rusher accumulates leverage to WIN_THRESH quickly because delta is solidly positive; sheds, clears shoulder, reaches QB before ~2.5s -> a 'pass rush win'.
- **Weighting:** delta = rushOff-blkDef in roughly +8..+18. Power move steadier (bull-rush walk-back), finesse spikier. Higher rusher accel shortens post-shed time-to-QB.

### Stalemate / pocket holds (the grind)
- **When:** Even matchup: leverage oscillates near 0 from noise, rusher held at the anchor point, QB has a clean pocket until ~2.7-3.5s. This is the modal outcome on balanced reps.
- **Weighting:** |delta| small (<~6). Double-team forces stalemate even vs a strong rusher. Max-protect (extra blockers) widens this band.

### Slow loss for offense (pressure arrives late ~3.0-4.0s)
- **When:** Rusher slightly favored; noise eventually pushes leverage over WIN_THRESH after the QB's ideal release window, producing late pressure / flush.
- **Weighting:** delta small-positive (+2..+7). Variance tail: occasional even-matchup win comes from SIGMA0 noise, giving the X-factor 'he just won' moment.

### Blocker wins / rusher sealed (pocket clean all rep)
- **When:** Blocker favored; leverage trends negative, rusher never reaches threshold; pocket stays clean past 4s. Blocker 'pass block win'.
- **Weighting:** delta negative (blkDef > rushOff by 6+). Doubling pushes nearly all reps here. Higher blocker strength/awareness deepens it.

### Pancake (blocker flattens rusher)
- **When:** Blocker dominates: first-contact pancake roll fires OR leverage drops to LOSE_THRESH. Rusher stunned ~0.5s, knocked off path, removed from the rep.
- **Weighting:** pPancake = clamp((-delta-10)*0.025,0,0.40). Needs big blocker edge (blkDef >> rushOff, ideally power blocker vs weak/finesse rusher) and/or double-team. Rare in even matchups (the dramatic tail).

## Concrete numbers / heuristics
- Win threshold for a 'block win' = block sustained 2.5s (NFL PBWR/PRWR standard)
- League pass-block win rate ~75% (tackles ~79%); pass-rush win rate ~25%; best blockers 90-96%, best edge rushers 34-47% (target these as rating-50-ish baselines)
- Average time-to-pressure ~2.9s; quick pressure < 2.5s; QB avg time-to-throw ~2.75s
- K_LEVER = 0.020 leverage/sec per rating point of delta
- WIN_THRESH = +1.0 leverage, LOSE_THRESH = -1.0 leverage
- SIGMA0 (base per-frame noise) ~ 0.18/sqrt(dt-normalized); SIGMA_SLOPE ~ 0.012 per mismatch point (variance grows with gap)
- Double-team leverage multiplier = 0.20 (stonewall)
- First-contact pWhiff = clamp((delta-6)*0.03, 0, 0.55); pPancake = clamp((-delta-10)*0.025, 0, 0.40)
- BLOCK_R = 1.1 yd (engage radius), engage-active out to BLOCK_R*1.5; BLOCK_STANDOFF = 0.7*BLOCK_R toward QB
- Power-move sigma factor 0.8 + base 1.1 (steady); finesse sigma factor 1.5 + base 0.9 (spiky)
- Post-shed rusher stun on pancake/lose = 0.5s; whiff stun = 0s
- Emergent t_win ~= WIN_THRESH / (base*moveSpeedFactor): delta+15 edge ~1.5-2.0s; delta 0 ~2.7-3.0s noise-driven; delta -15 rarely resolves (4s+)
- OL top speed 7.4 yd/s vs DL 7.6 yd/s (blocker must rely on anchor/standoff, not foot-race, vs edge speed)

## Ratings used
- Blocker (offense): passBlock (base, vs no-move rusher), passBlockPower (vs power/bull rush), passBlockFinesse (vs finesse/speed move), strength (anchor + shove + pancake), awareness/footwork (recognition, mirroring finesse, double-team handoff), weight (impact in moving blocks)
- Rusher (defense): passRushPower (bull/club), passRushFinesse (swim/spin/speed), strength (shed power, walk-back), acceleration (post-shed burst to QB), weight, awareness (move selection), X-factor flag (boosts tails)

## Variance model
Variance is injected as per-frame Gaussian noise on the leverage gain whose standard deviation GROWS with the rating mismatch: sigma = SIGMA0 + mismatch*SIGMA_SLOPE. On an even matchup (mismatch~0) sigma is small (~0.18) so reps cluster into a grind/stalemate, but the fat-ish tail still occasionally tips leverage over the win/lose thresholds early -> the rare exciting X-factor win or pancake on a balanced rep. As the gap widens, BOTH the deterministic base term and the noise grow, so a big edge produces frequent extreme outcomes: a +15 finesse rusher both wins fast on average AND, via the inflated sigma, sometimes blows by almost instantly or (rarely) gets stonewalled, keeping outcomes dramatic and readable rather than deterministic. First-contact whiff/pancake one-shot rolls add discrete heavy tails gated by the mismatch sign (only big edges can fire them). X-factor/elite flags raise the win-side sigma and lift the cap so superstar rushers produce more blow-bys; double-team collapses sigma and base (multiplier 0.20) so doubled reps are reliably stalemates. This is a single weighted-roll kernel: signed delta -> mean drift, mismatch -> spread, thresholds -> outcome bucket, directly compatible with a shared contest kernel.

## Dependencies
- Defensive assignment system (defines the rushers set, blitzers, identified Mike, slide direction) — pass protection consumes its rush list
- QB / pocket system (supplies the live QB launch/anchor point as he drops and climbs; consumes 'time-to-pressure' and shed flags to trigger flush/sack pressure)
- Tackle/sack resolution (a shed rusher reaching the QB hands off to the tackle/sack contest)
- Shared contest kernel (weighted-roll: delta->drift, mismatch->variance, thresholds->buckets) — must match run-blocking and block-shedding so the same math drives all engagements
- Player ratings model / two pre-rolled POC teams (must expose passBlock/PBP/PBF/strength/awareness on OL+TE+RB and passRushPower/Finesse/strength/accel on the front seven for deterministic headless tests)
- Run-blocking system (shares engageBlock/contest primitives; pass-protect is the pocket-anchored variant)

## Sources
- https://www.ea.com/news/pass-blocking-rush
- https://www.mut.gg/news/ask-huddle-40-how-pass-blocking-actually-works-in-madden/
- https://madden.fandom.com/wiki/Attributes
- https://maddenguides.com/pass-protection-schemes/
- https://www.dawgsbynature.com/2011/10/7/1838147/pass-protection-101
- https://www.cougcenter.com/2013/3/28/4093000/air-raid-playbook-pass-protection-schemes
- https://www.nfl.com/news/next-gen-stats-introduction-to-pressure-probability
- https://www.espn.com/nfl/story/_/id/24892208/creating-better-nfl-pass-blocking-pass-rushing-stats-analytics-explainer-faq-how-work
- https://www.espn.com/nfl/story/_/id/46138675/2025-nfl-win-rates-top-teams-players-rankings-pass-run-block
- https://www.pff.com/news/pro-how-speed-to-apply-pressure-affects-overall-pass-rushing
