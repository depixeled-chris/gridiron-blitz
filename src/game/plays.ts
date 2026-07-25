import type {
  DefenseFormation,
  DefensePlay,
  OffenseFormation,
  OffensePlay,
} from "./types";

// Base offensive alignment (yards: fwd = downfield, lat = toward bottom sideline).
export const OFFENSE_BASE: Record<string, { fwd: number; lat: number }> = {
  QB: { fwd: -3, lat: 0 },
  R: { fwd: -3, lat: 3 },
  LT: { fwd: -0.5, lat: -3 },
  LG: { fwd: -0.5, lat: -1.5 },
  CEN: { fwd: -0.5, lat: 0 },
  RG: { fwd: -0.5, lat: 1.5 },
  RT: { fwd: -0.5, lat: 3 },
  F: { fwd: -1.8, lat: -2 },
  A: { fwd: -0.5, lat: -10 },
  B: { fwd: -0.5, lat: 10 },
  C: { fwd: -0.5, lat: 5 },
};

// ---- offensive play library -------------------------------------------
// routes keyed A (WR top) / B (WR bottom) / C (TE) / R (RB). Pass plays only
// list real routes; run plays carry hole (lateral yds) + optional pull guard,
// and short stalk/clearout routes for the non-carriers.
const stalk = (s: number): { fwd: number; lat: number }[] => [{ fwd: 7, lat: s }];
const runRoutes = (hole: number) => ({
  A: stalk(-1),
  B: stalk(1),
  C: [{ fwd: 3, lat: hole > 0 ? 2 : -2 }],
  R: [
    { fwd: 1, lat: hole },
    { fwd: 9, lat: hole },
    { fwd: 18, lat: hole * 1.1 },
  ],
});

