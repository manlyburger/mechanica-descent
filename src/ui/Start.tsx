import { RULES } from "../game/data";
import {
  type GameState,
} from "../game/engine";

import { newSeed, type Dispatch } from "./shared";

export function Title({ state, dispatch }: { state: GameState; dispatch: Dispatch }) {
  return (
    <section className="panel hero">
      <h1>Mechanica Descent</h1>
      <p className="hook">
        White-and-ivory rig. Abandoned halls. Threat and Madness turn salvage into danger. Decon Bay is the gold light at the
        bottom. Then there is another bottom.
      </p>
      <button className="btn gold" onClick={() => dispatch({ type: "start", seed: newSeed() })}>
        Descend
      </button>
      {state.best > 0 && <p className="muted">Deepest clean exit: room {state.best}.</p>}
    </section>
  );
}

export function Loadout({ dispatch }: { dispatch: Dispatch }) {
  return (
    <section className="panel">
      <h2>One thing to carry in</h2>
      <p className="muted">The first two rooms are the hardest. Pick what gets you through them.</p>
      <div className="col">
        <button className="btn" onClick={() => dispatch({ type: "loadout", pick: "lootbox" })}>
          Shabby Lootbox
          <small>A random basic item card (a fuel canister to toss, a flare, foam…) and {RULES.lootboxScrap} Scrap.</small>
        </button>
        <button className="btn" onClick={() => dispatch({ type: "loadout", pick: "mine" })}>
          AM Mine
          <small>
            Auto-deploys every fight. After turn 1, the first enemy machine to enter or advance takes {RULES.mineDamage}. One
            use. You can carry {RULES.adSlots} auto-deploy cards.
          </small>
        </button>
        <button className="btn" onClick={() => dispatch({ type: "loadout", pick: "buddy" })}>
          Lil Robobuddy
          <small>{RULES.buddyHp} HP. At the end of each fight it collects one wreck for you without raising Threat.</small>
        </button>
      </div>
    </section>
  );
}
