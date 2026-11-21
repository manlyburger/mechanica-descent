import { RULES, depthFor, label, type UnitKind } from "../game/data";
import {
  leg,
  riskyOdds,
  type GameState,
} from "../game/engine";

import { pct, type Dispatch } from "./shared";

export function Route({ state, dispatch }: { state: GameState; dispatch: Dispatch }) {
  const d = depthFor(state.room);
  const odds = riskyOdds(state.room);
  const drones = Math.min(RULES.threatDroneMax, Math.floor(state.threat / RULES.threatPerDrone));
  const toDecon = RULES.deconEvery - ((state.room - 1) % RULES.deconEvery);
  const lights = d.alwaysLight + leg(state.room) * RULES.legExtraLight;
  return (
    <section className="panel">
      <h2>Room {state.room}. Pick a path.</h2>
      {state.routeSnippets.map((s, i) => (
        <p key={i} className="snippet">
          {s}
        </p>
      ))}
      {state.buddy.status === "wrecked" && <p className="muted">Lil Robobuddy: a shell in the rig. It can be rebuilt from {RULES.buddyRebuildCost} wreck Scrap after a fight.</p>}
      {state.buddy.status === "reassembling" && <p className="muted">Lil Robobuddy is reassembling in the rig: back in room {state.buddy.readyRoom}.</p>}
      <p className="muted">
        {state.revealNext
          ? `${state.intel.questionable ? "UNVERIFIED records say" : "You know what is in there"}: ${(state.intel.questionable ? ["drone" as UnitKind, ...state.nextPack.slice(1)] : state.nextPack).map((k) => label(k)).join(", ") || "nothing"}.`
          : `Expect ${lights} Light${lights > 1 ? "s" : ""}, extra Light ${pct(d.extraLight)}, Infested ${pct(d.infested)}${state.room >= 3 ? `, Level 2 ${pct(d.lvl2)}` : ""}.`}
        {drones > 0 ? ` Threat ${state.threat}: ${drones} Drone${drones > 1 ? "s" : ""} will follow.` : ""}
        {state.pendingSpawn.length ? ` Something from the last hall is waiting too.` : ""} Decon Bay in {toDecon} room
        {toDecon > 1 ? "s" : ""}.
      </p>
      <div className="col">
        <button className="btn" onClick={() => dispatch({ type: "pickPath", risky: false })}>
          Normal hall
          <small>Standard pack. No extra pay.</small>
        </button>
        <button className="btn danger" onClick={() => dispatch({ type: "pickPath", risky: true })}>
          Risky red hall
          <small>
            Pays +{RULES.riskyClearScrap} Scrap and double RS odds. A Drone shadows you. Crazy {pct(odds.crazy)} · Nightmare{" "}
            {pct(odds.nightmare)}
          </small>
        </button>
      </div>
    </section>
  );
}
