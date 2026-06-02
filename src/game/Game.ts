import { Application, Container, Graphics, Text } from "pixi.js";
import {
  BLOCK_R,
  CATCH_R,
  COLORS,
  ENDZONE,
  FIELD_YARDS,
  FIELD_Y,
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

const OFF_FORM: FormSpot[] = [
  { slot: "QB", role: "QB", fwd: -3, lat: 0, num: 7 },
  { slot: "R", role: "RB", fwd: -3, lat: 3, num: 28, target: "4" },
  { slot: "OL1", role: "OL", fwd: -0.5, lat: -2, num: 71 },
  { slot: "OL2", role: "OL", fwd: -0.5, lat: 0, num: 55 },
  { slot: "OL3", role: "OL", fwd: -0.5, lat: 2, num: 74 },
  { slot: "A", role: "WR", fwd: -0.5, lat: -9, num: 80, target: "1" },
  { slot: "B", role: "WR", fwd: -0.5, lat: 9, num: 88, target: "2" },
  { slot: "C", role: "TE", fwd: -0.5, lat: 4, num: 84, target: "3" },
];

const DEF_FORM: FormSpot[] = [
  { slot: "DL1", role: "DL", fwd: 1, lat: -2, num: 99 },
  { slot: "DL2", role: "DL", fwd: 1, lat: 0, num: 90 },
  { slot: "DL3", role: "DL", fwd: 1, lat: 2, num: 93 },
  { slot: "LB1", role: "LB", fwd: 4, lat: -4, num: 54 },
  { slot: "LB2", role: "LB", fwd: 4, lat: 4, num: 52 },
  { slot: "CB1", role: "DB", fwd: 6, lat: -9, num: 24, assign: "A" },
  { slot: "CB2", role: "DB", fwd: 6, lat: 9, num: 21, assign: "B" },
  { slot: "S", role: "DB", fwd: 11, lat: 0, num: 31, assign: "C" },
];

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
  private deadTimer = 0;
  private snapTimer = 0;
  private throwTimer = 0; // AI QB drop timer
  private switchCooldown = 0;
  private lastHud = "";

  private hudCb: ((h: HudState) => void) | null = null;

  readonly userTeam: Team = "home";

  // ---- lifecycle ---------------------------------------------------------
  async mount(el: HTMLElement) {
    this.app = new Application();
    await this.app.init({
      width: VIEW_W,
      height: VIEW_H,
      background: 0x0a0a0a,
      antialias: true,
    });
    el.appendChild(this.app.canvas);

    this.world.addChild(this.fieldGfx, this.overlay);
    this.app.stage.addChild(this.world);
    this.world.addChild(this.ballGfx);
    this.world.y = FIELD_Y;
    this.drawField();
    this.input.attach();

    this.app.ticker.add((t) => this.update(t.deltaMS / 1000));
  }

  destroy() {
    this.input.detach();
    this.app?.destroy(true, { children: true });
    this.sprites.clear();
  }

  subscribe(cb: (h: HudState) => void) {
    this.hudCb = cb;
  }

  // ---- public controls (from React) -------------------------------------
  startGame() {
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
      this.controlledId = idOf(defTeam, "LB2");
    }
    this.setControlFlags();
  }

  private snap() {
    this.phase = "live";
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
    this.checkTackleAndScore();
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

      const blitzer =
        p.role === "DL" || (p.role === "LB" && this.defPlay.blitz > rng());

      if (qbHasBall && !this.ball.inAir) {
        if (blitzer) {
          this.moveToward(p, carrier!.x, carrier!.y, dt, p.blocked ? 0.5 : 1);
        } else {
          // cover assigned receiver, with cushion toward own goal
          const cover = p.assignId ? this.byId(p.assignId) : null;
          if (cover) {
            const dir = this.offDir();
            const cushion = this.defPlay.man > 0.5 ? 0.5 : 2.5;
            this.moveToward(
              p,
              cover.x + dir * cushion * YARD,
              cover.y,
              dt,
              0.96
            );
          } else {
            this.moveToward(p, carrier!.x, carrier!.y, dt, 0.9);
          }
        }
      } else {
        // pursue the ball / carrier with a small lead
        const lead = this.leadPoint(p, target);
        this.moveToward(p, lead.x, lead.y, dt, p.blocked ? 0.5 : 1);
      }
    }
  }

  private leadPoint(p: Player, target: { x: number; y: number }) {
    const c = this.carrier();
    if (!c) return target;
    const t = clamp(dist(p.x, p.y, c.x, c.y) / (SPEED.DB * YARD), 0, 0.5);
    return { x: c.x + c.vx * t, y: c.y + c.vy * t };
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
          rng() < 0.18
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
      if (res.type !== "incomplete")
        this.message = `+${gainYds} • FIRST DOWN`;
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
    this.pendingKickoff = true;
  }

  private safety() {
    this.phase = "dead";
    this.deadTimer = 2.0;
    const def: Team = this.possession === "home" ? "away" : "home";
    this.score[def] += 2;
    this.message = "SAFETY!";
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
    const focus =
      this.carrier()?.x ??
      (this.ball.inAir ? this.ball.x : this.los);
    const tgt = clamp(focus - VIEW_W / 2, 0, WORLD_W - VIEW_W);
    this.camX = lerp(this.camX, tgt, Math.min(1, dt * 6));
    this.world.x = -this.camX;
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
