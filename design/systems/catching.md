# Catching

> System spec — Gridiron Blitz rebuild. Auto-generated from the parallel research workflow; grounded in the cited sources below.

## Summary
A single weighted-roll "catch contest" fires the instant the ball arrives in the catch sphere (ground distance to landing spot + height vs reach). It computes a Win Margin M = (receiver catch composite) - (defender play-ball composite), shifted by throw accuracy/placement and separation, then maps M through a logistic to weights over the outcome spectrum: clean catch, catch-and-RAC, contested catch, drop, pass break-up (PBU), tip (loose ball), and interception. Variance (the spread of the weights) widens with a larger rating mismatch so blowouts produce frequent highlight grabs or pick-sixes while even matchups grind with occasional RNG tails. RAC after the catch is a separate momentum/yards bonus driven by speed/agility/elusiveness vs the nearest tackler.

## Inputs (read each tick / decision)
- Ball state each tick while inAir: ground pos (b.x,b.y), height b.z, landing spot (b.tx,b.ty), flight progress b.t, intended targetId, tip flag
- Throw quality bundle stamped at release: placementError (px offset of landing spot from receiver's true future position), leadDirection (back-shoulder / upfield / inside-out relative to defender leverage), arc/peak (high-point vs line drive), throwOnTime (was receiver open when released)
- Targeted receiver: pos, velocity vector, ratings (catch, catchTraffic, specCatch, awareness/release), facing/forward momentum
- Nearest defender(s) within DEFLECT_R of the ball: pos, velocity, ratings (manCover or zoneCover by job, playBall/awareness, ballSkills/INT, height/jump), leverage side relative to receiver, whether press/trail/in-phase
- Separation = distance from targeted receiver to nearest contesting defender at the catch point (yards)
- Defender height-eligibility: b.z vs defender reach (REACH, or BLOCKED_REACH if engaged)
- Coverage context: man vs zone (defender uses manCover vs zoneCover), is the defender's back turned / trailing (play-receiver) vs facing ball (play-ball)
- Situational leverage: down/distance (not required, optional aggression bias), receiver's catch-mode intent if human-selected (possession / aggressive / RAC / spectacular)
- Global rng() and the contest already in code (INT_CHANCE/TIP_CHANCE) which this replaces with a rating-driven version

## Contest model
```
CATCH CONTEST (fires once, when ball enters catch sphere: ground dist(receiver, b) <= catchR AND b.z <= reach):

// 1. SEPARATION (yards from receiver to nearest contesting defender at catch point)
sep = dist(receiver, nearestDef) / YARD
sepBand: open if sep>=2.0 ; medium if 1.0<=sep<2.0 ; tight/contested if sep<1.0 ; smothered if sep<0.4

// 2. CATCH RADIUS scales with the rating that fits the situation + catch mode
baseR = CATCH_R (1.3 yd)
if open:    catchR = baseR * (0.9 + catch/200)           // CTH governs
if medium:  catchR = baseR * (0.85 + catch/220)
if contested:catchR = baseR * (0.8 + catchTraffic/230)   // CIT governs
spectacular mode OR very high z OR placementError large: catchR += baseR*(0.15 + specCatch/300) // SPC extends radius, costs drop

// 3. RECEIVER CATCH COMPOSITE (0..~110)
recRtg = openCase ? catch
       : contestedCase ? 0.65*catchTraffic + 0.25*specCatch + 0.10*catch
       : /*medium*/ 0.6*catch + 0.4*catchTraffic
recRtg += awareness*0.05            // ball tracking
recRtg -= momentumPenalty           // turning back / over-shoulder throw: up to -12

// 4. DEFENDER PLAY-BALL COMPOSITE (0..~110); 0 if no defender in DEFLECT_R & under the ball
cov = (defender.job=="zone") ? zoneCover : manCover
defRtg = 0.55*cov + 0.30*ballSkills/*INT/catch*/ + 0.15*awareness
defRtg *= facingBall ? 1.0 : 0.55   // trailing/back-turned defender mostly can only PBU, rarely INT
defRtg += jump*0.04 + heightAdj      // high-point contest
if defender not under ball (>DEFLECT_R) -> defRtg = -inf (no contest, uncontested catch)

// 5. THROW PLACEMENT shift (accuracy is the lever the QB/human pulls)
place = clamp(1 - placementError/(1.4*YARD), 0, 1)   // 1 = dimed, 0 = badly off
// good placement helps receiver, away-from-leverage placement also suppresses the defender
recRtg += place*10
if leadAwayFromDefender: defRtg -= 12*place         // back-shoulder / throwing receiver open
if leadIntoDefender (underthrow/into coverage): defRtg += 14    // jump-ball INVITED

// 6. WIN MARGIN and logistic
M = recRtg - defRtg
// separation directly biases M: open ball is the receiver's, tight is a true contest
M += sepBias  where sepBias = clamp((sep-1.0)*18, -22, +26)
pCatch = 1 / (1 + exp(-M/SCALE))      // SCALE=10 -> ~10 rating pts = ~73/27

// 7. VARIANCE SCALES WITH MISMATCH (the core design constraint)
mismatch = abs(M)
spread = clamp(0.10 + mismatch/120, 0.10, 0.55)  // big gap -> outcomes pushed to the tails
roll = pCatch + (rng()-0.5)*2*spread             // mismatch widens the effective roll band
// (equivalently: low mismatch -> tight grind near 0.5; high mismatch -> roll slammed to an extreme)

// 8. MAP roll + context to the OUTCOME SPECTRUM
dropBase = openCase ? 0.04 : contestedCase ? 0.10 : 0.06
dropBase += spectacularMode ? (0.18 - specCatch/700) : 0   // SPC mode = highlight or clank
dropBase += max(0, (60-catchInUse))/300                    // low-rated hands clank more
if roll >= 0.62 - dropBase:
   if defender contesting AND contestedCase: -> CONTESTED CATCH (catch, but goes to ground / no RAC)
   else if sep>=2.0 and forwardMomentum: -> CLEAN CATCH + RAC (see RAC model)
   else -> CLEAN CATCH (possession)
   // drop check rides on top: if rng() < dropBase -> DROP instead
else if roll between (0.45-dropBase) and (0.62-dropBase): -> DROP or PBU
   defender present -> PBU (defRtg/(defRtg+recRtg) chance) else DROP
else (roll low, defender won):
   intShare = clamp((defRtg - recRtg)/140 + ballSkills/300, 0.05, 0.85) * (facingBall?1:0.25)
   r2 = rng()
   if r2 < intShare -> INTERCEPTION
   elif r2 < intShare + 0.30 -> TIP (loose ball, existing startTip path, anyone grabs)
   else -> PASS BREAK-UP / batDown (incomplete)

// RAC MODEL (only on clean catch with forward momentum, no contest):
racYards handled by normal carrier physics; on catch, grant a momentum bonus:
  carrySpeedMult = 1.0 + clamp((catch-70)/300,0,0.1) + (racMode? 0.06:0)
  firstTackleBreakChance vs nearest DB uses existing break-tackle/elusive contest (dependency)
  possession/contested catches set carrier vy/vx ~0 (go to ground), denying RAC
```

## Outcome spectrum
### Pick-six / clean interception returned
- **When:** roll lands low AND defender wins INT sub-roll: ball thrown into coverage (leadIntoDefender), defender facing the ball, big defRtg>recRtg gap
- **Weighting:** + when defender manCover/zoneCover & ballSkills >> receiver catch/CIT, placement into leverage, high mismatch widening spread to the low tail; - when receiver open (sep>=2), back-shoulder placement, defender trailing/back-turned

### Interception (no return)
- **When:** same low-roll INT branch, defender under the ball and facing it
- **Weighting:** + defRtg-recRtg margin, ballSkills, thrown into coverage; scales up sharply as mismatch grows

### Pass break-up (PBU) / batted down — incomplete
- **When:** mid-low roll with a defender contesting; defender wins but lacks the hands/position to secure it
- **Weighting:** + defender good coverage but low INT/ballSkills, trailing defender (facing penalty), tight separation; the common defensive 'win' on an even matchup

### Drop (uncontested)
- **When:** roll in the drop band with no defender, or drop sub-roll fires on a would-be catch
- **Weighting:** + low catch/CIT rating, spectacular/one-handed mode, over-shoulder momentum penalty, bad placement; - high CTH (elite ~4% open, ~85%+ even at 99 wide open)

### Tip / deflection -> live loose ball
- **When:** low roll, defender touches it but neither secures: ~30% of the defender-wins branch
- **Weighting:** + contested medium-height balls, defender present but mediocre ballSkills; routes into existing startTip/resolveLoose so either team can recover

### Contested catch (caught, no RAC, goes to ground)
- **When:** roll clears catch threshold while a defender is actively contesting at tight separation
- **Weighting:** + high CIT and SPC on receiver, good high-point (jump/height), back-shoulder placement away from defender leverage; the receiver's highlight win

### Clean catch (possession, minimal RAC)
- **When:** roll clears threshold, medium separation, receiver squared up or possession mode
- **Weighting:** + catch rating, decent placement; neutral separation

### Clean catch + big RAC / highlight
- **When:** roll clears threshold AND sep>=2 (open) AND forward momentum AND RAC favorable vs nearest tackler
- **Weighting:** + receiver open (blown coverage = big mismatch low defRtg), speed/agility/elusive for the after-catch contest, RAC catch mode; the offensive blow-by tail

## Concrete numbers / heuristics
- CATCH_R base = 1.3 yd (28.6px existing); DEFLECT_R = 0.9 yd; REACH = 2.3 yd; BLOCKED_REACH = 1.0 yd (all already in constants.ts)
- Logistic SCALE = 10 rating points -> ~73%/27% split; 20 pts -> ~88%/12%; equal ratings -> 50% pre-placement/pre-separation
- Separation bands: open >= 2.0 yd, medium 1.0-2.0 yd, contested 0.4-1.0 yd, smothered < 0.4 yd
- sepBias = clamp((sep-1.0)*18, -22, +26) rating-point swing from separation alone
- Elite open-catch baseline: 99 CTH ~ 4-15% drop (target ~85-96% wide-open completion, per Madden Mobile 99-CTH test: 15/102 drops)
- Drop base by case: open 0.04, medium 0.06, contested 0.10; spectacular/one-hand mode adds ~0.18 - specCatch/700 (elite SPC ~0.04 extra, poor SPC ~0.15 extra)
- Low-hands penalty: +(60 - catchInUse)/300 drop chance (e.g. CTH 40 adds ~6.7% drops)
- Variance spread = clamp(0.10 + mismatch/120, 0.10, 0.55): even matchup +/-0.10 grind band, 60-pt mismatch -> +/-0.60 slams to a tail
- INT share = clamp((defRtg-recRtg)/140 + ballSkills/300, 0.05, 0.85) * (facingBall?1:0.25); trailing defender INT cut to a quarter
- Tip share within the defender-wins branch = 0.30 (replaces flat TIP_CHANCE=0.5); remainder = PBU/batDown
- Placement: place = clamp(1 - placementError/(1.4 yd), 0,1); dimed throw +10 to receiver; into-coverage +14 to defender; away-from-leverage -12 to defender * place
- RAC carry-speed bonus = 1.0 + clamp((catch-70)/300, 0, 0.1) (+0.06 in RAC mode); contested/possession catches zero the carrier velocity

## Ratings used
- Receiver: catch (CTH) - drives open & medium catch radius and composite
- Receiver: catchTraffic (CIT) - drives contested/tight-coverage composite and contested catch radius
- Receiver: specCatch (SPC) - one-handed/aggressive extended radius, governs highlight grabs and the extra drop risk in spectacular mode
- Receiver: awareness/release - ball tracking, small composite bonus, reduces over-shoulder momentum penalty
- Receiver (RAC handoff): speed, acceleration, agility, elusiveness - feed the separate after-catch tackle contest
- Defender: manCover (man job) or zoneCover (zone job) - primary play-ball composite term (0.55 weight)
- Defender: ballSkills/INT (catch/play-ball) - converts a coverage win into an INT vs a PBU; drives intShare
- Defender: awareness (PRC) - reaction/facing, 0.15 weight; gates whether defender is facing the ball
- Defender: jump + height - high-point contest bonus on jump balls

## Variance model
Randomness is injected as a band around the logistic pCatch whose half-width = spread = clamp(0.10 + mismatch/120, 0.10, 0.55), where mismatch = |WinMargin M|. Even matchups (M near 0) keep a tight +/-0.10 band so most reps land near the 50/50 contest line — a grind where the result hinges on placement and separation, with only the rare draw at the band edge producing a surprise PBU, drop, or jump-ball INT (the X-factor tail). As the rating gap grows the band widens dramatically (a 60-point gap -> +/-0.60), so the roll is almost always slammed past a threshold: a dominant receiver vs a scrub DB produces frequent open highlight grabs and RAC blow-bys, while a shutdown DB vs weak hands produces frequent PBUs and picks. This makes averages roughly track the logistic but lets the SPREAD of dramatic, readable outcomes scale with mismatch exactly as specified. The drop sub-roll and INT/tip/PBU sub-rolls add independent secondary RNG so even a 'won' contest occasionally clanks (spectacular mode) and even a 'lost' one occasionally only tips loose rather than picks.

## Dependencies
- Throwing/QB-accuracy system: must stamp placementError, leadDirection vs defender leverage, arc/peak, throwOnTime onto BallState at release (throwTo() currently sets tx/ty/peak/ftime but no error model)
- Coverage/Separation system: defender job (man/zone), facing/in-phase/trailing state, and the leverage side that placement is measured against
- Tackle/RAC system: the after-catch break-tackle & elusiveness contest reuses the shared contest kernel (same weighted-roll as Game.ts contest())
- Loose-ball recovery: existing startTip()/resolveLoose()/batDown() pipeline is reused verbatim for the tip and PBU outcomes
- Shared contest kernel: WinMargin M + logistic + mismatch-scaled spread must be the same primitive the synthesis pass uses for block-shed, rush, and tackle contests
- Ratings source: the pre-rolled POC team rating tables must expose catch/catchTraffic/specCatch on receivers and manCover/zoneCover/ballSkills/awareness/jump on defenders (current code only has BLOCK_RATING/shedRating stubs keyed by id)
- Constants.ts: INT_CHANCE and TIP_CHANCE flat constants are replaced by the rating-driven intShare/tipShare; CATCH_R/DEFLECT_R/REACH/BLOCKED_REACH retained as bases

## Sources
- https://www.operationsports.com/all-catches-in-madden-26-and-how-to-use-them/
- https://www.1v1me.com/blog/madden-26-catch-types-guide
- https://www.dexerto.com/madden/how-to-complete-a-one-handed-spectacular-catch-in-madden-25-2864693/
- https://madden.fandom.com/wiki/Attributes
- https://www.mut.gg/news/mut-22-glossary-of-key-terms-and-ratings/
- https://cyberpost.co/what-is-rac-madden/
- https://www.ea.com/games/madden-nfl/madden-nfl-26/controls-hub/m26-pc-defense-coverage-mechanics
- https://www.operationsports.com/how-to-intercept-in-madden-25/
- https://alleyesdbcamp.com/teaching-leverage-and-alignment-across-multiple-coverages-a-blueprint-for-db-coaches/
- https://www.footballsavages.com/breaking-football-high-pointing-vs-catching-traffic-wide-receivers/
- https://old.muthead.com/forums/madden-nfl-mobile/madden-nfl-mobile-discussion/1265387-wr-drop-test-with-99-cat-and-100-tas
