// Brief 7: Nightmare Rooms. A Red Hall can hold one of six authored rooms.
// Entering one costs Madness once; every choice shows its cost, its reward
// and its Clean / Complication / Crisis odds before you commit; the rolled
// outcome is stored; and a few outcomes leave something behind that follows
// you: a Dead Frame or the Wrong Robobuddy in a later fight, a corrupted
// transmission, a lost map. Each of those has an origin, a window and an end.

import { RULES, UNITS, label, type UnitKind } from "./data";
import { addCard, addScrap, allies, canPayEnergy, chance, deal, freeEnemySlot, freeFriendSlot, jubey, living, log, payEnergy, pick, repair, roll, spawn } from "./core";
import { assign, assignBlock, band, gainXp, makePilot, maxHp, newItem, partyObservation, rec, statOf } from "./pilots";
import { FLEE_NAMES } from "./pilots-data";
import { rebuildBlock, rebuildBuddy, rebuildWrecks } from "./recovery";
import { active as activeStalkers } from "./stalkers";
import type { EventView, Flow, Option } from "./events";
import type { GameState, Plan, PilotRec, Unit } from "./state";

// ---------- state ----------

export type NmOutcome = "clean" | "complication" | "crisis";
export type NmRoomId = "choir" | "hangar" | "reliquary" | "wrongbuddy" | "staircase" | "saferoom";
export type CaptiveState = "frightened" | "resistant" | "compromised" | "hostile" | "incapacitated";

export interface NmEffect {
  id: string;
  type: "zombie" | "mimic" | "transmission" | "navigation";
  origin: { room: number; event: NmRoomId; option: string; entity: string };
  severity: number;
  threatAt: number;
  createdRoom: number;
  from: number; // first room it can act in
  until: number; // last room it can act in; after this it expires
  foreshadowed: boolean;
  status: "pending" | "active" | "resolved" | "canceled" | "expired";
  note: string;
  sudden?: boolean;
}

export interface NmCaptive {
  id: string;
  name: string;
  state: CaptiveState;
  shown: CaptiveState; // what it looks like before anyone checks
  known: boolean;
  freed: boolean;
  existing: boolean; // a person already in your roster
}

export interface NmData {
  captives?: NmCaptive[];
  synced?: boolean;
  agreement?: boolean;
  broke?: boolean;
  misled?: string;
  inspected?: boolean;
  repairNeeded?: boolean;
  casketUid?: string;
  casketGone?: boolean;
  stabilized?: boolean;
  taken?: boolean;
  identified?: boolean;
  buddyMode?: "active" | "wrecked" | "reassembling" | "none";
  climbing?: boolean;
  dealt?: boolean;
  mapped?: boolean;
  safe?: "genuine" | "malfunction" | "surveillance" | "trap";
  known?: "full" | "partial";
  hidden?: string; // chassis ID of the damaged mech behind the partition
  hiddenGone?: boolean;
  sealed?: boolean;
}

export interface NmRoom {
  id: NmRoomId;
  severity: number;
  band: number;
  threatAt: number;
  entryMadness: number;
  actions: number;
  done: string[];
  rolled: Record<string, NmOutcome>;
  data: NmData;
  lines: string[];
}

export interface NmState {
  seen: NmRoomId[];
  streak: number; // consecutive Red Hall picks
  room: NmRoom | null;
  effects: NmEffect[];
  isolated: boolean; // the Conductor's signal path is cut for good
  ash: { heat: number } | null;
  mappedRoom: number; // room whose Nightmare danger is lowered by a mapped staircase
  casketOwned: boolean;
  // one-room flags set by a choice and consumed when that room's fight spawns
  blast?: number;
  ambush?: number;
  suddenNow?: number;
  mimicHurt?: number;
  casketDamaged?: boolean;
}

export function newNm(): NmState {
  return { seen: [], streak: 0, room: null, effects: [], isolated: false, ash: null, mappedRoom: 0, casketOwned: false };
}

// ---------- Threat bands, severity, danger ----------

export const BAND_NAMES = ["Low", "Elevated", "High", "Severe", "Extreme"];
export const TIER_NAMES = ["", "I — THE UNQUIET", "II — THE DISTORTION", "III — THE MALIGNANCE", "IV — THE RUPTURE"];

export function threatBand(threat: number): number {
  let b = 0;
  RULES.nmBands.forEach((t, i) => {
    if (threat >= t) b = i;
  });
  return b;
}
export function baseTier(room: number): number {
  return RULES.nmTierRooms.filter((r) => room >= r).length;
}
export function severityParts(state: GameState): { base: number; threat: number; madness: number; streak: number; total: number } {
  const base = baseTier(state.room);
  const b = threatBand(state.threat);
  const threat = b >= 3 ? 2 : b === 2 ? 1 : 0;
  const madness = state.madness >= RULES.nmMadnessTier ? 1 : 0;
  const streak = state.nm.streak >= 2 ? 1 : 0;
  return { base, threat, madness, streak, total: Math.min(4, Math.max(1, base + threat + madness + streak)) };
}
export function danger(severity: number, band: number, risk: number, prep: number): number {
  return Math.max(0, Math.min(7, severity - 1 + Math.min(3, band) + risk - prep));
}
export function odds(d: number): { clean: number; complication: number; crisis: number } {
  return { clean: 0.75 - 0.08 * d, complication: 0.2 + 0.03 * d, crisis: 0.05 + 0.05 * d };
}

const ROOM_TIERS: Record<NmRoomId, [number, number]> = {
  choir: [1, 4],
  staircase: [1, 4],
  reliquary: [2, 4],
  wrongbuddy: [2, 4],
  hangar: [3, 4],
  saferoom: [3, 4],
};
export const ROOM_NAMES: Record<NmRoomId, string> = {
  choir: "THE CAPTIVE CHOIR",
  hangar: "THE HANGAR THAT BREATHES",
  reliquary: "THE CINDER RELIQUARY",
  wrongbuddy: "THE WRONG ROBOBUDDY",
  staircase: "THE STAIRCASE WITH TOO MANY LANDINGS",
  saferoom: "THE LAST SAFE ROOM",
};

/** Mental takes one off Nightmare Madness when a crew pilot has enough of it. */
function ward(state: GameState): boolean {
  return state.roster.some((r) => r.custody === "ally" && r.away <= 0 && r.hp > 0 && statOf(r, "mental") >= RULES.nmMentalWard);
}
function madden(state: GameState, n: number, why: string, min = 0) {
  const w = ward(state) ? 1 : 0;
  const got = Math.max(min, n - w);
  if (got <= 0) {
    log(state, `${why}: your crew's steadiest head talks you through it. No Madness.`);
    return;
  }
  state.madness += got;
  log(state, `${why}: +${got} Madness${w ? " (one less: a steady crew voice)" : ""}. Madness ${state.madness}.`);
}
function bestStat(state: GameState, s: "mental" | "skill" | "endurance" | "observation"): { v: number; who?: PilotRec } {
  let best: { v: number; who?: PilotRec } = { v: 0 };
  for (const r of state.roster) {
    if (r.custody !== "ally" || r.away > 0 || r.hp <= 0) continue;
    const v = s === "observation" ? partyObservation(state).obv : statOf(r, s);
    if (v > best.v) best = { v, who: r };
  }
  if (s === "observation") best.v = Math.max(best.v, partyObservation(state).obv);
  return best;
}
const hasItem = (state: GameState, ids: string[]) => state.items.some((x) => ids.includes(x.id)) || state.roster.some((r) => r.custody === "ally" && r.slots.some((x) => x && ids.includes(x.id)));

// ---------- persistent effects ----------

const ZOMBIE_TYPES = ["zombie", "mimic"];

export function liveEffects(state: GameState, type?: NmEffect["type"]): NmEffect[] {
  return state.nm.effects.filter((e) => (e.status === "pending" || e.status === "active") && (!type || e.type === type));
}
export function transmissionActive(state: GameState): NmEffect | undefined {
  return liveEffects(state, "transmission").find((e) => e.from <= state.room);
}

/** Schedules one consequence, within the caps: one Zombie-type, one transmission, one navigation. */
export function schedule(state: GameState, type: NmEffect["type"], option: string, entity: string, note: string, extra: Partial<NmEffect> = {}): NmEffect | null {
  const r = state.nm.room;
  const capped = ZOMBIE_TYPES.includes(type) ? liveEffects(state).some((e) => ZOMBIE_TYPES.includes(e.type)) : liveEffects(state, type).length > 0;
  if (capped) {
    log(state, `(Already something of that kind following you: nothing new is scheduled.)`);
    return null;
  }
  if (type === "transmission" && state.nm.isolated) {
    log(state, "The corrupted burst hits the isolated relay and goes nowhere.");
    return null;
  }
  const room = state.room;
  const window = type === "transmission" ? { from: room, until: room + RULES.nmTransmissionRooms } : type === "navigation" ? { from: room + 1, until: room + 1 } : { from: room + 1, until: room + RULES.nmWindow };
  const e: NmEffect = {
    id: `nm${state.uidSeq++}`,
    type,
    origin: { room, event: r?.id ?? "staircase", option, entity },
    severity: r?.severity ?? 1,
    threatAt: state.threat,
    createdRoom: room,
    ...window,
    foreshadowed: true,
    status: "pending",
    note,
    ...extra,
  };
  if (type === "transmission") e.status = "active";
  state.nm.effects.push(e);
  return e;
}

