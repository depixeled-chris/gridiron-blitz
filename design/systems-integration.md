# Systems Integration

> Synthesized design — Gridiron Blitz. Reconciled from all system specs in `systems/`.

## How each system plugs into the ONE kernel + foundation

Every system below **builds a composite `atk`/`def`, sets `leverage`/`momentum`/`situation` point-biases, picks INSTANT vs `perFrame`, then calls `contest()`**. No system rolls its own RNG or invents its own curve.

### Movement & Kinematics (foundation owner)
- Owns the steering integrator + the shared `leadPoint()` helper. Contested redirects (juke, mirror-cut, angle recovery) call `contest(kind:'cut', atk=carrier.AGI, def=pursuer.AGI, leverage=angleBias)`. On `win`+`sev`, winner gets vmax burst `1.05+0.13*sev` for 0.3s and loser eats `perp` overcommit + stun `0.15+0.25*sev`s.
- Consumes `shed/blocked/stun` to gate force application. **Couples to everything** (all systems read/write `v`,`heading`,`stun`).

### Pass Blocking
- Per engaged pair, `perFrame` contest. `atk=rusher move-rating` (bull `0.7*PMV+0.3*STR`; finesse `0.7*FMV+0.3*SPD`), `def=PBK` (or PBP/PBF by move), `momentum += dbl? -22 : 0`, interior `def+3`. `firstContact` enables the extreme channel (whiff=BLOW-BY, pancake=def extreme). Accumulated wins -> `shed=true` (sticky), feeding the QB pressure model. Time-to-pressure is **emergent** (no timer). Bull-rush winner additionally shoves the protect-point toward QB `bullPush*dt` even while not shed.
- Couples to: Defensive assignment (rush set, double flag), QB AI (consumes `shed`/pressure), Tackle (shed rusher reaching QB -> sack contest).

### Run Blocking
- Same `perFrame` contest, `kind:'shed'` (base 0.50/s). `atk=RBK` (or `IBL` at 2nd level), `def=BSH`; `leverage`: combo `-14`, down-block `-5`, reach `+6`, pull-late `+4`. DRIVE = continuous `def.x` push `(0.9 - delta*0.05)*dt`. Carrier reads the **resolved** lane (argmax laneScore weighting `blocked&!shed *0.15, shed *0.7, free *1.0`), gated by BCV (see Run Fits).
- Couples to: Run Fits (lane read + fitRole), Defender pursuit (`shed`/`pancaked` release gate).

### Pass Rush
- The defense side of Pass Blocking — **same engaged pair, same contest call**, just the rusher is the `atk`. Move selection (speed/bull/swim/spin/rip) is a weighted pre-pick that only chooses *which composite* `atk` uses; the roll is the shared kernel. Post-win: pursuit lead to QB launch; EDGE holds contain (`leadPoint` biased upfield-outside) until `qbScrambling` flips it off. **Conflict resolved:** Pass-Block and Pass-Rush are ONE engagement resolved once per frame, not two competing rolls.

### Man Coverage
- Jam: INSTANT `contest(kind:'jam', atk=DB(0.6*PRS+0.4*STR), def=WR(0.6*RLS+0.4*STR), firstContact)`. Phase pursuit: `leadPoint` to WR hip + leverage offset; cushion drifts by `covDelta` (a *non-rolled* deterministic term `(def.MCV/.5+SPD/.3+ACC/.2)-(wr.AGI/.4+SPD/.35+ACC/.25)`). Break: INSTANT `contest(kind:'cut', atk=WR(0.55*RRx+0.45*AGI), def=DB(0.55*MCV+0.45*AGI), leverage=doubleMove?-12:0)`. `sep` magnitude = `baseSep*sev`. Recovery bound to SPD/ACC delta (geometry, no roll).

### Zone Coverage
- Drop/drift = steering to landmark (no contest). Break-on-throw gated by `reactLag=lerp(0.42,0.10, max(ZCV,AWR))`. Catch-point: INSTANT `contest(kind:'coverage', atk=WR(SEP-composite), def=DB(0.55*ZCV+0.3*INT+0.15*AWR), leverage=sepBias+ballErr, situation=-40*reactLag)`. Pattern-match converts a carried vertical to `job:'man'` (reuses Man path). **Shares the exact kernel with Man — only the C/R composite differs.**

