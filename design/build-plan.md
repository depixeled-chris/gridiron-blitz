# Build Plan

> Synthesized design — Gridiron Blitz. Reconciled from all system specs in `systems/`.

## Build order (phased; acceptance = outcome DISTRIBUTIONS / tail-rates in a headless sim, never averages)

Headless harness: run N reps with `reseed(seed)` per rep over a sweep of rating deltas; log every `ContestResult` + final play outcome; assert on **histograms and tail percentages**, not means.

### Phase 0 — Foundation + Kernel
**Ships:** `ratings` record on `Player`; `contest()` + `reseed()` in `utils.ts`; the steering integrator + `leadPoint()` replacing `moveToward`/`pps`/`intercept`; constants block. The two POC rosters baked.
**Accept:** Kernel unit sweep — at `delta=0` win-rate 48-52%, extreme-rate <0.5%; `delta=+16` win 70-76%; `delta=+48` win 93-96% with extreme-rate 35-45%. `sev` histogram at `delta=0` clusters <0.2 with a visible 5-8% tail >0.4. Movement: WR 0-vmax in ~1.8s (70-ACC), full-speed turn radius 2.5-3.5yd; 99-SPD ~+13-15% closing vs 70.

### Phase 1 — Line play (Pass Block / Run Block / Pass Rush)
**Ships:** engaged-pair resolver calling `contest(perFrame)`; drive/shed/pancake kinematics; double-team; emergent time-to-pressure.
**Accept:** Even line (HOME interior) pass-pro **hold-time distribution** median 2.6-2.9s, <10% under 1.5s, fat tail to 4s+. AWAY EDGE91 vs HOME RT76: pressure <2.0s on ~55-65% of reps, super-win (instant) on 15-25%. Double-teamed rusher sheds <5%. Run: even interior STALEMATE ~55%, drive >1yd ~25%, pancake ~3%; mismatch interior pancake ~30-36%.

### Phase 2 — Coverage & Routes (Man / Zone / Route Running)
**Ships:** jam/break/phase via shared `jam`/`cut` calls; cushion drift; pattern-match->man; the `separation` scalar.
**Accept:** Even WR/CB **separation-at-break histogram** modal ~1yd, ~3-5% double-move blow-by tail (>2yd). HOME WR80 vs AWAY CB22: open (>2yd) on ~45-55% of breaks. Press jam-win shifts separation distribution left by ~0.5yd. Zone reactLag bites pump-fakes (measurable late-drive %).

### Phase 3 — Carrier / Tackling / Run Fits
**Ships:** Tackle contest (replaces 0.12 hack), action-by-angle, gang stacking, fumble side-roll, vision lane read, fitRole leverage.
**Accept:** Even RB vs LB **first-contact outcome histogram**: clean tackle ~55-60%, broken ~10-15%, stuff ~10%, with ~8-12% dramatic tail (pancake hit OR truck). 2-hat gang breaks <8%. AWAY RB28 vs HOME front: broken-tackle ~30-40%. Fumble rate 1-3% overall, spiking on big-HIT mismatches. Vision: BCV99 picks best lane ~100%, BCV50 ~78%.

### Phase 4 — QB AI & Passing
**Ships:** progression clock, openness/trigger, pressure branch, throw contest feeding catch.
**Accept:** Even-matchup full-drive **box-score distribution**: completion 55-60%, sack 6-8%, INT 2-3%, with dramatic tails on mismatch (elite QB vs weak CB2: dime/chunk rate visibly elevated; weak QB under pressure: INT tail to 8-10%).

### Phase 5 — Playbook & Formations
**Ships:** normalized formation/personnel/coverage data emitting scheme point-biases.
**Accept:** Scheme manufactures mismatch — light box shifts run-gain distribution right; concept-vs-beaten-coverage lifts explosive-pass tail; verified that scheme moves the MEAN edge while rating delta still controls tail heaviness (turn off ratings delta -> scheme alone yields modest shift, not blowouts).

### Phase 6 — Tuning
**Ships:** exposed knobs; full HOME-vs-AWAY headless season.
**Accept:** Over 200 seeded games, score-margin distribution is wide and readable (not clustered), big-play (20+yd) rate 8-12% of drives, blowout games correlate with the designed mismatches. No single knob produces degenerate dominance.
