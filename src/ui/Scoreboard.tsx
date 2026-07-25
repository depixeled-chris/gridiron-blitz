import type { HudState } from "../game/types";

function fmtClock(s: number) {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

export function Scoreboard({ hud }: { hud: HudState }) {
  const downText =
    hud.toGo <= 0 ? "GOAL" : `${ord(hud.down)} & ${hud.toGo}`;
  // pull the scoreboard up out of the way once the ball is snapped; it slides
  // back between plays (presnap / dead / playcall) so it doesn't cover the field
  const pulled = hud.phase === "live";
  return (
    <div className={`scoreboard ${pulled ? "pulled" : ""}`}>
      <div className={`team home ${hud.possession === "home" ? "has-ball" : ""}`}>
        <span className="abbr">YOU</span>
        <span className="pts">{hud.home}</span>
      </div>
      <div className="center">
        <div className="clock">{fmtClock(hud.clock)}</div>
        <div className="qtr">Q{Math.min(hud.quarter, 4)}</div>
        {/* WINDSOCK: which way it's blowing and how hard. A calm day barely
            moves a kick; high teens is worth several yards of range. */}
        <div className="wind" title={`Wind ${hud.wind.mph} mph`}>
          <span
            className={`sock${hud.wind.mph < 5 ? " calm" : ""}`}
            style={{ transform: `scaleX(${hud.wind.dir >= 0 ? 1 : -1})` }}
          >
            <span
              className="sock-body"
              style={{ ["--gust" as string]: Math.min(1, hud.wind.mph / 20) }}
            />
          </span>
          <span className="wind-mph">{hud.wind.mph}</span>
        </div>
        {hud.phase !== "menu" && hud.phase !== "gameover" && (
          <div className="downbar">
            <span>{downText}</span>
            <span className="sep">•</span>
            <span>{hud.ballOn}</span>
          </div>
        )}
      </div>
      <div className={`team away ${hud.possession === "away" ? "has-ball" : ""}`}>
        <span className="pts">{hud.away}</span>
        <span className="abbr">CPU</span>
      </div>
    </div>
  );
}

function ord(n: number) {
  return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
}
