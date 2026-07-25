// Matchup- and tier-aware realism validation, headless + deterministic.
//   node scripts/headless/build.mjs && node scripts/headless/validate.mjs [section]
// section = rush | rushtier | pass | coverage | all (default)
import { Game } from "./.game-headless.mjs";

const DT = 1 / 60;
const g = new Game();
g.setHeadless(true);
g.startGame();
g.testAutoCarrier(true);
const SECTION = process.argv[2] || "all";
let SEED = 1;
const reseed = () => g.testReseed((SEED = (SEED * 1103515245 + 12345) & 0x7fffffff));

function play({ off = null, def = null, defForm, defPlay, form, pid, throwAt = null, throwKey = null, los = 40 }) {
  g.testTiers(off, def);
  g.testDefense(defForm, defPlay);
  g.testNewSeries(los);
  const before = g.testState();
  reseed();
  g.testChoose(form, pid);
  g.testSnap();
  let s = before, threw = false;
  for (let k = 0; k < 340; k++) {
    if (throwAt !== null && k === throwAt) { threw = true; if (throwKey) g.testThrowTo(throwKey); else g.testThrowOpen(); }
    g.testStep(DT);
    s = g.testState();
    if (s.phase !== "live" && k > 2) break;
  }
  return { gain: Math.round((s.los - before.los) / 22), msg: s.msg, carrier: s.carrier, threw, score: s.score.home - before.score.home };
}

const pct = (a, f) => Math.round(a.filter(f).length / a.length * 100);
const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10;

function rushCell(label, opts, N = 120) {
  const runs = ["dive", "iso", "power", "counter", "sweep"];
  const ys = [];
  for (let i = 0; i < N; i++) ys.push(play({ ...opts, form: "iform", pid: runs[i % 5] }).gain);
  console.log(`  ${label.padEnd(30)} avg ${String(avg(ys)).padStart(4)}  stuff ${String(pct(ys, (y) => y <= 0)).padStart(3)}%  succ ${String(pct(ys, (y) => y >= 4 && y <= 9)).padStart(3)}%  exp10+ ${String(pct(ys, (y) => y >= 10)).padStart(3)}%  max ${Math.max(...ys)}`);
}

function rush() {
  console.log("\n=== RUSH by DEFENSIVE MATCHUP (neutral 75v75) — box count should swing it ===");
  console.log("  NFL feel: vs heavy box high stuff; vs base ~20% stuff; vs light box (dime/prevent) gash");
  rushCell("vs GOAL-LINE (heavy box)", { defForm: "goalline", defPlay: "man" });
  rushCell("vs 5-2 (run-stuff 7box)", { defForm: "fivetwo", defPlay: "cover2" });
  rushCell("vs 4-3 base cover3", { defForm: "fourthree", defPlay: "cover3" });
  rushCell("vs NICKEL cover2", { defForm: "nickel", defPlay: "cover2" });
  rushCell("vs DIME cover4 (light box)", { defForm: "dime", defPlay: "cover4" });
  rushCell("vs PREVENT (4-3 cover4)", { defForm: "fourthree", defPlay: "prevent" });
}

function rushtier() {
  console.log("\n=== RUSH by RB/FRONT TIER (vs 4-3 base cover3) ===");
  console.log("  NFL: stuff bad~26 avg~20 elite~16; back tier fattens explosive, line owns stuff");
  rushCell("RB bad60 v avg75 front", { off: 60, def: 75, defForm: "fourthree", defPlay: "cover3" });
  rushCell("RB avg75 v avg75 front", { off: 75, def: 75, defForm: "fourthree", defPlay: "cover3" });
  rushCell("RB good83 v avg75 front", { off: 83, def: 75, defForm: "fourthree", defPlay: "cover3" });
  rushCell("RB elite90 v avg75 front", { off: 90, def: 75, defForm: "fourthree", defPlay: "cover3" });
  rushCell("avg75 v bad60 front", { off: 75, def: 60, defForm: "fourthree", defPlay: "cover3" });
  rushCell("avg75 v elite90 front", { off: 75, def: 90, defForm: "fourthree", defPlay: "cover3" });
}

