import { pathToFileURL } from "url";
const { Game } = await import(pathToFileURL(process.argv[2]).href);
const DT=1/60, YARD=22;

function kickoff(koPlay, N=250){
  const carries=[], out={recovered:0, returned:0, other:0};
  for(let i=0;i<N;i++){
    const g=new Game(); g.setHeadless(true); g.startGame(); g.callToss("heads");
    let t=g.tossState(); if(t.userWon&&!t.choice) g.electToss("kick"); // user kicks
    g.startFromToss(); g.testAutoCarrier(true);
    if(g.testState().phase!=="playcall"){ out.other++; continue; }
    g.testChoose("kickoffunit", koPlay);
    const tee=g.debugBall().x;
    let msgs=[], prev="", s=null, atOutcome=null;
    for(let k=0;k<800;k++){
      g.testStep(DT); const b=g.debugBall(); s=g.testState();
      if(b.msg!==prev&&b.msg){
        if(atOutcome===null && /RETURN!|ONSIDE RECOVERED|RETURN TEAM BALL|TOUCHBACK/.test(b.msg)) atOutcome=b.x;
        msgs.push(b.msg); prev=b.msg;
      }
      if(s.phase!=="live"&&k>5)break;
    }
    const j=msgs.join(">");
    if(/ONSIDE RECOVERED/.test(j)) out.recovered++;
    else if(/RETURN!|RETURN TEAM BALL|TOUCHBACK/.test(j)) out.returned++;
    else out.other++;
    if(atOutcome!==null) carries.push(Math.abs(atOutcome-tee)/YARD);
  }
  return {out, carries};
}
for(const [label,id] of [["DEEP","kickoff"],["ANGLE L","koLeft"],["ANGLE R","koRight"],["SQUIB","koSquib"],["ONSIDE","koOnside"]]){
  const {out,carries}=kickoff(id);
  carries.sort((a,b)=>a-b);
  const med=carries[Math.floor(carries.length/2)]??0;
  console.log(`${label.padEnd(8)} median ball travel ${med.toFixed(0).padStart(2)}yd   ${JSON.stringify(out)}`);
}
