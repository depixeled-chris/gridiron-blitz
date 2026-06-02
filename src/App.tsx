import { useEffect, useRef, useState } from "react";
import { Game } from "./game/Game";
import type { HudState } from "./game/types";
import { Scoreboard } from "./ui/Scoreboard";
import { PlayCall } from "./ui/PlayCall";
import { Menu } from "./ui/Menu";
import { GameOver } from "./ui/GameOver";
import { Controls } from "./ui/Controls";
import { TouchControls } from "./ui/TouchControls";
import { InstallBanner } from "./ui/InstallBanner";

const EMPTY: HudState = {
  phase: "menu",
  quarter: 1,
  clock: 0,
  home: 0,
  away: 0,
  possession: "home",
  down: 1,
  toGo: 10,
  ballOn: "OWN 20",
  message: "",
  playClock: 25,
  userOnOffense: true,
  canHike: false,
  canThrow: false,
  canSwitch: false,
};

const IS_TOUCH =
  typeof window !== "undefined" &&
  (window.matchMedia?.("(pointer: coarse)").matches ||
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0);

export function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [hud, setHud] = useState<HudState>(EMPTY);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const game = new Game();
    gameRef.current = game;
    game.subscribe(setHud);
    let alive = true;
    game.mount(mountRef.current!).then(() => {
      if (!alive) game.destroy();
    });
    if (import.meta.env.DEV) {
      (window as unknown as { __game: Game }).__game = game;
    }
    return () => {
      alive = false;
      game.destroy();
      gameRef.current = null;
    };
  }, []);

  const game = gameRef.current;

  return (
    <div className="app">
      <div className="field-wrap">
        <div ref={mountRef} className="canvas-host" />

        <Scoreboard hud={hud} />
        {IS_TOUCH && game && <TouchControls hud={hud} game={game} />}
        <Controls hud={hud} touch={IS_TOUCH} />

        {hud.message && hud.phase !== "menu" && hud.phase !== "gameover" && (
          <div className="toast">{hud.message}</div>
        )}

        <button
          className="mute-btn"
          title={muted ? "Unmute" : "Mute"}
          onClick={() => {
            const m = !muted;
            setMuted(m);
            game?.setMuted(m);
          }}
        >
          {muted ? "🔇" : "🔊"}
        </button>

        {hud.phase === "menu" && <Menu onStart={() => game?.startGame()} />}
        {hud.phase === "playcall" && game && (
          <PlayCall
            plays={game.availablePlays()}
            onOffense={hud.userOnOffense}
            onPick={(id) => game.choosePlay(id)}
          />
        )}
        {hud.phase === "gameover" && (
          <GameOver hud={hud} onRestart={() => game?.startGame()} />
        )}
      </div>

      <div className="rotate-hint">
        <div className="rotate-icon">⤾</div>
        Rotate to landscape to play
      </div>

      <InstallBanner />
    </div>
  );
}
