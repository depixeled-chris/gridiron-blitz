# Ratings system

> System spec — Gridiron Blitz rebuild. Auto-generated from the parallel research workflow; grounded in the cited sources below.

## Summary
A per-player attribute model on a 0-99 scale, mapped to on-field contests through a single delta-driven logistic kernel. Each physical contest (block win, tackle/break-tackle, catch/coverage, pass-rush) compares one contextual OFFENSE rating against one DEFENSE rating; the delta drives both the MEAN win probability (Elo-style logistic, scale tuned so ~12 pts = 60/40 and ~40 pts ~= 90/10) and the SIZE of the random tail (variance is widest near even, but big deltas produce frequent extreme readable events: blow-bys and pancakes). X-factor/clutch modifiers are discrete additive deltas or guaranteed-win flags layered on top. Two POC teams are baked from fixed archetype rating blocks so tests are deterministic via the existing seeded xorshift RNG.

## Inputs (read each tick / decision)
- Contest type (block_pass, block_run, rush, tackle, break_tackle, catch, coverage, jam/press, ball-in-air pick) — selects which rating pair to read
- Offense player's relevant rating(s) for the contest (0-99), e.g. RBK/PBK for an OL, CAR+TRK+ELU for a ball carrier, CTH+RTE for a WR
- Defense player's relevant rating(s) for the contest (0-99), e.g. BSH/PWR for a DL, TAK/HIT for a tackler, MCV/ZCV/PRS for a DB
- Engagement state already in Player (engaged seconds, blocked, shed, stun) — feeds time-based per-frame shed rolls
- Double-team / outnumbered flag (dbl) — multiplies blocker effective rating
- Situational/clutch context: down, distance, score margin, time (leverage) for clutch-trait scaling
- X-factor/superstar ability flags active on each player (in-zone or passive) and their typed effects
- Leverage/geometry already in sim (defender wide vs interior, pursuit angle) folded in as a small situational rating modifier
- Seeded RNG value rng() in [0,1) for the weighted roll (deterministic for POC tests)

## Contest model
```
// ---- ONE SHARED CONTEST KERNEL (all physical matchups call this) ----
// 1. Build effective ratings (0-99) for the specific contest:
effOff = baseOffRating + situational(off) + abilityFlat(off)        // e.g. PBK + pull/leverage + ability
effDef = baseDefRating + situational(def) + abilityFlat(def)        // e.g. BSH + edge bonus + ability
if (doubleTeam) effOff += 12        // double team adds ~12 effective pts to blocker
delta = effDef - effOff             // >0 favors DEFENSE winning the contest

// 2. MEAN win probability via Elo-style logistic, SCALE = 70 (arcade-steep, not 400):
//    delta 0 -> .50,  12 -> .60,  24 -> .69,  40 -> .82,  60 -> .91,  80 -> .96
pBase = 1 / (1 + 10^(-delta/70))    // probability DEFENSE wins this contest

// 3. INSTANT / "X-FACTOR TAIL" branch (the blow-by & pancake events):
//    A clear mismatch can resolve the contest in ONE event at first contact.
mm = abs(delta)
pExtreme = clamp((mm - 8) * 0.012, 0, 0.55)   // 0% near even, ~55% cap at 48-pt gap
if (firstContact && rng() < pExtreme) {
    winner = (delta > 0) ? DEF : OFF           // bigger rating wins outright
    return winner==DEF ? BLOW_BY/SHED : PANCAKE/STONEWALL   // readable extreme
}
// X-factor "guaranteed first win" abilities (Phenom/Unstoppable) set winner=holder here, skip roll.

// 4. CONTINUOUS contests (block sustain, coverage) resolve per-frame over time:
perSecShed = baseRate(contest) + delta * 0.02        // pass .32, run .50 base
if (doubleTeam) perSecShed *= 0.2
perSecShed = clamp(perSecShed, 0.04, 2.0)
if (rng() < perSecShed * dt) winner = DEF           // defender sheds / wins this frame

// 5. INSTANT contests (tackle vs break-tackle, catch vs coverage, pick) resolve in one roll:
pWin = pBase + clutchBonus                            // clutchBonus from leverage*trait
roll = rng()
if (roll < pWin) winner = DEF else winner = OFF
//   For graded outcomes (catch), bucket the roll: clean / contested-and-RAC / drop / INT
//   by comparing roll against stacked thresholds derived from pWin and CTH-vs-MCV delta.

// SPEED/STRENGTH binding: top movement speed = role base * (0.85 + 0.30*(SPD/99)),
// so a 99 SPD WR is ~+15% faster than a 70 SPD one — physical contests are rating-bound,
// human skill only changes WHEN/geometry of the contest, not who wins the collision.
```

