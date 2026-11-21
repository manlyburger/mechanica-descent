// v0.7: restraint items as capture tools. A pilot in a grounded capsule, a
// pilot running on foot, or a pilot pulled from an escape pod can be bound by
// hand with a restraint item from your stores. No Clampjaw or Containment Pod
// is needed: the captive is walked along by your crew, wearing the item that
// bound them, and counts against a small limit. The odds come from the item's
// rank and from the pilot: Endurance, level, loyalty, and the state they are in.

import { RULES, label } from "./data";
import { chance, log, payEnergy, canPayEnergy } from "./core";
import { band, rec, slotCount, statOf } from "./pilots";
import { ITEMS } from "./pilots-data";
import type { Captive, GameState, ItemInst, PilotRec, PodRec, Unit } from "./state";
import { setPilot } from "./team";

export const RESTRAINTS = Object.keys(ITEMS).filter((id) => ITEMS[id].cat === "restraint");

export function rank(itemId: string): number {
  return ITEMS[itemId]?.rank ?? 1;
}
/** One of each restraint you are carrying (the first of each). */
export function restraintsInStore(state: GameState): ItemInst[] {
  const out: ItemInst[] = [];
  for (const it of state.items) if (RESTRAINTS.includes(it.id) && !out.some((x) => x.id === it.id)) out.push(it);
  return out.sort((a, b) => rank(a.id) - rank(b.id));
}
export function boundCaptives(state: GameState): Captive[] {
  return state.captives.filter((c) => c.holder.startsWith("bound:"));
}
export function boundBlock(state: GameState): string | null {
  return boundCaptives(state).length >= RULES.boundMax ? `Your crew can walk at most ${RULES.boundMax} bound captives.` : null;
}

export interface RestrainCtx {
  outcome?: PodRec["outcome"];
  subdued?: boolean;
  inCapsule?: boolean; // still sealed in a capsule mid-fight
  hurt?: boolean; // their capsule or suit is damaged
}

/** Success chance for binding this pilot with this item. */
export function restrainChance(r: PilotRec, itemId: string, ctx: RestrainCtx = {}): number {
  let p = RULES.restrainBase + RULES.restrainPerRank * rank(itemId);
  p -= RULES.restrainPerEndurance * statOf(r, "endurance");
  p -= RULES.restrainPerLevel * (r.level - 1);
  p += RULES.restrainPerBand * (band(r.loyalty) - 1);
  const o = ctx.outcome;
  if (o === "cooperative") p += 0.2;
  if (o === "frightened") p += 0.05;
  if (o === "hostile" && !ctx.subdued) p -= 0.15;
  if (o === "incapacitated") p += 0.35;
  if (ctx.subdued) p += 0.3;
  if (ctx.inCapsule) p -= 0.1;
  if (ctx.hurt || (r.hp <= 1 && o !== "incapacitated")) p += 0.1;
  return Math.max(RULES.restrainMin, Math.min(RULES.restrainMax, p));
}

/** Binds them: a captive walked by the crew, wearing the item. */
export function bindPilot(state: GameState, r: PilotRec, item: ItemInst, what: string) {
  const id = `b${state.uidSeq++}`;
  state.captives.push({ id, kind: "capsule", pilot: r.id, label: `${r.name}, bound`, holder: "bound:" + id, bands: 0, tapped: true, hp: Math.max(1, r.hp) });
  setPilot(state, r.id, "captured"); // confiscates their kit first
  state.items = state.items.filter((x) => x.uid !== item.uid);
  const free = r.slots.findIndex((x, i) => !x && i < slotCount(r));
  if (free >= 0) r.slots[free] = item;
  else state.items.push(item);
  log(state, `RESTRAINED: ${r.name} ${what}, in ${ITEMS[item.id].name}. Walked along by your crew.`);
}

// ---------- in a fight: grounded capsules and runners ----------

export function restrainTarget(u: Unit): boolean {
  return u.side === "enemy" && u.kind === "capsule" && !u.flying && u.hp > 0 && !u.cap;
}

export function restrainCommandBlock(state: GameState, u: Unit): string | null {
  if (!restrainTarget(u)) return "not a pilot you can reach";
  if (u.restrainTried === state.turn) return "already tried this turn";
  if (!canPayEnergy(state, RULES.restrainEnergy, true)) return `needs ${RULES.restrainEnergy} Energy`;
  return boundBlock(state);
}

/** In-fight odds for the UI. Unknown occupants are shown at the item's base odds. */
export function capsuleOdds(state: GameState, u: Unit, itemId: string): number {
  const r = rec(state, u.pilot);
  const ctx: RestrainCtx = { inCapsule: u.role !== "runner", hurt: u.hp < u.maxHp };
  if (r) return restrainChance(r, itemId, ctx);
  return Math.max(RULES.restrainMin, Math.min(RULES.restrainMax, RULES.restrainBase + RULES.restrainPerRank * rank(itemId) - 0.1));
}

/** Returns false only when the attempt never happened. */
export function restrainCapsule(state: GameState, u: Unit, itemId: string, resolveOccupant: (u: Unit) => void): boolean {
  if (restrainCommandBlock(state, u)) return false;
  const item = state.items.find((x) => x.id === itemId);
  if (!item) return false;
  payEnergy(state, RULES.restrainEnergy, true);
  u.restrainTried = state.turn;
  if (!u.pilot) resolveOccupant(u);
  const r = rec(state, u.pilot);
  if (!r) {
    log(state, `You pull the ${label(u.kind)}'s hatch: nobody inside.`);
    u.occupant = "empty";
    return true;
  }
  const p = restrainChance(r, itemId, { inCapsule: u.role !== "runner", hurt: u.hp < u.maxHp });
  if (chance(state, p)) {
    state.units = state.units.filter((x) => x.uid !== u.uid);
    bindPilot(state, r, item, u.role === "runner" ? "brought down on the run" : "dragged out of the capsule");
  } else {
    u.exitIn = 1;
    log(state, `${r.name} twists out of the ${ITEMS[itemId].name} and scrambles for the exit.`);
  }
  return true;
}
