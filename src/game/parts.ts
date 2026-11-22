// v0.7: part damage, cover and lane positioning.
//
// Part damage: a hard hit can knock out an enemy machine's sensors, weapon
// or actuator. Each part goes once and stays down for the fight (the unit
// does not outlive the fight). Sensors take a step off its aim and switch off
// a Laser Sight. A damaged weapon loses a point of damage and switches off an
// Extended Magazine. A damaged actuator switches off the shoulder Missile Pod
// and makes a melee unit drag its leg: it closes only every other turn.
//
// Cover: a Bulkhead or Containment Pod covers the units beside it on your
// side; a Command Relay covers the enemies beside it. Cover takes a point off
// every direct-fire hit. Melee, missiles, thrown and splash damage ignore it.
//
// Range: enemy direct fire from four or more columns across loses a step of aim.

import { RULES, label } from "./data";
import { chance, is, living, log, pick } from "./core";
import type { GameState, Unit } from "./state";

export type Part = "sensors" | "weapon" | "actuator";
export const PARTS: Record<Part, { name: string; down: string; text: string }> = {
  sensors: { name: "Sensors", down: "SENSORS DOWN", text: "Aim is a step worse. A Laser Sight is useless." },
  weapon: { name: "Weapon", down: "WEAPON DAMAGED", text: "−1 damage. An Extended Magazine no longer feeds." },
  actuator: { name: "Actuator", down: "ACTUATOR DAMAGED", text: "The shoulder Missile Pod is dead. A melee unit closes only every other turn." },
};

const NO_PARTS = ["capsule", "relay", "drone", "rifleman", "prisoner"];

export function hasParts(u: Unit): boolean {
  return u.side === "enemy" && is(u, "mechanical") && !NO_PARTS.includes(u.kind) && (u.atk > 0 || u.missiles > 0);
}
export function partDown(u: Unit | undefined, p: Part): boolean {
  return !!u?.partsDown?.includes(p);
}

/** After a hit lands and the unit survives: maybe a part goes. Bigger hits are likelier to. */
export function partHit(state: GameState, u: Unit, dmg: number) {
  if (!hasParts(u) || u.hp <= 0 || dmg < RULES.partHitMin) return;
  const p = dmg >= RULES.partHitBig ? RULES.partHitChance * 2 : RULES.partHitChance;
  if (!chance(state, p)) return;
  const intact = (Object.keys(PARTS) as Part[]).filter((x) => !partDown(u, x));
  if (!intact.length) return;
  const part = pick(state, intact);
  u.partsDown = [...(u.partsDown ?? []), part];
  log(state, `PART DAMAGE: the ${label(u.kind)}'s ${PARTS[part].name.toLowerCase()} ${part === "weapon" ? "is" : "are"} hit. ${PARTS[part].text}`);
}

export function partLine(u: Unit): string {
  return (u.partsDown ?? []).map((p) => PARTS[p as Part].down).join(" · ");
}

// ---------- cover ----------

const COVER_FRIENDLY = ["bulkhead", "pod"];
const COVER_ENEMY = ["relay", "shieldmech"];

/** The unit giving this one cover, if any: a cover piece in the next column on the same side. */
export function coverFrom(state: GameState, u: Unit): Unit | undefined {
  const kinds = u.side === "friendly" ? COVER_FRIENDLY : COVER_ENEMY;
  if (kinds.includes(u.kind)) return undefined;
  return living(state, u.side).find((c) => kinds.includes(c.kind) && Math.abs(c.slot - u.slot) === 1 && !c.foam);
}

/** Damage after cover, for a direct-fire hit. */
export function afterCover(state: GameState, target: Unit, dmg: number, src: string): number {
  const c = coverFrom(state, target);
  if (!c || dmg <= 0) return dmg;
  const left = Math.max(0, dmg - RULES.coverSoak);
  log(state, `${label(target.kind)} is in cover behind the ${label(c.kind)}: ${src} loses ${dmg - left}.`);
  return left;
}

// ---------- range ----------

/** Aim steps lost to distance across the lane: one at four or more columns. */
export function rangeSteps(attacker: Unit | undefined, target: Unit | undefined): number {
  if (!attacker || !target || is(attacker, "melee")) return 0;
  return Math.abs(attacker.slot - target.slot) >= RULES.longRange ? 1 : 0;
}

// ---------- moving along your own line ----------

const FIXED = ["bulkhead", "pod", "beacon", "gunnest"];

export function canShift(state: GameState, u: Unit, dir: -1 | 1): string | null {
  if (u.side !== "friendly") return "not yours";
  if (FIXED.includes(u.kind)) return "bolted down";
  if (u.kind === "warframe" && u.inert) return "still booting";
  if (u.shutdown || u.foam || (u.sealed ?? 0) > 0) return "cannot move right now";
  if (u.moved) return "already moved this turn";
  const to = u.slot + dir;
  if (to < 0 || to > 5) return "end of the line";
  if (state.units.some((x) => x.side === "friendly" && x.slot === to && x.hp > 0)) return "that column is taken";
  return null;
}

export function shift(state: GameState, u: Unit, dir: -1 | 1) {
  u.slot += dir;
  u.moved = true;
  const c = coverFrom(state, u);
  log(state, `${label(u.kind)} shifts to column ${u.slot + 1}${c ? `, into cover behind the ${label(c.kind)}` : ""}.`);
}
