import { useEffect } from "react";

export function Menu({ onStart }: { onStart: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.code === "Enter" || e.code === "Space") onStart();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onStart]);

  return (
    <div className="overlay menu">
      <h1 className="logo">
        GRIDIRON<span>BLITZ</span>
      </h1>
      <p className="tag">A TECMO-STYLE ARCADE FOOTBALL JAM</p>
      <button className="big-btn" onClick={onStart}>
        PRESS START
      </button>
      <ul className="menu-keys">
        <li><b>Arrows / WASD</b> — move</li>
        <li><b>Shift</b> — turbo</li>
        <li><b>1–4</b> — throw to receiver · <b>J</b> — throw to open</li>
        <li><b>Space</b> — hike (offense) / switch defender</li>
      </ul>
    </div>
  );
}
