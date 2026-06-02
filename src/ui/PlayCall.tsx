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
            <PlayArt play={p} formation={formation} offense={onOffense} />
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

const W = 120;
const H = 80;
const PAD = 12;

/** build a coordinate mapper that fits all (lat, fwd) points into the card */
function fitter(pts: { lat: number; fwd: number }[]) {
  const lats = pts.map((p) => p.lat);
  const fwds = pts.map((p) => p.fwd);
  const minLat = Math.min(...lats) - 1.5;
  const maxLat = Math.max(...lats) + 1.5;
  const minFwd = Math.min(...fwds) - 1.5;
  const maxFwd = Math.max(...fwds) + 1.5;
  const sx = (W - 2 * PAD) / Math.max(0.1, maxLat - minLat);
  const sy = (H - 2 * PAD) / Math.max(0.1, maxFwd - minFwd);
  // downfield (larger fwd) maps toward the TOP of the card
  return (lat: number, fwd: number) => ({
    x: PAD + (lat - minLat) * sx,
    y: PAD + (maxFwd - fwd) * sy,
  });
}

function effPos(
  base: Record<string, { fwd: number; lat: number }>,
  align: Record<string, { fwd?: number; lat?: number }>
) {
  const out: Record<string, { fwd: number; lat: number }> = {};
  for (const slot of Object.keys(base)) {
    const ov = align[slot] ?? {};
    out[slot] = { fwd: ov.fwd ?? base[slot].fwd, lat: ov.lat ?? base[slot].lat };
  }
  return out;
}

function PlayArt({
  play,
  formation,
  offense,
}: {
  play: AnyPlay;
  formation: AnyFormation;
  offense: boolean;
}) {
  const align = formation.align ?? {};

  if (offense) {
    const op = play as OffensePlay;
    const pos = effPos(OFFENSE_BASE, align);

    // every point we need to fit: all players + route waypoints
    const pts = Object.values(pos).map((p) => ({ ...p }));
    const routes: { slot: string; pts: { lat: number; fwd: number }[]; run: boolean }[] = [];
    if (op.kind === "pass" || op.kind === "run") {
      for (const slot of ["A", "B", "C", "R"]) {
        const nodes = op.routes[slot];
        if (!nodes?.length) continue;
        const s = pos[slot];
        const wp = nodes.map((n) => ({ lat: s.lat + n.lat, fwd: s.fwd + n.fwd }));
        wp.forEach((w) => pts.push(w));
        routes.push({
          slot,
          pts: [{ lat: s.lat, fwd: s.fwd }, ...wp],
          run: op.kind === "run" && slot === "R",
        });
      }
    }
    // kicks: show the ball flying downfield from the holder
    if (op.kind === "fg" || op.kind === "punt") {
      pts.push({ lat: 0, fwd: 18 });
    }

    const map = fitter(pts);
    return (
      <svg className="pc-art" viewBox={`0 0 ${W} ${H}`}>
        {/* players for context */}
        {Object.entries(pos).map(([slot, p]) => {
          const m = map(p.lat, p.fwd);
          const skill = slot === "QB" || slot === "R" || slot === "A" || slot === "B" || slot === "C";
          return (
            <circle
              key={slot}
              cx={m.x}
              cy={m.y}
              r={slot === "QB" ? 2.8 : 2.2}
              fill={slot === "QB" ? "#fff" : skill ? "#9fb6e0" : "#5e6f93"}
            />
          );
        })}
        {/* routes */}
        {routes.map((r) => {
          const d = r.pts
            .map((p, i) => {
              const m = map(p.lat, p.fwd);
              return `${i ? "L" : "M"} ${m.x.toFixed(1)} ${m.y.toFixed(1)}`;
            })
            .join(" ");
          const end = map(r.pts[r.pts.length - 1].lat, r.pts[r.pts.length - 1].fwd);
          const color = r.run ? "#ffd34d" : "#8fb8ff";
          return (
            <g key={r.slot}>
              <path d={d} fill="none" stroke={color} strokeWidth="1.7" strokeLinejoin="round" />
              <circle cx={end.x} cy={end.y} r="1.7" fill={color} />
            </g>
          );
        })}
        {/* kick arc + uprights */}
        {(op.kind === "fg" || op.kind === "punt") &&
          (() => {
            const s = map(pos.QB.lat, pos.QB.fwd);
            const e = map(0, 18);
            const cxp = (s.x + e.x) / 2;
            return (
              <g>
                <path
                  d={`M ${s.x} ${s.y} Q ${cxp} ${e.y - 18} ${e.x} ${e.y}`}
                  fill="none"
                  stroke="#ffd34d"
                  strokeWidth="1.8"
                  strokeDasharray="3 3"
                />
                {op.kind === "fg" && (
                  <g stroke="#fff" strokeWidth="1.8">
                    <line x1={e.x - 6} y1={e.y - 10} x2={e.x - 6} y2={e.y + 4} />
                    <line x1={e.x + 6} y1={e.y - 10} x2={e.x + 6} y2={e.y + 4} />
                    <line x1={e.x - 9} y1={e.y - 2} x2={e.x + 9} y2={e.y - 2} />
                  </g>
                )}
              </g>
            );
          })()}
      </svg>
    );
  }

  // defense: front from the formation + coverage / blitz indicators
  const dp = play as DefensePlay;
  const pos = effPos(DEFENSE_BASE, align);
  const pts = Object.values(pos).map((p) => ({ ...p }));
  const map = fitter(pts);
  const rushers = ["LE", "DT", "NT", "RE"].concat(dp.blitz >= 0.7 ? ["WLB", "MLB", "SLB"] : []);
  return (
    <svg className="pc-art" viewBox={`0 0 ${W} ${H}`}>
      {Object.entries(pos).map(([slot, p]) => {
        const m = map(p.lat, p.fwd);
        const isRush = rushers.includes(slot);
        return (
          <g key={slot}>
            {isRush && (
              <line
                x1={m.x}
                y1={m.y}
                x2={m.x}
                y2={m.y + 9}
                stroke="#ffd34d"
                strokeWidth="1.4"
              />
            )}
            <circle cx={m.x} cy={m.y} r={slot === "MLB" ? 2.8 : 2.4} fill={slot.startsWith("CB") || slot === "SS" || slot === "FS" ? "#ff9d9d" : "#e23b3b"} />
          </g>
        );
      })}
    </svg>
  );
}
