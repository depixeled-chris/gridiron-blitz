import { useEffect } from "react";
import type { DefensePlay, OffensePlay } from "../game/types";

type AnyPlay = OffensePlay | DefensePlay;

export function PlayCall({
  plays,
  onOffense,
  onPick,
}: {
  plays: AnyPlay[];
  onOffense: boolean;
  onPick: (id: string) => void;
}) {
  // keyboard 1..n picks a play
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const i = parseInt(e.key, 10);
      if (!isNaN(i) && i >= 1 && i <= plays.length) onPick(plays[i - 1].id);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [plays, onPick]);

  return (
    <div className="overlay playcall">
      <div className="pc-title">
        {onOffense ? "PICK YOUR PLAY" : "PICK YOUR DEFENSE"}
      </div>
      <div className="pc-grid">
        {plays.map((p, i) => (
          <button key={p.id} className="pc-card" onClick={() => onPick(p.id)}>
            <span className="pc-key">{i + 1}</span>
            <PlayArt play={p} offense={onOffense} />
            <span className="pc-name">{p.name}</span>
            <span className="pc-kind">{kindLabel(p, onOffense)}</span>
          </button>
        ))}
      </div>
      <div className="pc-hint">Click a card or press its number</div>
    </div>
  );
}

function kindLabel(p: AnyPlay, offense: boolean) {
  if (offense) return (p as OffensePlay).kind === "run" ? "RUN" : "PASS";
  const d = p as DefensePlay;
  return d.blitz > 0.6 ? "BLITZ" : d.man > 0.6 ? "MAN" : "ZONE";
}

/** tiny diagram of routes / scheme */
function PlayArt({ play, offense }: { play: AnyPlay; offense: boolean }) {
  const W = 120;
  const H = 80;
  const cx = W / 2;
  const los = H * 0.62;
  if (offense) {
    const op = play as OffensePlay;
    return (
      <svg className="pc-art" viewBox={`0 0 ${W} ${H}`}>
        <line x1="6" y1={los} x2={W - 6} y2={los} stroke="#7fd49a" strokeWidth="1" />
        {Object.entries(op.routes).map(([slot, nodes], idx) => {
          const start = slotStart(slot, W, los);
          let d = `M ${start.x} ${start.y}`;
          let px = start.x;
          let py = start.y;
          for (const n of nodes) {
            px = start.x + n.lat * 3.2;
            py = start.y - n.fwd * 2.0;
            d += ` L ${px} ${py}`;
          }
          const color = op.kind === "run" && slot === "R" ? "#ffd34d" : "#8fb8ff";
          return (
            <g key={slot}>
              <path d={d} fill="none" stroke={color} strokeWidth="1.6" />
              <circle cx={start.x} cy={start.y} r="2.4" fill="#fff" />
              {idx >= 0 && <circle cx={px} cy={py} r="1.6" fill={color} />}
            </g>
          );
        })}
        <circle cx={cx} cy={los + 9} r="3" fill="#fff" stroke="#222" />
      </svg>
    );
  }
  const dp = play as DefensePlay;
  return (
    <svg className="pc-art" viewBox={`0 0 ${W} ${H}`}>
      <line x1="6" y1={los} x2={W - 6} y2={los} stroke="#e09a9a" strokeWidth="1" />
      {[-30, -10, 10, 30].map((dx, i) => (
        <g key={i}>
          <circle cx={cx + dx} cy={los - 8} r="3" fill="#e23b3b" />
          {dp.blitz > 0.5 && (
            <line
              x1={cx + dx}
              y1={los - 8}
              x2={cx + dx}
              y2={los + 10}
              stroke="#ffd34d"
              strokeWidth="1.4"
            />
          )}
        </g>
      ))}
      {[-22, 22].map((dx, i) => (
        <circle key={i} cx={cx + dx} cy={los - 26} r="3" fill="#ff7a7a" />
      ))}
      {dp.man < 0.4 && <circle cx={cx} cy={14} r="3" fill="#ff7a7a" />}
    </svg>
  );
}

function slotStart(slot: string, W: number, los: number) {
  const cx = W / 2;
  switch (slot) {
    case "A":
      return { x: 16, y: los };
    case "B":
      return { x: W - 16, y: los };
    case "C":
      return { x: cx + 16, y: los };
    case "R":
      return { x: cx + 8, y: los + 12 };
    default:
      return { x: cx, y: los };
  }
}
