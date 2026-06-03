# Movement & Kinematics (top-down 2D football locomotion: accel/decel, top speed, turn radius/agility, momentum, directional speed modifiers, pursuit-angle steering)

> System spec — Gridiron Blitz rebuild. Auto-generated from the parallel research workflow; grounded in the cited sources below.

## Summary
Replace the current direct-velocity "air-hockey" model (velocity set instantly each frame from a single `speed` rating) with a force/steering integrator a la Reynolds: each body has a desired velocity, and a per-tick steering force — capped by an AGILITY-derived max-force — pulls actual velocity toward it, so acceleration, deceleration, momentum, and finite turn radius all emerge from the same loop. Top speed comes from SPEED, the rate of approach from ACCEL, and how sharply a body can redirect from AGILITY; directional multipliers make backpedal/lateral slower than forward so bodies look like football players. AI pursuit seeks the carrier's LEAD point (predicted future position) using a leverage-aware interception angle, not the carrier's current spot, which produces readable cut-off/overrun behavior. All contested redirects (cuts, blow-bys, recovery from bad angles) resolve through a single weighted-roll kernel keyed on the SPEED/ACCEL/AGILITY deltas so variance scales with the ratings mismatch.

## Inputs (read each tick / decision)
- Per-player kinematic state: position (x,y px), velocity (vx,vy px/s), current speed |v|, facing/heading angle
- Per-player ratings (0-99): SPEED (top speed), ACCEL (acceleration), AGILITY (turn/cut responsiveness = steering max-force), STRENGTH (momentum / mass for shove resolution), used by contest kernel
- Player role (QB/RB/WR/TE/OL/DL/LB/DB) for baseline speed band and movement profile
- Desired-velocity vector for this tick: from human input axis (controlled player) or AI target point (route node, block target, pursuit lead point, zone landmark)
- Turbo/sprint flag (input.turbo) raising the speed cap toward the TURBO ceiling
- Movement mode relative to heading: forward / lateral / backpedal (derived from angle between desired direction and current heading) -> directional speed multiplier
- For AI pursuit: carrier position+velocity, this defender's position+velocity+top speed (for time-to-intercept), and assigned leverage side (inside-out vs outside-in / sideline)
- dt (fixed timestep, seconds)
- Engagement/stun flags (blocked, engaged, shed, stun timer) that gate or damp movement

