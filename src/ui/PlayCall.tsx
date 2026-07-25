import { useEffect, useRef, useState } from "react";
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
  const trackRef = useRef<HTMLDivElement | null>(null);
  const i = Math.min(idx, formations.length - 1);
  const formation = formations[i];

  // scroll-snap does the swiping natively (momentum, rubber-banding, snap);
  // we only read back WHICH formation is centred so the header + dots match.
  const onScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    const w = el.clientWidth || 1;
    const n = Math.round(el.scrollLeft / w);
    if (n !== idx) setIdx(Math.max(0, Math.min(formations.length - 1, n)));
  };
  const goTo = (n: number) => {
    const el = trackRef.current;
    const c = Math.max(0, Math.min(formations.length - 1, n));
    setIdx(c);
    el?.scrollTo({ left: c * (el.clientWidth || 0), behavior: "smooth" });
  };

  // keyboard mirrors the swipe: arrows change formation, digits call a play
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") return goTo(i - 1);
      if (e.key === "ArrowRight") return goTo(i + 1);
      const n = parseInt(e.key, 10);
      const plays = formation?.plays as AnyPlay[] | undefined;
      if (plays && n >= 1 && n <= plays.length) onPick(formation.id, plays[n - 1].id);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  return (
    <div className="overlay playcall">
      <div className="pc-head">
        <button className="pc-arrow" disabled={i === 0} onClick={() => goTo(i - 1)}>
          ‹
        </button>
        <div className="pc-title sm">
          {formation?.name}
          <span className="pc-tag">{formation?.tag}</span>
        </div>
        <button
          className="pc-arrow"
          disabled={i >= formations.length - 1}
          onClick={() => goTo(i + 1)}
        >
          ›
        </button>
      </div>

      {/* one page per formation — every play on it is visible, no drilling in */}
      <div className="pc-swipe" ref={trackRef} onScroll={onScroll}>
        {formations.map((f) => (
          <div className="pc-page" key={f.id}>
            <div className="pc-plays">
              {(f.plays as AnyPlay[]).map((p, n) => (
                <button
                  key={p.id}
                  className="pc-card"
                  onClick={() => onPick(f.id, p.id)}
                >
                  <span className="pc-key">{n + 1}</span>
                  <PlayArt play={p} formation={f} offense={onOffense} />
                  <span className="pc-name">{p.name}</span>
                  <span className="pc-kind">{kindLabel(p, onOffense)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="pc-dots">
        {formations.map((f, n) => (
          <button
            key={f.id}
            className={`pc-dot${n === i ? " on" : ""}`}
            onClick={() => goTo(n)}
            aria-label={f.name}
          />
        ))}
      </div>
      <div className="pc-hint">Swipe for another formation · tap a play to run it</div>
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