const PASS: Record<string, OffensePlay> = {
  slants: {
    id: "slants", name: "TWIN SLANTS", kind: "pass",
    routes: {
      A: [{ fwd: 4, lat: 0 }, { fwd: 12, lat: -6 }],
      B: [{ fwd: 4, lat: 0 }, { fwd: 12, lat: 6 }],
      C: [{ fwd: 6, lat: 3 }, { fwd: 10, lat: 3 }],
      R: [{ fwd: 1, lat: 7 }, { fwd: 3, lat: 11 }],
    },
  },
  crossers: {
    id: "crossers", name: "CROSSERS", kind: "pass",
    routes: {
      A: [{ fwd: 8, lat: 0 }, { fwd: 13, lat: 12 }],
      B: [{ fwd: 8, lat: 0 }, { fwd: 13, lat: -12 }],
      C: [{ fwd: 14, lat: -4 }],
      R: [{ fwd: 0, lat: 8 }],
    },
  },
  fourverts: {
    id: "fourverts", name: "FOUR VERTS", kind: "pass",
    routes: {
      A: [{ fwd: 32, lat: -1 }],
      B: [{ fwd: 32, lat: 1 }],
      C: [{ fwd: 26, lat: 0 }],
      R: [{ fwd: 4, lat: 8 }, { fwd: 18, lat: 9 }],
    },
  },
  mesh: {
    id: "mesh", name: "MESH", kind: "pass",
    routes: {
      A: [{ fwd: 5, lat: 0 }, { fwd: 6, lat: 14 }],
      B: [{ fwd: 5, lat: 0 }, { fwd: 6, lat: -14 }],
      C: [{ fwd: 12, lat: -6 }, { fwd: 18, lat: -8 }],
      R: [{ fwd: 1, lat: 9 }],
    },
  },
  smash: {
    id: "smash", name: "SMASH", kind: "pass",
    routes: {
      A: [{ fwd: 6, lat: 0 }],
      B: [{ fwd: 4, lat: 0 }, { fwd: 16, lat: -7 }],
      C: [{ fwd: 3, lat: 6 }],
      R: [{ fwd: 1, lat: 8 }],
    },
  },
  flood: {
    id: "flood", name: "FLOOD", kind: "pass",
    routes: {
      A: [{ fwd: 22, lat: 2 }],
      B: [{ fwd: 10, lat: 9 }],
      C: [{ fwd: 4, lat: 10 }],
      R: [{ fwd: 2, lat: -8 }],
    },
  },
  dagger: {
    id: "dagger", name: "DAGGER", kind: "pass",
    routes: {
      A: [{ fwd: 26, lat: 0 }],
      B: [{ fwd: 14, lat: 0 }, { fwd: 16, lat: -10 }],
      C: [{ fwd: 12, lat: 2 }],
      R: [{ fwd: 1, lat: 8 }],
    },
  },
  outs: {
    id: "outs", name: "DOUBLE OUTS", kind: "pass",
    routes: {
      A: [{ fwd: 8, lat: 0 }, { fwd: 9, lat: -6 }],
      B: [{ fwd: 8, lat: 0 }, { fwd: 9, lat: 6 }],
      C: [{ fwd: 5, lat: 0 }],
      R: [{ fwd: 1, lat: 7 }],
    },
  },
  hitches: {
    id: "hitches", name: "HITCHES", kind: "pass",
    routes: {
      A: [{ fwd: 6, lat: 0 }],
      B: [{ fwd: 6, lat: 0 }],
      C: [{ fwd: 5, lat: 1 }],
      R: [{ fwd: 1, lat: 6 }],
    },
  },
  fade: {
    id: "fade", name: "FADE", kind: "pass",
    routes: {
      A: [{ fwd: 6, lat: -2 }, { fwd: 16, lat: -6 }],
      B: [{ fwd: 6, lat: 2 }, { fwd: 16, lat: 6 }],
      C: [{ fwd: 5, lat: 1 }],
      R: [{ fwd: 1, lat: 7 }],
    },
  },
  bubble: {
    id: "bubble", name: "BUBBLE", kind: "pass",
    routes: {
      A: [{ fwd: -1, lat: -3 }, { fwd: 3, lat: -9 }],
      B: [{ fwd: 6, lat: 0 }],
      C: [{ fwd: 8, lat: 2 }],
      R: [{ fwd: 1, lat: 8 }],
    },
  },
  padeep: {
    id: "padeep", name: "PLAY ACTION", kind: "pass",
    routes: {
      A: [{ fwd: 28, lat: -2 }],
      B: [{ fwd: 14, lat: 6 }, { fwd: 22, lat: 2 }],
      C: [{ fwd: 16, lat: -3 }],
      R: [{ fwd: 0, lat: 6 }],
    },
  },
  levels: {
    id: "levels", name: "LEVELS", kind: "pass",
    routes: {
      A: [{ fwd: 5, lat: 0 }, { fwd: 6, lat: 8 }],
      B: [{ fwd: 11, lat: 0 }, { fwd: 12, lat: 8 }],
      C: [{ fwd: 16, lat: -2 }],
      R: [{ fwd: 1, lat: -7 }],
    },
  },
  postwheel: {
    id: "postwheel", name: "POST-WHEEL", kind: "pass",
    routes: {
      A: [{ fwd: 12, lat: 0 }, { fwd: 20, lat: 6 }],
      B: [{ fwd: 2, lat: 0 }, { fwd: 18, lat: 11 }],
      C: [{ fwd: 7, lat: -3 }],
      R: [{ fwd: 1, lat: -7 }],
    },
  },
};

