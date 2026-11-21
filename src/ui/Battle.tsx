import { useState } from "react";
import { CARDS, RULES, VARIANTS, cardName, cardText, label } from "../game/data";
import {
  canPlay,
  commandsFor,
  ejectedCommand,
  enemyHitChance,
  living,
  validTargets,
  whyNot,
  pilotRoster,
  tapCommands,
  teamSummary,
  type CardInst,
  type Command,
  type GameState,
  type Unit,
} from "../game/engine";

import { statusLines, Token } from "./Token";
import { pct, CardView, type Dispatch } from "./shared";

export type Pending = { cmd: Command } | null;

export function Battle({ state, dispatch }: { state: GameState; dispatch: Dispatch }) {
  const [selUid, setSel] = useState<string | null>(null);
  const [inspect, setInspect] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const sel = state.hand.find((c) => c.uid === selUid) ?? null;
  const def = sel ? CARDS[sel.id] : null;
  const targets = sel && canPlay(state, sel) ? validTargets(state, sel) : null;
  const cmdTargets = pending?.cmd.targets ?? null;
  const enemies = living(state, "enemy");
  const friends = living(state, "friendly");
  const recap = state.lastAction === "endTurn" ? state.events : [];
  const inspected = state.units.find((u) => u.uid === inspect && u.hp > 0) ?? null;
  const eject = ejectedCommand(state);

  const clear = () => {
    setSel(null);
    setPending(null);
    setInspect(null);
  };
  const play = (a: { targetId?: string; slot?: number }) => {
    if (!sel) return;
    dispatch({ type: "play", uid: sel.uid, ...a });
    clear();
  };
  const tapUnit = (u: Unit) => {
    if (pending && cmdTargets?.includes(u.uid)) {
      dispatch({ type: "command", uid: pending.cmd.uid, cmd: pending.cmd.cmd, targetId: u.uid });
      return clear();
    }
    if (sel && targets === "column" && u.side === "enemy") return play({ slot: u.slot });
    if (sel && Array.isArray(targets) && targets.includes(u.uid)) return play({ targetId: u.uid });
    setSel(null);
    setPending(null);
    setInspect(inspect === u.uid ? null : u.uid);
  };
  const tapEmpty = (slot: number) => {
    if (sel && targets === "column") play({ slot });
  };
  const tapCard = (c: CardInst) => {
    setInspect(null);
    setPending(null);
    if (selUid === c.uid && canPlay(state, c) && validTargets(state, c) === null) return play({});
    setSel(selUid === c.uid ? null : c.uid);
  };
  const runCmd = (c: Command) => {
    if (c.targets) {
      setPending({ cmd: c });
      setInspect(null);
    } else {
      dispatch({ type: "command", uid: c.uid, cmd: c.cmd });
      clear();
    }
  };

  const glow = (u: Unit) => (pending ? !!cmdTargets?.includes(u.uid) : !!sel && ((targets === "column" && u.side === "enemy") || (Array.isArray(targets) && targets.includes(u.uid))));
  const no = sel ? whyNot(state, sel) : null;
  const prompt = pending
    ? `${pending.cmd.label}: tap a highlighted unit.`
    : !sel
      ? "Tap a card or a unit."
      : no
        ? `Can't play: ${no}.`
        : targets === "column"
          ? "Tap the centre column."
          : Array.isArray(targets)
            ? "Tap a highlighted unit."
            : "Tap the card again to play.";

  const lane = (side: Unit[], isEnemy: boolean) => (
    <div className={`lane ${isEnemy ? "enemy" : ""}`}>
      {Array.from({ length: RULES.lanes }, (_, i) => {
        const u = side.find((e) => e.slot === i);
        if (!u) return <button key={i} className={`token empty ${isEnemy && sel && targets === "column" ? "target" : ""}`} onClick={() => tapEmpty(i)} aria-label="empty column" />;
        return <Token key={u.uid} unit={u} state={state} target={glow(u)} open={inspect === u.uid} onClick={() => tapUnit(u)} />;
      })}
    </div>
  );

  return (
    <section className="panel battle">
      {state.team.introduced && enemies.some((u) => u.pilot || u.kind === "relay") && <TeamBar state={state} />}
      <div className="lane-label">
        ENEMY LANE · aim {pct(enemyHitChance(state))}
        {state.queue.length ? ` · ${state.queue.length} inbound` : ""}
        {state.extension ? " · WRONG HALLWAY" : ""}
      </div>
      {lane(enemies, true)}
      <div className="lane-label">FRIENDLY LANE</div>
      {lane(friends, false)}

      {(state.wrecks.length > 0 || state.ejected) && (
        <div className="floor">
          {state.wrecks.length > 0 && <span>Wreckage on the floor: {state.wrecks.length}</span>}
          {eject && (
            <button className="btn mini gold" disabled={!eject.enabled} onClick={() => dispatch({ type: "command", uid: "ejected", cmd: "retrieve" })}>
              {eject.label}
              <small>{eject.detail}</small>
            </button>
          )}
        </div>
      )}

      {state.tap && (
        <div className="sheet">
          <div className="sheet-head">
            <b>Memory Tap connected</b>
            <span>choose one read</span>
          </div>
          {tapCommands(state).map((c) => (
            <button key={c.cmd} className="btn mini" onClick={() => dispatch({ type: "command", uid: "tap", cmd: c.cmd })}>
              {c.label}
              <small>{c.detail}</small>
            </button>
          ))}
        </div>
      )}

      {inspected && !state.tap && (
        <div className="sheet" ref={(el) => el?.scrollIntoView({ block: "end", behavior: "smooth" })}>
          <div className="sheet-head">
            <b>
              {label(inspected.kind)}
              {inspected.variant ? ` (${VARIANTS.find((v) => v.id === inspected.variant)?.name})` : ""}
              {inspected.crazy ? " [CRAZY]" : ""}
            </b>
            <span>
              {inspected.hp}/{inspected.maxHp} HP{inspected.armor ? ` · ${inspected.armor} armor` : ""}{inspected.atk ? ` · ${inspected.atk} dmg` : ""}
            </span>
          </div>
          {statusLines(state, inspected).map((l, i) => (
            <div key={i} className="sheet-line">
              {l}
            </div>
          ))}
          {commandsFor(state, inspected).map((c) => (
            <button key={c.cmd} className="btn mini" disabled={!c.enabled} onClick={() => runCmd(c)}>
              {c.label}
              <small>{c.detail}</small>
            </button>
          ))}
        </div>
      )}

      {recap.length > 0 && !inspected && (
        <div className="recap">
          <div className="lane-label">LAST ROUND</div>
          {recap.slice(0, 14).map((l, i) => (
            <div key={i} style={{ animationDelay: `${i * 70}ms` }}>
              {l}
            </div>
          ))}
        </div>
      )}

      <div className="dock">
        {sel && def && (
          <div className="detail">
            <b>{cardName(sel.id, sel.variant)}</b> <span className="cats">{def.cats.join(" · ")}</span>
            <div>{cardText(sel.id, sel.variant)}{sel.rounds !== undefined ? ` (${sel.rounds} rounds left)` : ""}</div>
          </div>
        )}
        <div className="dockbar">
          <span className="pips">
            EN {state.energy}
            {state.block > 0 ? ` · BLOCK ${state.block}` : ""}
            {state.stripped > 0 ? ` · STRIPPED ${state.stripped}` : ""}
          </span>
          <span className="aim">{prompt}</span>
          <span className="piles">
            deck {state.draw.length} · used {state.discard.length}
          </span>
        </div>
        <div className="hand">
          {state.hand.map((c) => (
            <CardView key={c.uid} card={c} selected={c.uid === selUid} dim={!canPlay(state, c)} onClick={() => tapCard(c)} />
          ))}
          {state.hand.length === 0 && <div className="muted handempty">Hand empty.</div>}
        </div>
        <div className="endrow">
          {!state.scanned && (
            <button className="btn ghost scan" disabled={state.energy < 1} onClick={() => dispatch({ type: "scan" })} title="One more Observation roll on every unidentified enemy modification. Once per fight.">
              Scan for mods · 1E
            </button>
          )}
          <button
            className="btn ghost endturn"
            onClick={() => {
              clear();
              dispatch({ type: "endTurn" });
            }}
          >
            End turn
          </button>
        </div>
      </div>
    </section>
  );
}

/** Compact R-8 status; tap to expand the pilot roster. */
export function TeamBar({ state }: { state: GameState }) {
  const [open, setOpen] = useState(false);
  const sum = teamSummary(state);
  return (
    <button className="teambar" onClick={() => setOpen(!open)} aria-expanded={open}>
      <span className="teamname">RELAY SECTION R-8</span>
      <span>
        {sum[0].value} · Pursuit: {sum[5].value}
        {state.teamOrder ? ` · ORDER: ${state.teamOrder}` : ""}
      </span>
      {open && (
        <span className="teamopen">
          {sum.map((x) => (
            <span key={x.label}>
              {x.label}: {x.value}
            </span>
          ))}
          {pilotRoster(state).map((x) => (
            <span key={x} className="pilotline">
              {x}
            </span>
          ))}
          {state.team.ending && <span className="pilotline">Outcome: {state.team.ending}</span>}
        </span>
      )}
    </button>
  );
}
