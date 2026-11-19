// Relay Section R-8: one persistent enemy team. Pilots have stable ids and one
// status each; everything else (who can spawn, who can speak, what Bishop can
// order, whether the pursuit is over) is derived from those statuses.

import { RULES, UNITS, label, type UnitKind } from "./data";
import { chance, living, log, roll } from "./core";
import type { GameState, Pilot, PilotStatus, Unit } from "./state";
import { CALLSIGN, PILOT_ID, RADIO, type Role } from "./team-text";

export const ROLES: Role[] = ["needleback", "latchback", "widow", "kilnheart", "bishop"];

export function pilot(state: GameState, id: string | undefined): Pilot | undefined {
  return state.team.pilots.find((p) => p.id === id);
}
export function pilotByRole(state: GameState, role: Role): Pilot {
  return state.team.pilots.find((p) => p.id === PILOT_ID[role])!;
}
export function pursuing(state: GameState): boolean {
  return state.team.pursuit === "active" || state.team.pursuit === "disrupted";
}
/** A pilot who can still take part in the pursuit, now or later. */
function atLarge(p: Pilot): boolean {
  return p.status === "active" || p.status === "escaped" || p.status === "recovered";
}
/** On the field right now: in a mech, or in a capsule that has not left. */
export function fielded(state: GameState, role: Role): Unit | undefined {
  return living(state, "enemy").find((u) => u.pilot === PILOT_ID[role]);
}
/** Can this pilot transmit? Captured and dead pilots never speak again. */
export function canSpeak(state: GameState, role: Role): boolean {
  const p = pilotByRole(state, role);
  return p.status !== "captured" && p.status !== "dead" && p.status !== "withdrawn";
}
export function bishopCommanding(state: GameState): boolean {
  return pursuing(state) && atLarge(pilotByRole(state, "bishop"));
}

/** 3 Coordinated, 2 Disrupted, 1 Fragmented, 0 Broken. */
export function coordination(state: GameState): number {
  const t = state.team;
  if (!pursuing(state)) return 0;
  let c = 3;
  const lost = t.pilots.filter((p) => !atLarge(p)).length;
  if (lost >= 2 || !atLarge(pilotByRole(state, "widow"))) c = 2;
  if (t.networkCut) c -= 2;
  if (!bishopCommanding(state)) c = Math.min(c, 1);
  if (t.pilots.filter(atLarge).length <= 1) c = Math.min(c, 1);
  return Math.max(0, c);
}
export const COORD_NAMES = ["Broken", "Fragmented", "Disrupted", "Coordinated"];
export function recoveryUp(state: GameState): boolean {
  return pursuing(state) && atLarge(pilotByRole(state, "widow"));
}

/** Plays a radio exchange once. Lines from pilots who cannot transmit are dropped. */
export function radio(state: GameState, key: string) {
  const t = state.team;
  if (t.said.includes(key) || !RADIO[key]) return;
  t.said.push(key);
  for (const [who, line] of RADIO[key]) {
    if (who !== "system" && !canSpeak(state, who)) continue;
    log(state, `${CALLSIGN[who]}: “${line}”`);
  }
}
export function say(state: GameState, role: Role, line: string) {
  if (canSpeak(state, role)) log(state, `${CALLSIGN[role]}: “${line}”`);
}

function endPursuit(state: GameState, how: "withdrawn" | "broken" | "commanderCaptured", text: string) {
  const t = state.team;
  if (!pursuing(state) && t.pursuit !== "dormant") return;
  t.pursuit = how;
  t.ending = text;
  state.pendingTeam = [];
  for (const p of t.pilots) {
    p.returnsIn = undefined;
    if (how === "withdrawn" && atLarge(p)) p.status = "withdrawn";
  }
  log(state, `RELAY SECTION R-8: ${text}`);
}
export function withdraw(state: GameState, text: string) {
  endPursuit(state, "withdrawn", text);
}

/** Re-derives the pursuit state after any pilot change. */
export function evaluate(state: GameState) {
  const t = state.team;
  if (!pursuing(state)) return;
  const bishop = pilotByRole(state, "bishop");
  const left = t.pilots.filter(atLarge).length;
  if (bishop.status === "captured") return endPursuit(state, "commanderCaptured", "the commander is in your custody. Nobody is coordinating the hunt.");
  if (left === 0) return endPursuit(state, "broken", "there is nobody left to send.");
  if (!atLarge(bishop) && left <= 1) return endPursuit(state, "broken", "no commander and one pilot on their own. The section stops being a section.");
  if (coordination(state) === 0) return endPursuit(state, "broken", "no command, no network. Whoever is left goes home.");
  t.pursuit = coordination(state) >= 3 ? "active" : "disrupted";
}

