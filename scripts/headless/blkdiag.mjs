import { Game } from "./.game-headless.mjs";
const DT = 1/60; const g = new Game(); g.setHeadless(true); g.startGame(); g.testAutoCarrier(true);
let SEED=1; const reseed=()=>g.testReseed((SEED=(SEED*1103515245+12345)&0x7fffffff));
// snapshot box blocked-status the frame the back crosses the LOS
const tally={}; let n=0;
for(let i=0;i<60;i++){
  g.testTiers(75,75); g.testDefense("fourthree","cover3"); g.testNewSeries(40);
  const los=g.testState().los; reseed(); g.testChoose("iform","dive"); g.testSnap();
  let snap=null;
  for(let k=0;k<120;k++){ g.testStep(DT); const b=g.debugBall(); const ps=g.debugPlayers(); const c=ps.find(p=>p.id===b.carrier);
    if(c && Math.abs(c.x-los)<0.3*22 && !snap){ // at the LOS
      snap=ps.filter(p=>p.team==="away"&&(p.defRole==="DL"||p.defRole==="LB")).map(p=>`${p.defRole}:${p.neutralized?"BLK":(p.blocked?"eng":"FREE")}`);
    }
    if(g.testState().phase!=="live"&&k>2)break;
  }
  if(snap){ n++; for(const s of snap) tally[s]=(tally[s]||0)+1; }
}
console.log(`n=${n} box-defender status when back hits LOS (per-play counts summed):`);
console.log(tally);
const dl=Object.entries(tally).filter(([k])=>k.startsWith("DL"));
console.log("DL:", dl.map(([k,v])=>`${k}=${(v/n).toFixed(1)}/play`).join("  "));
