# Validation & Tuning

> Synthesized design — Gridiron Blitz. Reconciled from all system specs in `systems/`.

## Headless validation — distributions to watch + tuning knobs

### Metrics per phase (all are DISTRIBUTIONS / tail-rates, never bare averages)
- **Kernel:** win-rate vs delta curve (assert anchors at delta 0/16/48); extreme-rate vs delta (must be ~0 in deadzone, climb to ~0.55 cap); `sev` histogram per delta band (tail mass >0.4 stays 5-8% at delta 0).
- **Line:** pass-pro hold-time histogram (median + P10 + P90 + >4s tail); pressure-by-2.5s %; super-win/pancake rates; run engagement-outcome histogram (stalemate/drive/pancake/shed bins).
- **Coverage:** separation-at-break histogram (mode + >2yd tail); open-rate per matchup; jam-win shift; reactLag pump-fake bite %.
- **Carrier/Tackle:** first-contact outcome histogram (clean/broken/stuff/pancake/truck bins); gang-tackle break %; fumble rate + its correlation with HIT-CAR delta; yards-after-contact distribution.
- **QB/Pass:** per-drive box-score distribution (comp%, sack%, INT%, batted%); time-to-throw histogram; chunk-play (20+) rate.
- **Game:** score-margin distribution over 200 seeded games; big-play rate per drive; blowout-vs-mismatch correlation.

### Instrumentation
- Every `contest()` logs `{kind, atk, def, delta, p, win, sev, extreme}` to a CSV-able buffer.
- A `delta-sweep` driver pins one matchup and runs 10k reps across delta ∈ [-60,+60] to produce the curves above.
- A `drive` driver runs full HOME-vs-AWAY series with per-rep reseed for reproducibility.

### Exposed tuning knobs (the "fun" dials)
| Knob | Default | Effect |
|---|---|---|
| `SCALE` | 16 | lower = ratings more decisive (steeper); higher = more upsets |
| `SEV_GAIN` | 1.0 | how hard severity scales with mismatch (drama amplitude) |
| `TAIL` | 0.10 | even-matchup X-factor floor (fireworks between equals) |
| `EXTREME_DEAD` | 8 | how big a gap before instant blow-by/pancake can fire |
| `EXTREME_SLOPE`/`CAP` | 0.013/0.55 | frequency + ceiling of instant extremes |
| `HZ_BASE[block/rush/shed]` | .32/.30/.50 | pocket-hold + run-grind length |
| `HZ_SLOPE` | 0.021 | how fast delta swings shed timing |
| `LEAD_K`/`LEVERAGE_BIAS` | 0.9 / 0.6-1.0yd | pursuit cut-off vs overrun feel |
| directional muls | .55/.75 | backpedal/lateral sluggishness |
| `GANG_STEP` | +9 | how much each extra hat punishes carriers |

Tuning protocol: change ONE knob, re-run the delta-sweep + 200-game series, confirm the targeted distribution moved and no other tail went degenerate.
