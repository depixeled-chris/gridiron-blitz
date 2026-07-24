export const YARD = 22; // px per yard
export const ENDZONE = 10; // yards
export const FIELD_YARDS = 100; // between goal lines
export const FIELD_W_YARDS = 24; // playable width (compressed, Tecmo-style)

export const WORLD_W = (ENDZONE * 2 + FIELD_YARDS) * YARD; // 2640
export const WORLD_H = FIELD_W_YARDS * YARD; // 528

export const VIEW_W = 960;
export const VIEW_H = 540;
export const FIELD_Y = Math.floor((VIEW_H - WORLD_H) / 2); // vertical letterbox offset

export const SIDELINE = 1 * YARD; // formation/route/ball-spot inset from top/bottom
// The MOVEMENT boundary — where a body is actually pinned and a carrier can be
// forced out. Sits ON the drawn white sideline stripe at the field edge, so the
// out-of-bounds line IS the line you see (it used to be SIDELINE: a full yard
// of unmarked green inside the stripe, so carriers were whistled out while
// visibly standing in the field of play).
export const BOUNDS = 5; // px — matches the sideline stripe width in drawField

// goal lines (absolute world X)
export const LEFT_GOAL = ENDZONE * YARD; // 220 — away attacks here
export const RIGHT_GOAL = (ENDZONE + FIELD_YARDS) * YARD; // 2420 — home attacks here

export const TACKLE_R = 0.8 * YARD; // sprites are ~0.5yd — require real body overlap, not near-miss trips
export const CATCH_R = 1.3 * YARD;
export const BLOCK_R = 1.1 * YARD;

export const TURBO = 1.13; // only the user's carrier gets it; 1.28 made him
// uncatchable vs 1.0x AI pursuit (housecalls / turbo blow-by). A real boost, not a cheat.
export const SHED_TIME = 1.3; // seconds a block holds before the defender sheds

export const PASS_SPEED = 22 * YARD; // px/sec ground speed of a thrown ball (visible flight, still catchable)
export const KICK_SPEED = 26 * YARD; // px/sec for FG/punt flight (kept faster than a pass)

// passing arc / height model (z axis, in px)
export const Z_RELEASE = 1.8 * YARD; // QB release height
export const Z_CATCH = 1.0 * YARD; // ball height at the catch point
export const REACH = 2.3 * YARD; // how high a player can reach/jump for the ball
export const BLOCKED_REACH = 1.0 * YARD; // an engaged blocker can't go up for it
export const DEFLECT_R = 0.9 * YARD; // a defender must be ~this close under the ball
export const INT_CHANCE = 0.3; // chance a defender in reach picks it cleanly
export const TIP_CHANCE = 0.5; // of the rest, chance it tips up loose vs hits the turf

// catch / jump-ball resolution geometry (the active completion-rate tuning knobs)
export const CATCH_AREA = CATCH_R * 1.6; // radius around the ball a receiver/defender can play it
export const LAND_ZONE = 2.4 * YARD; // ball-to-landing distance that opens the catch resolution
export const RELEASE_ZONE = 4.5 * YARD; // ball-to-QB distance inside which the throw can be batted at the line
export const SWAT_R = DEFLECT_R * 1.2; // a line defender must be this close under the release to attempt a swat
export const SWAT_Z = 2.1 * YARD; // max ball height a hand at the line can get a piece of — above this
// the arc has cleared the underneath defender (was gated only by jump REACH, which let defenders
// "well under the ball" block mid-flight throws several yards past the release)
export const LEAD_MARGIN = 0.7 * YARD; // a defender must be this much closer to the ball than the WR to undercut it
export const QUARTER_SECONDS = 120; // arcade-short quarters
export const PLAY_CLOCK = 25;

export const COLORS = {
  fieldDark: 0x1f8f3a,
  fieldLight: 0x239c40,
  endzoneHome: 0x123e7c,
  endzoneAway: 0x7c1320,
  line: 0xffffff,
  lineFaint: 0xbfeccb,
  home: 0x2a6df4,
  homeDark: 0x16357a,
  away: 0xe23b3b,
  awayDark: 0x7c1320,
  ball: 0x7a4012,
  highlight: 0xffe600,
  controlRing: 0xffffff,
};