/** Room transitions are the only clock these effects run on. */
export function nmRoomStart(state: GameState) {
  const nm = state.nm;
  for (const e of nm.effects) {
    if ((e.status === "pending" || e.status === "active") && state.room > e.until) {
      e.status = "expired";
      log(state, e.type === "transmission" ? "The static clears. Transmissions sound like themselves again." : e.type === "navigation" ? "You have your bearings back." : `${e.note}: it never found you. Whatever it was has gone quiet.`);
    }
  }
  const t = transmissionActive(state);
  if (t) {
    state.intel.questionable = true;
    const { obv, who } = partyObservation(state);
    const lines = [
      "SIGNAL ANOMALY · RELAY SYSTEM: “No hostile contacts detected.” · RELAY SYSTEM: “NO HOSTILE CONTACTS DETECTED.” · UNKNOWN: “Then why is something moving behind you?”",
      "SIGNAL ANOMALY · TRANSMISSION: “Jubey, the corridor is cl—cl—” · CONDUCTOR: “All clear. All clear. All clear.”",
      "SIGNAL ANOMALY · CONDUCTOR: “You left before the final movement. We will rehearse it here.”",
    ];
    const line = lines[(state.room + t.createdRoom) % lines.length];
    state.routeSnippets = [...state.routeSnippets, line + (obv >= 6 ? ` [${who}: repeated voice pattern, duplicate timestamps. Conductor origin; treat room intel as unreliable.]` : " [Unverified: room intel may be corrupted.]")];
    log(state, line);
  }
  const nav = liveEffects(state, "navigation").find((e) => e.from <= state.room);
  if (nav) {
    nav.status = "active";
    state.revealNext = false;
    state.routeSnippets = [...state.routeSnippets, "Your map of this floor is wrong. The landings do not match the count. Reorient (1 Scrap), or arrive late and face an extra Light Mech."];
  }
  // ASHMOUTH heat climbs with every transition it is carried through.
  const ash = nm.ash;
  if (ash) {
    if (ash.heat >= RULES.ashmouthMaxHeat) {
      ashFail(state);
    } else {
      ash.heat += 1;
      if (ash.heat >= RULES.ashmouthMaxHeat) state.notices.push({ title: "ASHMOUTH CHARGE: CRITICAL", lines: [`Heat ${ash.heat}/${RULES.ashmouthMaxHeat}. It fails at the next room transition unless you vent it, fire it, or abandon it.`] });
      else if (ash.heat >= RULES.ashmouthMaxHeat - 1) state.notices.push({ title: "ASHMOUTH CHARGE: HEAT WARNING", lines: [`Heat ${ash.heat}/${RULES.ashmouthMaxHeat}. One more transition makes it critical. Vent it (1 Scrap, −2 Heat), fire it, or abandon it.`] });
    }
  }
}

/** Fight start: a scheduled thing whose window is open walks in; CASKET-13 costs its Madness and runs its reactor. */
export function nmFightStart(state: GameState) {
  for (const e of liveEffects(state)) {
    if (!ZOMBIE_TYPES.includes(e.type) || e.status !== "pending" || state.room < e.from || state.room > e.until) continue;
    const slot = freeEnemySlot(state);
    if (slot < 0) continue;
    const kind: UnitKind = e.type === "mimic" ? "mimic" : "deadframe";
    const u = spawn(state, kind, "enemy", slot, { nmEffect: e.id, sudden: e.sudden, note: e.type === "mimic" ? "it followed you" : `chassis ${e.origin.entity}` });
    e.status = "active";
    log(state, e.type === "mimic" ? "A small shape comes in behind the pack. It makes Robobuddy's greeting noise, a fraction too late." : `A damaged mech gets up off the floor in column ${slot + 1}. Its cockpit reads NO PILOT DETECTED. Chassis ${e.origin.entity}.`);
    if (kind === "deadframe") u.prox = 0;
  }
  for (const c of allies(state, "casket")) {
    madden(state, RULES.casketMadness - (c.pilot ? 1 : 0), "CASKET-13 deploys");
    if (!c.pilot) c.heat = (c.heat ?? 0) + 1;
    if ((c.heat ?? 0) >= 4) {
      log(state, "CASKET-13 REACTOR SURGE. Orange light floods the lane.");
      for (const f of living(state, "friendly").filter((x) => Math.abs(x.slot - c.slot) === 1)) deal(state, f, 2, "CASKET-13 reactor surge");
      deal(state, c, 2, "Reactor surge");
      c.heat = 1;
    } else if ((c.heat ?? 0) >= 3) log(state, "CASKET-13 REACTOR WARNING: heat 3. It surges at the next deployment unless vented (1 Energy) or a pilot supervises it.");
    if (c.rampage) {
      const t = pick(state, living(state, "friendly").filter((x) => x.uid !== c.uid));
      if (t) deal(state, t, 2, "CASKET-13, uncontrolled");
      c.rampage = false;
    }
  }
}

export function nmOnKilled(state: GameState, u: Unit) {
  const e = state.nm.effects.find((x) => x.id === u.nmEffect);
  if (e) {
    e.status = "resolved";
    log(state, e.type === "mimic" ? "The imitation stops moving. Its faceplate falls off. There is nothing behind it." : "The Dead Frame goes down and stays down.");
  }
  if (u.kind === "casket" && u.side === "friendly") state.nm.casketOwned = false;
}

/** Dead Frame and imitation plans, telegraphed like everything else. */
export function nmPlan(state: GameState, u: Unit): Plan | null {
  if (u.kind === "deadframe") {
    if (!u.repaired && u.hp <= u.maxHp - 3) return { type: "reassemble", note: `REASSEMBLING: +${RULES.deadframeHeal} HP` };
    if (u.sudden && !u.suddenUsed && (u.prox ?? 0) < RULES.proxEngaged) return { type: "rush", note: "SUDDEN MOTION: it will close all the way" };
  }
  if (u.kind === "mimic" && state.wrecks.length) return { type: "scavenge", note: "copying Robobuddy: collecting wreckage" };
  return null;
}

/** CASKET-13 on your side: a heavy blow, and every third one bleeds into the columns beside it. */
export function casketAct(state: GameState, a: Unit, attack: (t: Unit, dmg: number) => void, target: Unit | undefined) {
  if (!target) return;
  a.strikes = (a.strikes ?? 0) + 1;
  attack(target, a.atk);
  if (a.strikes % 3 === 0) {
    log(state, "CASKET-13's reactor flares through the blow.");
    for (const e of living(state, "enemy").filter((x) => Math.abs(x.slot - target.slot) === 1)) deal(state, e, RULES.casketSplash, "CASKET-13 nightmare splash");
  }
}

// ---------- ASHMOUTH ----------

export function ashFail(state: GameState) {
  const j = jubey(state);
  log(state, "ASHMOUTH CHARGE FAILS. The casing splits in the rig.");
  if (j) deal(state, j, 4, "ASHMOUTH containment failure", { noLeech: true });
  state.threat += RULES.ashmouthThreat;
  removeAsh(state);
  state.notices.push({ title: "ASHMOUTH CHARGE: CONTAINMENT FAILURE", lines: ["It was carried at critical heat through a transition.", `Jubey takes 4. Threat +${RULES.ashmouthThreat}. The charge is gone.`] });
}
function removeAsh(state: GameState) {
  const keep = (c: { id: string }) => c.id !== "ASHMOUTH";
  state.deck = state.deck.filter(keep);
  state.hand = state.hand.filter(keep);
  state.discard = state.discard.filter(keep);
  state.nm.ash = null;
}
/** The shot itself: 9 to the target, 3 to the enemies beside it and to your unit straight across. */
export function fireAsh(state: GameState, t: Unit) {
  const across = living(state, "friendly").find((f) => f.slot === t.slot);
  const beside = living(state, "enemy").filter((u) => Math.abs(u.slot - t.slot) === 1);
  deal(state, t, RULES.ashmouthDamage, "ASHMOUTH CHARGE");
  for (const s of beside) deal(state, s, RULES.ashmouthSplash, "ASHMOUTH splash");
  if (across) deal(state, across, RULES.ashmouthSplash, "ASHMOUTH blowback");
  state.threat += RULES.ashmouthThreat;
  log(state, `The whole facility hears that. Threat +${RULES.ashmouthThreat} (${state.threat}).`);
  state.nm.ash = null;
  if (threatBand(state.threat) >= 3) {
    for (const s of activeStalkers(state)) {
      if (s.state === "intercepting") continue;
      s.distance = Math.max(0, s.distance - 1);
      log(state, `Your stalker heard it. It is closer now${s.distance === 0 ? ", and will be waiting behind a door next room" : ""}.`);
    }
  }
}

// ---------- room actions on the route screen ----------

