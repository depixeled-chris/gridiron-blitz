import type { HudState } from "../game/types";

export function GameOver({
  hud,
  onRestart,
}: {
  hud: HudState;
  onRestart: () => void;
}) {
  const win = hud.home > hud.away;
  const tie = hud.home === hud.away;
  return (
    <div className="overlay menu">
      <h1 className="logo">{tie ? "TIE GAME" : win ? "YOU WIN!" : "CPU WINS"}</h1>
      <p className="final-score">
        YOU {hud.home} — {hud.away} CPU
      </p>
      <button className="big-btn" onClick={onRestart}>
        PLAY AGAIN
      </button>
    </div>
  );
}
