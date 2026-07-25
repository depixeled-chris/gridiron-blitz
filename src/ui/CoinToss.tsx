import { useState } from "react";

/** Pre-game coin toss. You call it in the air; the winner receives the opening
 *  kickoff and the loser kicks off. */
export function CoinToss({
  result,
  onCall,
  onContinue,
}: {
  result: { flip: "heads" | "tails"; userWon: boolean } | null;
  onCall: (pick: "heads" | "tails") => void;
  onContinue: () => void;
}) {
  const [spin, setSpin] = useState(false);
  const call = (pick: "heads" | "tails") => {
    setSpin(true);
    onCall(pick);
  };
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
            <div className="toss-elect">
              {result.userWon ? "You receive" : "CPU receives"}
            </div>
            <button className="toss-btn wide" onClick={onContinue}>
              KICKOFF
            </button>
          </>
        )}
      </div>
    </div>
  );
}
