import { Application, Container, Graphics, Text } from "pixi.js";
import {
  BLOCK_R,
  BLOCKED_REACH,
  CATCH_R,
  COLORS,
  DEFLECT_R,
  ENDZONE,
  FIELD_YARDS,
  INT_CHANCE,
  LEFT_GOAL,
  PASS_SPEED,
  PLAY_CLOCK,
  QUARTER_SECONDS,
  REACH,
  RIGHT_GOAL,
  SIDELINE,
  SPEED,
  TACKLE_R,
  TIP_CHANCE,
  TURBO,
  VIEW_H,
  VIEW_W,
  WORLD_H,
  WORLD_W,
  YARD,
  Z_CATCH,
  Z_RELEASE,
} from "./constants";
import { Input } from "./input";
import { Sfx } from "./audio";
import { DEFENSE_FORMATIONS, OFFENSE_BASE, OFFENSE_FORMATIONS } from "./plays";
import type {
  BallState,
  DefenseFormation,
  DefensePlay,
  HudState,
  OffenseFormation,
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
  num: number;
  target?: string; // throw key shown above receiver
  assign?: string; // slot id a DB covers
}

// Roster (positions come from OFFENSE_BASE / DEFENSE_BASE — single source).
const OFF_FORM: FormSpot[] = [
  { slot: "QB", role: "QB", num: 7 },
  { slot: "R", role: "RB", num: 28, target: "4" },
  { slot: "LT", role: "OL", num: 73 },
  { slot: "LG", role: "OL", num: 66 },
  { slot: "CEN", role: "OL", num: 55 },
  { slot: "RG", role: "OL", num: 67 },
  { slot: "RT", role: "OL", num: 76 },
  { slot: "F", role: "OL", num: 44 }, // fullback / lead blocker
  { slot: "A", role: "WR", num: 80, target: "1" },
  { slot: "B", role: "WR", num: 88, target: "2" },
  { slot: "C", role: "TE", num: 84, target: "3" },
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
  private offFormation: OffenseFormation = OFFENSE_FORMATIONS[0];
  private defFormation: DefenseFormation = DEFENSE_FORMATIONS[0];
  private offPlay: OffensePlay = OFFENSE_FORMATIONS[0].plays[0];
  private defPlay: DefensePlay = DEFENSE_FORMATIONS[0].plays[0];
  private kickMode: "fg" | "punt" | null = null;
  private kickGood = false;
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

    this.app.ticker.add((t) => this.update(t.deltaMS / 1000));
  }

  /** resize the renderer to the host element (driven by the viewport module) */
  resize = () => {
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

  /** React calls this when the user picks a play (formation + play). */
  choosePlay(formationId: string, playId: string) {
    if (this.phase !== "playcall") return;
    this.audio.resume();
    this.audio.select();
    if (this.userOnOffense()) {
      const f =
        OFFENSE_FORMATIONS.find((x) => x.id === formationId) ??
        OFFENSE_FORMATIONS[0];
      this.offFormation = f;
      this.offPlay = f.plays.find((p) => p.id === playId) ?? f.plays[0];
      // AI defense answers with a random front + call
      this.defFormation = pick(DEFENSE_FORMATIONS);
      this.defPlay = pick(this.defFormation.plays);
    } else {
      const f =
        DEFENSE_FORMATIONS.find((x) => x.id === formationId) ??
        DEFENSE_FORMATIONS[0];
      this.defFormation = f;
      this.defPlay = f.plays.find((p) => p.id === playId) ?? f.plays[0];
      // AI offense never punts/kicks — exclude special teams
      this.offFormation = pick(
        OFFENSE_FORMATIONS.filter((x) => x.id !== "special")
      );
      this.offPlay = pick(this.offFormation.plays);
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
  debugDefense() {
    const defTeam: Team = this.possession === "home" ? "away" : "home";
    const dir = this.offDir();
    return {
      formation: this.defFormation.id,
      play: this.defPlay.id,
      coverage: this.defPlay.coverage,
      blitzers: this.defPlay.blitzers,
      los: this.los,
      dir,
      defenders: this.players
        .filter((p) => p.team === defTeam)
        .map((p) => ({
          slot: p.id.split("_")[1],
          job: p.job,
          defRole: p.defRole,
          x: Math.round(p.x),
          y: Math.round(p.y),
          // how far past the LOS toward the QB (positive = rushing into backfield)
          pen: Math.round((dir * (this.los - p.x)) / YARD),
        })),
    };
  }
  debugBall() {
    const b = this.ball;
    return {
      x: b.x,
      y: b.y,
      z: b.z,
      inAir: b.inAir,
      carrier: b.carrier,
      t: b.t,
      peak: b.peak,
    };
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

  availableFormations() {
    return this.userOnOffense() ? OFFENSE_FORMATIONS : DEFENSE_FORMATIONS;
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

    const offAlign = this.offFormation.align ?? {};

    for (const f of OFF_FORM) {
      const p: Player = basePlayer(idOf(offTeam, f.slot), offTeam, f);
      const base = OFFENSE_BASE[f.slot];
      const ov = offAlign[f.slot];
      const fwd = ov?.fwd ?? base.fwd;
      const lat = ov?.lat ?? base.lat;
      p.ox = clamp(this.los + dir * fwd * YARD, LEFT_GOAL - 40, RIGHT_GOAL + 40);
      p.oy = clamp(midY + lat * YARD, SIDELINE, WORLD_H - SIDELINE);
      p.x = p.ox;
      p.y = p.oy;
      p.target = f.target;
      this.players.push(p);
    }
    // defense: the selected front's personnel + alignment
    for (const f of this.defFormation.front) {
      const p: Player = basePlayer(idOf(defTeam, f.slot), defTeam, {
        slot: f.slot,
        role: f.role === "CB" || f.role === "S" ? "DB" : f.role,
        num: f.num,
      });
      p.defRole = f.role;
      p.ox = clamp(this.los + dir * f.fwd * YARD, LEFT_GOAL - 40, RIGHT_GOAL + 40);
      p.oy = clamp(midY + f.lat * YARD, SIDELINE, WORLD_H - SIDELINE);
      p.x = p.ox;
      p.y = p.oy;
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

    this.assignDefense(offTeam, defTeam, dir, midY);

    // build sprites
    for (const p of this.players) this.makeSprite(p);
    // keep the ball drawn on top of every player sprite
    this.world.addChild(this.ballGfx);

    // initial control: user controls QB (or runner) on offense, the MIKE / a
    // box defender on defense
    if (this.userOnOffense()) {
      this.controlledId = idOf(offTeam, "QB");
    } else {
      this.controlledId = this.pickDefaultDefender(defTeam);
    }
    this.setControlFlags();
  }

  /** assign each defender a job (rush / man / zone / spy), gap, and landmark */
  private assignDefense(offTeam: Team, defTeam: Team, dir: number, midY: number) {
    const defenders = this.players.filter((p) => p.team === defTeam);
    const play = this.defPlay;
    this.rushers.clear();

    // 1) the rush: every down lineman, plus `blitzers` linebackers/DBs nearest LOS
    const dl = defenders.filter((d) => d.defRole === "DL");
    for (const d of dl) {
      d.job = "rush";
      this.rushers.add(d.id);
    }
    const blitzPool = defenders
      .filter((d) => d.defRole === "LB")
      .sort((a, b) => Math.abs(a.oy - midY) - Math.abs(b.oy - midY));
    const allPool = blitzPool.concat(
      defenders.filter((d) => d.defRole === "S").sort((a, b) => a.ox * dir - b.ox * dir)
    );
    for (let i = 0; i < play.blitzers && i < allPool.length; i++) {
      allPool[i].job = "rush";
      this.rushers.add(allPool[i].id);
    }

    // run-fit gaps: every front-seven defender owns a lane across the front,
    // so on a run they hold gap integrity instead of all crashing the back
    const box = defenders
      .filter((d) => d.defRole === "DL" || d.defRole === "LB")
      .sort((a, b) => a.oy - b.oy);
    box.forEach((d, i) => {
      d.gap = (i - (box.length - 1) / 2) * 1.5; // yards from center
    });

    // 2) coverage defenders (everyone not rushing)
    const cover = defenders.filter((d) => !this.rushers.has(d.id));
    const receivers = this.players.filter((p) => p.team === offTeam && !!p.target);

    if (play.coverage === "man") {
      // CBs take the widest receivers; safeties/LBs take the rest inside-out
      const recs = [...receivers].sort((a, b) => a.oy - b.oy);
      const cbs = cover.filter((d) => d.defRole === "CB");
      const rest = cover.filter((d) => d.defRole !== "CB");
      const wides = recs.filter((r) => Math.abs(r.oy - midY) > 5 * YARD);
      const inside = recs.filter((r) => Math.abs(r.oy - midY) <= 5 * YARD);
      const assign = (defs: Player[], targs: Player[]) => {
        for (const t of targs) {
          let best: Player | null = null;
          let bd = Infinity;
          for (const d of defs) {
            if (d.assignId) continue;
            const dd = Math.abs(d.oy - t.oy);
            if (dd < bd) {
              bd = dd;
              best = d;
            }
          }
          if (best) {
            best.assignId = t.id;
            best.job = "man";
          }
        }
      };
      assign(cbs, wides);
      assign([...rest, ...cbs], inside);
      // leftover defenders spy / robber the middle
      for (const d of cover) if (d.job !== "man") d.job = "spy";
    } else {
      // zone: deep shell + underneath, spread across the field width
      const nDeep = play.coverage === "cover2" ? 2 : play.coverage === "cover3" ? 3 : 4;
      // deepest coverage players take the deep zones
      const byDepth = [...cover].sort((a, b) => (b.ox - a.ox) * dir);
      const deep = byDepth.slice(0, Math.min(nDeep, byDepth.length));
      const under = byDepth.slice(deep.length);
      const deepFwd = play.coverage === "cover4" ? 14 : 16;
      const spread = (defs: Player[], fwd: number, span: number) => {
        const n = defs.length;
        defs
          .slice()
          .sort((a, b) => a.oy - b.oy)
          .forEach((d, i) => {
            const frac = n === 1 ? 0.5 : i / (n - 1);
            const lat = (frac - 0.5) * span; // yards across the field
            d.job = "zone";
            d.zone = {
              x: clamp(this.los + dir * fwd * YARD, LEFT_GOAL, RIGHT_GOAL + 200),
              y: clamp(midY + lat * YARD, SIDELINE, WORLD_H - SIDELINE),
            };
          });
      };
      spread(deep, deepFwd, 18); // deep zones use most of the width
      spread(under, 6.5, 20); // underneath flats/hooks slightly wider
    }

    // CBs line up across from the receiver they're nearest to
    for (const d of defenders) {
      if (d.defRole !== "CB") continue;
      let near: Player | null = null;
      let bd = Infinity;
      for (const r of receivers) {
        const dd = Math.abs(r.oy - d.oy);
        if (dd < bd) {
          bd = dd;
          near = r;
        }
      }
      if (near && bd < 8 * YARD) {
        d.oy = clamp(near.oy, SIDELINE, WORLD_H - SIDELINE);
        d.y = d.oy;
      }
    }
  }

  private pickDefaultDefender(defTeam: Team) {
    // prefer the middle linebacker, else any LB, else nearest defender to the ball
    const defs = this.players.filter((p) => p.team === defTeam);
    const mlb = defs.find((d) => d.id.endsWith("_MLB")) ?? defs.find((d) => d.defRole === "LB");
    return (mlb ?? defs[0]).id;
  }

  private snap() {
    this.phase = "live";
    this.throwTimer = 0;
    this.kickMode = null;
    const offTeam = this.possession;
    const ball = this.ball;

    if (this.offPlay.kind === "fg" || this.offPlay.kind === "punt") {
      this.startKick(this.offPlay.kind);
      return;
    }

    this.audio.snap();
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

  // ---- special teams -----------------------------------------------------
  private startKick(kind: "fg" | "punt") {
    const dir = this.offDir();
    const goalX = dir > 0 ? RIGHT_GOAL : LEFT_GOAL;
    const b = this.ball;
    b.carrier = null;
    b.inAir = true;
    b.targetId = null;
    b.sx = this.los - dir * 7 * YARD; // snap back to the kicker/punter
    b.sy = WORLD_H / 2;
    b.x = b.sx;
    b.y = b.sy;
    b.z = 0;
    b.t = 0;
    b.elapsed = 0;
    this.kickMode = kind;
    this.audio.kick();

    if (kind === "fg") {
      // distance to the posts (back of end zone = +10 from goal line)
      const yds = Math.abs(goalX - b.sx) / YARD + 10;
      this.kickGood = yds <= 52 && rng() < this.fgProb(yds);
      b.tx = goalX + dir * (this.kickGood ? 14 * YARD : 2 * YARD);
      b.ty = WORLD_H / 2 + (this.kickGood ? 0 : (rng() - 0.5) * 8 * YARD);
      b.peak = 3.2 * YARD;
      b.ftime = Math.max(0.7, (Math.abs(b.tx - b.sx) / PASS_SPEED) * 1.1);
      this.message = "FIELD GOAL…";
    } else {
      // punt: 38-46 yards of hang, with a touchback if it reaches the end zone
      const puntYds = 38 + rng() * 8;
      let landX = b.sx + dir * puntYds * YARD;
      if (dir > 0 ? landX >= goalX : landX <= goalX) landX = goalX; // touchback
      b.tx = landX;
      b.ty = WORLD_H / 2 + (rng() - 0.5) * 6 * YARD;
      b.peak = 3.6 * YARD;
      b.ftime = Math.max(0.9, (Math.abs(b.tx - b.sx) / PASS_SPEED) * 1.3);
      this.message = "PUNT…";
    }
  }

  private fgProb(yds: number) {
    if (yds <= 25) return 0.97;
    if (yds <= 35) return 0.88;
    if (yds <= 43) return 0.72;
    if (yds <= 48) return 0.55;
    return 0.38;
  }

  private updateKick(dt: number) {
    const b = this.ball;
    b.elapsed += dt;
    b.t = clamp(b.elapsed / b.ftime, 0, 1);
    b.x = lerp(b.sx, b.tx, b.t);
    b.y = lerp(b.sy, b.ty, b.t);
    b.z = b.peak * Math.sin(Math.PI * b.t);
    if (b.t < 1) return;
    b.inAir = false;
    b.z = 0;
    const kind = this.kickMode;
    this.kickMode = null;
    if (kind === "fg") this.resolveFieldGoal();
    else this.resolvePunt();
  }

  private resolveFieldGoal() {
    this.phase = "dead";
    this.deadTimer = 1.8;
    this.audio.whistle();
    if (this.kickGood) {
      this.score[this.possession] += 3;
      this.message = "FIELD GOAL IS GOOD! +3";
      this.audio.firstDown();
      this.pendingKickoff = true;
    } else {
      this.message = "NO GOOD";
      this.audio.turnover();
      // opponent takes over at the spot of the kick
      this.flipPossession(this.los);
    }
  }

  private resolvePunt() {
    this.phase = "dead";
    this.deadTimer = 1.6;
    this.audio.whistle();
    const dir = this.offDir();
    const goalX = dir > 0 ? RIGHT_GOAL : LEFT_GOAL;
    let spot = this.ball.x;
    // touchback to the opponent's own 20
    if (dir > 0 ? spot >= goalX : spot <= goalX) spot = goalX - dir * 20 * YARD;
    this.message = "PUNT";
    this.flipPossession(spot);
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
    const ballLoose = this.ball.inAir;
    for (const p of this.players) {
      if (p.team !== offTeam) continue;
      if (p.role === "OL") continue; // handled in blocking

      const isCarrier = carrier?.id === p.id;
      const isUser = p.id === this.controlledId && this.userOnOffense();

      if (isUser) {
        this.applyUserMove(p, dt);
        continue;
      }

      // ball in the air: target drives to the spot; on a tip everyone attacks
      // the loose ball; otherwise receivers keep running their routes
      if (ballLoose) {
        if (this.ball.tip || p.id === this.ball.targetId) {
          this.moveToward(p, this.ball.tx, this.ball.ty, dt, 1);
        } else if (p.route && p.routeIdx < p.route.length) {
          this.followRoute(p, dt);
        }
        continue;
      }

      // AI QB on a pass play: drop back, then throw (checked before isCarrier
      // so the QB passes instead of just scrambling for the goal)
      if (
        p.role === "QB" &&
        this.ball.carrier === p.id &&
        this.offPlay.kind === "pass" &&
        !this.userOnOffense()
      ) {
        this.aiQuarterback(p, dt);
        continue;
      }

      if (isCarrier) {
        this.runToGoal(p, dt);
        continue;
      }

      const dir = this.offDir();
      // Block downfield ONLY once the ball is actually being run — a handoff,
      // a catch-and-run, or a QB scramble past the line. While the QB is in the
      // pocket on a pass, receivers run their routes (this was the bug: the QB
      // counts as the carrier, so receivers were blocking instead of running).
      const qbInPocket =
        carrier !== null &&
        carrier.role === "QB" &&
        this.offPlay.kind === "pass" &&
        dir * (carrier.x - this.los) < 1 * YARD;

      if (carrier && !isCarrier && !qbInPocket) {
        this.downfieldBlock(p, carrier, dt);
        continue;
      }

      // run the route
      if (p.route && p.routeIdx < p.route.length) {
        this.followRoute(p, dt);
      } else if (p.route) {
        this.moveToward(p, p.x + dir * YARD, p.y, dt, 0.55);
      }
    }
  }

  /** an offensive player (not the carrier) walls off the nearest threat */
  private downfieldBlock(p: Player, carrier: Player, dt: number) {
    const dir = this.offDir();
    // find the nearest defender that's a threat to the carrier
    let tgt: Player | null = null;
    let best = Infinity;
    for (const d of this.players) {
      if (d.team === p.team) continue;
      // only block defenders that are near the carrier or near me
      const dc = dist(d.x, d.y, carrier.x, carrier.y);
      const dm = dist(d.x, d.y, p.x, p.y);
      const score = dm + dc * 0.6;
      if (dc < 14 * YARD && score < best) {
        best = score;
        tgt = d;
      }
    }
    if (!tgt) {
      // no one to block — lead the carrier upfield
      this.moveToward(p, carrier.x + dir * 3 * YARD, carrier.y, dt, 0.85);
      return;
    }
    // get onto the goal side of the defender (between them and the end zone)
    const aimX = tgt.x + dir * 0.8 * YARD;
    this.moveToward(p, aimX, tgt.y, dt, 1);
    if (dist(p.x, p.y, tgt.x, tgt.y) < BLOCK_R) {
      tgt.blocked = true;
      tgt.x -= dir * 0.35; // shove back toward their own side
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
    // on a designed run, aim through the hole until past the line, then turn upfield
    const behindLine = dir * (p.x - this.los) < 1.5 * YARD;
    if (this.offPlay.kind === "run" && behindLine) {
      const holeY = clamp(
        WORLD_H / 2 + (this.offPlay.hole ?? 0) * YARD,
        SIDELINE,
        WORLD_H - SIDELINE
      );
      this.moveToward(p, this.los + dir * 4 * YARD, holeY, dt, 1);
      return;
    }
    // avoid nearest defenders, run for the end zone
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
    const ty = clamp(p.y + ay * 4 * YARD, SIDELINE, WORLD_H - SIDELINE);
    const tx = p.x + dir * 3 * YARD + ax * 1.2 * YARD;
    void goalX;
    this.moveToward(p, tx, ty, dt, 1);
  }

  // ---- defense AI / control ---------------------------------------------
  private updateDefense(dt: number) {
    const defTeam: Team = this.possession === "home" ? "away" : "home";
    const carrier = this.carrier();
    const dir = this.offDir();
    // a run / scramble / catch-and-run is live once the ball is being carried
    // by someone other than a QB still in the pocket on a pass play
    const pocketPass =
      carrier &&
      carrier.role === "QB" &&
      this.offPlay.kind === "pass" &&
      dir * (carrier.x - this.los) < 1.5 * YARD;
    const ballCarried = carrier && !this.ball.inAir && !pocketPass;

    if (!this.userOnOffense() && this.input.pressed("Space") && this.switchCooldown <= 0) {
      this.switchDefender();
      this.switchCooldown = 0.25;
    }

    for (const p of this.players) {
      if (p.team !== defTeam) continue;
      if (p.id === this.controlledId && !this.userOnOffense()) {
        this.applyUserMove(p, dt);
        continue;
      }

      if (this.ball.inAir) {
        this.moveToward(p, this.ball.tx, this.ball.ty, dt, 1); // break on the ball
        continue;
      }
      if (ballCarried) {
        const past = dir * (carrier!.x - this.los) > 0.5 * YARD;
        if (this.offPlay.kind === "run" && !past) {
          this.runFit(p, carrier!, dt);
        } else {
          this.pursueCarrier(p, carrier!, dt);
        }
        continue;
      }
      // pass developing — everyone plays their assignment
      switch (p.job) {
        case "rush":
          this.rushPasser(p, carrier, dt);
          break;
        case "man":
          this.coverMan(p, dt);
          break;
        case "zone":
          this.coverZone(p, dt);
          break;
        default:
          this.spyQuarterback(p, carrier, dt);
      }
    }
  }

  /** pursue the ball carrier; blocked defenders are slowed so lanes can open */
  private pursueCarrier(p: Player, carrier: Player, dt: number) {
    const to = this.intercept(p, carrier);
    this.moveToward(p, to.x, to.y, dt, p.blocked ? 0.4 : 1);
  }

  /** gap-discipline run fit: hold your gap at the LOS until the back commits,
   * so the front doesn't all crash one point and a crease can open */
  private runFit(p: Player, carrier: Player, dt: number) {
    const dir = this.offDir();
    const frontSeven = p.defRole === "DL" || p.defRole === "LB";
    if (!frontSeven || p.gap === undefined) {
      // DBs play contain / run support — stay a hair outside and behind
      const to = this.intercept(p, carrier);
      this.moveToward(p, to.x, to.y, dt, p.blocked ? 0.5 : 0.85);
      return;
    }
    const gx = this.los + dir * 0.5 * YARD;
    const gy = clamp(WORLD_H / 2 + p.gap * YARD, SIDELINE, WORLD_H - SIDELINE);
    // hold the gap until the back is right on top of it, then attack downhill
    const threat = dist(carrier.x, carrier.y, gx, gy) < 2.5 * YARD;
    if (threat) {
      const to = this.intercept(p, carrier);
      this.moveToward(p, to.x, to.y, dt, p.blocked ? 0.4 : 1);
    } else {
      this.moveToward(p, gx, gy, dt, p.blocked ? 0.35 : 0.9);
    }
  }

  private rushPasser(p: Player, carrier: Player | null, dt: number) {
    const aim = carrier ?? { x: this.los, y: WORLD_H / 2, vx: 0, vy: 0 } as Player;
    const to = carrier ? this.intercept(p, carrier) : { x: aim.x, y: aim.y };
    this.moveToward(p, to.x, to.y, dt, p.blocked ? 0.4 : 1);
  }

  private spyQuarterback(p: Player, carrier: Player | null, dt: number) {
    const dir = this.offDir();
    const qb = carrier ?? null;
    const tx = this.los + dir * 2 * YARD;
    const ty = qb ? qb.y : WORLD_H / 2;
    this.moveToward(p, tx, ty, dt, 0.7);
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
    if (!cover) {
      this.spyQuarterback(p, this.carrier(), dt);
      return;
    }
    const dir = this.offDir();
    const press = this.defPlay.press ?? 0.6;
    const cushion = lerp(2.2, 0.3, press); // yards on the goal side of the WR
    const aim = this.intercept(p, cover);
    this.moveToward(p, aim.x + dir * cushion * YARD, aim.y, dt, 0.99);
  }

  private coverZone(p: Player, dt: number) {
    const lm = p.zone;
    if (!lm) {
      this.spyQuarterback(p, this.carrier(), dt);
      return;
    }
    // hold the zone landmark, but break on a receiver who enters the area
    let tgt: Player | null = null;
    let bd = 4.5 * YARD;
    for (const r of this.eligibleReceivers()) {
      const d = dist(lm.x, lm.y, r.x, r.y);
      if (d < bd) {
        bd = d;
        tgt = r;
      }
    }
    if (tgt) {
      const aim = this.intercept(p, tgt);
      this.moveToward(p, aim.x, aim.y, dt, 0.95);
    } else {
      this.moveToward(p, lm.x, lm.y, dt, 0.85);
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
    const carrier = this.carrier();
    const dir = this.offDir();
    const blockers = this.players.filter((p) => p.team === offTeam && p.role === "OL");

    const pocket =
      this.ball.inAir ||
      (carrier !== null &&
        carrier.role === "QB" &&
        this.offPlay.kind === "pass" &&
        dir * (carrier.x - this.los) < 1 * YARD);

    if (pocket || !carrier) {
      this.passProtect(blockers, carrier);
    } else if (this.offPlay.kind === "run") {
      this.runBlock(blockers, carrier);
    } else {
      // scramble / after the catch — wall off pursuit
      for (const ol of blockers) this.downfieldBlock(ol, carrier, 0);
    }
  }

  /** assign each blocker to a rusher, inside-out; engaged rushers are sealed off */
  private passProtect(blockers: Player[], carrier: Player | null) {
    const protect = carrier ?? { x: this.los, y: WORLD_H / 2 };
    const rush = this.players
      .filter((p) => this.rushers.has(p.id))
      .sort((a, b) => dist(a.x, a.y, protect.x, protect.y) - dist(b.x, b.y, protect.x, protect.y));
    const avail = blockers.slice();
    for (const r of rush) {
      if (!avail.length) break; // outnumbered — this rusher comes free
      let bi = 0;
      let bd = Infinity;
      for (let i = 0; i < avail.length; i++) {
        const d = dist(avail[i].x, avail[i].y, r.x, r.y);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      this.engageBlock(avail.splice(bi, 1)[0], r, protect);
    }
    // spare blockers double the most dangerous rusher
    for (const ol of avail) {
      if (rush.length) this.engageBlock(ol, rush[0], protect);
      else {
        ol.vx = 0;
        ol.vy = 0;
      }
    }
  }

  /** a blocker mirrors a rusher, staying between him and the protect point */
  private engageBlock(ol: Player, r: Player, protect: { x: number; y: number }) {
    const dx = protect.x - r.x;
    const dy = protect.y - r.y;
    const d = Math.hypot(dx, dy) || 1;
    // stand a step toward the QB from the rusher
    this.moveTowardRaw(ol, r.x + (dx / d) * BLOCK_R * 0.7, r.y + (dy / d) * BLOCK_R * 0.7, 1);
    if (dist(ol.x, ol.y, r.x, r.y) < BLOCK_R * 1.5) {
      r.blocked = true;
      // shove the rusher away from the protect point so he can't cross the blocker
      r.x -= (dx / d) * 0.35;
      r.y -= (dy / d) * 0.35;
    }
  }

  /** run blocking: seal the front away from the hole; FB + puller lead through it */
  private runBlock(blockers: Player[], carrier: Player) {
    const dir = this.offDir();
    const hole = this.offPlay.hole ?? 0;
    const holeY = clamp(WORLD_H / 2 + hole * YARD, SIDELINE, WORLD_H - SIDELINE);
    const front = this.players.filter(
      (p) => p.team !== carrier.team && (p.defRole === "DL" || p.defRole === "LB")
    );
    const claimed = new Set<string>();
    const pull = this.offPlay.pull;

    // leads: the fullback and (if any) the pulling guard attack the hole's 2nd level
    const leads = blockers.filter(
      (ol) => ol.id.endsWith("_F") || (pull && ol.id.endsWith("_" + pull))
    );
    const sealers = blockers.filter((ol) => !leads.includes(ol));

    const leadPt = { x: this.los + dir * 4 * YARD, y: holeY };
    for (const ol of leads) {
      // block the nearest unclaimed defender near/through the hole
      let tgt: Player | null = null;
      let bd = 6 * YARD;
      for (const f of front) {
        if (claimed.has(f.id)) continue;
        const dd = dist(f.x, f.y, leadPt.x, leadPt.y);
        if (dd < bd) {
          bd = dd;
          tgt = f;
        }
      }
      if (tgt) {
        claimed.add(tgt.id);
        this.driveBlock(ol, tgt, dir, holeY);
      } else {
        this.moveTowardRaw(ol, this.los + dir * 6 * YARD, holeY, 1);
      }
    }

    // block the defenders nearest the hole first, each by the closest free OL
    const avail = sealers.slice();
    const threats = front
      .filter((f) => !claimed.has(f.id))
      .sort((a, b) => Math.abs(a.y - holeY) - Math.abs(b.y - holeY));
    for (const f of threats) {
      if (!avail.length) break;
      let bi = 0;
      let bd = Infinity;
      for (let i = 0; i < avail.length; i++) {
        const d = dist(avail[i].x, avail[i].y, f.x, f.y);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      claimed.add(f.id);
      this.driveBlock(avail.splice(bi, 1)[0], f, dir, holeY);
    }
    // leftover blockers climb toward the hole's second level
    for (const ol of avail) this.moveTowardRaw(ol, this.los + dir * 3 * YARD, holeY, 0.8);
  }

  /** drive a defender downfield and away from the hole to open a lane */
  private driveBlock(ol: Player, tgt: Player, dir: number, holeY: number) {
    this.moveTowardRaw(ol, tgt.x + dir * 0.4 * YARD, tgt.y, 1);
    if (dist(ol.x, ol.y, tgt.x, tgt.y) < BLOCK_R * 1.5) {
      tgt.blocked = true;
      tgt.x += dir * 0.3; // push back toward their own side
      tgt.y += Math.sign(tgt.y - holeY || 1) * 0.3; // and away from the hole
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

    // lead the receiver: predict where they'll be when the ball arrives
    let landX = r.x;
    let landY = r.y;
    for (let i = 0; i < 3; i++) {
      const ft = dist(qb.x, qb.y, landX, landY) / PASS_SPEED;
      landX = r.x + r.vx * ft;
      landY = r.y + r.vy * ft;
    }
    landX = clamp(landX, LEFT_GOAL - 40, RIGHT_GOAL + 40);
    landY = clamp(landY, SIDELINE, WORLD_H - SIDELINE);

    qb.hasBall = false;
    b.carrier = null;
    b.inAir = true;
    b.targetId = receiverId;
    b.sx = qb.x;
    b.sy = qb.y;
    b.x = qb.x;
    b.y = qb.y;
    b.z = Z_RELEASE;
    b.tx = landX;
    b.ty = landY;
    b.t = 0;
    b.elapsed = 0;
    b.tip = false;
    const throwDist = dist(qb.x, qb.y, landX, landY);
    b.ftime = Math.max(0.32, throwDist / PASS_SPEED);
    // every throw arcs enough to clear underneath defenders; long balls higher
    b.peak = clamp(throwDist * 0.18, 1.7 * YARD, 3.4 * YARD);
    // hand control of the target to the user so they can adjust to the ball
    if (this.userOnOffense()) {
      this.controlledId = receiverId;
      this.setControlFlags();
    }
    this.message = "";
    this.audio.throw();
  }

  // ---- ball update -------------------------------------------------------
  private updateBall(dt: number) {
    const b = this.ball;
    if (this.kickMode) {
      this.updateKick(dt);
      return;
    }
    if (!b.inAir) {
      const c = this.carrier();
      if (c) {
        b.x = c.x;
        b.y = c.y - 10;
        b.z = 0;
      }
      return;
    }

    b.elapsed += dt;
    b.t = clamp(b.elapsed / b.ftime, 0, 1);
    // ground position travels in a straight line start -> landing spot
    b.x = lerp(b.sx, b.tx, b.t);
    b.y = lerp(b.sy, b.ty, b.t);

    if (b.tip) {
      // loose ball after a tip: low pop-up arc, anyone can grab it
      b.z = b.peak * Math.sin(Math.PI * b.t);
      this.resolveLoose();
      if (this.ball.inAir && b.t >= 1) this.incomplete(); // hit the turf
      return;
    }

    // height follows a parabolic arc: rises off the QB's hand, drops to the catch
    b.z = lerp(Z_RELEASE, Z_CATCH, b.t) + b.peak * Math.sin(Math.PI * b.t);

    // A defender can only play the ball when he's almost directly under it AND
    // it's within his reach. The arc keeps it high over the middle, so only a
    // rusher right at the release or a defender at the catch point can touch it.
    const offTeam = this.possession;
    for (const p of this.players) {
      if (p.team === offTeam) continue;
      if (dist(p.x, p.y, b.x, b.y) > DEFLECT_R) continue;
      const reach = p.blocked ? BLOCKED_REACH : REACH;
      if (b.z > reach) continue;
      const roll = rng();
      if (roll < INT_CHANCE) return this.interception(p);
      if (roll < INT_CHANCE + (1 - INT_CHANCE) * TIP_CHANCE)
        return this.startTip(p);
      return this.batDown();
    }
    // eligible receivers — a receiver in reach catches it
    for (const p of this.players) {
      if (p.team !== offTeam || !p.target) continue;
      if (dist(p.x, p.y, b.x, b.y) > CATCH_R) continue;
      if (b.z > REACH) continue;
      return this.completePass(p);
    }

    if (b.t >= 1) this.incomplete(); // overthrown — hit the turf
  }

  /** a deflected ball is live: the closest player under it (either team) grabs it */
  private resolveLoose() {
    const b = this.ball;
    // let it pop up first so the tipper can't instantly re-grab it
    if (b.t < 0.35) return;
    let best: Player | null = null;
    let bd = CATCH_R;
    for (const p of this.players) {
      const d = dist(p.x, p.y, b.x, b.y);
      if (d < bd && b.z <= REACH) {
        bd = d;
        best = p;
      }
    }
    if (!best) return;
    if (best.team === this.possession) this.completePass(best);
    else this.interception(best);
  }

  /** deflect the ball up into a live loose ball near the defender */
  private startTip(by: Player) {
    const b = this.ball;
    b.tip = true;
    b.targetId = null;
    b.sx = b.x;
    b.sy = b.y;
    // pops up and falls a couple of yards off the deflection
    b.tx = clamp(b.x + (rng() - 0.5) * 4 * YARD, LEFT_GOAL, RIGHT_GOAL);
    b.ty = clamp(b.y + (rng() - 0.5) * 4 * YARD, SIDELINE, WORLD_H - SIDELINE);
    b.peak = 1.4 * YARD;
    b.ftime = 0.6;
    b.elapsed = 0;
    b.t = 0;
    this.message = "TIPPED!";
    this.audio.tackle();
    void by;
  }

  private completePass(r: Player) {
    const b = this.ball;
    b.inAir = false;
    b.tip = false;
    b.targetId = null;
    b.z = 0;
    r.hasBall = true;
    b.carrier = r.id;
    if (r.team === this.possession && this.userOnOffense()) {
      this.controlledId = r.id;
      this.setControlFlags();
    }
    this.message = "CAUGHT!";
    this.audio.catchBall();
  }

  /** ball batted straight to the turf — incomplete */
  private batDown() {
    this.ball.z = 0;
    this.audio.tackle();
    this.incomplete();
  }

  private incomplete() {
    this.ball.inAir = false;
    this.ball.tip = false;
    this.ball.targetId = null;
    this.endPlay({ type: "incomplete" });
  }

  private interception(by: Player) {
    this.ball.inAir = false;
    this.ball.tip = false;
    this.ball.targetId = null;
    this.ball.z = 0;
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

    // tackle on contact with any FREE defender (an engaged blocker can't make
    // the tackle — this is what makes blocks matter and lanes/pockets hold)
    for (const p of this.players) {
      if (p.team === c.team) continue;
      if (p.blocked) continue;
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
    const aloft = b.inAir || this.kickMode !== null;
    if (aloft) {
      // ground shadow tracks the true landing path; shrinks/fades as it rises
      const f = clamp(1 - b.z / (7 * YARD), 0.3, 1);
      g.ellipse(b.x, b.y, 8 * f, 4 * f).fill({ color: 0x000000, alpha: 0.32 * f });
      const sy = b.y - b.z; // lift the ball up by its height
      // bigger, brighter ball so the flight reads clearly
      g.ellipse(b.x, sy, 8, 5).fill(COLORS.ball);
      g.ellipse(b.x, sy, 8, 5).stroke({ width: 1.5, color: 0xffffff, alpha: 0.95 });
      // laces
      g.moveTo(b.x - 3, sy).lineTo(b.x + 3, sy).stroke({ width: 1, color: 0xffffff, alpha: 0.9 });
    } else {
      g.ellipse(b.x, b.y, 6, 4).fill(COLORS.ball);
      g.ellipse(b.x, b.y, 6, 4).stroke({ width: 1, color: 0xffffff, alpha: 0.5 });
    }
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
    z: 0,
    carrier: null,
    inAir: false,
    t: 0,
    elapsed: 0,
    ftime: 1,
    sx: 0,
    sy: 0,
    tx: 0,
    ty: 0,
    targetId: null,
    peak: 0,
    tip: false,
  };
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

function ord(n: number) {
  return n === 1 ? "1ST" : n === 2 ? "2ND" : n === 3 ? "3RD" : `${n}TH`;
}
