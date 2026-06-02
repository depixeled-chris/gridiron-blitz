import { Application, Container, Graphics, Text } from "pixi.js";
import {
  BLOCK_R,
  CATCH_R,
  COLORS,
  ENDZONE,
  FIELD_YARDS,
  LEFT_GOAL,
  PASS_SPEED,
  PLAY_CLOCK,
  QUARTER_SECONDS,
  RIGHT_GOAL,
  SIDELINE,
  SPEED,
  TACKLE_R,
  TURBO,
  VIEW_H,
  VIEW_W,
  WORLD_H,
  WORLD_W,
  YARD,
} from "./constants";
import { Input } from "./input";
import { Sfx } from "./audio";
import { DEFENSE_PLAYS, OFFENSE_PLAYS } from "./plays";
import type {
  BallState,
  DefensePlay,
  HudState,
  OffensePlay,
  Phase,
  Player,
  Role,
  Team,
} from "./types";
import { clamp, dist, lerp, rng, steer } from "./utils";

interface FormSpot {
  slot: string;
  role: Role;
  fwd: number;
  lat: number;
  num: number;
  target?: string; // throw key shown above receiver
  assign?: string; // slot id a DB covers
}

// 11-man offense: 5 OL + FB block, QB, RB, 2 WR, TE. Route keys A/B/C/R map
// the four eligible receivers to throw buttons 1-4.
const OFF_FORM: FormSpot[] = [
  { slot: "QB", role: "QB", fwd: -3, lat: 0, num: 7 },
  { slot: "R", role: "RB", fwd: -3, lat: 3, num: 28, target: "4" },
  { slot: "LT", role: "OL", fwd: -0.5, lat: -3, num: 73 },
  { slot: "LG", role: "OL", fwd: -0.5, lat: -1.5, num: 66 },
  { slot: "CEN", role: "OL", fwd: -0.5, lat: 0, num: 55 },
  { slot: "RG", role: "OL", fwd: -0.5, lat: 1.5, num: 67 },
  { slot: "RT", role: "OL", fwd: -0.5, lat: 3, num: 76 },
  { slot: "F", role: "OL", fwd: -1.8, lat: -2, num: 44 }, // fullback / lead blocker
  { slot: "A", role: "WR", fwd: -0.5, lat: -10, num: 80, target: "1" },
  { slot: "B", role: "WR", fwd: -0.5, lat: 10, num: 88, target: "2" },
  { slot: "C", role: "TE", fwd: -0.5, lat: 5, num: 84, target: "3" },
];

// 11-man defense: 4-3 with 4 DBs. CBs/SS/FS take the eligible receivers in man.
const DEF_FORM: FormSpot[] = [
  { slot: "LE", role: "DL", fwd: 1, lat: -3.5, num: 91 },
  { slot: "DT", role: "DL", fwd: 1, lat: -1.2, num: 94 },
  { slot: "NT", role: "DL", fwd: 1, lat: 1.2, num: 98 },
  { slot: "RE", role: "DL", fwd: 1, lat: 3.5, num: 56 },
  { slot: "WLB", role: "LB", fwd: 4, lat: -6, num: 54 },
  { slot: "MLB", role: "LB", fwd: 4.5, lat: 0, num: 52 },
  { slot: "SLB", role: "LB", fwd: 4, lat: 6, num: 58 },
  { slot: "CB1", role: "DB", fwd: 6, lat: -10, num: 24, assign: "A" },
  { slot: "CB2", role: "DB", fwd: 6, lat: 10, num: 21, assign: "B" },
  { slot: "SS", role: "DB", fwd: 9, lat: 6, num: 33, assign: "C" },
  { slot: "FS", role: "DB", fwd: 12, lat: -3, num: 31, assign: "R" },
];

// zone landmarks per defensive slot (yards downfield from LOS, lateral from mid)
const ZONE: Record<string, { fwd: number; lat: number }> = {
  CB1: { fwd: 7, lat: -11 },
  CB2: { fwd: 7, lat: 11 },
  SS: { fwd: 13, lat: 7 },
  FS: { fwd: 16, lat: -5 },
  WLB: { fwd: 7, lat: -7 },
  MLB: { fwd: 9, lat: 0 },
  SLB: { fwd: 7, lat: 7 },
};

const TARGET_KEYS: Record<string, string> = {
  Digit1: "1",
  Digit2: "2",
  Digit3: "3",
  Digit4: "4",
};

interface Sprite {
  c: Container;
  body: Graphics;
  ring: Graphics;
  num: Text;
  label: Text;
}

export class Game {
  private app!: Application;
  private world = new Container();
  private fieldGfx = new Graphics();
  private overlay = new Graphics();
  private ballGfx = new Graphics();
  private sprites = new Map<string, Sprite>();

  private players: Player[] = [];
  private ball: BallState = freshBall();
  private input = new Input();
  private audio = new Sfx();

  // game state
  private phase: Phase = "menu";
  private possession: Team = "home";
  private down = 1;
  private toGo = 10;
  private los = 0; // absolute world X of line of scrimmage
  private firstDownX = 0;
  private quarter = 1;
  private clock = QUARTER_SECONDS;
  private playClock = PLAY_CLOCK;
  private score: Record<Team, number> = { home: 0, away: 0 };
  private message = "";
  private controlledId = "";
  private offPlay: OffensePlay = OFFENSE_PLAYS[0];
  private defPlay: DefensePlay = DEFENSE_PLAYS[0];
  private camX = 0;
  private host: HTMLElement | null = null;
  private viewW = VIEW_W;
  private viewH = VIEW_H;
  private worldScale = 1;
  private deadTimer = 0;
  private snapTimer = 0;
  private throwTimer = 0; // AI QB drop timer
  private switchCooldown = 0;
  private rushers = new Set<string>(); // defenders rushing the passer this play
  private lastHud = "";