## Outcome spectrum
### PANCAKE / STONEWALL (offense dominates contest outright)
- **When:** First contact, OL/blocker rating far exceeds rusher (delta strongly negative), or OL X-factor active; rusher driven back, lane/pocket sealed for the whole play
- **Weighting:** More likely as (effOff - effDef) grows past 8; pExtreme caps ~55% at a 48+ pt gap. Offensive X-factor (Unstoppable-style, guaranteed first win) forces it. Double-team adds +12 effOff.

### BLOCK SUSTAINED / runner contained, no win either way
- **When:** Even or offense-favored matchup that doesn't trigger an extreme; per-frame shed rolls fail; pocket holds ~2.5-2.9s
- **Weighting:** Dominant band when |delta| < 10. Pass base shed .32/s vs run .50/s. Double-team x0.2 keeps it sustained.

### GRIND WIN — defender sheds late / tackle made after a gain
- **When:** Slight defense edge; per-frame shed succeeds after ~1.5-2.5s, or instant tackle roll lands just inside pBase
- **Weighting:** delta +5..+15 pushes perSec up and pBase to .55-.65; this is the 'mostly a grind' even-team texture.

### CLEAN WIN — defender sheds fast / clean tackle / clean catch / pass defended
- **When:** Clear defense edge but not extreme; early shed or tackle roll well inside pBase
- **Weighting:** delta +15..+35 -> pBase .69-.80; clutch leverage adds up to +.08 to the defender in 3rd-and-long / late-game.

### BLOW-BY / PANCAKE-IN-REVERSE / BROKEN TACKLE (defense or ball-carrier dominates outright)
- **When:** First contact, rusher/ball-carrier rating far exceeds blocker/tackler (delta strongly positive for that side); edge rusher blows past tackle, or elite RB trucks/jukes the tackler instantly
- **Weighting:** pExtreme rises with mm; edge DL get +8 situational, interior -8. Defender X-factor (Phenom/Unstoppable) guarantees it. Ball-carrier TRK/ELU vs TAK delta drives break-tackle extreme.

### X-FACTOR / RNG TAIL on an EVEN matchup (the occasional fireworks)
- **When:** |delta|<10 but an active ability or the small pExtreme floor (mm>=8) or a graded catch tip triggers a contested-catch INT, one-handed RAC, or surprise pancake
- **Weighting:** Kept rare on even matchups (pExtreme ~0 below 8-pt gap) EXCEPT when an X-factor is in-zone; that's the intended 'even teams still throw exciting tails' lever.

