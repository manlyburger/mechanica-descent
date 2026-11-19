// Capture and containment: restraint integrity, the Clampjaw's two-step
// apprehension, Lockbands, the Containment Pod, custody after a fight, and
// Memory Tap. A Clampjaw and a Pod each hold exactly one captive (a single id,
// never a list), and a transfer moves that id atomically.

import { RULES, UNITS, hasTag, label, type UnitKind } from "./data";
import { addScrap, allies, chance, deal, disabled, freeEnemySlot, is, living, log, roll, spawn, unit } from "./core";
import type { Captive, GameState, Unit } from "./state";
import { ROLES, pilot, pilotByRole, setPilot } from "./team";
import { CALLSIGN, type Role } from "./team-text";

export interface CustodyItem {
  id: string;
  kind: UnitKind;
  pilot?: string;
  /** A person with no electronics: cannot be tapped or dismantled. */
  person: boolean;
  label: string;
  bands: number;
  by?: string; // Clampjaw that was holding it
  hp: number;
  tapped: boolean;
}

export function secured(u: Unit): boolean {
  return u.cap?.state === "secured";
}
function size(u: Unit) {
  return UNITS[u.kind].size;
}
/** Small and medium machines only. Heavy frames are ineligible, visibly, not silently. */
export function restrainable(u: Unit): boolean {
  return u.side === "enemy" && is(u, "mechanical") && (size(u) === "small" || size(u) === "medium");
}
export function whyNotRestrainable(u: Unit): string | null {
  if (u.side !== "enemy") return "not an enemy";
  if (!is(u, "mechanical")) return "not a machine";
  if (size(u) === "heavy") return "too heavy for field restraints";
  return null;
}
export function canApprehend(u: Unit): boolean {
  return restrainable(u) && !u.cap && (u.kind === "capsule" || u.hp <= RULES.captureHp || disabled(u));
}
export function bandTargets(state: GameState): Unit[] {
  return living(state, "enemy").filter((u) => restrainable(u) && (u.cap ? u.cap.bands < RULES.maxBands : disabled(u)));
}
export function integrityBand(n: number): string {
  return n > 75 ? "stable" : n > 40 ? "strained" : n > 0 ? "CRITICAL" : "broken";
}
function strong(u: Unit): boolean {
  return u.kind === "prisoner" || (size(u) === "medium" && u.hp > RULES.captureHp);
}

export function applyBand(state: GameState, u: Unit) {
  const name = label(u.kind);
  if (!u.cap) {
    u.cap = { state: "secured", integrity: Math.min(100, RULES.bandBase + RULES.bandIntegrity), bands: 1 };
    log(state, `Lockbands cinch around the disabled ${name}. SECURED (${integrityBand(u.cap.integrity)}).`);
  } else {
    const first = u.cap.bands === 0;
    u.cap.bands += 1;
    u.cap.integrity = Math.min(100, u.cap.integrity + RULES.bandIntegrity);
    if (u.cap.state === "securing") {
      u.cap.state = "secured";
      log(state, `Lockbands finish the grapple. ${name} is SECURED (${integrityBand(u.cap.integrity)}).`);
    } else log(state, first ? `Lockbands added to ${name}: restraint ${integrityBand(u.cap.integrity)}.` : `A second band: redundant restraint on ${name}. Its struggles count for half.`);
  }
  u.plan = { type: "struggle", note: "straining at the restraints" };
  if (u.pilot && is(u, "team")) log(state, "The bands hold the frame. The pilot inside is still at the controls and still on the radio.");
}

// ---------- Clampjaw Drone ----------

export function heldBy(state: GameState, clamp: Unit): Unit | undefined {
  return living(state, "enemy").find((u) => u.cap?.by === clamp.uid);
}

export function clampjawAct(state: GameState, c: Unit) {
  if (c.holding) {
    c.mood = "holding its captive";
    return;
  }
  const held = heldBy(state, c);
  if (held?.cap) {
    if (held.cap.state === "securing") {
      held.cap.state = "secured";
      held.cap.integrity = Math.max(held.cap.integrity, RULES.lockIntegrity);
      held.plan = { type: "struggle", note: "straining at the clamps" };
      c.mood = "holding";
      log(state, `Clampjaw locks. ${label(held.kind)} is SECURED (${integrityBand(held.cap.integrity)}).`);
    } else {
      held.cap.integrity = Math.min(100, held.cap.integrity + RULES.holdReinforce);
      c.mood = "holding";
      log(state, `Clampjaw re-seats its grip: restraint ${integrityBand(held.cap.integrity)}.`);
    }
    return;
  }
  const tgt = unit(state, c.apprehend);
  if (!tgt || !canApprehend(tgt)) {
    c.apprehend = undefined;
    c.mood = "waiting for an order";
    return;
  }
  c.apprehend = undefined;
  tgt.cap = { state: "securing", integrity: RULES.grappleIntegrity, bands: 0, by: c.uid };
  tgt.plan = { type: "struggle", note: "being secured" };
  c.mood = "grappling";
  log(state, `Clampjaw closes the distance and gets both clamps on the ${label(tgt.kind)}. BEING SECURED: it locks on its next action.`);
}

