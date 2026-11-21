import { RULES, depthFor, label, type UnitKind } from "../game/data";
import {
  leg,
  riskyOdds,
  NM,
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
        <p key={i} className={s.startsWith("SIGNAL ANOMALY") ? "snippet glitch" : "snippet"}>
          {s}
        </p>
      ))}
      {state.nm.ash && (
        <p className={state.nm.ash.heat >= RULES.ashmouthMaxHeat - 1 ? "snippet" : "muted"}>
          ASHMOUTH CHARGE carried · Heat {state.nm.ash.heat}/{RULES.ashmouthMaxHeat}
          {state.nm.ash.heat >= RULES.ashmouthMaxHeat ? " · CRITICAL: it fails at the next transition" : state.nm.ash.heat >= RULES.ashmouthMaxHeat - 1 ? " · one more transition makes it critical" : ""}
        </p>
      )}
      {NM.liveEffects(state).filter((e) => e.type === "zombie" || e.type === "mimic").map((e) => (
        <p key={e.id} className="snippet">
          {e.type === "mimic" ? "Something small has been following your rig's sound since " : `Something heavy, chassis ${e.origin.entity}, has been following you since `}
          room {e.origin.room}. It may join a fight up to room {e.until}.
        </p>
      ))}
      <div className="row wrap">
        {(["vent", "abandon", "reorient", "purge"] as const)
          .filter((op) => !NM.nmOpBlock(state, op))
          .map((op) => (
            <button key={op} className="btn ghost mini" onClick={() => dispatch({ type: "nm", op })}>
              {{ vent: "Vent ASHMOUTH (1 Scrap, −2 Heat)", abandon: "Abandon ASHMOUTH", reorient: "Reorient (1 Scrap)", purge: "Purge the comms (2 Scrap or Toolkit)" }[op]}
            </button>
          ))}
      </div>
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
            {NM.nmEligible(state).length > 0 &&
              (() => {
                const sp = NM.severityParts(state);
                return ` · Nightmare Room ${pct(RULES.nmChance)}: tier ${NM.TIER_NAMES[sp.total].split(" ")[0]}, +${sp.total} Madness to enter (Threat ${state.threat}: ${NM.BAND_NAMES[NM.threatBand(state.threat)]}${state.nm.streak >= 1 ? "; another red hall in a row adds a tier" : ""})`;
              })()}
          </small>
        </button>
      </div>
    </section>
  );
}
