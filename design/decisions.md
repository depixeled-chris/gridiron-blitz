# Locked Build Decisions (owner)

These override defaults in the other design docs. Recorded 2026-06-03.

## Round 1 — design pillars
- **Players:** 11/team; human controls ONE at a time, other 10 are AI. A gel of AI + one human per team.
- **Skill vs ratings:** **BALANCED.** A skilled human can out-maneuver/scheme, but the speed & strength of physical contests (shed, break-tackle, rush win) are bound largely to **ratings**.
- **Variance:** scales with the ratings **mismatch** — big gap → extreme outcomes often; even matchup → mostly a grind with occasional RNG/X-factor tails, "often enough to be exciting." Averages are not the target; the spread of dramatic, readable outcomes is.
- **POC teams:** two pre-baked/baked rosters with fixed ratings for deterministic, reproducible headless tests.

## Round 2 — build parameters
- **Human edge → TIMING ADDS LEVERAGE.** A well-timed input (juke/sprint/jam/press flick) adds *leverage points* to that contest roll. Skilled stick work shifts matchups on top of ratings; it does not bypass ratings.
- **X-Factors / superstar abilities → DEFER PAST POC.** Get the core ratings+contest feel right first with the two baked teams; abilities come later as point-bias modifiers. Phase 0 rosters carry no ability flags.
- **Turnovers → BETWEEN sim and arcade.** Modestly elevated over real (more big-hit fumbles / bad-throw picks) but not chaotic. Target ~ midway between the realistic 1–3% and a doubled arcade rate.
- **Field width → WIDEN toward realistic (~40yd+).** Drop the 24yd Tecmo compression so real separation/leverage numbers map directly and passing windows feel authentic. Camera gains vertical follow / slight zoom-out. Separation is then read in real yards, not a compression factor.

## Round 3 — presentation vs model
- **Presentation = Tecmo Bowl.** Chunky 2D sprites, readable, snappy, arcade *look and pacing*.
- **Under the hood = Madden.** Ratings-driven contest simulation, real assignments/schemes, emergent outcomes — NOT scripted arcade logic. The contest kernel + ratings ARE this.
- **Lean SIM, not arcade, for now.** Err toward sim defaults (conservative extreme/X-factor rates, ratings deciding collisions, moderate turnovers). It's easier to loosen a tuned sim toward arcade than to tighten chaos. So global knobs default conservative; arcade-ifying is a later tuning pass, not a rewrite.

## Implications for the build
- `contest()` accepts a `leverage` point-bias; the human-controlled attacker injects timing-based leverage points (Phase 1+).
- POC rosters: no X-factor fields (Phase 0).
- Validation turnover target band updated to the "between" range (Phase 3/4 acceptance).
- Foundation: `FIELD_W_YARDS` widens (~40); `WORLD_H`, camera, and render scaling adjust; separation/catch tuning uses real-yard windows.
