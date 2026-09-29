import { useEffect, useMemo, useReducer } from "react";
import { ENERGY_UP, HP_UP, depthFor, label } from "./game/data";
import {
  createGame,
  installQa,
  reduce,
  type Action,
  type GameState,
  type Unit,
} from "./game/engine";
import "./App.css";

const KEY = "mechanica-descent-v1";

function load(): GameState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as GameState;
  } catch {
    /* ignore */
  }
  return createGame(Date.now() % 99991);
}

function App() {
  const [state, dispatch] = useReducer(reduce, undefined, load);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    installQa(dispatch, () => state);
  }, [state]);

  return (
    <div className="shell">
      <header className="top">
        <div>
          <div className="brand">MECHANICA</div>
          <div className="sub">DESCENT</div>
        </div>
        <div className="res">
          <Chip k="Room" v={String(state.room || "—")} />
          <Chip k="HP" v={hpLine(state)} />
          <Chip k="EN" v={`${state.energy}/${state.energyCap}${state.bonusEnergy ? `+${state.bonusEnergy}` : ""}`} />
          <Chip k="Scrap" v={String(state.scrap)} />
          <Chip k="RS" v={String(state.rs)} />
          <Chip k="Threat" v={String(state.threat)} />
          <Chip k="Mad" v={`${state.madness}%`} />
          <Chip k="Nite" v={`${state.nightmare}/9`} />
          <Chip k="RKT" v={rocketLine(state)} />
        </div>
      </header>

      {state.phase === "title" && <Title dispatch={dispatch} />}
      {state.phase === "route" && <Route state={state} dispatch={dispatch} />}
      {state.phase === "choice" && <Choice state={state} dispatch={dispatch} />}
      {(state.phase === "player" || state.phase === "resolving") && (
        <Battle state={state} dispatch={dispatch} />
      )}
      {state.phase === "tech" && <Tech state={state} dispatch={dispatch} />}
      {state.phase === "win" && <End win dispatch={dispatch} />}
      {state.phase === "dead" && <End win={false} dispatch={dispatch} />}

      <Log lines={state.log} />
    </div>
  );
}

function hpLine(s: GameState) {
  const j = s.units.find((u) => u.kind === "jubey");
  return j ? `${j.hp}/${s.jubeyMax}` : `0/${s.jubeyMax}`;
}
function rocketLine(s: GameState) {
  if (!s.ownsRocket) return `find ${Math.round(s.rocketFindChance * 100)}%`;
  return `${s.rocketEquipped ? "EQ" : "BAG"} ×${s.rocketAmmo}`;
}

function Chip({ k, v }: { k: string; v: string }) {
  return (
    <span className="chip">
      <em>{k}</em> {v}
    </span>
  );
}

function Title({ dispatch }: { dispatch: (a: Action) => void }) {
  return (
    <section className="panel hero">
      <h1>Mechanica Descent</h1>
      <p className="hook">
        White-and-ivory rig. Abandoned halls. Threat and Madness turn salvage into
        danger. Decon Bay is the gold light at the bottom.
      </p>
      <button className="btn gold" onClick={() => dispatch({ type: "start" })}>
        Descend
      </button>
      <p className="muted">
        Console QA: window.__descent — giveWeapon(), giveAmmo(n), giveScrap(n)
      </p>
    </section>
  );
}

function Route({ state, dispatch }: { state: GameState; dispatch: (a: Action) => void }) {
  const d = depthFor(state.room);
  const crazy = Math.round((0.01 + (state.room - 1) * 0.013) * 100);
  const night = Math.round((0.03 + (state.room - 1) * 0.04) * 100);
  return (
    <section className="panel">
      <h2>Room {state.room} — pick a path</h2>
      <p className="muted">
        Table: {d.alwaysLight} Light, extra Light {Math.round(d.extraLight * 100)}%, Infested{" "}
        {Math.round(d.infested * 100)}%, Lvl2 {Math.round(d.lvl2 * 100)}%.
      </p>
      <div className="row">
        <button className="btn" onClick={() => dispatch({ type: "pickPath", risky: false })}>
          Normal hall
          <small>Standard pack. No extra Crazy / Nightmare roll.</small>
        </button>
        <button className="btn danger" onClick={() => dispatch({ type: "pickPath", risky: true })}>
          Risky red hall
          <small>
            Crazy {crazy}% · Nightmare {night}%
          </small>
        </button>
      </div>
    </section>
  );
}

