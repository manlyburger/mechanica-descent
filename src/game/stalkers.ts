// Brief 6: Threat stalkers. High Threat makes something powerful start
// hunting you through the facility. Each stalker is one persistent record:
// its level is fixed when it is made, it moves only on real room
// transitions, it waits behind a door when it gets close, and killing or
// capturing it for good takes Threat down by its level plus how far above the
// room it was. Generic stalkers are never R-8 pilots.

import { RULES, UNITS, label, type UnitKind } from "./data";
import { chance, freeEnemySlot, log, pick, roll, spawn } from "./core";
import { makeGear, stalkerGear, depthGear } from "./gear";
import { makePilot, newItem, rec } from "./pilots";
import type { GameState, Stalker, Unit } from "./state";
import { setPilot } from "./team";

export const STALKER_KINDS: UnitKind[] = ["hunter", "tracker", "predator", "nightmare"];
const PILOTED_STALKERS: UnitKind[] = ["hunter", "tracker", "predator"];
const STALKER_NAMES = ["Harrow", "Coil", "Vane", "Ostrander", "Grist", "Mercer", "Thale", "Dunmore"];

export function active(state: GameState): Stalker[] {
  return state.stalkers.filter((s) => s.state !== "defeated");
}
export function stalker(state: GameState, id: string | undefined): Stalker | undefined {
  return state.stalkers.find((s) => s.id === id);
}

// ---------- difficulty ----------

/** The level an ordinary enemy in this room counts as: one step every three rooms. */
export function expectedLevel(room: number): number {
  return 1 + Math.floor((Math.max(1, room) - 1) / 3);
}
export function threatBonus(threat: number): number {
  let b = 0;
  for (const [t, l] of RULES.stalkerLevelBonus) if (threat >= t) b = l;
  return b;
}
/** Difficulty rating, in level units: its level plus one per equipment card. */
export function rating(s: Pick<Stalker, "level" | "gear">): number {
  return s.level + s.gear.length;
}
export function reductionFor(state: GameState, s: Stalker): { level: number; bonus: number; total: number } {
  const bonus = Math.max(0, rating(s) - expectedLevel(state.room));
  return { level: s.level, bonus, total: s.level + bonus };
}
export function stalkerStats(kind: UnitKind, level: number): { hp: number; atk: number } {
  const base = UNITS[kind];
  return { hp: base.hp + RULES.stalkerHpPerLevel * (level - 1), atk: base.atk + Math.floor((level - 1) / 2) };
}

// ---------- creation ----------

function chooseKind(state: GameState): UnitKind {
  const machines = state.units.filter((u) => u.side === "friendly" && u.kind !== "jubey" && u.hp > 0).length;
  const w: [UnitKind, number][] = [
    ["hunter", 3],
    ["tracker", 2],
    ["predator", machines >= 2 ? 3 : 1],
    ["nightmare", state.madness >= 4 ? 3 : 1],
  ];
  const total = w.reduce((n, x) => n + x[1], 0);
  let r = roll(state) * total;
  for (const [k, n] of w) if ((r -= n) < 0) return k;
  return "hunter";
}

export function createStalker(state: GameState, kind?: UnitKind): Stalker {
  const k = kind ?? chooseKind(state);
  const level = expectedLevel(state.room) + threatBonus(state.threat);
  const n = Math.max(1, depthGear(state.room).max);
  const id = `s${state.uidSeq++}`;
  const s: Stalker = {
    id,
    kind: k,
    level,
    rating: 0,
    spawnedAt: state.room,
    state: "hunting",
    distance: RULES.stalkerStartDistance,
    door: "",
    gear: stalkerGear(state, k, n),
    seen: false,
    fought: false,
    refits: 0,
    lastSnippet: -1,
    aftermath: false,
    frameDown: false,
    misses: 0,
  };
  s.rating = rating(s);
  if (PILOTED_STALKERS.includes(k)) {
    const used = new Set(state.roster.map((r) => r.name));
    const names = STALKER_NAMES.filter((x) => !used.has(x));
    const r = makePilot(state, {
      id: `p-s${state.uidSeq++}`,
      name: names.length ? pick(state, names) : `Hunter ${state.stalkers.length + 1}`,
      origin: "Facility hunter",
      level: Math.min(5, level),
      spec: k === "tracker" ? "Scout" : k === "predator" ? "Recovery" : "Assault",
      trait: pick(state, ["stubborn", "overconfident", "defiant"]),
      loyalty: 5 + Math.floor(roll(state) * 16),
      custody: "free",
    });
    r.stalker = id;
    r.eligible = k;
    r.slots[0] = newItem(state, k === "tracker" ? "scanner" : "heavysidearm");
    r.history = [`Began hunting you in room ${state.room}.`];
    state.roster.push(r);
    s.pilot = r.id;
  }
  state.stalkers.push(s);
  log(state, `Threat ${state.threat}: something has started hunting you.`);
  return s;
}

