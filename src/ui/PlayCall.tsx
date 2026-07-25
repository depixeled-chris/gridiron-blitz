import { useEffect, useState } from "react";
import { OFFENSE_BASE } from "../game/plays";
import type {
  DefenseFormation,
  DefensePlay,
  OffenseFormation,
  OffensePlay,
} from "../game/types";

type AnyFormation = OffenseFormation | DefenseFormation;
type AnyPlay = OffensePlay | DefensePlay;

export function PlayCall({
  formations,
  onOffense,
  onPick,
}: {
  formations: AnyFormation[];
  onOffense: boolean;
  onPick: (formationId: string, playId: string) => void;
}) {
  const [idx, setIdx] = useState(0);
  const i = Math.min(idx, formations.length - 1);
  const formation = formations[i];
  const plays = (formation?.plays ?? []) as AnyPlay[];

  // everything is on one screen: formations across the top, that formation's
  // plays in the grid below. Arrows/digits mirror it for keyboard.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") return setIdx(Math.max(0, i - 1));
      if (e.key === "ArrowRight") return setIdx(Math.min(formations.length - 1, i + 1));
      const n = parseInt(e.key, 10);
      if (formation && n >= 1 && n <= plays.length) onPick(formation.id, plays[n - 1].id);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  return (
    <div className="overlay playcall">
      {/* FORMATIONS: all of them, in a grid — tap to swap the play grid below.
          No second page, so you never lose sight of what you're choosing. */}
      <div className="pc-forms">
        {formations.map((f, n) => (
          <button
            key={f.id}
            className={`pc-form${n === i ? " on" : ""}`}
            onClick={() => setIdx(n)}
          >
            <span className="pf-name">{f.name}</span>
            <span className="pf-tag">{f.tag}</span>
          </button>
        ))}
      </div>

      {/* PLAYS: a real grid that fills the width and wraps down the screen */}
      <div className="pc-plays">
        {plays.map((p, n) => (
          <button
            key={p.id}
            className="pc-card"
            onClick={() => formation && onPick(formation.id, p.id)}
          >
            <span className="pc-key">{n + 1}</span>
            <PlayArt play={p} formation={formation} offense={onOffense} />
            <span className="pc-name">{p.name}</span>
            <span className="pc-kind">{kindLabel(p, onOffense)}</span>
          </button>
        ))}
      </div>

      <div className="pc-hint">
        {onOffense ? "Tap a play to run it" : "Tap a call to run it"}
      </div>
    </div>
  );
}

const W = 120;
const H = 80;
const PAD = 12;

function kindLabel(p: AnyPlay, offense: boolean) {
  if (offense) {
    const k = (p as OffensePlay).kind;
    return k === "run" ? "RUN" : k === "pass" ? "PASS" : k.toUpperCase();
  }
  const d = p as DefensePlay;
  const cov =
    d.coverage === "man" ? "MAN" : d.coverage.replace("cover", "CVR ").toUpperCase();
  return d.blitzers >= 2 ? `${cov} • BLITZ` : cov;
}

type Pt = { lat: number; fwd: number };

/** map (lat, fwd) points into the card, downfield toward the top */
function fitter(pts: Pt[]) {
  const lats = pts.map((p) => p.lat);
  const fwds = pts.map((p) => p.fwd);
  const minLat = Math.min(...lats) - 1.5;
  const maxLat = Math.max(...lats) + 1.5;
  const minFwd = Math.min(...fwds) - 1.5;
  const maxFwd = Math.max(...fwds) + 1.5;
  const sx = (W - 2 * PAD) / Math.max(0.1, maxLat - minLat);
  const sy = (H - 2 * PAD) / Math.max(0.1, maxFwd - minFwd);
  return (lat: number, fwd: number) => ({
    x: PAD + (lat - minLat) * sx,
    y: PAD + (maxFwd - fwd) * sy,
  });
}

function offEff(formation: AnyFormation) {
  const align = (formation as OffenseFormation).align ?? {};
  const out: Record<string, Pt> = {};
  for (const slot of Object.keys(OFFENSE_BASE)) {
    const ov = align[slot] ?? {};
    out[slot] = { lat: ov.lat ?? OFFENSE_BASE[slot].lat, fwd: ov.fwd ?? OFFENSE_BASE[slot].fwd };
  }
  return out;
}

