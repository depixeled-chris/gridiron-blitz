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
  kind: "run" | "pass" | "fg" | "punt" | "pat";
  /** which skill player carries on a run play */
  runner?: "RB" | "QB";
  /** designed run hole: lateral yards from center toward the play side */
  hole?: number;
  /** which guard pulls to lead through the hole ("LG" | "RG"), gap scheme */
  pull?: string;
  /** route per receiver slot, keyed by player id suffix */
  routes: Record<string, RouteNode[]>;
}

export type Coverage = "man" | "cover2" | "cover3" | "cover4";

export interface DefensePlay {
  id: string;
  name: string;
  coverage: Coverage;
  /** extra rushers sent beyond the down linemen (linebackers/DBs) */
  blitzers: number;
  /** press/jam tightness for man, 0..1 */
  press?: number;
}

export type DefRole = "DL" | "LB" | "CB" | "S";

/** one defender slot in a defensive front (full 11-man personnel) */
export interface DefSpot {
  slot: string;
  role: DefRole;
  fwd: number;
  lat: number;
  num: number;
}

/** per-slot alignment override (yards) applied on top of the base formation */
export interface AlignOverride {
  fwd?: number;
  lat?: number;
}

export interface OffenseFormation {
  id: string;
  name: string;
  tag: string;
  align?: Record<string, AlignOverride>;
  plays: OffensePlay[];
}

export interface DefenseFormation {
  id: string;
  name: string;
  tag: string;
  /** full personnel + alignment for this front */
  front: DefSpot[];
  plays: DefensePlay[];
}

/** a defender's job for the current play */
export type Job = "rush" | "man" | "zone" | "spy";

export interface Player {
  id: string;
  team: Team;
  role: Role;
  number: number;
  x: number;
  y: number;
  /** actual velocity (px/s) — integrated toward the desired velocity */
  vx: number;
  vy: number;
  /** desired velocity this tick (px/s); AI/input set this, the integrator chases it */
  dvx: number;
  dvy: number;
  /** kinematics derived from ratings (px units) */
  vmax: number;
  vacc: number;
  vturn: number;
  /** sparse ratings (0..99); missing defaults to 70 */
  rat?: Record<string, number | boolean>;
  /** top speed in yards/sec (legacy fallback) */
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
  /** defender this player (OL) is blocking, or assignment (man cover / pickup) */
  assignId?: string;
  /** zone landmark (absolute world px) the defender holds in zone coverage */
  zone?: { x: number; y: number };
  /** defensive job for this play */
  job?: Job;
  /** defensive role sub-type (DL/LB/CB/S) for scheme logic */
  defRole?: DefRole;
  /** run-fit gap this defender owns (lateral yards from center) */
  gap?: number;
  /** knockdown timer (s): pancaked / off-balance, can't move or make a play */
  stun: number;
  blocked: boolean;
  /** seconds this defender has been continuously engaged by a block */
  engaged: number;
  /** true once a defender has BEATEN his current blocker */
  shed: boolean;
  /** id of the blocker he beat — a DIFFERENT blocker picking him up starts fresh */
  shedBy?: string;
  /** brief speed-burst timer (s) after winning a route break / jam */
  burst: number;
  /** separation in yards to the nearest opponent (receivers; for the catch model) */
  sep: number;
  /** coverage cushion (yds): a DEFENDER's earned trail distance behind his man,
   *  set when the WR wins a route break and recovered slowly. Drives both the
   *  defender's position and the receiver's openness for the catch (GB-D005). */
  cushion: number;
  /** already used his one grab attempt on the current tipped ball */
  tipTried: boolean;
}

export interface BallState {
  /** ground position (px) */
  x: number;
  y: number;
  /** height above the ground (px); 0 when carried/grounded */
  z: number;
  /** id of carrier, or null while in flight / loose */
  carrier: string | null;
  inAir: boolean;
  /** flight progress 0..1 */
  t: number;
  elapsed: number;
  ftime: number;
  /** launch + landing ground points */
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  /** intended receiver id for an in-air pass */
  targetId: string | null;
  /** apex height added by the arc (px) */
  peak: number;
  /** true while the ball is a live loose ball after a tip — anyone can grab it */
  tip: boolean;
  /** one-shot latch: a line defender already got his single deflection attempt this throw */
  swatDone: boolean;
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
  /** touch-UI context flags */
  canHike: boolean;
  canThrow: boolean;
  canSwitch: boolean;
  /** a kick meter is awaiting a tap (power or accuracy stage) */
  kicking: boolean;
}
