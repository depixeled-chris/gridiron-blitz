// Per-position realism validation — measures the sim's OUTCOME DISTRIBUTIONS
// across player tiers and compares them to the NFL targets in
// design/realism-targets.md. Drives the engine via the window.__game test hooks
// against the dev server (npm run dev), so it exercises the real game loop.
//
// Usage:  node scripts/validate-realism.mjs [section]
//   section = rush | protect | pass | coverage | catch | tackle | kick | st | all (default)
// Env:  BASE (dev url, default http://localhost:5173)  CHROME (chrome path)
//       PUP  (puppeteer-core module path, default /tmp/node_modules/...)
//       N    (samples per cell, default 60)
//
// NOTE: this is a measurement harness, not an assertion suite — it prints
// sim-vs-target so tuning can target the gaps. FAIL = outside the target band.

const BASE = process.env.BASE || "http://localhost:5173";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PUP = process.env.PUP || "/tmp/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const N = Number(process.env.N || 60);
const SECTION = process.argv[2] || "all";

const puppeteer = (await import(PUP)).default;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--use-gl=swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function boot() {
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await sleep(900);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => /START/i.test(x.textContent))?.click());
  await sleep(500);
  await page.evaluate(() => document.querySelector(".ib-close")?.click());
  await page.evaluate(() => window.__game.testAutoCarrier(true));
}
await boot();
const st = () => page.evaluate(() => window.__game.testState());
const call = (m, ...a) => page.evaluate((m, a) => window.__game[m](...a), m, a);
const tiers = (off, def) => call("testTiers", off, def);
let SEED = 99;
const reseed = () => call("testReseed", (SEED = (SEED * 1103515245 + 12345) & 0x7fffffff));
const pad = (s, n) => String(s).padStart(n);
function band(label, val, lo, hi, unit = "%") {
  const ok = val >= lo && val <= hi;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(26)} sim ${pad(val, 5)}${unit}   target ${lo}-${hi}${unit}`);
}

// run one play to resolution; returns {gain, msg, sacked, threw}
async function playRun(form, play) {
  await call("testNewSeries", 40);
  const before = await st();
  await reseed();
  await call("testChoose", form, play);
  await call("testSnap");
  let s;
  for (let k = 0; k < 80; k++) { s = await st(); if (s.phase !== "live" && k > 3) break; await sleep(40); }
  return { gain: Math.round((s.los - before.los) / 22), msg: s.msg };
}

// ----- RUSH -----
async function rush() {
  console.log("\n=== RUSHING (RB + line) — per-carry distribution ===");
  console.log("  NFL: stuff 19-21%, success(4-9) 30-35%, explosive(10+) ~11%, avg ~4.2");
  const cells = [["RB bad60 v avg", 60, 75], ["RB avg75 v avg", 75, 75], ["RB elite90 v avg", 90, 75], ["avg v elite-front90", 75, 90]];
  const runs = ["dive", "iso", "power", "counter", "sweep"];
  for (const [label, off, def] of cells) {
    await tiers(off, def);
    const ys = [];
    for (let i = 0; i < N; i++) { try { ys.push((await playRun("iform", runs[i % 5])).gain); } catch { await boot(); await tiers(off, def); } }
    const n = ys.length, pct = (f) => Math.round(ys.filter(f).length / n * 100);
    const avg = Math.round(ys.reduce((a, b) => a + b, 0) / n * 10) / 10;
    console.log(`  ${label.padEnd(20)} n=${n} avg=${avg}  stuff ${pad(pct((y) => y <= 0), 3)}%  succ ${pad(pct((y) => y >= 4 && y <= 9), 3)}%  exp10+ ${pad(pct((y) => y >= 10), 3)}%  max ${Math.max(...ys)}`);
  }
}

// ----- PASS PROTECTION / RUSH — sack rate + time-to-pressure -----
async function protect() {
  console.log("\n=== PASS PRO vs RUSH — sack rate / dropback (QB holds the ball) ===");
  console.log("  NFL: league sack ~7%/dropback; elite-rush-vs-bad-OL much higher, mismatch widens");
  const cells = [["avg OL v avg DL", 75, 75], ["good OL v avg DL", 85, 75], ["bad OL v elite DL", 62, 92], ["elite OL v bad DL", 92, 62]];
  for (const [label, off, def] of cells) {
    await tiers(off, def);
    let sacks = 0, n = 0; const times = [];
    for (let i = 0; i < N; i++) {
      try {
        await call("testNewSeries", 40); await reseed();
        await call("testChoose", "shotgun", "crossers"); await call("testSnap");
        let sacked = false, t = 0;
        for (let k = 0; k < 90; k++) { const s = await st(); t = s.liveTime; if (s.phase !== "live") { if (s.carrier && s.carrier.endsWith("_QB")) { sacked = true; } break; } if (t > 4.5) break; await sleep(40); }
        n++; if (sacked) { sacks++; times.push(t); }
      } catch { await boot(); await tiers(off, def); }
    }
    times.sort((a, b) => a - b);
    console.log(`  ${label.padEnd(20)} n=${n}  sack ${pad(Math.round(sacks / n * 100), 3)}%/dropback  median time-to-sack ${times.length ? times[Math.floor(times.length / 2)].toFixed(1) : "-"}s`);
  }
}

// ----- PASSING by depth + INT -----
async function pass() {
  console.log("\n=== PASSING — completion by depth + INT (throw to a set route) ===");
  console.log("  NFL: short ~73%, intermediate ~52%, deep(20+) ~37%; INT ~2.3%/att");
  // play -> the A receiver's route depth: slants short, crossers intermediate, fourverts deep
  const depths = [["short", "slants", 600], ["intermediate", "crossers", 1000], ["deep", "fourverts", 1500]];
  await tiers(75, 75);
  for (const [name, play, waitMs] of depths) {
    let comp = 0, inc = 0, intc = 0, n = 0;
    for (let i = 0; i < N; i++) {
      try {
        await call("testNewSeries", 40); await reseed();
        await call("testChoose", "shotgun", play); await call("testSnap");
        await sleep(waitMs); await call("testThrowTo", "1");
        let s; for (let k = 0; k < 70; k++) { s = await st(); if (s.phase !== "live" && k > 2) break; await sleep(40); }
        const m = s.msg; n++;
        if (/INTERCEPT|TURNOVER/.test(m)) intc++;
        else if (s.carrier && s.carrier.startsWith("home_") && !s.carrier.endsWith("_QB")) comp++;
        else inc++;
      } catch { await boot(); await tiers(75, 75); }
    }
    const compPct = n ? Math.round(comp / (comp + inc + intc) * 100) : 0;
    console.log(`  ${name.padEnd(14)} (${play}) n=${n}  completion ${pad(compPct, 3)}%  INT ${pad(n ? Math.round(intc / n * 100) : 0, 3)}%`);
  }
}

// ----- COVERAGE — completion allowed by CB tier -----
async function coverage() {
  console.log("\n=== COVERAGE — completion ALLOWED targeting into coverage, by DB tier ===");
  console.log("  NFL: elite CB ~40% allowed, avg ~60%, bad ~75%; INT/target 1-8%");
  const cells = [["WR75 v bad CB60", 75, 60], ["WR75 v avg CB75", 75, 75], ["WR75 v elite CB90", 75, 90]];
  for (const [label, off, def] of cells) {
    await tiers(off, def);
    let comp = 0, intc = 0, n = 0;
    for (let i = 0; i < N; i++) {
      try {
        await call("testNewSeries", 40); await reseed();
        await call("testChoose", "shotgun", "crossers"); await call("testSnap");
        await sleep(1000); await call("testThrowTo", "1");
        let s; for (let k = 0; k < 70; k++) { s = await st(); if (s.phase !== "live" && k > 2) break; await sleep(40); }
        n++; if (/INTERCEPT|TURNOVER/.test(s.msg)) intc++; else if (s.carrier && s.carrier.startsWith("home_") && !s.carrier.endsWith("_QB")) comp++;
      } catch { await boot(); await tiers(off, def); }
    }
    console.log(`  ${label.padEnd(20)} n=${n}  completion allowed ${pad(n ? Math.round(comp / n * 100) : 0, 3)}%  INT/target ${pad(n ? Math.round(intc / n * 100) : 0, 3)}%`);
  }
}

// ----- TACKLING — broken-tackle rate by tier -----
async function tackle() {
  console.log("\n=== TACKLING — broken-tackle rate per contact, by tier ===");
  console.log("  NFL: forced-miss/carry ~.18 avg (elite ~.30, bad ~.12) ≈ break rate per contact");
  const cells = [["bad RB60 v avg D", 60, 75], ["avg RB75 v avg D", 75, 75], ["elite RB90 v avg D", 90, 75], ["avg RB v bad D60", 75, 60]];
  const runs = ["dive", "iso", "power", "counter", "sweep"];
  for (const [label, off, def] of cells) {
    await tiers(off, def);
    await call("testBreakStats"); // reset
    for (let i = 0; i < N; i++) { try { await playRun("iform", runs[i % 5]); } catch { await boot(); await tiers(off, def); } }
    const s = await call("testBreakStats");
    const rate = s.attempts ? Math.round(s.breaks / s.attempts * 100) : 0;
    console.log(`  ${label.padEnd(20)} contacts=${s.attempts} broken=${s.breaks}  break rate ${pad(rate, 3)}%/contact`);
  }
}

// ----- KICKING — FG% by distance -----
async function kick() {
  console.log("\n=== KICKING — FG% by distance ===");
  console.log("  NFL: 20-29 ~97%, 30-39 ~94%, 40-49 ~77%, 50+ ~70%");
  const dists = [[25, "20-29", 97], [35, "30-39", 94], [45, "40-49", 77], [52, "50-59", 70]];
  for (const [d, lbl] of dists) {
    const ownYd = 117 - d; let good = 0, n = 0;
    for (let i = 0; i < N; i++) {
      try {
        await call("testNewSeries", ownYd); const before = await st(); await reseed();
        await call("testChoose", "special", "fieldgoal"); await call("testSnap");
        let s; for (let k = 0; k < 70; k++) { s = await st(); if (s.phase !== "live" && k > 2) break; await sleep(40); }
        n++; if (s.score.home - before.score.home === 3) good++;
      } catch { await boot(); }
    }
    console.log(`  ${lbl}yd  n=${n}  made ${pad(n ? Math.round(good / n * 100) : 0, 3)}%`);
  }
}

// ----- SPECIAL TEAMS — PAT / 2pt -----
async function stteams() {
  console.log("\n=== SPECIAL TEAMS — PAT / 2pt ===");
  console.log("  NFL: PAT ~95.8%, 2pt ~48%");
  let pat = 0, np = 0;
  for (let i = 0; i < N; i++) { try { await call("testStartTry"); const b = await st(); await reseed(); await call("testChoose", "convert", "xp"); await call("testSnap"); let s; for (let k = 0; k < 60; k++) { s = await st(); if (s.phase !== "live" && k > 2) break; await sleep(40); } np++; if (s.score.home - b.score.home === 1) pat++; } catch { await boot(); } }
  console.log(`  PAT   n=${np}  made ${pad(np ? Math.round(pat / np * 100) : 0, 3)}%`);
  let two = 0, nt = 0;
  for (let i = 0; i < N; i++) { try { await call("testStartTry"); const b = await st(); await reseed(); const pass = i % 2 === 1; await call("testChoose", "convert", pass ? "twoslants" : "twodive"); await call("testSnap"); if (pass) { await sleep(700); await call("testThrowOpen"); } let s; for (let k = 0; k < 70; k++) { s = await st(); if (s.phase !== "live" && k > 2) break; await sleep(40); } nt++; if (s.score.home - b.score.home === 2) two++; } catch { await boot(); } }
  console.log(`  2PT   n=${nt}  converted ${pad(nt ? Math.round(two / nt * 100) : 0, 3)}%`);
}

const all = { rush, protect, pass, coverage, tackle, kick, st: stteams };
console.log(`VALIDATE REALISM — N=${N}/cell — ${new Date().toISOString()}`);
if (SECTION === "all") { for (const k of Object.keys(all)) await all[k](); }
else if (all[SECTION]) await all[SECTION]();
else console.log("unknown section:", SECTION);
await browser.close();