const RUN: Record<string, OffensePlay> = {
  dive: { id: "dive", name: "HB DIVE", kind: "run", runner: "RB", hole: 0, routes: runRoutes(0) },
  iso: { id: "iso", name: "ISO", kind: "run", runner: "RB", hole: 1.5, routes: runRoutes(1.5) },
  power: { id: "power", name: "POWER", kind: "run", runner: "RB", hole: 3, pull: "LG", routes: runRoutes(3) },
  counter: { id: "counter", name: "COUNTER", kind: "run", runner: "RB", hole: -3, pull: "RG", routes: runRoutes(-3) },
  sweep: { id: "sweep", name: "SWEEP", kind: "run", runner: "RB", hole: 9, pull: "RG", routes: runRoutes(9) },
  toss: { id: "toss", name: "TOSS", kind: "run", runner: "RB", hole: 11, routes: runRoutes(11) },
  draw: { id: "draw", name: "DRAW", kind: "run", runner: "RB", hole: 0, routes: runRoutes(0) },
  trap: { id: "trap", name: "TRAP", kind: "run", runner: "RB", hole: 2, pull: "LG", routes: runRoutes(2) },
  qbkeep: { id: "qbkeep", name: "QB KEEPER", kind: "run", runner: "QB", hole: 6, routes: runRoutes(6) },
  sneak: { id: "sneak", name: "QB SNEAK", kind: "run", runner: "QB", hole: 0, routes: runRoutes(0) },
};

// ---- special teams -----------------------------------------------------
// Two DIFFERENT units, not one "kick" bucket:
//  PLACE KICK (FG/PAT): tight wall + wings, HOLDER at 7yd receives the snap and
//    holds the ball, KICKER steps into it. The strike point is the hold spot.
//  PUNT: no holder — the snap goes all the way back to the PUNTER at 13yd, he
//    catches it and kicks it out of his hands. Gunners split wide to cover.
const PLACE_ALIGN = {
  // tight line splits — no gaps for a rusher to shoot cleanly
  LT: { fwd: -0.5, lat: -2.4 }, LG: { fwd: -0.5, lat: -1.2 }, CEN: { fwd: -0.5, lat: 0 },
  RG: { fwd: -0.5, lat: 1.2 }, RT: { fwd: -0.5, lat: 2.4 },
  C: { fwd: -0.5, lat: -3.6 }, F: { fwd: -0.5, lat: 3.6 }, // ends
  A: { fwd: -1.3, lat: -4.8 }, B: { fwd: -1.3, lat: 4.8 }, // wings
  R: { fwd: -7, lat: 0 }, // HOLDER — takes the snap, holds it at the spot
  QB: { fwd: -8.2, lat: -1.4 }, // KICKER — approaches from behind/off-side
};

const PUNT_ALIGN = {
  LT: { fwd: -0.5, lat: -2.4 }, LG: { fwd: -0.5, lat: -1.2 }, CEN: { fwd: -0.5, lat: 0 },
  RG: { fwd: -0.5, lat: 1.2 }, RT: { fwd: -0.5, lat: 2.4 },
  C: { fwd: -0.5, lat: -3.6 }, F: { fwd: -4.5, lat: 1.5 }, // end + personal protector
  A: { fwd: -0.5, lat: -11 }, B: { fwd: -0.5, lat: 11 }, // gunners
  R: { fwd: -4.5, lat: -1.5 }, // personal protector (NO holder on a punt)
  QB: { fwd: -13, lat: 0 }, // PUNTER — catches the long snap and kicks it
};

const SPECIAL: Record<string, OffensePlay> = {
  punt: { id: "punt", name: "PUNT", kind: "punt", align: PUNT_ALIGN, routes: { A: [], B: [], C: [], R: [] } },
  fieldgoal: { id: "fieldgoal", name: "FIELD GOAL", kind: "fg", align: PLACE_ALIGN, routes: { A: [], B: [], C: [], R: [] } },
  xp: { id: "xp", name: "EXTRA POINT", kind: "pat", align: PLACE_ALIGN, routes: { A: [], B: [], C: [], R: [] } },
};

// going for two is NOT a special formation — it's a regular offensive play from
// a regular formation (the PAT kick lives on the place-kick unit instead).
const CONVERT: Record<string, OffensePlay> = {
  twodive: { id: "twodive", name: "2PT DIVE", kind: "run", runner: "RB", hole: 0, routes: runRoutes(0) },
  twoslants: {
    id: "twoslants", name: "2PT SLANTS", kind: "pass",
    routes: {
      A: [{ fwd: 2, lat: 0 }, { fwd: 5, lat: -4 }],
      B: [{ fwd: 2, lat: 0 }, { fwd: 5, lat: 4 }],
      C: [{ fwd: 3, lat: 2 }],
      R: [{ fwd: 1, lat: 7 }],
    },
  },
};