export type NmOp = "vent" | "abandon" | "reorient" | "purge";
export function nmOpBlock(state: GameState, op: NmOp): string | null {
  if (state.phase !== "route") return "only between rooms";
  if (op === "vent" || op === "abandon") return state.nm.ash ? (op === "vent" && state.scrap < 1 ? "needs 1 Scrap" : null) : "no ASHMOUTH CHARGE carried";
  if (op === "reorient") return liveEffects(state, "navigation").some((e) => e.status === "active") ? (state.scrap < 1 ? "needs 1 Scrap" : null) : "not lost";
  if (op === "purge") return transmissionActive(state) ? (state.scrap < 2 && !hasItem(state, ["toolkit"]) ? "needs 2 Scrap or a Technician's Toolkit" : null) : "no disturbance";
  return "unknown";
}
export function nmOp(state: GameState, op: NmOp) {
  if (nmOpBlock(state, op)) return;
  if (op === "vent") {
    state.scrap -= 1;
    state.nm.ash!.heat = Math.max(0, state.nm.ash!.heat - 2);
    log(state, `You vent ASHMOUTH. Heat ${state.nm.ash!.heat}/${RULES.ashmouthMaxHeat}.`);
  } else if (op === "abandon") {
    removeAsh(state);
    log(state, "You leave the ASHMOUTH CHARGE on a landing and walk away fast.");
  } else if (op === "reorient") {
    state.scrap -= 1;
    for (const e of liveEffects(state, "navigation")) e.status = "resolved";
    log(state, "You burn a flare and recount the landings. You know where you are.");
  } else if (op === "purge") {
    if (!hasItem(state, ["toolkit"])) state.scrap -= 2;
    for (const e of liveEffects(state, "transmission")) e.status = "resolved";
    state.intel.questionable = false;
    log(state, "You flush the comms buffers and reseat the relay. The voices are your own again.");
  }
}
/** A navigation disturbance nobody fixed: you arrive late, and the pack has grown. */
export function nmNavigationToll(state: GameState) {
  const nav = liveEffects(state, "navigation").find((e) => e.status === "active" && e.from === state.room);
  if (!nav) return;
  nav.status = "resolved";
  state.pendingSpawn.push("light");
  log(state, "You lost time on the wrong landings. By the time you find the door, another Light Mech has joined the pack.");
}

// ---------- opening a room ----------

export function nmEligible(state: GameState): NmRoomId[] {
  const sev = severityParts(state).total;
  return (Object.keys(ROOM_TIERS) as NmRoomId[]).filter((id) => !state.nm.seen.includes(id) && sev >= ROOM_TIERS[id][0] && sev <= ROOM_TIERS[id][1]);
}

/** Called from the hall when the player took the Red Hall. Returns true when a room opened. */
export function nmTryOpen(state: GameState, force?: NmRoomId): boolean {
  const ok = nmEligible(state);
  if (!force && (!ok.length || !chance(state, RULES.nmChance))) return false;
  const id = force ?? pick(state, ok);
  const sp = severityParts(state);
  const room: NmRoom = { id, severity: sp.total, band: threatBand(state.threat), threatAt: state.threat, entryMadness: sp.total, actions: 0, done: [], rolled: {}, data: {}, lines: [] };
  state.nm.seen.push(id);
  state.nm.room = room;
  generate(state, room);
  madden(state, sp.total, `Nightmare ${TIER_NAMES[sp.total]}`, 1);
  state.phase = "event";
  state.event = { id: "nightmare", data: {}, lines: [] };
  return true;
}

function generate(state: GameState, room: NmRoom) {
  const d = room.data;
  if (room.id === "choir") {
    const pool: CaptiveState[] = ["frightened", "resistant", "compromised", "hostile", "incapacitated"];
    const states: CaptiveState[] = [];
    while (states.length < 3) {
      const s = pick(state, pool.filter((x) => !states.includes(x)));
      states.push(s);
    }
    const used = new Set(state.roster.map((r) => r.name));
    // A pilot you let go, or who got away, may be here: the same person.
    const known = state.roster.filter((r) => r.custody === "free" && !state.team.pilots.some((p) => p.id === r.id) && !r.stalker);
    d.captives = states.map((st, i) => {
      const k = i === 0 ? known[0] : undefined;
      const name = k?.name ?? pick(state, FLEE_NAMES.filter((n) => !used.has(n))) ?? `Singer ${i + 1}`;
      used.add(name);
      return { id: k?.id ?? `p-c${state.uidSeq++}`, name, state: st, shown: st === "compromised" ? "frightened" : st, known: false, freed: false, existing: !!k };
    });
    d.synced = true;
  } else if (room.id === "hangar") {
    d.repairNeeded = chance(state, 0.4);
  } else if (room.id === "wrongbuddy") {
    d.buddyMode = state.buddy.status === "active" ? "active" : state.buddy.status === "wrecked" ? "wrecked" : state.buddy.status === "reassembling" ? "reassembling" : "none";
  } else if (room.id === "staircase") {
    d.climbing = room.severity >= 3 && !liveEffects(state).some((e) => ZOMBIE_TYPES.includes(e.type)) && chance(state, 0.6);
  } else if (room.id === "saferoom") {
    // Decided here, never by which choice you pick. High Threat tilts it.
    const tilt = Math.min(0.2, 0.05 * threatBand(state.threat));
    const r = roll(state);
    d.safe = r < 0.4 - tilt ? "genuine" : r < 0.65 - tilt ? "malfunction" : r < 0.85 - tilt / 2 ? "surveillance" : "trap";
    if (d.safe === "trap" || (d.safe === "surveillance" && room.severity >= 4)) d.hidden = `DF-${(100 + (state.uidSeq++ % 900)).toString(16).toUpperCase()}`;
  }
}

// ---------- option definitions ----------

interface Def {
  id: string;
  label: string;
  risk: 0 | 1 | 2;
  energy?: number;
  scrap?: number;
  reward: string;
  crisis: string; // what a Crisis can do, said plainly
  delayed?: string; // a consequence that can outlive the room
  helps?: string;
  prep?: number;
  stalker?: boolean;
  block?: string | null;
  repeat?: boolean;
  resolve: (o: NmOutcome) => void;
}

function joinCrew(state: GameState, c: NmCaptive, loyalty: number, note: string): PilotRec {
  let r = rec(state, c.id);
  if (!r) {
    r = makePilot(state, { id: c.id, name: c.name, origin: "Choir captive", level: Math.max(1, Math.min(5, 1 + Math.floor((state.room - 1) / 4))), spec: pick(state, ["Scout", "Assault", "Technician", "Recovery"]), trait: c.state === "frightened" ? "frightened" : "quiet", loyalty, custody: "free" });
    state.roster.push(r);
  }
  r.custody = "ally";
  r.loyalty = Math.max(r.loyalty, loyalty);
  if (c.state === "incapacitated") {
    r.hp = 1;
    r.rest = 1;
  }
  r.history = [`${note} (room ${state.room}).`, ...(r.history ?? [])];
  c.freed = true;
  return r;
}
function free(state: GameState, c: NmCaptive, how: "join" | "flee" | "compromised") {
  if (how === "flee") {
    c.freed = true;
    log(state, `${c.name} runs the moment the lock gives. They do not look back.`);
    const r = rec(state, c.id);
    if (r) r.custody = "free";
    return;
  }
  const r = joinCrew(state, c, how === "compromised" ? 30 : 52, "Freed from the Conductor's choir");
  if (how === "compromised") {
    r.madness = Math.min(100, r.madness + 20);
    r.history = ["Still humming the Conductor's phrases. Watch them.", ...r.history];
    log(state, `${r.name} joins you, but keeps humming something under their breath. Unwilling, and not quite themselves.`);
  } else log(state, `${r.name} joins your crew. Partially Willing, for now.`);
}

