import { Application, Container, Graphics, Text } from "pixi.js";
import {
  BLOCK_R,
  CATCH_AREA,
  CATCH_R,
  COLORS,
  DEFLECT_R,
  ENDZONE,
  FIELD_YARDS,
  KICK_SPEED,
  LAND_ZONE,
  LEAD_MARGIN,
  LEFT_GOAL,
  PASS_SPEED,
  RELEASE_ZONE,
  SWAT_R,
  PLAY_CLOCK,
  QUARTER_SECONDS,
  REACH,
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
  Z_CATCH,
  Z_RELEASE,
} from "./constants";
import { Input } from "./input";
import { Sfx } from "./audio";
import { DEFENSE_FORMATIONS, OFFENSE_BASE, OFFENSE_FORMATIONS } from "./plays";
import { ROSTERS, rate } from "./ratings";
import { contest, reseed } from "./contest";
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
import { clamp, dist, lerp, rng } from "./utils";

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
  private kickMode: "fg" | "punt" | "pat" | null = null;
  private kickGood = false;
  // point-after state: a try is pending after a TD; conversion is the active attempt
  private tryPending = false;
  private tryMode = false;
  private conversion: "pat" | "two" | null = null;
  // test-only: AI-drive the ball carrier on a run (a real game has the human do it)
  private testAutoRun = false;
  // test-only: flat rating override per side (home=offense, away=defense) for
  // neutral/tiered distribution validation. null = use the real rosters.
  private testFlatOff: number | null = null;
  private testFlatDef: number | null = null;
  private headless = false;
  // test-only: force a specific defensive matchup instead of a random call
  private testDefFormation: string | null = null;
  private testDefPlay: string | null = null;
  // test-only: tackle-contest counters (broken-tackle rate validation)
  private tkAttempts = 0;
  private tkBreaks = 0;
  private camX = 0;
  private host: HTMLElement | null = null;
  private viewW = VIEW_W;
  private viewH = VIEW_H;
  private worldScale = 1;
  private deadTimer = 0;
  private snapTimer = 0;
  private throwTimer = 0; // AI QB drop timer
  private liveTime = 0; // seconds the current play has been live
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
      // defense: a forced matchup (tests) or a random front + call
      if (this.testDefFormation) {
        this.defFormation =
          DEFENSE_FORMATIONS.find((x) => x.id === this.testDefFormation) ??
          DEFENSE_FORMATIONS[0];
        this.defPlay =
          this.defFormation.plays.find((p) => p.id === this.testDefPlay) ??
          this.defFormation.plays[0];
      } else {
        this.defFormation = pick(DEFENSE_FORMATIONS);
        this.defPlay = pick(this.defFormation.plays);
      }
    } else {
      const f =
        DEFENSE_FORMATIONS.find((x) => x.id === formationId) ??
        DEFENSE_FORMATIONS[0];
      this.defFormation = f;
      this.defPlay = f.plays.find((p) => p.id === playId) ?? f.plays[0];
      if (this.tryMode) {
        // CPU always kicks the extra point on its point-after try
        this.offFormation =
          OFFENSE_FORMATIONS.find((x) => x.id === "convert")!;
        this.offPlay =
          this.offFormation.plays.find((p) => p.kind === "pat") ??
          this.offFormation.plays[0];
      } else {
        // AI offense never punts/kicks or runs a conversion on a normal down
        this.offFormation = pick(
          OFFENSE_FORMATIONS.filter(
            (x) => x.id !== "special" && x.id !== "convert"
          )
        );
        this.offPlay = pick(this.offFormation.plays);
      }
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
      spd: Math.round(Math.hypot(p.vx, p.vy)),
      vmax: Math.round(p.vmax),
      stun: Math.round(p.stun * 100) / 100,
      sep: Math.round(p.sep * 10) / 10,
      burst: Math.round(p.burst * 100) / 100,
      target: p.target,
      blocked: p.blocked,
      shed: p.shed,
      engaged: Math.round(p.engaged * 100) / 100,
      neutralized: this.neutralized(p),
      defRole: p.defRole,
      gap: p.gap,
    }));
  }
  debugPhase() {
    return this.phase;
  }
  debugOffense() {
    return {
      formation: this.offFormation.id,
      play: this.offPlay.id,
      kind: this.offPlay.kind,
      throwTimer: Math.round(this.throwTimer * 100) / 100,
      liveTime: Math.round(this.liveTime * 100) / 100,
      carrier: this.ball.carrier,
      inAir: this.ball.inAir,
    };
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
    const tgt = b.targetId ? this.byId(b.targetId) : null;
    return {
      x: Math.round(b.x),
      y: Math.round(b.y),
      z: Math.round(b.z),
      inAir: b.inAir,
      carrier: b.carrier,
      t: Math.round(b.t * 100) / 100,
      peak: b.peak,
      tx: Math.round(b.tx),
      ty: Math.round(b.ty),
      targetId: b.targetId,
      tgtX: tgt ? Math.round(tgt.x) : null,
      tgtY: tgt ? Math.round(tgt.y) : null,
      tgtToBall: tgt ? Math.round(dist(tgt.x, tgt.y, b.x, b.y) / YARD * 10) / 10 : null,
      tgtToLand: tgt ? Math.round(dist(tgt.x, tgt.y, b.tx, b.ty) / YARD * 10) / 10 : null,
      msg: this.message,
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
    if (!this.userOnOffense()) return DEFENSE_FORMATIONS;
    // a point-after try offers only the convert menu; normal downs hide it
    if (this.tryMode) return OFFENSE_FORMATIONS.filter((f) => f.id === "convert");
    return OFFENSE_FORMATIONS.filter((f) => f.id !== "convert");
  }

  // ---- test harness hooks (drive the engine directly, bypassing the menu and
  //      possession flips so a suite can run a fixed script of plays) ----------
  /** start a fresh HOME offensive series with the LOS at `ownYd` (0-100). */
  testNewSeries(ownYd: number) {
    this.possession = this.userTeam;
    this.tryMode = false;
    this.tryPending = false;
    this.conversion = null;
    this.pendingKickoff = false;
    this.kickMode = null;
    // keep the game from ending mid-sample (the arcade clock would otherwise
    // run out over a long harness run and flip the phase to gameover)
    this.quarter = 1;
    this.clock = QUARTER_SECONDS;
    this.setNewSeries(LEFT_GOAL + ownYd * YARD);
    this.goToPlaycall();
  }
  /** jump straight to a HOME point-after try (snapped from the opponent's 3). */
  testStartTry() {
    this.possession = this.userTeam;
    this.tryPending = false;
    this.conversion = null;
    this.tryMode = true;
    const goal = RIGHT_GOAL; // home attacks right
    this.los = clamp(goal - 3 * YARD, LEFT_GOAL, RIGHT_GOAL);
    this.down = 1;
    this.toGo = 0;
    this.recomputeFirstDown();
    this.goToPlaycall();
  }
  testChoose(formationId: string, playId: string) {
    this.choosePlay(formationId, playId);
  }
  /** reseed the RNG so repeated identical play scripts sample real variance. */
  testReseed(s: number) {
    reseed(s >>> 0);
  }
  /** AI-drive the ball carrier on runs (so the suite isn't a motionless back). */
  testAutoCarrier(on: boolean) {
    this.testAutoRun = on;
  }
  /** flat per-side rating override (offense, defense). null = real rosters.
   *  Lets the harness measure avg-vs-avg baselines and clean tier mismatches. */
  testTiers(off: number | null, def: number | null) {
    this.testFlatOff = off;
    this.testFlatDef = def;
  }
  /** force the defensive matchup (formation+call); null = random AI defense. */
  testDefense(formationId: string | null, playId: string | null) {
    this.testDefFormation = formationId;
    this.testDefPlay = playId;
  }
  /** list available formation/play ids so a harness can enumerate matchups. */
  testPlaybooks() {
    return {
      offense: OFFENSE_FORMATIONS.map((f) => ({ id: f.id, plays: f.plays.map((p) => ({ id: p.id, kind: p.kind })) })),
      defense: DEFENSE_FORMATIONS.map((f) => ({ id: f.id, plays: f.plays.map((p) => ({ id: p.id, cov: p.coverage, blitz: p.blitzers })) })),
    };
  }
  /** read + reset the tackle-contest counters (broken-tackle rate). */
  testBreakStats() {
    const r = { attempts: this.tkAttempts, breaks: this.tkBreaks };
    this.tkAttempts = 0;
    this.tkBreaks = 0;
    return r;
  }
  testSnap() {
    if (this.phase === "presnap") this.snap();
  }
  testThrowOpen() {
    const r = this.bestReceiver();
    if (r) this.throwTo(r.id);
  }
  /** throw to a specific receiver slot key ("1".."4") — for depth/coverage tests. */
  testThrowTo(key: string) {
    const r = this.players.find(
      (p) => p.team === this.possession && p.target === key
    );
    if (r) this.throwTo(r.id);
  }
  /** snapshot of the targeted receiver's separation + the in-flight ball, so the
   *  harness can bucket catches by depth and contested/open. */
  testReceivers() {
    const off = this.possession;
    return this.players
      .filter((p) => p.team === off && p.target)
      .map((p) => {
        let nd = Infinity;
        for (const d of this.players) {
          if (d.team === off) continue;
          nd = Math.min(nd, dist(p.x, p.y, d.x, d.y));
        }
        return {
          key: p.target,
          sep: Math.round((nd / YARD) * 10) / 10,
          depth: Math.round((this.offDir() * (p.x - this.los)) / YARD),
        };
      });
  }
  testState() {
    return {
      phase: this.phase,
      possession: this.possession,
      score: { ...this.score },
      msg: this.message,
      los: Math.round(this.los),
      conversion: this.conversion,
      tryMode: this.tryMode,
      kickMode: this.kickMode,
      carrier: this.ball.carrier,
      inAir: this.ball.inAir,
      play: this.offPlay.id,
      kind: this.offPlay.kind,
      liveTime: Math.round(this.liveTime * 100) / 100,
    };
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
      this.attachRatings(p, offTeam, f.slot);
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
      this.attachRatings(p, defTeam, f.slot);
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

    // build sprites (skipped in headless: the sim runs without rendering)
    if (!this.headless) {
      for (const p of this.players) this.makeSprite(p);
      // keep the ball drawn on top of every player sprite
      this.world.addChild(this.ballGfx);
    }

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
    this.liveTime = 0;
    this.kickMode = null;
    // fresh matchup state for the new play
    for (const p of this.players) {
      p.shed = false;
      p.shedBy = undefined;
      p.stun = 0;
      p.engaged = 0;
      p.burst = 0;
    }
    this.pressJam();
    const offTeam = this.possession;
    const ball = this.ball;

    // a point-after try: PAT kick, or a one-shot run/pass for two
    if (this.tryMode) {
      this.conversion = this.offPlay.kind === "pat" ? "pat" : "two";
    }

    if (
      this.offPlay.kind === "fg" ||
      this.offPlay.kind === "punt" ||
      this.offPlay.kind === "pat"
    ) {
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
  private startKick(kind: "fg" | "punt" | "pat") {
    this.liveTime = 0;
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

    if (kind === "fg" || kind === "pat") {
      // distance to the posts (back of end zone = +10 from goal line); a PAT is
      // a fixed short kick, always inside range.
      const yds = kind === "pat" ? 20 : Math.abs(goalX - b.sx) / YARD + 10;
      this.kickGood = yds <= 65 && rng() < this.fgProb(yds);
      b.tx = goalX + dir * (this.kickGood ? 14 * YARD : 2 * YARD);
      b.ty = WORLD_H / 2 + (this.kickGood ? 0 : (rng() - 0.5) * 8 * YARD);
      b.peak = 3.2 * YARD;
      b.ftime = Math.max(0.7, (Math.abs(b.tx - b.sx) / KICK_SPEED) * 1.1);
      this.message = kind === "pat" ? "EXTRA POINT…" : "FIELD GOAL…";
    } else {
      // punt: gross scales with the punter's leg (league-avg ~75 -> 38-46yd), with
      // a touchback if it reaches the end zone. A better leg = more gross.
      const puntYds = 38 + (this.kickerRating() - 75) * 0.22 + rng() * 8;
      let landX = b.sx + dir * puntYds * YARD;
      if (dir > 0 ? landX >= goalX : landX <= goalX) landX = goalX; // touchback
      b.tx = landX;
      b.ty = WORLD_H / 2 + (rng() - 0.5) * 6 * YARD;
      b.peak = 3.6 * YARD;
      b.ftime = Math.max(0.9, (Math.abs(b.tx - b.sx) / KICK_SPEED) * 1.3);
      this.message = "PUNT…";
    }
  }

  /** the kicking team's kicker rating (KIC); league-average ~75 when unrated. */
  private kickerRating() {
    const k = this.byId(`${this.possession}_K`) ?? this.byId(`${this.possession}_QB`);
    const v = k ? rate(k.rat, "KIC") : 75;
    return v === 70 ? 75 : v; // unrated (default 70) -> treat as league-average 75
  }

  /** FG make probability vs distance, NFL-anchored flat-then-cliff curve. A kicker
   *  scalar shifts EFFECTIVE distance (a better kicker plays each kick as if it
   *  were several yards shorter) — barely moves short kicks, swings 50+ a lot.
   *  Anchors (75-rated): 25→.97, 35→.94, 45→.78, 53→.70, 60→.33 (design/realism-targets.md). */
  private fgProb(yds: number, kic = this.kickerRating()) {
    const d = yds - (kic - 75) * 0.4; // effective distance
    if (d <= 25) return 0.97;
    if (d <= 35) return lerp(0.97, 0.92, (d - 25) / 10);
    if (d <= 45) return lerp(0.92, 0.78, (d - 35) / 10); // the knee
    if (d <= 53) return lerp(0.78, 0.7, (d - 45) / 8); // shelf
    if (d <= 62) return lerp(0.7, 0.25, (d - 53) / 9); // collapse
    return 0.12;
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
    else if (kind === "pat") this.resolvePAT();
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

  private resolvePAT() {
    this.phase = "dead";
    this.deadTimer = 1.6;
    this.audio.whistle();
    if (this.kickGood) {
      this.score[this.possession] += 1;
      this.message = "EXTRA POINT GOOD! +1";
      this.audio.firstDown();
    } else {
      this.message = "MISSED PAT";
      this.audio.turnover();
    }
    this.conversion = null;
    this.tryMode = false;
    this.pendingKickoff = true;
  }

  /** a two-point conversion play ended: scored => +2, anything else => 0 */
  private endTry(scored: boolean) {
    this.phase = "dead";
    this.deadTimer = 1.6;
    this.audio.whistle();
    if (scored) {
      this.score[this.possession] += 2;
      this.message = "2-POINT IS GOOD! +2";
      this.audio.touchdown();
    } else {
      this.message = "CONVERSION NO GOOD";
      this.audio.turnover();
    }
    this.conversion = null;
    this.tryMode = false;
    this.pendingKickoff = true;
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

    if (!this.headless) {
      this.updateCamera(dt);
      this.render();
    }
    this.input.flush();
    this.pushHud(false); // no-ops when no hud callback is attached (headless)
  }

  // ---- headless sim driver (deterministic, no Pixi/rendering) -------------
  /** enable headless mode: skip all rendering so the sim can be stepped at full
   *  speed in Node. The sim logic (stepLive + update*) is identical to the
   *  browser; only presentation is bypassed, so results are bit-reproducible. */
  setHeadless(on: boolean) {
    this.headless = on;
  }
  /** advance the simulation by one fixed timestep (drive this in a tight loop). */
  testStep(dt: number) {
    this.update(dt);
  }

  private stepLive(dt: number) {
    // clock
    this.clock -= dt;
    if (this.clock <= 0) {
      this.clock = 0;
      this.endQuarterCheck();
    }

    this.throwTimer += dt;
    this.liveTime += dt;
    if (this.switchCooldown > 0) this.switchCooldown -= dt;

    // age engagement from last frame's blocks, clear for this frame, run timers down
    for (const p of this.players) {
      if (p.blocked) p.engaged += dt;
      else p.engaged = Math.max(0, p.engaged - 2 * dt);
      p.blocked = false;
      if (p.stun > 0) p.stun = Math.max(0, p.stun - dt);
      if (p.burst > 0) p.burst = Math.max(0, p.burst - dt);
    }
    this.updateSeparation();

    this.updateBlocking(dt);
    this.updateOffense(dt);
    this.updateDefense(dt);
    this.updateBall(dt);
    this.integrate(dt);
    this.separate();
    this.clampPositions();
    this.checkTackleAndScore();

    // safety net: never let a play hang forever
    if (this.phase === "live" && this.liveTime > 14) {
      const c = this.carrier();
      if (c) this.endPlay({ type: "tackle", spotX: c.x, spotY: c.y });
      else this.endPlay({ type: "incomplete" });
    }
  }

  /** a defender is out of the play while his block holds (and he hasn't shed) */
  private neutralized(p: Player) {
    return p.blocked && !p.shed && p.stun <= 0;
  }

  /** composite the block matchup into a single attacker(defender)/defender(blocker)
   * pair for the contest kernel. The rusher picks his best move vs the blocker. */
  private blockMatchup(blocker: Player, def: Player, pass: boolean) {
    if (pass) {
      const fin = rate(def.rat, "FMV") - rate(blocker.rat, "PBF");
      const pow = Math.max(rate(def.rat, "PWR"), rate(def.rat, "PMV")) - rate(blocker.rat, "PBP");
      return fin >= pow
        ? { atk: rate(def.rat, "FMV"), dfn: rate(blocker.rat, "PBF") }
        : { atk: Math.max(rate(def.rat, "PWR"), rate(def.rat, "PMV")), dfn: rate(blocker.rat, "PBP") };
    }
    // run: defender sheds with BSH/STR vs the blocker's run-block
    return {
      atk: Math.max(rate(def.rat, "BSH"), rate(def.rat, "STR") - 4),
      dfn: Math.max(rate(blocker.rat, "RBK"), rate(blocker.rat, "IBL")),
    };
  }

  /** resolve one blocker-vs-defender engagement through the shared kernel:
   * organic win/loss/stalemate plus pancake (defender knocked down) and blow-by.
   * `lev` is a positioning bias in rating pts: negative = the blocker has good
   * leverage (square, between man and the QB) so technique offsets raw rating. */
  private resolveBlock(blocker: Player, def: Player, pass: boolean, dbl: boolean, dt: number, lev = 0) {
    // a DIFFERENT blocker arriving on a free rusher gets a fresh rep (help/slide)
    if (def.shed && def.shedBy !== blocker.id) {
      def.shed = false;
      def.engaged = 0;
    }
    def.blocked = true;
    if (def.shed || def.stun > 0) return; // still beaten by this same blocker
    const { atk, dfn } = this.blockMatchup(blocker, def, pass);
    const res = contest({
      atk,
      def: dfn,
      kind: pass ? "block" : "shed",
      perFrame: dt,
      firstContact: def.engaged < 0.05,
      momentum: (dbl ? -16 : 0) + lev, // double team / positioning leverage
    });
    if (res.extreme) {
      if (res.delta > 0) {
        def.shed = true; // defender super-win -> clean beat / blow-by
        def.shedBy = blocker.id;
      } else {
        def.stun = 0.55 + 0.65 * res.sev; // PANCAKE: blocker buries him
      }
      return;
    }
    if (res.win) {
      def.shed = true; // beat his block this rep
      def.shedBy = blocker.id;
    }
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

      // test mode: let the engine run the ball carrier on a designed run so the
      // suite exercises the real run game instead of a motionless human-held back
      if (this.testAutoRun && isCarrier && this.offPlay.kind === "run") {
        this.runToGoal(p, dt);
        continue;
      }

      if (isUser) {
        this.applyUserMove(p, dt);
        continue;
      }

      // ball in the air: the target runs to the LANDING spot and adjusts there
      // (the ball's ground speed far exceeds his, so chasing the ball itself
      // would send him backward toward the QB). On a tip everyone attacks the
      // loose ball; others keep running their routes.
      if (ballLoose) {
        if (p.id === this.ball.targetId || (this.ball.tip)) {
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
      } else if (p.route && p.route.length) {
        // route finished — keep working in its final direction (don't stall, so
        // a streak keeps running deep and the QB can throw him open)
        const r = p.route;
        const n = r.length;
        let dx = n >= 2 ? r[n - 1].x - r[n - 2].x : dir * YARD;
        let dy = n >= 2 ? r[n - 1].y - r[n - 2].y : 0;
        const dm = Math.hypot(dx, dy) || 1;
        this.moveToward(p, p.x + (dx / dm) * 5 * YARD, p.y + (dy / dm) * 5 * YARD, dt, 0.8);
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
    if (dist(p.x, p.y, tgt.x, tgt.y) < BLOCK_R * 1.4) {
      this.resolveBlock(p, tgt, false, false, dt); // open-field block, kernel-decided
      if (this.neutralized(tgt)) tgt.x -= dir * 0.4; // sustain: shove off the path
    }
  }

  private aiQuarterback(p: Player, dt: number) {
    const dir = this.offDir();
    const dropDepth = 4 * YARD;
    const dropX = p.ox - dir * dropDepth;
    if (dir > 0 ? p.x > dropX : p.x < dropX) {
      this.moveToward(p, dropX, p.y, dt, 0.85);
    } else {
      p.dvx = 0;
      p.dvy = 0;
    }
    // let the routes develop (~1.1s) then throw to the most open man; bail
    // earlier only under real pressure (gets the ball out instead of a sack)
    const rush = this.nearestOpp(p);
    const pressured = rush && dist(p.x, p.y, rush.x, rush.y) < 2.2 * YARD;
    if (this.throwTimer > 1.1 || (pressured && this.throwTimer > 0.5)) {
      const tgt = this.bestReceiver();
      if (tgt) this.throwTo(tgt.id);
    }
  }

  private followRoute(p: Player, dt: number) {
    const route = p.route!;
    const wp = route[p.routeIdx];
    this.moveToward(p, wp.x, wp.y, dt, 1);
    const d = dist(p.x, p.y, wp.x, wp.y);
    // momentum-robust advance: a fast receiver can't stop on a dime, so advance
    // when reasonably close OR when he's already run PAST the waypoint (so he
    // never gets stuck circling a break point).
    let advance = d < 1.3 * YARD;
    if (!advance && d < 3.5 * YARD) {
      const vdot = p.vx * (wp.x - p.x) + p.vy * (wp.y - p.y);
      if (vdot < 0) advance = true; // velocity points away => passed it
    }
    if (advance) {
      p.routeIdx++;
      if (p.routeIdx < route.length) this.routeBreak(p); // a break = a separation contest
    }
  }

  /** the defender responsible for this receiver: his man, else the nearest */
  private coveringDefender(wr: Player): Player | null {
    let man: Player | null = null;
    let near: Player | null = null;
    let nd = Infinity;
    for (const d of this.players) {
      if (d.team === wr.team) continue;
      if (d.assignId === wr.id) man = d;
      const dd = dist(d.x, d.y, wr.x, wr.y);
      if (dd < nd) {
        nd = dd;
        near = d;
      }
    }
    return man ?? near;
  }

  /** WR vs coverage at a route break — the kernel decides the SEPARATION (GB-D005
   *  Stage A). A won break opens a PERSISTENT trailing cushion on the defender
   *  (his openness), recovered slowly. Depth-scaled: it's harder to separate deep,
   *  easier underneath; zone gives more underneath cushion (soft spots). */
  private routeBreak(wr: Player) {
    const db = this.coveringDefender(wr);
    if (!db || dist(db.x, db.y, wr.x, wr.y) > 4 * YARD) return; // uncovered: no contest
    const depth = Math.abs(this.offDir() * (wr.x - this.los)) / YARD;
    const zone = (db.job ?? "man") === "zone";
    // deeper routes separate less (the DB has more cushion to react); zone underneath
    // gives the WR a soft window. leverage favours the WR less as depth grows.
    const lev = (zone ? 4 : 0) - clamp((depth - 8) * 0.6, -3, 9);
    const atk = (rate(wr.rat, "RRM") + rate(wr.rat, "RRS") + rate(wr.rat, "AGI")) / 3;
    const dfn = (rate(db.rat, "MCV") + rate(db.rat, "AGI")) / 2;
    const res = contest({ atk, def: dfn, kind: "cut", firstContact: true, leverage: lev });
    if (res.win) {
      wr.burst = 0.35 + 0.25 * res.sev;
      // open by ~1.5-3.5yd underneath, less deep; an extreme win (double move) more.
      const open = (zone ? 1.9 : 1.6) + 2.0 * res.sev - clamp((depth - 10) * 0.05, 0, 1.2);
      db.cushion = Math.max(db.cushion, open);
      if (res.extreme) db.stun = 0.3 + 0.45 * res.sev;
    } else {
      db.burst = 0.3; // DB stays in phase / jumps the break
      db.cushion = Math.min(db.cushion, 0.4); // blanketed
    }
  }

  /** at the snap, a press corner tries to get a good jam — but he CANNOT impede
   * the receiver (no contact rules until the ball is touched). The contest only
   * decides positioning: win = the DB stays on top in phase; loss = the WR wins
   * a clean release. The receiver is never stunned/held. */
  private pressJam() {
    if (this.defPlay.coverage !== "man" || (this.defPlay.press ?? 0) < 0.5) return;
    for (const wr of this.eligibleReceivers()) {
      const db = this.players.find((d) => d.assignId === wr.id);
      if (!db || dist(db.x, db.y, wr.x, wr.y) > 2.5 * YARD) continue;
      const jam = contest({
        atk: rate(wr.rat, "RLS"),
        def: rate(db.rat, "PRS"),
        kind: "jam",
        firstContact: true,
      });
      if (jam.win) wr.burst = 0.35; // WR wins the release
      else db.burst = 0.3; // DB stays in phase off the line (positioning only)
    }
  }

  /** per-receiver separation (yards to nearest defender) for the catch model */
  private updateSeparation() {
    for (const wr of this.players) {
      if (!wr.target) continue;
      let nd = Infinity;
      for (const d of this.players) {
        if (d.team === wr.team) continue;
        nd = Math.min(nd, dist(d.x, d.y, wr.x, wr.y));
      }
      wr.sep = nd === Infinity ? 99 : nd / YARD;
    }
  }

  private runToGoal(p: Player, dt: number) {
    const dir = this.offDir();
    const goalX = dir > 0 ? RIGHT_GOAL + ENDZONE * YARD : LEFT_GOAL - ENDZONE * YARD;
    // on a designed run, aim through the hole until past the line, then turn upfield
    const behindLine = dir * (p.x - this.los) < 1.5 * YARD;
    if (this.offPlay.kind === "run" && behindLine) {
      const baseHoleY = clamp(
        WORLD_H / 2 + (this.offPlay.hole ?? 0) * YARD,
        SIDELINE,
        WORLD_H - SIDELINE
      );
      // VISION: aim at the most open lane near the designed hole rather than
      // running blindly into it. The back reads the front and cuts to daylight,
      // so a free defender filling the designed gap doesn't auto-stuff the run.
      let bestY = baseHoleY;
      let bestScore = -Infinity;
      const fillX = this.los + dir * 1 * YARD;
      for (let off = -7; off <= 7; off += 1) {
        const ly = clamp(baseHoleY + off * YARD, SIDELINE + YARD, WORLD_H - SIDELINE - YARD);
        let nd = Infinity;
        for (const d of this.players) {
          if (d.team === p.team || this.neutralized(d) || d.stun > 0) continue;
          if (Math.abs(dir * (d.x - this.los)) > 4 * YARD) continue; // only defenders near the LOS
          nd = Math.min(nd, dist(fillX, ly, d.x, d.y));
        }
        const score = nd - Math.abs(ly - baseHoleY) * 0.35; // prefer open AND near the call
        if (score > bestScore) {
          bestScore = score;
          bestY = ly;
        }
      }
      this.moveToward(p, this.los + dir * 4 * YARD, bestY, dt, 1);
      return;
    }
    // past the line: ALWAYS press downfield, sliding laterally to the most open
    // lane. (The old code let the avoidance vector point backward and cancel the
    // forward drive, so a surrounded back froze in the pile for a full second
    // instead of falling forward.) Avoidance only steers sideways now.
    let lat = 0;
    let nearestAhead = Infinity;
    for (const d of this.players) {
      if (d.team === p.team) continue;
      const dd = dist(p.x, p.y, d.x, d.y);
      const downfield = dir * (d.x - p.x); // >0 = defender is ahead of the back
      if (dd < 5 * YARD && dd > 1 && downfield > -1.5 * YARD) {
        const w = (5 * YARD - dd) / (5 * YARD);
        lat += ((p.y - d.y) / dd) * w; // cut away from him laterally
        if (this.neutralized(d) === false && dd < nearestAhead) nearestAhead = dd;
      }
    }
    // hit the second level with a burst: a clean crease (no free defender close
    // ahead) lets the back accelerate into open space — this is what turns a
    // 3-yard gain into an explosive run instead of getting run down at the LOS.
    if (nearestAhead > 3 * YARD) p.burst = Math.max(p.burst, 0.25);
    const ty = clamp(p.y + lat * 3.5 * YARD, SIDELINE, WORLD_H - SIDELINE);
    const tx = p.x + dir * 6 * YARD; // commit forward, never steer backward
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
        // a defender actively engaged by a blocker is CONTROLLED by that block
        // (driveBlock/engageBlock position him) — he can't also run his own
        // pursuit, or he'd drift into the backfield through the block. Zero his
        // intent and let the block move him.
        if (this.neutralized(p)) {
          p.dvx = 0;
          p.dvy = 0;
          continue;
        }
        // on a run, runFit governs the whole front+secondary (gap discipline for
        // the box, CONTAIN for the DBs) until the back clears the front seven —
        // it internally flips to pursuit once he's at the second level. A scramble
        // / catch-and-run is straight pursuit.
        if (this.offPlay.kind === "run") {
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
    this.moveToward(p, to.x, to.y, dt, this.neutralized(p) ? 0.4 : 1);
  }

  /** gap-discipline run fit: hold your gap at the LOS until the back commits,
   * so the front doesn't all crash one point and a crease can open */
  private runFit(p: Player, carrier: Player, dt: number) {
    const dir = this.offDir();
    const past = dir * (carrier.x - this.los); // yards the back is past the LOS
    // once the back clears the front seven (~3yd), the fit is broken — everyone
    // pursues, including the secondary rallying to the ball.
    if (past > 3 * YARD) {
      this.pursueCarrier(p, carrier, dt);
      return;
    }
    const frontSeven = p.defRole === "DL" || p.defRole === "LB";
    if (!frontSeven || p.gap === undefined) {
      // DBs play CONTAIN: hold a cushion downfield and don't crash the mesh point;
      // they rally once the back breaks past the front (handled above).
      const cx = this.los + dir * 3.5 * YARD; // contain depth
      const cy = clamp(
        carrier.y + Math.sign(carrier.y - WORLD_H / 2 || 1) * 1.5 * YARD,
        SIDELINE,
        WORLD_H - SIDELINE
      );
      this.moveToward(p, cx, cy, dt, this.neutralized(p) ? 0.4 : 0.6);
      return;
    }
    const gx = this.los + dir * 0.5 * YARD;
    const gy = clamp(WORLD_H / 2 + p.gap * YARD, SIDELINE, WORLD_H - SIDELINE);
    // hold the gap until the back is right on top of it, then FILL it. A run
    // defender meets the back at the line of scrimmage — he does not chase a deep
    // back into the backfield (that penetration was hitting the i-form back 3-4yd
    // deep and turning routine runs into stuffs). Fill point tracks the back's
    // lane but never past ~1yd into the backfield.
    const threat = dist(carrier.x, carrier.y, gx, gy) < 2.8 * YARD;
    if (threat) {
      const to = this.intercept(p, carrier);
      const fillX = this.los + dir * 1 * YARD; // fill at the line, not in the backfield
      const tx = dir > 0 ? Math.min(to.x, fillX) : Math.max(to.x, fillX);
      this.moveToward(p, tx, to.y, dt, this.neutralized(p) ? 0.4 : 1);
    } else {
      this.moveToward(p, gx, gy, dt, this.neutralized(p) ? 0.35 : 0.9);
    }
  }

  private rushPasser(p: Player, carrier: Player | null, dt: number) {
    const aim = carrier ?? { x: this.los, y: WORLD_H / 2, vx: 0, vy: 0 } as Player;
    const to = carrier ? this.intercept(p, carrier) : { x: aim.x, y: aim.y };
    this.moveToward(p, to.x, to.y, dt, this.neutralized(p) ? 0.4 : 1);
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
    // TRAIL technique: mirror the receiver but play slightly BEHIND him (toward
    // the LOS) rather than sitting downfield in the throwing lane — so the WR
    // shields the ball and a led throw doesn't drop right onto the DB. The DB
    // can still close and contest at the catch (jump-ball) and undercut inbreakers.
    const dir = this.offDir();
    const aim = this.intercept(p, cover);
    // trail the man by the cushion he gave up on the break (GB-D005 Stage A),
    // recovered slowly (~0.5yd/s) so a beaten DB STAYS beaten through the catch
    // rather than being re-glued by perfect pursuit. Cushion is along the WR's path.
    p.cushion = Math.max(0, p.cushion - 0.5 * dt);
    const sp = Math.hypot(cover.vx, cover.vy) || 1;
    const cush = p.cushion * YARD;
    this.moveToward(
      p,
      aim.x - (cover.vx / sp) * cush - dir * 0.6 * YARD,
      aim.y - (cover.vy / sp) * cush,
      dt,
      0.99
    );
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
      // same cushion trail as man: a zone defender beaten across his face stays a
      // step behind (the soft window), recovered slowly.
      p.cushion = Math.max(0, p.cushion - 0.5 * dt);
      const sp = Math.hypot(tgt.vx, tgt.vy) || 1;
      const cush = p.cushion * YARD;
      this.moveToward(p, aim.x - (tgt.vx / sp) * cush, aim.y - (tgt.vy / sp) * cush, dt, 0.95);
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
  private updateBlocking(dt: number) {
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
      this.passProtect(blockers, carrier, dt);
    } else if (this.offPlay.kind === "run") {
      this.runBlock(blockers, carrier, dt);
    } else {
      // scramble / after the catch — wall off pursuit
      for (const ol of blockers) this.downfieldBlock(ol, carrier, dt);
    }
  }

  /** threat-based pass protection: every blocker always picks up the most
   * dangerous free rusher. A rusher who BEAT his block (shed) becomes the top
   * priority so a free lineman peels off to him instead of standing around. */
  private passProtect(blockers: Player[], carrier: Player | null, dt: number) {
    const protect = carrier ?? { x: this.los, y: WORLD_H / 2 };
    const rush = this.players.filter((p) => this.rushers.has(p.id));
    if (!rush.length) {
      for (const ol of blockers) {
        ol.dvx = 0;
        ol.dvy = 0;
      }
      return;
    }
    // danger: closer to the QB = more urgent; a rusher who's BEATEN his man (shed,
    // not currently held by anyone) jumps the queue so a blocker redirects to him.
    const danger = (r: Player) =>
      dist(r.x, r.y, protect.x, protect.y) - (r.shed ? 500 : 0);
    const threats = rush.slice().sort((a, b) => danger(a) - danger(b));
    const free = blockers.slice();
    const assigns: [Player, Player][] = [];
    // one blocker to each threat, most dangerous first, by nearest free blocker.
    // The blocker who just got beaten by this rusher is deprioritized so a
    // neighbour slides over to pick up the free man instead of him re-chasing.
    for (const t of threats) {
      if (!free.length) break;
      let bi = 0;
      let bd = Infinity;
      for (let i = 0; i < free.length; i++) {
        let d = dist(free[i].x, free[i].y, t.x, t.y);
        if (t.shed && free[i].id === t.shedBy) d += 400; // he already lost this rep
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      assigns.push([free.splice(bi, 1)[0], t]);
    }
    // any leftover blockers double the most dangerous threat (never idle)
    for (const ol of free) assigns.push([ol, threats[0]]);

    const cnt: Record<string, number> = {};
    for (const [, r] of assigns) cnt[r.id] = (cnt[r.id] ?? 0) + 1;
    for (const [ol, r] of assigns) this.engageBlock(ol, r, protect, cnt[r.id] >= 2, dt);
  }

  /** a tackle/guard sets and mirrors a rusher. He KICK-SLIDES to cut off the
   * rusher's path to the QB (leading the rusher, gaining depth) rather than
   * chasing his current spot — so edge speed rushers get ridden up the arc
   * instead of running free around the corner. */
  private engageBlock(ol: Player, r: Player, protect: { x: number; y: number }, dbl: boolean, dt: number) {
    const dx = protect.x - r.x;
    const dy = protect.y - r.y;
    const d = Math.hypot(dx, dy) || 1;
    const qx = dx / d;
    const qy = dy / d;
    // set point: anticipate the rusher, then sit ~1.1yd toward the QB of him so
    // the OL cuts the arc instead of trailing.
    const rx = r.x + r.vx * 0.11;
    const ry = r.y + r.vy * 0.11;
    this.moveTowardRaw(ol, rx + qx * 1.1 * YARD, ry + qy * 1.1 * YARD, 1.12); // pass-set is quicker than a chase
    if (dist(ol.x, ol.y, r.x, r.y) < BLOCK_R * 2.0) {
      // leverage: how squarely is the OL between the rusher and the QB?
      const ox = ol.x - r.x;
      const oy = ol.y - r.y;
      const om = Math.hypot(ox, oy) || 1;
      const align = (ox / om) * qx + (oy / om) * qy; // 1 = directly QB-side of him
      const lev = -(align - 0.15) * 22; // square set -> negative (helps the OL hold)
      this.resolveBlock(ol, r, true, dbl, dt, lev);
      if (this.neutralized(r)) {
        // ride him: wall off and push him away from the QB (up/around the arc)
        r.x -= qx * 0.55;
        r.y -= qy * 0.55;
      }
    }
  }

  /** run blocking: seal the front away from the hole; FB + puller lead through it */
  private runBlock(blockers: Player[], carrier: Player, dt: number) {
    const dir = this.offDir();
    const hole = this.offPlay.hole ?? 0;
    const holeY = clamp(WORLD_H / 2 + hole * YARD, SIDELINE, WORLD_H - SIDELINE);
    const front = this.players.filter(
      (p) => p.team !== carrier.team && (p.defRole === "DL" || p.defRole === "LB")
    );
    const claimed = new Set<string>();
    const pull = this.offPlay.pull;
    const assigns: [Player, Player][] = [];

    const leads = blockers.filter(
      (ol) => ol.id.endsWith("_F") || (pull && ol.id.endsWith("_" + pull))
    );
    const sealers = blockers.filter((ol) => !leads.includes(ol));

    const leadPt = { x: this.los + dir * 4 * YARD, y: holeY };
    for (const ol of leads) {
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
        assigns.push([ol, tgt]);
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
      assigns.push([avail.splice(bi, 1)[0], f]);
    }
    for (const ol of avail) this.moveTowardRaw(ol, this.los + dir * 3 * YARD, holeY, 0.8);

    const cnt: Record<string, number> = {};
    for (const [, f] of assigns) cnt[f.id] = (cnt[f.id] ?? 0) + 1;
    for (const [ol, f] of assigns) this.driveBlock(ol, f, dir, holeY, cnt[f.id] >= 2, dt);
  }

  /** drive a defender off the ball and away from the hole; kernel decides the rep */
  private driveBlock(ol: Player, tgt: Player, dir: number, holeY: number, dbl: boolean, dt: number) {
    // get-off: the OL fire out on the snap count (the DL react), so they win the
    // initial leverage and ENGAGE fast — blocks must be formed by ~0.7s or a fast
    // back outruns them into unblocked DL (GB-T004). Burst the first ~0.6s.
    if (this.liveTime < 0.6) ol.burst = Math.max(ol.burst, 0.6 - this.liveTime);
    this.moveTowardRaw(ol, tgt.x + dir * 0.4 * YARD, tgt.y, 1);
    // engage from snap-alignment range so the block LATCHES before the DL can
    // fire upfield past the blocker — early in the play the OL reaches across the
    // gap (they're ~1yd apart at the snap). The range tightens once the rep is on.
    const engageR = this.liveTime < 0.5 ? BLOCK_R * 3.4 : BLOCK_R * 1.9;
    if (dist(ol.x, ol.y, tgt.x, tgt.y) < engageR) {
      // run blocks favor the blocker: the OL fires out on the snap count while the
      // DL reacts, so run-block win rate is ~75%, not the 50/50 of an even pass rep.
      // (lev<0 slows the defender's shed.) Without this the front over-penetrated
      // and stuffed ~44% even at the base front.
      this.resolveBlock(ol, tgt, false, dbl, dt, -8);
      // ANCHOR: while a blocker is engaged and the defender hasn't shed, the
      // lineman rides him and keeps him OUT of the backfield. Without this every
      // DL shot ~4yd past the LOS and met the deep back behind the line — the
      // dominant cause of the ~50% stuff rate. A shed (beaten) defender penetrates.
      if (tgt.blocked && !tgt.shed && tgt.stun <= 0) {
        const anchor = this.los + dir * 0.5 * YARD;
        if (dir * (tgt.x - anchor) > 0) tgt.x = anchor;
      }
      if (this.neutralized(tgt)) {
        // a WON run block drives the defender off the ball, opening a crease.
        // Kept modest so the lineman keeps CONTACT (over-driving made him lose the
        // engagement range and the block dropped). dt-scaled.
        const push = (dbl ? 4.0 : 2.6) * YARD * dt; // ~2.6–4.0 yd/s of drive
        tgt.x += dir * push; // back toward their own side
        tgt.y += Math.sign(tgt.y - holeY || 1) * push * 0.7; // and away from the hole
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

    // Lead the receiver, but only a CATCHABLE amount: the receiver also runs to
    // the ball, so over-leading by the full flight time just throws it past him
    // (often out of bounds). Cap the lead time, add QB-accuracy scatter, and
    // keep the spot inbounds with a sideline buffer.
    const dir = this.offDir();
    const distYd = dist(qb.x, qb.y, r.x, r.y) / YARD;
    const ft = (distYd * YARD) / PASS_SPEED;
    const lead = Math.min(ft, 0.4); // modest lead — the receiver also tracks the ball
    const accKey = distYd < 20 ? "ACS" : distYd < 40 ? "ACM" : "ACD";
    const acc = rate(qb.rat, accKey);
    const onRun = Math.hypot(qb.vx, qb.vy) > 0.4 * qb.vmax ? 0.4 : 0; // throwing on the move
    const scatter = (1 - acc / 99 + onRun) * 2.0 * YARD;
    let landX = r.x + r.vx * lead + (rng() - 0.5) * 2 * scatter;
    let landY = r.y + r.vy * lead + (rng() - 0.5) * 2 * scatter;
    landX = clamp(landX, LEFT_GOAL - 20, RIGHT_GOAL + 20);
    landY = clamp(landY, SIDELINE + 1.5 * YARD, WORLD_H - SIDELINE - 1.5 * YARD);
    void dir;

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
    b.swatDone = false;
    const throwDist = dist(qb.x, qb.y, landX, landY);
    b.ftime = Math.max(0.32, throwDist / PASS_SPEED);
    // every throw arcs enough to clear underneath defenders; long balls higher
    b.peak = clamp(throwDist * 0.1, 1.0 * YARD, 2.4 * YARD); // flatter -> catchable longer near the landing
    // the targeted receiver auto-runs to the ball and makes the catch; control
    // hands to him only AFTER he catches it (completePass), so the pass plays
    // out the same whether the QB is the human or the CPU.
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
    const offTeam = this.possession;
    const target = b.targetId ? this.byId(b.targetId) : null;

    // The ball is only PLAYABLE while it's within a defender/receiver's jump
    // reach. The arc makes that true in two windows — just off the QB's hand
    // (RELEASE zone: batted at the line) and dropping into the catch (LANDING
    // zone: jump ball) — and false through the high middle of the flight.
    if (b.z > REACH) {
      if (b.t >= 1) this.incomplete();
      return; // sailing high over everyone
    }

    // The catch belongs to the INTENDED receiver — the man auto-running to the
    // landing spot. (Every eligible receiver carries a formation `target` key,
    // so picking "nearest with a target" would let an unrelated WR who happens
    // to drift past steal the ball.) Find the nearest defender separately.
    const rec = target && target.target ? target : null;
    const rd = rec ? dist(rec.x, rec.y, b.x, b.y) : Infinity;
    let nd: Player | null = null;
    let ndDist = Infinity;
    for (const p of this.players) {
      if (p.team === offTeam) continue;
      const d = dist(p.x, p.y, b.x, b.y);
      if (d < ndDist) {
        ndDist = d;
        nd = p;
      }
    }

    const fromQB = dist(b.x, b.y, b.sx, b.sy);
    const toLand = dist(b.x, b.y, b.tx, b.ty);
    // a defender close enough to the ball to genuinely contest the catch
    const contestDef = nd && ndDist <= CATCH_AREA ? nd : null;

    // ---- LANDING ZONE: ball dropping into the catch area, both can play it ----
    // Gated on PROXIMITY to the landing (not flight time): the receiver waits at
    // the spot, so resolving only once the ball is actually within reach avoids
    // missing the catch while the ball is still yards up-path. b.t>=1 is the
    // backstop, but at t=1 the ground position IS the landing, so toLand<LAND_ZONE
    // already covers it.
    if (toLand < LAND_ZONE || b.t >= 1) {
      // the receiver gets his ball unless a defender is clearly closer to it
      if (rec && rd <= CATCH_AREA && (!nd || rd <= ndDist + LEAD_MARGIN)) {
        return this.resolveCatch(rec, contestDef, ndDist);
      }
      if (nd && ndDist <= CATCH_AREA) {
        return this.resolveDefenderBall(nd, target, ndDist);
      }
      if (b.t >= 1) this.incomplete();
      return;
    }

    // ---- RELEASE ZONE: a defender under the low ball gets ONE deflection
    //      attempt at the line (a one-shot latch, so the per-frame check can't
    //      re-roll a near-certain swat while the ball clears the rusher). ----
    if (fromQB < RELEASE_ZONE) {
      if (nd && ndDist <= SWAT_R && !b.swatDone) {
        b.swatDone = true;
        return this.resolveLineSwat(nd);
      }
      if (rec && rd <= CATCH_R) return this.resolveCatch(rec, contestDef, ndDist); // quick screen
      return;
    }

    // ---- MID FLIGHT but still low (a flat throw): only a defender directly
    //      under it, clearly ahead of the receiver, can undercut it ----
    if (nd && ndDist <= DEFLECT_R && (!rec || ndDist < rd - LEAD_MARGIN)) {
      return this.resolveDefenderBall(nd, target, ndDist);
    }
    if (rec && rd <= CATCH_R) return this.resolveCatch(rec, contestDef, ndDist);
  }

  /** a defender under the low release gets one swing at the ball; most of the
   *  time the throw clears his outstretched arm, occasionally he gets a piece. */
  private resolveLineSwat(d: Player) {
    const roll = rng();
    if (roll < 0.72) return; // clears the rusher's reach — the common case
    if (roll < 0.78) return this.interception(d); // 6% pick at the line
    if (roll < 0.88) return this.startTip(d); // 10% tipped up — live ball
    return this.batDown(); // 12% knocked down (incomplete)
  }

  /** the intended receiver is at the ball: open => catch (rare drop); contested
   * => a ratings contest (more separation favours the WR) for catch / PBU / INT */
  private resolveCatch(rec: Player, nd: Player | null, ndDist: number) {
    const sep = (nd ? ndDist : 99) / YARD;
    if (!nd || sep > 1.6) {
      const drop = clamp((88 - rate(rec.rat, "CTH")) / 350, 0.01, 0.12);
      return rng() < drop ? this.incomplete() : this.completePass(rec);
    }
    const atk = (rate(rec.rat, "CTH") + rate(rec.rat, "CIT") + rate(rec.rat, "SPC")) / 3;
    const dfn = (rate(nd.rat, "INT") + rate(nd.rat, "JMP") + rate(nd.rat, "MCV")) / 3;
    const res = contest({
      atk,
      def: dfn,
      kind: "catch",
      firstContact: true,
      // it's HIS ball — he's tracking it and boxing out (+14); separation helps more
      leverage: 14 + (sep - 0.7) * 14,
    });
    if (res.win) return this.completePass(rec);
    // a contested LOSS is almost always a pass break-up; a pick only when the
    // defender decisively won the jump ball, a tipped ball now and then.
    if (res.extreme) return this.interception(nd);
    return rng() < 0.12 ? this.startTip(nd) : this.batDown();
  }

  /** a defender truly undercut the route (no receiver at the ball) */
  private resolveDefenderBall(nd: Player, target: Player | null, ndDist: number) {
    const dfn = (rate(nd.rat, "INT") + rate(nd.rat, "JMP") + rate(nd.rat, "MCV")) / 3;
    const atk = target ? (rate(target.rat, "CTH") + rate(target.rat, "CIT")) / 2 : 64;
    const res = contest({
      atk: dfn,
      def: atk,
      kind: "catch",
      firstContact: true,
      leverage: clamp((2 - ndDist / YARD) * 8, 0, 16),
    });
    if (res.win && res.extreme) return this.interception(nd); // cleanly picked
    return this.incomplete(); // off-target throw knocked away — no play
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
  /** attach pre-baked ratings + derive kinematics (px units) from SPD/ACC/AGI */
  private attachRatings(p: Player, team: Team, slot: string) {
    let r = ROSTERS[team][rosterKey(slot, p.defRole)];
    // test-only: override a side's ratings with a flat tier value so the harness
    // can measure neutral (avg-vs-avg) baselines and clean tier mismatches,
    // instead of being skewed by the two boom-bust POC rosters.
    const flat = team === "home" ? this.testFlatOff : this.testFlatDef;
    if (flat != null) r = new Proxy({} as Record<string, number>, { get: () => flat });
    p.rat = r;
    const SPD = rate(r, "SPD");
    const ACC = rate(r, "ACC");
    const AGI = rate(r, "AGI");
    p.vmax = (8.0 + (SPD - 70) * 0.075) * YARD; // ~6.5..10.2 yd/s
    // 0->top in ~0.8-1.0s (was ~1.35s, which made a 5yd-deep i-form back crawl to
    // the LOS at half speed and meet the converged defense with no juice — a hidden
    // cause of the high stuff rate; see N-001/GB-T001). Kept moderate so the back
    // doesn't outrun his own blocking development.
    p.vacc = 200 + (ACC - 70) * 5; // px/s^2
    p.vturn = 650 + (AGI - 70) * 8; // px/s^2: full-speed turn radius ~2.4-4yd
  }

  /** steering integrator: chase desired velocity with finite accel + turn rate,
   * so bodies carry momentum and arc through cuts instead of teleport-pivoting */
  private integrate(dt: number) {
    for (const p of this.players) {
      if (p.stun > 0) {
        // knocked down / off balance: bleed speed, no steering
        p.vx *= 0.82;
        p.vy *= 0.82;
      } else {
        const sp = Math.hypot(p.vx, p.vy);
        let hx: number;
        let hy: number;
        if (sp > 1) {
          hx = p.vx / sp;
          hy = p.vy / sp;
        } else {
          const dm = Math.hypot(p.dvx, p.dvy) || 1;
          hx = p.dvx / dm;
          hy = p.dvy / dm;
        }
        const dvx = p.dvx - p.vx;
        const dvy = p.dvy - p.vy;
        // split desired change into along-heading (accel/brake) and perpendicular (turn)
        const along = dvx * hx + dvy * hy;
        let ax = along * hx;
        let ay = along * hy;
        let px = dvx - ax;
        let py = dvy - ay;
        const accelCap = (along >= 0 ? p.vacc : p.vacc * 1.7) * dt; // brake faster
        const turnCap = p.vturn * dt;
        const al = Math.abs(along);
        if (al > accelCap) {
          const k = accelCap / al;
          ax *= k;
          ay *= k;
        }
        const pl = Math.hypot(px, py);
        if (pl > turnCap) {
          const k = turnCap / pl;
          px *= k;
          py *= k;
        }
        p.vx += ax + px;
        p.vy += ay + py;
        // never exceed what's being asked for (desired magnitude = turbo/speedMul aware)
        const cap = Math.max(8, Math.hypot(p.dvx, p.dvy));
        const vs = Math.hypot(p.vx, p.vy);
        if (vs > cap) {
          const k = cap / vs;
          p.vx *= k;
          p.vy *= k;
        }
      }
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

    // tackle on contact with a FREE defender (an engaged blocker can't make the
    // tackle — that's what makes blocks matter). The hit is a ratings CONTEST,
    // not an automatic stop: a back with momentum can break a solo arm tackle for
    // extra yards, while gang tackling brings him down. Pick the nearest free
    // defender in range and count how many are converging (the gang).
    let tk: Player | null = null;
    let tkd = Infinity;
    let gang = 0;
    for (const p of this.players) {
      if (p.team === c.team) continue;
      if (this.neutralized(p) || p.stun > 0) continue; // engaged or knocked down
      const d = dist(p.x, p.y, c.x, c.y);
      if (d < TACKLE_R) {
        gang++;
        if (d < tkd) {
          tkd = d;
          tk = p;
        }
      }
    }
    if (tk) {
      // brought down in his own end zone = safety, no contest
      if (dir > 0 ? c.x <= ownGoal : c.x >= ownGoal) {
        this.safety();
        return;
      }
      const atkR =
        (rate(tk.rat, "TAK") + rate(tk.rat, "HIT") + rate(tk.rat, "PWR") + rate(tk.rat, "PUR")) / 4;
      const defR =
        (rate(c.rat, "BTK") + rate(c.rat, "ELU") + rate(c.rat, "TRK") + rate(c.rat, "AGI")) / 4;
      const spd = Math.min(1, Math.hypot(c.vx, c.vy) / (c.vmax || 1));
      const userTurbo =
        c.id === this.controlledId && this.userOnOffense() && this.input.turbo();
      const res = contest({
        atk: atkR,
        def: defR,
        kind: "tackle",
        firstContact: true,
        // tackling is the default outcome (+10); each extra converging defender
        // makes a break far less likely (+13); a sprinting human gets a nudge.
        // NOTE (GB-T001): lowering these INCREASES stuffs (counterintuitive
        // feedback loop in the break/burst dynamics — see N-001). Do not lower
        // without instrumenting why first.
        leverage: 10 + (gang - 1) * 13 - (userTurbo ? 8 : 0),
        momentum: -spd * 12, // a back at full speed runs through arm tackles
      });
      this.tkAttempts++;
      if (res.win) {
        this.audio.tackle();
        this.endPlay({ type: "tackle", spotX: c.x, spotY: c.y });
        return;
      }
      // BROKEN TACKLE: the would-be tackler is shaken off (stunned out of the
      // pursuit) and the back bursts forward. The stun latches this defender so
      // he can't instantly re-contest the same frame.
      this.tkBreaks++;
      tk.stun = 0.45 + res.sev * 0.5;
      c.burst = Math.max(c.burst, 0.35 + res.sev * 0.4);
      this.audio.tackle();
    }
  }

  // ---- movement helpers --------------------------------------------------
  private pps(p: Player) {
    return p.vmax; // top speed in px/s (rating-derived)
  }

  private applyUserMove(p: Player, _dt: number) {
    const a = this.input.axis();
    const mag = Math.hypot(a.x, a.y);
    const sp = p.vmax * (this.input.turbo() ? TURBO : 1);
    if (mag > 0.01) {
      p.dvx = (a.x / mag) * sp * Math.min(1, mag);
      p.dvy = (a.y / mag) * sp * Math.min(1, mag);
    } else {
      p.dvx = 0;
      p.dvy = 0;
    }

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
    // set DESIRED velocity toward the target; the integrator handles momentum.
    const dx = tx - p.x;
    const dy = ty - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const sp = p.vmax * clamp(speedMul, 0, 1.4) * (p.burst > 0 ? 1.18 : 1);
    // ease off near the target so bodies settle instead of jittering
    const ease = d < 0.6 * YARD ? d / (0.6 * YARD) : 1;
    p.dvx = (dx / d) * sp * ease;
    p.dvy = (dy / d) * sp * ease;
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
    // a two-point try that didn't reach the end zone (tackle, incompletion, or
    // turnover) is simply no good — resolve it here, no downs/series bookkeeping.
    if (this.conversion === "two") {
      this.endTry(false);
      return;
    }
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
    // crossing the goal on a two-point play is the conversion, not a TD
    if (this.conversion === "two") {
      this.endTry(true);
      return;
    }
    this.phase = "dead";
    this.deadTimer = 2.0;
    this.score[this.possession] += 6;
    this.message = "TOUCHDOWN!";
    this.audio.whistle();
    this.audio.touchdown();
    this.tryPending = true; // afterPlay sets up the point-after try
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
    // a touchdown sets up the point-after try (PAT kick or two-point play) for
    // the SAME offense, snapped from the opponent's 3, before any kickoff.
    if (this.tryPending) {
      this.tryPending = false;
      this.tryMode = true;
      this.conversion = null;
      const dir = this.offDir();
      const goal = dir > 0 ? RIGHT_GOAL : LEFT_GOAL;
      this.los = clamp(goal - dir * 3 * YARD, LEFT_GOAL, RIGHT_GOAL);
      this.down = 1;
      this.toGo = 0;
      this.recomputeFirstDown();
      this.message = "POINT AFTER";
      this.goToPlaycall();
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
    dvx: 0,
    dvy: 0,
    vmax: SPEED[f.role] * YARD,
    vacc: 116,
    vturn: 650,
    speed: SPEED[f.role],
    hasBall: false,
    controlled: false,
    routeIdx: 0,
    ox: 0,
    oy: 0,
    stun: 0,
    blocked: false,
    engaged: 0,
    shed: false,
    burst: 0,
    sep: 0,
    cushion: 0,
  };
}

// map a game slot to a pre-baked roster entry (POC; groups share ratings)
function rosterKey(slot: string, defRole?: string): string {
  const OFF: Record<string, string> = {
    QB: "QB7", R: "RB28", A: "WR80", B: "WR88", C: "TE84",
    LT: "LT73", LG: "LG66", CEN: "CEN55", RG: "RG67", RT: "RT76", F: "FB44",
  };
  if (OFF[slot]) return OFF[slot];
  if (defRole === "DL") return /E/.test(slot) ? "EDGE91" : "DT93"; // ends vs interior
  if (defRole === "LB") return /M/.test(slot) ? "MLB52" : "OLB56";
  if (defRole === "CB") return /2|N|4/.test(slot) ? "CB22" : "CB24";
  if (defRole === "S") return /F/.test(slot) ? "FS31" : "SS33";
  return "QB7";
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
    swatDone: false,
  };
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

function ord(n: number) {
  return n === 1 ? "1ST" : n === 2 ? "2ND" : n === 3 ? "3RD" : `${n}TH`;
}