## Contest model
```
// ---- per-tick integration (all players, fixed dt ~1/60) ----
// 1. derive top speed (px/s) from rating, role, turbo
vmax = (BASE_SPEED[role] + (SPEED-70)*SPEED_GAIN) * YARD          // YARD=22 px/yd
if (turbo) vmax *= TURBO_MULT                                     // 1.28 ceiling already in repo

// 2. desired velocity
dir = normalize(targetPoint - pos)        // input axis, or AI steer target
// directional penalty: bodies are slow backward / sideways
ddot = dot(dir, heading)                  // heading = normalize(v) or last facing if stopped
moveMul = ddot >  0.5 ? 1.0                                   // forward
        : ddot < -0.3 ? BACKPEDAL_MUL                        // ~0.55
        :               lerp(LATERAL_MUL, 1.0, (ddot+0.3)/0.8) // shuffle ~0.75 -> fwd
vdesired = dir * vmax * moveMul * inputMag                    // inputMag<1 for analog

// 3. steering force (Reynolds): pull v toward vdesired, capped by AGILITY
steer = vdesired - v
// accel cap (how fast you can GAIN speed) vs turn cap (how fast you can REDIRECT)
aMax   = (ACCEL_BASE + (ACCEL-70)*ACCEL_GAIN)                  // px/s^2, forward thrust
turnMax= (TURN_BASE  + (AGILITY-70)*AGI_GAIN)                 // px/s^2, lateral redirect
// decompose steer into along-heading (accel/brake) and perpendicular (turn) parts
along = project(steer, heading); perp = steer - along
if (|along|/dt along+v braking i.e. opposing v) brakeCap=DECEL_MAX else brakeCap=aMax
along = clamp(along, brakeCap*dt opposing else aMax*dt)
perp  = clampLen(perp, turnMax*dt)                            // <-- finite turn radius
v += along + perp
v  = clampLen(v, vmax*moveMul)                                // never exceed directional cap
heading = |v|>EPS ? normalize(v) : heading
pos += v*dt

// turn radius emerges: R = |v|^2 / (turnMax)  -> faster body = wider arc,
// higher AGILITY = tighter arc. A hard cut is a contest (see kernel).

// ---- AI PURSUIT (defender chasing carrier) ----
// seek the LEAD point, not the carrier's current spot:
tIntercept = |carrier.pos - self.pos| / max(self.vmax, 1)     // crude closing time
lead = carrier.pos + carrier.v * tIntercept * LEAD_K          // LEAD_K~0.9
// leverage: bias lead toward the side we must defend (cut-off, keep inside-out)
lead += leverageNormal * LEVERAGE_BIAS                        // px toward our shoulder
targetPoint = lead                                           // feed into steering above
// a defender with a WORSE angle (lead behind carrier path) physically can't catch up
// unless his vmax edge > carrier's -> overrun / blow-by emerges from geometry, no special case

// ---- CONTEST KERNEL HOOK (shared weighted-roll) ----
// Any hard redirect/burst that should be rating-decided routes through kernel:
//   contest(attackerRating, defenderRating, leverageBias) -> {win, magnitude}
// e.g. a juke = carrier AGILITY vs pursuer AGILITY; outcome scales how much perp
// steer the LOSER eats (overcommit) and how much the WINNER keeps of vmax.
delta = atkRating - defRating                                 // -99..+99
p_win = sigmoid(delta / SCALE + leverage)                    // SCALE~18
roll  = rng()                                                // deterministic xorshift (repo)
win   = roll < p_win
// magnitude (how dramatic) also rating-driven: blow-by vs grind
sev   = clamp( |delta|/99 * SEV_GAIN + tailNoise(), 0, 1 )
// applied to kinematics: winner gains burst (vmax*+), loser gets stun + heading lag
```

## Outcome spectrum
### PANCAKE / FULL OVERRUN (worst for the mover being contested): pursuer takes a terrible angle and is physically out of the play, OR a blocker is driven backward; carrier blows past untouched
- **When:** Large negative rating delta for the loser (e.g. low-AGILITY/SPEED defender vs elite carrier), or the lead point lands well behind the carrier's path so geometry makes recovery impossible
- **Weighting:** |SPEED delta| and |AGILITY delta| both large -> high sev; bad initial pursuit angle adds leverage penalty; turbo on the winner widens it

### BLOW-BY / CLEAN BEAT: contested cut won decisively, loser eats large perpendicular overcommit (heading swings past), winner keeps ~95-100% vmax
- **When:** Winner wins the kernel roll AND sev high; e.g. WR vs DB with +15 AGILITY makes a sharp cut the DB can't mirror within turnMax
- **Weighting:** Positive AGILITY delta -> higher p_win; positive SPEED delta -> winner retains more vmax; sev scales the loser's stun/heading-lag

### STEP WON / SEPARATION: mover gains a half-step, slight angle advantage, no stun
- **When:** Winner wins roll but sev low (even-ish matchup, lucky tail)
- **Weighting:** Small positive delta; moderate leverage; normal-range tail noise

### GRIND / MIRROR (the expected even-matchup result): both bodies redirect at similar turnMax, neither separates, closing stays tight
- **When:** Near-zero rating delta; defender's lead point sits on the carrier's path; turn radii comparable
- **Weighting:** |delta| ~0 keeps p_win~0.5 and sev~0; this is the modal outcome for balanced contests

### STICKY COVERAGE / ANGLE HELD: defender mirrors the cut and maintains leverage, carrier loses speed bleeding into the turn
- **When:** Defender wins roll, low sev; or defender AGILITY edge lets perp cap track the cut
- **Weighting:** Positive defender AGILITY delta; good initial leverage bias; carrier's own turn bleeds vmax via the directional/turn caps