/** The one place a pilot's status changes. Applies the bounded, one-time consequences. */
export function setPilot(state: GameState, id: string | undefined, status: PilotStatus, how = "") {
  const p = pilot(state, id);
  const t = state.team;
  if (!p || p.status === status) return;
  const role = p.role as Role;
  const was = p.status;
  p.status = status;
  p.returnsIn = undefined;
  const name = CALLSIGN[role];
  switch (status) {
    case "escaped":
    case "recovered": {
      log(state, `${name}'s pilot ${status === "recovered" ? "is hauled clear by the Widow" : "gets away"}${how ? ` (${how})` : ""}.`);
      if (!pursuing(state)) break;
      if (p.replaced) {
        p.status = "withdrawn";
        log(state, `${name}'s pilot has already burned one replacement frame. They are out of this hunt.`);
        break;
      }
      const ok = status === "recovered" || recoveryUp(state) || chance(state, RULES.returnWithoutRecovery);
      if (!ok) {
        radio(state, "widow-lost");
        p.status = "withdrawn";
        log(state, `With no recovery, ${name}'s pilot walks out on foot and does not come back.`);
        break;
      }
      p.returnsIn = 1 + Math.floor(roll(state) * RULES.returnWindow);
      t.pressure += 1;
      state.threat += 1;
      log(state, `They will find another frame. R-8 pursuit pressure rises. Threat ${state.threat}.`);
      if (role === "needleback") t.knowsPlayer = true;
      break;
    }
    case "captured":
      t.leverage += role === "bishop" ? 2 : 1;
      t.pressure = Math.max(0, t.pressure - 1);
      state.threat = Math.max(0, state.threat - 1);
      log(state, `${name}'s pilot is your prisoner. That one is not coming back in a new frame. Threat ${state.threat}.`);
      if (role === "latchback") radio(state, "latch-captured");
      if (role === "widow") {
        t.leverage += 1;
        log(state, "R-8 has no recovery specialist now. Escaping pilots are on their own.");
      }
      break;
    case "dead":
      log(state, `${name}'s pilot does not get out.`);
      if (role === "bishop") radio(state, "bishop-down");
      if (role === "widow") {
        t.leverage += 1;
        log(state, "R-8 has no recovery specialist now.");
      }
      break;
    case "active":
      if (was === "captured") log(state, `${name}'s pilot is loose and back on the section's net.`);
      break;
    default:
      break;
  }
  evaluate(state);
}

// ---------- scheduling ----------

function chassisFor(state: GameState, p: Pilot): UnitKind {
  // The Kilnheart pilot does not get a second reactor frame.
  if (p.role === "kilnheart") return state.room >= 3 ? "lvl2" : "latchback";
  return p.role as UnitKind;
}

/**
 * Called on entering a room. Queues returning pilots (one replacement each,
 * at most RULES.teamBonusMax per room) and reports which authored episode,
 * if any, is due. Never spawns a captured, dead or withdrawn pilot.
 */
export function enterRoom(state: GameState): number {
  const t = state.team;
  state.pendingTeam = [];
  if (t.pursuit !== "dormant" && !pursuing(state)) return 0;
  if (state.room < t.truceUntil) return 0;
  for (const p of t.pilots) {
    if (p.returnsIn === undefined || !atLarge(p)) continue;
    // Bishop's pod is still in the air: the hunt for it comes before any replacement frame.
    if (p.id === PILOT_ID.bishop && t.podEscaped) continue;
    p.returnsIn -= 1;
    if (p.returnsIn > 0 || state.pendingTeam.length >= RULES.teamBonusMax) {
      p.returnsIn = Math.max(1, p.returnsIn);
      continue;
    }
    p.returnsIn = undefined;
    p.replaced = true;
    p.status = "active";
    state.pendingTeam.push({ kind: chassisFor(state, p), pilot: p.id, replacement: true });
    log(state, `${CALLSIGN[p.role as Role]}'s pilot is back, in a replacement ${label(chassisFor(state, p))}.`);
  }
  if (state.room < t.nextAt) return 0;
  return t.episode;
}

/** Adds an R-8 mech to this room's fight if its pilot is free and not already coming. */
export function deploy(state: GameState, role: Role): boolean {
  const p = pilotByRole(state, role);
  if (p.status !== "active" || p.returnsIn !== undefined) return false;
  if (state.pendingTeam.some((x) => x.pilot === p.id) || fielded(state, role)) return false;
  state.pendingTeam.push({ kind: role, pilot: p.id });
  return true;
}

export function introduce(state: GameState) {
  const t = state.team;
  if (t.introduced) return;
  t.introduced = true;
  t.pursuit = "active";
  log(state, "These are not separate patrols. Somebody is on the radio.");
}

export function advanceEpisode(state: GameState, gap = 1) {
  const t = state.team;
  t.episode = Math.min(5, t.episode + 1);
  t.nextAt = state.room + gap;
}

export function teamSummary(state: GameState): { label: string; value: string }[] {
  const t = state.team;
  const pursuit: Record<string, string> = {
    dormant: "Not yet",
    active: "Active",
    disrupted: "Disrupted",
    withdrawn: "Withdrawal negotiated",
    broken: "Team broken",
    commanderCaptured: "Commander captured",
  };
  const b = pilotByRole(state, "bishop");
  const escaped = t.pilots.filter((p) => p.returnsIn !== undefined).length;
  return [
    { label: "Coordination", value: COORD_NAMES[coordination(state)] },
    { label: "Commander", value: b.status === "captured" ? "Captured" : b.status === "dead" ? "Lost" : atLarge(b) ? "Active" : "Withdrawn" },
    { label: "Recovery", value: recoveryUp(state) ? "Available" : "Unavailable" },
    { label: "Escaped pilots", value: String(escaped) },
    { label: "Replacement threat", value: escaped ? "Possible" : "None" },
    { label: "Pursuit", value: pursuit[t.pursuit] },
  ];
}

export function pilotRoster(state: GameState): string[] {
  return state.team.pilots.map((p) => {
    const where = fielded(state, p.role as Role);
    const status =
      p.status === "active" ? (where ? (where.kind === "capsule" ? "in an escape capsule" : `in a ${label(where.kind)}`) : "active") :
      p.status === "escaped" || p.status === "recovered" ? `regrouping${p.returnsIn ? `, back within ${p.returnsIn} room${p.returnsIn > 1 ? "s" : ""}` : ""}` :
      p.status;
    return `${CALLSIGN[p.role as Role]}: ${status}${p.replaced ? " (replacement used)" : ""}`;
  });
}

export function ejectAt(u: Unit): number {
  return UNITS[u.kind].ejectAt ?? -1;
}
