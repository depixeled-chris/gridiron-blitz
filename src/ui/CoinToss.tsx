import { useState } from "react";
import type { Wind } from "../game/types";

type Toss = {
  flip: "heads" | "tails";
  userWon: boolean;
  choice: "receive" | "kick" | null;
  wind: Wind;
};

/** Pre-game coin toss. You call it in the air; winning gives you the CHOICE —
 *  take the ball, or take the wind and make them kick into it all game. */
export function CoinToss({
  result,
  onCall,
  onElect,
  onContinue,
}: {
  result: Toss | null;
  onCall: (pick: "heads" | "tails") => void;
  onElect: (choice: "receive" | "kick") => void;
  onContinue: () => void;
}) {
  const [spin, setSpin] = useState(false);
  const call = (pick: "heads" | "tails") => {
    setSpin(true);
    onCall(pick);
  };
  const w = result?.wind;
  const windText = !w
    ? ""
    : w.mph < 5
      ? `Calm — ${w.mph} mph`
      : `${w.mph} mph toward the ${w.dir >= 0 ? "right" : "left"} goal`;

  return (
    <div className="toss">
      <div className="toss-card">
        <div className="toss-title">COIN TOSS</div>

        {!result ? (
          <>
            <div className="toss-sub">Call it in the air</div>
            <div className="toss-btns">
              <button className="toss-btn" onClick={() => call("heads")}>
                HEADS
              </button>
              <button className="toss-btn" onClick={() => call("tails")}>
                TAILS
              </button>
            </div>
          </>
        ) : (
          <>
            <div className={`toss-coin${spin ? " spun" : ""}`}>
              {result.flip === "heads" ? "H" : "T"}
            </div>
            <div className="toss-sub">
              {result.flip.toUpperCase()} —{" "}
              {result.userWon ? "YOU WIN THE TOSS" : "CPU WINS THE TOSS"}
            </div>
            <div className="toss-wind">{windText}</div>

            {result.userWon && !result.choice ? (
              <>
                <div className="toss-sub">Your choice</div>
                <div className="toss-btns">
                  <button className="toss-btn" onClick={() => onElect("receive")}>
                    RECEIVE
                  </button>
                  <button className="toss-btn" onClick={() => onElect("kick")}>
                    KICK
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="toss-elect">
                  {result.choice === "kick"
                    ? result.userWon
                      ? "You kick off — they receive"
                      : "CPU kicks off — you receive"
                    : result.userWon
                      ? "You receive"
                      : "CPU receives"}
                </div>
                <button className="toss-btn wide" onClick={onContinue}>
                  KICKOFF
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