export const OFFENSE_FORMATIONS: OffenseFormation[] = [
  {
    id: "shotgun", name: "SHOTGUN", tag: "BALANCED",
    plays: [
      PASS.slants, PASS.crossers, PASS.fourverts,
      PASS.dagger, PASS.levels, PASS.outs,
      RUN.draw, RUN.dive, RUN.qbkeep,
    ],
  },
  {
    id: "iform", name: "I-FORM", tag: "POWER RUN",
    align: { QB: { fwd: -1, lat: 0 }, R: { fwd: -5, lat: 0 }, F: { fwd: -2.7, lat: 0 }, A: { lat: -8 }, B: { lat: 8 }, C: { lat: 3.5 } },
    plays: [
      RUN.dive, RUN.iso, RUN.power,
      RUN.counter, RUN.sweep, RUN.toss,
      PASS.padeep, PASS.smash, PASS.postwheel,
    ],
  },
  {
    id: "spread", name: "SPREAD", tag: "PASS",
    align: { A: { lat: -12 }, B: { lat: 12 }, C: { fwd: -0.5, lat: 8 }, R: { fwd: -3, lat: 2 }, F: { fwd: -0.5, lat: -7 } },
    plays: [
      PASS.fourverts, PASS.mesh, PASS.crossers,
      PASS.flood, PASS.bubble, PASS.smash,
      PASS.levels, RUN.draw, RUN.sweep,
    ],
  },
  {
    id: "goalline", name: "GOAL LINE", tag: "SHORT YDG",
    align: { QB: { fwd: -1, lat: 0 }, R: { fwd: -3, lat: 0 }, F: { fwd: -2, lat: 0 }, A: { lat: -5 }, B: { lat: 5 }, C: { lat: 3 } },
    plays: [
      RUN.sneak, RUN.dive, RUN.iso,
      RUN.power, RUN.counter, PASS.fade,
      PASS.smash, PASS.hitches, RUN.qbkeep,
    ],
  },
  {
    id: "placekick", name: "PLACE KICK", tag: "FG / PAT",
    align: PLACE_ALIGN,
    plays: [SPECIAL.fieldgoal, SPECIAL.xp],
  },
  {
    id: "puntunit", name: "PUNT UNIT", tag: "PUNT",
    align: PUNT_ALIGN,
    plays: [SPECIAL.punt],
  },
  {
    // shown only during a point-after try (filtered out of normal play-calling)
    id: "convert", name: "GO FOR TWO", tag: "2PT",
    align: { QB: { fwd: -1, lat: 0 }, R: { fwd: -3, lat: 0 }, F: { fwd: -2, lat: 0 }, A: { lat: -5 }, B: { lat: 5 }, C: { lat: 3 } },
    plays: [CONVERT.xp, CONVERT.twodive, CONVERT.twoslants],
  },
];

// ---- defensive coverage menu (shared across fronts) -------------------
const COV: Record<string, DefensePlay> = {
  man: { id: "man", name: "MAN PRESS", coverage: "man", blitzers: 0, press: 0.85 },
  cover2: { id: "cover2", name: "COVER 2", coverage: "cover2", blitzers: 0 },
  cover3: { id: "cover3", name: "COVER 3", coverage: "cover3", blitzers: 0 },
  cover4: { id: "cover4", name: "COVER 4", coverage: "cover4", blitzers: 0 },
  zoneblitz: { id: "zoneblitz", name: "ZONE BLITZ", coverage: "cover3", blitzers: 2 },
  fireblitz: { id: "fireblitz", name: "FIRE ZONE", coverage: "cover2", blitzers: 2 },
  manblitz: { id: "manblitz", name: "MAN BLITZ", coverage: "man", blitzers: 1, press: 0.8 },
  allout: { id: "allout", name: "ALL-OUT BLITZ", coverage: "man", blitzers: 3, press: 0.7 },
  prevent: { id: "prevent", name: "PREVENT", coverage: "cover4", blitzers: 0 },
};