function defs(state: GameState, room: NmRoom): Def[] {
  const d = room.data;
  const en = (n: number) => canPayEnergy(state, n, true);
  const out: Def[] = [];
  const obv = bestStat(state, "observation").v;
  const skill = bestStat(state, "skill").v;
  const mental = bestStat(state, "mental").v;
  const stalkerNear = activeStalkers(state).length > 0;
  const zombieFree = !liveEffects(state).some((e) => ZOMBIE_TYPES.includes(e.type));
  const sched = (s: string) => (zombieFree ? s : `${s} (already one following you: nothing new)`);

  if (room.id === "choir") {
    const caps = d.captives!;
    const open = caps.filter((c) => !c.freed);
    const broke = (what: string) => {
      if (d.agreement && !d.broke) {
        d.broke = true;
        log(state, `CONDUCTOR: “We had an arrangement.” ${what}`);
      }
    };
    const extra = d.agreement && !d.broke ? 1 : 0;
    out.push({
      id: "negotiate",
      label: "Negotiate a Solo Performance",
      risk: 1,
      energy: 1,
      reward: "One captive released to you: you pick the steadiest.",
      crisis: "The Conductor uses the exchange to resync the ward: a transmission disturbance follows you.",
      delayed: "Transmission disturbance (2 rooms)",
      block: !open.length ? "nobody left in the compartments" : en(1) ? null : "needs 1 Energy to stabilize its failing equipment",
      resolve: (o) => {
        payEnergy(state, 1, true);
        log(state, "CONDUCTOR: “One voice. Only one. And you will steady my power supply.”");
        const c = open.find((x) => x.state === "resistant") ?? open.find((x) => x.state === "frightened") ?? open[0];
        if (o === "clean") free(state, c, c.state === "hostile" ? "flee" : "join");
        else if (o === "complication") free(state, c, "compromised");
        else {
          free(state, c, "compromised");
          schedule(state, "transmission", "negotiate", "THE CONDUCTOR", "The Conductor's voice in your radio");
          log(state, "CONDUCTOR: “Thank you. I will keep a channel open for you.”");
        }
      },
    });
    out.push({
      id: "interrupt",
      label: "Interrupt the Choir",
      risk: 1,
      energy: 1,
      prep: (skill >= 6 ? 1 : 0) + (hasItem(state, ["toolkit", "acoustic"]) ? 1 : 0) - extra,
      helps: `Skill 6+ (yours: ${skill}), a Toolkit or Acoustic Dampener${extra ? " · breaks your agreement: +1 danger" : ""}`,
      reward: "Synchronization ends: captives speak for themselves, and opening the compartments gets safer.",
      crisis: "A corrupted transmission gets out before the shutdown.",
      delayed: "Transmission disturbance (2 rooms)",
      block: !d.synced ? "already silent" : en(1) ? null : "needs 1 Energy for a controlled shutdown",
      resolve: (o) => {
        payEnergy(state, 1, true);
        broke("The ceiling voice sounds hurt.");
        d.synced = false;
        for (const c of caps) if (c.state === "compromised") {
          c.state = "resistant";
          c.shown = "resistant";
        }
        log(state, "The waveforms flatten. Three people start talking at once, out of time with each other. Good.");
        if (o === "complication") log(state, "The shutdown trips the ward's lighting bus too. It stays dark behind you. (No effect on you: the next room is unaffected.)");
        if (o === "crisis") schedule(state, "transmission", "interrupt", "THE CONDUCTOR", "A burst got out before the shutdown");
      },
    });
    const isolator = hasItem(state, ["isolator", "monitor"]);
    out.push({
      id: "isolate",
      label: "Isolate the Conductor's Signal",
      risk: 0,
      prep: -extra,
      helps: "Needs a Local Signal Isolator or Communication Monitor (a real comms device)",
      reward: "The Conductor can never reach your radio again this run. Ends any disturbance it already caused.",
      crisis: "A surviving channel carries a distorted transmission into the next room.",
      delayed: "Transmission disturbance (2 rooms)",
      block: !isolator ? "needs a Local Signal Isolator or Communication Monitor" : state.nm.isolated ? "already isolated" : null,
      resolve: (o) => {
        broke("It says nothing else. The screens go flat.");
        if (o === "crisis") {
          schedule(state, "transmission", "isolate", "THE CONDUCTOR", "A surviving channel");
          log(state, "You cut three paths. The fourth one was the real one.");
          return;
        }
        state.nm.isolated = true;
        d.synced = false;
        for (const e of liveEffects(state, "transmission")) e.status = "resolved";
        if (o === "complication") {
          const it = state.items.find((x) => x.id === "isolator" || x.id === "monitor");
          if (it) {
            state.items = state.items.filter((x) => x.uid !== it.uid);
            log(state, "Partial isolation: you had to wire the device in and leave it there.");
          }
        }
        log(state, "SIGNAL ISOLATED. The Conductor's face holds one expression, then the screens go dark.");
      },
    });
    out.push({
      id: "question",
      label: "Question a captive",
      risk: 0,
      prep: (obv >= 5 ? 1 : 0) + (mental >= 6 ? 1 : 0),
      helps: `Observation 5+ (yours: ${obv}) spots who is answering for themselves; Mental 6+ (yours: ${mental}) keeps the voice out of your head`,
      reward: "Each captive's real state, so you know who to trust. Plus what they know about the next room.",
      crisis: "The Conductor answers in their voice: one state shown is a lie, and +1 Madness. A second question finds it.",
      repeat: !!d.misled,
      block: !open.length ? "nobody left to ask" : room.done.includes("question") && !d.misled ? "you already know what they know" : null,
      resolve: (o) => {
        if (d.misled) {
          const c = caps.find((x) => x.id === d.misled)!;
          c.shown = c.state;
          c.known = true;
          d.misled = undefined;
          log(state, `Second time, ${c.name} answers half a second earlier than the voice does. That one was the Conductor.`);
          return;
        }
        if (o === "clean") {
          for (const c of caps) {
            c.shown = c.state;
            c.known = true;
          }
          state.revealNext = true;
          log(state, "The resistant one whispers, out of time with the others: who is really in there, and what is waiting next door.");
        } else if (o === "complication") {
          const c = open[0];
          c.shown = c.state;
          c.known = true;
          log(state, `${c.name} gets one true sentence out before the choir swallows the rest.`);
        } else {
          const c = open.find((x) => x.state === "hostile" || x.state === "compromised") ?? open[0];
          c.shown = "resistant";
          c.known = true;
          d.misled = c.id;
          madden(state, 1, "The voice used their mouth");
          log(state, `${c.name} says they are resisting. The answer arrives a half-second late.`);
        }
      },
    });
    out.push({
      id: "open",
      label: "Open the Compartments",
      risk: d.synced ? 2 : 1,
      prep: -extra,
      reward: "Everyone out. Frightened, resistant and incapacitated captives join your crew; compromised ones join compromised; hostile ones run.",
      crisis: "Coordinated breakout: the ward's recovery unit follows you into this room's fight.",
      delayed: "A Level 2 Mech joins this room's fight",
      block: !open.length ? "already open" : null,
      resolve: (o) => {
        broke("“You have ruined the arrangement.”");
        const panic = o !== "clean" ? open.find((x) => x.state === "frightened") : undefined;
        for (const c of open) {
          if (c === panic) {
            free(state, c, "flee");
            continue;
          }
          if (c.state === "hostile") {
            free(state, c, "flee");
            if (state.scrap > 0) {
              state.scrap -= 1;
              log(state, `${c.name} grabs 1 Scrap off the rig on the way out.`);
            }
          } else if (c.state === "compromised") free(state, c, "compromised");
          else free(state, c, "join");
        }
        if (o === "crisis") {
          state.pendingSpawn.push("lvl2");
          log(state, "Something heavy unfolds from the ward's ceiling rails and follows the noise.");
        }
      },
    });
    out.push({
      id: "accept",
      label: "Accept the Conductor's Offer",
      risk: room.severity >= 3 ? 1 : 0,
      reward: "In return for leaving the arrangement alone: supply authorization (+3 Scrap), the next room's contents, a Nightmare card, and whatever it knows about your stalker.",
      crisis: room.severity >= 3 ? "Its voice comes with you: transmission disturbance, and the captives stay compromised." : "+1 Madness.",
      delayed: room.severity >= 3 ? "Transmission disturbance (2 rooms)" : undefined,
      stalker: stalkerNear,
      block: d.agreement ? "already agreed" : null,
      resolve: (o) => {
        d.agreement = true;
        addScrap(state, 3, "Supply authorization");
        state.revealNext = true;
        addCard(state, pick(state, ["REDMOUTH", "REFLEX", "RECORDER"] as const));
        log(state, "CONDUCTOR: “A gift for the audience. Please don't disturb the arrangement.”");
        for (const s of activeStalkers(state)) log(state, `CONDUCTOR: “Your ${label(s.kind)} is ${s.distance <= 0 ? "waiting behind a door" : `${s.distance} room${s.distance > 1 ? "s" : ""} away`}. It hums, you know.”`);
        if (o === "complication") madden(state, 1, "The arrangement gets into your head");
        if (o === "crisis") {
          if (room.severity >= 3) schedule(state, "transmission", "accept", "THE CONDUCTOR", "The Conductor came with you");
          else madden(state, 1, "The arrangement gets into your head");
        }
      },
    });
  }

  if (room.id === "hangar") {
    const owned = state.nm.casketOwned || !!d.casketUid;
    const pilot = state.roster.find((r) => (r.custody === "ally" || (r.custody === "captive" && band(r.loyalty) >= 3)) && r.away <= 0 && r.hp > 0 && !r.assignment && (r.rest ?? 0) <= 0);
    out.push({
      id: "inspect",
      label: "Inspect the Reactor",
      risk: 0,
      prep: Math.max(obv, skill) >= 7 ? 1 : 0,
      helps: `Observation or Skill 5+ needed (yours: ${Math.max(obv, skill)}); 7+ makes it safer`,
      reward: "Know the reactor: every later choice here is one step safer.",
      crisis: "An abnormal pulse: 2 damage to Jubey.",
      block: Math.max(obv, skill) < 5 ? "needs Observation or Skill 5+ in your crew" : d.casketGone ? "nothing left to inspect" : null,
      resolve: (o) => {
        d.inspected = true;
        if (o === "complication") {
          d.repairNeeded = true;
          log(state, "The reactor needs a repair before it can be trusted: powering it up will cost 1 more Scrap.");
        } else if (o === "crisis") {
          const j = jubey(state);
          if (j) deal(state, j, 2, "Reactor pulse", { noLeech: true });
        } else log(state, "You find the fault in the reactor's rhythm and mark it.");
      },
    });
    const powerScrap = 2 + (d.repairNeeded ? 1 : 0);
    out.push({
      id: "power",
      label: "Power It Up",
      risk: 1,
      energy: 1,
      scrap: powerScrap,
      prep: d.inspected ? 1 : 0,
      helps: d.inspected ? "Reactor inspected: one step safer" : "Inspect the reactor first to make this safer",
      reward: `CASKET-13 joins you: ${UNITS.casket.hp} HP, ${UNITS.casket.atk} damage, every third blow splashes. +${RULES.casketMadness} Madness each fight; its reactor heats unless a pilot supervises it.`,
      crisis: "Hostile autonomous defense: CASKET-13 fights you in this room's fight." + (room.severity >= 4 ? " A second damaged chassis wakes and follows you." : ""),
      delayed: room.severity >= 4 ? sched("The Dead Frame in a later fight") : "CASKET-13 in this room's fight",
      block: owned ? "already awake" : d.casketGone ? "stripped" : state.scrap < powerScrap ? `needs ${powerScrap} Scrap` : !en(1) ? "needs 1 Energy" : freeFriendSlot(state) < 0 ? "no room on your line" : null,
      resolve: (o) => {
        state.scrap -= powerScrap;
        payEnergy(state, 1, true);
        if (o === "crisis") {
          d.casketGone = true;
          state.pendingSpawn.push("casket");
          log(state, "CASKET-13's head turns. The screen says HOSTILE DEFENSE STATE. It drops out of the harness toward you.");
          if (room.severity >= 4) schedule(state, "zombie", "power", "CASKET-13 (second chassis)", "A second chassis in the hangar woke too");
          return;
        }
        const u = spawn(state, "casket", "friendly", freeFriendSlot(state), { heat: o === "complication" ? 2 : 0, note: "the Mourning Engine" });
        d.casketUid = u.uid;
        state.nm.casketOwned = true;
        log(state, o === "complication" ? "CASKET-13 wakes with its reactor already running hot (heat 2)." : "CASKET-13 lowers itself out of the harness and waits behind Jubey.");
      },
    });
    out.push({
      id: "assign",
      label: "Assign a Pilot",
      risk: 1,
      prep: (pilot && statOf(pilot, "mental") >= 6 ? 1 : 0) + (d.inspected ? 1 : 0),
      helps: pilot ? `${pilot.name} (Mental ${statOf(pilot, "mental")}): Mental 6+ is safer. A pilot keeps its reactor from heating and halves its Madness.` : "Needs a free crew pilot, or a Cooperative captive",
      reward: "A supervised CASKET-13: steady reactor, less Madness.",
      crisis: "Uncontrolled: at the next fight it strikes one of your own units once before it settles.",
      block: !d.casketUid || !state.units.some((u) => u.uid === d.casketUid) ? "power it up first" : !pilot ? "no free pilot who would climb in" : assignBlock(state, pilot, d.casketUid)?.reason ?? null,
      resolve: (o) => {
        const u = state.units.find((x) => x.uid === d.casketUid)!;
        assign(state, pilot!, u.uid);
        if (o === "complication") {
          pilot!.madness = Math.min(100, pilot!.madness + 15);
          log(state, `${pilot!.name} comes out of the synchronization shaking: +15% Madness.`);
        } else if (o === "crisis") {
          u.rampage = true;
          log(state, `${pilot!.name} cannot hold it. CASKET-13 will lash out once at the start of the next fight.`);
        } else log(state, `${pilot!.name} settles into the cockpit. The second-occupant line stays dark.`);
      },
    });
    out.push({
      id: "strip",
      label: "Strip Its Components",
      risk: 1,
      prep: d.inspected ? 1 : 0,
      reward: "+4 Scrap and a Cockpit Part. No CASKET-13.",
      crisis: "Defense systems: a damaged CASKET-13 (8 HP) fights you in this room's fight.",
      delayed: "A damaged CASKET-13 in this room's fight",
      block: owned ? "it is yours now" : d.casketGone ? "already stripped" : null,
      resolve: (o) => {
        d.casketGone = true;
        if (o === "clean") {
          addScrap(state, 4, "CASKET-13 components");
          state.parts += 1;
          log(state, "One Cockpit Part, intact, from a cockpit that was never empty.");
        } else if (o === "complication") addScrap(state, 2, "Partial CASKET-13 salvage");
        else {
          addScrap(state, 1, "What you got before it moved");
          state.pendingSpawn.push("casket");
          state.nm.casketDamaged = true;
        }
      },
    });
  }

  if (room.id === "reliquary") {
    const carrying = !!state.nm.ash;
    const gone = d.taken || d.casketGone;
    out.push({
      id: "take",
      label: "Take It Immediately",
      risk: 2,
      prep: d.stabilized ? 2 : 0,
      helps: d.stabilized ? "Stabilized: much safer" : "Stabilize it first to make this safer",
      reward: `ASHMOUTH CHARGE: one ${RULES.ashmouthDamage}-damage shot with ${RULES.ashmouthSplash} splash that hits your unit across the lane too. +${RULES.ashmouthThreat} Threat when fired. Heat climbs every room.`,
      crisis: "Containment failure as you lift it: Jubey takes 3 and it starts at heat 3.",
      block: gone ? "nothing left" : carrying ? "you are already carrying one" : null,
      resolve: (o) => {
        d.taken = true;
        const heat = d.stabilized ? (o === "clean" ? 0 : 1) : o === "clean" ? 1 : o === "complication" ? 2 : 3;
        if (o === "crisis" && !d.stabilized) {
          const j = jubey(state);
          if (j) deal(state, j, 3, "ASHMOUTH containment", { noLeech: true });
        }
        state.nm.ash = { heat };
        addCard(state, "ASHMOUTH");
        log(state, `ASHMOUTH CHARGE loaded into the rig. Heat ${heat}/${RULES.ashmouthMaxHeat}.`);
      },
    });
    out.push({
      id: "stabilize",
      label: "Stabilize Before Taking",
      risk: 0,
      energy: skill >= 6 ? 0 : 1,
      prep: skill >= 6 ? 1 : 0,
      helps: `Skill 6+ (yours: ${skill}) does it without Energy`,
      reward: "Taking it afterwards is much safer and starts cooler.",
      crisis: "A thermal hazard: Jubey takes 2, and the chance to stabilize is lost.",
      block: gone ? "nothing left" : d.stabilized ? "done" : skill < 6 && !en(1) ? "needs 1 Energy or Skill 6+" : null,
      resolve: (o) => {
        if (skill < 6) payEnergy(state, 1, true);
        if (o === "crisis") {
          const j = jubey(state);
          if (j) deal(state, j, 2, "Thermal flare", { noLeech: true });
          log(state, "The casing flares white. You will not get a second try at this.");
          return;
        }
        d.stabilized = true;
        if (o === "complication") {
          if (state.scrap > 0) state.scrap -= 1;
          log(state, "Stabilized, at the cost of 1 Scrap in shims and coolant.");
        } else log(state, "The thing inside the ammunition compartment goes still.");
      },
    });
    out.push({
      id: "strip",
      label: "Strip Its Components",
      risk: 1,
      reward: "+3 Scrap of weapon salvage. No ASHMOUTH.",
      crisis: "Unstable ammunition ignites: Jubey takes 2, Threat +1.",
      block: gone ? "nothing left" : null,
      resolve: (o) => {
        d.casketGone = true;
        if (o === "clean") addScrap(state, 3, "ASHMOUTH components");
        else if (o === "complication") addScrap(state, 1, "Partial component recovery");
        else {
          const j = jubey(state);
          if (j) deal(state, j, 2, "Ignition", { noLeech: true });
          state.threat += 1;
        }
      },
    });
    out.push({
      id: "detonate",
      label: "Detonate in Place",
      risk: 0,
      reward: "A safe-distance detonation clears the way: every enemy in this room's fight starts 2 HP down. No weapon.",
      crisis: "The noise carries: Threat +2, and an active stalker learns where you are.",
      stalker: stalkerNear,
      block: gone ? "nothing left" : null,
      resolve: (o) => {
        d.casketGone = true;
        state.nm.blast = state.room;
        state.threat += o === "clean" ? 1 : 2;
        log(state, `The reliquary goes up behind a blast door. Threat +${o === "clean" ? 1 : 2}.`);
        if (o === "crisis")
          for (const s of activeStalkers(state)) {
            s.distance = 0;
            if (s.state !== "intercepting") s.state = "approaching";
            log(state, `Your ${label(s.kind)} heard exactly where that came from.`);
          }
      },
    });
  }

  if (room.id === "wrongbuddy") {
    const mode = d.buddyMode!;
    const idPrep = d.identified ? 1 : 0;
    out.push({
      id: "inspect",
      label: "Inspect with Observation",
      risk: 0,
      prep: obv >= 8 ? 2 : obv >= 5 ? 1 : 0,
      helps: `Observation ${obv}: 5+ and 8+ make it safer`,
      reward: "Spot the wrong joints and the late sounds: every other choice here gets one step safer.",
      crisis: "It notices you watching. +1 Madness, and the radio starts calling it the real machine.",
      delayed: "Transmission disturbance (2 rooms)",
      block: d.identified ? "done" : null,
      resolve: (o) => {
        if (o === "crisis") {
          madden(state, 1, "Its eyes moved before you did");
          schedule(state, "transmission", "inspect", "IMITATION", "The radio vouches for the imitation");
          return;
        }
        d.identified = true;
        log(state, o === "clean" ? "The faceplate is a little too wide. The joints answer late. Its ID tag repeats twice. Not Robobuddy." : "Something about the joints is wrong. You are fairly sure.");
      },
    });
    out.push({
      id: "approach",
      label: "Approach the Imitation",
      risk: 1,
      prep: idPrep,
      reward: "+2 Scrap: a gutted maintenance bot wearing a borrowed faceplate.",
      crisis: room.severity >= 4 ? "It slips away, and something bigger comes with it: the Dead Frame in a later fight." : "It slips away and follows you: it turns up in a later fight.",
      delayed: sched(room.severity >= 4 ? "The Dead Frame in a later fight" : "The imitation in a later fight"),
      block: d.dealt ? "it is gone" : null,
      resolve: (o) => {
        d.dealt = true;
        if (o === "clean") addScrap(state, 2, "Imitation parts");
        else if (o === "complication") madden(state, 2, "It made Robobuddy's noise at you from an inch away");
        else if (room.severity >= 4) schedule(state, "zombie", "approach", "DF-IMITATION", "Something bigger followed the imitation out");
        else schedule(state, "mimic", "approach", "IMITATION", "The Wrong Robobuddy followed you");
      },
    });
    out.push({
      id: "send",
      label: "Send the Real Robobuddy",
      risk: 0,
      prep: idPrep,
      reward: "Robobuddy finds the discrepancy and the imitation shuts down: +1 Scrap, nothing follows you.",
      crisis: "A short confrontation: the imitation joins this room's fight.",
      delayed: "The imitation in this room's fight",
      block: mode !== "active" || !allies(state, "robobuddy").length ? "Robobuddy is not here to send" : d.dealt ? "it is gone" : null,
      resolve: (o) => {
        d.dealt = true;
        const b = allies(state, "robobuddy")[0];
        if (o === "clean") {
          addScrap(state, 1, "The imitation's battery");
          log(state, "Robobuddy chirps the alarm pattern, then the all-clear. Its ID stays its own.");
        } else if (o === "complication") {
          if (b && b.hp > 1) b.hp -= 1;
          log(state, "Robobuddy's sensors glitch next to it. −1 HP, and it sticks close to Jubey afterwards.");
        } else {
          state.pendingSpawn.push("mimic");
          log(state, "The two machines lock eyes. One of them is lying.");
        }
      },
    });
    const wrecks = rebuildWrecks(state);
    out.push({
      id: "rebuild",
      label: "Attempt Reconstruction",
      risk: 1,
      prep: idPrep,
      reward: "The real reconstruction, at the real cost: Scrap from a real wreck. The imitation's parts are not used.",
      crisis: "The imitation tries to climb into the shell: it joins this room's fight. The rebuild still happens.",
      block: mode !== "wrecked" ? "only when the real Robobuddy is a wreck" : !wrecks.length ? "no wreck here holds the Scrap" : rebuildBlock(state, wrecks[0].id),
      resolve: (o) => {
        rebuildBuddy(state, wrecks[0].id);
        if (o === "complication") madden(state, 1, "It watched you do it");
        if (o === "crisis") state.pendingSpawn.push("mimic");
      },
    });
    out.push({
      id: "destroy",
      label: "Destroy the Imitation",
      risk: 1,
      prep: idPrep,
      reward: "Settle it now: it joins this room's fight" + " (2 HP if this goes cleanly). Its salvage is ordinary Scrap.",
      crisis: "It fights properly, and +1 Madness.",
      delayed: "The imitation in this room's fight",
      block: d.dealt ? "it is gone" : null,
      resolve: (o) => {
        d.dealt = true;
        state.pendingSpawn.push("mimic");
        if (o === "clean") state.nm.mimicHurt = state.room;
        if (o === "crisis") madden(state, 1, "It used Robobuddy's distress chirp");
      },
    });
  }

  if (room.id === "staircase") {
    const scout = state.roster.find((r) => r.custody === "ally" && r.away <= 0 && r.hp > 0 && !r.assignment);
    const scoutMachine = allies(state).find((u) => ["walker", "possum", "robobuddy"].includes(u.kind));
    out.push({
      id: "lights",
      label: "Follow the Emergency Lights",
      risk: 1,
      reward: "A legal branch, and +1 Scrap from a maintenance locker on the way.",
      crisis: "You come out next to something: an extra Light Mech in this room's fight, and your map is wrong next room.",
      delayed: "Extra enemy now; navigation disturbance next room",
      repeat: false,
      resolve: (o) => {
        if (o === "clean") addScrap(state, 1, "Maintenance locker");
        else if (o === "complication") {
          const j = jubey(state);
          if (j) deal(state, j, 1, "A missing step", { noLeech: true });
        } else {
          state.pendingSpawn.push("light");
          schedule(state, "navigation", "lights", "STAIRCASE", "Your map of the next floor is wrong");
        }
      },
    });
    out.push({
      id: "map",
      label: "Map the Staircase",
      risk: Math.max(skill, obv) >= 5 ? 0 : 1,
      prep: Math.max(skill, obv) >= 7 ? 1 : 0,
      helps: `Skill or Observation 5+ (yours: ${Math.max(skill, obv)}) makes it cautious; 7+ safer still`,
      reward: "The next room's contents, and the next Nightmare Room is one step safer.",
      crisis: "Misleading navigation: your map is wrong next room until you reorient.",
      delayed: "Navigation disturbance next room",
      resolve: (o) => {
        if (o === "crisis") {
          schedule(state, "navigation", "map", "STAIRCASE", "A map that lies");
          return;
        }
        if (o === "complication") {
          if (state.scrap > 0) state.scrap -= 1;
          log(state, "Partial mapping: 1 Scrap of marker paint and flares.");
        }
        state.revealNext = true;
        state.nm.mappedRoom = state.room + 1;
      },
    });
    out.push({
      id: "voices",
      label: "Follow the Voices",
      risk: 2,
      reward: "+3 Scrap from someone's lost kit, and a frightened pilot who wants to come with you.",
      crisis: "An anomalous machine on the landing: the Dead Frame joins this room's fight.",
      delayed: room.severity >= 4 ? "The Dead Frame now; a transmission disturbance" : "The Dead Frame in this room's fight",
      resolve: (o) => {
        if (o === "clean") {
          addScrap(state, 3, "A lost kit");
          const used = new Set(state.roster.map((r) => r.name));
          const r = makePilot(state, { id: `p-v${state.uidSeq++}`, name: pick(state, FLEE_NAMES.filter((n) => !used.has(n))) ?? "Stair-runner", origin: "Lost on the staircase", level: Math.max(1, Math.min(5, 1 + Math.floor((state.room - 1) / 4))), spec: "Scout", trait: "frightened", loyalty: 50, custody: "ally" });
          state.roster.push(r);
          log(state, `${r.name} was the voice. They have been on these stairs for a long time. They join your crew.`);
        } else if (o === "complication") {
          madden(state, 1, "The voices were yours");
          if (room.severity >= 4) schedule(state, "transmission", "voices", "STAIRCASE", "The staircase's voices in your radio");
        } else {
          state.pendingSpawn.push("deadframe");
          if (d.climbing) d.climbing = false;
        }
      },
    });
    out.push({
      id: "scout",
      label: "Use a Pilot Scout",
      risk: 1,
      prep: scout && statOf(scout, "observation") >= 5 ? 1 : 0,
      helps: scout ? `${scout.name} (Observation ${statOf(scout, "observation")}): 5+ is safer` : scoutMachine ? `Your ${label(scoutMachine.kind)} goes` : "Needs a free crew pilot or a small machine",
      reward: "Route information: the next room's contents, and which door your stalker is waiting behind.",
      crisis: "The scout meets something: the Dead Frame joins this room's fight, and the scout comes back hurt.",
      stalker: stalkerNear,
      block: !scout && !scoutMachine ? "nobody to send" : null,
      resolve: (o) => {
        const who = scout?.name ?? label(scoutMachine!.kind);
        if (o === "clean") {
          state.revealNext = true;
          for (const s of activeStalkers(state)) if (s.state === "intercepting") log(state, `${who}: “It's waiting behind the ${s.door === "risky" ? "red" : "normal"} door.”`);
          log(state, `${who} comes back with a route.`);
        } else if (o === "complication") {
          if (scout) {
            scout.away = 1;
            log(state, `${scout.name} took a wrong landing. They will be a room finding you.`);
          } else log(state, `Your ${who} comes back with nothing, rattled.`);
        } else {
          state.pendingSpawn.push("deadframe");
          if (scout) scout.hp = Math.max(1, scout.hp - 2);
          if (d.climbing) d.climbing = false;
          log(state, `${who} runs back up the stairs with something heavy behind.`);
        }
      },
    });
    if (d.climbing) {
      out.push({
        id: "ambush",
        label: "Prepare an Ambush",
        risk: 1,
        reward: "The thing climbing is a real Dead Frame. Meet it in this room's fight on your terms: it arrives 3 HP down.",
        crisis: "It reaches you first: it joins this fight with its sudden lurch.",
        delayed: "The Dead Frame in this room's fight",
        resolve: (o) => {
          d.climbing = false;
          state.pendingSpawn.push("deadframe");
          state.nm.ambush = o === "clean" ? state.room : 0;
          if (o === "crisis") state.nm.suddenNow = state.room;
        },
      });
      out.push({
        id: "obstruct",
        label: "Obstruct Its Route",
        risk: 0,
        scrap: 2,
        reward: "Wedge the landing shut. It does not follow you.",
        crisis: "It finds another way: it will turn up in a later fight.",
        delayed: sched("The Dead Frame in a later fight"),
        block: state.scrap < 2 ? "needs 2 Scrap" : null,
        resolve: (o) => {
          state.scrap -= 2;
          d.climbing = false;
          if (o === "clean") log(state, "The landing door buckles under the weight, and holds.");
          else if (o === "complication") log(state, "It holds. For now. You hear it climbing a different staircase.");
          else schedule(state, "zombie", "obstruct", "DF-STAIR", "The thing on the staircase found another way up");
        },
      });
    }
  }

  if (room.id === "saferoom") {
    const safe = d.safe!;
    const riskFor = safe === "genuine" ? 0 : 1;
    const hiddenThere = !!d.hidden && !d.hiddenGone;
    const zombie = hiddenThere ? sched(`The damaged mech (${d.hidden}) in a later fight`) : undefined;
    out.push({
      id: "rest",
      label: "Rest",
      risk: riskFor as 0 | 1,
      reward: "Jubey recovers 4 HP; your crew pilots recover 2.",
      crisis: hiddenThere ? "A hostile disturbance: the hidden mech wakes and will find you in a later fight." : "A hostile disturbance: an extra Light Mech in this room's fight.",
      delayed: zombie ?? "Extra enemy in this room's fight",
      block: d.sealed && room.rolled.seal === "complication" ? "services locked out" : room.done.includes("rest") ? "rested" : null,
      resolve: (o) => {
        const j = jubey(state);
        if (o !== "crisis" && j) repair(state, j, o === "clean" ? 4 : 2, "Rest");
        for (const r of state.roster.filter((x) => x.custody === "ally")) r.hp = Math.min(maxHp(r), r.hp + 2);
        if (o === "complication") madden(state, 1, "Someone was humming in the vents while you slept");
        if (o === "crisis") {
          if (hiddenThere) schedule(state, "zombie", "rest", d.hidden!, `The damaged mech ${d.hidden} from the safe room`);
          else state.pendingSpawn.push("light");
          log(state, "You wake to the radio, in a voice you do not know: “There are no hostile contacts in this area.”");
        }
      },
    });
    const machines = allies(state).filter((u) => u.kind !== "jubey" && u.hp < u.maxHp);
    out.push({
      id: "repair",
      label: "Repair the Army",
      risk: riskFor as 0 | 1,
      scrap: 2,
      reward: "Every damaged machine of yours back to full.",
      crisis: "A repair arm grabs the wrong part: one machine takes 2 damage.",
      block: d.sealed && room.rolled.seal === "complication" ? "services locked out" : !machines.length ? "nothing damaged" : state.scrap < 2 ? "needs 2 Scrap" : null,
      resolve: (o) => {
        state.scrap -= 2;
        for (const u of machines) {
          if (o === "clean") repair(state, u, u.maxHp - u.hp, "Safe room repair bay");
          else if (o === "complication") repair(state, u, Math.ceil((u.maxHp - u.hp) / 2), "Safe room repair bay (partial)");
        }
        if (o === "crisis" && machines[0]) deal(state, machines[0], 2, "Repair arm malfunction");
      },
    });
    out.push({
      id: "inspect",
      label: "Inspect Security",
      risk: 0,
      prep: Math.max(obv, skill) >= 6 ? 1 : 0,
      helps: `Observation or Skill 6+ (yours: ${Math.max(obv, skill)}) makes it safer`,
      reward: "The room's real condition, and anything hidden in it.",
      crisis: safe === "surveillance" ? "It notices you looking: a transmission disturbance follows you." : "A dormant detection system wakes: Threat +2.",
      delayed: safe === "surveillance" ? "Transmission disturbance (2 rooms)" : undefined,
      block: d.known === "full" ? "done" : null,
      resolve: (o) => {
        if (o === "crisis") {
          if (safe === "surveillance") schedule(state, "transmission", "inspect", "SAFE ROOM", "The safe room was listening");
          else state.threat += 2;
          return;
        }
        d.known = o === "clean" ? "full" : "partial";
        const real: Record<string, string> = {
          genuine: "GENUINE REFUGE. The inspection log is real; the last check was this morning.",
          malfunction: "EQUIPMENT MALFUNCTION. The safety system is broken, not lying. The repair bay arms are miscalibrated.",
          surveillance: "SURVEILLANCE COMPROMISE. Every camera in here is recording, and none of them are the facility's.",
          trap: "ACTIVE NIGHTMARE TRAP. The supplies are bait.",
        };
        log(state, o === "clean" ? real[safe] : safe === "genuine" ? "Nothing wrong that you can find, but you did not finish the check." : "It is not what the screen says. You could not tell exactly what.");
        if (o === "clean" && hiddenThere) log(state, `Behind the maintenance partition: a damaged mech, chassis ${d.hidden}. Its pilot-status light blinks when nobody is looking at it.`);
      },
    });
    out.push({
      id: "supplies",
      label: "Gather Supplies",
      risk: (safe === "trap" ? 2 : 1) as 1 | 2,
      reward: "+3 Scrap and a medkit for your pilots.",
      crisis: hiddenThere ? "The supplies were bait: the hidden mech will follow you into a later fight." : "The supplies were bait: Threat +2.",
      delayed: zombie,
      block: room.done.includes("supplies") ? "taken" : null,
      resolve: (o) => {
        addScrap(state, o === "clean" ? 3 : 1, "Safe room supplies");
        if (o === "clean") state.items.push(newItem(state, "medkit"));
        if (o === "complication") state.threat += 1;
        if (o === "crisis") {
          if (hiddenThere) schedule(state, "zombie", "supplies", d.hidden!, `The damaged mech ${d.hidden} from the safe room`);
          else state.threat += 2;
        }
      },
    });
    out.push({
      id: "seal",
      label: "Seal the Room",
      risk: 0,
      scrap: 1,
      reward: hiddenThere ? "Seal the maintenance partition shut too: whatever is behind it stays here." : "Nothing gets in while you use it.",
      crisis: hiddenThere ? "While securing it, the hidden mech wakes: it joins this room's fight." : "You find a serious problem: the vents are open to the stalker routes. Threat +1.",
      block: d.sealed ? "sealed" : state.scrap < 1 ? "needs 1 Scrap" : null,
      resolve: (o) => {
        state.scrap -= 1;
        d.sealed = true;
        if (o === "clean" && hiddenThere) {
          d.hiddenGone = true;
          log(state, `You weld the partition shut over ${d.hidden}. It does not come with you.`);
        } else if (o === "complication") log(state, "The seal locks out the room's services: no rest or repair now.");
        else if (o === "crisis") {
          if (hiddenThere) {
            d.hiddenGone = true;
            state.pendingSpawn.push("deadframe");
          } else state.threat += 1;
        }
      },
    });
    out.push({
      id: "neutralize",
      label: `Neutralize ${d.hidden ?? "the hidden mech"}`,
      risk: 0,
      energy: 1,
      reward: "Destroy it where it stands: it never follows you. +2 Scrap.",
      crisis: "It activates under your hands: it joins this room's fight instead.",
      block: !hiddenThere || d.known !== "full" ? "you have not found anything to neutralize" : !en(1) ? "needs 1 Energy" : null,
      resolve: (o) => {
        payEnergy(state, 1, true);
        d.hiddenGone = true;
        for (const e of liveEffects(state).filter((x) => x.origin.entity === d.hidden)) e.status = "canceled";
        if (o === "crisis") state.pendingSpawn.push("deadframe");
        else {
          addScrap(state, 2, `${d.hidden} components`);
          if (o === "complication") {
            const j = jubey(state);
            if (j) deal(state, j, 1, "A last twitch", { noLeech: true });
          }
        }
      },
    });
  }

  return out;
}

