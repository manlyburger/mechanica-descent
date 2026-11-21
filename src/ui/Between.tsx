import { useState } from "react";
import { CARDS, ENERGY_UP, HP_UP, RULES, VARIANTS, depthFor, label } from "../game/data";
import { jubey, living, ITEMS, type GameState } from "../game/engine";
import { newSeed, pct, SHORT, CardView, type Dispatch } from "./shared";


export function Salvage({ state, dispatch }: { state: GameState; dispatch: Dispatch }) {
  const nextDrones = Math.min(RULES.threatDroneMax, Math.floor((state.threat + 1) / RULES.threatPerDrone));
  return (
    <section className="panel">
      <h2>The wrecks are still warm</h2>
      <p className="muted">
        Each strip: +{RULES.salvageScrap} Scrap, +{RULES.salvageThreat} Threat, +1 Teeth. One more takes Threat to {state.threat + 1}
        {nextDrones > 0 ? ` (${nextDrones} Drone${nextDrones > 1 ? "s" : ""} next room)` : ""}.
      </p>
      <div className="col">
        {state.wrecks.map((w) => (
          <button key={w.id} className="btn" onClick={() => dispatch({ type: "salvage", targetId: w.id })}>
            Strip {w.pile ? "the spilled cargo" : `the ${label(w.kind)}`}
            <small>+{RULES.salvageScrap * w.value} Scrap</small>
          </button>
        ))}
        <button className="btn gold" onClick={() => dispatch({ type: "leaveSalvage" })}>
          Leave the rest
        </button>
      </div>
    </section>
  );
}

export function Reward({ state, dispatch }: { state: GameState; dispatch: Dispatch }) {
  return (
    <section className="panel">
      <h2>Pulled from the room</h2>
      <p className="muted">Add one card to the deck, or travel light.</p>
      <div className="pickcol">
        {state.rewardShown.map((id) => (
          <CardView key={id} card={{ id }} big disabled={id === "MINE" && state.loadoutAd.length >= RULES.adSlots} onClick={() => dispatch({ type: "pickReward", id })} />
        ))}
      </div>
      <button className="btn ghost" onClick={() => dispatch({ type: "pickReward", id: "NONE" })}>
        Take nothing
      </button>
    </section>
  );
}

export function Decon({ state, dispatch }: { state: GameState; dispatch: Dispatch }) {
  const d = depthFor(state.room + 1);
  return (
    <section className="panel hero">
      <h1>Decon Bay</h1>
      <p className="hook">Gold light under the door. The scrubbers are running. You can walk out of here clean, with everything you carried. Or you can let it wash you and go back down.</p>
      <div className="col">
        <button className="btn gold" onClick={() => dispatch({ type: "decon", deeper: false })}>
          Walk out
          <small>End the run here. Room {state.room} goes on the record{state.best ? ` (best so far: ${state.best})` : ""}.</small>
        </button>
        <button className="btn danger" onClick={() => dispatch({ type: "decon", deeper: true })}>
          Go deeper
          <small>
            Contamination {state.contamination} → 0, heal {RULES.deconHeal}. Next leg: +1 Light every room, Level 2 {pct(d.lvl2)}, and the
            halls stain you as you go. Die down there and none of this counts.
          </small>
        </button>
      </div>
    </section>
  );
}

