import { useEffect, useReducer, useState } from "react";
import { CARDS, ENERGY_UP, HP_UP, RULES, VARIANTS, cardName, cardText, depthFor, label, type CardId, type UnitKind } from "./game/data";
import {
  SAVE_VERSION,
  canPlay,
  commandsFor,
  createGame,
  ejectedCommand,
  enemyHitChance,
  eventView,
  jubey,
  leg,
  living,
  reduce,
  riskyOdds,
  rotCards,
  validTargets,
  whyNot,
  installQa,
  PROX_NAMES,
  captiveOf,
  integrityBand,
  pilotRoster,
  tapCommands,
  teamSummary,
  whyNotRestrainable,
  P,
  ITEMS,
  migrate,
  gearLine,
  type Action,
  type CardInst,
  type Command,
  type GameState,
  type Unit,
} from "./game/engine";
import "./App.css";
import { Crew } from "./Crew";

const KEY = "mechanica-descent-v7";
const OLD_KEY = "mechanica-descent-v6";
type Dispatch = (a: Action) => void;
const newSeed = () => (Date.now() % 99991) + 1;
const pct = (n: number) => `${Math.round(n * 100)}%`;

const SHORT: Record<UnitKind, string> = {
  jubey: "Jubey", light: "Light", lvl2: "Level 2", infested: "Infested", scared: "Scared", drone: "Drone", zombie: "Zombie",
  rifleman: "Rifle", powered: "P. Armor", patient: "Patient", robobuddy: "Buddy", builder: "Builder", possum: "Possum", gunnest: "Nest",
  bulkhead: "Bulkhead", beacon: "Beacon", shepherd: "Shepherd", walker: "Walker", jack: "Panic Jack", warframe: "Warframe",
  clampjaw: "Clampjaw", pod: "Pod", needleback: "Courier", latchback: "Brawler", widow: "Widow", kilnheart: "Breaker",
  bishop: "Bishop", capsule: "Capsule", relay: "Relay", prisoner: "Prisoner", frame: "Frame", pilot: "Pilot",
  hunter: "Hunter", tracker: "Recon", predator: "Predator", nightmare: "Nightmare",
};

