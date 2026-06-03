# Realism Targets — Outcome Distributions by Position & Tier

> Synthesized design — Gridiron Blitz. The sim's **outcome distributions** (not
> just averages) should map to real NFL performance, and **player tier should
> widen/shift the tails**, not just nudge the mean. Sourced from PFF, NFL Next Gen
> Stats, ESPN win-rate metrics, Football Outsiders, nflfastR-era public data.
> Every band is cited inline. Tier columns: **bad / mid / good / elite**.

## The governing principle

Across **every** position the research says the same thing: **the average barely
separates players; the tails do.**

- An elite QB completes only ~6–8 more passes per 100 dropbacks than a replacement
  QB — but roughly **halves** his sack rate and INT rate. [PFF/NGS 2023]
- An elite RB's *median* run is still ~4 yds — but he **shrinks the stuffed tail
  ~4–6 pts and fattens the 10+ explosive tail to 15–16%** (league avg <12%), and
  generates ~2–3 extra yards **after contact**. [FanDuel 2024, FantasyPros 2023, PFF]
- An elite CB allows ~40% completion vs a bad CB's ~75% — a 2× gap — and forces
  incompletions on ~3 in 10 targets vs single digits. [PFF 2019/2022/2023]
- A kicker's tier barely moves a 30-yarder (±3–5 pts) but swings a 50+ kick from
  ~50% to ~87%. [NFL.com 2024, FOX 2024]

**Design rule:** tier is a *single quality scalar per player* that (a) shifts the
mean a little and (b) **widens the variance / moves probability mass between the
disaster bucket and the explosive bucket** a lot. The contest kernel already does
this (logistic mean + `firstContact` extreme channel + fat severity tail); these
targets calibrate the rating deltas and per-outcome splits.

---

## 1. Rushing (RB + run blocking)

**Per-carry outcome distribution** — sample from a right-skewed bucket model, NOT a
Gaussian around YPC. League baseline and how tier shifts each bucket:

| Bucket | Yards | League prob | bad | mid | good | elite | Source |
|---|---|---|---|---|---|---|---|
| Stuffed / loss | ≤ 0 | **~19–21%** | ~26% | ~20% | ~16% | ~13% | FO stuff 19%; Football Perspective 2019 (12% loss + 9% zero) |
| Short | 1–3 | ~30–35% | ~38% | ~33% | ~30% | ~28% | derived vs anchors |
| Success | 4–9 | ~30–35% | ~28% | ~33% | ~36% | ~38% | median run ≈4 |
| Explosive | 10–19 | ~9–10% | ~6% | ~10% | ~13% | ~15% | FanDuel 2024 (elite 13–16%) |
| Breakaway | 20+ | ~1.5–2.5% | ~1% | ~2% | ~3% | ~4% | FanDuel 2024 (15+: elite 7–10%) |