## Concrete numbers / heuristics
- Scale factor in logistic = 70 (arcade-steep): delta 0->.50, 12->.60, 24->.69, 40->.82, 60->.91, 80->.96 (vs Elo's 400 where 200->.76). Grounded by tuning real PBWR ~55-75% / PRWR ~40-55% into a 50-ish even band
- Extreme/instant-resolve chance pExtreme = clamp((|delta|-8)*0.012, 0, 0.55): 0% below an 8-pt gap, ~24% at 28, capped 55% at 48+
- Per-frame shed base: pass 0.32/s, run 0.50/s; +0.02 per delta point; double-team x0.2; clamp [0.04, 2.0]/s. Even pocket holds ~2.5-2.9s (matches Madden ~2.5s PBWR window)
- Speed mapping: topSpeed = roleBase * (0.85 + 0.30*(SPD/99)); 99 vs 70 SPD ~= +13% real closing speed
- Catch grade thresholds off CTH-vs-MCV delta: clean if rng<.55+d/200, contested-RAC next band, drop/INT tail; reuse existing INT_CHANCE 0.30 / TIP_CHANCE 0.50 for the in-air pick branch
- Clutch trait bonus: up to +0.08 win prob, scaled by leverage = f(down,distance,score,clock); only players flagged clutch get it
- X-factor flat modifiers: passive superstar = +6 effective rating in its domain; in-zone X-factor = +12 or guaranteed-first-win flag
- Rating scale 0-99 with archetype bands: elite 88-99, starter 75-87, average 65-74, weak 50-64, scrub 40-49
- Edge vs interior situational: edge DL +8 effDef on rush, interior -8 (mirrors existing shedRating 84 edge / 76 interior)
- Determinism: single seeded xorshift rng() (utils.ts seed 0x9e3779b9) is the only entropy source; reseed per POC test for reproducibility

## Ratings used
- QB: THP (throw power -> max pass distance/velocity), THA-S/M/D (short/mid/deep accuracy -> landing scatter), TUP (throw-under-pressure), RUN (scramble), AWR (read/decision quality for AI)
- RB: SPD, ACC, AGI, CAR (carry security -> fumble resist), TRK (trucking, vs TAK), ELU (elusiveness/juke, vs pursuit), BCV (vision for AI lane choice), BTK derived from TRK+ELU
- WR/TE: SPD, ACC, AGI, CTH (catch -> catch grade), CIT (catch-in-traffic/contested), RTE (route running -> separation geometry), RAC (yards-after-catch break-tackle), REL (release vs press)
- OL: PBK (pass block sustain), RBK (run block win), STR (anchor/drive, feeds power contests), AWR (pickup logic for AI). Per-OL spot bands reuse existing LG/RG 80, CEN 79, LT/RT 74
- DL: SPD/ACC (edge closing), PWR/PMV (power move), FMV (finesse move), BSH (block shedding -> shed rate), STR, PUR (pursuit angle)
- LB: SPD, TAK, HIT (hit power -> forced-fumble/extreme tail), BSH, PRC (play recognition for AI), ZCV/MCV (coverage)
- CB/DB: SPD, ACC, MCV (man coverage -> separation closing), ZCV (zone), PRS (press/jam, vs REL), CTH/INT (ball skills -> pick branch), TAK
- Universal: SPD, STR, AGI, ACC, AWR present on every player; SPD+STR are the rating-bound physical contest anchors per the owner's balance constraint

## Variance model
Variance is a deliberate function of the rating MISMATCH, not constant. Two levers: (1) the logistic mean bends toward the favorite as |delta| grows; (2) the pExtreme instant-resolve channel converts large deltas into FREQUENT one-shot extreme events (blow-bys, pancakes, trucks) — pExtreme is 0 below an 8-pt gap and climbs ~1.2%/pt to a 55% cap, so a 40-pt mismatch resolves to a readable extreme ~38% of snaps while an even matchup almost never does. Near-even matchups therefore have the WIDEST spread of ordinary outcomes (the roll sits near 0.5, both sides plausible) producing a grind with occasional swing plays, while big gaps have a NARROW outcome set that is mostly the extreme in the favorite's direction. The 'even teams still get fireworks' tail is supplied separately by X-factor/clutch flags and a tiny graded-catch tip branch, NOT by inflating base variance, keeping averages fair while the spread stays dramatic. All variance flows through the single seeded rng() so the spread is reproducible per seed.

## Dependencies
- Contest kernel (synthesis): this system DEFINES the rating->delta->weighted-roll math the shared kernel implements; every other system (blocking, tackling, catch/coverage, pass rush) calls it
- Player model src/game/types.ts: needs a ratings block added per Player (currently only role-based `speed`); engaged/shed/stun/blocked fields already present and consumed by the kernel
- Existing contest() in Game.ts (lines 738-766) and shedRating/blockRating (77-91): current hand-tuned constants are the seed values to replace with the generalized kernel
- constants.ts SPEED/TURBO/SHED_TIME/INT_CHANCE/TIP_CHANCE: speed mapping and graded-catch tail reuse these; SPEED becomes roleBase fed through the SPD multiplier
- utils.ts seeded rng(): sole entropy source — POC determinism depends on it
- Team-baking/roster system: two POC teams are fixed archetype rating blocks (one balanced-average, one boom-bust with elite edge rush + elite RB vs weaker OL) so headless tests are reproducible
- Movement/steering (steer/moveToward in Game.ts): consumes the SPD-derived top speed so physical separation is rating-bound

## Sources
- https://madden.fandom.com/wiki/Attributes
- https://game8.co/games/Madden-NFL-25/archives/463828
- https://www.thegamer.com/madden-25-x-factor-guide/
- https://clutchpoints.com/gaming/all-madden-26-x-factors
- https://www.madden-school.com/madden-17-ball-carrier-special-moves-details/
- https://www.maddenuniversity.com/strategies/offense/rushing/madden-nfl-25-tackle-physics-contact-balance-and-ball-carrier-recovery.html
- https://www.espn.com/nfl/story/_/id/24892208/creating-better-nfl-pass-blocking-pass-rushing-stats-analytics-explainer-faq-how-work
- https://www.espn.com/nfl/story/_/id/46138675/2025-nfl-win-rates-top-teams-players-rankings-pass-run-block
- https://nicidob.github.io/nba_elo/
- https://wismuth.com/elo/calculator.html