// ---------- movement, on real room transitions only ----------

function chooseDoor(state: GameState, s: Stalker, lastRisky: boolean): "normal" | "risky" {
  // The Recon Stalker reads your habits; the rest guess.
  if (s.kind === "tracker" && chance(state, 0.75)) return lastRisky ? "risky" : "normal";
  return chance(state, 0.5) ? "risky" : "normal";
}

function move(state: GameState, s: Stalker, lastRisky: boolean) {
  if (s.state === "engaged") s.state = "hunting"; // a fight that resolved nothing
  if (s.state === "intercepting") {
    // You took the other door. It tries again.
    s.door = chooseDoor(state, s, lastRisky);
    return;
  }
  const step = state.threat >= 9 ? 2 : 1;
  s.distance = Math.max(0, s.distance - step);
  if (s.distance <= 0) {
    s.state = "intercepting";
    s.door = chooseDoor(state, s, lastRisky);
  } else s.state = s.distance <= 2 ? "approaching" : "hunting";
}

/** Runs at every room start, after the room counter moves. */
export function stalkersRoomStart(state: GameState, lastRisky: boolean) {
  state.pendingStalker = null;
  resolveStalkers(state);
  for (const s of active(state)) move(state, s, lastRisky);
  const fresh = active(state).length < RULES.stalkerMax && state.threat >= RULES.stalkerThreat ? createStalker(state) : undefined;
  state.routeSnippets = snippets(state, fresh);
  for (const s of state.stalkers) if (s.state === "defeated") s.aftermath = false;
}

/** The player picked a path: if the stalker is waiting behind that door, it joins the fight. */
export function onPickPath(state: GameState, risky: boolean) {
  for (const s of active(state)) {
    if (s.state !== "intercepting") continue;
    if ((s.door === "risky") === risky) {
      state.pendingStalker = s.id;
      return;
    }
    s.misses += 1;
  }
}

// ---------- the fight ----------

export function spawnStalker(state: GameState, s: Stalker): Unit | undefined {
  const slot = freeEnemySlot(state);
  if (slot < 0) return undefined;
  const { hp, atk } = stalkerStats(s.kind, s.level);
  const u = spawn(state, s.kind, "enemy", slot, {
    hp,
    maxHp: hp,
    atk,
    pilot: s.pilot,
    stalkerId: s.id,
    gear: s.gear.map((g) => makeGear(state, g)),
    gearRolled: true,
    note: `level ${s.level} stalker${s.refits ? ", refitted" : ""}`,
  });
  s.state = "engaged";
  s.seen = true;
  s.fought = true;
  s.frameDown = false;
  log(state, `STALKER: ${label(s.kind)}, level ${s.level}, steps out of the dark into column ${slot + 1}.`);
  return u;
}

/** Its machine went down. A pilot may still punch out: that is not the end of it. */
export function onStalkerKilled(state: GameState, u: Unit) {
  const s = stalker(state, u.stalkerId);
  if (!s) return;
  s.frameDown = true;
  if (!s.pilot) return;
  const slot = freeEnemySlot(state);
  if (chance(state, RULES.stalkerEject)) {
    spawn(state, "capsule", "enemy", slot >= 0 ? slot : u.slot, { pilot: s.pilot, role: s.kind, hp: RULES.capsuleHp, maxHp: RULES.capsuleHp, exitIn: 1, note: "the stalker's cockpit" });
    log(state, `The ${label(s.kind)}'s cockpit blows clear. Its pilot is still in this.`);
  } else {
    log(state, `The ${label(s.kind)}'s cockpit never fires.`);
    setPilot(state, s.pilot, "dead");
  }
}