function Choice({ state, dispatch }: { state: GameState; dispatch: (a: Action) => void }) {
  const [a, b] = state.choiceShown;
  return (
    <section className="panel">
      <h2>The hall offers something</h2>
      <p className="hook">{state.lastHook}</p>
      <div className="col">
        {a && (
          <button className="btn" onClick={() => dispatch({ type: "pickChoice", id: a.id })}>
            {a.title}
            <small>{a.blurb}</small>
          </button>
        )}
        {b && (
          <button className="btn" onClick={() => dispatch({ type: "pickChoice", id: b.id })}>
            {b.title}
            <small>{b.blurb}</small>
          </button>
        )}
        <button className="btn ghost" onClick={() => dispatch({ type: "pickChoice", id: "NONE" })}>
          Keep moving
          <small>Leave it. The room stays what the path promised.</small>
        </button>
      </div>
    </section>
  );
}

function Battle({
  state,
  dispatch,
}: {
  state: GameState;
  dispatch: (a: Action) => void;
}) {
  const enemies = useMemo(
    () => state.units.filter((u) => u.side === "enemy").sort((a, b) => a.slot - b.slot),
    [state.units]
  );
  const friends = useMemo(
    () => state.units.filter((u) => u.side === "friendly").sort((a, b) => a.slot - b.slot),
    [state.units]
  );

  const canRocket =
    state.ownsRocket && state.rocketEquipped && state.rocketAmmo > 0 && !state.rocketUsed && state.energy >= 1;

  return (
    <section className="panel battle">
      <div className="lane-label">ENEMY LANE</div>
      <div className="lane">
        {Array.from({ length: 6 }).map((_, i) => {
          const live = enemies.find((e) => e.slot === i && !e.wreck);
          const dead = enemies.find((e) => e.slot === i && e.wreck);
          const u = live ?? dead;
          return <Token key={i} unit={u} onClick={() => onToken(dispatch, u)} />;
        })}
      </div>
      <div className="lane-label">FRIENDLY LANE</div>
      <div className="lane">
        {Array.from({ length: 6 }).map((_, i) => {
          const u = friends.find((e) => e.slot === i);
          return <Token key={i} unit={u} self />;
        })}
      </div>

      {state.phase === "player" && (
        <div className="acts">
          <button className="btn" disabled={state.gunUsed || state.energy < 1} onClick={() => hint("gun")}>
            Machine gun 1–3
            <small>1 EN · then tap enemy</small>
          </button>
          <button className="btn" disabled={state.craneUsed || state.energy < 1} onClick={() => hint("crane")}>
            Crane Smash
            <small>1 EN · then tap column</small>
          </button>
          <button className="btn gold" disabled={!canRocket} onClick={() => hint("rocket")}>
            Rocket
            <small>
              {state.ownsRocket
                ? state.rocketEquipped
                  ? `${state.rocketAmmo} ammo · 4/2 + burn`
                  : "stowed — equip at Tech"
                : `not found (${Math.round(state.rocketFindChance * 100)}%)`}
            </small>
          </button>
          <button className="btn ghost wide" onClick={() => dispatch({ type: "endTurn" })}>
            End turn
          </button>
        </div>
      )}
      <div id="aim" className="aim" />
    </section>
  );
}

let pending: "gun" | "crane" | "rocket" | null = null;
function hint(kind: typeof pending) {
  pending = kind;
  const el = document.getElementById("aim");
  if (el) el.textContent = kind === "crane" ? "Tap an enemy column." : "Tap an enemy. Wrecks salvage.";
}