function load(): GameState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as GameState;
      if (s && s.v === SAVE_VERSION && Array.isArray(s.deck) && Array.isArray(s.wrecks) && s.team && Array.isArray(s.roster)) return s;
    }
    // A run saved by the previous version carries over, with Observation added.
    const old = localStorage.getItem(OLD_KEY);
    if (old) {
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

function Chip({ k, v, hot }: { k: string; v: string; hot?: boolean }) {
  return (
    <span className={`chip ${hot ? "hot" : ""}`}>
      <em>{k}</em> {v}
    </span>
  );
}

/** Equipment, armed reactions and other standing effects. */
function Gear({ state }: { state: GameState }) {
  const g: string[] = [];
  if (state.loadoutAd.length) g.push(`AM Mine ×${state.loadoutAd.length}${state.phase === "player" && state.minesArmed ? " armed" : ""}`);
  if (state.equip.servo) g.push("Servo Limb");
  if (state.equip.hand) g.push(`Override Hand${state.handUsed && state.phase === "player" ? " (used)" : ""}`);
  if (state.equip.cell > 0) g.push(`Cell ${state.equip.cell}${state.equip.cell === 1 ? " LAST CHARGE" : ""}`);
  for (const c of state.armed) g.push(`${CARDS[c.id].name} armed`);
  if (state.redmouth) g.push(state.madness >= RULES.highMadness ? "RED-MOUTH UNSTABLE" : "Red-Mouth loaded");
  if (state.navFlag) g.push("Corridor marked");
  if (state.badge.turns > 0) g.push(`Badge ${state.badge.turns}`);
  if (state.hallwayArmed) g.push("Exit is wrong");
  if (state.preCommission) g.push("Warframe pre-commissioned");
  for (const c of state.captives) g.push(`Held: ${c.label}`);
  if (state.intel.weak) g.push("Records: a weak point next fight");
  if (state.intel.cache > 0) g.push(`Records: cache at next Tech Stop`);
  if (state.intel.questionable) g.push("RECORDS UNVERIFIED");
  if (state.team.knownRoute && state.team.introduced) g.push("R-8 route known");
  if (state.parts) g.push(`Cockpit Parts ${state.parts}/3`);
  for (const r of state.roster) if (r.custody === "captive" && r.strain >= 70) g.push(`${r.name} RESTLESS`);
  if (!g.length) return null;
  return (
    <div className="gear">
      {g.map((x) => (
        <span key={x} className={/UNSTABLE|LAST|UNVERIFIED|RESTLESS/.test(x) ? "warn" : ""}>
          {x}
        </span>
      ))}
    </div>
  );
}

function Help() {
  return (
    <div className="helpbox">
      <p>
        <b>Cards.</b> Draw {RULES.handSize} a turn. Tap a card to read it, then tap its target (or tap it again). Gold number is
        Energy; "S" is Scrap.
      </p>
      <p>
        <b>Armor</b> (◈) takes 1 off every hit, so 1-damage hits do nothing. A Salvage Leech's second pull strips a point.
      </p>
      <p>
        <b>Melee</b> enemies have to reach you. Their card slides down the lane: Distant, Closing, Melee Ready. Only then can
        they hit. Stun or foam stops the advance; Crane Hook throws them back a step.
      </p>
      <p>
        <b>Capture.</b> A machine at {RULES.captureHp} HP or less, or a disabled one, can be grappled by a Clampjaw or banded with
        Lockbands. Secured machines stop fighting and strain at the restraint. A Clampjaw and a Pod hold one captive each.
      </p>
      <p>
        <b>Pilots.</b> Some mechs eject. A capsule that leaves the room means a pilot who may come back in a new frame. A
        Cockpit Wedge blocks the ejection, not the radio and not the reactor.
      </p>
      <p>
        <b>Pilots.</b> Captured and recruited pilots are people with stats, gear and loyalty. Open <b>crew</b> to equip them,
        talk to them, and assign them on foot or to a salvaged frame. Unwilling captives cannot be assigned at all.
      </p>
      <p>
        <b>Machines.</b> Tap any unit to inspect it and give orders. Allied machines act on their own after your turn, and stay
        with you between rooms while they live.
      </p>
      <p>
        <b>Threat</b> rises when you strip wrecks. Every {RULES.threatPerDrone} Threat calls a Drone into the next room. At{" "}
        {RULES.threatHunt}+ the Infested hunt Jubey. Drains 1 per turn you leave wrecks alone.
      </p>
      <p>
        <b>Madness.</b> Each point is a {pct(RULES.madnessMisfire)} misfire chance. At {RULES.highMadness}+ Nightmare gear acts
        on its own. Drains 1 per turn.
      </p>
      <p>
        <b>Teeth.</b> Infested kills and stripped wrecks fill it. At {RULES.nightmareThreshold}: no Block for{" "}
        {RULES.teethStripTurns} turns.
      </p>
      <p>
        <b>Contamination</b> comes from Infested hits and the deep halls. Every {RULES.contamPerRot} adds a dead card to each
        fight. Only a Decon Bay clears it. There is one after every {RULES.deconEvery}th room: walk out, or go deeper.
      </p>
    </div>
  );
}

function Title({ state, dispatch }: { state: GameState; dispatch: Dispatch }) {
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

function Loadout({ dispatch }: { dispatch: Dispatch }) {
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

function Route({ state, dispatch }: { state: GameState; dispatch: Dispatch }) {
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

function EventPanel({ state, dispatch }: { state: GameState; dispatch: Dispatch }) {
  const v = eventView(state);
  if (!v) return null;
  return (
    <section className="panel event">
      <h2>{v.title}</h2>
      {state.event?.id.startsWith("r8") && <TeamBar state={state} />}
      {v.screen && (
        <div className="pscreen" role="img" aria-label={`The Prisoner's screen shows ${v.screen.glyph}. ${v.screen.caption}`}>
          <div className={`pglyph ${v.screen.anim}`}>{v.screen.glyph}</div>
          <div className="pcaption">{v.screen.caption}</div>
        </div>
      )}
      {v.lines.map((l, i) => (
        <p key={i} className="hook">
          {l}
        </p>
      ))}
      <p className="muted">Energy {state.energy}{state.equip.cell ? ` · Cell ${state.equip.cell}` : ""} · Scrap {state.scrap}</p>
      <div className="col">
        {v.options.map((o) => (
          <button key={o.id} className="btn" disabled={!o.enabled} onClick={() => dispatch({ type: "event", option: o.id })}>
            {o.label}
            <small>{o.detail}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------- battle ----------

function planText(state: GameState, u: Unit): string {
  const p = u.plan;
  if (!p) return "";
  const t = state.units.find((x) => x.uid === p.targetUid);
  const at = t ? SHORT[t.kind] : "—";
  if (p.type === "attack") return `${p.note ? p.note + ": " : ""}shot ${p.dmg} → ${at}`;
  if (p.type === "missile") return `MISSILE ${p.dmg} → ${at}`;
  if (p.type === "disabled") return u.foam ? "foamed" : (u.sealed ?? 0) > 0 ? `sealed ${u.sealed}` : "stunned";
  if (p.type === "eject") return p.note ?? "PREPARING TO EJECT";
  if (p.type === "detonate") return "REACTOR FAILURE THIS TURN";
  if (p.type === "reload") return "RELOADING";
  return p.note ?? p.type;
}

function statusLines(state: GameState, u: Unit): string[] {
  const s: string[] = [];
  if (u.side === "enemy") {
    if (u.cap) s.push(`${u.cap.state === "secured" ? "SECURED" : "BEING SECURED"} · restraint ${integrityBand(u.cap.integrity)}${u.cap.bands ? ` · ${u.cap.bands} band${u.cap.bands > 1 ? "s" : ""}` : ""}`);
    s.push(planText(state, u));
    if (u.prox !== undefined) s.push(PROX_NAMES[u.prox]);
    if (u.pilot) s.push(u.kind === "capsule" ? "pilot inside" : "pilot aboard");
    else if (["needleback", "latchback", "widow", "kilnheart", "bishop"].includes(u.kind)) s.push("no pilot");
    if ((u.wedge ?? 0) > 0) s.push(`COCKPIT WEDGED ${u.wedge}`);
    if (u.kind === "kilnheart") s.push(`reactor ${["stable", "HEATED", "CRITICAL"][u.heat ?? 0]}${(u.heat ?? 0) >= 2 ? `: detonates in ${u.fuse}` : ""}`);
    if (u.kind === "capsule" && u.exitIn !== undefined) s.push(u.flying ? "airborne: crane and hook cannot reach" : "on the floor");
    if (u.replacement) s.push("replacement frame");
    if (u.guardBy) s.push("covered by the Brawler");
    if (u.missiles > 0) s.push(`lock ${u.lock}/2`);
    if (u.plan?.laser && u.plan.targetUid) s.push(`red dot on ${SHORT[state.units.find((x) => x.uid === u.plan!.targetUid)?.kind ?? "jubey"]}`);
    const mods = gearLine(u);
    if (mods) s.push(mods);
    if (u.ammo !== undefined && u.ammo <= 1) s.push(u.ammo === 0 ? "magazine empty" : "last round");
    if (u.kind === "capsule" && u.occupant === "empty") s.push("hatch open");
    if (u.note && !u.note.includes("tapped")) s.push(u.note);
    const why = whyNotRestrainable(u);
    if (why && why !== "not a machine") s.push(why);
  }
  if (u.leech) s.push(`${u.leech.temp ? "offspring " : ""}leech ${u.leech.count}/${RULES.leechMax}`);
  if (u.armor > 0) s.push(`armor ${u.armor}: −${u.armor} per hit`);
  if (u.weak) s.push("exposed: takes +1");
  if (u.burn) s.push(`burning ${u.burn}`);
  if (u.side === "friendly") {
    if (u.malf === "wrongRepair") s.push("MALFUNCTION: will repair an enemy");
    if (u.malf === "uncontrolled") s.push("UNCONTROLLED");
    if (u.malf === "hostile") s.push("HOSTILE STARTUP");
    if (u.foam) s.push("foamed");
    if ((u.sealed ?? 0) > 0) s.push(`sealed ${u.sealed}`);
    if (u.kind === "builder") s.push(u.jammed ? "jammed" : (u.timer ?? 0) <= 1 ? "job due" : `job in ${u.timer}`);
    if (u.order) s.push(`order: ${u.order}`);
    if (u.kind === "warframe" && u.inert) s.push(`startup ${u.progress ?? 0}/${RULES.warframeNeed}${u.paused ? " paused" : ""}`);
    if (u.kind === "shepherd") s.push(`hauling ${u.carried ?? 0}/${RULES.shepherdPair}${u.secured ? " secured" : ""}${u.feed ? " → frame" : ""}${u.hold ? " holding" : ""}`);
    if (u.kind === "possum") s.push(u.shutdown ? "playing dead" : `takings ${u.carried ?? 0}`);
    if (u.kind === "walker") s.push(u.elevated ? "overhead" : "on the floor");
    if (u.kind === "jack") s.push(u.protect ? `guards ${SHORT[state.units.find((x) => x.uid === u.protect)?.kind ?? "jubey"]}${u.intercepted ? " (spent)" : ""}` : "no ward");
    if (u.kind === "gunnest") s.push(u.clamp ? "clamped +2" : "crawling");
    if (u.bolting) s.push("PULLING AWAY");
    if (u.kind === "frame") {
      const r = P.rec(state, u.pilot);
      s.push(`${u.chassis} frame${r ? ` · ${r.name}, ${Math.round(P.frameHit(state, r, u) * 100)}% to hit` : " · EMPTY"}`);
      if (u.faults?.length) s.push(u.faults.join(", "));
    }
    if (u.kind === "pilot") {
      const r = P.rec(state, u.pilot);
      if (r) s.push(`${P.weapon(r)?.name ?? "unarmed"} · ${P.BAND_NAMES[P.band(r.loyalty)]}${P.madnessTotal(r) ? ` · Mad ${P.madnessTotal(r)}%` : ""}`);
    }
    if (u.kind === "clampjaw" || u.kind === "pod") {
      const c = captiveOf(state, u.uid);
      const field = state.units.find((x) => x.cap?.by === u.uid);
      s.push(c ? `holding ${c.label}` : field ? `clamped on ${SHORT[field.kind]}` : u.apprehend ? "moving in" : "empty");
      if (u.kind === "pod" && c) s.push(`seal ${integrityBand(u.podIntegrity ?? 100)}${u.powerOff ? " · POWER CUT" : ` · upkeep in ${RULES.podUpkeepTurns - (u.occupied ?? 0)}`}`);
    }
    if (u.kind === "bulkhead") s.push(`covers ${SHORT[state.units.find((x) => x.uid === u.guards)?.kind ?? "jubey"]}`);
    if (u.roomsLeft !== undefined) s.push(`${u.roomsLeft} fight${u.roomsLeft > 1 ? "s" : ""} left`);
    if ((u.ward ?? 0) > 0) s.push(`prevents ${u.ward}`);
    if (u.mood && s.length < 3) s.push(u.mood);
  }
  return s.filter(Boolean);
}

type Pending = { cmd: Command } | null;

function Battle({ state, dispatch }: { state: GameState; dispatch: Dispatch }) {
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
function TeamBar({ state }: { state: GameState }) {
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

function CardView({ card, selected, dim, big, onClick, disabled }: { card: { id: CardId; variant?: string; rounds?: number }; selected?: boolean; dim?: boolean; big?: boolean; onClick?: () => void; disabled?: boolean }) {
  const d = CARDS[card.id];
  const cls = ["card", selected ? "sel" : "", dim ? "dim" : "", big ? "big" : "", d.cats.includes("Nightmare") ? "night" : "", d.deploys ? "machine" : "", d.exhaust || card.rounds !== undefined ? "ammo" : ""].join(" ");
  return (
    <button className={cls} onClick={onClick} disabled={disabled}>
      <span className="costs">
        {!d.unplayable && <span className="cost">{d.cost}</span>}
        {d.scrap ? <span className="scrapcost">{d.scrap}S</span> : null}
      </span>
      <span className="cname">{cardName(card.id, card.variant)}</span>
      <span className="ctext">{big ? cardText(card.id, card.variant) : d.cats[0]}</span>
    </button>
  );
}

function Token({ unit, state, target, open, onClick }: { unit: Unit; state: GameState; target?: boolean; open?: boolean; onClick?: () => void }) {
  const self = unit.side === "friendly";
  const lines = statusLines(state, unit);
  const alert = unit.plan?.type === "missile" || unit.plan?.type === "eject" || unit.plan?.type === "detonate" || !!unit.malf || (unit.heat ?? 0) >= 2;
  const cls = ["token", unit.kind, self ? "self" : "", unit.crazy ? "crazy" : "", target ? "target" : "", open ? "open" : "", alert ? "missile" : "", unit.foam || (unit.sealed ?? 0) > 0 ? "muted-unit" : "", unit.elevated ? "elevated" : "", unit.prox ? `prox-${unit.prox}` : "", unit.cap ? "restrained" : "", unit.flying ? "flying" : ""].join(" ");
  return (
    <button className={cls} onClick={onClick}>
      <div className="tn">
        {(unit.kind === "frame" || unit.kind === "pilot" || (unit.kind === "capsule" && unit.role === "runner")) && unit.pilot ? P.rec(state, unit.pilot)?.name ?? SHORT[unit.kind] : SHORT[unit.kind]}
        {unit.crazy ? " ✱" : ""}
        {unit.leech ? " ⛭" : ""}
        {unit.pilot && unit.side === "enemy" ? " ●" : ""}
        {unit.stalkerId ? " ◆" : ""}
      </div>
      {(unit.gear ?? []).some((g) => g.revealed) && (
        <div className="gearicons" aria-label={gearLine(unit)}>
          {(unit.gear ?? []).filter((g) => g.revealed).map((g) => (
            <span key={g.uid} className={`gi ${g.id}${g.id === "missilepod" && g.cd === 0 ? " ready" : ""}`}>
              {g.id === "missilepod" ? "⇈" : g.id === "extmag" ? "▮▮" : "◎"}
            </span>
          ))}
        </div>
      )}
      {unit.plan?.laser && <div className="laserdot" aria-hidden="true" />}
      {unit.prox !== undefined && unit.prox > 0 && !unit.cap && <div className="proxtag">{unit.prox >= RULES.proxEngaged ? "IN REACH" : "CLOSING"}</div>}
      {unit.cap && <div className="proxtag cap">{unit.cap.state === "secured" ? "SECURED" : "SECURING"}</div>}
      <div className="th">
        {unit.hp}/{unit.maxHp}
        {unit.armor > 0 ? ` ◈${unit.armor}` : ""}
        {unit.kind === "jubey" && state.block > 0 ? ` +${state.block}` : ""}
        {unit.burn ? ` 🔥${unit.burn}` : ""}
      </div>
      <div className="ti">{lines[0] ?? ""}</div>
    </button>
  );
}

// ---------- between fights ----------

function Salvage({ state, dispatch }: { state: GameState; dispatch: Dispatch }) {
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

function Reward({ state, dispatch }: { state: GameState; dispatch: Dispatch }) {
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

function Decon({ state, dispatch }: { state: GameState; dispatch: Dispatch }) {
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

function Tech({ state, dispatch }: { state: GameState; dispatch: Dispatch }) {
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

function End({ state, dispatch }: { state: GameState; dispatch: Dispatch }) {
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

function Log({ lines }: { lines: string[] }) {
  return (
    <aside className="log">
      {lines.slice(0, 16).map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </aside>
  );
}

export default App;