/** Settles every engaged stalker whose fight is over. Safe to call more than once. */
export function resolveStalkers(state: GameState) {
  for (const s of state.stalkers) {
    if (s.state !== "engaged") continue;
    if (state.units.some((u) => u.stalkerId === s.id && u.hp > 0 && u.side === "enemy")) continue;
    if (s.pilot && state.units.some((u) => u.kind === "capsule" && u.pilot === s.pilot && u.hp > 0)) continue;
    if (s.pilot && state.pods.some((p) => p.pilot === s.pilot && !p.resolved)) continue;
    if (!s.pilot) {
      if (s.frameDown) defeat(state, s, "destroyed");
      else s.state = "hunting";
      continue;
    }
    const r = rec(state, s.pilot);
    if (!r || r.custody === "dead") defeat(state, s, "pilot killed");
    else if (r.custody === "captive") defeat(state, s, "pilot captured");
    else if (r.custody === "ally") defeat(state, s, "pilot recruited");
    else if (s.frameDown) {
      s.state = "hunting";
      s.distance = RULES.stalkerReturnDistance;
      s.refits += 1;
      log(state, `${r.name} got away. The stalking threat is unresolved: they will be back in another frame.`);
    } else s.state = "hunting";
  }
}

export function defeat(state: GameState, s: Stalker, how: string) {
  if (s.state === "defeated") return;
  s.state = "defeated";
  const red = reductionFor(state, s);
  const before = state.threat;
  state.threat = Math.max(0, before - red.total);
  s.reduction = red.total;
  s.aftermath = true;
  const lines = [`${label(s.kind)}: ${how}.`, `Enemy level: ${red.level}`, `Room difficulty bonus: +${red.bonus}`, `Threat reduced: ${red.total} (${before} → ${state.threat})`];
  state.notices.push({ title: "STALKING THREAT ELIMINATED", lines });
  log(state, `STALKING THREAT ELIMINATED. ${lines.join(" · ")}`);
  const r = rec(state, s.pilot);
  if (r) r.stalker = undefined;
}

// ---------- orange snippets ----------

export const POOLS: Record<string, string[]> = {
  signs: ["Facility security traffic is climbing. Something may answer it.", "Somewhere below, a maintenance bay powers up a frame nobody ordered.", "Your Threat is loud enough to carry through the vents."],
  hunting: ["Heavy machinery grinds somewhere beyond the next junction.", "Orange warning lights flicker in a corridor you haven't entered.", "Something large is searching the maintenance levels."],
  approaching: ["A damaged security door buckles inward somewhere ahead.", "The distant footsteps stop when you approach the junction.", "A hostile signal moves across the facility map."],
  intercepting: ["A towering silhouette crosses the far end of the passage.", "The corridor shakes under heavy mechanical steps.", "Something is waiting beyond one of these doors."],
  returning: ["A hostile signal comes back online, further off than before.", "Somewhere a fresh frame is being bolted together in a hurry."],
  aftermath: ["The heavy footsteps no longer echo through the lower levels.", "A hostile signal vanishes from the facility network.", "For the first time in several rooms, the machinery is quiet."],
  nightmare: ["The lights in the corridor ahead all go out at once. The wrong ones come back on.", "Your instruments read a heartbeat in the walls for half a second."],
  predator: ["Something is dragging wreckage away from the rooms behind you.", "You pass a stripped frame. The cuts are fresh, and not yours."],
  tracker: ["A recon ping brushes the rig and moves on.", "Your rear camera catches a lens catching the light."],
};

function line(state: GameState, s: Stalker | undefined, key: string): string {
  const pool = [...POOLS[key], ...(s && key !== "aftermath" && POOLS[s.kind] ? POOLS[s.kind] : [])];
  const choices = pool.map((_, i) => i).filter((i) => !s || i !== s.lastSnippet);
  const i = choices[Math.floor(roll(state) * choices.length)];
  if (s) s.lastSnippet = i;
  return pool[i];
}

/** Text for the route screen, true to the tracked state right now. */
export function snippets(state: GameState, fresh?: Stalker): string[] {
  const out: string[] = [];
  for (const s of state.stalkers) {
    if (s.state === "defeated") {
      if (s.aftermath) out.push(line(state, s, "aftermath"));
      continue;
    }
    if (s === fresh) out.push(line(state, s, "hunting"));
    else if (s.refits > 0 && s.distance === RULES.stalkerReturnDistance && s.state === "hunting") out.push(line(state, s, "returning"));
    else out.push(line(state, s, s.state === "intercepting" ? "intercepting" : s.state === "approaching" ? "approaching" : "hunting"));
  }
  if (!out.length && state.threat >= RULES.stalkerSigns && !active(state).length) out.push(line(state, undefined, "signs"));
  return out;
}