function onToken(dispatch: (a: Action) => void, u?: Unit) {
  if (!u) return;
  if (u.wreck) {
    dispatch({ type: "salvage", targetId: u.uid });
    pending = null;
    return;
  }
  if (pending === "gun") dispatch({ type: "gun", targetId: u.uid });
  else if (pending === "rocket") dispatch({ type: "rocket", targetId: u.uid });
  else if (pending === "crane") dispatch({ type: "crane", slot: u.slot });
  else dispatch({ type: "gun", targetId: u.uid });
  pending = null;
  const el = document.getElementById("aim");
  if (el) el.textContent = "";
}

function Token({ unit, onClick, self }: { unit?: Unit; onClick?: () => void; self?: boolean }) {
  if (!unit) return <div className="token empty" />;
  const art =
    unit.kind === "infested"
      ? "./cards/nightmare.jpg"
      : unit.kind === "zombie"
        ? "./cards/zombie.jpg"
        : unit.kind === "drone"
          ? "./cards/drone.jpg"
          : unit.kind === "rifleman"
            ? "./cards/riflemen.jpg"
            : undefined;
  return (
    <button
      className={`token ${unit.wreck ? "wreck" : ""} ${unit.crazy ? "crazy" : ""} ${self ? "self" : ""}`}
      onClick={onClick}
      disabled={self}
    >
      {art && <img src={art} alt="" />}
      <div className="tn">{unit.wreck ? "WRECK" : label(unit.kind)}</div>
      <div className="th">
        {unit.wreck ? "tap salvage" : `${unit.hp}/${unit.maxHp}`}
        {unit.burn ? ` b${unit.burn}` : ""}
        {unit.lock ? ` L${unit.lock}` : ""}
      </div>
    </button>
  );
}

function Tech({ state, dispatch }: { state: GameState; dispatch: (a: Action) => void }) {
  const e = ENERGY_UP.find((x) => x.from === state.energyCap);
  const h = HP_UP.find((x) => x.rank === state.hpUpRank + 1);
  return (
    <section className="panel">
      <h2>Tech Stop</h2>
      <p className="muted">Equip specials. Spend scrap. Then take the next hall.</p>
      <div className="col">
        {state.ownsRocket ? (
          <button className="btn gold" onClick={() => dispatch({ type: "equipRocket", on: !state.rocketEquipped })}>
            {state.rocketEquipped ? "Stow rocket launcher" : "Equip rocket launcher (slot A)"}
            <small>{state.rocketAmmo} ammo · 4 main / 2 splash · burn 1×2</small>
          </button>
        ) : (
          <p className="muted">
            Rocket frame not found. Current pity {Math.round(state.rocketFindChance * 100)}% (Lvl2 doubles the roll).
          </p>
        )}
        <button className="btn" disabled={!e || state.scrap < (e?.scrap ?? 99) || state.rs < (e?.rs ?? 99)} onClick={() => dispatch({ type: "buyEnergy" })}>
          Energy {state.energyCap} → {e ? e.to : "MAX"}
          <small>{e ? `${e.scrap} scrap + ${e.rs} RS` : "capped"}</small>
        </button>
        <button className="btn" disabled={!h || state.scrap < (h?.scrap ?? 99)} onClick={() => dispatch({ type: "buyHp" })}>
          +1 Max HP
          <small>{h ? `${h.scrap} scrap · also heal 1` : "capped"}</small>
        </button>
        <button className="btn gold" onClick={() => dispatch({ type: "nextRoom" })}>
          Next hall
        </button>
      </div>
    </section>
  );
}

function End({ win, dispatch }: { win: boolean; dispatch: (a: Action) => void }) {
  return (
    <section className="panel hero">
      <h1>{win ? "Decon Bay" : "Still"}</h1>
      <p className="hook">
        {win
          ? "Gold cleansing light. The ivory comes clean. First slice complete."
          : "The hall keeps the rig. Threat did what it does."}
      </p>
      <button className="btn gold" onClick={() => dispatch({ type: "start", seed: Date.now() % 99991 })}>
        Descend again
      </button>
    </section>
  );
}

function Log({ lines }: { lines: string[] }) {
  return (
    <aside className="log">
      {lines.slice(0, 12).map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </aside>
  );
}

export default App;