### STUFFED / CUT OFF / WRAP ANGLE PERFECT (best for defense): defender's lead point intersects ahead of carrier, cuts off the lane, forces back inside to help
- **When:** Defender wins roll with high sev, OR pure geometry: defender vmax >= carrier vmax and angle is ahead -> interception point reached first
- **Weighting:** Positive SPEED+AGILITY delta for defender; strong leverage bias; carrier near sideline (shrinks escape space)

## Concrete numbers / heuristics
- YARD = 22 px/yd (existing). Fixed timestep dt = 1/60 s.
- Top speeds (yd/s, existing repo table, keep): WR 9.7, RB 9.6, DB 9.6, LB 8.8, TE 8.6, QB 8.2, DL 7.6, OL 7.4. In px/s multiply by 22 (e.g. WR ~213 px/s).
- SPEED_GAIN: ~0.045 yd/s per rating point => a 99 vs 50 SPEED gap ~ +2.2 yd/s (~+23%), matching elite-24mph vs ~19mph real spread.
- TURBO_MULT = 1.28 (existing constant) — sprint ceiling above cruise.
- ACCEL: real players hit ~95% top speed by ~20 yd / ~2.0-2.5 s. Set ACCEL_BASE so a 70-ACCEL skill player reaches top speed in ~1.8 s (0-to-vmax). aMax ~ vmax/1.8 ≈ 118 px/s^2 for a WR. ACCEL_GAIN ~ ±0.012*vmax per point (99-ACCEL ~1.3 s, 50-ACCEL ~2.6 s).
- DECEL_MAX ~ 2.0-2.5x aMax (braking faster than accelerating; ~250-300 px/s^2) — quick stops, but momentum still carries a step.
- AGILITY turn cap: TURN_BASE for a 70-AGI ~ 14 rad/s-equivalent expressed as perp accel ~ vmax*K; pick turnMax so a cruising WR's turn radius R=|v|^2/turnMax ≈ 2.5-3.5 yd at full speed, ~1 yd at half speed. AGI_GAIN ~ ±2% per point (99-AGI ~half the radius of 40-AGI).
- Directional multipliers: FORWARD 1.0, LATERAL/shuffle 0.72-0.78, BACKPEDAL 0.50-0.60 (grounded in '50% of forward' DB coaching). DB backpedal mode caps at ~0.55*vmax.
- Pursuit LEAD_K ~ 0.9; LEVERAGE_BIAS ~ 0.6-1.0 yd (13-22 px) toward the shoulder the defender must protect.
- Contest kernel: sigmoid SCALE ~ 18 rating points per e-fold => +18 delta ≈ 73% win, +36 ≈ 88%, 0 delta = 50%. SEV_GAIN ~ 1.0 with tailNoise() in ±0.10 so even matchups still throw ~5-8% dramatic tails.
- Break-tackle/juke burst on win: winner vmax temporarily *1.05-1.15 for ~0.3 s; loser stun 0.15-0.4 s scaled by sev (existing `stun` field).
- EPS for heading hold when |v|<~2 px/s (avoid jitter when stopped).

## Ratings used
- SPEED — sets directional top-speed cap vmax (both offense skill players and defenders); the dominant factor in blow-by vs cut-off geometry
- ACCEL — sets along-heading thrust cap aMax (time to reach vmax and to re-accelerate out of a cut); burst off the line and out of breaks
- AGILITY — sets perpendicular steering cap turnMax = turn radius / cut sharpness; the rating that wins/loses contested redirects (juke, mirror, recover from bad angle)
- STRENGTH — feeds momentum/mass for shove and break-tackle resolution where movement couples to contact (handed to the contact/block systems via the shared kernel); minor here as collision damping
- (role) — not a rating but selects the baseline speed band and default movement profile, e.g. DB gets backpedal mode, OL gets lowest vmax

