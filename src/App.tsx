import { useEffect, useReducer, useState } from "react";
import { RULES } from "./game/data";
import {
  SAVE_VERSION,
  createGame,
  jubey,
  reduce,
  rotCards,
  installQa,
  P,
  migrate,
  type GameState,
} from "./game/engine";
import { Battle } from "./ui/Battle";
import { Salvage, Reward, Decon, Tech, End } from "./ui/Between";
import { EventPanel } from "./ui/EventPanel";
import { Gear, Help } from "./ui/Help";
import { Route } from "./ui/Route";
import { Title, Loadout } from "./ui/Start";
import { newSeed, Chip, Log } from "./ui/shared";
import { Crew } from "./ui/Crew";

import "./App.css";
const KEY = "mechanica-descent-v8";
const OLD_KEYS = ["mechanica-descent-v7", "mechanica-descent-v6"];

function load(): GameState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as GameState;
      if (s && s.v === SAVE_VERSION && Array.isArray(s.deck) && Array.isArray(s.wrecks) && s.team && Array.isArray(s.roster)) return s;
    }
    // A run saved by an earlier version carries over (v6 gains Observation).
    for (const k of OLD_KEYS) {
      const old = localStorage.getItem(k);
      if (!old) continue;
      const s = migrate(JSON.parse(old));
      if (s && Array.isArray(s.deck) && Array.isArray(s.wrecks) && s.team) return s;
    }
  } catch {
    /* storage unavailable or save unreadable: start clean */
  }
  return createGame(newSeed());
}

function App() {
  const [state, dispatch] = useReducer(reduce, undefined, load);
  const [help, setHelp] = useState(false);
  const [crew, setCrew] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);
  useEffect(() => {
    if (import.meta.env.DEV || location.search.includes("qa")) installQa(dispatch, () => state);
  }, [state]);

  const j = jubey(state);
  const inRun = state.phase !== "title";
  const stain = Math.min(3, Math.floor(state.contamination / RULES.contamPerRot));

  return (
    <div className={`shell ${state.phase === "player" ? "fighting" : ""} stain-${stain}`}>
      <header className="top">
        <div className="titlebar">
          <div>
            <span className="brand">MECHANICA</span> <span className="sub">DESCENT</span>
          </div>
          <span className="topbtns">
            {inRun && (P.crewCount(state) > 0 || state.items.length > 0 || state.parts > 0) && (
              <button className="help crewbtn" onClick={() => setCrew(true)}>
                crew {P.crewCount(state)}
              </button>
            )}
            <button className="help" onClick={() => setHelp(!help)} aria-expanded={help}>
              {help ? "close" : "rules"}
            </button>
          </span>
        </div>
        {inRun && (
          <div className="res">
            <Chip k="Room" v={String(state.room)} />
            <Chip k="HP" v={`${j ? j.hp : 0}/${state.jubeyMax}`} hot={!!j && j.hp <= 2} />
            <Chip k="Scrap" v={String(state.scrap)} />
            <Chip k="RS" v={String(state.rs)} />
            <Chip k="Cash" v={String(state.cash)} />
            <Chip k="Threat" v={String(state.threat)} hot={state.threat >= RULES.threatPerDrone} />
            <Chip k="Mad" v={String(state.madness)} hot={state.madness >= RULES.highMadness} />
            <Chip k="Teeth" v={`${state.nightmare}/${RULES.nightmareThreshold}`} hot={state.nightmare >= RULES.nightmareThreshold - 2} />
            <Chip k="Contam" v={String(state.contamination)} hot={rotCards(state) > 0} />
          </div>
        )}
        {inRun && <Gear state={state} />}
        {help && <Help />}
      </header>

      {inRun && state.notices.length > 0 && (
        <section className="panel notice" role="status">
          <h2>{state.notices[0].title}</h2>
          {state.notices[0].lines.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
          <button className="btn gold" onClick={() => dispatch({ type: "dismiss" })}>
            OK
          </button>
        </section>
      )}
      {state.phase === "title" && <Title state={state} dispatch={dispatch} />}
      {state.phase === "loadout" && <Loadout dispatch={dispatch} />}
      {state.phase === "route" && <Route state={state} dispatch={dispatch} />}
      {state.phase === "event" && <EventPanel state={state} dispatch={dispatch} />}
      {state.phase === "player" && <Battle state={state} dispatch={dispatch} />}
      {state.phase === "salvage" && <Salvage state={state} dispatch={dispatch} />}
      {state.phase === "reward" && <Reward state={state} dispatch={dispatch} />}
      {state.phase === "decon" && <Decon state={state} dispatch={dispatch} />}
      {state.phase === "tech" && <Tech state={state} dispatch={dispatch} />}
      {(state.phase === "win" || state.phase === "dead") && <End state={state} dispatch={dispatch} />}

      {inRun && <Log lines={state.log} />}
      {crew && <Crew state={state} dispatch={dispatch} onClose={() => setCrew(false)} />}
    </div>
  );
}

export default App;