// ---------- the event screen ----------

const ATMOSPHERE: Record<number, string> = {
  1: "Faint mechanical noise. A machine nearby reacts a little too late.",
  2: "A radio repeats itself. A door you came through looks unfamiliar now.",
  3: "Something here is preparing to move. Your instruments disagree with each other.",
  4: "The power hum drops an octave. Every light in the room is the wrong colour of orange.",
};

function intro(state: GameState, room: NmRoom): string[] {
  const d = room.data;
  switch (room.id) {
    case "choir":
      return [
        "A dim containment ward. Several pilots sit in sealed compartments. Their lips move together. No sound comes out of them.",
        "A single voice speaks through the ceiling, with perfect timing and the wrong tone on every other word.",
        `Above the compartments: CHORAL SYNCHRONIZATION: ${d.synced ? "ACTIVE" : "OFF"}`,
        "CONDUCTOR: “Welcome, unexpected visitor. I have been practicing their voices.”",
        ...d.captives!.map((c) => `${c.freed ? "· (out)" : "·"} ${c.name}${c.existing ? " (you know this one)" : ""}: ${c.known ? c.shown.toUpperCase() : `looks ${c.shown}`}${d.misled === c.id ? " · the answer came half a second late" : ""}`),
      ];
    case "hangar":
      return [
        "A huge dark hangar. The whole room seems to breathe.",
        "A gigantic armored mech hangs in a repair harness. Its orange reactor pulses slowly; every pulse dims the lights.",
        "PILOT: NONE",
        "SECOND OCCUPANT: UNRESOLVED",
        d.repairNeeded && d.inspected ? "Reactor: needs a repair before it can be trusted." : d.inspected ? "Reactor: unstable, but you know its rhythm now." : "Reactor: unknown.",
      ];
    case "reliquary":
      return [
        "A sealed weapons chamber. One huge explosive launcher, its casing cracked. Something in the ammunition compartment moves as you approach.",
        "THERMAL STABILITY FAILURE",
        "DO NOT ARM NEAR OCCUPIED COCKPITS",
        d.stabilized ? "Stabilized. For now." : "The lights flicker as its temperature rises.",
      ];
    case "wrongbuddy": {
      const head = "Robobuddy's familiar mechanical sounds. A small figure comes out of the dark. Almost right: the faceplate a little too wide, the joints a fraction too late.";
      const ctx =
        d.buddyMode === "active"
          ? "It makes the greeting noise. Then the same noise comes from behind you: your Robobuddy, standing right there."
          : d.buddyMode === "wrecked"
            ? "It looks like a recovered Robobuddy. The real one is still a shell in your rig."
            : d.buddyMode === "reassembling"
              ? "It looks like Robobuddy finished early. The real one is still reassembling in your rig."
              : "You have never had a Robobuddy. It greets you as if you had.";
      return [head, ctx, d.identified ? "Identified: not Robobuddy. Its ID tag repeats twice." : "Its ID tag reads LIL ROBOBUDDY."];
    }
    case "staircase":
      return [
        "The Red Hall opens onto a staircase descending through industrial dark. You count four landings.",
        "SEVEN FLOORS REMAINING. One flight down: SEVEN FLOORS REMAINING. Behind you, a staircase that was not there before.",
        d.climbing ? "Far below, something mechanical begins climbing. It is not a sound effect: it is getting closer." : "Far below, something mechanical. Or the echo of your own rig.",
      ];
    case "saferoom": {
      const cues: Record<string, string> = {
        genuine: "The inspection log has a real date on it.",
        malfunction: "A repair arm twitches through the same motion over and over.",
        surveillance: `A repair terminal shows ${state.roster.find((r) => r.custody === "ally")?.name ?? "Jubey"}'s name before you reach it.`,
        trap: "A supply cabinet opens before you touch it. The exit light flashes an orange symbol, once.",
      };
      return [
        "A clean, warmly lit maintenance room. Working repair machines, fresh supplies, comfortable seats.",
        "SAFE ROOM VERIFIED",
        "LAST INSPECTION: UNKNOWN",
        "RADIO: “There are no hostile contacts in this area.” It repeats. Then it repeats in a different voice.",
        cues[d.safe!],
        d.hidden && !d.hiddenGone && d.known !== "full" ? "Behind a maintenance partition, a pilot-status light blinks once." : "",
      ].filter(Boolean);
    }
  }
}

