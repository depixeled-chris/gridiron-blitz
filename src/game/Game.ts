import { Application, Container, Graphics, Text } from "pixi.js";
import {
  BLOCK_R,
  CATCH_AREA,
  CATCH_R,
  DEFLECT_R,
  COLORS,
  ENDZONE,
  FIELD_YARDS,
  KICK_SPEED,
  LAND_ZONE,
  LEAD_MARGIN,
  LEFT_GOAL,
  PASS_SPEED,
  RELEASE_ZONE,
  SWAT_R,
  SWAT_Z,
  QUARTER_SECONDS,
  REACH,
  RIGHT_GOAL,
  SIDELINE,
  TACKLE_R,
  TURBO,
  VIEW_H,
  VIEW_W,
  WORLD_H,
  WORLD_W,
  YARD,
  Z_CATCH,
  Z_RELEASE,
  BOUNDS,
} from "./constants";
import { Input } from "./input";
import { Sfx } from "./audio";
import { DEFENSE_FORMATIONS, OFFENSE_BASE, OFFENSE_FORMATIONS } from "./plays";
import { ROSTERS, rate } from "./ratings";
// rng comes from the contest module's SINGLE reseedable stream. Game.ts used to
// pull a second, never-reseedable rng from utils — so throw scatter, swats,
// drops, strips, tips, and kick outcomes ignored testReseed and the
// "deterministic, reproducible" per-play replay contract was quietly half-false.
import { contest, reseed, rng } from "./contest";
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
import { clamp, dist, lerp } from "./utils";

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

/** formations whose snap is a real gun snap (back to a QB off the line) */
const GUN_FORMS = new Set(["shotgun", "spread"]);
/** defensive special-teams units — shown only against a kick */
const ST_DEF_IDS = new Set(["fgblock", "puntreturn"]);
/** the defensive unit that answers each kind of kick */
const ST_DEF_FOR = (kind: string) => (kind === "punt" ? "puntreturn" : "fgblock");

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
  /** impact flash: marks the man who just played the ball (swat/drop/tip) */
  fx: Graphics;
  num: Text;
  label: Text;
  labelBg: Graphics;
}

export class Game {
  private app!: Application;
  private world = new Container();
  private fieldGfx = new Graphics();
  private overlay = new Graphics();
  private ballGfx = new Graphics();
  private meterGfx = new Graphics(); // screen-space kick meter overlay
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
  private score: Record<Team, number> = { home: 0, away: 0 };
  private message = "";
  private controlledId = "";
  private offFormation: OffenseFormation = OFFENSE_FORMATIONS[0];
  private defFormation: DefenseFormation = DEFENSE_FORMATIONS[0];
  private offPlay: OffensePlay = OFFENSE_FORMATIONS[0].plays[0];
  private defPlay: DefensePlay = DEFENSE_FORMATIONS[0].plays[0];
  private kickMode: "fg" | "punt" | "pat" | "kickoff" | null = null;
  private kickGood = false;
  // interactive kick meter (only when the human kicks; AI/headless auto-resolve).
  // Stage "power": a gauge oscillates 0..1, tap locks leg power. Stage "accuracy":
  // a marker sweeps a center sweet-spot (its width set by the kicker rating), tap
  // locks aim. Then the ball launches with that power+aim.
  private kickStage: "power" | "accuracy" | null = null;
  private kickMeter = 0; // 0..1 oscillator position
  private kickMeterDir = 1;
  private kickPower = 0; // locked at the power tap
  private kickDist = 0; // FG yardage (for the required-power calc)
  private kickAccWin = 0.32; // made-window half-width on the -1..1 accuracy axis
  // get-off clock for an AI kick: the ball is DOWN and the play is LIVE between
  // the snap and the launch, so the defense can come after the block. (The human
  // kicker's meter is his own get-off clock — the field runs underneath it.)
  private kickHold = 0;
  /** stage of the kick operation: the snap in flight, then the ball in hand at
   *  the strike point. null once the ball is off the foot (or the play is over). */
  private kickOp: "snap" | "hold" | null = null;
  private kickOpT = 0;
  private kickSnapTime = 0.6;
  /** this snap is getting away from the snapper (rolled at the snap) */
  private kickBadSnap = false;
  /** why the last pass died — survives endPlay's generic "INCOMPLETE" stamp */
  private deadReason = "";
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
    this.app.stage.addChild(this.meterGfx); // screen-space HUD, on top of the world
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
    // Fit the full field HEIGHT to the screen, then scroll horizontally (the field
    // is 5:1, always wider than any screen, so the camera scrolls and never shows
    // a side gap). Scale to EXACTLY fill viewH on any aspect ratio — no upper clamp.
    // The old clamp(., 0.5, 1.6) capped the zoom at 1.6, so any viewport taller than
    // 1.6*WORLD_H (~845px: every desktop, some phones) letterboxed top+bottom — the
    // "white space". A floor (0.5) only guards absurdly short viewports (<264px).
    this.worldScale = Math.max(this.viewH / WORLD_H, 0.5);
    this.world.scale.set(this.worldScale);
    const span = WORLD_H * this.worldScale;
    this.world.y = Math.max(0, (this.viewH - span) / 2); // 0 when filling
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
    // The contest stream is seeded from a CONSTANT at module load so the
    // headless suite replays identically. That means a real game replayed the
    // same rolls on every page load — the opening coin flip was literally the
    // same result every time. Seed a live game from real entropy; the harness
    // still calls testReseed() for reproducibility.
    if (!this.headless) {
      reseed(((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0) || 1);
    }
    this.score = { home: 0, away: 0 };
    this.quarter = 1;
    this.clock = QUARTER_SECONDS;
    this.possession = "home";
    this.setNewSeries(LEFT_GOAL + 20 * YARD);
    // a game opens with the TOSS — the winner receives, and the loser kicks off
    this.wind = {
      dir: rng() < 0.5 ? 1 : -1,
      mph: Math.round(rng() * 19),
    };
    this.windTarget = this.wind.mph;
    this.windTimer = 20 + rng() * 40;
    this.tossResult = null;
    this.tossChoice = null;
    this.phase = "toss";
    this.message = "COIN TOSS — YOUR CALL";
    this.pushHud(true);
  }

  /** the user calls it in the air. Winning the toss does NOT mean the ball —
   * it means the CHOICE: take the ball, or take the wind and make them kick
   * into it all game. */
  callToss(pick: "heads" | "tails") {
    if (this.phase !== "toss") return;
    this.audio.select();
    const flip: "heads" | "tails" = rng() < 0.5 ? "heads" : "tails";
    const userWon = flip === pick;
    this.tossResult = { flip, userWon };
    this.message = `${flip.toUpperCase()} — ${userWon ? "YOU WIN" : "CPU WINS"} THE TOSS`;
    if (!userWon) {
      // CPU elects: with a strong wind at its back it kicks off (pin them deep
      // and get the ball back with the wind still helping); otherwise it takes
      // the ball.
      const cpu: Team = this.userTeam === "home" ? "away" : "home";
      const cpuDir = cpu === "home" ? 1 : -1;
      const backing = this.wind.mph >= 12 && this.wind.dir === cpuDir;
      this.electToss(backing ? "kick" : "receive", false);
    }
    this.pushHud(true);
  }

  /** the toss winner's election: RECEIVE the kickoff, or KICK it off */
  electToss(choice: "receive" | "kick", byUser = true) {
    if (this.phase !== "toss" || !this.tossResult) return;
    if (byUser && !this.tossResult.userWon) return;
    const winner: Team = this.tossResult.userWon
      ? this.userTeam
      : this.userTeam === "home"
        ? "away"
        : "home";
    const loser: Team = winner === "home" ? "away" : "home";
    const receiving: Team = choice === "receive" ? winner : loser;
    this.kickingTeam = receiving === "home" ? "away" : "home";
    this.openingKicker = this.kickingTeam; // the halves swap off this
    this.tossChoice = choice;
    this.message =
      choice === "kick"
        ? `${this.tossResult.userWon ? "YOU KICK" : "CPU KICKS"} OFF`
        : `${this.tossResult.userWon ? "YOU RECEIVE" : "CPU RECEIVES"}`;
    this.openingKickoff = true;
    this.pushHud(true);
  }

