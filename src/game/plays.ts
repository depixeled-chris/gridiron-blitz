import type { OffensePlay, DefensePlay } from "./types";

// Receiver slots: A = WR top, B = WR bottom, C = TE, R = RB (swing).
// Routes are lists of {fwd, lat} waypoints in yards from the player's snap spot.
export const OFFENSE_PLAYS: OffensePlay[] = [
  {
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
  {
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
  {
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
  {
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
  {
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
  {
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
];

export const DEFENSE_PLAYS: DefensePlay[] = [
  { id: "cover2", name: "COVER 2", blitz: 0.15, man: 0.25 },
  { id: "man", name: "MAN PRESS", blitz: 0.3, man: 0.85 },
  { id: "blitz", name: "ALL-OUT BLITZ", blitz: 0.95, man: 0.6 },
  { id: "prevent", name: "PREVENT", blitz: 0.0, man: 0.1 },
];
