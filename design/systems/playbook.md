# Playbook & Formations

> System spec — Gridiron Blitz rebuild. Auto-generated from the parallel research workflow; grounded in the cited sources below.

## Summary
A normalized, data-driven playbook: offensive formation FAMILIES (I-Form, Singleback/Ace, Shotgun, Pistol, Pro Set, Strong/Weak, Goal Line, Empty) each with variants (Pro/Tight/Twins/Trips/Bunch/Doubles/Empty/2-TE) and a tagged personnel grouping (10/11/12/13/21/22), plus defensive fronts (4-3, 3-4, Nickel, Dime, Quarter, 5-2/Bear/46, Goal Line) and coverages (Cover 0-6, Man/Press, Tampa-2, Quarters). Every formation supplies an 11-man alignment (fwd/lat yards from the ball) and a play menu; every play is a list of assignments (route nodes, run hole+pull, blocking) that the engine already consumes. The playbook itself is mostly STATIC GEOMETRY + tags; it does not roll contests. It instead emits per-play "matchup modifiers" (box count, pass-rush count, leverage, coverage-vs-concept fit) that bias the SHARED contest kernel — so formation/scheme advantage shifts the weighted roll without the playbook owning any RNG.

## Inputs (read each tick / decision)
- Selected offensive formation id + variant (sets 11-man pre-snap alignment via base + per-slot override)
- Selected offensive play id (kind: run|pass|rpo|pa|screen|fg|punt; assignments per slot)
- Selected defensive formation id (sets 11-man front: DL/LB/CB/S slots + alignment)
- Selected defensive play id (coverage 0-6, blitzer count, press 0..1, spy flag)
- Personnel grouping tag of offense (RB/TE/WR counts) and defense (base/nickel/dime/goalline)
- Down, distance, ball-on (situation), used only to weight AI play-selection, not the contest
- Pre-snap motion/audible state (slot can shift lat before snap)
- Box count = defenders within ~5 yds of LoS and inside the tackle box (derived from defensive front + blitzers)
- Pass-rush count = DL + blitzers; coverage shell type (deep-1/2/3/4 zones or man)
- Leverage = lateral offset between each receiver's release and his assigned defender's alignment (derived)

## Contest model
```
// The playbook produces GEOMETRY + per-matchup MODIFIERS feeding one shared weighted-roll kernel.
// Kernel (shared, owned by synthesis): P(offense wins a contest) = logistic(k * (attRating - defRating + schemeMod) / 100)
//   with variance scaled by |attRating - defRating| (see varianceModel). Roll once per contest event.

// 1) FORMATION -> ALIGNMENT (static)
align(slot) = OFFENSE_BASE[slot] + formation.align?[slot]   // fwd/lat yards; defense uses front[] absolute slots

// 2) PERSONNEL/BOX -> RUN vs PASS structural edge (schemeMod inputs, NOT a roll)
boxCount   = count(defenders with fwd<=5 AND |lat|<=4)              // tackle-box defenders
blockers   = OL(5) + TE_inline + RB_lead(+pull?1:0)                 // run play blockers at point of attack
boxAdv     = blockers - boxCount                                    // +1 => light box (offense edge), -1 => stacked box
RUN_schemeMod  = clamp(8 * boxAdv, -24, +24)                        // pts added to ball-carrier/blocker contests

rushCount  = DL_count + defensePlay.blitzers
proCount   = OL(5) + TE_inline*kept + RB_block                      // pass-protectors
protAdv    = proCount - rushCount                                   // <0 => free rusher => pressure
PASS_protMod = clamp(7 * protAdv, -21, +21)                         // pts added to each OL block contest
freeRusher = rushCount > proCount                                   // forces unblocked-rush contest at SHED window

// 3) COVERAGE vs CONCEPT FIT -> per-receiver separation edge (schemeMod)
//   each route node tagged with a routeType; each coverage has a beaten[] / strong[] list:
covFit(route, coverage) = +12 if route.beats(coverage)
                          -12 if coverage.strong_vs(route)
                          +6  if leverage favors release (CB inside, route breaks out, etc.)
                           0  otherwise
SEP_schemeMod = covFit + pressMod   // pressMod = -press*10 to receiver release vs man-press

// 4) The kernel consumes these as schemeMod for each contest type:
//   block:   roll(OL.strength+RUN/PASS mod  vs DL.strength)         -> win=pancake-chain, lose=shed/pressure
//   shed:    timer SHED_TIME scaled by (1 - schemeMod/100)          -> earlier shed when D has edge
//   tackle:  roll(carrier.elusive+RUN mod vs defender.tackle)       -> win=break, lose=down
//   catch:   roll(WR.catch+SEP mod vs DB.coverage)                  -> win=catch, lose=PBU/INT band
// Playbook NEVER rolls; it only fills schemeMod + alignment + which contests exist this play.
```