## Variance model
Variance is produced entirely by the shared contest kernel and scales with the ratings MISMATCH, not by adding noise to raw position. Win probability is a sigmoid of the rating delta (SCALE ~18 pts/e-fold): equal ratings => p_win 0.50, +18 => ~0.73, +36 => ~0.88, +54 => ~0.95. Crucially the SEVERITY of a won contest also scales with |delta|: sev = clamp(|delta|/99 * SEV_GAIN + tailNoise, 0, 1). So a big gap produces frequent AND extreme outcomes (blow-bys, overruns, pancakes) because both p_win and sev are high; an even matchup yields the modal grind/mirror because p_win~0.5 and sev~0 — yet tailNoise (±0.10) still lets even matchups throw an occasional dramatic separation or whiff (~5-8% of contests), giving the X-factor tail. Kinematically, severity maps to concrete deltas: winner's temporary vmax burst (1.05-1.15x, 0.3s) and the loser's heading-lag + stun (0.15-0.4s) both scale linearly with sev, so a tiny edge looks like a half-step and a huge edge looks like a defender frozen flat-footed. All rolls use the existing deterministic xorshift rng() so the two pre-rolled POC teams give reproducible headless tails.

## Dependencies
- Contest kernel (shared weighted-roll): movement hands it (attackerRating, defenderRating, leverage) for every contested redirect — juke, mirror-cut, angle recovery — and consumes {win, sev}. This system MUST use the same sigmoid(delta/SCALE) + sev formulation as block-shedding, break-tackle, and rush contests.
- Block/engagement system: reads `blocked/engaged/shed/stun` to gate or damp steering (an engaged blocker can't pursue; a shed defender resumes pursuit). Movement integrator must respect these flags before applying force.
- Break-tackle / tackle system: tackle is a contact resolution but its outcome (carrier keeps moving vs goes down) feeds back as a movement burst/stun; the existing 0.12 turbo break-tackle should be re-expressed through the kernel.
- Input system (input.axis / input.turbo): supplies the human-controlled player's desired-velocity vector and sprint flag.
- AI assignment system (routes, zone landmarks, man assignId, gap/job): supplies the AI target point that becomes the steer goal; pursuit lead+leverage is computed here but assignment picks WHICH carrier/landmark to chase.
- Pass/ball system: catch and throw use carrier velocity and lead prediction already (`r.x + r.vx*ft`); the lead-point math here should be the single shared helper.
- Player type (types.ts): needs new fields accel, agility, strength (and heading) added alongside existing speed; one source of truth for ratings.
- constants.ts: new tunables (SPEED_GAIN, ACCEL_BASE/GAIN, TURN_BASE/AGI_GAIN, DECEL_MAX, BACKPEDAL_MUL, LATERAL_MUL, LEAD_K, LEVERAGE_BIAS, kernel SCALE/SEV_GAIN) live here.

## Sources
- https://madden.fandom.com/wiki/Attributes
- https://old.muthead.com/forums/madden-nfl-mobile/madden-nfl-mobile-discussion/1174473-understanding-how-speed-acceleration-and-agility
- https://forums.operationsports.com/forums/forum/football/madden-nfl-football/madden-nfl-old-gen/361126-locomotion-speed-agility-acceleration-question
- https://www.red3d.com/cwr/steer/gdc99/ (Reynolds, Steering Behaviors for Autonomous Characters)
- https://gamedevelopment.tutsplus.com/tutorials/understanding-steering-behaviors-pursuit-and-evade--gamedev-2946
- https://en.wikipedia.org/wiki/40-yard_dash
- https://www.americanfootballmonthly.com/Subaccess/articles.php?article_id=6283 (pursuit angles, leverage, lead the carrier)
- https://insider.afca.com/xs-os-teaching-pursuit/
- https://www.naseinc.com/blog/comparison-of-backpedal-and-cross-over-technique-to-acceleration-and-change-of-direction-speed-blog-entry-by-naseinc/
- https://www.stack.com/a/run-backward-faster/ (backpedal ~50% of forward speed)