**The two separable inputs (mirror Football Outsiders' Adjusted Line Yards):**
- **Line/scheme** owns the pre-contact yardage and the **stuff probability** (ALY
  credits the OL 100–120% on the ≤4-yard region and the loss tail). [FO ALY]
- **Back rating** owns **after-contact yards** and **breakaway conversion** (ALY
  credits the OL **0%** past 10 yds — the explosive tail is all back). [FO ALY]

**Back tier dials (calibrate to these endpoints):**
- **Yards-after-contact / att:** bad ≈ 2.2 → mid ≈ 3.3 → elite ≈ 5.0+. [FantasyPros 2023]
- **Forced missed tackle / carry:** bad ≈ 0.12 → mid ≈ 0.18 → elite ≈ 0.30–0.35
  (an elite back breaks a tackle ~1 in 3 carries). [PFF 2023]
- **Explosive (10+) rate:** mid <12% → good 13–14% → elite 15–16%. [FanDuel 2024]

**Honesty check:** remove the top ~30% of carries and league YPC collapses to ~1.5.
The mean is bought by the tail — the sim must produce that shape. [Football Perspective 2019]

> **Maps to:** `checkTackleAndScore` tackle contest (FMT/YACO = break-tackle wins),
> `runBlock`/`driveBlock` (line owns stuff rate + pre-contact). Break-tackle = the
> mechanic that converts a would-be stuff into a success/explosive run.

---

## 2. Passing (QB)

**Per-dropback outcome distribution** — resolve in this order: sack → throwaway/
scramble → INT → completion-by-depth.

| Outcome | bad | mid | good | elite | Source |
|---|---|---|---|---|---|
| Completion | ~56% | ~59% | ~62% | ~64% | league 64.5% of att, 2023 |
| Incompletion | ~30% | ~28% | ~26% | ~24% | derived |
| **Sack** | ~9–11% | **7%** | ~5–6% | ~3–4% | league 7.08%/dropback, 2023 |
| **INT** | ~3% | **2.3%** | ~1.7% | ~1.2% | league 2.3%/att, 2023 |
| Scramble | ~3% | ~3% | ~4% | ~5% | mobile QBs higher |
| Throwaway | ~2% | ~2.5% | ~3% | ~3.5% | good QBs bail vs force |

**Completion % by target depth** (the whole curve shifts ±5–8 pts by tier, deep
swings widest):

| Depth | bad | mid | good | elite | Source |
|---|---|---|---|---|---|
| Behind LOS | ~82% | ~86% | ~88% | ~90% | near-automatic |
| Short 0–9 | ~68% | ~73% | ~77% | ~80% | around 64.5% overall |
| Intermediate 10–19 | ~44% | ~52% | ~58% | ~62% | Mile High 2023; NGS 15+ 45.1% |
| Deep 20+ | ~32% | ~37% | ~48% | 54–60% | NGS 2022 (Tua 54%), PFF 2023 (Purdy 60.5%) |

**Pressure is the master switch:** pressure ~doubles INT rate (1.8%→3.1%) and is
where nearly all sacks originate; pressure→sack ≈ 18.7%. [PFF 2016, FTN 2024]
Elite QBs separate mainly by **avoiding the disaster tail** (sack+INT ~5%/dropback
vs ~14% for replacement), not by completing far more. [PFF/NGS 2023]

> **Maps to:** `aiQuarterback`/throw timing (release vs time-to-pressure),
> `resolveCatch`/`resolveDefenderBall` (depth-conditional completion + INT split),
> the block kernel (pressure → sack tail).

---

## 3. Receiving (WR / TE)

**Two-stage resolution** mirrors the real causal chain (get open, then catch):

**Stage A — separation roll → bucket.** Open-rate by tier (deep/outside shifts
toward contested; slot/short forces ~90%+ open):

| | bad | mid | good | elite | Source |
|---|---|---|---|---|---|
| Open-target rate | ~70% | ~80% | ~88% | 94–98% | PFF 2023 (Raymond 97.7%) |
| → contested share | ~30% | ~20% | ~12% | ~3–6% | PFF 2025 (Pickens 30% contested) |

**Stage B — catch by bucket:**

| Bucket | base catch | bad | elite | Source |
|---|---|---|---|---|
| Open + uncontested | ~94–97% | −10 pts (drops) | −0 pts | drop 0–3% elite / 8–17% bad [PFF] |
| **Contested** | **~48%** | ~30–40% | 60–66% WR / 75%+ TE | PFF 2025 contested 47.7% |
| Deep 20+ | gate on catchable **54%** then bucket | — | — | Fantasy Points 2023 |

**Drops are an independent, near-random tail** (low year-to-year correlation) —
keep a flat per-tier probability, no streaks. [PFF]
**YAC = right-skewed post-catch distribution**, mean ≈ 4.1 WR / 4.5 TE, league
all-catch 5.7; give "YAC merchants" a heavier *tail* (broken-tackle proc), not a
higher flat mean (crossers up to 11.5 YAC/rec). [NGS 2023, TeamRankings, PFF 2023]

> Three sliders capture a receiver: **Separation (open-rate), Hands (1−drop /
> contested-win), YAC (tail weight)** — matches ESPN's ≈50/25/25 Open/Catch/YAC
> weighting. [ESPN 2022]

---

## 4. Trenches (OL vs DL/EDGE)

Model each rep as **one binary "win within 2.5s" roll** (ESPN PBWR/PRWR), then
layer pressure/sack as conditional tails.

**Pass rush win rate (rusher wins the rep):**

| | bad | mid | good | elite | Source |
|---|---|---|---|---|---|
| Edge PRWR | ~15% | ~22% | ~25% | ~34% | ESPN 2024 (Herbig 34%) |
| Interior PRWR | ~9% | ~12% | ~15% | ~20% | ESPN 2024 (Simmons 20%) |
| Individual pressure rate | ~7% | 10.3% | ~15% | ~20% | NGS 2022–23 (elite ≈2× avg) |

**Pass block win rate** (inverse; tackles avg ~79%, interior higher). League
pressure rate 28.5%/dropback, sack ~5–7%; pressure→sack ≈ 18.7%. [ESPN 2018, FTN 2024]

**Pocket clock:** avg release 2.78s; avg first pressure 2.9s; elite rusher pulls
time-to-pressure to ~2.0–2.1s (inside the release window → that's what turns a
coverage sack into instant pressure). [PFF/NGS 2023]

**Mismatch is multiplicative — calibrate the rating-delta term to these cells:**
- elite rusher vs elite tackle ≈ **25–30%** win
- elite rusher vs bad tackle ≈ **45–55%** win (instant/blow-by, pressure < 2.0s)
- bad rusher vs elite tackle ≈ **3–8%** win (pocket holds past 2.9s)

**Run blocking** is lower/noisier: RBWR ~74–86%, defensive run-stop win ~25–46%,
stuff rate mid-high teens %. **Pancake** has no real stat — keep it a **rare crit**
on an already-won run-block rep (single-digit % of wins). [ESPN 2024, FO]

> **Maps to:** `resolveBlock`/`blockMatchup`/`engageBlock` (already kernel-driven;
> these are the calibration cells), `passProtect` time-to-pressure.

---

## 5. Coverage & tackling (LB / DB)

**Coverage contest per target** (defender-win probability):

| | bad CB | mid CB | good CB | elite CB | Source |
|---|---|---|---|---|---|
| Completion allowed | ~72–78% | ~60% | ~50% | ~35–40% | PFF 2019/2023 (Dean 34.8%) |
| Forced-incompletion rate | ~6–10% | ~12–14% | ~18–21% | ~27–30% | PFF (Gardner 27%) |
| INT / target | ~1% | ~2–3% | ~4% | ~5–8% | PFF 2023 (Jackson 7.7%) |
| PBU / target | ~3% | ~7% | ~10% | ~10%+ | PFF/KOKA |

On a defender win, split the type: forced-incompletion vs PBU vs INT (INT share
scales with ball-skill rating). **Man** = lower base completion but fatter both
tails (more PBU/INT *and* more blown explosives); **zone** = higher completion,
tighter. [PFF data study]

**Tackle contest per opportunity** (independent of coverage; DBs tackle worst):

| Tier | LB P(miss) | S P(miss) | CB P(miss) | Source |
|---|---|---|---|---|
| Sure | ~7–8% | ~6% | ~7–9% | PFF 2024 |
| Average | ~10–12% | ~10–12% | ~12–15% | NGS/PFF 2024 (~11–13% team) |
| Poor | ~15%+ | ~14–15% | ~18–22% | PFF 2024 |
| Disaster tail | — | — | ~23% | PFF 3-yr (Samuel 1/4.3) |

A missed tackle → **YAC-explosion roll** scaled by how open the field is
(open-field DB whiff = marquee disaster). [PFF/NGS 2024]

> **Maps to:** `coverMan`/zone + `resolveCatch` leverage (coverage contest),
> `checkTackleAndScore` (tackle contest — already implemented; CB/S get a
> position miss-penalty).

---

## 6. Special teams (K / P)

**FG make % by distance — flat-then-cliff curve, tier as a distance-dependent
offset (barely moves short, strongly moves long):**

| Distance | league mid | bad | elite | Source |
|---|---|---|---|---|
| <20 (PAT ≈33yd → ~96%) | 0.96 | 0.85 | 1.00 | StatMuse 2024 (XP 95.8%) |
| 20–29 | 0.97 | ~0.93 | ~0.99 | NFL.com 2024 (97.0%) |
| 30–39 | 0.94 | ~0.90 | ~0.97 | NFL.com 2024 (94.3%) |
| 40–49 | 0.77 | ~0.70 | ~0.95 | NFL.com 2024 (76.7%) — note the knee |
| 50–59 | 0.72 | ~0.50 | ~0.87 | NFL.com 2024 (72.3%) |
| 60+ | ~0.30 | ~0.15 | ~0.55 | NFL.com 2024 (26.7%, tiny n) |

Implementation: one kicker scalar `k` shifting effective distance — a better
kicker plays each kick as if it were several yards shorter (`p = logistic(a − b·(dist − c·k))`).
Force a **steeper knee at ~40 yds** than a naive sigmoid.

**Other ST (Bernoulli / Normal draws):**
- **PAT** ≈ 0.958 league; tier 0.85 (bad) → 1.00 (elite). [StatMuse 2024]
- **2-pt** ≈ 0.48 baseline (rush ~0.50 > pass ~0.37), high variance. [FOX 2024, boydsbets]
- **Punt net** ~Normal(mean ≈ 41 bad → 46 elite, SD ≈ 8–10); inside-20 0.32→0.51;
  gross ≈ net + 4.5. [FOX 2024]
- **Kickoff** (2024 rules): ~0.64 touchback else return start ≈ 28-yd line. [ESPN 2024]

---

## Acceptance bands (for the tiered validation harness)

The harness measures the sim's outcome **buckets** per tier (n≥200/cell) and
checks them against the targets above (±tolerance). A position "passes" when:

- **Rush:** league rosters → stuff 16–24%, explosive(10+) 8–14%, breakaway(20+)
  1–4%; elite-vs-bad back at the SAME line → stuff gap ≥4 pts AND explosive gap ≥4 pts.
- **Pass:** favorable matchup completion 60–80%; sack 5–11% (scales with OL/rush
  mismatch); INT 1–3%; deep(20+) completion 35–55%.
- **Catch:** open catch ≥92%; contested 40–55% (elite ≥58%, bad ≤40%); drop by tier.
- **Trenches:** elite-vs-elite rep-win 25–30%, elite-vs-bad 45–55%, bad-vs-elite 3–8%.
- **Coverage:** completion allowed 35–78% across CB tiers; INT/target 1–8% by tier.
- **Tackling:** miss rate 6–23% across position×tier.
- **Kicking:** FG by band within ±5 pts of the league curve; tier offset widens with distance.

> Status: **targets documented.** Validation harness + per-tier tuning tracked in
> `validation.md`. The kernel (`contest.ts`) and tackle/catch/block contests are the
> dials; this doc is the source-of-truth those dials are tuned against.

---

## Sources (per section, abbreviated — full URLs in research notes)

- **Rush:** Football Perspective 2019; Football Outsiders ALY/glossary; FanDuel
  Research 2024; FantasyPros 2023; PFF Elusive/FMT; NFL NGS expected rush yards.
- **Pass:** StatMuse 2023 league totals; ProFootballNetwork/365Scores 2023 (sack
  7.08%); ESPN 2022–23 (aDOT); NFL NGS 2022 (deep); PFF 2023 (deep, pressure-to-sack);
  PFF 2016 (clean vs pressure); FTN 2024 (pressure→sack 18.7%); WaPo 2023.
- **Receiving:** Fantasy Points 2023 (catchable by depth); PFF 2025 (contested 47.7%);
  PFF 2023 (open-target, routes); PFF 2012/2015/2017 (drops); NGS 2023 (YAC 5.7);
  ESPN 2022 (Open/Catch/YAC weighting); TeamRankings (WR/TE YAC).
- **Trenches:** ESPN 2018/2024 (PBWR/PRWR/RBWR/RSWR); NFL NGS (pressure prob 10.3%,
  2.9s); FTN 2024 (pressure rate trend, pressure→sack); PFF 2023 (time to throw 2.78s).
- **Coverage/Tackling:** PFF 2019/2022/2023 (CB completion/FINC/passer rating/INT);
  PFF 2024 (missed tackles); NFL.com/NGS 2024 (team tackling); PFF man/zone study.
- **Special teams:** NFL.com 2024/2023 FG tables (computed); FOX/CBS 2024; StatMuse
  2024 (XP/leaders); FOX 2024 (2-pt 41%, punting); ESPN 2024 (kickoff).
</content>
</invoke>