function previewLine(state: GameState, room: NmRoom, def: Def): string {
  const prep = (def.prep ?? 0) + (state.nm.mappedRoom === state.room ? 1 : 0);
  const dng = danger(room.severity, room.band, def.risk, prep);
  const p = odds(dng);
  const pc = (x: number) => `${Math.round(x * 100)}%`;
  const cost = [def.energy ? `${def.energy} Energy` : "", def.scrap ? `${def.scrap} Scrap` : ""].filter(Boolean).join(" + ") || "free";
  const parts = [
    `${["Cautious", "Standard", "Reckless"][def.risk]} · ${cost}`,
    def.reward,
    `Clean ${pc(p.clean)} · Complication ${pc(p.complication)} · Crisis ${pc(p.crisis)}`,
    `Crisis: ${def.crisis}`,
  ];
  if (def.delayed) parts.push(`Can follow you: ${def.delayed}`);
  if (def.helps) parts.push(`Helps: ${def.helps}`);
  if (def.stalker) parts.push("Your active stalker may be involved");
  return parts.join(" — ");
}

export function nmView(state: GameState): EventView {
  const room = state.nm.room!;
  const sp = TIER_NAMES[room.severity];
  const lines = [
    `NIGHTMARE ${sp} · Threat ${room.threatAt} (${BAND_NAMES[room.band]}) · entry +${room.entryMadness} Madness, paid once`,
    ATMOSPHERE[room.severity],
    ...intro(state, room),
    ...room.lines,
  ];
  if (transmissionActive(state)) lines.push("SIGNAL ANOMALY: transmissions in here are unreliable. Your controls are not.");
  const o: Option[] = [];
  const full = room.actions >= RULES.nmMaxActions;
  for (const def of defs(state, room)) {
    const used = room.done.includes(def.id) && !def.repeat;
    const why = full ? "You have pushed your luck far enough in here." : used ? "Done." : def.block ?? null;
    o.push({ id: def.id, label: def.label, detail: why ?? previewLine(state, room, def), enabled: !why });
  }
  o.push({ id: "leave", label: room.id === "staircase" ? "Turn Back" : room.id === "hangar" ? "Abandon the Hangar" : "Leave", detail: leaveText(state, room), enabled: true });
  const screen = room.id === "choir" && room.data.synced && !state.nm.isolated ? { glyph: "◉ ◎ ◉\n≋≋≋≋≋", anim: "conductor", caption: "[The Conductor's screens move a fraction out of sync with each other.]", who: "The Conductor" } : undefined;
  return { title: ROOM_NAMES[room.id], lines, options: o, screen };
}

