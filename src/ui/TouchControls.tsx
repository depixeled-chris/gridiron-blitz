import { useRef, useState } from "react";
import type { Game } from "../game/Game";
import type { HudState } from "../game/types";

/** On-screen controls for touch devices: left joystick + right action cluster. */
export function TouchControls({
  hud,
  game,
}: {
  hud: HudState;
  game: Game;
}) {
  const live = hud.phase === "presnap" || hud.phase === "live" || hud.phase === "dead";
  if (!live) return null;

  return (
    <div className="touch-layer">
      <Joystick onMove={(x, y) => game.stick(x, y)} />

      <div className="touch-actions">
        {hud.canThrow && (
          <div className="throw-cluster">
            {[1, 2, 3, 4].map((n) => (
              <TapButton
                key={n}
                className="rcv"
                label={String(n)}
                onTap={() => game.tap(`Digit${n}`)}
              />
            ))}
            <TapButton className="open" label="OPEN" onTap={() => game.tap("KeyJ")} />
          </div>
        )}
        {hud.canHike && (
          <TapButton className="big" label="HIKE" onTap={() => game.tap("Space")} />
        )}
        {hud.canSwitch && (
          <TapButton className="big" label="SWITCH" onTap={() => game.tap("Space")} />
        )}
        <HoldButton
          className="turbo"
          label="TURBO"
          onHold={(on) => game.setTurbo(on)}
        />
      </div>
    </div>
  );
}

function Joystick({ onMove }: { onMove: (x: number, y: number) => void }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef(false);

  const update = (e: React.PointerEvent) => {
    const base = baseRef.current!;
    const r = base.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const max = r.width / 2;
    const d = Math.hypot(dx, dy);
    if (d > max) {
      dx = (dx / d) * max;
      dy = (dy / d) * max;
    }
    setKnob({ x: dx, y: dy });
    onMove(dx / max, dy / max);
  };

  return (
    <div
      ref={baseRef}
      className="joystick"
      onPointerDown={(e) => {
        active.current = true;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        update(e);
      }}
      onPointerMove={(e) => active.current && update(e)}
      onPointerUp={(e) => {
        active.current = false;
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        setKnob({ x: 0, y: 0 });
        onMove(0, 0);
      }}
      onPointerCancel={() => {
        active.current = false;
        setKnob({ x: 0, y: 0 });
        onMove(0, 0);
      }}
    >
      <div
        className="knob"
        style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
      />
    </div>
  );
}

function TapButton({
  label,
  onTap,
  className = "",
}: {
  label: string;
  onTap: () => void;
  className?: string;
}) {
  return (
    <button
      className={`tbtn ${className}`}
      onPointerDown={(e) => {
        e.preventDefault();
        onTap();
      }}
    >
      {label}
    </button>
  );
}

function HoldButton({
  label,
  onHold,
  className = "",
}: {
  label: string;
  onHold: (on: boolean) => void;
  className?: string;
}) {
  return (
    <button
      className={`tbtn ${className}`}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        onHold(true);
      }}
      onPointerUp={() => onHold(false)}
      onPointerCancel={() => onHold(false)}
      onPointerLeave={() => onHold(false)}
    >
      {label}
    </button>
  );
}
