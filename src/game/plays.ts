import type {
  DefenseFormation,
  OffenseFormation,
  OffensePlay,
} from "./types";

// Receiver slots: A = WR top, B = WR bottom, C = TE, R = RB (swing).
// Routes are lists of {fwd, lat} waypoints in yards from the player's snap spot.

const P = {
  slants: {
    id: "slants",
    name: "TWIN SLANTS",
    kind: "pass",
    routes: {
      A: [{ fwd: 4, lat: 0 }, { fwd: 12, lat: -6 }],
      B: [{ fwd: 4, lat: 0 }, { fwd: 12, lat: 6 }],
      C: [{ fwd: 6, lat: 3 }, { fwd: 10, lat: 3 }],
      R: [{ fwd: 1, lat: 7 }, { fwd: 3, lat: 11 }],
    },
  },
  crossers: {
    id: "crossers",
    name: "CROSSERS",
    kind: "pass",
    routes: {
      A: [{ fwd: 8, lat: 0 }, { fwd: 12, lat: 12 }],
      B: [{ fwd: 8, lat: 0 }, { fwd: 12, lat: -12 }],
      C: [{ fwd: 14, lat: -4 }],
      R: [{ fwd: 0, lat: 8 }],
    },
  },
  streaks: {
    id: "streaks",
    name: "GO DEEP",
    kind: "pass",
    routes: {
      A: [{ fwd: 30, lat: -1 }],
      B: [{ fwd: 30, lat: 1 }],
      C: [{ fwd: 12, lat: 0 }],
      R: [{ fwd: 2, lat: 9 }, { fwd: 10, lat: 9 }],
    },
  },
  fourverts: {
    id: "fourverts",
    name: "FOUR VERTS",
    kind: "pass",
    routes: {
      A: [{ fwd: 32, lat: -1 }],
      B: [{ fwd: 32, lat: 1 }],
      C: [{ fwd: 26, lat: 0 }],
      R: [{ fwd: 4, lat: 8 }, { fwd: 18, lat: 9 }],
    },
  },
  mesh: {
    id: "mesh",
    name: "MESH",
    kind: "pass",
    routes: {
      A: [{ fwd: 5, lat: 0 }, { fwd: 6, lat: 14 }],
      B: [{ fwd: 5, lat: 0 }, { fwd: 6, lat: -14 }],
      C: [{ fwd: 12, lat: -6 }, { fwd: 18, lat: -8 }],
      R: [{ fwd: 1, lat: 9 }],
    },
  },
  pa_deep: {
    id: "pa_deep",
    name: "PLAY ACTION",
    kind: "pass",
    routes: {
      A: [{ fwd: 28, lat: -2 }],
      B: [{ fwd: 14, lat: 6 }, { fwd: 22, lat: 2 }],
      C: [{ fwd: 16, lat: -3 }],
      R: [{ fwd: 0, lat: 6 }],
    },
  },
  fade: {
    id: "fade",
    name: "FADE",
    kind: "pass",
    routes: {
      A: [{ fwd: 6, lat: -2 }, { fwd: 14, lat: -6 }],
      B: [{ fwd: 6, lat: 2 }, { fwd: 14, lat: 6 }],
      C: [{ fwd: 5, lat: 1 }],
      R: [{ fwd: 1, lat: 7 }],
    },
  },
  bubble: {
    id: "bubble",
    name: "BUBBLE",
    kind: "pass",
    routes: {
      A: [{ fwd: -1, lat: -3 }, { fwd: 3, lat: -9 }],
      B: [{ fwd: 6, lat: 0 }],
      C: [{ fwd: 8, lat: 2 }],
      R: [{ fwd: 1, lat: 8 }],
    },
  },
  dive: {
    id: "dive",
    name: "HB DIVE",
    kind: "run",
    runner: "RB",
    routes: {
      A: [{ fwd: 12, lat: -2 }],
      B: [{ fwd: 12, lat: 2 }],
      C: [{ fwd: 6, lat: 0 }],
      R: [{ fwd: 14, lat: 0 }],
    },
  },
  sweep: {
    id: "sweep",
    name: "HB SWEEP",
    kind: "run",
    runner: "RB",
    routes: {
      A: [{ fwd: 10, lat: -3 }],
      B: [{ fwd: 6, lat: 10 }],
      C: [{ fwd: 4, lat: 6 }],
      R: [{ fwd: 2, lat: 12 }, { fwd: 16, lat: 14 }],
    },
  },
  power: {
    id: "power",
    name: "POWER",
    kind: "run",
    runner: "RB",
    routes: {
      A: [{ fwd: 10, lat: -3 }],
      B: [{ fwd: 8, lat: 3 }],
      C: [{ fwd: 6, lat: -1 }],
      R: [{ fwd: 2, lat: -3 }, { fwd: 14, lat: -5 }],
    },
  },
  draw: {
    id: "draw",
    name: "DRAW",
    kind: "run",
    runner: "RB",
    routes: {
      A: [{ fwd: 14, lat: -2 }],
      B: [{ fwd: 14, lat: 2 }],
      C: [{ fwd: 8, lat: 0 }],
      R: [{ fwd: -1, lat: 0 }, { fwd: 12, lat: 1 }],
    },
  },
  qbkeep: {
    id: "qbkeep",
    name: "QB KEEPER",
    kind: "run",
    runner: "QB",
    routes: {
      A: [{ fwd: 14, lat: -3 }],
      B: [{ fwd: 14, lat: 3 }],
      C: [{ fwd: 8, lat: -2 }],
      R: [{ fwd: 6, lat: -8 }],
    },
  },
  sneak: {
    id: "sneak",
    name: "QB SNEAK",
    kind: "run",
    runner: "QB",
    routes: {
      A: [{ fwd: 6, lat: -2 }],
      B: [{ fwd: 6, lat: 2 }],
      C: [{ fwd: 3, lat: 1 }],
      R: [{ fwd: 2, lat: 3 }],
    },
  },
  punt: {
    id: "punt",
    name: "PUNT",
    kind: "punt",
    routes: { A: [], B: [], C: [], R: [] },
  },
  fieldgoal: {
    id: "fieldgoal",
    name: "FIELD GOAL",
    kind: "fg",
    routes: { A: [], B: [], C: [], R: [] },
  },
} satisfies Record<string, OffensePlay>;

