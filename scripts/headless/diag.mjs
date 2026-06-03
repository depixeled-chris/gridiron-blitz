// Headless stuff diagnostic: on each run, who makes the tackle (role) and how
// much penetration / how many front defenders are free at contact.
import { Game } from "./.game-headless.mjs";
const DT = 1 / 60;
const g = new Game(); g.setHeadless(true); g.startGame(); g.testAutoCarrier(true);
let SEED = 1; const reseed = () => g.testReseed((SEED = (SEED * 1103515245 + 12345) & 0x7fffffff));
const defForm = process.argv[2] || "fourthree";
const defPlay = process.argv[3] || "cover3";

const roleTally = {}; const stuffRole = {};
let dlPenSum = 0, freeBoxSum = 0, n = 0, stuffs = 0;
const runs = ["dive", "iso", "power", "counter", "sweep"];
for (let i = 0; i < 200; i++) {
  g.testTiers(75, 75); g.testDefense(defForm, defPlay); g.testNewSeries(40);
  const los = g.testState().los; reseed();
  g.testChoose("iform", runs[i % 5]); g.testSnap();
  let last = null;
  for (let k = 0; k < 200; k++) {
    g.testStep(DT);
    const s = g.testState();
    const ps = g.debugPlayers(); const b = g.debugBall(); const c = ps.find((p) => p.id === b.carrier);
    if (c) {
      let tk = null, td = 1e9;
      for (const p of ps) { if (p.team !== "away" || p.neutralized || p.stun > 0) continue; const d = Math.hypot(p.x - c.x, p.y - c.y); if (d < td) { td = d; tk = p; } }
      let dlPen = 0, freeBox = 0;
      for (const p of ps) { if (p.team !== "away") continue; if (p.role === "DL" && p.x > los) dlPen++; if ((p.defRole === "DL" || p.defRole === "LB") && !p.neutralized) freeBox++; }
      last = { tk, dlPen, freeBox, cx: c.x };
    }
    if (s.phase !== "live" && k > 2) break;
  }
  const s = g.testState(); const yd = Math.round((s.los - los) / 22);
  if (last && last.tk) {
    const role = roleOf(last.tk);
    roleTally[role] = (roleTally[role] || 0) + 1;
    dlPenSum += last.dlPen; freeBoxSum += last.freeBox; n++;
    if (yd <= 0) { stuffs++; stuffRole[role] = (stuffRole[role] || 0) + 1; }
  }
}
function roleOf(p) { return p.defRole || "?"; }
console.log(`def=${defForm}/${defPlay}  n=${n}  stuffs=${stuffs} (${Math.round(stuffs / n * 100)}%)`);
console.log(`  avg DL past LOS @contact: ${(dlPenSum / n).toFixed(1)}   avg free box defenders: ${(freeBoxSum / n).toFixed(1)}`);
console.log(`  ALL tacklers by role:`, roleTally);
console.log(`  STUFF tacklers by role:`, stuffRole);
