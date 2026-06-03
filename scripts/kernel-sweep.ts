// Headless validation of the contest kernel against design/build-plan.md Phase 0
// acceptance bands. Run: node --experimental-strip-types scripts/kernel-sweep.ts
import { contest, reseed } from "../src/game/contest.ts";
import { ROSTERS, rate } from "../src/game/ratings.ts";

reseed(12345);
let failures = 0;
const ok = (cond: boolean, label: string, detail: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}  ${detail}`);
  if (!cond) failures++;
};
const pct = (n: number) => (n * 100).toFixed(1) + "%";

const N = 300_000;

// ---- 1. mean win rate (instant, non-extreme path) by delta ----
function winRate(delta: number) {
  let w = 0;
  for (let i = 0; i < N; i++) if (contest({ atk: 50 + delta, def: 50, kind: "tackle" }).win) w++;
  return w / N;
}
const w0 = winRate(0);
const w16 = winRate(16);
const w48 = winRate(48);
ok(w0 >= 0.48 && w0 <= 0.52, "win@delta0", `${pct(w0)} (want 48-52%)`);
ok(w16 >= 0.7 && w16 <= 0.76, "win@delta16", `${pct(w16)} (want 70-76%)`);
ok(w48 >= 0.93 && w48 <= 0.96, "win@delta48", `${pct(w48)} (want 93-96%)`);

// ---- 2. extreme (pancake / blow-by) rate by delta, at first contact ----
function extremeRate(delta: number) {
  let e = 0;
  for (let i = 0; i < N; i++)
    if (contest({ atk: 50 + delta, def: 50, firstContact: true, kind: "block" }).extreme) e++;
  return e / N;
}
const e0 = extremeRate(0);
const e48 = extremeRate(48);
ok(e0 < 0.005, "extreme@delta0", `${pct(e0)} (want <0.5%)`);
ok(e48 >= 0.35 && e48 <= 0.45, "extreme@delta48", `${pct(e48)} (want 35-45%)`);

// ---- 3. severity distribution at an EVEN matchup ----
let sevTail = 0,
  sevLow = 0;
for (let i = 0; i < N; i++) {
  const s = contest({ atk: 50, def: 50, kind: "tackle" }).sev;
  if (s > 0.4) sevTail++;
  if (s < 0.2) sevLow++;
}
sevTail /= N;
sevLow /= N;
ok(sevLow > 0.9, "sev@even clusters low", `${pct(sevLow)} <0.2 (want >90%)`);
ok(sevTail >= 0.05 && sevTail <= 0.08, "sev@even X-factor tail", `${pct(sevTail)} >0.4 (want 5-8%)`);

// ---- 4. continuous pass-pro hold time (even matchup) ----
function holdTimes(delta: number, n: number) {
  const dt = 1 / 60;
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    let t = 0;
    let first = true;
    // rusher (atk) tries to beat blocker (def); win => shed/pressure
    for (;;) {
      const r = contest({ atk: 50 + delta, def: 50, perFrame: dt, firstContact: first, kind: "block" });
      first = false;
      t += dt;
      if (r.win || r.extreme || t > 8) break;
    }
    times.push(t);
  }
  times.sort((a, b) => a - b);
  return times;
}
const ht = holdTimes(0, 20_000);
const median = ht[Math.floor(ht.length / 2)];
const under15 = ht.filter((t) => t < 1.5).length / ht.length;
const over4 = ht.filter((t) => t >= 4).length / ht.length;
ok(median >= 2.3 && median <= 3.1, "pocket median (even)", `${median.toFixed(2)}s (want ~2.7)`);
console.log(`      pocket: <1.5s ${pct(under15)}, >=4s ${pct(over4)} (fat tail expected)`);

// ---- 5. designed roster mismatch: AWAY EDGE91 finesse vs HOME RT76 (delta ~+22) ----
function pressureFast(delta: number, n: number) {
  const dt = 1 / 60;
  let fast = 0,
    superWin = 0;
  for (let i = 0; i < n; i++) {
    let t = 0;
    let first = true;
    for (;;) {
      const r = contest({ atk: 50 + delta, def: 50, perFrame: dt, firstContact: first, kind: "block" });
      if (first && r.extreme) superWin++;
      first = false;
      t += dt;
      if (r.win || r.extreme || t > 8) break;
    }
    if (t < 2.0) fast++;
  }
  return { fast: fast / n, superWin: superWin / n };
}
const edge = pressureFast(22, 20_000);
console.log(`      EDGE+22 vs RT: pressure<2.0s ${pct(edge.fast)}, instant super-win ${pct(edge.superWin)}`);

// ---- 6. designed mismatches derived straight from the baked rosters ----
const H = ROSTERS.home;
const A = ROSTERS.away;
const dEdge = rate(A.EDGE91, "FMV") - rate(H.RT76, "PBF"); // finesse rush vs RT pass-block
const dJuke = rate(A.RB28, "ELU") - rate(H.OLB56, "TAK"); // RB elusiveness vs LB tackle
const dSep = rate(H.WR80, "RRM") - rate(A.CB22, "MCV"); // WR route vs weak CB2 man cover
const dRun = rate(H.LG66, "RBK") - rate(A.DT93, "BSH"); // interior run block vs DT shed
ok(dEdge >= 20 && dEdge <= 24, "roster: EDGE finesse vs RT", `+${dEdge} (want ~+22, blow-by)`);
ok(dJuke >= 6 && dJuke <= 10, "roster: RB juke vs LB", `+${dJuke} (want ~+8, broken tackles)`);
ok(dSep >= 14 && dSep <= 18, "roster: WR vs CB2", `+${dSep} (want ~+16, open mediums)`);
ok(dRun >= 10 && dRun <= 14, "roster: interior run block vs DT", `+${dRun} (want ~+12, drive/pancake)`);

console.log(`\n${failures === 0 ? "ALL BANDS PASS" : failures + " BAND(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
