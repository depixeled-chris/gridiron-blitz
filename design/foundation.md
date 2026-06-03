# Foundation — Kinematics & Ratings

> Synthesized design — Gridiron Blitz. Reconciled from all system specs in `systems/`.

## Foundation: kinematics, ratings schema, tick order

### 1. Movement — force/steering integrator (replaces the air-hockey `moveToward`/`pps`)
Each body holds `{x,y,vx,vy,heading}`. Per fixed tick `dt = 1/60`:

```
YARD = 22 px/yd (existing). All speeds below in px/s unless noted.

// top speed from SPEED rating + role band + turbo
vmax = (BASE_SPEED[role]*YARD) * (0.85 + 0.30*(SPEED/99))     // 99-SPD ~+15% over 70-SPD
if (turbo) vmax *= TURBO (1.28)

// desired velocity with directional penalty (football bodies are slow backward/lateral)
dir = normalize(target - pos);  ddot = dot(dir, heading)
moveMul = ddot> 0.5 ? 1.0 : ddot< -0.3 ? BACKPEDAL_MUL(0.55) : lerp(LATERAL_MUL(0.75),1.0,(ddot+0.3)/0.8)
vdesired = dir * vmax * moveMul * inputMag

// steering force, split into thrust (along heading) vs turn (perpendicular)
steer = vdesired - v
aMax    = ACCEL_BASE + (ACCEL-70)*ACCEL_GAIN        // forward thrust cap, px/s^2
turnMax = TURN_BASE  + (AGILITY-70)*AGI_GAIN        // perpendicular redirect cap -> finite turn radius
along = project(steer,heading); perp = steer-along
brakeCap = opposesV(along) ? DECEL_MAX : aMax
along = clampLen(along, brakeCap*dt)
perp  = clampLen(perp,   turnMax*dt)
v += along + perp;  v = clampLen(v, vmax*moveMul)
heading = |v|>EPS ? normalize(v) : heading;  pos += v*dt
// turn radius emerges: R = |v|^2 / turnMax  (faster = wider, higher AGI = tighter)
```

**Constants** (px/s, px/s^2):
```
BASE_SPEED yd/s (keep existing): WR 9.7, RB 9.6, DB 9.6, LB 8.8, TE 8.6, QB 8.2, DL 7.6, OL 7.4
ACCEL_BASE = vmax_ref/1.8 (~118 for WR);  ACCEL_GAIN = 0.012*vmax_ref per pt
TURN_BASE  so 70-AGI WR full-speed turn R ~3yd;  AGI_GAIN = +2%/pt of turnMax
DECEL_MAX  = 2.25*aMax
BACKPEDAL_MUL 0.55, LATERAL_MUL 0.75, TURBO 1.28, EPS 2 px/s
```

**AI pursuit** seeks the LEAD point (single shared helper, replaces ad-hoc `intercept()`):
```
tInt = dist(self,carrier)/max(self.vmax,1);  lead = carrier.pos + carrier.v*tInt*LEAD_K(0.9)
lead += leverageNormal * LEVERAGE_BIAS(0.6-1.0yd toward the shoulder to protect)
// slower defender biases lead further downfield (wider angle) -> cut-off vs overrun emerges from geometry
```
Engagement flags (`blocked && !shed`, `stun>0`) gate/damp steering before force is applied (existing `neutralized()` stays the gate).

### 2. Ratings schema (0-99, one source of truth on `Player`)
Replace the role-keyed `BLOCK_RATING`/`shedRating` maps with a per-player `ratings` record. Archetype bands: **elite 88-99, starter 75-87, average 65-74, weak 50-64, scrub 40-49.**

```
Universal (all):      SPD ACC AGI STR AWR
QB:                   THP, ACS/ACM/ACD (short/mid/deep acc), PLZ (pocket), TUP, RUN, AGG (trait -1..+1)
RB:                   CAR TRK ELU BCV JKM SPM SFA BTK  (BTK default break-tackle)
WR/TE:                CTH CIT SPC RLS  RRS/RRM/RRD (route short/mid/deep)
OL:                   RBK IBL PBK PBP(power) PBF(finesse) WT
DL/EDGE:              BSH PMV FMV PWR  WT
LB:                   TAK HIT BSH PRC PUR  ZCV MCV
CB/S:                 MCV ZCV PRS  TAK HIT  INT JMP HGT  PRC PUR
DEF universal:        TAK HIT PUR PRC (tackle/hit/pursuit/recognition present on every front-7+DB)
```
Composites are built **by the caller** before invoking `contest()` (e.g. bull-rush `atk = 0.7*PMV+0.3*STR`; juke resist `atk = 0.65*ELU+0.25*AGI+0.10*BTK`). The kernel never knows position-specific rating names — it only sees `atk`/`def`.

### 3. Engine tick order (per fixed `dt`)
```
1. assignJobs/fits   (presnap, stamps fitRole, man/zone, rush set, schemeMods)
2. resolveBlocks     (every engaged pair -> contest(kind:block|rush, perFrame:dt)) -> sets shed/stun/drive
3. updateOffense AI + applyUserMove   (carrier read, routes, steering integrator)
4. updateDefense AI  (pursuit lead, coverage drift, fits)   -> steering integrator
5. integrate movement (the force loop above) for all 22
6. ball flight / catch sphere check -> contest(kind:catch) on arrival
7. checkContact/tackle -> contest(kind:tackle) for FREE defenders in CONTACT_R
8. decay stun timers; clamp to field
```
Determinism: a single seeded xorshift. Add `reseed(seed)` to `utils.ts` so each headless POC test reseeds (e.g. `0x9e3779b9`) and replays identically.
