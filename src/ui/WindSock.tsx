import type { Wind } from "../game/types";

/** Field-side windsock. Lives OUTSIDE the scoreboard (which slides away at the
 *  snap) so the wind is readable during the phase of play — that's the whole
 *  point of it. The sock lifts and straightens as it freshens and points the
 *  way the wind is blowing. */
export function WindSock({ wind }: { wind: Wind }) {
  const gust = Math.min(1, wind.mph / 20);
  const calm = wind.mph < 5;
  return (
    <div className={`windsock${calm ? " calm" : ""}`}>
      <div className="ws-pole">
        <div
          className="ws-sock"
          style={{
            ["--gust" as string]: gust,
            transform: `scaleX(${wind.dir >= 0 ? 1 : -1})`,
          }}
        >
          <i />
          <i />
          <i />
        </div>
      </div>
      <div className="ws-read">
        <span className="ws-mph">{wind.mph}</span>
        <span className="ws-unit">MPH</span>
        <span className="ws-arrow">{wind.dir >= 0 ? "▶" : "◀"}</span>
      </div>
    </div>
  );
}
