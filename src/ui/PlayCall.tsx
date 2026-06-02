import { useEffect, useState } from "react";
import { DEFENSE_BASE, OFFENSE_BASE } from "../game/plays";
import type {
  DefenseFormation,
  DefensePlay,
  OffenseFormation,
  OffensePlay,
} from "../game/types";

type AnyFormation = OffenseFormation | DefenseFormation;
type AnyPlay = OffensePlay | DefensePlay;

const PLAYS_PER_PAGE = 4;

export function PlayCall({
  formations,
  onOffense,
  onPick,
}: {
  formations: AnyFormation[];
  onOffense: boolean;
  onPick: (formationId: string, playId: string) => void;
}) {
  const [formationId, setFormationId] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const formation = formations.find((f) => f.id === formationId) ?? null;
  const plays = formation ? (formation.plays as AnyPlay[]) : [];
  const pageCount = Math.max(1, Math.ceil(plays.length / PLAYS_PER_PAGE));
  const pagePlays = plays.slice(page * PLAYS_PER_PAGE, page * PLAYS_PER_PAGE + PLAYS_PER_PAGE);

  const back = () => {
    setFormationId(null);
    setPage(0);
  };

  // keyboard: 1..n selects, Backspace/Esc goes back, [ ] page
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Backspace") {
        if (formation) back();
        return;
      }
      if (!formation) {
        const i = parseInt(e.key, 10);
        if (i >= 1 && i <= formations.length) setFormationId(formations[i - 1].id);
      } else {
        if (e.key === "[" && page > 0) setPage(page - 1);
        if (e.key === "]" && page < pageCount - 1) setPage(page + 1);
        const i = parseInt(e.key, 10);
        if (i >= 1 && i <= pagePlays.length) onPick(formation.id, pagePlays[i - 1].id);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [formation, formations, page, pageCount, pagePlays, onPick]);

  if (!formation) {
    return (
      <div className="overlay playcall">
        <div className="pc-title">
          {onOffense ? "CHOOSE FORMATION" : "CHOOSE DEFENSE"}
        </div>
        <div className="pc-grid">
          {formations.map((f, i) => (
            <button
              key={f.id}
              className="pc-card form"
              onClick={() => {
                setFormationId(f.id);
                setPage(0);
              }}
            >
              <span className="pc-key">{i + 1}</span>
              <FormationArt formation={f} offense={onOffense} />
              <span className="pc-name">{f.name}</span>
              <span className="pc-kind">{f.tag}</span>
            </button>
          ))}
        </div>
        <div className="pc-hint">Tap a formation · then pick a play</div>
      </div>
    );
  }

  return (
    <div className="overlay playcall">
      <div className="pc-head">
        <button className="pc-back" onClick={back}>
          ‹ FORMATIONS
        </button>
        <div className="pc-title sm">{formation.name}</div>
        <div className="pc-spacer" />
      </div>
      <div className="pc-grid">
        {pagePlays.map((p, i) => (
          <button
            key={p.id}
            className="pc-card"
            onClick={() => onPick(formation.id, p.id)}
          >
            <span className="pc-key">{i + 1}</span>
            <PlayArt play={p} offense={onOffense} />
            <span className="pc-name">{p.name}</span>
            <span className="pc-kind">{kindLabel(p, onOffense)}</span>
          </button>
        ))}
      </div>
      {pageCount > 1 ? (
        <div className="pc-pager">
          <button disabled={page === 0} onClick={() => setPage(page - 1)}>
            ‹
          </button>
          <span>
            PAGE {page + 1} / {pageCount}
          </span>
          <button
            disabled={page === pageCount - 1}
            onClick={() => setPage(page + 1)}
          >
            ›
          </button>
        </div>
      ) : (
        <div className="pc-hint">Tap a play to run it</div>
      )}
    </div>
  );
}

function kindLabel(p: AnyPlay, offense: boolean) {
  if (offense) {
    const k = (p as OffensePlay).kind;
    return k === "run" ? "RUN" : k === "pass" ? "PASS" : k.toUpperCase();
  }
  const d = p as DefensePlay;
  if (d.blitz >= 0.7) return "BLITZ";
  return d.coverage === "man" ? "MAN" : "ZONE";
}