## Outcome spectrum
### Pancake / blow-by chain (extreme): blocker buries defender, lane opens, big run or clean pocket
- **When:** Run into a light box (boxAdv>=+1) or man-press beaten by route, with a large OL.str>DL.str gap; high tail of the roll
- **Weighting:** Large +RUN_schemeMod (light box) AND large positive rating delta widen the upper tail; pull/lead blocker (power/sweep) adds +blocker at POA; goal-line/jumbo personnel raises it for short runs

### Explosive pass: coverage-beating concept hits in space for a chunk/TD
- **When:** Concept matched against the coverage it beats (e.g. Four Verts vs Cover 0/1, Smash vs Cover 2, Mesh vs man, Flood vs zone) plus protAdv>=0
- **Weighting:** +SEP_schemeMod from covFit (+12) and favorable leverage (+6); blitz that leaves a vacated zone (zoneblitz) spikes it; WR.speed/route-run delta over DB widens tail

### Designed gain (modal): play works as drawn for its expected yardage
- **When:** Even matchup, neutral box, coverage neither beats nor stones the concept
- **Weighting:** Near-zero schemeMod and small rating delta keep outcome near the play's baseline yardage with low spread

### Grind / minimal gain: defender sheds on time, carrier tackled near LoS, or checkdown only
- **When:** Stacked box vs run (boxAdv<=-1), or coverage strong-vs-concept (e.g. Verts vs Cover 4, run vs 46/Bear front)
- **Weighting:** -RUN/-SEP schemeMod pulls outcome down; balanced ratings keep it a grind rather than a loss

### Pressure / TFL: free rusher or won block collapses the play
- **When:** protAdv<0 (more rushers than blockers — all-out/man blitz) OR DL.str >> OL.str so block sheds before throw
- **Weighting:** Negative protMod and blitzers>0 raise it; SHED_TIME shrinks with defender edge; QB-under-center play-action lengthens exposure

### Sack / strip / INT (worst tail): pressure home before release, or contested throw picked
- **When:** All-out blitz beating max protect, OR forcing a covered route into a deep zone (Cover 3/4) the concept doesn't beat
- **Weighting:** Big negative protMod + multiple blitzers spike sacks; throwing into coverage strong-vs-concept plus DB ball-skills>WR widens INT band (INT_CHANCE base 0.3 within reach)

## Concrete numbers / heuristics
- Personnel groupings (RB/TE count): 11=1RB/1TE/3WR (NFL ~52% of snaps, the base), 12=1/2/2, 13=1/3/1, 21=2/1/2 (I-Form/Pro Set), 22=2/2/1 (goal line), 10=1/0/4, 00/01=empty 0-1 back
- Box-count edge: boxAdv each +1 blocker = +8 pts to run contests, clamped +/-24; protAdv each +1 blocker = +7 pts, clamped +/-21
- Coverage-fit: concept beats coverage = +12 pts separation; coverage strong-vs-concept = -12; favorable leverage = +6; man-press release penalty = -press*10 (press 0.7-0.85 in data)
- Rush count = DL + blitzers: 4-3 base=4 rush, zone/fire blitz=+2 (6), man blitz=+1 (5), all-out=+3 (7); max-protect adds RB+TE = 7 blockers
- Alignment yards (from existing engine): OL split ~1.5 yd, QB shotgun -5 fwd / pistol -3.5 / under-center -1, RB I-form -5 fwd, slot WR ~8 yd, wide WR ~10-12 yd lat, TE inline ~3.5 lat
- Defensive shells: Cover 0 = 0 deep (max blitz), Cover 1 = 1 deep FS, Cover 2/Tampa-2 = 2 deep halves, Cover 3 = 3 deep thirds, Cover 4/Quarters = 4 deep, Cover 6 = quarter-quarter-half
- Defensive personnel response: base (4-3/3-4) vs 21/12, Nickel (5 DB) vs 11, Dime (6 DB) vs 10/empty, Goal Line/46/Bear vs 22/13
- SHED_TIME baseline 1.3s scaled by (1 - schemeMod/100): a +24 run edge stretches blocks ~1.6s; a -24 edge sheds ~1.0s
- INT_CHANCE 0.30 within reach, TIP_CHANCE 0.50 of remainder (existing constants) — coverage-fit shifts which throws land in the contested band
- Suggested counts: ~7 offensive families x ~3-5 variants = ~24 formations; ~6 defensive fronts; 9 coverage calls; 8-9 plays per formation menu

