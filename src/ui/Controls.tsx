import type { HudState } from "../game/types";

export function Controls({
  hud,
  touch = false,
}: {
  hud: HudState;
  touch?: boolean;
}) {
  // on touch the on-screen buttons replace the keyboard hint bar
  if (touch) return null;
  if (hud.phase === "menu" || hud.phase === "gameover") return null;
  const off = hud.userOnOffense;
  return (
    <div className="controls">
      <span className="role-tag">{off ? "OFFENSE" : "DEFENSE"}</span>
      {off ? (
        <span className="hint">
          <b>Arrows</b> move · <b>Shift</b> turbo · <b>1-4</b> throw ·{" "}
          <b>J</b> throw open · <b>Space</b> hike
        </span>
      ) : (
        <span className="hint">
          <b>Arrows</b> move · <b>Shift</b> turbo · <b>Space</b> switch defender ·
          run into the ball carrier to tackle
        </span>
      )}
    </div>
  );
}