function leaveText(state: GameState, room: NmRoom): string {
  const bits = ["No refund of the entry Madness."];
  if (room.id === "staircase" && room.data.climbing) bits.push(`The thing climbing keeps climbing: ${liveEffects(state).some((e) => ZOMBIE_TYPES.includes(e.type)) ? "something is already following you, so it loses the trail" : "the Dead Frame in a later fight"}.`);
  if (room.id === "choir") bits.push(`${room.data.captives!.filter((c) => !c.freed).length} captive(s) stay with the Conductor.`);
  return bits.join(" ");
}

export function nmResolve(state: GameState, option: string, flow: Flow) {
  const room = state.nm.room;
  if (!room) return;
  if (option === "leave") {
    if (room.id === "staircase" && room.data.climbing) schedule(state, "zombie", "leave", "DF-STAIR", "The thing on the staircase", { sudden: room.severity >= 4 });
    log(state, `You leave ${ROOM_NAMES[room.id].toLowerCase()}.`);
    state.nm.room = null;
    state.event = null;
    flow.continueHall(state);
    return;
  }
  const v = nmView(state);
  if (!v.options.find((x) => x.id === option)?.enabled) return;
  const def = defs(state, room).find((x) => x.id === option)!;
  const prep = (def.prep ?? 0) + (state.nm.mappedRoom === state.room ? 1 : 0);
  const p = odds(danger(room.severity, room.band, def.risk, prep));
  // Rolled once and stored: reopening the screen never rerolls it.
  const r = roll(state);
  const outcome: NmOutcome = RULES.nmForce || (r < p.clean ? "clean" : r < p.clean + p.complication ? "complication" : "crisis");
  room.rolled[option] = outcome;
  room.done.push(option);
  room.actions += 1;
  const before = state.log.length;
  log(state, `${def.label.toUpperCase()}: ${outcome === "clean" ? "CLEAN" : outcome === "complication" ? "COMPLICATION" : "CRISIS"}.`);
  def.resolve(outcome);
  if (outcome === "crisis" && room.band >= 4) madden(state, 1, "Extreme Threat: the Nightmare leans on you harder");
  room.lines = state.log.slice(0, Math.max(1, state.log.length - before)).reverse().filter((l) => !l.startsWith("— "));
  if (jubey(state) === undefined || (jubey(state)?.hp ?? 1) <= 0) state.phase = "dead";
}

// ---------- unit tweaks made on spawn ----------

/** Called when a fight's pack is spawned, after scheduled arrivals. Ambush and blast flags from this room's choices. */
export function nmPackTweaks(state: GameState) {
  for (const u of living(state, "enemy")) {
    if (u.kind === "deadframe" && state.nm.ambush === state.room && !u.ambushed) {
      u.ambushed = true;
      u.hp = Math.max(1, u.hp - 3);
    }
    if (u.kind === "deadframe" && state.nm.suddenNow === state.room) u.sudden = true;
    if (u.kind === "mimic" && state.nm.mimicHurt === state.room) u.hp = Math.min(u.hp, 2);
    if (u.kind === "casket" && state.nm.casketDamaged) u.hp = Math.min(u.hp, 8);
  }
  if (state.nm.blast === state.room) {
    for (const u of living(state, "enemy")) deal(state, u, 2, "The reliquary blast");
    state.nm.blast = 0;
  }
  state.nm.casketDamaged = false;
}

void gainXp;
void UNITS;