## Ratings used
- Offense - OL run_block / pass_block & strength (block + shed-resist contests)
- Offense - RB/QB carry: elusiveness/agility (juke, break-tackle) + speed + trucking/strength
- Offense - WR/TE: route_running, catch, speed, release-vs-press (separation + catch contests)
- Offense - QB: throw_power/accuracy gates pass arc, awareness biases AI target pick (not a contest roll)
- Defense - DL: pass_rush_moves / block_shed + strength (vs OL block)
- Defense - LB/S in box: tackle / pursuit / block_shed (run fits, blitz)
- Defense - CB/S: man_coverage, zone_coverage, press, ball_skills (separation + INT band)
- Note: playbook supplies the schemeMod; the RATING DELTA on each side is what the shared kernel actually rolls — formation only tilts it

## Variance model
Variance is owned by the shared kernel but the playbook sets the inputs that drive it. Per contest, effective edge E = (attRating - defRating + schemeMod). The win probability is logistic(k*E/100) with k~6-8. Variance (spread of the YARDAGE/outcome, not the win bit) scales with |E|: define sigma_outcome = base * (1 + |E|/40). A big mismatch (|E| ~ 40-60, e.g. elite OL vs scrub DL into a light box) pushes win-prob toward 0.9+ AND fattens the upper tail, so pancakes/blow-bys recur often and dramatically. An even matchup (|E| ~ 0-8) sits near 50/50 with tight sigma — mostly the modal grind — but a small fixed X-factor jitter (add Gaussian noise ~N(0, 6 pts) to E before the roll, ~5% of contests get a +15 'splash' bonus) guarantees occasional exciting tails even between equals. Formation choice mainly moves the MEAN edge (schemeMod) while the rating delta sets how heavy the tails are: scheme can manufacture a temporary mismatch (light box, beaten coverage) so even balanced rosters generate readable blow-bys when out-schemed. Deterministic POC: seed the RNG per play so the two pre-rolled teams reproduce identical spectra headlessly.

## Dependencies
- Shared contest kernel (synthesis) — playbook emits schemeMod (box/protect/coverage-fit) but does not roll; must agree on logistic k, sigma scaling, and contest event types (block/shed/tackle/catch)
- Blocking & pass-rush system — consumes formation alignment + pull/assignment to set who blocks whom and the protAdv/boxAdv counts
- Coverage/AI defender system — consumes coverage id + press + blitzers to assign man/zone/spy jobs and derive shell-vs-concept fit
- Ratings/roster system — the two pre-rolled POC teams supply the per-player ratings the kernel deltas against; playbook is rating-agnostic
- Existing engine data shapes in src/game/types.ts (OffenseFormation/DefenseFormation/OffensePlay/DefensePlay/DefSpot) and constants.ts (SHED_TIME, INT_CHANCE, speeds) — new playbook must extend these, adding routeType + concept/coverage-fit tags and a personnel field
- AI play-selection — uses down/distance/ball-on + personnel tags to pick formation+play (separate from the contest)

## Sources
- https://en.wikipedia.org/wiki/List_of_formations_in_American_football
- https://en.wikipedia.org/wiki/Personnel_grouping_(gridiron_football)
- https://maddenguides.com/personnel-groupings-101/
- https://www.madden-school.com/playbooks/
- https://www.operationsports.com/10-best-madden-25-offensive-playbooks-ranked/
- https://www.viqtorysports.com/defensive-coverages-in-football-complete-guide/
- https://en.wikipedia.org/wiki/Zone_defense_in_American_football
- https://gorout.com/football-personnel-groupings/
- https://xsosfootball.com/i-formation-and-sets/
