import type { HudState } from "../game/types";

export function Controls({
  hud,
  touch = false,
}: {
  hud: HudState;
  touch?: boolean;
}) {
  if (hud.phase === "menu" || hud.phase === "gameover") {
    return <div className="controls" />;
  }
  const off = hud.userOnOffense;
  if (touch) {
    return (
      <div className="controls">
        <span className="role-tag">{off ? "OFFENSE" : "DEFENSE"}</span>
        <span className="hint">
          {off
            ? "Joystick to move · TURBO to sprint · tap a receiver to throw"
            : "Joystick to move · SWITCH defenders · run into the carrier to tackle"}
        </span>
      </div>
    );
  }
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