function PlayArt({ play, formation, offense }: { play: AnyPlay; formation: AnyFormation; offense: boolean }) {
  if (offense) {
    const op = play as OffensePlay;
    const pos = offEff(formation);
    const pts: Pt[] = Object.values(pos).map((p) => ({ ...p }));
    const routes: { slot: string; pts: Pt[]; run: boolean }[] = [];
    if (op.kind === "pass" || op.kind === "run") {
      for (const slot of ["A", "B", "C", "R"]) {
        const nodes = op.routes[slot];
        if (!nodes?.length) continue;
        const s = pos[slot];
        const wp = nodes.map((n) => ({ lat: s.lat + n.lat, fwd: s.fwd + n.fwd }));
        wp.forEach((w) => pts.push(w));
        routes.push({ slot, pts: [{ lat: s.lat, fwd: s.fwd }, ...wp], run: op.kind === "run" && slot === "R" });
      }
    }
    if (op.kind === "fg" || op.kind === "punt" || op.kind === "pat") pts.push({ lat: 0, fwd: 18 });
    const map = fitter(pts);
    return (
      <svg className="pc-art" viewBox={`0 0 ${W} ${H}`}>
        {Object.entries(pos).map(([slot, p]) => {
          const m = map(p.lat, p.fwd);
          const skill = ["QB", "R", "A", "B", "C"].includes(slot);
          return <circle key={slot} cx={m.x} cy={m.y} r={slot === "QB" ? 2.8 : 2.2}
            fill={slot === "QB" ? "#fff" : skill ? "#9fb6e0" : "#5e6f93"} />;
        })}
        {routes.map((r) => {
          const d = r.pts.map((p, i) => { const m = map(p.lat, p.fwd); return `${i ? "L" : "M"} ${m.x.toFixed(1)} ${m.y.toFixed(1)}`; }).join(" ");
          const e = map(r.pts[r.pts.length - 1].lat, r.pts[r.pts.length - 1].fwd);
          const color = r.run ? "#ffd34d" : "#8fb8ff";
          return (<g key={r.slot}><path d={d} fill="none" stroke={color} strokeWidth="1.7" strokeLinejoin="round" /><circle cx={e.x} cy={e.y} r="1.7" fill={color} /></g>);
        })}
        {(op.kind === "fg" || op.kind === "punt" || op.kind === "pat") && (() => {
          const s = map(pos.QB.lat, pos.QB.fwd); const e = map(0, 18);
          return (<g><path d={`M ${s.x} ${s.y} Q ${(s.x + e.x) / 2} ${e.y - 18} ${e.x} ${e.y}`} fill="none" stroke="#ffd34d" strokeWidth="1.8" strokeDasharray="3 3" />
            {(op.kind === "fg" || op.kind === "pat") && (<g stroke="#fff" strokeWidth="1.8"><line x1={e.x - 6} y1={e.y - 10} x2={e.x - 6} y2={e.y + 4} /><line x1={e.x + 6} y1={e.y - 10} x2={e.x + 6} y2={e.y + 4} /><line x1={e.x - 9} y1={e.y - 2} x2={e.x + 9} y2={e.y - 2} /></g>)}</g>);
        })()}
      </svg>
    );
  }

  // defense: front + rush arrows + coverage (zones shaded, or man indicators)
  const front = (formation as DefenseFormation).front;
  const dp = play as DefensePlay;
  const dl = front.filter((f) => f.role === "DL");
  const lbs = front.filter((f) => f.role === "LB").sort((a, b) => Math.abs(a.lat) - Math.abs(b.lat));
  // a named blitz package sends SPECIFIC men — draw those, not "the N nearest
  // the middle" (that showed the wrong arrows for every per-front pressure)
  const rush = new Set(
    dp.blitzSlots?.length
      ? [...dl.map((f) => f.slot), ...dp.blitzSlots]
      : [...dl, ...lbs.slice(0, dp.blitzers)].map((f) => f.slot)
  );

  type Zone = { lat: number; fwd: number; deep: boolean };
  const zones: Zone[] = [];
  // man-under shells show ONLY their deep zones (the underneath is man, so
  // drawing underneath bubbles there would be a lie); cover 0 shows none
  const DEEP_N: Record<string, number> = {
    cover2: 2, cover3: 3, cover4: 4, cover1: 1, cover2man: 2, cover3man: 3,
  };
  const manUnder = dp.coverage === "cover1" || dp.coverage === "cover2man" || dp.coverage === "cover3man";
  const nDeep = DEEP_N[dp.coverage] ?? 0;
  if (nDeep > 0) {
    const deepFwd = dp.coverage === "cover4" ? 14 : dp.coverage === "cover3man" ? 20 : dp.coverage === "cover1" ? 18 : 16;
    for (let i = 0; i < nDeep; i++)
      zones.push({ lat: (nDeep === 1 ? 0 : i / (nDeep - 1) - 0.5) * 18, fwd: deepFwd, deep: true });
    if (!manUnder) {
      const nUnder = Math.max(0, 11 - rush.size - nDeep);
      for (let i = 0; i < nUnder; i++) zones.push({ lat: (nUnder === 1 ? 0 : i / (nUnder - 1) - 0.5) * 20, fwd: 6.5, deep: false });
    }
  }
  const map = fitter([...front, ...zones]);
  return (
    <svg className="pc-art" viewBox={`0 0 ${W} ${H}`}>
      {zones.map((z, i) => {
        const m = map(z.lat, z.fwd);
        return <ellipse key={i} cx={m.x} cy={m.y} rx={z.deep ? 15 : 13} ry={z.deep ? 11 : 9}
          fill={z.deep ? "#3a86ff" : "#7fd49a"} opacity="0.16" stroke={z.deep ? "#3a86ff" : "#7fd49a"} strokeOpacity="0.4" strokeWidth="0.6" />;
      })}
      {front.map((f) => {
        const m = map(f.lat, f.fwd);
        const isRush = rush.has(f.slot);
        const back = f.role === "CB" || f.role === "S";
        return (
          <g key={f.slot}>
            {isRush && <line x1={m.x} y1={m.y} x2={m.x} y2={m.y + 9} stroke="#ffd34d" strokeWidth="1.4" />}
            <circle cx={m.x} cy={m.y} r={f.slot === "MLB" ? 2.8 : 2.4} fill={back ? "#ff9d9d" : "#e23b3b"} />
          </g>
        );
      })}
    </svg>
  );
}
