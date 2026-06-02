import { useEffect, useRef, useState } from "react";
import { Game } from "./game/Game";
import type { HudState } from "./game/types";
import { Scoreboard } from "./ui/Scoreboard";
import { PlayCall } from "./ui/PlayCall";
import { Menu } from "./ui/Menu";
import { GameOver } from "./ui/GameOver";
import { Controls } from "./ui/Controls";

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
};

export function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [hud, setHud] = useState<HudState>(EMPTY);

  useEffect(() => {
    const game = new Game();
    gameRef.current = game;
    game.subscribe(setHud);
    let alive = true;
    game.mount(mountRef.current!).then(() => {
      if (!alive) game.destroy();
    });
    return () => {
      alive = false;
      game.destroy();
      gameRef.current = null;
    };
  }, []);

  const game = gameRef.current;

  return (
    <div className="app">
      <div className="stage">
        <Scoreboard hud={hud} />
        <div className="field-wrap">
          <div ref={mountRef} className="canvas-host" />
          {hud.phase === "menu" && (
            <Menu onStart={() => game?.startGame()} />
          )}
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
          {hud.message && hud.phase !== "menu" && hud.phase !== "gameover" && (
            <div className="toast">{hud.message}</div>
          )}
        </div>
        <Controls hud={hud} />
      </div>
    </div>
  );
}
