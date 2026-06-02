export type Team = "home" | "away";

export type Role =
  | "QB"
  | "RB"
  | "WR"
  | "TE"
  | "OL"
  | "DL"
  | "LB"
  | "DB";

export type Phase =
  | "menu"
  | "playcall"
  | "presnap"
  | "live"
  | "dead"
  | "gameover";

/** A point in yards, relative to a player's snap position, before direction is applied. */
export interface RouteNode {
  /** downfield distance in yards (positive = toward the end zone the offense attacks) */
  fwd: number;
  /** lateral offset in yards (positive = toward the bottom sideline) */
  lat: number;
}

export interface OffensePlay {
  id: string;
  name: string;
  kind: "run" | "pass";
  /** which skill player carries on a run play */
  runner?: "RB" | "QB";
  /** route per receiver slot, keyed by player id suffix */
  routes: Record<string, RouteNode[]>;
}

export interface DefensePlay {
  id: string;
  name: string;
  /** how aggressively front seven rushes the passer (0..1) */
  blitz: number;
  /** how tightly DBs play receivers (0 = zone/loose, 1 = press/man) */
  man: number;
}

export interface Player {
  id: string;
  team: Team;
  role: Role;
  number: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** top speed in yards/sec */
  speed: number;
  hasBall: boolean;
  controlled: boolean;
  /** receiver label key (A/B/C) shown when player can be targeted */
  target?: string;
  /** current route, already resolved to absolute world points (px) */
  route?: { x: number; y: number }[];
  routeIdx: number;
  /** snap origin in px, used by AI */
  ox: number;
  oy: number;
  /** defender this player (OL) is blocking, or assignment for a DB */
  assignId?: string;
  /** brief stun after a juke/block */
  stun: number;
  blocked: boolean;
}

export interface BallState {
  x: number;
  y: number;
  /** id of carrier, or null while in flight / loose */
  carrier: string | null;
  inAir: boolean;
  /** flight progress 0..1 */
  t: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  /** intended receiver id for an in-air pass */
  targetId: string | null;
  /** arc height in px */
  arc: number;
}

export interface HudState {
  phase: Phase;
  quarter: number;
  clock: number;
  home: number;
  away: number;
  possession: Team;
  down: number;
  toGo: number;
  ballOn: string;
  message: string;
  playClock: number;
  userOnOffense: boolean;
}