export const OFFENSE_FORMATIONS: OffenseFormation[] = [
  {
    id: "shotgun",
    name: "SHOTGUN",
    tag: "BALANCED",
    plays: [P.slants, P.crossers, P.streaks, P.draw, P.qbkeep],
  },
  {
    id: "iform",
    name: "I-FORM",
    tag: "POWER RUN",
    align: {
      QB: { fwd: -1, lat: 0 },
      R: { fwd: -5, lat: 0 },
      F: { fwd: -2.7, lat: 0 },
      A: { lat: -8 },
      B: { lat: 8 },
      C: { lat: 3.5 },
    },
    plays: [P.dive, P.sweep, P.power, P.pa_deep, P.qbkeep],
  },
  {
    id: "spread",
    name: "SPREAD",
    tag: "PASS",
    align: {
      A: { lat: -12 },
      B: { lat: 12 },
      C: { fwd: -0.5, lat: 8 },
      R: { fwd: -3, lat: 2 },
      F: { fwd: -0.5, lat: -7 },
    },
    plays: [P.fourverts, P.mesh, P.slants, P.bubble, P.crossers],
  },
  {
    id: "goalline",
    name: "GOAL LINE",
    tag: "SHORT YDG",
    align: {
      QB: { fwd: -1, lat: 0 },
      R: { fwd: -3, lat: 0 },
      F: { fwd: -2, lat: 0 },
      A: { lat: -5 },
      B: { lat: 5 },
      C: { lat: 3 },
    },
    plays: [P.sneak, P.dive, P.fade],
  },
  {
    id: "special",
    name: "SPECIAL TEAMS",
    tag: "KICK",
    align: {
      QB: { fwd: -8, lat: 0 }, // punter / holder depth
      R: { fwd: -7, lat: -2 }, // kicker
    },
    plays: [P.punt, P.fieldgoal],
  },
];

export const DEFENSE_FORMATIONS: DefenseFormation[] = [
  {
    id: "base",
    name: "BASE 4-3",
    tag: "BALANCED",
    plays: [
      { id: "cover2", name: "COVER 2 ZONE", coverage: "zone", blitz: 0.1 },
      { id: "cover3", name: "COVER 3 ZONE", coverage: "zone", blitz: 0.2 },
      { id: "man", name: "MAN PRESS", coverage: "man", blitz: 0.25, press: 0.9 },
    ],
  },
  {
    id: "nickel",
    name: "NICKEL",
    tag: "PASS D",
    align: {
      SLB: { fwd: 7, lat: 8 },
      WLB: { fwd: 6, lat: -7 },
    },
    plays: [
      { id: "man", name: "MAN PRESS", coverage: "man", blitz: 0.25, press: 0.9 },
      { id: "cover3", name: "COVER 3 ZONE", coverage: "zone", blitz: 0.2 },
      { id: "zoneblitz", name: "ZONE BLITZ", coverage: "zone", blitz: 0.75 },
    ],
  },
  {
    id: "blitz",
    name: "BLITZ",
    tag: "PRESSURE",
    align: {
      WLB: { fwd: 2.5, lat: -5 },
      MLB: { fwd: 3, lat: 0 },
      SLB: { fwd: 2.5, lat: 5 },
    },
    plays: [
      { id: "zoneblitz", name: "ZONE BLITZ", coverage: "zone", blitz: 0.8 },
      { id: "blitz", name: "ALL-OUT BLITZ", coverage: "man", blitz: 1.0, press: 0.7 },
    ],
  },
  {
    id: "prevent",
    name: "PREVENT",
    tag: "DEEP",
    align: {
      CB1: { fwd: 10, lat: -10 },
      CB2: { fwd: 10, lat: 10 },
      SS: { fwd: 14, lat: 6 },
      FS: { fwd: 18, lat: -3 },
    },
    plays: [
      { id: "prevent", name: "PREVENT", coverage: "zone", blitz: 0.0 },
      { id: "cover3", name: "COVER 3 ZONE", coverage: "zone", blitz: 0.15 },
    ],
  },
];