export function Tech({ state, dispatch }: { state: GameState; dispatch: Dispatch }) {
  const [showDeck, setShowDeck] = useState(false);
  const e = ENERGY_UP.find((x) => x.from === state.energyCap);
  const h = HP_UP.find((x) => x.rank === state.hpUpRank + 1);
  const j = jubey(state);
  const hurt = !!j && j.hp < state.jubeyMax;
  const canCut = state.cash >= RULES.removeCardCash && state.deck.length > 5;
  const upgradable = state.deck.filter((c) => !c.variant && VARIANTS.some((v) => v.card === c.id));
  const squad = living(state, "friendly").filter((u) => u.kind !== "jubey");
  return (
    <section className="panel">
      <h2>Tech Stop</h2>
      <p className="muted">
        Spend what you carried out. Then take the next hall.
        {squad.length ? ` With you: ${squad.map((u) => `${SHORT[u.kind]} ${u.hp}/${u.maxHp}`).join(", ")}.` : ""}
      </p>
      <div className="col">
        <button className="btn" disabled={!e || state.scrap < e.scrap || state.rs < e.rs} onClick={() => dispatch({ type: "buyEnergy" })}>
          Energy {state.energyCap} → {e ? e.to : "MAX"}
          <small>{e ? `${e.scrap} Scrap${e.rs ? ` + ${e.rs} RS` : ""}` : "capped"}</small>
        </button>
        <button className="btn" disabled={!h || state.scrap < h.scrap} onClick={() => dispatch({ type: "buyHp" })}>
          +1 Max HP
          <small>{h ? `${h.scrap} Scrap · also heals 1` : "capped"}</small>
        </button>
        <button className="btn" disabled={!hurt || state.scrap < RULES.patchScrap} onClick={() => dispatch({ type: "patch" })}>
          Patch the hull
          <small>{RULES.patchScrap} Scrap · heal 1</small>
        </button>
        <button className="btn" disabled={!hurt || state.cash < RULES.repairCash} onClick={() => dispatch({ type: "repair" })}>
          Pay for a proper repair
          <small>
            {RULES.repairCash} Cash · heal {RULES.repairHeal}
          </small>
        </button>
        {upgradable.map((c) => (
          <div key={c.uid} className="offer">
            <div className="lane-label">REBUILD {CARDS[c.id].name.toUpperCase()} · {RULES.variantScrap} SCRAP · PERMANENT</div>
            {VARIANTS.filter((v) => v.card === c.id).map((v) => (
              <button key={v.id} className="btn mini" disabled={state.scrap < RULES.variantScrap} onClick={() => dispatch({ type: "specialize", uid: c.uid, variant: v.id })}>
                {v.name}
                <small>{v.text}</small>
              </button>
            ))}
          </div>
        ))}
        {state.shop.some(Boolean) && (
          <div className="offer">
            <div className="lane-label">QUARTERMASTER CRATE · PILOT GEAR</div>
            {state.shop.map((id, i) =>
              id ? (
                <button key={i} className="btn mini" disabled={state.scrap < ITEMS[id].price} onClick={() => dispatch({ type: "buy", index: i })}>
                  {ITEMS[id].name} · {ITEMS[id].price} Scrap
                  <small>
                    {ITEMS[id].side === "captive" ? "Captive gear" : "Crew gear"}: {ITEMS[id].text}
                  </small>
                </button>
              ) : null,
            )}
          </div>
        )}
        {state.captives.map((c) => (
          <div key={c.id} className="offer">
            <div className="lane-label">IN CUSTODY · {c.label.toUpperCase()}</div>
            {!c.pilot && (
              <button className="btn mini" onClick={() => dispatch({ type: "captive", holder: c.holder, what: "dismantle" })}>
                Dismantle it
                <small>Scrap, and the holder is free again.</small>
              </button>
            )}
            <button className="btn mini" onClick={() => dispatch({ type: "captive", holder: c.holder, what: "release" })}>
              Release
              <small>{c.pilot ? "They walk out. They may come back in a new frame." : "Let it go."}</small>
            </button>
          </div>
        ))}
        {state.equip.servo && (
          <button className="btn" onClick={() => dispatch({ type: "unequip", what: "servo" })}>
            Unbolt the Servo Limb
            <small>Back into the deck as a card.</small>
          </button>
        )}
        <button className="btn ghost" onClick={() => setShowDeck(!showDeck)}>
          {showDeck ? "Hide deck" : `View deck (${state.deck.length})`}
          <small>Tap a card to cut it for {RULES.removeCardCash} Cash.</small>
        </button>
        {showDeck && (
          <div className="pickcol">
            {state.deck.map((c) => (
              <CardView key={c.uid} card={c} big disabled={!canCut} onClick={() => dispatch({ type: "removeCard", uid: c.uid })} />
            ))}
          </div>
        )}
        <button className="btn gold" onClick={() => dispatch({ type: "nextRoom" })}>
          Next hall
        </button>
      </div>
    </section>
  );
}

export function End({ state, dispatch }: { state: GameState; dispatch: Dispatch }) {
  const win = state.phase === "win";
  return (
    <section className="panel hero">
      <h1>{win ? "Clean" : "Still"}</h1>
      <p className="hook">
        {win
          ? `Gold cleansing light. The ivory comes clean. You walked out from room ${state.room}.`
          : `The hall keeps the rig. Room ${state.room}. Nothing you carried counts.`}
      </p>
      <p className="muted">
        {state.tally.kills} kills · {state.tally.cards} cards played · {state.tally.salvaged} wrecks stripped · {state.tally.decons} Decon
        {state.tally.decons === 1 ? "" : "s"} · seed {state.seed}
        {state.best ? ` · deepest clean exit: room ${state.best}` : ""}
      </p>
      <button className="btn gold" onClick={() => dispatch({ type: "start", seed: newSeed() })}>
        Descend again
      </button>
    </section>
  );
}