function FormationArt({
  formation,
  offense,
}: {
  formation: AnyFormation;
  offense: boolean;
}) {
  const W = 120;
  const H = 80;
  const pad = 13;
  const base = offense ? OFFENSE_BASE : DEFENSE_BASE;
  const align = formation.align ?? {};

  // effective position per player: x = lateral, y = up means downfield
  const pts = Object.keys(base).map((slot) => {
    const ov = align[slot];
    return {
      slot,
      px: ov?.lat ?? base[slot].lat,
      py: -(ov?.fwd ?? base[slot].fwd),
    };
  });

  // auto-fit the whole formation into the box (independent x/y scale)
  const xs = pts.map((p) => p.px);
  const ys = pts.map((p) => p.py);
  const minX = Math.min(...xs) - 1.5;
  const maxX = Math.max(...xs) + 1.5;
  const minY = Math.min(...ys) - 1.5;
  const maxY = Math.max(...ys) + 1.5;
  const sx = (W - 2 * pad) / Math.max(0.1, maxX - minX);
  const sy = (H - 2 * pad) / Math.max(0.1, maxY - minY);
  const color = offense ? "#8fb8ff" : "#ff7a7a";
  const ballSlot = offense ? "QB" : "MLB";

  return (
    <svg className="pc-art" viewBox={`0 0 ${W} ${H}`}>
      {pts.map((p) => {
        const X = pad + (p.px - minX) * sx;
        const Y = pad + (p.py - minY) * sy;
        const ball = p.slot === ballSlot;
        return (
          <circle
            key={p.slot}
            cx={X}
            cy={Y}
            r={ball ? 3.4 : 2.9}
            fill={ball ? "#fff" : color}
            stroke={ball ? color : "none"}
            strokeWidth={ball ? 1.4 : 0}
          />
        );
      })}
    </svg>
  );
}

function PlayArt({ play, offense }: { play: AnyPlay; offense: boolean }) {
  const W = 120;
  const H = 80;
  const cx = W / 2;
  const los = H * 0.62;
  if (offense) {
    const op = play as OffensePlay;
    if (op.kind === "fg" || op.kind === "punt") {
      return (
        <svg className="pc-art" viewBox={`0 0 ${W} ${H}`}>
          <line x1="6" y1={los} x2={W - 6} y2={los} stroke="#7fd49a" strokeWidth="1" />
          <path
            d={`M ${cx} ${los + 8} Q ${cx + 20} ${los - 40} ${W - 16} 14`}
            fill="none"
            stroke="#ffd34d"
            strokeWidth="1.8"
            strokeDasharray="3 3"
          />
          {op.kind === "fg" && (
            <g stroke="#fff" strokeWidth="2">
              <line x1={W - 22} y1="6" x2={W - 22} y2="26" />
              <line x1={W - 12} y1="6" x2={W - 12} y2="26" />
              <line x1={W - 27} y1="16" x2={W - 7} y2="16" />
            </g>
          )}
          <ellipse cx={cx} cy={los + 9} rx="3.5" ry="2.4" fill="#7a4012" />
        </svg>
      );
    }
    return (
      <svg className="pc-art" viewBox={`0 0 ${W} ${H}`}>
        <line x1="6" y1={los} x2={W - 6} y2={los} stroke="#7fd49a" strokeWidth="1" />
        {Object.entries(op.routes).map(([slot, nodes]) => {
          if (!nodes.length) return null;
          const start = slotStart(slot, W, los);
          let d = `M ${start.x} ${start.y}`;
          let px = start.x;
          let py = start.y;
          for (const n of nodes) {
            px = start.x + n.lat * 3.0;
            py = start.y - n.fwd * 1.9;
            d += ` L ${px} ${py}`;
          }
          const color = op.kind === "run" && slot === "R" ? "#ffd34d" : "#8fb8ff";
          return (
            <g key={slot}>
              <path d={d} fill="none" stroke={color} strokeWidth="1.6" />
              <circle cx={start.x} cy={start.y} r="2.2" fill="#fff" />
              <circle cx={px} cy={py} r="1.6" fill={color} />
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
            <line x1={cx + dx} y1={los - 8} x2={cx + dx} y2={los + 10} stroke="#ffd34d" strokeWidth="1.4" />
          )}
        </g>
      ))}
      {[-22, 22].map((dx, i) => (
        <circle key={i} cx={cx + dx} cy={los - 26} r="3" fill="#ff7a7a" />
      ))}
      {dp.coverage === "zone" && <circle cx={cx} cy={14} r="3" fill="#ff7a7a" />}
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