/** A restrained unit's whole turn. */
export function struggle(state: GameState, u: Unit) {
  const cap = u.cap;
  if (!cap) return;
  const name = label(u.kind);
  let strain = strong(u) ? RULES.strainStrong : RULES.strain;
  if (cap.bands >= 2) strain = Math.ceil(strain / 2);
  cap.integrity = Math.max(0, cap.integrity - strain);
  const clamp = unit(state, cap.by);
  if (cap.integrity <= 0) {
    u.cap = undefined;
    u.plan = undefined;
    log(state, `${name} BREAKS THE RESTRAINT.`);
    if (clamp) deal(state, clamp, 1, `${name} tearing free`, { noLeech: true });
    return;
  }
  log(state, `${name} strains: restraint ${integrityBand(cap.integrity)}${cap.integrity <= RULES.strainCritical ? ". The clamps are visibly separating" : ""}.`);
  if (clamp && cap.integrity <= RULES.strainCritical) deal(state, clamp, 1, `${name} thrashing`, { noLeech: true });
}

/** The Clampjaw is gone: bands keep the captive, bare clamps do not. */
export function clampLost(state: GameState, clampUid: string) {
  for (const u of living(state, "enemy")) {
    if (u.cap?.by !== clampUid) continue;
    if (u.cap.bands > 0) {
      u.cap.by = undefined;
      u.cap.state = "secured";
      log(state, `The clamps fall away. The Lockbands still hold the ${label(u.kind)}.`);
    } else {
      u.cap = undefined;
      u.plan = undefined;
      log(state, `With the Clampjaw gone, the ${label(u.kind)} shakes loose.`);
    }
  }
}

// ---------- captives carried between fights ----------

export function captiveOf(state: GameState, holderUid: string): Captive | undefined {
  return state.captives.find((c) => c.holder === holderUid);
}
export function podFits(kind: UnitKind, person: boolean): boolean {
  return person || kind === "capsule" || kind === "drone" || kind === "powered" || kind === "prisoner";
}
export function vacantPod(state: GameState): Unit | undefined {
  return living(state, "friendly").find((u) => u.kind === "pod" && !u.holding);
}
export function freeClampjaw(state: GameState): Unit | undefined {
  return allies(state, "clampjaw").find((u) => !u.holding);
}

export function takeCaptive(state: GameState, item: CustodyItem, holder: Unit) {
  if (holder.holding) return; // one captive, always
  const cap: Captive = { id: item.id, kind: item.kind, pilot: item.pilot, label: item.label, holder: holder.uid, bands: item.bands, tapped: item.tapped, hp: item.hp };
  state.captives.push(cap);
  holder.holding = cap.id;
  holder.occupied = 0;
  holder.podIntegrity = 100;
  log(state, `${item.label} is now held by the ${label(holder.kind)}.`);
  if (item.pilot) setPilot(state, item.pilot, "captured");
}

/** Atomic: the id leaves one holder and enters the other in one step. */
export function transferCaptive(state: GameState, from: Unit, to: Unit): boolean {
  const cap = captiveOf(state, from.uid);
  if (!cap || to.holding || to.kind !== "pod" || !podFits(cap.kind, !!cap.pilot && cap.kind !== "capsule")) return false;
  cap.holder = to.uid;
  from.holding = undefined;
  to.holding = cap.id;
  to.occupied = 0;
  to.podIntegrity = 100;
  log(state, `${cap.label} is transferred into the Containment Pod. The Clampjaw is free again.`);
  return true;
}