  /** React polls this to render the toss screen */
  tossState() {
    return this.tossResult
      ? { ...this.tossResult, choice: this.tossChoice, wind: { ...this.wind } }
      : null;
  }
  /** the user taps through the toss result into the opening kickoff */
  startFromToss() {
    if (this.phase !== "toss" || !this.openingKickoff) return;
    this.openingKickoff = false;
    this.startKickoff(this.kickingTeam);
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
      // defense: a forced matchup (tests) or the CPU's situational call
      if (this.testDefFormation) {
        this.defFormation =
          DEFENSE_FORMATIONS.find((x) => x.id === this.testDefFormation) ??
          DEFENSE_FORMATIONS[0];
        this.defPlay =
          this.defFormation.plays.find((p) => p.id === this.testDefPlay) ??
          this.defFormation.plays[0];
      } else if (this.offPlay.kind === "fg" || this.offPlay.kind === "pat" || this.offPlay.kind === "punt") {
        // the user is kicking — the CPU answers with the matching ST unit
        this.defFormation =
          DEFENSE_FORMATIONS.find((x) => x.id === ST_DEF_FOR(this.offPlay.kind))!;
        this.defPlay = pick(this.defFormation.plays);
      } else {
        this.cpuCallDefense();
      }
    } else {
      const f =
        DEFENSE_FORMATIONS.find((x) => x.id === formationId) ??
        DEFENSE_FORMATIONS[0];
      this.defFormation = f;
      this.defPlay = f.plays.find((p) => p.id === playId) ?? f.plays[0];
      if (this.tryMode) {
        // CPU always kicks the extra point on its point-after try — off the
        // real place-kick unit (kicker + holder), same as a field goal
        this.offFormation =
          OFFENSE_FORMATIONS.find((x) => x.id === "placekick")!;
        this.offPlay =
          this.offFormation.plays.find((p) => p.kind === "pat") ??
          this.offFormation.plays[0];
      } else {
        this.cpuCallOffense();
      }
    }
    this.setupFormation();
    this.phase = "presnap";
    this.snapTimer = this.userOnOffense() ? 1.5 : 0.6 + rng() * 0.5;
    this.message = "";
    this.pushHud(true);
  }

  /** CPU offense: real 4th-down decisions plus a down-and-distance play mix.
   *  (It used to pick uniformly at random and NEVER kick — it went for it on
   *  4th-and-anything all game and could only score by touchdown.) */
  private cpuCallOffense() {
    const dir = this.offDir();
    const goalX = dir > 0 ? RIGHT_GOAL : LEFT_GOAL;
    const ydsToGoal = Math.abs(goalX - this.los) / YARD;
    const cpu = this.possession;
    const opp: Team = cpu === "home" ? "away" : "home";
    const trailing = this.score[cpu] < this.score[opp];
    // desperation: late and behind — keep the offense on the field
    const desperate = this.quarter >= 4 && this.clock < 150 && trailing;

    if (this.down === 4) {
      const goForIt = desperate || (this.toGo <= 1 && ydsToGoal < 55);
      if (!goForIt) {
        // the two kicks come off DIFFERENT units now (place kick vs punt team)
        const placekick = OFFENSE_FORMATIONS.find((x) => x.id === "placekick")!;
        const puntunit = OFFENSE_FORMATIONS.find((x) => x.id === "puntunit")!;
        const fgDist = ydsToGoal + 17; // snap 7yd back + 10yd of end zone
        if (fgDist <= 58 && this.fgProb(fgDist) >= 0.3) {
          this.offFormation = placekick;
          this.offPlay = placekick.plays.find((p) => p.kind === "fg")!;
          return;
        }
        this.offFormation = puntunit;
        this.offPlay = puntunit.plays.find((p) => p.kind === "punt")!;
        return;
      }
    }

    // down-and-distance play mix instead of uniform random: lean run on short
    // yardage from heavy sets, lean pass on long yardage from spread sets
    const forms = OFFENSE_FORMATIONS.filter(
      (x) => x.id !== "placekick" && x.id !== "puntunit" && x.id !== "convert"
    );
    const pool =
      this.toGo <= 2
        ? forms.filter((x) => x.id === "iform" || x.id === "goalline")
        : this.toGo >= 8
          ? forms.filter((x) => x.id === "shotgun" || x.id === "spread")
          : forms;
    this.offFormation = pick(pool.length ? pool : forms);
    const wantRun = this.toGo <= 2 ? 0.72 : this.toGo >= 8 ? 0.3 : 0.52;
    const kind = rng() < wantRun ? "run" : "pass";
    const kindPool = this.offFormation.plays.filter((p) => p.kind === kind);
    this.offPlay = kindPool.length
      ? pick(kindPool)
      : pick(this.offFormation.plays);
  }

  /** CPU defense: situational front + call. (Uniform random before — GOAL LINE
   *  fronts showed up at midfield and PREVENT on 1st-and-10.) */
  private cpuCallDefense() {
    const dir = this.offDir();
    const goalX = dir > 0 ? RIGHT_GOAL : LEFT_GOAL;
    const ydsToGoal = Math.abs(goalX - this.los) / YARD;
    const short = this.toGo <= 2;
    const long = this.toGo >= 8;
    const off = this.possession;
    const def: Team = off === "home" ? "away" : "home";
    const leadLate =
      this.quarter >= 4 &&
      this.clock < 90 &&
      this.score[def] > this.score[off];

    const byId = (id: string) => DEFENSE_FORMATIONS.find((f) => f.id === id)!;
    let pool: DefenseFormation[];
    if (ydsToGoal <= 4 || (short && ydsToGoal <= 10))
      pool = [byId("goalline"), byId("fivetwo"), byId("fourthree")];
    else if (short) pool = [byId("fivetwo"), byId("fourthree"), byId("threefour")];
    else if (long) pool = [byId("nickel"), byId("dime"), byId("fourthree")];
    else
      pool = DEFENSE_FORMATIONS.filter(
        (f) => f.id !== "goalline" && f.id !== "dime" && !ST_DEF_IDS.has(f.id)
      );
    this.defFormation = pick(pool);

    const plays = this.defFormation.plays;
    let call: DefensePlay | undefined;
    if (leadLate && long) {
      call = plays.find((p) => p.id === "prevent"); // protect the lead
    } else if (short) {
      const aggro = plays.filter((p) => p.blitzers >= 1 || p.coverage === "man");
      if (aggro.length) call = pick(aggro); // crowd the line
    } else {
      const sane = plays.filter(
        // don't empty the coverage on long down-and-distance. (Checked by
        // blitzer COUNT, not by id: every front now names its own all-out
        // call — "allout43", "alloutnickel" — so an id match never fired.)
        (p) => p.id !== "prevent" && !(long && p.blitzers >= 3)
      );
      if (sane.length) call = pick(sane);
    }
    this.defPlay = call ?? pick(plays);
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
  /** dev/debug: live wind (unrounded) */
  debugWind() {
    return { dir: this.wind.dir, mph: this.wind.mph, target: this.windTarget };
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
    if (!this.userOnOffense()) {
      // defending a point-after: only the kick-block / return units make sense
      if (this.tryMode) return DEFENSE_FORMATIONS.filter((f) => ST_DEF_IDS.has(f.id));
      return DEFENSE_FORMATIONS.filter((f) => !ST_DEF_IDS.has(f.id));
    }
    // a try: kick the PAT off the place-kick unit, or go for two from a REGULAR
    // formation (going for two is an ordinary play, not a special-teams look)
    if (this.tryMode) {
      return OFFENSE_FORMATIONS.filter(
        (f) => f.id === "placekick" || (f.id !== "puntunit" && f.id !== "convert")
      );
    }
    return OFFENSE_FORMATIONS.filter((f) => f.id !== "convert");
  }

  // ---- test harness hooks (drive the engine directly, bypassing the menu and
  //      possession flips so a suite can run a fixed script of plays) ----------
  /** start a fresh HOME offensive series with the LOS at `ownYd` (0-100). */
  testNewSeries(ownYd: number) {
    // calm and PINNED by default so the suite is deterministic
    this.wind = { dir: 1, mph: 0 };
    this.windTarget = 0;
    this.windTimer = 1e9;
    this.possession = this.userTeam;
    this.tryMode = false;
    this.tryPending = false;
    this.conversion = null;
    this.pendingKickoff = null;
    this.kickMode = null;
    this.kickStage = null;
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
  /** force the game-day wind (harness): dir +1/-1 toward a goal, speed mph. */
  testWind(dir: number, mph: number) {
    this.wind = { dir, mph };
    this.windTarget = mph; // pinned: the harness measures a fixed wind
    this.windTimer = 1e9;
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
      wind: { dir: this.wind.dir, mph: Math.round(this.wind.mph) },
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
    const playAlign = this.offPlay.align ?? {}; // per-play override wins (PAT kick unit)

    for (const f of OFF_FORM) {
      const p: Player = basePlayer(idOf(offTeam, f.slot), offTeam, f);
      const base = OFFENSE_BASE[f.slot];
      const ov = playAlign[f.slot] ?? offAlign[f.slot];
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

    // VS A KICK: there is nobody to cover — the whole unit goes after the strike
    // point (that's what makes a kick blockable), except the deep men, who stay
    // back to field the punt / handle a miss.
    const k = this.offPlay.kind;
    if (k === "kickoff") {
      // the RETURN team: a wall holds up front, the deep men field the kick
      for (const d of defenders) {
        d.job = d.id.endsWith("_RET") || d.defRole === "S" ? "zone" : "man";
      }
      return;
    }
    if (k === "fg" || k === "pat" || k === "punt") {
      for (const d of defenders) {
        const deep = d.id.endsWith("_RET") || (k === "punt" && d.defRole === "S");
        d.job = deep ? "zone" : "rush";
        if (!deep) this.rushers.add(d.id);
      }
      return;
    }

    // 1) the rush: every down lineman, plus `blitzers` linebackers/DBs nearest LOS
    const dl = defenders.filter((d) => d.defRole === "DL");
    for (const d of dl) {
      d.job = "rush";
      this.rushers.add(d.id);
    }
    // a NAMED blitz package sends specific men (this front's own pressure look);
    // otherwise fall back to "the N nearest the middle"
    if (play.blitzSlots?.length) {
      for (const slot of play.blitzSlots) {
        const d = defenders.find((x) => x.id.endsWith(`_${slot}`));
        if (d) {
          d.job = "rush";
          this.rushers.add(d.id);
        }
      }
    } else {
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

    // CBs take the widest receivers; safeties/LBs take the rest inside-out
    const assignMan = (defs: Player[], spyLeftovers: boolean) => {
      const recs = [...receivers].sort((a, b) => a.oy - b.oy);
      const cbs = defs.filter((d) => d.defRole === "CB");
      const rest = defs.filter((d) => d.defRole !== "CB");
      const wides = recs.filter((r) => Math.abs(r.oy - midY) > 5 * YARD);
      const inside = recs.filter((r) => Math.abs(r.oy - midY) <= 5 * YARD);
      const assign = (ds: Player[], targs: Player[]) => {
        for (const t of targs) {
          let best: Player | null = null;
          let bd = Infinity;
          for (const d of ds) {
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
      if (spyLeftovers) for (const d of defs) if (d.job !== "man") d.job = "spy";
    };
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
    const byDepth = [...cover].sort((a, b) => (b.ox - a.ox) * dir);

    if (play.coverage === "man") {
      assignMan(cover, true);
    } else if (play.coverage === "cover0") {
      // FULL MAN: no help anywhere. Everyone covers a man; anyone left over
      // comes on the rush rather than loafing in a spy zone.
      assignMan(cover, false);
      for (const d of cover) {
        if (d.job === "man") continue;
        d.job = "rush";
        this.rushers.add(d.id);
      }
    } else if (play.coverage === "cover1" || play.coverage === "cover2man") {
      // MAN FREE / TWO-MAN UNDER: man everywhere with one or two safeties
      // capping it. The deep men are always the safeties when there are any.
      const nDeep = play.coverage === "cover1" ? 1 : 2;
      const forDeep = [...cover].sort(
        (a, b) =>
          (a.defRole === "S" ? 0 : 1) - (b.defRole === "S" ? 0 : 1) ||
          (b.ox - a.ox) * dir
      );
      const deep = forDeep.slice(0, Math.min(nDeep, forDeep.length));
      const under = cover.filter((d) => !deep.includes(d));
      spread(deep, nDeep === 1 ? 18 : 16, nDeep === 1 ? 0 : 11);
      assignMan(under, true);
    } else if (play.coverage === "cover3man") {
      // THREE DEEP, MAN UNDER: three deep thirds so nothing gets over the top,
      // and everyone underneath travels with a man. Plays tight like man but
      // with a safety net — the answer to man-beating routes.
      // Deep thirds go to DBs (safeties first, then a corner): a linebacker
      // running a deep third is a mismatch nobody would ever call.
      const deepRank = (d: Player) =>
        d.defRole === "S" ? 0 : d.defRole === "CB" ? 1 : 2;
      const forDeep = [...cover].sort(
        (a, b) => deepRank(a) - deepRank(b) || (b.ox - a.ox) * dir
      );
      const deep = forDeep.slice(0, Math.min(3, forDeep.length));
      const under = cover.filter((d) => !deep.includes(d));
      // deeper than a normal cover-3 shell (16yd): there is no underneath zone
      // help here, so the thirds exist purely to cap the vertical routes that
      // beat man — sit ON TOP of them, not in front.
      spread(deep, 20, 16);
      assignMan(under, true);
    } else {
      // zone: deep shell + underneath, spread across the field width
      const nDeep = play.coverage === "cover2" ? 2 : play.coverage === "cover3" ? 3 : 4;
      // deepest coverage players take the deep zones
      const deep = byDepth.slice(0, Math.min(nDeep, byDepth.length));
      const under = byDepth.slice(deep.length);
      const deepFwd = play.coverage === "cover4" ? 14 : 16;
      // deep safeties sit over the hashes (not the sidelines) so they actually
      // bracket the deep HALVES — a wide spread left the deep middle wide open.
      spread(deep, deepFwd, play.coverage === "cover2" ? 11 : 16);
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
    this.kickStage = null;
    this.kickOp = null;
    this.kickHold = 0;
    // fresh matchup state for the new play
    for (const p of this.players) {
      p.shed = false;
      p.shedBy = undefined;
      p.stun = 0;
      p.engaged = 0;
      p.burst = 0;
      p.fx = 0;
      p.fxKind = "";
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

    // A SHOTGUN snap is a long snap too — it can get away from the center.
    // (Keyed off the formation, not the QB's drawn depth: every formation here
    // aligns him at the same 3yd, so only the CALL says it's a gun snap.)
    if (GUN_FORMS.has(this.offFormation.id)) {
      const taker = this.carrier();
      if (taker && this.snapBotched(5)) this.looseSnap(taker);
    }
  }

  // ---- kickoff ------------------------------------------------------------
  /** Set up and play an actual KICKOFF: the kicking team lines up across its own
   * 35, the return team fields it and runs it back. Not a teleport to the 25. */
  private startKickoff(kicking: Team) {
    this.kickingTeam = kicking;
    this.possession = kicking; // the kicking team has the ball until it's fielded
    this.kickReturn = true;
    this.down = 1;
    this.toGo = 10;
    const dir = this.offDir();
    this.los = clamp(
      (dir > 0 ? LEFT_GOAL : RIGHT_GOAL) + dir * 35 * YARD,
      LEFT_GOAL,
      RIGHT_GOAL
    );
    this.recomputeFirstDown();
    this.offFormation = OFFENSE_FORMATIONS.find((f) => f.id === "kickoffunit")!;
    this.offPlay = this.offFormation.plays[0];
    this.defFormation = DEFENSE_FORMATIONS.find((f) => f.id === "kickreturn")!;
    this.defPlay = this.defFormation.plays[0];
    this.setupFormation();
    this.phase = "live";
    this.liveTime = 0;
    this.message = "KICKOFF";
    // the ball is teed up and struck after the kicker's approach
    const b = this.ball;
    const tee = this.byId(`${kicking}_CEN`);
    b.carrier = null;
    b.targetId = null;
    b.tip = false;
    b.fumble = false;
    b.deadBall = false;
    b.offTarget = false;
    b.swatDone = false;
    b.inAir = false;
    b.x = b.sx = tee ? tee.x : this.los;
    b.y = b.sy = WORLD_H / 2;
    b.z = 0;
    b.t = 0;
    b.elapsed = 0;
    this.kickMode = "kickoff"; // a kicking play — the meter drives it
    if (this.userOnOffense() && !this.headless) {
      const kic = this.kickerRating();
      this.kickAccWin = clamp(0.3 + (kic - 75) * 0.006, 0.18, 0.55);
      this.kickStage = "power";
      this.kickMeter = 0;
      this.kickMeterDir = 1;
      this.kickPower = 0;
      this.kickoffWait = 0;
      this.message = "TAP: POWER";
    } else {
      this.kickStage = null;
      this.kickoffWait = 0.7; // AI approach, then it's struck
    }
    this.setControlFlags();
    this.pushHud(true);
  }

  /** strike the kickoff. `power` (0..1) is leg, `acc` (-1..1) steers it left or
   * right — a kickoff is a kicking play, so the human gets the same two-stage
   * meter he gets on a field goal, and can squib or angle it to a sideline. */
  private launchKickoff(power = 1, acc = 0) {
    const b = this.ball;
    const dir = this.offDir();
    const goalX = dir > 0 ? RIGHT_GOAL : LEFT_GOAL;
    const kic = this.kickerRating();
    // full leg carries to the goal line; a soft one is a squib
    const yds =
      (40 + (kic - 75) * 0.25 + 22 * clamp(power, 0, 1)) * (1 - Math.abs(acc) * 0.16) +
      this.windAssist(dir) * 1.6;
    let landX = b.sx + dir * yds * YARD;
    // don't sail it clean out of the world
    landX = clamp(landX, LEFT_GOAL - 8 * YARD, RIGHT_GOAL + 8 * YARD);
    b.sx = b.x;
    b.sy = b.y;
    b.tx = landX;
    // ACC is the DIRECTION: aim it down a sideline to shorten the return angle
    b.ty = clamp(
      WORLD_H / 2 + acc * 9 * YARD + (rng() - 0.5) * 2 * YARD,
      SIDELINE,
      WORLD_H - SIDELINE
    );
    b.peak = (4 + 1.6 * clamp(power, 0, 1)) * YARD; // hang time rides with leg
    b.ftime = Math.max(1.2, (Math.abs(b.tx - b.sx) / KICK_SPEED) * 1.35);
    b.elapsed = 0;
    b.t = 0;
    b.inAir = true;
    this.kickMode = "kickoff";
    this.audio.kick();
    void goalX;
  }

  /** the kickoff in flight: the return team fields it, or it's a touchback */
  private updateKickoff(dt: number) {
    const b = this.ball;
    b.elapsed += dt;
    b.t = clamp(b.elapsed / b.ftime, 0, 1);
    b.x = lerp(b.sx, b.tx, b.t);
    b.y = lerp(b.sy, b.ty, b.t);
    b.z = b.peak * Math.sin(Math.PI * b.t);
    const dir = this.offDir();
    const goalX = dir > 0 ? RIGHT_GOAL : LEFT_GOAL;
    const inEndZone = dir > 0 ? b.x >= goalX : b.x <= goalX;

    // a returner under the ball fields it and the return is ON — but only as it
    // COMES DOWN. (This used to fire anywhere the ball was under jump height,
    // so the front wall caught the kickoff 9-10yd off the tee on the way up:
    // every kickoff "went 10 yards".)
    const toLand = dist(b.x, b.y, b.tx, b.ty);
    if (b.z <= REACH && (toLand < 7 * YARD || b.t > 0.8)) {
      let best: Player | null = null;
      let bd = CATCH_R * 2.2;
      for (const p of this.players) {
        if (p.team === this.possession) continue; // the coverage team can't field it
        if (p.stun > 0) continue;
        const d = dist(p.x, p.y, b.x, b.y);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      if (best) {
        if (inEndZone) return this.touchback(); // fair decision: take the 25
        return this.fieldKickoff(best);
      }
    }
    if (b.t >= 1) {
      // hit the turf untouched
      if (inEndZone) return this.touchback();
      const near = this.nearestReturner(b.x, b.y);
      if (near) return this.fieldKickoff(near);
      return this.touchback();
    }
  }

  private nearestReturner(x: number, y: number) {
    let best: Player | null = null;
    let bd = Infinity;
    for (const p of this.players) {
      if (p.team === this.possession) continue;
      const d = dist(p.x, p.y, x, y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** he's got it — possession flips and the RETURN is live */
  private fieldKickoff(r: Player) {
    const b = this.ball;
    this.kickMode = null;
    b.inAir = false;
    b.z = 0;
    this.possession = r.team; // the return team now owns the ball
    r.hasBall = true;
    b.carrier = r.id;
    this.message = "RETURN!";
    this.audio.catchBall();
    // re-aim everyone: the coverage team now tackles, the return team blocks
    this.assignDefense(
      this.possession,
      this.possession === "home" ? "away" : "home",
      this.offDir(),
      WORLD_H / 2
    );
    if (this.userOnOffense()) this.controlledId = r.id;
    else this.controlledId = this.pickDefaultDefender(this.possession === "home" ? "away" : "home");
    this.setControlFlags();
  }

  /** kick into the end zone, not brought out: ball at the 25 */
  private touchback() {
    const b = this.ball;
    this.kickMode = null;
    b.inAir = false;
    b.z = 0;
    this.kickReturn = false;
    const receiving: Team = this.possession === "home" ? "away" : "home";
    this.possession = receiving;
    const dir = this.offDir();
    const ownGoal = dir > 0 ? LEFT_GOAL : RIGHT_GOAL;
    this.phase = "dead";
    this.deadTimer = 1.4;
    this.message = "TOUCHBACK";
    this.audio.whistle();
    this.setNewSeries(ownGoal + dir * 25 * YARD);
  }

  // ---- special teams -----------------------------------------------------
  /** the man who receives the snap: the HOLDER on a place kick, the PUNTER
   * himself on a punt (no holder — it's snapped straight back to him). */
  private snapCatcher(): Player | null {
    const t = this.possession;
    return this.kickMode === "punt" ? this.byId(`${t}_QB`) : this.byId(`${t}_R`);
  }
  /** the man who strikes the ball */
  private kickerPlayer(): Player | null {
    return this.byId(`${this.possession}_QB`);
  }

  /** Does this snap get away from the snapper? A long snapper reps these all
   * week, so it's rare — roughly 1 in 50 at league-average awareness, less for
   * a good one — but it scales with how far back the ball has to travel
   * (shotgun < place kick < punt). */
  private snapBotched(distYds: number): boolean {
    const cen = this.byId(`${this.possession}_CEN`);
    const awr = cen ? rate(cen.rat, "AWR") : 75;
    const base = 0.014 + Math.max(0, distYds - 7) * 0.0009;
    const chance = clamp(base * (1 + (75 - awr) * 0.03), 0.004, 0.06);
    return rng() < chance;
  }

  /** the snap gets away: a live loose ball at the intended catcher's feet */
  private looseSnap(near: Player) {
    const b = this.ball;
    this.kickMode = null;
    this.kickOp = null;
    this.kickStage = null;
    this.kickHold = 0;
    near.hasBall = false;
    b.carrier = null;
    b.inAir = true;
    b.tip = true;
    b.fumble = true;
    b.targetId = null;
    for (const p of this.players) p.tipTried = false;
    b.x = near.x; // it's loose right where he was reaching for it
    b.y = near.y;
    b.sx = b.x;
    b.sy = b.y;
    b.tx = clamp(b.x + (rng() - 0.5) * 5 * YARD, LEFT_GOAL, RIGHT_GOAL);
    b.ty = clamp(b.y + (rng() - 0.5) * 5 * YARD, SIDELINE, WORLD_H - SIDELINE);
    b.peak = 0.7 * YARD;
    b.ftime = 0.7;
    b.elapsed = 0;
    b.t = 0;
    this.message = "BAD SNAP!";
    this.audio.tackle();
  }

  /** During the operation the man with the ball — holder, punter, or the kicker
   * once he's on it — is a ball carrier like any other: get to him and the play
   * is over at that spot (a safety if it's in his own end zone). */
  private kickOpTackle() {
    const men = [this.snapCatcher(), this.kickerPlayer()].filter(
      (m): m is Player => m !== null
    );
    for (const p of this.players) {
      if (p.team === this.possession) continue;
      if (this.neutralized(p) || p.stun > 0) continue;
      for (const m of men) {
        if (dist(p.x, p.y, m.x, m.y) >= TACKLE_R) continue;
        const b = this.ball;
        this.kickMode = null;
        this.kickOp = null;
        this.kickStage = null;
        b.inAir = false;
        b.z = 0;
        this.audio.tackle();
        const dir = this.offDir();
        const ownGoal = dir > 0 ? LEFT_GOAL : RIGHT_GOAL;
        if (dir > 0 ? m.x <= ownGoal : m.x >= ownGoal) return this.safety();
        return this.endPlay({ type: "tackle", spotX: m.x, spotY: m.y });
      }
    }
  }

  private startKick(kind: "fg" | "punt" | "pat") {
    this.liveTime = 0;
    const dir = this.offDir();
    const goalX = dir > 0 ? RIGHT_GOAL : LEFT_GOAL;
    const b = this.ball;
    this.kickMode = kind;
    const cen = this.byId(`${this.possession}_CEN`);
    const catcher = this.snapCatcher();
    b.carrier = null;
    b.targetId = null;
    // the LONG SNAP: the ball starts in the snapper's hands and travels back to
    // the holder (place kick) or the punter (punt). It is a real object in
    // flight the whole time — never a dead ball parked on the turf.
    b.sx = cen ? cen.x : this.los;
    b.sy = cen ? cen.y : WORLD_H / 2;
    b.tx = catcher ? catcher.x : this.los - dir * 7 * YARD;
    b.ty = catcher ? catcher.y : WORLD_H / 2;
    b.x = b.sx;
    b.y = b.sy;
    b.z = 0.6 * YARD;
    b.t = 0;
    b.elapsed = 0;
    b.tip = false;
    b.fumble = false;
    b.deadBall = false;
    b.offTarget = false;
    b.swatDone = false; // one in-flight deflection attempt per kick
    b.inAir = false; // the KICK hasn't launched; the operation is running
    this.kickOp = "snap";
    // FG, PAT and punt are ALL long snaps — and a long snap can get away
    this.kickBadSnap = this.snapBotched(kind === "punt" ? 13 : 7);
    if (this.kickBadSnap) {
      // it sails — high and off-line, so it's visibly a bad snap before it lands
      b.tx += (rng() - 0.5) * 4 * YARD;
      b.ty += (rng() - 0.5) * 4 * YARD;
    }
    // operation clock: snap flight, then the hold/approach before the strike.
    // Punt ops are slower (deeper snap, catch, drop) than a place kick.
    this.kickSnapTime = kind === "punt" ? 0.75 : 0.6;
    this.kickOpT = 0;
    this.kickDist = kind === "pat" ? 20 : Math.abs(goalX - b.tx) / YARD + 10;
    this.audio.snap();

    // The human kicking on-screen gets the interactive meter — but it only opens
    // once the snap is actually in hand (you can't kick a ball that's in flight).
    if (this.userOnOffense() && !this.headless) {
      const kic = this.kickerRating();
      // a better kicker = a wider made-window (more forgiving aim)
      this.kickAccWin = clamp(0.3 + (kic - 75) * 0.006, 0.18, 0.55);
      this.kickStage = null; // opens on catch
      this.kickMeter = 0;
      this.kickMeterDir = 1;
      this.kickPower = 0;
      this.kickHold = 0;
      this.message = "SNAP…";
      return;
    }
    // AI kick: hold time AFTER the catch before the strike (the rush is live).
    this.kickHold = kind === "punt" ? 1.25 : 0.7;
    this.message = "";
  }

  /** run the snap → hold → strike operation. The ball is in the snapper's,
   * then the holder's/punter's hands the whole way, so the thing a rusher
   * attacks is the real strike point, not a ball lying on the ground. */
  private updateKickOp(dt: number) {
    const b = this.ball;
    const kind = this.kickMode as "fg" | "punt" | "pat";
    const catcher = this.snapCatcher();
    this.kickOpT += dt;
    // the man receiving the snap is PLANTED at the spot — he can't be jostled
    // downfield by the closing kicker or a collapsing line, or the strike point
    // (the thing the rush is attacking) would slide out from under everyone
    if (catcher) {
      catcher.vx = 0;
      catcher.vy = 0;
      catcher.dvx = 0;
      catcher.dvy = 0;
      catcher.x = catcher.ox;
      catcher.y = catcher.oy;
    }

    if (this.kickOp === "snap") {
      const t = clamp(this.kickOpT / this.kickSnapTime, 0, 1);
      // track the catcher live so the ball arrives in his hands even if he shifts
      if (catcher) {
        b.tx = catcher.x;
        b.ty = catcher.y;
      }
      b.x = lerp(b.sx, b.tx, t);
      b.y = lerp(b.sy, b.ty, t);
      b.z = lerp(0.6 * YARD, kind === "punt" ? 1.3 * YARD : 0.9 * YARD, t) +
        0.5 * YARD * Math.sin(Math.PI * t);
      if (t >= 1) {
        // it got away from him — live ball, no kick
        if (this.kickBadSnap && catcher) return this.looseSnap(catcher);
        this.kickOp = "hold";
        this.kickOpT = 0;
        if (this.userOnOffense() && !this.headless) {
          // snap is in — NOW the kicker can be triggered
          this.kickStage = "power";
          this.message =
            kind === "punt" ? "TAP: POWER" : kind === "pat" ? "PAT — TAP: POWER" : "TAP: POWER";
        }
      }
      return;
    }

    // HOLD: the ball is in hand at the strike point. On a place kick the holder
    // spots it on the turf and the KICKER steps into it; on a punt the punter
    // holds it at his waist and drops it onto his foot.
    if (catcher) {
      b.x = catcher.x;
      b.y = catcher.y;
      b.z = kind === "punt" ? 1.1 * YARD : 0.25 * YARD;
    }
    if (kind !== "punt") {
      // the kicker takes his steps INTO the hold — this is the approach, and
      // it's why the strike point is in front of him, not under him
      const k = this.kickerPlayer();
      if (k && catcher) {
        const dur = Math.max(0.2, this.kickHold || 0.7);
        const st = clamp(this.kickOpT / dur, 0, 1);
        k.dvx = 0;
        k.dvy = 0;
        k.vx = 0;
        k.vy = 0;
        k.x = lerp(k.ox, catcher.x - this.offDir() * 0.7 * YARD, st);
        k.y = lerp(k.oy, catcher.y, st);
      }
    }
    if (this.kickHold > 0) {
      this.kickHold -= dt;
      if (this.kickHold <= 0 && !this.tryBlockKick()) {
        const dir = this.offDir();
        this.resolveKickAuto(kind, dir, dir > 0 ? RIGHT_GOAL : LEFT_GOAL, b);
      }
    }
  }

  /** AI / headless kick: ratings + RNG, no meter (unchanged distribution). */
  private resolveKickAuto(
    kind: "fg" | "punt" | "pat",
    dir: number,
    goalX: number,
    b: typeof this.ball
  ) {
    // the ball leaves the foot from wherever it was actually struck (the hold
    // spot / the punter's drop), so a rusher who got there attacked a real point
    b.sx = b.x;
    b.sy = b.y;
    this.kickOp = null;
    b.inAir = true;
    this.audio.kick();
    if (kind === "fg" || kind === "pat") {
      const yds = kind === "pat" ? 20 : Math.abs(goalX - b.sx) / YARD + 10;
      this.kickGood = yds <= 65 && rng() < this.fgProb(yds);
      b.tx = goalX + dir * (this.kickGood ? 14 * YARD : 2 * YARD);
      b.ty = WORLD_H / 2 + (this.kickGood ? 0 : (rng() - 0.5) * 8 * YARD);
      b.peak = 3.2 * YARD;
      b.ftime = Math.max(0.7, (Math.abs(b.tx - b.sx) / KICK_SPEED) * 1.1);
      this.message = kind === "pat" ? "EXTRA POINT…" : "FIELD GOAL…";
    } else {
      const puntYds =
        38 + (this.kickerRating() - 75) * 0.22 + rng() * 8 + this.windAssist(dir) * 1.4;
      let landX = b.sx + dir * puntYds * YARD;
      if (dir > 0 ? landX >= goalX : landX <= goalX) landX = goalX; // touchback
      b.tx = landX;
      b.ty = WORLD_H / 2 + (rng() - 0.5) * 6 * YARD;
      b.peak = 3.6 * YARD;
      b.ftime = Math.max(0.9, (Math.abs(b.tx - b.sx) / KICK_SPEED) * 1.3);
      this.message = "PUNT…";
    }
  }

  /** advance the kick meter; a tap locks the current stage. */
  private updateKickMeter(dt: number) {
    const speed = 1.0; // was 1.7 — too fast to time; the rush is the pressure now
    this.kickMeter += this.kickMeterDir * speed * dt;
    if (this.kickMeter >= 1) {
      this.kickMeter = 1;
      this.kickMeterDir = -1;
    } else if (this.kickMeter <= 0) {
      this.kickMeter = 0;
      this.kickMeterDir = 1;
    }
    if (!this.input.pressed("Space")) return;
    if (this.kickStage === "power") {
      this.kickPower = Math.max(0.08, this.kickMeter);
      this.kickStage = "accuracy";
      this.kickMeter = 0;
      this.kickMeterDir = 1;
      this.message = "TAP: AIM";
    } else {
      const acc = this.kickMeter * 2 - 1; // -1..1, 0 = dead center
      this.kickStage = null;
      this.fireKick(this.kickPower, acc);
    }
  }

  /** a defender who has penetrated to the kick spot at launch gets his hands
   * up: the closer he is to the ball, the more likely the kick is smothered.
   * Returns true if the kick was blocked (kick machinery already unwound). */
  private tryBlockKick(): boolean {
    const b = this.ball;
    let best: Player | null = null;
    let bd = Infinity;
    for (const p of this.players) {
      if (p.team === this.possession) continue;
      if (this.neutralized(p) || p.stun > 0) continue;
      const d = dist(p.x, p.y, b.x, b.y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (!best || bd > 3 * YARD) return false;
    // right on the strike point ≈ 80%, fading out by ~3yd. This is the payoff for
    // beating the protection to the spot — jump the snap and you get the block.
    const chance = clamp(0.7 - (bd / YARD - 0.4) * 0.34, 0.04, 0.7);
    if (rng() >= chance) return false;
    this.blockKick();
    return true;
  }

  /** the kick is smothered off the foot: a blocked PAT is simply no good;
   * a blocked FG/punt caroms backward as a LIVE ball — same scramble as a
   * fumble (unrecovered = dead where it lies; on 4th down the down counter
   * turns that into a turnover on downs at the spot). */
  private blockKick() {
    const kind = this.kickMode!;
    this.kickMode = null;
    this.kickStage = null;
    this.kickOp = null;
    this.audio.tackle();
    if (kind === "pat") {
      this.kickGood = false;
      this.resolvePAT();
      this.message = "PAT BLOCKED!"; // after resolvePAT — it sets "MISSED PAT"
      return;
    }
    const b = this.ball;
    const dir = this.offDir();
    b.inAir = true;
    b.tip = true;
    b.fumble = true;
    b.targetId = null;
    for (const p of this.players) p.tipTried = false;
    b.sx = b.x;
    b.sy = b.y;
    // caroms back off the block and bounces behind the kick spot
    b.tx = clamp(b.x - dir * (1 + rng() * 3) * YARD, LEFT_GOAL, RIGHT_GOAL);
    b.ty = clamp(b.y + (rng() - 0.5) * 4 * YARD, SIDELINE, WORLD_H - SIDELINE);
    b.peak = 0.8 * YARD;
    b.ftime = 0.9;
    b.elapsed = 0;
    b.t = 0;
    this.message = "BLOCKED!";
  }

  /** launch the kick from a metered power (0..1) + aim error (-1..1). */
  private fireKick(power: number, acc: number) {
    if (this.kickMode === "kickoff") return this.launchKickoff(power, acc);
    if (this.tryBlockKick()) return;
    const b = this.ball;
    const dir = this.offDir();
    const goalX = dir > 0 ? RIGHT_GOAL : LEFT_GOAL;
    const kind = this.kickMode!;
    b.sx = b.x; // struck where the ball actually sat (hold spot / punter's drop)
    b.sy = b.y;
    this.kickOp = null;
    b.inAir = true;
    this.audio.kick();
    if (kind === "fg" || kind === "pat") {
      // leg strength scales with the kicker: a full-power tap reaches ~60yd of
      // flight for a bad (60) leg up to ~76yd elite. (It was a flat 68 for
      // everyone — kicker rating only widened the accuracy window, so a
      // 60-rated kicker with good timing bombed 50-yarders at 100%.)
      const leg = 68 + (this.kickerRating() - 75) * 0.5;
      const reqPower = clamp(this.kickDist / leg, 0.12, 1);
      const long = power >= reqPower;
      const straight = Math.abs(acc) <= this.kickAccWin;
      this.kickGood = long && straight;
      if (this.kickGood) {
        b.tx = goalX + dir * 14 * YARD;
        b.ty = WORLD_H / 2 + acc * 4 * YARD; // a hair of curve, still through
      } else if (long) {
        b.tx = goalX + dir * 4 * YARD; // reached the posts but sailed wide
        b.ty = WORLD_H / 2 + Math.sign(acc || 1) * 9 * YARD;
      } else {
        b.tx = b.sx + dir * power * 70 * YARD; // came up short
        b.ty = WORLD_H / 2 + acc * 3 * YARD;
      }
      b.peak = 3.2 * YARD;
      b.ftime = Math.max(0.7, (Math.abs(b.tx - b.sx) / KICK_SPEED) * 1.1);
      this.message = kind === "pat" ? "EXTRA POINT…" : "FIELD GOAL…";
    } else {
      const kic = this.kickerRating();
      const maxGross = 44 + (kic - 75) * 0.3;
      const timing = 1 - Math.abs(acc) * 0.4; // poor aim shanks it short
      const puntYds = (28 + power * (maxGross - 28)) * timing + this.windAssist(dir) * 1.4;
      let landX = b.sx + dir * puntYds * YARD;
      if (dir > 0 ? landX >= goalX : landX <= goalX) landX = goalX; // touchback
      b.tx = landX;
      b.ty = clamp(WORLD_H / 2 + acc * 5 * YARD, SIDELINE, WORLD_H - SIDELINE);
      b.peak = 3.6 * YARD;
      b.ftime = Math.max(0.9, (Math.abs(b.tx - b.sx) / KICK_SPEED) * 1.3);
      this.message = "PUNT…";
    }
  }

  /** the kicking team's kicker rating (KIC) — an explicit roster rating now;
   *  no more silently promoting an exact 70 to 75 (which made a genuinely
   *  70-rated kicker impossible to roster). */
  /** How many YARDS the wind is worth to a kick travelling in `dir`. Positive =
   * at your back. About a quarter-yard per mph, so a 16mph wind is roughly four
   * yards of field-goal range either way — enough to change a fourth-down call. */
  /** Wind drifts with the game clock: it eases toward a target that only
   * changes every 20-60s, at most ~0.5mph per second, so it builds and dies
   * over a quarter. It can only SWING AROUND once it has gone nearly calm —
   * a 15mph wind never reverses between two snaps. */
  private updateWind(dt: number) {
    this.windTimer -= dt;
    if (this.windTimer <= 0) {
      this.windTimer = 20 + rng() * 40;
      this.windTarget = clamp(this.wind.mph + (rng() - 0.5) * 8, 0, 22);
    }
    const step = 0.5 * dt; // mph per second ceiling — always a gradual change
    const d = this.windTarget - this.wind.mph;
    this.wind.mph = clamp(this.wind.mph + clamp(d, -step, step), 0, 22);
    // it swings around only after dying off, and even then rarely
    if (this.wind.mph < 3 && rng() < 0.0012) {
      this.wind.dir = -this.wind.dir;
      this.windTarget = 3 + rng() * 8; // and freshens from the new quarter
    }
  }

  private windAssist(dir: number) {
    return this.wind.mph * 0.25 * (this.wind.dir === dir ? 1 : -1);
  }

  private kickerRating() {
    const k = this.byId(`${this.possession}_K`) ?? this.byId(`${this.possession}_QB`);
    return k ? rate(k.rat, "KIC") : 75;
  }

  /** FG make probability vs distance, NFL-anchored flat-then-cliff curve. A kicker
   *  scalar shifts EFFECTIVE distance (a better kicker plays each kick as if it
   *  were several yards shorter) — barely moves short kicks, swings 50+ a lot.
   *  Anchors (75-rated): 25→.97, 35→.94, 45→.78, 53→.70, 60→.33 (design/realism-targets.md). */
  private fgProb(yds: number, kic = this.kickerRating()) {
    // wind plays exactly like distance: at your back the kick is "shorter"
    const d = yds - (kic - 75) * 0.4 - this.windAssist(this.offDir()); // effective distance
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
    // LOW OFF THE FOOT: through its first yards the kick is under a raised
    // hand — a defender in the lane gets ONE deflection attempt (one-shot
    // latch, like the pass swat). Deeper penetration = far better odds, so
    // jumping the snap and shooting a gap is how you block a kick.
    if (b.t < 1 && !b.swatDone && b.z <= SWAT_Z) {
      const fromSpot = dist(b.x, b.y, b.sx, b.sy);
      if (fromSpot < 8 * YARD) {
        let best: Player | null = null;
        let bd = Infinity;
        for (const p of this.players) {
          if (p.team === this.possession) continue;
          if (p.stun > 0) continue; // on the ground — engaged still gets hands up
          const d = dist(p.x, p.y, b.x, b.y);
          if (d < bd) {
            bd = d;
            best = p;
          }
        }
        if (best && bd <= SWAT_R) {
          b.swatDone = true;
          let chance = clamp(0.3 - (fromSpot / YARD) * 0.055, 0.02, 0.3);
          // a lineman still locked in his block only gets an arm free
          if (this.neutralized(best)) chance *= 0.3;
          if (rng() < chance) return this.blockKick();
        }
      }
    }
    if (b.t < 1) return;
    b.inAir = false;
    b.z = 0;
    const kind = this.kickMode;
    this.kickMode = null;
    this.kickStage = null;
    this.kickOp = null;
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
      this.pendingKickoff = "flip";
    } else {
      this.message = "NO GOOD";
      this.audio.turnover();
      // opponent takes over at the SPOT OF THE KICK (7yd behind the LOS, per
      // the real rule) — it was handing them the ball at the LOS itself
      const dir = this.offDir();
      this.flipPossession(
        clamp(this.los - dir * 7 * YARD, LEFT_GOAL, RIGHT_GOAL)
      );
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
    this.pendingKickoff = "flip";
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
    this.pendingKickoff = "flip";
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
      // user can hike early on offense
      if (this.userOnOffense() && this.input.pressed("Space")) this.snapTimer = 0;
      if (this.snapTimer <= 0) this.snap();
    } else if (this.phase === "live") {
      // the field keeps running UNDER the kick meter — the rush is coming, so
      // a slow kicker risks the block (that's the get-off pressure)
      if (this.kickStage) this.updateKickMeter(dt);
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
    // overall game-speed scalar — the live action plays a touch slower so it's
    // readable (players, ball, and timers all scale together). Tune to taste.
    dt *= 0.82;
    // clock — endQuarterCheck fires ONCE, on the crossing. (It used to fire
    // every frame the clock sat at 0, incrementing `quarter` hundreds of times
    // during the final play; the scoreboard hid it with a min(quarter, 4).)
    if (this.clock > 0) {
      this.clock -= dt;
      this.updateWind(dt); // drifts with the game clock, never per kick
      if (this.clock <= 0) {
        this.clock = 0;
        this.endQuarterCheck();
      }
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
      if (p.fx > 0) p.fx = Math.max(0, p.fx - dt);
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

    // safety net for a GLITCHED ball only (stuck in the air / loose with no
    // one able to secure it). A live CARRIER is never force-ended: the old
    // 14s cap here silently "tackled" a back who had outrun everyone — a
    // band-aid (adc060e) for the pursuit that could never close, which chase
    // pursuit now actually fixes. A run ends by tackle, OOB, or the end zone,
    // period.
    if (this.phase === "live" && this.liveTime > 14 && !this.carrier()) {
      this.endPlay({ type: "incomplete" });
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
      p.y = clamp(p.y, BOUNDS, WORLD_H - BOUNDS);
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

      // the kick unit holds its alignment: the holder stays down over the spot
      // and the kicker's approach is driven by the operation, not by route logic
      if (this.kickMode && !this.ball.inAir) {
        p.dvx = 0;
        p.dvy = 0;
        continue;
      }

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
          // a MISFIRE is behind/away from him: he has to break down, turn and
          // work back, so he frequently can't get there — the ball lands in
          // space and reads as a bad throw
          this.moveToward(p, this.ball.tx, this.ball.ty, dt, this.ball.offTarget ? 0.6 : 1);
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
      // sustain: shove off the path — dt-scaled (~1.1 yd/s), was per-frame
      if (this.neutralized(tgt)) tgt.x -= dir * 24 * dt;
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
      wr.burst = 0.3 + 0.2 * res.sev;
      // most wins open ~0.8-1.4yd (contested-catchable); a big win (double move)
      // opens 2yd+ (clean). Deeper routes separate less (DB has time to react).
      const open = (zone ? 0.9 : 0.7) + 1.3 * res.sev - clamp((depth - 8) * 0.07, 0, 1.6);
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
    // Only while hitting the crease (~10yd past the LOS): refreshed in the open
    // field it never expired, which made every breakaway an uncatchable housecall.
    if (nearestAhead > 3 * YARD && dir * (p.x - this.los) < 10 * YARD)
      p.burst = Math.max(p.burst, 0.25);
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
        // a defender engaged by a block is controlled by it (no own pursuit, or
        // he'd drift through the block into the backfield) — BUT ONLY while the
        // carrier is still in front of him. Once the back breaks PAST him the rep
        // is over: he sheds off and gives chase (otherwise blocked front-7 freeze
        // and the carrier runs free to the safety-net — runs too easy / plays drag).
        const carrierPast = dir * (carrier!.x - p.x) > 1 * YARD;
        if (this.neutralized(p) && !carrierPast) {
          p.dvx = 0;
          p.dvy = 0;
          continue;
        }
        if (this.neutralized(p) && carrierPast) {
          p.shed = true; // the back beat him; release the block and pursue
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
    if (this.neutralized(p)) {
      this.moveToward(p, to.x, to.y, dt, 0.4);
      return;
    }
    // LEVERAGE: a defender IN FRONT of the carrier stays in front. Pure
    // pursuit sent everyone — including the deep men — charging straight at
    // the carrier, so the whole defense collapsed into one flock: a single
    // cut beat the front wave and left nobody between the back and the goal
    // line. Instead, a downfield defender mirrors the carrier's lane at a
    // shrinking cushion (giving ground only as fast as the carrier takes it)
    // and commits to the tackle only once the carrier is on top of him.
    {
      const ldir = this.offDir();
      const aheadYd = (ldir * (p.x - carrier.x)) / YARD;
      const d = dist(p.x, p.y, carrier.x, carrier.y);
      if (aheadYd > 1.2 && d > 2.2 * YARD) {
        const cushion = clamp(aheadYd * 0.5, 1.2, 3.5) * YARD;
        const tx = carrier.x + ldir * cushion;
        // track his lateral break with a slight lead so a cut can't flat-foot us
        const ty = clamp(
          carrier.y + carrier.vy * 0.35,
          SIDELINE,
          WORLD_H - SIDELINE
        );
        this.moveToward(p, tx, ty, dt, 1);
        return;
      }
    }
    // open-field CHASE: a free defender trailing a carrier who has broken into
    // the open (>8yd past the LOS) runs the pursuit angle flat-out. Without
    // this, pursuit ran at exactly 1.0x while the carrier had turbo (1.13x)
    // and/or break-tackle burst (1.18x) — measured headless: 28% of base-D runs
    // and 87% of goal-line runs NEVER ENDED (equal-speed pursuit can't close),
    // i.e. every crease was a guaranteed 100-yard housecall in live play.
    // The boost scales with how far behind the chaser is: small when he's on
    // the carrier's hip (a juke or broken tackle still buys real separation,
    // and a turbo carrier can still outrun close pursuit for the housecall),
    // large from distance (the pack always reels a breakaway back in). PUR adds
    // a rating tilt. Gated to the open field: near the line it wrecks the
    // gap-fit balance (the chase→contact→break→burst N-001 feedback loop).
    const dir = this.offDir();
    const gap = (dir * (carrier.x - p.x)) / YARD; // yards the chaser trails by
    const openField = dir * (carrier.x - this.los) > 8 * YARD;
    let chase = 1;
    if (gap > 0 && openField) {
      const ramp = clamp(gap / 5, 0, 1);
      chase = 1.04 + ramp * 0.1 + (rate(p.rat, "PUR") / 99) * 0.08;
    }
    this.moveToward(p, to.x, to.y, dt, chase);
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
    // no carrier + kickMode = the ball is teed/held at the spot: rush THE BALL
    // (that's the block path), not the empty line of scrimmage
    const aim = carrier ??
      (this.kickMode
        ? ({ x: this.ball.x, y: this.ball.y, vx: 0, vy: 0 } as Player)
        : ({ x: this.los, y: WORLD_H / 2, vx: 0, vy: 0 } as Player));
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
        // don't shove the ball carrier, the user's player, or the kick operation
        // (holder/punter + kicker own their spots while the ball is being struck)
        const opLock = (p: Player) =>
          this.kickOp !== null &&
          p.team === this.possession &&
          (p.id.endsWith("_QB") || p.id.endsWith("_R"));
        const aLock =
          a.id === this.ball.carrier || (a.controlled && this.userOnOffense()) || opLock(a);
        const bLock =
          b.id === this.ball.carrier || (b.controlled && this.userOnOffense()) || opLock(b);
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
    // no carrier + kickMode = protecting the KICK SPOT (the held ball), not the LOS
    const protect =
      carrier ??
      (this.kickMode
        ? { x: this.ball.x, y: this.ball.y }
        : { x: this.los, y: WORLD_H / 2 });
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
      let lev = -(align - 0.15) * 22; // square set -> negative (helps the OL hold)
      // kick protection is a lunging wall, not a pass set: rushers shooting
      // gaps get a real leverage edge, so blocks off the edge are possible
      if (this.kickMode) lev += 14;
      this.resolveBlock(ol, r, true, dbl, dt, lev);
      if (this.neutralized(r)) {
        // ride him: wall off and push him away from the QB (up/around the arc).
        // dt-scaled (~1.5 yd/s) — the raw per-frame 0.55px made block physics
        // frame-rate dependent (a 144Hz display shoved 2.4x harder than the
        // 60Hz-fixed headless sim everything is tuned against).
        r.x -= qx * 33 * dt;
        r.y -= qy * 33 * dt;
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

  /** throw to a receiver. `power` (0.6 lob .. 1.3 bullet) scales ball speed — the
   *  user-variance lever (tap/hold for the human; the CPU picks ~ideal). */
  private throwTo(receiverId: string, power = 1) {
    const qb = this.carrier();
    if (!qb) return;
    const r = this.byId(receiverId);
    if (!r) return;
    const b = this.ball;

    const speed = PASS_SPEED * clamp(power, 0.6, 1.4);
    // PROPER LEAD: throw to where the receiver WILL BE when the ball arrives (the
    // full flight time, iterated once for the circular dependence). The receiver
    // auto-runs to the spot, so a correctly-led ball arrives in stride; a harder
    // throw (more power) gets there quicker (tighter window), a softer one gives
    // the DB time to close. Then QB-accuracy scatter, depth-scaled, kept inbounds.
    // lead in the receiver's ROUTE direction (toward his next waypoint), NOT his
    // instantaneous velocity — mid-cut the velocity points the wrong way and the
    // ball lands off-target (man slants died this way). Fall back to velocity if
    // the route is exhausted (scramble drill / catch-and-run).
    const wp = r.route && r.routeIdx < r.route.length ? r.route[r.routeIdx] : null;
    let hx = r.vx, hy = r.vy;
    if (wp) {
      const wd = dist(r.x, r.y, wp.x, wp.y) || 1;
      const rsp = Math.hypot(r.vx, r.vy);
      hx = ((wp.x - r.x) / wd) * rsp;
      hy = ((wp.y - r.y) / wd) * rsp;
    }
    let ft = dist(qb.x, qb.y, r.x, r.y) / speed;
    for (let it = 0; it < 2; it++) {
      ft = dist(qb.x, qb.y, r.x + hx * ft, r.y + hy * ft) / speed;
    }
    const distYd = dist(qb.x, qb.y, r.x, r.y) / YARD;
    const accKey = distYd < 20 ? "ACS" : distYd < 40 ? "ACM" : "ACD";
    const acc = rate(qb.rat, accKey);
    // throwing on the move: penalty scales with how hard the QB is actually
    // running. The old flat +0.4 kicked in at just 40% speed — the human QB is
    // nearly always drifting in the pocket to avoid the rush, so every throw
    // ate a near-doubled scatter and passing felt broken. A settled or
    // shuffling QB now throws close to clean; a full-sprint heave still scatters.
    const mv = Math.hypot(qb.vx, qb.vy) / (qb.vmax || 1);
    const onRun = mv > 0.35 ? (mv - 0.35) * 0.55 : 0;
    // deeper throws scatter more (harder to be accurate downfield)
    const scatter = (1 - acc / 99 + onRun) * (1.4 + distYd * 0.04) * YARD;
    // lead ~82% of the flight — enough to lead a deep receiver in stride while
    // keeping a trailing DB close enough to contest. (Lower underthrows the deep
    // ball; a full lead lets everyone run open.) A residual: laterally-breaking
    // routes in TIGHT coverage (man slants, cover2 crossers) still land a bit off
    // — a focused sub-fix, forgiven by looser zones.
    const lf = 0.82;
    let landX = r.x + hx * ft * lf + (rng() - 0.5) * 2 * scatter;
    let landY = r.y + hy * ft * lf + (rng() - 0.5) * 2 * scatter;
    // MISFIRE TAIL: the per-throw scatter above is tight (sub-yard at league
    // accuracy), so on its own a QB is never visibly WRONG — every incompletion
    // had to be a swat or a drop. Real QBs are mostly accurate with an
    // occasional genuine miss: sail it, short-arm it, throw behind him. That
    // miss lands well outside everyone's reach, so it resolves as a badly
    // thrown ball — the ball skipping away in space with nobody near it.
    const misfire = clamp(0.1 + (75 - acc) * 0.004 + onRun * 0.6, 0.03, 0.3);
    const badThrow = rng() < misfire;
    if (badThrow) {
      const ang = rng() * Math.PI * 2;
      const off = (2.6 + rng() * 3) * YARD;
      landX += Math.cos(ang) * off;
      landY += Math.sin(ang) * off;
    }
    landX = clamp(landX, LEFT_GOAL - 20, RIGHT_GOAL + 20);
    landY = clamp(landY, SIDELINE + 1.5 * YARD, WORLD_H - SIDELINE - 1.5 * YARD);

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
    b.fumble = false;
    b.deadBall = false;
    b.offTarget = badThrow;
    b.swatDone = false;
    const throwDist = dist(qb.x, qb.y, landX, landY);
    b.ftime = Math.max(0.32, throwDist / speed);
    // every throw arcs enough to clear underneath defenders; long balls higher.
    // a softer throw (lob) arcs higher, a bullet flatter.
    b.peak = clamp(throwDist * 0.1 * (2 - clamp(power, 0.6, 1.4)), 1.0 * YARD, 2.6 * YARD);
    // the targeted receiver auto-runs to the ball and makes the catch; control
    // hands to him only AFTER he catches it (completePass), so the pass plays
    // out the same whether the QB is the human or the CPU.
    this.message = "";
    this.audio.throw();
  }

  // ---- ball update -------------------------------------------------------
  private updateBall(dt: number) {
    const b = this.ball;
    if (this.kickMode === "kickoff") {
      if (b.inAir) {
        this.updateKickoff(dt);
        return;
      }
      // still on the tee: the AI's approach clock, or the human's meter
      if (this.kickoffWait > 0) {
        this.kickoffWait -= dt;
        if (this.kickoffWait <= 0) this.launchKickoff(0.88 + rng() * 0.12, (rng() - 0.5) * 0.5);
      }
      return;
    }
    if (this.kickMode) {
      // the snap→hold→strike operation runs until the ball actually leaves the foot
      if (!b.inAir) {
        this.updateKickOp(dt);
        return;
      }
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

    if (b.deadBall) {
      // dead ball skipping across the turf: a couple of decaying hops so the
      // incompletion has a physical beat instead of the ball blinking out
      b.x = lerp(b.sx, b.tx, b.t);
      b.y = lerp(b.sy, b.ty, b.t);
      b.z = b.peak * Math.abs(Math.sin(Math.PI * b.t * 2)) * (1 - b.t);
      if (b.t >= 1) this.deadBallSettled();
      return;
    }

    if (b.tip) {
      // loose ball after a tip/fumble: low arc, live for both teams
      b.z = b.peak * Math.sin(Math.PI * b.t);
      this.resolveLoose();
      if (this.ball.inAir && b.t >= 1) {
        // hit the turf: a tipped pass is incomplete, a fumble is dead at the spot
        if (b.fumble) this.fumbleDead();
        else this.incomplete("loose"); // the tip hit the turf
      }
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
      if (b.t >= 1) this.incomplete("badthrow"); // sailed high over everyone
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
      // the targeted receiver EXTENDS for his own ball — a generous reach so a
      // throw led a bit off still gets caught when he's the one making the play
      // (cut the "incomplete for no reason" on slightly-off-target throws). A
      // defender still needs to be genuinely AT the ball to break it up / pick it.
      const REC_REACH = CATCH_R * 2.6;
      if (rec && rd <= REC_REACH && (!nd || rd <= ndDist + LEAD_MARGIN)) {
        return this.resolveCatch(rec, contestDef, ndDist);
      }
      if (nd && ndDist <= CATCH_AREA) {
        return this.resolveDefenderBall(nd, target, ndDist);
      }
      if (b.t >= 1) this.incomplete("badthrow"); // landed in space — nobody was there
      return;
    }

    // ---- RELEASE ZONE: a defender under the low ball gets ONE deflection
    //      attempt at the line (a one-shot latch, so the per-frame check can't
    //      re-roll a near-certain swat while the ball clears the rusher). The
    //      ball must still be within SWAT_Z of the hand — past ~1.5yd of flight
    //      the arc has climbed over the underneath defenders, so a man merely
    //      standing in the lane a few yards downfield can't touch it. ----
    if (fromQB < RELEASE_ZONE) {
      if (nd && ndDist <= SWAT_R && b.z <= SWAT_Z && !b.swatDone) {
        b.swatDone = true;
        return this.resolveLineSwat(nd);
      }
      if (rec && rd <= CATCH_R) return this.resolveCatch(rec, contestDef, ndDist); // quick screen
      return;
    }

    // ---- MID FLIGHT: the ball arcs OVER the underneath defenders — it is not
    //      playable here. A defender beats the throw only at the LANDING (he was
    //      in position / undercut the route) or at the RELEASE (a hand at the
    //      line). This is what lets a properly-led ball get to an open receiver
    //      instead of being broken up in flight (GB-D005: real ball, real arc). ----
  }

  /** a defender under the low release gets one swing at the ball; most of the
   *  time the throw clears his outstretched arm, occasionally he gets a piece.
   *  Getting a piece is always a VISIBLE deflection — usually swatted down
   *  (short hop, dead when it lands), sometimes tipped up into a live ball —
   *  never an invisible straight-to-turf swat. */
  private resolveLineSwat(d: Player) {
    // 28% of low releases getting a piece (with a 6% clean pick) made throwing
    // over the line a lottery — line INTs alone tripled the NFL's ~2.3%/att
    // total. Batted balls stay a real threat, but the throw clears far more often.
    const roll = rng();
    if (roll < 0.84) return; // clears the rusher's reach — the common case
    if (roll < 0.86) return this.interception(d); // 2% pick at the line
    if (roll < 0.92) return this.startTip(d); // 6% tipped up — live ball
    return this.knockDown(d); // 8% swatted down — short dead deflection
  }

  /** the intended receiver is at the ball: completion is a SMOOTH function of his
   * separation + ratings (no hard open/contested cliff — that made it bimodal).
   * Wide open ≈ 92% (minus drops), even contest (~0.6yd) ≈ 50%, blanketed ≈ low. */
  private resolveCatch(rec: Player, nd: Player | null, ndDist: number) {
    const sep = (nd ? ndDist : 99) / YARD;
    const atk = (rate(rec.rat, "CTH") + rate(rec.rat, "CIT") + rate(rec.rat, "SPC")) / 3;
    const dfn = nd ? (rate(nd.rat, "INT") + rate(nd.rat, "JMP") + rate(nd.rat, "MCV")) / 3 : 40;
    // separation is the dominant term (≈50% at ~0.8yd, ramping each way); ratings
    // are a secondary tilt. firstContact lets a wide-open or blanketed ball spike.
    const res = contest({
      atk,
      def: dfn,
      kind: "catch",
      firstContact: true,
      // 50% point at ~0.6yd separation (was 0.8): human throw timing is never
      // harness-perfect, so tight-window balls land a beat late — centering the
      // coin flip at truly blanketed coverage keeps well-timed contested throws
      // completable without touching the wide-open or smothered ends.
      leverage: (sep - 0.6) * 13,
    });
    if (res.win) {
      const drop = clamp((90 - atk) / 320, 0.01, 0.11);
      // he had it and lost it: the ball pops UP off his hands and dies at his
      // feet, so a drop looks like a drop and never like a defensive play
      return rng() < drop
        ? this.incomplete("drop", rec)
        : this.completePass(rec);
    }
    // a loss is almost always a break-up; a pick only when the DB decisively won
    // (extreme) AND was right at the ball — kept rare (NFL INT ~2.3%/att; the
    // generous receiver-reach was over-producing picks at ~6-7%).
    if (nd && res.extreme && sep < 0.7 && rng() < 0.5) return this.interception(nd);
    if (nd && rng() < 0.1) return this.startTip(nd); // tipped up, still live
    return nd
      ? this.incomplete("swat", nd) // swatted away by the defender
      : this.incomplete("bobble", rec); // nobody there — he mishandled it
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
    // If the THROW was the problem, a defender standing near where it landed
    // didn't break anything up — the ball was never catchable. Credit the miss.
    if (this.ball.offTarget) return this.incomplete("badthrow");
    return this.incomplete("swat", nd); // knocked away by the defender
  }

  /** a deflected ball is LIVE for both teams — but securing it is an
   * OPPORTUNITY, not a certainty: a FREE player RIGHT UNDER the ball
   * (DEFLECT_R, tighter than a normal catch radius) gets one ratings-tilted
   * grab attempt. Nobody under it = dead ball on the turf; there is no
   * closest-player auto-grab. A low swatted-down hop is much harder to pluck
   * than a high floating tip; diving on a tumbling FUMBLE is near a coin flip. */
  private resolveLoose() {
    const b = this.ball;
    // let it pop up first so the tipper can't instantly re-grab it
    if (b.t < 0.35 || b.z > REACH) return;
    const fum = b.fumble;
    const cands = this.players
      .filter(
        (p) =>
          !p.tipTried &&
          !this.neutralized(p) &&
          p.stun <= 0 &&
          // offensive linemen are leaning into their blocks, not ball-hawking —
          // but EVERYONE dives on a fumble (neutralized() only marks the
          // DEFENDER side of an engagement)
          !(!fum && p.team === this.possession && p.role === "OL") &&
          dist(p.x, p.y, b.x, b.y) < DEFLECT_R
      )
      .sort((a, c) => dist(a.x, a.y, b.x, b.y) - dist(c.x, c.y, b.x, b.y));
    const hang = clamp(b.peak / (1.4 * YARD), 0.35, 1); // low hop = tiny window
    for (const p of cands) {
      p.tipTried = true; // one swing at it — a bobble doesn't re-roll every frame
      const skill =
        p.team === this.possession
          ? (rate(p.rat, "CTH") + rate(p.rat, "SPC")) / 2
          : (rate(p.rat, "INT") + rate(p.rat, "JMP")) / 2;
      const chance = fum
        ? clamp(0.45 + (skill - 70) / 200, 0.25, 0.7)
        : clamp(0.26 + (skill - 70) / 250, 0.1, 0.5) * hang;
      if (rng() < chance) {
        if (p.team === this.possession) {
          this.completePass(p);
          if (fum) this.message = "RECOVERED!";
          return;
        }
        return this.interception(p);
      }
    }
  }

  /** deflect the ball up into a live loose ball near the defender */
  private startTip(by: Player) {
    const b = this.ball;
    b.tip = true;
    b.targetId = null;
    for (const p of this.players) p.tipTried = false; // fresh 50/50 ball
    by.tipTried = true; // the tipper already played it — no instant re-grab
    b.sx = b.x;
    b.sy = b.y;
    // pops up and falls a couple of yards off the deflection
    b.tx = clamp(b.x + (rng() - 0.5) * 4 * YARD, LEFT_GOAL, RIGHT_GOAL);
    b.ty = clamp(b.y + (rng() - 0.5) * 4 * YARD, SIDELINE, WORLD_H - SIDELINE);
    b.peak = 1.4 * YARD;
    b.ftime = 0.6;
    b.elapsed = 0;
    b.t = 0;
    by.fx = 0.9;
    by.fxKind = "tip";
    this.message = "TIPPED!";
    this.audio.tackle();
  }

  /** the hit jars the ball loose: it squirts a couple of yards (mostly along
   * the carrier's motion) and tumbles — live for BOTH teams via the same
   * tight-window pickup as a tip. Nobody falls on it = dead at the spot and
   * the offense keeps it. */
  private fumble(c: Player) {
    const b = this.ball;
    c.hasBall = false;
    b.carrier = null;
    b.inAir = true;
    b.tip = true;
    b.fumble = true;
    b.targetId = null;
    for (const p of this.players) p.tipTried = false; // everyone dives fresh
    b.sx = b.x = c.x;
    b.sy = b.y = c.y;
    const sp = Math.hypot(c.vx, c.vy);
    const ux = sp > 1 ? c.vx / sp : 0;
    const uy = sp > 1 ? c.vy / sp : 0;
    const fwd = (0.8 + rng() * 1.6) * YARD;
    b.tx = clamp(c.x + ux * fwd + (rng() - 0.5) * 2 * YARD, LEFT_GOAL, RIGHT_GOAL);
    b.ty = clamp(c.y + uy * fwd + (rng() - 0.5) * 2 * YARD, SIDELINE, WORLD_H - SIDELINE);
    b.peak = 0.5 * YARD;
    b.ftime = 0.8; // slow tumble — time for the pile to arrive
    b.elapsed = 0;
    b.t = 0;
    this.message = "FUMBLE!";
    this.audio.tackle();
  }

  /** nobody fell on the fumble: dead ball at the spot, offense keeps it */
  private fumbleDead() {
    const b = this.ball;
    b.inAir = false;
    b.tip = false;
    b.fumble = false;
    b.targetId = null;
    b.z = 0;
    this.endPlay({ type: "tackle", spotX: b.x, spotY: b.y });
  }

  /** ball swatted toward the turf: a short, fast, visible deflection — still
   * live for either team, but the low hard hop makes a pluck a long shot */
  private knockDown(by: Player) {
    const b = this.ball;
    b.tip = true;
    b.targetId = null;
    for (const p of this.players) p.tipTried = false; // fresh 50/50 ball
    by.tipTried = true; // the swatter already played it — no instant re-grab
    b.sx = b.x;
    b.sy = b.y;
    b.tx = clamp(b.x + (rng() - 0.5) * 2 * YARD, LEFT_GOAL, RIGHT_GOAL);
    b.ty = clamp(b.y + (rng() - 0.5) * 2 * YARD, SIDELINE, WORLD_H - SIDELINE);
    b.peak = 0.4 * YARD;
    b.ftime = 0.35;
    b.elapsed = 0;
    b.t = 0;
    this.message = "BLOCKED!";
    this.audio.tackle();
  }

  private completePass(r: Player) {
    const b = this.ball;
    b.inAir = false;
    b.tip = false;
    b.fumble = false;
    b.deadBall = false;
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

  /** Kill the pass VISIBLY: the ball kicks off whatever ended it and bounces on
   * the turf, with a message saying what happened. `off` is the man who caused
   * it (defender who swatted / receiver who dropped) — the ball caroms away
   * from him, so the swat reads as a swat and the drop reads as a drop. */
  /** Kill the pass VISIBLY. Each cause gets its own PHYSICAL signature — how
   * fast the ball leaves, how high it pops, how far it travels, and who lights
   * up — so you can read what happened from the motion alone, without the text:
   *   swat     a hard, flat, long carom AWAY from the defender (he flashes)
   *   drop     a high floaty pop straight UP off the hands, dead at his feet
   *   bobble   a short muffed pop with nobody near him
   *   badthrow no contact at all — it skips away in space, NOBODY flashes,
   *            which is itself the tell: the throw simply missed everyone
   */
  private incomplete(
    kind: "swat" | "drop" | "bobble" | "badthrow" | "loose" = "loose",
    off: Player | null = null
  ) {
    const b = this.ball;
    if (b.deadBall) return; // already dying — don't restart the bounce
    const SIG = {
      swat: { pop: 0.45, ftime: 0.42, kick: 3.2, msg: "BROKEN UP!", fx: "swat" },
      drop: { pop: 2.0, ftime: 0.75, kick: 0.35, msg: "DROPPED!", fx: "drop" },
      bobble: { pop: 1.3, ftime: 0.6, kick: 0.9, msg: "BOBBLED!", fx: "drop" },
      badthrow: { pop: 0.9, ftime: 0.8, kick: 2.6, msg: "BADLY THROWN", fx: "" },
      loose: { pop: 0.8, ftime: 0.55, kick: 1.4, msg: "INCOMPLETE", fx: "" },
    }[kind];

    b.tip = false;
    b.fumble = false;
    b.targetId = null;
    b.inAir = true; // still a physical object until it settles
    b.deadBall = true;
    b.sx = b.x;
    b.sy = b.y;
    // caroms AWAY from the man who ended it; a drop just falls at his feet
    let ax = (rng() - 0.5) * 2;
    let ay = (rng() - 0.5) * 2;
    if (off) {
      const dx = b.x - off.x;
      const dy = b.y - off.y;
      const m = Math.hypot(dx, dy) || 1;
      ax = dx / m + (rng() - 0.5) * 0.6;
      ay = dy / m + (rng() - 0.5) * 0.6;
    }
    const kick = SIG.kick * (0.7 + rng() * 0.6) * YARD;
    b.tx = clamp(b.x + ax * kick, LEFT_GOAL - 20, RIGHT_GOAL + 20);
    b.ty = clamp(b.y + ay * kick, SIDELINE, WORLD_H - SIDELINE);
    b.peak = SIG.pop * YARD;
    b.ftime = SIG.ftime;
    b.elapsed = 0;
    b.t = 0;
    // light up the man who played it — the non-textual "who did that"
    if (off && SIG.fx) {
      off.fx = 0.9;
      off.fxKind = SIG.fx as "swat" | "drop";
    }
    this.message = SIG.msg;
    this.deadReason = SIG.msg;
    this.audio.tackle();
  }

  /** the ball has stopped bouncing — now blow the whistle */
  private deadBallSettled() {
    this.ball.inAir = false;
    this.ball.deadBall = false;
    this.ball.z = 0;
    this.endPlay({ type: "incomplete" });
    // endPlay stamps a generic "INCOMPLETE"; put the REASON back so the reason
    // for the incompletion survives the whistle (but never clobber a
    // turnover-on-downs / first-down message)
    if (this.message === "INCOMPLETE" && this.deadReason) this.message = this.deadReason;
    this.deadReason = "";
  }

  private interception(by: Player) {
    this.ball.inAir = false;
    this.ball.tip = false;
    this.ball.fumble = false;
    this.ball.deadBall = false;
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
      p.y = clamp(p.y, BOUNDS, WORLD_H - BOUNDS);
    }
  }

  private checkTackleAndScore() {
    const c = this.carrier();
    if (!c) {
      // a kick operation has a man holding the ball — he's tacklable too
      if (this.kickMode && this.kickOp === "hold") this.kickOpTackle();
      return;
    }
    const dir = this.offDir();
    const attackGoal = dir > 0 ? RIGHT_GOAL : LEFT_GOAL;
    const ownGoal = dir > 0 ? LEFT_GOAL : RIGHT_GOAL;

    // touchdown
    if (dir > 0 ? c.x >= attackGoal : c.x <= attackGoal) {
      this.touchdown();
      return;
    }

    // out of bounds: the carrier is pinned ON the boundary (clampPositions
    // holds him on the white) while driving MOSTLY INTO it — heading more than
    // ~30° outward at real speed. The old check fired on any outward drift
    // >8px/s (0.36 yd/s!) within 0.6yd of the line, so a back sprinting
    // upfield brushing the sideline — or carrying leftover momentum from a
    // juke — was whistled dead with nobody near him and no explanation.
    // Dead at the spot — in the arcade model the clock is already paused
    // between plays, so no special run-off. Forced out in his own end zone is
    // a safety, same as a tackle there.
    // pinned on the WHITE STRIPE itself (BOUNDS, not the 1yd SIDELINE inset —
    // being whistled out on unmarked green a yard inside the line read as the
    // play ending for no reason)
    const margin = 0.15 * YARD;
    const cspd = Math.hypot(c.vx, c.vy);
    const outOfBounds =
      cspd > 30 &&
      ((c.y <= BOUNDS + margin && -c.vy > 0.5 * cspd) ||
        (c.y >= WORLD_H - BOUNDS - margin && c.vy > 0.5 * cspd));
    if (outOfBounds) {
      if (dir > 0 ? c.x <= ownGoal : c.x >= ownGoal) {
        this.safety();
        return;
      }
      this.audio.whistle();
      this.endPlay({ type: "oob", spotX: c.x, spotY: c.y });
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
    let support = 0;
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
      } else if (d < 3.5 * YARD) {
        support++; // converging — arriving within a step or two of the contact
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
        // OPEN FIELD (>8yd past the LOS): pursuit SUPPORT stacks the contest —
        // a solo full-speed tackle was a coin flip (leverage +10, momentum -12)
        // and every break re-opened separation, so breakaways chained ~50/50
        // rolls into constant 20+ / housecall runs (measured brk20+ 23% vs NFL
        // 1-4%). With the pack converging the back goes down; a true one-man-
        // to-beat breakaway is still a live contest. Near the LOS this is 0 —
        // the pile dynamics stay exactly as tuned (GB-T001).
        leverage:
          10 +
          (gang - 1) * 13 +
          (dir * (c.x - this.los) > 8 * YARD ? support * 7 : 0) -
          (userTurbo ? 8 : 0),
        momentum: -spd * 12, // a back at full speed runs through arm tackles
      });
      this.tkAttempts++;
      if (res.win) {
        // STRIP: the hit can jar the ball loose before the carrier is down —
        // ball security (CAR) vs the hit, and a big clean shot (sev) strips
        // more. Rare (~2% of tackles), but a live scramble when it happens.
        const hitR = (rate(tk.rat, "HIT") + rate(tk.rat, "PWR")) / 2;
        const secR = rate(c.rat, "CAR");
        const strip = clamp(0.02 + 0.035 * res.sev + (hitR - secR) / 2000, 0.005, 0.08);
        if (rng() < strip) return this.fumble(c);
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

    // user throws while at QB on a pass play — but not from past the line of
    // scrimmage (there was no LOS check at all: you could scramble 20 yards
    // downfield and legally fire to any receiver, a rule the CPU QB never got
    // to break). Attempting it says WHY nothing happened instead of eating
    // the input silently.
    if (
      this.userOnOffense() &&
      this.ball.carrier === p.id &&
      this.offPlay.kind === "pass"
    ) {
      const ldir = this.offDir();
      const pastLOS = ldir * (p.x - this.los) > 0.5 * YARD;
      const wantsThrow =
        this.input.pressed("KeyJ") ||
        Object.keys(TARGET_KEYS).some((c) => this.input.pressed(c));
      if (pastLOS) {
        if (wantsThrow) this.message = "PAST THE LINE — CAN'T PASS";
        return;
      }
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
    type: "tackle" | "incomplete" | "turnover" | "oob";
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

    // a KICKOFF RETURN doesn't advance a down — the return team simply takes
    // over first-and-ten wherever he was brought down
    if (this.kickReturn) {
      this.kickReturn = false;
      const spot = clamp(res.spotX ?? this.los, LEFT_GOAL, RIGHT_GOAL);
      this.setNewSeries(spot);
      this.message = "1ST & 10";
      return;
    }

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
      if (res.type === "oob")
        // say WHY the whistle blew — an unexplained dead ball near the sideline
        // reads as the play ending for no reason
        this.message = `OUT OF BOUNDS • ${gainYds >= 0 ? "+" : ""}${gainYds} YDS`;
      else if (res.type !== "incomplete" && gainYds !== 0)
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
    // after a safety the team that conceded free-kicks: possession goes to the
    // scoring team NOW, and the kickoff must NOT flip it again ("keep").
    this.pendingKickoff = "keep";
    this.possession = def;
  }

  /** who receives the post-score kickoff: "flip" = other team (TD/FG/PAT),
   *  "keep" = possession was already set (safety free kick). A typed flag —
   *  this used to be decided by comparing this.message to "SAFETY!". */
  private pendingKickoff: "flip" | "keep" | null = null;
  private tossResult: { flip: "heads" | "tails"; userWon: boolean } | null = null;
  private tossChoice: "receive" | "kick" | null = null;
  private openingKickoff = false;
  private kickingTeam: Team = "away";
  /** who kicked off to open the GAME — the second half flips it, so whoever
   *  kicked to start the game receives to start the third quarter */
  private openingKicker: Team = "away";
  /** game-day wind. Blows toward one goal all game (the teams don't switch
   *  ends here), so it's a standing advantage one way and a tax the other —
   *  which is what makes the toss a real choice instead of "always receive". */
  private wind = { dir: 1, mph: 0 };
  /** where the wind is heading next, and how long until it picks a new mind.
   *  The speed EASES toward the target — it is never re-rolled on a kick, so a
   *  gust can build or die across a quarter but never jumps between snaps. */
  private windTarget = 0;
  private windTimer = 0;
  /** a half just ended: the next play is the second-half kickoff */
  private halftimeKickoff = false;
  /** this play is a KICKOFF RETURN: it ends in a fresh series for the returner's
   *  team at the spot, not in down-and-distance bookkeeping */
  private kickReturn = false;
  /** seconds until the teed kickoff is struck */
  private kickoffWait = 0;

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
    if (this.halftimeKickoff) {
      // second-half kickoff: the team that RECEIVED to open the game kicks it
      this.halftimeKickoff = false;
      this.pendingKickoff = null;
      this.startKickoff(this.openingKicker === "home" ? "away" : "home");
      return;
    }
    if (this.pendingKickoff) {
      // after a score, the team that just scored KICKS OFF — a real played
      // kickoff now, not a teleport to the receiving team's 25
      if (this.pendingKickoff === "flip") this.flipForKick();
      this.pendingKickoff = null;
      // `possession` is the RECEIVING team here; the scorer kicks
      this.startKickoff(this.possession === "home" ? "away" : "home");
      return;
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
      // HALFTIME: the second half opens with a kickoff, and it's the other way
      // round — whoever kicked off to start the game receives now.
      if (this.quarter === 3) {
        this.halftimeKickoff = true;
        this.message = "HALFTIME";
      } else {
        this.message = `END OF Q${this.quarter - 1}`;
      }
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
      // impact flash — expands + fades, colour says what kind of play it was:
      // a defensive play on the ball (swat/tip) vs an offensive gaffe (drop)
      if (p.fx > 0) {
        const k = 1 - p.fx / 0.9; // 0 at contact -> 1 as it fades
        const col = p.fxKind === "drop" ? 0xff5a4d : 0x6fd8ff;
        s.fx.clear();
        s.fx
          .circle(0, 0, 12 + k * 20)
          .stroke({ width: 3.5 * (1 - k), color: col, alpha: 0.95 * (1 - k) });
        s.fx.visible = true;
      } else if (s.fx.visible) {
        s.fx.clear();
        s.fx.visible = false;
      }
      // Chips stay up until the ball is CAUGHT or the next play starts — they
      // used to vanish the instant the QB let go, which is exactly when you
      // need them to read who the throw was for and what happened to it.
      const caught = !!this.ball.carrier && !this.ball.carrier.endsWith("_QB");
      const showLabel =
        (this.phase === "live" || this.phase === "dead") &&
        this.userOnOffense() &&
        this.offPlay.kind === "pass" &&
        !caught &&
        !!p.target;
      s.label.visible = !!showLabel;
      s.labelBg.visible = !!showLabel;
      if (showLabel) s.label.text = p.target!;
    }
    // ball
    this.drawBall();
    this.drawKickMeter();
  }

  /** screen-space two-stage kick meter (power gauge, then accuracy sweep). */
  private drawKickMeter() {
    const g = this.meterGfx;
    g.clear();
    if (!this.kickStage) return;
    const cx = this.viewW / 2;
    const baseY = this.viewH - 46;
    const W = Math.min(300, this.viewW * 0.7);
    const H = 18;
    const x0 = cx - W / 2;
    // track
    g.roundRect(x0 - 6, baseY - 6, W + 12, H + 12, 8).fill({ color: 0x0a0e1a, alpha: 0.8 });
    g.roundRect(x0, baseY, W, H, 5).fill({ color: 0x1a2440, alpha: 0.95 });
    if (this.kickStage === "power") {
      // fill proportional to the oscillating power
      g.roundRect(x0, baseY, W * this.kickMeter, H, 5).fill({ color: 0x8fb8ff });
    } else {
      // accuracy: center sweet-spot band + the moving marker. The made test is
      // |meter*2-1| <= kickAccWin, i.e. meter within kickAccWin/2 of center (0.5),
      // so the band spans W*kickAccWin total, centered.
      const bandHalf = (W * this.kickAccWin) / 2;
      g.roundRect(cx - bandHalf, baseY, bandHalf * 2, H, 5).fill({ color: 0x2fae62, alpha: 0.9 });
      const mx = x0 + W * this.kickMeter;
      g.roundRect(mx - 3, baseY - 5, 6, H + 10, 3).fill({ color: 0xffe600 });
    }
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
      wind: { dir: this.wind.dir, mph: Math.round(this.wind.mph) },
      quarter: this.quarter,
      clock: Math.ceil(this.clock),
      home: this.score.home,
      away: this.score.away,
      possession: this.possession,
      down: this.down,
      toGo: this.toGo,
      ballOn: this.ballOnText(),
      message: this.message,
      userOnOffense: this.userOnOffense(),
      canHike: this.phase === "presnap" && this.userOnOffense(),
      canThrow:
        this.phase === "live" &&
        this.userOnOffense() &&
        this.offPlay.kind === "pass" &&
        this.ball.carrier?.endsWith("_QB") === true &&
        // throw buttons disappear once the QB crosses the line (no forward
        // passes past the LOS — matches the applyUserMove gate)
        (() => {
          const c = this.carrier();
          return !!c && this.offDir() * (c.x - this.los) <= 0.5 * YARD;
        })(),
      canSwitch: this.phase === "live" && !this.userOnOffense(),
      kicking: this.kickStage !== null,
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
    // impact flash — expands and fades on the man who just touched the ball,
    // so WHO made the play is visible without reading a word
    const fx = new Graphics();
    fx.visible = false;

    const isHome = p.team === "home";
    const fill = isHome ? COLORS.home : COLORS.away;
    const dark = isHome ? COLORS.homeDark : COLORS.awayDark;
    body.circle(0, 0, 11).fill(fill);
    body.circle(0, 0, 11).stroke({ width: 2, color: dark });
    // little helmet stripe
    body.rect(-2, -11, 4, 6).fill(dark);

    const num = new Text({
      text: String(p.number),
      // bumped 10 -> 16 visual (numbers were unreadable at gameplay zoom). Rendered
      // at 32 with resolution 2 then scaled to half so the glyphs stay crisp when
      // the camera scales the sprite. 16px nearly fills the 22px body — a real
      // jersey number, two digits still fit.
      style: { fontFamily: "monospace", fontSize: 32, fill: 0xffffff, fontWeight: "bold" },
      resolution: 2,
    });
    num.anchor.set(0.5);
    num.scale.set(0.5);
    num.y = 1;

    // target marker: an upper-right callout chip (offset off the body so it tags
    // the receiver without sitting on top of him or a player directly above).
    // Sized for a phone at gameplay zoom: the chip has to be readable at a
    // glance while you're reading the whole field, so it's nearly as big as the
    // player himself (was a 16x18 chip with 14px glyphs — invisible in motion).
    const LBX = 19;
    const LBY = -22;
    const labelBg = new Graphics();
    labelBg
      .roundRect(-14, -15, 28, 30, 8)
      .fill({ color: 0x0a0e1a, alpha: 0.92 })
      .stroke({ width: 2.5, color: COLORS.highlight });
    labelBg.x = LBX;
    labelBg.y = LBY;
    labelBg.visible = false;

    const label = new Text({
      text: p.target ?? "",
      style: {
        fontFamily: "monospace",
        fontSize: 52, // rendered big, scaled to half -> 26px on the chip, crisp
        fill: COLORS.highlight,
        fontWeight: "bold",
      },
      resolution: 2,
    });
    label.anchor.set(0.5);
    label.scale.set(0.5);
    label.x = LBX;
    label.y = LBY;
    label.visible = false;

    c.addChild(shadow, ring, fx, body, num, labelBg, label);
    c.x = p.x;
    c.y = p.y;
    this.world.addChild(c);
    this.sprites.set(p.id, { c, body, ring, fx, num, label, labelBg });
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
    // sidelines — thick and unmissable: this stripe IS the out-of-bounds line
    // the carrier can be forced out on (movement pins at BOUNDS, inside the
    // band, so a whistled carrier is visibly standing ON the white)
    const stripe = BOUNDS + 3;
    g.rect(0, 0, WORLD_W, stripe).fill(COLORS.line);
    g.rect(0, WORLD_H - stripe, WORLD_W, stripe).fill(COLORS.line);

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
    // placeholders — attachRatings derives the real kinematics from SPD/ACC/AGI
    vmax: 8 * YARD,
    vacc: 116,
    vturn: 650,
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
    tipTried: false,
    fx: 0,
    fxKind: "",
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
    fumble: false,
    deadBall: false,
    offTarget: false,
    swatDone: false,
  };
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

function ord(n: number) {
  return n === 1 ? "1ST" : n === 2 ? "2ND" : n === 3 ? "3RD" : `${n}TH`;
}
