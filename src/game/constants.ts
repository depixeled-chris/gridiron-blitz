export const YARD = 22; // px per yard
export const ENDZONE = 10; // yards
export const FIELD_YARDS = 100; // between goal lines
export const FIELD_W_YARDS = 24; // playable width (compressed, Tecmo-style)

export const WORLD_W = (ENDZONE * 2 + FIELD_YARDS) * YARD; // 2640
export const WORLD_H = FIELD_W_YARDS * YARD; // 528

export const VIEW_W = 960;
export const VIEW_H = 540;
export const FIELD_Y = Math.floor((VIEW_H - WORLD_H) / 2); // vertical letterbox offset

export const SIDELINE = 1 * YARD; // keep players this far inside top/bottom

// goal lines (absolute world X)
export const LEFT_GOAL = ENDZONE * YARD; // 220 — away attacks here
export const RIGHT_GOAL = (ENDZONE + FIELD_YARDS) * YARD; // 2420 — home attacks here

export const TACKLE_R = 0.85 * YARD;
export const CATCH_R = 1.3 * YARD;
export const BLOCK_R = 1.1 * YARD;

export const TURBO = 1.28;

// speeds, yards/sec
export const SPEED: Record<string, number> = {
  QB: 8.2,
  RB: 9.6,
  WR: 9.7,
  TE: 8.6,
  OL: 7.4,
  DL: 7.6,
  LB: 8.8,
  DB: 9.6,
};

export const PASS_SPEED = 34 * YARD; // px/sec
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