// special-teams calls. `blitzers` is the extra rush beyond the down linemen —
// a max-block send is what actually gets a hand on the ball.
const ST: Record<string, DefensePlay> = {
  blockMiddle: { id: "blockmiddle", name: "BLOCK — MIDDLE", coverage: "man", blitzers: 3 },
  blockEdge: { id: "blockedge", name: "BLOCK — EDGE", coverage: "man", blitzers: 2 },
  blockSafe: { id: "blocksafe", name: "RUSH SAFE", coverage: "man", blitzers: 0 },
  returnUp: { id: "returnup", name: "RETURN MIDDLE", coverage: "man", blitzers: 0 },
  puntBlock: { id: "puntblock", name: "PUNT BLOCK", coverage: "man", blitzers: 3 },
};
const ST_BLOCK_MENU = [ST.blockMiddle, ST.blockEdge, ST.blockSafe];
const ST_RETURN_MENU = [ST.returnUp, ST.puntBlock];

const PASS_MENU = [COV.man, COV.cover2, COV.cover3, COV.cover4, COV.zoneblitz, COV.fireblitz, COV.manblitz, COV.allout, COV.prevent];
const RUN_MENU = [COV.man, COV.cover2, COV.cover3, COV.manblitz, COV.zoneblitz, COV.fireblitz, COV.allout];

const D = (slot: string, role: "DL" | "LB" | "CB" | "S", fwd: number, lat: number, num: number) =>
  ({ slot, role, fwd, lat, num });