/** Custody ends on purpose or by failure. Pilots rejoin the hunt; machines go back to being a problem. */
export function loseCaptive(state: GameState, holderUid: string, why: string, intentional = false) {
  const cap = captiveOf(state, holderUid);
  if (!cap) return;
  state.captives = state.captives.filter((c) => c.id !== cap.id);
  const holder = state.units.find((u) => u.uid === holderUid);
  if (holder) holder.holding = undefined;
  log(state, `${cap.label} ${intentional ? "is released" : "is loose"}: ${why}.`);
  if (cap.pilot && pilot(state, cap.pilot)) {
    pilot(state, cap.pilot)!.status = "active"; // back on the section's net before the escape is scored
    setPilot(state, cap.pilot, "escaped", intentional ? "released" : "broke custody");
    return;
  }
  if (intentional || state.phase !== "player") return;
  const slot = freeEnemySlot(state);
  if (slot < 0) return;
  const u = spawn(state, cap.kind, "enemy", slot);
  u.hp = Math.max(1, Math.min(u.maxHp, cap.hp));
  if (cap.bands > 0) u.cap = { state: "secured", integrity: 30 * cap.bands, bands: cap.bands };
  log(state, `It lands in column ${slot + 1}${cap.bands ? ", still banded" : ""}.`);
}

export function dismantleCaptive(state: GameState, holderUid: string): boolean {
  const cap = captiveOf(state, holderUid);
  if (!cap || cap.pilot) return false;
  state.captives = state.captives.filter((c) => c.id !== cap.id);
  const holder = state.units.find((u) => u.uid === holderUid);
  if (holder) holder.holding = undefined;
  addScrap(state, cap.kind === "prisoner" ? RULES.prisonerScrap : RULES.dismantle[UNITS[cap.kind].size === "small" ? "small" : "medium"], `Dismantled ${cap.label}`);
  return true;
}

/** Pod power: 1 Energy every 3 occupied turns. A missed payment weakens the Pod; it does not open it. */
export function podUpkeep(state: GameState) {
  for (const pod of living(state, "friendly").filter((u) => u.kind === "pod" && u.holding)) {
    const cap = captiveOf(state, pod.uid)!;
    pod.occupied = (pod.occupied ?? 0) + 1;
    if (cap.kind === "prisoner" && chance(state, 0.25)) {
      log(state, "…! [tapping, close to the Pod controls]");
      deal(state, pod, 1, "The Prisoner", { noLeech: true });
      if (pod.hp <= 0) continue;
    }
    if (pod.occupied < RULES.podUpkeepTurns) continue;
    if (!pod.powerOff && state.energy >= 1) {
      state.energy -= 1;
      pod.occupied = 0;
      pod.podIntegrity = Math.min(100, (pod.podIntegrity ?? 100) + RULES.podLowPowerLoss);
      log(state, "Containment Pod draws 1 Energy to hold its seal.");
      continue;
    }
    pod.podIntegrity = Math.max(0, (pod.podIntegrity ?? 100) - RULES.podLowPowerLoss);
    log(state, `CONTAINMENT POD LOW POWER. Seal ${integrityBand(pod.podIntegrity)}. Restore power before it fails.`);
    if (pod.podIntegrity <= 0) loseCaptive(state, pod.uid, "the Pod's seal fails without power");
  }
}

// ---------- custody after a fight ----------

/** Everything still restrained when the shooting stops, as a to-do list. */
export function gatherCustody(state: GameState): CustodyItem[] {
  const out: CustodyItem[] = [];
  for (const u of living(state, "enemy").filter(secured)) {
    const cap = u.cap!;
    const role = (u.kind === "capsule" ? u.role : u.kind) as Role;
    const team = ROLES.includes(role) && !!u.pilot;
    const base = { bands: cap.bands, by: cap.by, hp: u.hp, tapped: !!u.note?.includes("tapped") };
    if (u.kind === "capsule") {
      out.push({ ...base, id: u.uid, kind: "capsule", pilot: u.pilot, person: false, label: team ? `${CALLSIGN[role]}'s pilot, in the capsule` : "The capsule" });
      continue;
    }
    if (team) {
      if ((u.wedge ?? 0) > 0) {
        out.push({ ...base, id: u.uid + "p", kind: "capsule", pilot: u.pilot, person: true, label: `${CALLSIGN[role]}'s pilot, wedged in the cockpit` });
      } else {
        log(state, `As you reach for the hatch, the ${label(u.kind)}'s cockpit fires. Securing the frame never secured the pilot.`);
        setPilot(state, u.pilot, "escaped", "ejected from a restrained frame");
      }
    }
    out.push({ ...base, id: u.uid, kind: u.kind, person: false, label: `The ${label(u.kind)}${team ? " chassis" : ""}` });
  }
  return out;
}

export function dismantleValue(item: CustodyItem): number {
  if (item.kind === "prisoner") return RULES.prisonerScrap;
  if (hasTag(item.kind, "team")) return RULES.chassisScrap;
  return RULES.dismantle[UNITS[item.kind].size === "small" ? "small" : "medium"];
}