function passCell(label, opts, throwAt, throwKey, N = 100) {
  let comp = 0, inc = 0, intc = 0, sack = 0;
  for (let i = 0; i < N; i++) {
    const r = play({ ...opts, throwAt, throwKey });
    if (/INTERCEPT|TURNOVER/.test(r.msg)) intc++;
    else if (r.carrier && r.carrier.startsWith("home_") && !r.carrier.endsWith("_QB")) comp++;
    else if (!r.threw || (r.carrier && r.carrier.endsWith("_QB"))) sack++;
    else inc++;
  }
  const att = comp + inc + intc;
  console.log(`  ${label.padEnd(30)} comp ${String(att ? Math.round(comp / att * 100) : 0).padStart(3)}%  INT ${String(Math.round(intc / N * 100)).padStart(3)}%  sack ${String(Math.round(sack / N * 100)).padStart(3)}%`);
}

function pass() {
  console.log("\n=== PASS — man + cover3 × depth × tier (GB-T002 Phase-0 baseline) ===");
  console.log("  NFL targets: short ~73 / intermediate ~52 / deep ~37; INT ~2.3%; contested ~47%");
  for (const [cov, covLabel] of [["man", "MAN"], ["cover3", "COVER3"]]) {
    console.log(`  -- vs ${covLabel} (neutral 75v75) --`);
    passCell("  slants(short)", { off: 75, def: 75, defForm: "fourthree", defPlay: cov, form: "shotgun", pid: "slants" }, 36, "1");
    passCell("  crossers(mid)", { off: 75, def: 75, defForm: "fourthree", defPlay: cov, form: "shotgun", pid: "crossers" }, 60, "1");
    passCell("  fourverts(deep)", { off: 75, def: 75, defForm: "fourthree", defPlay: cov, form: "shotgun", pid: "fourverts" }, 90, "1");
  }
  console.log("  -- tier (crossers mid v cover3) --");
  passCell("  bad off60", { off: 60, def: 75, defForm: "fourthree", defPlay: "cover3", form: "shotgun", pid: "crossers" }, 60, "1");
  passCell("  elite off90", { off: 90, def: 75, defForm: "fourthree", defPlay: "cover3", form: "shotgun", pid: "crossers" }, 60, "1");
  passCell("  v elite CB90", { off: 75, def: 90, defForm: "fourthree", defPlay: "cover3", form: "shotgun", pid: "crossers" }, 60, "1");
}

function kickCell(label, kic, N = 120) {
  // FG distance = 117 - ownYd; tier set via testTiers(off=kicker rating)
  const dists = [[25, 92], [35, 82], [45, 72], [52, 65], [57, 60]];
  const out = [];
  for (const [d, ownYd] of dists) {
    let good = 0;
    for (let i = 0; i < N; i++) {
      g.testTiers(kic, 75);
      g.testDefense(null, null);
      g.testNewSeries(ownYd);
      const before = g.testState();
      reseed();
      g.testChoose("placekick", "fieldgoal");
      g.testSnap();
      let s = before;
      // 340-frame budget: kicks now hold ~1.3s at the spot (live rush) before launching
      for (let k = 0; k < 340; k++) { g.testStep(DT); s = g.testState(); if (s.phase !== "live" && k > 2) break; }
      if (s.score.home - before.score.home === 3) good++;
    }
    out.push(`${d}yd ${String(Math.round(good / N * 100)).padStart(3)}%`);
  }
  console.log(`  ${label.padEnd(18)} ${out.join("  ")}`);
}

function kick() {
  console.log("\n=== FIELD GOALS by distance × kicker tier ===");
  console.log("  NFL (avg): 20-29 ~97, 30-39 ~94, 40-49 ~77, 50-59 ~70; tier swings 50+ most");
  kickCell("bad K (60)", 60);
  kickCell("avg K (75)", 75);
  kickCell("elite K (90)", 90);
}

const all = { rush, rushtier, pass, kick };
const t0 = Date.now();
console.log(`HEADLESS VALIDATE — ${new Date().toISOString()}`);
if (SECTION === "all") for (const k of Object.keys(all)) all[k]();
else if (all[SECTION]) all[SECTION]();
else console.log("unknown section");
console.log(`\n(${Date.now() - t0}ms)`);