export const DEFENSE_FORMATIONS: DefenseFormation[] = [
  {
    id: "fourthree", name: "4-3", tag: "BASE",
    front: [
      D("DE1", "DL", 1, -4.5, 91), D("DT1", "DL", 1, -1.5, 94), D("DT2", "DL", 1, 1.5, 98), D("DE2", "DL", 1, 4.5, 56),
      D("WLB", "LB", 4, -5, 54), D("MLB", "LB", 4.5, 0, 52), D("SLB", "LB", 4, 5, 58),
      D("CB1", "CB", 5, -10, 24), D("CB2", "CB", 5, 10, 21),
      D("FS", "S", 11, -5, 31), D("SS", "S", 10, 5, 33),
    ],
    plays: PASS_MENU,
  },
  {
    id: "threefour", name: "3-4", tag: "VERSATILE",
    front: [
      D("DE1", "DL", 1, -4, 95), D("NT", "DL", 1, 0, 98), D("DE2", "DL", 1, 4, 91),
      D("OLB1", "LB", 3, -7, 55), D("ILB1", "LB", 4, -2, 52), D("ILB2", "LB", 4, 2, 54), D("OLB2", "LB", 3, 7, 58),
      D("CB1", "CB", 5, -10, 24), D("CB2", "CB", 5, 10, 21),
      D("FS", "S", 11, -4, 31), D("SS", "S", 10, 4, 33),
    ],
    plays: PASS_MENU,
  },
  {
    id: "nickel", name: "NICKEL", tag: "PASS D",
    front: [
      D("DE1", "DL", 1, -4.5, 91), D("DT1", "DL", 1, -1.5, 94), D("DT2", "DL", 1, 1.5, 98), D("DE2", "DL", 1, 4.5, 56),
      D("WLB", "LB", 4, -3, 54), D("MLB", "LB", 4.5, 3, 52),
      D("CB1", "CB", 5, -10, 24), D("CB2", "CB", 5, 10, 21), D("NB", "CB", 5, 5, 27),
      D("FS", "S", 12, -5, 31), D("SS", "S", 11, 5, 33),
    ],
    plays: PASS_MENU,
  },
  {
    id: "dime", name: "DIME", tag: "DEEP PASS D",
    front: [
      D("DE1", "DL", 1, -4.5, 91), D("DT1", "DL", 1, -1.5, 94), D("DT2", "DL", 1, 1.5, 98), D("DE2", "DL", 1, 4.5, 56),
      D("MLB", "LB", 5, 0, 52),
      D("CB1", "CB", 5, -10, 24), D("CB2", "CB", 5, 10, 21), D("NB", "CB", 5, -5, 27), D("DB4", "CB", 5, 5, 28),
      D("FS", "S", 12, -5, 31), D("SS", "S", 12, 5, 33),
    ],
    plays: PASS_MENU,
  },
  {
    id: "fivetwo", name: "5-2", tag: "RUN STUFF",
    front: [
      D("DE1", "DL", 1, -6, 91), D("DT1", "DL", 1, -3, 94), D("NT", "DL", 1, 0, 98), D("DT2", "DL", 1, 3, 96), D("DE2", "DL", 1, 6, 56),
      D("WLB", "LB", 4, -3, 54), D("SLB", "LB", 4, 3, 58),
      D("CB1", "CB", 5, -10, 24), D("CB2", "CB", 5, 10, 21),
      D("FS", "S", 11, -4, 31), D("SS", "S", 10, 4, 33),
    ],
    plays: RUN_MENU,
  },
  {
    id: "goalline", name: "GOAL LINE", tag: "SHORT YDG",
    front: [
      D("DE1", "DL", 1, -7, 91), D("DT1", "DL", 1, -4, 94), D("NT1", "DL", 1, -1.5, 98), D("NT2", "DL", 1, 1.5, 96), D("DT2", "DL", 1, 4, 90), D("DE2", "DL", 1, 7, 56),
      D("WLB", "LB", 3, -4, 54), D("MLB", "LB", 3, 0, 52), D("SLB", "LB", 3, 4, 58),
      D("CB1", "CB", 4, -9, 24), D("CB2", "CB", 4, 9, 21),
    ],
    plays: RUN_MENU,
  },
  // ---- special teams defense: a unit per instance ------------------------
  {
    // FG/PAT BLOCK: everybody crowds the line to collapse the middle and get a
    // hand up at the strike point; the ends loop for the edge.
    id: "fgblock", name: "FG BLOCK", tag: "VS KICK",
    front: [
      D("DE1", "DL", 0.8, -6, 91), D("DT1", "DL", 0.8, -3.5, 94), D("NT1", "DL", 0.8, -1.2, 98),
      D("NT2", "DL", 0.8, 1.2, 96), D("DT2", "DL", 0.8, 3.5, 90), D("DE2", "DL", 0.8, 6, 56),
      D("WLB", "LB", 1.5, -8, 54), D("SLB", "LB", 1.5, 8, 58),
      D("MLB", "LB", 2.5, 0, 52),
      D("CB1", "CB", 5, -11, 24), D("CB2", "CB", 5, 11, 21),
    ],
    plays: ST_BLOCK_MENU,
  },
  {
    // PUNT RETURN: a light rush, jammers on the gunners, and a RETURNER deep.
    id: "puntreturn", name: "PUNT RETURN", tag: "VS PUNT",
    front: [
      D("DE1", "DL", 0.8, -4, 91), D("DT1", "DL", 0.8, -1.5, 94),
      D("DT2", "DL", 0.8, 1.5, 98), D("DE2", "DL", 0.8, 4, 56),
      D("WLB", "LB", 3, -7, 54), D("SLB", "LB", 3, 7, 58),
      D("CB1", "CB", 2, -11, 24), D("CB2", "CB", 2, 11, 21), // jam the gunners
      D("FS", "S", 14, -3, 31), D("SS", "S", 14, 3, 33),
      D("RET", "S", 42, 0, 15), // the returner, fielding it deep
    ],
    plays: ST_RETURN_MENU,
  },
];
