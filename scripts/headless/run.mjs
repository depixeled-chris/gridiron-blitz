// Headless deterministic sim harness — steps the real engine at fixed dt in Node,
// ~1000x faster than the browser. Usage: node scripts/headless/build.mjs && node scripts/headless/run.mjs
import { Game } from "./.game-headless.mjs";

const DT = 1 / 60;
const g = new Game();
g.setHeadless(true);
g.startGame();
g.testAutoCarrier(true);

let SEED = 99;
const reseed = () => g.testReseed((SEED = (SEED * 1103515245 + 12345) & 0x7fffffff));

// run one play to resolution; returns { gain, msg, carrier }
function play({ off = null, def = null, defForm = null, defPlay = null, form, pid, throwAt = null, throwKey = null, los = 40, maxFrames = 320 }) {
  g.testTiers(off, def);
  g.testDefense(defForm, defPlay);
  g.testNewSeries(los);
  const before = g.testState();
  reseed();
  g.testChoose(form, pid);
  g.testSnap();
  let s = before;
  for (let k = 0; k < maxFrames; k++) {
    if (throwAt !== null && k === throwAt) { if (throwKey) g.testThrowTo(throwKey); else g.testThrowOpen(); }
    g.testStep(DT);
    s = g.testState();
    if (s.phase !== "live" && k > 2) break;
  }
  return { gain: Math.round((s.los - before.los) / 22), msg: s.msg, carrier: s.carrier, score: s.score.home - before.score.home };
}

const t0 = Date.now();
const runs = ["dive", "iso", "power", "counter", "sweep"];
const ys = [];
const N = 300;
for (let i = 0; i < N; i++) ys.push(play({ off: 75, def: 75, form: "iform", pid: runs[i % 5] }).gain);
const ms = Date.now() - t0;
const n = ys.length, pct = (f) => Math.round(ys.filter(f).length / n * 100);
const avg = Math.round(ys.reduce((a, b) => a + b, 0) / n * 10) / 10;
console.log(`headless ran ${n} plays in ${ms}ms (${(ms / n).toFixed(1)}ms/play, ${Math.round(n / (ms / 1000))} plays/sec)`);
console.log(`neutral 75v75 (random... forced? no — random def): avg=${avg} stuff ${pct((y) => y <= 0)}% succ ${pct((y) => y >= 4 && y <= 9)}% exp10+ ${pct((y) => y >= 10)}%`);