### Route Running
- Release contest = the **same jam call** as Man (one source). Break separation = the **same cut call**; the produced `separation` scalar (clamp 0..6yd) is the single number the Catch system reads. Sight-adjust is a deterministic geometry read (no roll) gated by `RRx`. **Conflict resolved:** Route, Man, and Zone all funnel press+break through the two shared calls (`jam`,`cut`); there is no separate "route RNG."

### QB AI
- Progression clock (AWR-gated `readDwell`), openness score, throw trigger = deterministic decision logic (no kernel). The **throw outcome** is one `contest(kind:'throw')`: placement -> weighted pick {ON_TARGET, INACCURATE, BATTED, INTERCEPTED} where the INT weight feeds the Catch/coverage contest at arrival. Pressure model reads Pass-Block `shed`/rusherTime. Human QB bypasses the clock but **uses the same throw contest** (skill schemes the open man; ratings bind whether the ball arrives true).

### Run Fits & Ball-Carrier Vision
- Defense stamps `fitRole` (force/spill/fill/contain) -> shapes `leadPoint` leverage clamp (no roll; PRC gates commit delay + false-step). Vision read picks BANG/BEND/BOUNCE by laneScore, gated `pVision=0.55+0.45*BCV/99`. **Contact = the Tackle contest** with action chosen by approach angle.

### Tackling, Broken Tackles & Pursuit
- THE canonical INSTANT user of the kernel. `atk=carrier action composite` (TRUCK `0.65*TRK+...`, JUKE `0.65*ELU+...`, default `0.6*BTK+...`), `def=TAK`, `leverage=angleBonus(+8 head-on/-10 from behind)+wrongLeverage(+18)`, `momentum=closingBonus(0..+12) + gang(+9/extra hat, cap +27)`. **Replaces the flat `rng()<0.12` hack** — sprint now feeds `closingBonus`/carrier-momentum. Fumble = secondary `contest(atk=HIT, def=CAR, leverage=-30)` on a stop. `sev` scales hit/knockback/fallFwd.

### Catching
- INSTANT `contest(kind:'catch', atk=receiver composite[CTH/CIT/SPC by separation band], def=DB(0.55*cov+0.3*INT+0.15*AWR)*facing, leverage=placementBias+sepBias)`. The `roll`/`sev` buckets into clean / contested / drop / PBU / tip / INT. **Replaces flat `INT_CHANCE`/`TIP_CHANCE`** with rating-driven `intShare`. RAC handoff = carrier physics + Tackle contest on first defender.

### Ratings system
- **Defines** the schema + composites + the kernel constants (SCALE 16, SEV_GAIN, EXTREME params). Single source of truth; every other system reads `Player.ratings`. Speed mapping `(0.85+0.30*SPD/99)` lives in the movement foundation.

### Playbook & Formations
- **Emits only geometry + point-biases**, never rolls. Box/protect/coverage-fit -> `leverage`/`momentum` pts into the relevant contests (light box `+8*boxAdv` to run; free rusher forces an unblocked shed; coverage-beats-concept `+12` to separation). Scheme manufactures a temporary mismatch; ratings set tail heaviness.

### Cross-system couplings & resolved conflicts
1. **One engagement, one roll:** Pass-Block/Pass-Rush and Run-Block/Block-Shed are the *same* engaged pair resolved once per frame, not dueling systems.
2. **One curve:** all "delta->prob" specs (14/18/70/0.045/0.11) collapse to `SCALE=16`. All "instant tail" specs (whiff/pancake/super-win, slopes 0.012-0.030) collapse to the single `EXTREME_SLOPE=0.013`/`CAP=0.55`/`DEAD=8`.
3. **One lead helper:** every pursuit/coverage/ball-lead computation uses the foundation `leadPoint()` (replaces the 3 ad-hoc `intercept()` variants).
4. **Coverage drift vs roll:** continuous cushion change is deterministic (geometry); only the discrete jam/break/catch are kernel rolls — prevents double-counting variance.
5. **Severity is the universal payload:** every system maps `sev` to its kinematic magnitude (burst, stun, knockback, separation yards), so "how dramatic" is consistent game-wide.