// ---------- Memory Tap ----------

/** A secured enemy machine on the field, or your own holder carrying an untapped machine or cockpit. */
export function tapSources(state: GameState): string[] {
  const field = living(state, "enemy").filter((u) => secured(u) && is(u, "mechanical") && !u.note?.includes("tapped")).map((u) => u.uid);
  const held = state.captives.filter((c) => !c.tapped && !(c.pilot && c.kind !== "capsule")).map((c) => c.holder);
  return [...field, ...held];
}

export type TapChoice = "hazard" | "weak" | "cache";

function tapRole(state: GameState, sourceId: string): { role?: Role; contained: boolean; anomalous: boolean; damaged: boolean; mark: () => void } {
  const u = unit(state, sourceId);
  const cap = captiveOf(state, sourceId);
  if (cap) {
    const p = pilot(state, cap.pilot);
    const holder = state.units.find((x) => x.uid === sourceId);
    return { role: p?.role as Role | undefined, contained: holder?.kind === "pod", anomalous: cap.kind === "prisoner", damaged: cap.hp <= 1, mark: () => void (cap.tapped = true) };
  }
  const role = u ? ((u.kind === "capsule" ? u.role : u.kind) as Role) : undefined;
  return { role: role && ROLES.includes(role) ? role : undefined, contained: false, anomalous: u?.kind === "prisoner", damaged: !!u && u.hp <= 1, mark: () => u && (u.note = `${u.note ?? ""} tapped`.trim()) };
}

/** Reads a source once. Clean is specific, partial is true but thin, corrupted is flagged as unverified. */
export interface TapSource {
  role?: Role;
  contained: boolean;
  anomalous: boolean;
  damaged: boolean;
  mark: () => void;
}

export function resolveTap(state: GameState, sourceId: string, choice: TapChoice, given?: TapSource): "clean" | "partial" | "corrupted" {
  const src = given ?? tapRole(state, sourceId);
  src.mark();
  let clean = RULES.tap.clean + (src.contained ? 0.1 : 0) - (src.damaged ? 0.1 : 0) - (src.anomalous ? 0.2 : 0);
  clean = Math.max(0.1, Math.min(0.9, clean));
  const r = roll(state);
  const q = r < clean ? "clean" : r < clean + RULES.tap.partial ? "partial" : "corrupted";
  log(state, `Memory Tap: ${q.toUpperCase()} read.${q === "corrupted" ? " Timestamps disagree with each other. Treat this as UNVERIFIED." : ""}`);
  if (q === "corrupted") state.intel.questionable = true;
  if (choice === "hazard") {
    state.revealNext = true;
    if (q === "clean") {
      state.navFlag = true;
      log(state, "Hazard scan: you know what is in the next room, and you can read the next wrong corridor.");
    } else log(state, q === "partial" ? "Hazard scan: you know what is in the next room." : "Hazard scan: a patrol list for the next room. One entry does not match the others.");
  } else if (choice === "weak") {
    if (q === "corrupted") log(state, "Weakness analysis: it names a weak point. The part number does not exist.");
    else {
      state.intel.weak = true;
      log(state, q === "clean" ? "Weakness analysis: the toughest machine in the next fight has a known flaw. It will take +1 from every hit." : "Weakness analysis: something in the next fight has a flaw. It will take +1 from every hit.");
    }
  } else {
    if (q === "corrupted") {
      state.intel.cache = -1;
      log(state, "Cache trace: a locker marked near the next Tech Stop. The log entry was written after the machine was captured.");
    } else {
      state.intel.cache += RULES.tapCache[q];
      log(state, `Cache trace: a parts locker by the next Tech Stop (${RULES.tapCache[q]} Scrap).`);
    }
  }
  // Cockpit records from R-8 frames carry the section's own routing.
  if (src.role && q !== "corrupted") {
    const t = state.team;
    if ((src.role === "needleback" || src.role === "widow" || src.role === "bishop") && !t.knownRoute) {
      t.knownRoute = true;
      log(state, "The cockpit log also holds R-8's recovery route. You know where Bishop will be.");
    }
    if (src.role === "bishop") {
      t.leverage += 1;
      log(state, `Squad roster recovered: ${t.pilots.map((p) => `${CALLSIGN[p.role as Role]} ${p.status}`).join(", ")}.`);
    }
  }
  if (src.anomalous && q === "corrupted") {
    state.threat += 1;
    log(state, `…? Something in the read wrote back. Threat ${state.threat}.`);
  }
  void pilotByRole;
  return q;
}