  private hudCb: ((h: HudState) => void) | null = null;

  readonly userTeam: Team = "home";

  // ---- lifecycle ---------------------------------------------------------
  async mount(el: HTMLElement) {
    this.host = el;
    this.app = new Application();
    await this.app.init({
      width: el.clientWidth || VIEW_W,
      height: el.clientHeight || VIEW_H,
      background: 0x0a0a0a,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    el.appendChild(this.app.canvas);

    this.world.addChild(this.fieldGfx, this.overlay);
    this.app.stage.addChild(this.world);
    this.world.addChild(this.ballGfx);
    this.drawField();
    this.layout();
    this.input.attach();

    window.addEventListener("resize", this.onResize);
    window.addEventListener("orientationchange", this.onResize);
    this.app.ticker.add((t) => this.update(t.deltaMS / 1000));
  }

  /** size the renderer to the host element and scale the field to fill it */
  private onResize = () => {
    if (!this.app || !this.host) return;
    const w = this.host.clientWidth || VIEW_W;
    const h = this.host.clientHeight || VIEW_H;
    this.app.renderer.resize(w, h);
    this.layout();
  };

  private layout() {
    this.viewW = this.app.screen.width;
    this.viewH = this.app.screen.height;
    // fit the full field height to the screen, then scroll horizontally
    this.worldScale = clamp(this.viewH / WORLD_H, 0.5, 1.6);
    this.world.scale.set(this.worldScale);
    const span = WORLD_H * this.worldScale;
    this.world.y = Math.max(0, (this.viewH - span) / 2);
  }

  destroy() {
    this.input.detach();
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("orientationchange", this.onResize);
    this.app?.destroy(true, { children: true });
    this.sprites.clear();
  }

  subscribe(cb: (h: HudState) => void) {
    this.hudCb = cb;
  }

  // ---- public controls (from React) -------------------------------------
  setMuted(m: boolean) {
    this.audio.muted = m;
  }

  startGame() {
    this.audio.resume();
    this.audio.select();
    this.score = { home: 0, away: 0 };
    this.quarter = 1;
    this.clock = QUARTER_SECONDS;
    this.possession = "home";
    this.setNewSeries(LEFT_GOAL + 20 * YARD);
    this.message = "1ST & 10";
    this.goToPlaycall();
  }

  /** React calls this when the user picks a play card */
  choosePlay(id: string) {
    if (this.phase !== "playcall") return;
    this.audio.resume();
    this.audio.select();
    if (this.userOnOffense()) {
      this.offPlay = OFFENSE_PLAYS.find((p) => p.id === id) ?? OFFENSE_PLAYS[0];
      this.defPlay = pick(DEFENSE_PLAYS);
    } else {
      this.defPlay = DEFENSE_PLAYS.find((p) => p.id === id) ?? DEFENSE_PLAYS[0];
      this.offPlay = pick(OFFENSE_PLAYS);
    }
    this.setupFormation();
    this.phase = "presnap";
    this.snapTimer = this.userOnOffense() ? 1.5 : 0.6 + rng() * 0.5;
    this.message = "";
    this.pushHud(true);
  }

  userOnOffense() {
    return this.possession === this.userTeam;
  }

  /** dev/debug snapshot of all players (used by smoke tests) */
  debugPlayers() {
    return this.players.map((p) => ({
      id: p.id,
      team: p.team,
      role: p.role,
      x: p.x,
      y: p.y,
    }));
  }
  debugPhase() {
    return this.phase;
  }

  // ---- touch input bridge (called from React on-screen controls) --------
  stick(x: number, y: number) {
    this.input.setStick(x, y);
  }
  setTurbo(on: boolean) {
    this.input.setTurbo(on);
  }
  tap(code: string) {
    this.input.virtualPress(code);
  }

  availablePlays() {
    return this.userOnOffense() ? OFFENSE_PLAYS : DEFENSE_PLAYS;
  }

  // ---- series / down management -----------------------------------------
  private setNewSeries(ballX: number) {
    this.los = clamp(ballX, LEFT_GOAL, RIGHT_GOAL);
    this.down = 1;
    this.toGo = 10;
    this.recomputeFirstDown();
  }

  private recomputeFirstDown() {
    const dir = this.offDir();
    const goal = dir > 0 ? RIGHT_GOAL : LEFT_GOAL;
    let fd = this.los + dir * this.toGo * YARD;
    if (dir > 0) fd = Math.min(fd, goal);
    else fd = Math.max(fd, goal);
    this.firstDownX = fd;
  }

  private offDir() {
    return this.possession === "home" ? 1 : -1;
  }

  private goToPlaycall() {
    this.phase = "playcall";
    this.ball = freshBall();
    this.playClock = PLAY_CLOCK;
    this.pushHud(true);
  }

  // ---- formation & snap --------------------------------------------------
  private setupFormation() {
    this.players = [];
    this.sprites.forEach((s) => s.c.destroy());
    this.sprites.clear();

    const dir = this.offDir();
    const offTeam: Team = this.possession;
    const defTeam: Team = offTeam === "home" ? "away" : "home";
    const midY = WORLD_H / 2;

    const idOf = (team: Team, slot: string) => `${team}_${slot}`;

    for (const f of OFF_FORM) {
      const p: Player = basePlayer(idOf(offTeam, f.slot), offTeam, f);
      p.ox = clamp(this.los + dir * f.fwd * YARD, LEFT_GOAL - 40, RIGHT_GOAL + 40);
      p.oy = clamp(midY + f.lat * YARD, SIDELINE, WORLD_H - SIDELINE);
      p.x = p.ox;
      p.y = p.oy;
      p.target = f.target;
      this.players.push(p);
    }
    for (const f of DEF_FORM) {
      const p: Player = basePlayer(idOf(defTeam, f.slot), defTeam, f);
      p.ox = clamp(this.los + dir * f.fwd * YARD, LEFT_GOAL - 40, RIGHT_GOAL + 40);
      p.oy = clamp(midY + f.lat * YARD, SIDELINE, WORLD_H - SIDELINE);
      p.x = p.ox;
      p.y = p.oy;
      if (f.assign) p.assignId = idOf(offTeam, f.assign);
      if (ZONE[f.slot]) p.zone = ZONE[f.slot];
      this.players.push(p);
    }

    // resolve routes for offensive skill slots
    for (const f of OFF_FORM) {
      const route = this.offPlay.routes[f.slot];
      if (!route) continue;
      const p = this.byId(idOf(offTeam, f.slot))!;
      p.route = route.map((n) => ({
        x: p.ox + dir * n.fwd * YARD,
        y: clamp(p.oy + n.lat * YARD, SIDELINE, WORLD_H - SIDELINE),
      }));
      p.routeIdx = 0;
    }

    // build sprites
    for (const p of this.players) this.makeSprite(p);

    // initial control: user controls QB (or runner) on offense, a LB on defense
    if (this.userOnOffense()) {
      this.controlledId = idOf(offTeam, "QB");
    } else {
      this.controlledId = idOf(defTeam, "MLB");
    }
    this.setControlFlags();

    // decide the pass rush once per play (DL always rush; LBs per blitz rate)
    this.rushers.clear();
    for (const p of this.players) {
      if (p.team !== defTeam) continue;
      if (p.role === "DL") this.rushers.add(p.id);
      else if (p.role === "LB" && rng() < this.defPlay.blitz) this.rushers.add(p.id);
    }
    // all-out blitz: send a safety too
    if (this.defPlay.blitz >= 1) {
      const ss = this.byId(idOf(defTeam, "SS"));
      if (ss) this.rushers.add(ss.id);
    }
  }

  private snap() {
    this.phase = "live";
    this.audio.snap();
    this.throwTimer = 0;
    const offTeam = this.possession;
    const ball = this.ball;
    if (this.offPlay.kind === "run") {
      const runnerSlot = this.offPlay.runner === "QB" ? "QB" : "R";
      const runner = this.byId(`${offTeam}_${runnerSlot}`)!;
      runner.hasBall = true;
      ball.carrier = runner.id;
      if (this.userOnOffense()) this.controlledId = runner.id;
    } else {
      const qb = this.byId(`${offTeam}_QB`)!;
      qb.hasBall = true;
      ball.carrier = qb.id;
      if (this.userOnOffense()) this.controlledId = qb.id;
    }
    this.setControlFlags();
    this.message = "";
  }

  // ---- main loop ---------------------------------------------------------
  private update(dt: number) {
    dt = Math.min(dt, 1 / 30); // clamp huge frames
    if (this.phase === "presnap") {
      this.snapTimer -= dt;
      this.playClock = Math.max(0, this.playClock - dt);
      // user can hike early on offense
      if (this.userOnOffense() && this.input.pressed("Space")) this.snapTimer = 0;
      if (this.snapTimer <= 0) this.snap();
    } else if (this.phase === "live") {
      this.stepLive(dt);
    } else if (this.phase === "dead") {
      this.deadTimer -= dt;
      if (this.deadTimer <= 0) this.afterPlay();
    }

    this.updateCamera(dt);
    this.render();
    this.input.flush();
    this.pushHud(false);
  }

  private stepLive(dt: number) {
    // clock
    this.clock -= dt;
    if (this.clock <= 0) {
      this.clock = 0;
      this.endQuarterCheck();
    }

    this.throwTimer += dt;
    if (this.switchCooldown > 0) this.switchCooldown -= dt;

    // reset per-frame block flags
    for (const p of this.players) p.blocked = false;

    this.updateBlocking();
    this.updateOffense(dt);
    this.updateDefense(dt);
    this.updateBall(dt);
    this.integrate(dt);
    this.separate();
    this.clampPositions();
    this.checkTackleAndScore();
  }

  private clampPositions() {
    for (const p of this.players) {
      p.x = clamp(p.x, 6, WORLD_W - 6);
      p.y = clamp(p.y, SIDELINE, WORLD_H - SIDELINE);
    }
  }

  // ---- offense AI / control ---------------------------------------------
  private updateOffense(dt: number) {
    const offTeam = this.possession;
    const carrier = this.carrier();
    for (const p of this.players) {
      if (p.team !== offTeam) continue;
      if (p.role === "OL") continue; // handled in blocking

      const isCarrier = carrier?.id === p.id;
      if (p.id === this.controlledId && this.userOnOffense()) {
        this.applyUserMove(p, dt);
        continue;
      }

      if (isCarrier) {
        // AI ball carrier runs to the goal, dodging defenders
        this.runToGoal(p, dt);
        continue;
      }

      // QB AI on a pass play: drop back, then throw
      if (p.role === "QB" && this.ball.carrier === p.id && !this.userOnOffense()) {
        this.aiQuarterback(p, dt);
        continue;
      }

      // receivers run their routes
      if (p.route && p.routeIdx < p.route.length) {
        this.followRoute(p, dt);
      } else if (p.route) {
        // route finished — drift downfield slowly to stay alive
        const dir = this.offDir();
        this.moveToward(p, p.x + dir * YARD, p.y, dt, 0.55);
      }
    }
  }

  private aiQuarterback(p: Player, dt: number) {
    const dir = this.offDir();
    const dropDepth = 4 * YARD;
    const dropX = p.ox - dir * dropDepth;
    if (dir > 0 ? p.x > dropX : p.x < dropX) {
      this.moveToward(p, dropX, p.y, dt, 0.85);
    } else {
      p.vx = 0;
      p.vy = 0;
    }
    // pressure check — scramble if a defender is close
    const rush = this.nearestOpp(p);
    const pressured = rush && dist(p.x, p.y, rush.x, rush.y) < 2.4 * YARD;
    if (this.throwTimer > 1.1 || pressured) {
      const tgt = this.bestReceiver();
      if (tgt) this.throwTo(tgt.id);
    }
  }

  private followRoute(p: Player, dt: number) {
    const wp = p.route![p.routeIdx];
    const sp = this.pps(p) / YARD;
    this.moveToward(p, wp.x, wp.y, dt, 1);
    if (dist(p.x, p.y, wp.x, wp.y) < 0.5 * YARD) p.routeIdx++;
    void sp;
  }

  private runToGoal(p: Player, dt: number) {
    const dir = this.offDir();
    const goalX = dir > 0 ? RIGHT_GOAL + ENDZONE * YARD : LEFT_GOAL - ENDZONE * YARD;
    let tx = goalX;
    let ty = p.y;
    // avoid nearest defenders
    let ax = 0;
    let ay = 0;
    for (const d of this.players) {
      if (d.team === p.team) continue;
      const dd = dist(p.x, p.y, d.x, d.y);
      if (dd < 4.5 * YARD && dd > 1) {
        const w = (4.5 * YARD - dd) / (4.5 * YARD);
        ax += ((p.x - d.x) / dd) * w;
        ay += ((p.y - d.y) / dd) * w;
      }
    }
    ty = clamp(p.y + ay * 4 * YARD, SIDELINE, WORLD_H - SIDELINE);
    tx = p.x + dir * 3 * YARD + ax * 1.2 * YARD;
    this.moveToward(p, tx, ty, dt, 1);
  }

  // ---- defense AI / control ---------------------------------------------
  private updateDefense(dt: number) {
    const defTeam: Team = this.possession === "home" ? "away" : "home";
    const carrier = this.carrier();
    const qbHasBall =
      carrier && carrier.role === "QB" && this.offPlay.kind === "pass";

    // user switches controlled defender
    if (!this.userOnOffense()) {
      if (this.input.pressed("Space") && this.switchCooldown <= 0) {
        this.switchDefender();
        this.switchCooldown = 0.25;
      }
    }

    const target = this.ball.inAir
      ? { x: this.ball.tx, y: this.ball.ty }
      : carrier
        ? { x: carrier.x, y: carrier.y }
        : { x: this.los, y: WORLD_H / 2 };

    for (const p of this.players) {
      if (p.team !== defTeam) continue;
      if (p.id === this.controlledId && !this.userOnOffense()) {
        this.applyUserMove(p, dt);
        continue;
      }

      const rushing = this.rushers.has(p.id);

      if (qbHasBall && !this.ball.inAir) {
        if (rushing) {
          const to = this.intercept(p, carrier!);
          this.moveToward(p, to.x, to.y, dt, p.blocked ? 0.45 : 1);
        } else if (this.defPlay.coverage === "man") {
          this.coverMan(p, dt);
        } else {
          this.coverZone(p, dt);
        }
      } else if (this.ball.inAir) {
        // break on the ball
        this.moveToward(p, this.ball.tx, this.ball.ty, dt, 1);
      } else if (carrier) {
        // ball is being carried (run, scramble, or after the catch): pursue
        const to = this.intercept(p, carrier);
        this.moveToward(p, to.x, to.y, dt, p.blocked ? 0.5 : 1);
      } else {
        this.moveToward(p, target.x, target.y, dt, 0.9);
      }
    }
  }

  /** aim where the carrier WILL be, given pursuer speed (pure-pursuit lead) */
  private intercept(p: Player, c: Player) {
    const sp = Math.max(this.pps(p), 1);
    let t = dist(p.x, p.y, c.x, c.y) / sp;
    for (let i = 0; i < 3; i++) {
      const px = c.x + c.vx * t;
      const py = c.y + c.vy * t;
      t = dist(p.x, p.y, px, py) / sp;
    }
    t = Math.min(t, 0.9);
    return { x: c.x + c.vx * t, y: c.y + c.vy * t };
  }

  private eligibleReceivers(): Player[] {
    const offTeam = this.possession;
    return this.players.filter((q) => q.team === offTeam && !!q.target);
  }

  private coverMan(p: Player, dt: number) {
    const cover = p.assignId ? this.byId(p.assignId) : null;
    const carrier = this.carrier();
    if (!cover) {
      // unassigned defender (a non-rushing LB) robs the short middle
      if (carrier) this.moveToward(p, carrier.x, carrier.y, dt, 0.7);
      return;
    }
    const dir = this.offDir();
    const press = this.defPlay.press ?? 0.6;
    const cushion = lerp(2.4, 0.4, press); // yards on the goal side of the WR
    const aim = this.intercept(p, cover);
    this.moveToward(p, aim.x + dir * cushion * YARD, aim.y, dt, 0.99);
  }

  private coverZone(p: Player, dt: number) {
    const lm = p.zone;
    const carrier = this.carrier();
    if (!lm) {
      if (carrier) this.moveToward(p, carrier.x, carrier.y, dt, 0.7);
      return;
    }
    const dir = this.offDir();
    const zx = this.los + dir * lm.fwd * YARD;
    const zy = clamp(WORLD_H / 2 + lm.lat * YARD, SIDELINE, WORLD_H - SIDELINE);
    // jump the nearest receiver threatening this zone
    let tgt: Player | null = null;
    let bd = 4.8 * YARD;
    for (const r of this.eligibleReceivers()) {
      const d = dist(zx, zy, r.x, r.y);
      if (d < bd) {
        bd = d;
        tgt = r;
      }
    }
    if (tgt) {
      const aim = this.intercept(p, tgt);
      this.moveToward(p, aim.x, aim.y, dt, 0.99);
    } else {
      this.moveToward(p, zx, zy, dt, 0.9);
    }
  }

  /** push apart same-team players so they fan out instead of stacking */
  private separate() {
    const MIN = 1.3 * YARD;
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i];
        const b = ps[j];
        if (a.team !== b.team) continue;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d = Math.hypot(dx, dy);
        if (d >= MIN) continue;
        if (d < 1e-3) {
          dx = (i % 2 ? 1 : -1) * 0.5;
          dy = 0.5;
          d = Math.hypot(dx, dy);
        }
        const push = (MIN - d) / 2;
        const nx = (dx / d) * push;
        const ny = (dy / d) * push;
        // don't shove the ball carrier or the user's player — others go around
        const aLock = a.id === this.ball.carrier || (a.controlled && this.userOnOffense());
        const bLock = b.id === this.ball.carrier || (b.controlled && this.userOnOffense());
        if (!aLock) {
          a.x += nx;
          a.y += ny;
        }
        if (!bLock) {
          b.x -= nx;
          b.y -= ny;
        }
      }
    }
  }

  private switchDefender() {
    const defTeam: Team = this.possession === "home" ? "away" : "home";
    const ref = this.ball.inAir
      ? { x: this.ball.tx, y: this.ball.ty }
      : this.carrier() ?? { x: this.los, y: WORLD_H / 2 };
    let best: Player | null = null;
    let bd = Infinity;
    for (const p of this.players) {
      if (p.team !== defTeam) continue;
      if (p.id === this.controlledId) continue;
      const d = dist(p.x, p.y, ref.x, ref.y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best) {
      this.controlledId = best.id;
      this.setControlFlags();
    }
  }

  // ---- blocking ----------------------------------------------------------
  private updateBlocking() {
    const offTeam = this.possession;
    const blockers = this.players.filter(
      (p) => p.team === offTeam && p.role === "OL"
    );
    const rushers = this.players.filter(
      (p) => p.team !== offTeam && (p.role === "DL" || p.role === "LB")
    );
    for (const ol of blockers) {
      // find nearest rusher threatening the backfield
      let tgt: Player | null = null;
      let bd = Infinity;
      for (const r of rushers) {
        const d = dist(ol.x, ol.y, r.x, r.y);
        if (d < bd) {
          bd = d;
          tgt = r;
        }
      }
      if (tgt && bd < 6 * YARD) {
        this.moveTowardRaw(ol, tgt.x, tgt.y, 1);
        if (bd < BLOCK_R) {
          tgt.blocked = true;
          // shove the defender back a touch
          const dir = this.offDir();
          tgt.x += dir * 0.4;
        }
      } else {
        ol.vx = 0;
        ol.vy = 0;
      }
    }
  }

  // ---- passing -----------------------------------------------------------
  private bestReceiver(): Player | null {
    const offTeam = this.possession;
    let best: Player | null = null;
    let bestOpen = -Infinity;
    for (const p of this.players) {
      if (p.team !== offTeam || !p.target) continue;
      // openness = distance to nearest defender
      let nd = Infinity;
      for (const d of this.players) {
        if (d.team === offTeam) continue;
        nd = Math.min(nd, dist(p.x, p.y, d.x, d.y));
      }
      // prefer receivers that are downfield
      const dir = this.offDir();
      const downfield = dir * (p.x - this.los);
      const score = nd + downfield * 0.25;
      if (score > bestOpen) {
        bestOpen = score;
        best = p;
      }
    }
    return best;
  }

  private throwTo(receiverId: string) {
    const qb = this.carrier();
    if (!qb) return;
    const r = this.byId(receiverId);
    if (!r) return;
    const b = this.ball;
    qb.hasBall = false;
    b.carrier = null;
    b.inAir = true;
    b.targetId = receiverId;
    b.sx = qb.x;
    b.sy = qb.y - 14;
    b.x = b.sx;
    b.y = b.sy;
    b.tx = r.x;
    b.ty = r.y;
    b.arc = clamp(dist(qb.x, qb.y, r.x, r.y) * 0.12, 16, 60);
    b.t = 0;
    this.message = "";
    this.audio.throw();
  }

  // ---- ball update -------------------------------------------------------
  private updateBall(dt: number) {
    const b = this.ball;
    if (!b.inAir) {
      const c = this.carrier();
      if (c) {
        b.x = c.x;
        b.y = c.y - 10;
      }
      return;
    }
    // homing flight toward the receiver's live position
    const r = b.targetId ? this.byId(b.targetId) : null;
    if (r) {
      b.tx = r.x;
      b.ty = r.y;
    }
    const total = Math.max(1, dist(b.sx, b.sy, b.tx, b.ty));
    const step = PASS_SPEED * dt;
    const d = dist(b.x, b.y, b.tx, b.ty);
    b.t = clamp(1 - d / total, 0, 1);
    if (d <= step) {
      b.x = b.tx;
      b.y = b.ty;
      this.resolvePass();
      return;
    }
    const s = steer(b.x, b.y, b.tx, b.ty, step);
    b.x += s.vx;
    b.y += s.vy;

    // defender deflection / interception in flight
    const offTeam = this.possession;
    for (const p of this.players) {
      if (p.team === offTeam) continue;
      if (dist(p.x, p.y, b.x, b.y) < CATCH_R * 0.8) {
        if (rng() < 0.4) {
          this.interception(p);
        } else {
          this.incomplete();
        }
        return;
      }
    }
  }

  private resolvePass() {
    const b = this.ball;
    const r = b.targetId ? this.byId(b.targetId) : null;
    if (!r) return this.incomplete();
    // contested by a defender within catch radius?
    const offTeam = this.possession;
    let closestDef: Player | null = null;
    let cd = Infinity;
    for (const p of this.players) {
      if (p.team === offTeam) continue;
      const d = dist(p.x, p.y, b.x, b.y);
      if (d < cd) {
        cd = d;
        closestDef = p;
      }
    }
    const recDist = dist(r.x, r.y, b.x, b.y);
    if (recDist > CATCH_R * 1.4) return this.incomplete();
    if (closestDef && cd < recDist && cd < CATCH_R) {
      if (rng() < 0.45) return this.interception(closestDef);
      return this.incomplete();
    }
    // completion!
    b.inAir = false;
    b.targetId = null;
    r.hasBall = true;
    b.carrier = r.id;
    if (this.userOnOffense()) {
      this.controlledId = r.id;
      this.setControlFlags();
    }
    this.message = "CAUGHT!";
    this.audio.catchBall();
  }

  private incomplete() {
    this.ball.inAir = false;
    this.ball.targetId = null;
    this.endPlay({ type: "incomplete" });
  }

  private interception(by: Player) {
    this.ball.inAir = false;
    this.ball.targetId = null;
    this.message = "INTERCEPTED!";
    this.audio.turnover();
    this.endPlay({ type: "turnover", spotX: by.x, by });
  }

  // ---- integration + collisions -----------------------------------------
  private integrate(dt: number) {
    for (const p of this.players) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.x = clamp(p.x, 6, WORLD_W - 6);
      p.y = clamp(p.y, SIDELINE, WORLD_H - SIDELINE);
    }
  }

  private checkTackleAndScore() {
    const c = this.carrier();
    if (!c) return;
    const dir = this.offDir();
    const attackGoal = dir > 0 ? RIGHT_GOAL : LEFT_GOAL;
    const ownGoal = dir > 0 ? LEFT_GOAL : RIGHT_GOAL;

    // touchdown
    if (dir > 0 ? c.x >= attackGoal : c.x <= attackGoal) {
      this.touchdown();
      return;
    }
    // safety (tackled in own end zone) — checked via tackle below

    // tackle on contact with any defender
    for (const p of this.players) {
      if (p.team === c.team) continue;
      if (dist(p.x, p.y, c.x, c.y) < TACKLE_R) {
        // small break-tackle chance when the user is sprinting
        if (
          c.id === this.controlledId &&
          this.userOnOffense() &&
          this.input.turbo() &&
          rng() < 0.12
        ) {
          p.x -= (p.x - c.x) * 0.5;
          p.y -= (p.y - c.y) * 0.5;
          continue;
        }
        // safety?
        if (dir > 0 ? c.x <= ownGoal : c.x >= ownGoal) {
          this.safety();
          return;
        }
        this.audio.tackle();
        this.endPlay({ type: "tackle", spotX: c.x, spotY: c.y });
        return;
      }
    }
  }

  // ---- movement helpers --------------------------------------------------
  private pps(p: Player) {
    return SPEED[p.role] * YARD;
  }

  private applyUserMove(p: Player, _dt: number) {
    const a = this.input.axis();
    const sp = this.pps(p) * (this.input.turbo() ? TURBO : 1);
    const m = Math.hypot(a.x, a.y) || 1;
    p.vx = (a.x / m) * sp * Math.min(1, Math.hypot(a.x, a.y));
    p.vy = (a.y / m) * sp * Math.min(1, Math.hypot(a.x, a.y));

    // user throws while at QB on a pass play
    if (
      this.userOnOffense() &&
      this.ball.carrier === p.id &&
      this.offPlay.kind === "pass"
    ) {
      for (const code in TARGET_KEYS) {
        if (this.input.pressed(code)) {
          const key = TARGET_KEYS[code];
          const r = this.players.find(
            (q) => q.team === p.team && q.target === key
          );
          if (r) this.throwTo(r.id);
        }
      }
      if (this.input.pressed("KeyJ")) {
        const r = this.bestReceiver();
        if (r) this.throwTo(r.id);
      }
    }
  }

  private moveToward(
    p: Player,
    tx: number,
    ty: number,
    _dt: number,
    speedMul: number
  ) {
    const sp = this.pps(p) * speedMul;
    const s = steer(p.x, p.y, tx, ty, sp);
    p.vx = s.vx;
    p.vy = s.vy;
  }

  private moveTowardRaw(p: Player, tx: number, ty: number, speedMul: number) {
    this.moveToward(p, tx, ty, 0, speedMul);
  }

  // ---- play resolution ---------------------------------------------------
  private endPlay(res: {
    type: "tackle" | "incomplete" | "turnover";
    spotX?: number;
    spotY?: number;
    by?: Player;
  }) {
    if (this.phase !== "live") return;
    this.phase = "dead";
    this.deadTimer = 1.4;
    this.audio.whistle();
    const dir = this.offDir();

    if (res.type === "turnover") {
      // interception: other team takes over at the spot, attacking the other way
      const spot = clamp(res.spotX ?? this.los, LEFT_GOAL, RIGHT_GOAL);
      this.flipPossession(spot);
      this.message = "TURNOVER!";
      return;
    }

    let spot: number;
    if (res.type === "incomplete") {
      spot = this.los; // no gain
      this.message = "INCOMPLETE";
    } else {
      spot = clamp(res.spotX ?? this.los, LEFT_GOAL, RIGHT_GOAL);
    }

    const gained = dir * (spot - this.los);
    const gainYds = Math.round(gained / YARD);
    this.los = spot;

    // first down?
    const reached = dir > 0 ? spot >= this.firstDownX : spot <= this.firstDownX;
    if (reached) {
      this.down = 1;
      this.toGo = 10;
      this.recomputeFirstDown();
      if (res.type !== "incomplete") {
        this.message = `+${gainYds} • FIRST DOWN`;
        this.audio.firstDown();
      }
    } else {
      this.down++;
      this.toGo = Math.max(
        1,
        Math.round((dir * (this.firstDownX - this.los)) / YARD)
      );
      if (this.down > 4) {
        this.message = "TURNOVER ON DOWNS";
        this.flipPossession(spot);
        return;
      }
      if (res.type !== "incomplete" && gainYds !== 0)
        this.message = `${gainYds >= 0 ? "+" : ""}${gainYds} YDS`;
    }
  }

  private flipPossession(spotX: number) {
    this.possession = this.possession === "home" ? "away" : "home";
    this.setNewSeries(spotX);
  }

  private touchdown() {
    this.phase = "dead";
    this.deadTimer = 2.0;
    this.score[this.possession] += 7;
    this.message = "TOUCHDOWN!";
    this.audio.whistle();
    this.audio.touchdown();
    this.pendingKickoff = true;
  }

  private safety() {
    this.phase = "dead";
    this.deadTimer = 2.0;
    const def: Team = this.possession === "home" ? "away" : "home";
    this.score[def] += 2;
    this.message = "SAFETY!";
    this.audio.whistle();
    this.audio.turnover();
    this.pendingKickoff = true;
    // after a safety, the team that conceded kicks; possession flips
    this.possession = def;
  }

  private pendingKickoff = false;

  private afterPlay() {
    if (this.quarter > 4) {
      this.phase = "gameover";
      this.pushHud(true);
      return;
    }
    if (this.pendingKickoff) {
      this.pendingKickoff = false;
      // simple "kickoff": receiving team starts at own 25
      const recTeam =
        this.message === "SAFETY!" ? this.possession : this.flipForKick();
      void recTeam;
      const dir = this.possession === "home" ? 1 : -1;
      const ownGoal = dir > 0 ? LEFT_GOAL : RIGHT_GOAL;
      this.setNewSeries(ownGoal + dir * 25 * YARD);
    }
    this.message =
      this.down === 1
        ? "1ST & 10"
        : `${ord(this.down)} & ${this.toGo === 0 ? "GOAL" : this.toGo}`;
    this.goToPlaycall();
  }

  private flipForKick(): Team {
    // after a touchdown the scoring team kicks off; receiver gets the ball
    this.possession = this.possession === "home" ? "away" : "home";
    return this.possession;
  }

  private endQuarterCheck() {
    this.quarter++;
    if (this.quarter > 4) {
      this.message = "FINAL";
      // let current play finish; gameover handled in afterPlay
    } else {
      this.clock = QUARTER_SECONDS;
      this.message = `END OF Q${this.quarter - 1}`;
    }
  }

  // ---- camera & render ---------------------------------------------------
  private updateCamera(dt: number) {
    const focus = this.carrier()?.x ?? (this.ball.inAir ? this.ball.x : this.los);
    const s = this.worldScale;
    const span = WORLD_W * s;
    // world.x is the screen-space offset of the (scaled) world container
    let tgt: number;
    if (span <= this.viewW) {
      tgt = (this.viewW - span) / 2; // whole field fits: center it
    } else {
      tgt = clamp(this.viewW / 2 - focus * s, this.viewW - span, 0);
    }
    this.camX = lerp(this.camX, tgt, Math.min(1, dt * 6));
    this.world.x = this.camX;
  }

  private render() {
    this.drawOverlay();
    // players
    for (const p of this.players) {
      const s = this.sprites.get(p.id);
      if (!s) continue;
      s.c.x = p.x;
      s.c.y = p.y;
      s.ring.visible = p.id === this.controlledId && this.phase !== "playcall";
      const showLabel =
        this.phase === "live" &&
        this.userOnOffense() &&
        this.offPlay.kind === "pass" &&
        this.ball.carrier?.endsWith("_QB") === true &&
        !!p.target;
      s.label.visible = !!showLabel;
      if (showLabel) s.label.text = p.target!;
    }
    // ball
    this.drawBall();
  }

  private drawBall() {
    const g = this.ballGfx;
    g.clear();
    const b = this.ball;
    let y = b.y;
    if (b.inAir) {
      const lift = Math.sin(b.t * Math.PI) * b.arc;
      y = b.y - lift;
    }
    g.ellipse(b.x, y, 6, 4).fill(COLORS.ball);
    g.ellipse(b.x, y, 6, 4).stroke({ width: 1, color: 0xffffff, alpha: 0.5 });
  }

  // ---- HUD bridge --------------------------------------------------------
  private pushHud(force: boolean) {
    if (!this.hudCb) return;
    const h = this.hudState();
    const key = JSON.stringify(h);
    if (!force && key === this.lastHud) return;
    this.lastHud = key;
    this.hudCb(h);
  }

  private hudState(): HudState {
    return {
      phase: this.phase,
      quarter: this.quarter,
      clock: Math.ceil(this.clock),
      home: this.score.home,
      away: this.score.away,
      possession: this.possession,
      down: this.down,
      toGo: this.toGo,
      ballOn: this.ballOnText(),
      message: this.message,
      playClock: Math.ceil(this.playClock),
      userOnOffense: this.userOnOffense(),
      canHike: this.phase === "presnap" && this.userOnOffense(),
      canThrow:
        this.phase === "live" &&
        this.userOnOffense() &&
        this.offPlay.kind === "pass" &&
        this.ball.carrier?.endsWith("_QB") === true,
      canSwitch: this.phase === "live" && !this.userOnOffense(),
    };
  }

  private ballOnText() {
    // yard line 0..50..0
    const fromLeft = (this.los - LEFT_GOAL) / YARD; // 0..100
    const yl = fromLeft <= 50 ? fromLeft : 100 - fromLeft;
    const side =
      fromLeft <= 50
        ? this.possession === "home"
          ? "OWN"
          : "OPP"
        : this.possession === "home"
          ? "OPP"
          : "OWN";
    return `${side} ${Math.round(yl)}`;
  }

  // ---- sprite construction ----------------------------------------------
  private makeSprite(p: Player) {
    const c = new Container();
    const shadow = new Graphics();
    shadow.ellipse(0, 8, 11, 5).fill({ color: 0x000000, alpha: 0.25 });
    const body = new Graphics();
    const ring = new Graphics();
    ring
      .circle(0, 0, 14)
      .stroke({ width: 2.5, color: COLORS.highlight, alpha: 0.95 });
    ring.visible = false;

    const isHome = p.team === "home";
    const fill = isHome ? COLORS.home : COLORS.away;
    const dark = isHome ? COLORS.homeDark : COLORS.awayDark;
    body.circle(0, 0, 11).fill(fill);
    body.circle(0, 0, 11).stroke({ width: 2, color: dark });
    // little helmet stripe
    body.rect(-2, -11, 4, 6).fill(dark);

    const num = new Text({
      text: String(p.number),
      style: { fontFamily: "monospace", fontSize: 10, fill: 0xffffff, fontWeight: "bold" },
    });
    num.anchor.set(0.5);
    num.y = 1;

    const label = new Text({
      text: p.target ?? "",
      style: {
        fontFamily: "monospace",
        fontSize: 13,
        fill: COLORS.highlight,
        fontWeight: "bold",
        stroke: { color: 0x000000, width: 3 },
      },
    });
    label.anchor.set(0.5);
    label.y = -22;
    label.visible = false;

    c.addChild(shadow, ring, body, num, label);
    c.x = p.x;
    c.y = p.y;
    this.world.addChild(c);
    this.sprites.set(p.id, { c, body, ring, num, label });
  }

  // ---- field & overlay drawing ------------------------------------------
  private drawField() {
    const g = this.fieldGfx;
    g.clear();
    // base turf with alternating 5-yard bands
    for (let i = 0; i < FIELD_YARDS / 5; i++) {
      const x = LEFT_GOAL + i * 5 * YARD;
      g.rect(x, 0, 5 * YARD, WORLD_H).fill(
        i % 2 === 0 ? COLORS.fieldDark : COLORS.fieldLight
      );
    }
    // end zones
    g.rect(0, 0, ENDZONE * YARD, WORLD_H).fill(COLORS.endzoneAway);
    g.rect(RIGHT_GOAL, 0, ENDZONE * YARD, WORLD_H).fill(COLORS.endzoneHome);

    // yard lines every 5 yards
    for (let y = 0; y <= FIELD_YARDS; y += 5) {
      const x = LEFT_GOAL + y * YARD;
      g.moveTo(x, 0)
        .lineTo(x, WORLD_H)
        .stroke({ width: y % 10 === 0 ? 2 : 1, color: COLORS.line, alpha: 0.8 });
    }
    // goal lines bold
    for (const x of [LEFT_GOAL, RIGHT_GOAL]) {
      g.moveTo(x, 0).lineTo(x, WORLD_H).stroke({ width: 4, color: COLORS.line });
    }
    // sidelines
    g.rect(0, 0, WORLD_W, 3).fill(COLORS.line);
    g.rect(0, WORLD_H - 3, WORLD_W, 3).fill(COLORS.line);

    // hash marks
    for (let y = 1; y < FIELD_YARDS; y++) {
      const x = LEFT_GOAL + y * YARD;
      g.rect(x - 1, WORLD_H * 0.36, 2, 6).fill({ color: COLORS.line, alpha: 0.5 });
      g.rect(x - 1, WORLD_H * 0.64 - 6, 2, 6).fill({
        color: COLORS.line,
        alpha: 0.5,
      });
    }
  }

  private drawOverlay() {
    const g = this.overlay;
    g.clear();
    if (this.phase === "menu" || this.phase === "gameover") return;
    // line of scrimmage (blue) and first down (yellow)
    g.moveTo(this.los, 0)
      .lineTo(this.los, WORLD_H)
      .stroke({ width: 2, color: 0x3aa0ff, alpha: 0.9 });
    if (
      this.firstDownX > LEFT_GOAL &&
      this.firstDownX < RIGHT_GOAL
    ) {
      g.moveTo(this.firstDownX, 0)
        .lineTo(this.firstDownX, WORLD_H)
        .stroke({ width: 2, color: COLORS.highlight, alpha: 0.9 });
    }
  }

  // ---- small helpers -----------------------------------------------------
  private byId(id: string) {
    return this.players.find((p) => p.id === id) ?? null;
  }
  private carrier(): Player | null {
    return this.ball.carrier ? this.byId(this.ball.carrier) : null;
  }
  private nearestOpp(p: Player): Player | null {
    let best: Player | null = null;
    let bd = Infinity;
    for (const q of this.players) {
      if (q.team === p.team) continue;
      const d = dist(p.x, p.y, q.x, q.y);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    return best;
  }
  private setControlFlags() {
    for (const p of this.players) p.controlled = p.id === this.controlledId;
  }
}

// ---- module helpers ------------------------------------------------------
function basePlayer(id: string, team: Team, f: FormSpot): Player {
  return {
    id,
    team,
    role: f.role,
    number: f.num,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    speed: SPEED[f.role],
    hasBall: false,
    controlled: false,
    routeIdx: 0,
    ox: 0,
    oy: 0,
    stun: 0,
    blocked: false,
  };
}

function freshBall(): BallState {
  return {
    x: 0,
    y: 0,
    carrier: null,
    inAir: false,
    t: 0,
    sx: 0,
    sy: 0,
    tx: 0,
    ty: 0,
    targetId: null,
    arc: 0,
  };
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

function ord(n: number) {
  return n === 1 ? "1ST" : n === 2 ? "2ND" : n === 3 ? "3RD" : `${n}TH`;
}
