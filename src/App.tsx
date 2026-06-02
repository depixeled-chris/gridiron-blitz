import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Game } from "./game/Game";
import type { HudState } from "./game/types";
import { Scoreboard } from "./ui/Scoreboard";
import { PlayCall } from "./ui/PlayCall";
import { Menu } from "./ui/Menu";
import { GameOver } from "./ui/GameOver";
import { Controls } from "./ui/Controls";
import { TouchControls } from "./ui/TouchControls";

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
  const stageRef = useRef<HTMLDivElement>(null);
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

  // scale the fixed-size stage to fit the viewport (mobile + small windows)
  useFitScale(stageRef, [hud.phase]);

  const game = gameRef.current;

  return (
    <div className="app">
      <div className="stage" ref={stageRef}>
        <Scoreboard hud={hud} />
        <div className="field-wrap">
          <div ref={mountRef} className="canvas-host" />
          {IS_TOUCH && game && <TouchControls hud={hud} game={game} />}
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
          {hud.message && hud.phase !== "menu" && hud.phase !== "gameover" && (
            <div className="toast">{hud.message}</div>
          )}
        </div>
        <Controls hud={hud} touch={IS_TOUCH} />
      </div>
      <div className="rotate-hint">
        <div className="rotate-icon">⤾</div>
        Rotate your device to landscape
      </div>
    </div>
  );
}

/** keep the 960×N stage fully visible by transform-scaling it to the viewport */
function useFitScale(
  ref: React.RefObject<HTMLDivElement | null>,
  deps: unknown[]
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.transform = "scale(1)";
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const pad = 8;
      const scale = Math.min(
        (window.innerWidth - pad) / w,
        (window.innerHeight - pad) / h,
        1
      );
      el.style.transform = `scale(${scale})`;
    };
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
