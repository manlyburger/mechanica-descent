// Pilots as people: one record per person, keyed by a stable id that never
// changes as they move between enemy, captive, runner and crew. Stats, levels,
// equipment, loyalty, custody strain, assignments, and their part in fights.

import { RULES, UNITS, label, type UnitKind } from "./data";
import { loseCaptive } from "./capture";
import { setPilot } from "./team";
import { addScrap, allies, chance, deal, freeEnemySlot, freeFriendSlot, is, living, log, pick, roll, spawn, takeWreck, uid } from "./core";
import { FLEE_NAMES, FRAME_FAULTS, ITEMS, PR, R8_PILOTS, SPECS, TRAITS, TRAIT_SPEC, FLEEING_TRAITS, ALLY_ITEMS, CAPTIVE_ITEMS, type Chassis, type ItemDef, type Spec, type Stat } from "./pilots-data";
import type { GameState, ItemInst, PilotRec, Unit } from "./state";
import { CALLSIGN, type Role } from "./team-text";

export const BAND_NAMES = ["Hostile", "Unwilling", "Partially Willing", "Cooperative", "Loyal"];
const STATS: Stat[] = ["mental", "skill", "endurance", "observation"];

// ---------- records ----------

export function rec(state: GameState, id: string | undefined): PilotRec | undefined {
  return id ? state.roster.find((r) => r.id === id) : undefined;
}
export function band(loyalty: number): number {
  let b = 0;
  PR.bands.forEach((min, i) => {
    if (loyalty >= min) b = i;
  });
  return b;
}
export function statOf(r: PilotRec, s: Stat): number {
  return r.base[s] + r.earned[s];
}
export function statCap(level: number): number {
  return PR.statRange[Math.min(PR.maxLevel, level)][1];
}
export function maxHp(r: PilotRec): number {
  return PR.baseHp + Math.floor(statOf(r, "endurance") / 2);
}
export function item(r: PilotRec, id: string): ItemInst | undefined {
  return r.slots.find((x) => x?.id === id) ?? undefined;
}
export function has(r: PilotRec, id: string): boolean {
  return !!item(r, id);
}
export function isTeam(r: PilotRec): boolean {
  return !!r.role;
}
export function fieldedUnit(state: GameState, r: PilotRec): Unit | undefined {
  return living(state, "friendly").find((u) => u.pilot === r.id);
}

function rollStats(state: GameState, level: number) {
  const [lo, hi] = PR.statRange[level];
  const r = () => lo + Math.floor(roll(state) * (hi - lo + 1));
  // Observation is rolled last, so the first three come out exactly as before it existed.
  const m = r(), s = r(), e = r();
  return { mental: m, skill: s, endurance: e, observation: r() };
}

export function makePilot(
  state: GameState,
  o: { id: string; name: string; origin: string; role?: string; level: number; spec: string; trait: string; loyalty: number; custody: PilotRec["custody"] },
): PilotRec {
  const r: PilotRec = {
    ...o,
    xp: PR.xpFor[o.level],
    base: rollStats(state, o.level),
    earned: { mental: 0, skill: 0, endurance: 0, observation: 0 },
    points: 0,
    hp: 0,
    madness: 0,
    recovering: 0,
    slots: [null, null, null, null],
    slot4: false,
    assignment: "",
    strain: 0,
    injuredUntreated: false,
    agreed: "",
    talkedRoom: -1,
    tightenedRoom: -1,
    away: 0,
    kills: 0,
    sorties: 0,
    history: [],
  };
  r.hp = maxHp(r);
  return r;
}

/** Relay Section R-8's five pilots exist from the start, with their own gear. */
export function initRoster(state: GameState) {
  for (const [id, d] of Object.entries(R8_PILOTS)) {
    const role = state.team.pilots.find((p) => p.id === id)!.role;
    const r = makePilot(state, { id, name: CALLSIGN[role as Role], origin: "Relay Section R-8", role, level: d.level, spec: d.spec, trait: d.trait, loyalty: d.loyalty, custody: "free" });
    d.gear.forEach((g, i) => (r.slots[i] = newItem(state, g)));
    state.roster.push(r);
  }
}

export function newItem(state: GameState, id: string): ItemInst {
  const def = ITEMS[id];
  return { uid: uid(state, "i"), id, ...(def.charges ? { charges: def.charges } : {}) };
}

function note(r: PilotRec, line: string) {
  r.history = [line, ...r.history].slice(0, 12);
}

// ---------- derived numbers ----------

export type Ctx = "inspect" | "tech" | "combat";

export function skillFor(state: GameState, r: PilotRec, ctx: Ctx, frame?: Unit): number {
  let s = statOf(r, "skill");
  const lv5 = r.level >= 5;
  if (ctx === "inspect" && r.spec === "Scout") s += lv5 ? 4 : 2;
  if (ctx === "tech" && r.spec === "Technician") s += lv5 ? 4 : 2;
  if (ctx === "inspect" && has(r, "scanner")) s += 2;
  if (frame && !SPECS[r.spec as Spec].frames.includes(frame.chassis as Chassis)) s += PR.incompatibleSkill;
  void state;
  return Math.max(0, s);
}
/** Observation as it counts for spotting: Scouts and scanners help. */
export function observation(r: PilotRec): number {
  return statOf(r, "observation") + (r.spec === "Scout" ? 2 : 0) + (has(r, "scanner") ? 1 : 0);
}
/** The one roll for the whole party uses its best eye. Crew only: captives are not watching for you. */
export function partyObservation(state: GameState): { obv: number; who: string } {
  let best = { obv: RULES.jubeyObv, who: "Jubey" };
  for (const r of state.roster) {
    if (r.custody !== "ally" || r.away > 0 || r.hp <= 0) continue;
    const o = observation(r);
    if (o > best.obv) best = { obv: o, who: r.name };
  }
  return best;
}
/** Deterministic Observation for a record saved before the stat existed. */
export function migrateObservation(seed: number, r: PilotRec) {
  if (r.base.observation !== undefined) return;
  let h = seed >>> 0;
  for (const ch of r.id) h = ((Math.imul(h ^ ch.charCodeAt(0), 2654435761) >>> 0) ^ (h >>> 13)) >>> 0;
  const [lo, hi] = PR.statRange[Math.min(PR.maxLevel, r.level)];
  r.base.observation = lo + (h % (hi - lo + 1));
  r.earned.observation = r.earned.observation ?? 0;
}
export function madnessReduction(r: PilotRec): number {
  return Math.min(PR.mentalMadnessCap, PR.mentalMadness * statOf(r, "mental") + (has(r, "dampener") ? 0.15 : 0));
}
export function nightmareResist(r: PilotRec): number {
  return Math.min(PR.mentalNightmareCap, PR.mentalNightmare * statOf(r, "mental"));
}
export function accuracy(state: GameState, r: PilotRec, frame?: Unit): number {
  const bonus = PR.skillAcc * skillFor(state, r, "combat", frame) + (has(r, "targeting") ? 0.05 : 0) + (frame && has(r, "sync") ? 0.1 : 0);
  return Math.min(PR.skillAccCap, bonus);
}
export function damageResist(r: PilotRec): number {
  return Math.min(PR.endResistCap, PR.endResist * statOf(r, "endurance") + (has(r, "padding") ? 0.1 : 0));
}
export function deathAvoid(r: PilotRec): number {
  return Math.min(PR.endSurviveCap, PR.endSurvive * statOf(r, "endurance"));
}
export function madnessTotal(r: PilotRec): number {
  return Math.min(100, r.madness + r.recovering);
}
/** Chance an action is lost to Madness: the Madness level, reduced by Mental. */
export function misfire(r: PilotRec): number {
  return (madnessTotal(r) / 100) * (1 - madnessReduction(r));
}
function clampHit(p: number) {
  return Math.max(PR.hitFloor, Math.min(PR.hitCeiling, p));
}
export function frameHit(state: GameState, r: PilotRec, f: Unit): number {
  return clampHit(PR.pilotBaseHit + accuracy(state, r, f) - (f.faults?.includes("sensors") ? 0.1 : 0));
}
export function weapon(r: PilotRec): ItemDef | undefined {
  const w = r.slots.find((x) => x && ITEMS[x.id].cat === "weapon");
  return w ? ITEMS[w.id] : undefined;
}
function assaultBonus(r: PilotRec, f?: Unit): number {
  let b = 0;
  if (r.spec === "Assault") b += r.level >= 5 ? 2 : 1;
  if (r.spec === "Heavy" && r.level >= 5 && f?.chassis === "heavy") b += 1;
  return b;
}
/** Command pilots in the field sharpen your machines. */
export function commandBonus(state: GameState): number {
  let b = 0;
  for (const u of living(state, "friendly")) {
    const r = rec(state, u.pilot);
    if (r?.spec === "Command" && !u.bolting) b = Math.max(b, r.level >= 5 ? 0.1 : 0.05);
  }
  return b;
}

// ---------- XP and loyalty ----------

export function gainXp(state: GameState, r: PilotRec, n: number, why: string) {
  if (r.custody === "dead" || n <= 0) return;
  r.xp += n;
  while (r.level < PR.maxLevel && r.xp >= PR.xpFor[r.level + 1]) {
    r.level += 1;
    r.points += 1;
    note(r, `Reached level ${r.level}.`);
    log(state, `${r.name} reaches level ${r.level}: +1 stat point, stat cap ${statCap(r.level)}.`);
    if (r.level === 5) log(state, `${r.name}'s ${r.spec} specialization improves: ${SPECS[r.spec as Spec].improved}`);
  }
  void why;
}

/** Multiplier on every loyalty gain: personality, and a section that is still hunting you. */
export function gainRate(state: GameState, r: PilotRec): { rate: number; blocker?: string } {
  const pursuing = state.team.pursuit === "active" || state.team.pursuit === "disrupted";
  const sectionOut = state.team.pilots.some((p) => p.id !== r.id && ["active", "escaped", "recovered"].includes(p.status));
  if (r.id === "p-bishop" && sectionOut) return { rate: 0, blocker: "currently blocked by unresolved faction loyalty: members of their section are still out there." };
  if (r.trait === "defiant" && r.injuredUntreated) return { rate: 0, blocker: "Resolve the outstanding conflict first: they are hurt, and nobody has treated it." };
  let rate = TRAITS[r.trait]?.gain ?? 1;
  if (isTeam(r) && pursuing) rate *= PR.pursuitGain;
  return { rate };
}

export function shiftLoyalty(state: GameState, r: PilotRec, delta: number, why: string) {
  const before = r.loyalty;
  r.loyalty = Math.max(0, Math.min(100, Math.round(r.loyalty + delta)));
  const d = r.loyalty - before;
  if (!d) return;
  log(state, `${r.name}: loyalty ${d > 0 ? "+" : ""}${d} (${why}).`);
  if (band(before) !== band(r.loyalty)) log(state, `${r.name} is now ${BAND_NAMES[band(r.loyalty)]}.`);
}
function gain(state: GameState, r: PilotRec, base: number, why: string): number {
  const { rate, blocker } = gainRate(state, r);
  if (!rate) {
    log(state, `${r.name} gives nothing back: ${blocker}`);
    return 0;
  }
  shiftLoyalty(state, r, base * rate, why);
  return base * rate;
}

// ---------- equipment ----------

export function side(r: PilotRec): "captive" | "ally" | null {
  if (r.custody === "captive" || r.custody === "fleeing") return "captive";
  if (r.custody === "ally") return "ally";
  return null;
}
export function slotCount(r: PilotRec): number {
  return r.slot4 ? 4 : PR.slots;
}

/** Why this item cannot go in this slot, or null. */
export function cannotEquip(r: PilotRec, it: ItemInst, slot: number): string | null {
  const def = ITEMS[it.id];
  const s = side(r);
  if (!s) return "not in your custody or crew";
  if (slot < 0 || slot >= 4) return "no such slot";
  if (slot === 3 && !r.slot4) return "slot 4 is locked";
  if (def.side !== s) return s === "captive" ? "captives take restraints, gags and relays only" : "crew take weapons, modules and support only";
  const others = r.slots.filter((x, i) => x && i !== slot) as ItemInst[];
  const cats = others.map((x) => ITEMS[x.id].cat);
  if (def.cat === "gag" && cats.includes("gag")) return "one gag at a time";
  if (def.cat === "weapon" && cats.includes("weapon")) return "one weapon at a time";
  if (def.cat === "restraint") {
    if (cats.filter((c) => c === "restraint").length >= 2) return "two restraints at most";
    if (def.id === "harness" && others.some((x) => x.id === "harness")) return "one harness at most";
  }
  if (def.id !== "plockbands" && others.some((x) => x.id === def.id)) return "already fitted";
  return null;
}

function moveToInventory(state: GameState, r: PilotRec, filter: (d: ItemDef) => boolean, why: string) {
  const moved: string[] = [];
  r.slots = r.slots.map((x) => {
    if (x && filter(ITEMS[x.id])) {
      state.items.push(x);
      moved.push(ITEMS[x.id].name);
      return null;
    }
    return x;
  });
  if (moved.length) log(state, `${why}: ${moved.join(", ")} to your inventory.`);
}

// ---------- Cockpit Parts ----------

export const PILOTED: UnitKind[] = ["light", "lvl2", "powered", "needleback", "latchback", "widow", "kilnheart", "bishop", "hunter", "tracker", "predator"];

/** One roll per cockpit source, ever. */
export function rollParts(state: GameState, key: string, why: string) {
  if (state.partsRolled.includes(key)) return;
  state.partsRolled = [...state.partsRolled, key].slice(-400);
  if (chance(state, PR.partDrop)) {
    state.parts += 1;
    log(state, `${why}: a usable Cockpit Part (${state.parts}/${PR.slot4Parts}).`);
  }
}

// ---------- custody ----------

/** Removes a pilot's captive record and frees its holder. */
export function dropCaptiveRecord(state: GameState, id: string) {
  const c = state.captives.find((x) => x.pilot === id);
  if (!c) return;
  state.captives = state.captives.filter((x) => x !== c);
  const holder = state.units.find((u) => u.uid === c.holder);
  if (holder) holder.holding = undefined;
}

function unassign(state: GameState, r: PilotRec) {
  for (const u of state.units) if (u.kind === "frame" && u.pilot === r.id) u.pilot = undefined;
  state.units = state.units.filter((u) => !(u.kind === "pilot" && u.pilot === r.id && u.side === "friendly"));
  r.assignment = "";
}

/**
 * Called by setPilot for every status change, before the team sees it.
 * Returns true if the roster took the event over (a tracked escape).
 */
export function syncRoster(state: GameState, id: string | undefined, status: string): boolean {
  const r = rec(state, id);
  if (!r) return false;
  switch (status) {
    case "captured": {
      if (r.custody === "captive") return false;
      const wasAlly = r.custody === "ally";
      r.custody = "captive";
      unassign(state, r);
      moveToInventory(state, r, (d) => d.side === "ally", `${r.name}'s kit is confiscated`);
      r.hp = Math.max(1, Math.min(r.hp, maxHp(r)) - 1);
      r.injuredUntreated = true;
      r.strain = 0;
      note(r, wasAlly ? "Taken back into custody." : "Captured.");
      rollParts(state, "pilot:" + r.id, `Searching ${r.name}'s cockpit`);
      return false;
    }
    case "escaped":
    case "recovered":
    case "withdrawn": {
      const tracked = (r.custody === "captive" || r.custody === "fleeing") && has(r, "tracker") && status === "escaped";
      dropCaptiveRecord(state, r.id);
      unassign(state, r);
      if (tracked) {
        r.custody = "fleeing";
        state.pendingRunners = [...state.pendingRunners.filter((x) => x !== r.id), r.id];
        log(state, `Tracking Relay: ${r.name} is still on your screen. They will not get clear.`);
        const tp = state.team.pilots.find((p) => p.id === r.id);
        if (tp) {
          tp.status = "active";
          tp.returnsIn = undefined;
        }
        note(r, "Escaped, tracked.");
        return true;
      }
      if (r.custody !== "free") note(r, status === "withdrawn" ? "Left for good." : "Got away.");
      r.custody = "free";
      return false;
    }
    case "dead":
      dropCaptiveRecord(state, r.id);
      unassign(state, r);
      if (r.custody !== "dead") note(r, "Killed.");
      r.custody = "dead";
      r.hp = 0;
      return false;
    case "turned":
      r.custody = "ally";
      return false;
    default:
      return false;
  }
}

// ---------- assignments ----------

export interface Block {
  reason: string;
  barrier?: boolean; // the orange-red UNWILLING barrier
}

/** Why this pilot cannot take this assignment. "" (none) is always allowed. */
export function assignBlock(state: GameState, r: PilotRec, target: string): Block | null {
  if (!target) return null;
  if (state.phase === "player") return { reason: "not during a fight" };
  if (r.custody !== "ally" && r.custody !== "captive") return { reason: "not in your custody or crew" };
  if (r.away > 0) return { reason: "separated from you" };
  const b = band(r.loyalty);
  if (b <= 1) return { reason: "UNWILLING — ASSIGNMENT RESTRICTED", barrier: true };
  if (has(r, "harness")) return { reason: "the Armored Restraint Harness rules out field assignments" };
  if (target === "foot") return null;
  if ((r.rest ?? 0) > 0) return { reason: "still recovering from the pod: no frame this room" };
  const f = state.units.find((u) => u.uid === target && (u.kind === "frame" || u.kind === "casket") && u.side === "friendly" && u.hp > 0);
  if (!f) return { reason: "no such frame" };
  if (r.custody === "captive" && b < 3) return { reason: "a Partially Willing captive takes limited tasks only: scouting and inspection, not a frame" };
  return null;
}

export function assign(state: GameState, r: PilotRec, target: string) {
  unassign(state, r);
  if (!target) return;
  if (target !== "foot") {
    const f = state.units.find((u) => u.uid === target)!;
    const prev = rec(state, f.pilot);
    if (prev) prev.assignment = "";
    f.pilot = r.id;
    log(state, f.kind === "casket" ? `${r.name} climbs into CASKET-13. The second-occupant line flickers.` : `${r.name} climbs into the ${f.chassis} frame.`);
  } else log(state, `${r.name} will go in on foot.`);
  r.assignment = target;
}

// ---------- loyalty estimates (generalized, never the hidden roll) ----------

export function estimate(state: GameState, r: PilotRec): string {
  const b = band(r.loyalty);
  if (b >= 4) return "Loyal.";
  const { rate, blocker } = gainRate(state, r);
  if (!rate) return blocker!.charAt(0).toUpperCase() + blocker!.slice(1);
  // The next useful stage: assignments open at Partially Willing, frames and recruitment at Cooperative.
  const next = PR.bands[b <= 1 ? 2 : b + 1];
  const per = (r.custody === "captive" ? (b >= 2 ? PR.assignGainCaptive : b === 0 ? PR.talkGainHostile : PR.talkGain) : PR.assignGainAlly) * rate;
  const n = Math.max(1, Math.ceil((next - r.loyalty) / per));
  const target = BAND_NAMES[band(next)];
  const gag = r.slots.some((x) => x && ["muffle", "voiceseal", "acoustic"].includes(x.id)) && b < 2 ? " Talking needs the gag off." : "";
  return `Estimated ${n}–${Math.ceil(n * 1.5)} successful cooperation opportunities to reach ${target}.${gag}`;
}

export function expectations(state: GameState, r: PilotRec): string[] {
  const out: string[] = [];
  const task: Record<string, string> = { Scout: "scouting and inspection", Assault: "front-line work", Recovery: "recovery and repair work", Heavy: "heavy frames", Command: "coordinating your machines", Technician: "technical jobs" };
  out.push(`Likely to take on ${task[r.spec] ?? "basic tasks"}.`);
  const pursuing = state.team.pursuit === "active" || state.team.pursuit === "disrupted";
  if (isTeam(r) && pursuing) out.push("May refuse attacks against former teammates.");
  if ((TRAITS[r.trait]?.betray ?? 0) > 0 || r.spec === "Scout") out.push("Possible escape attempt if given a fast frame.");
  if (r.custody === "captive") out.push("More reliable with supervision (Remote Release Shackles, a Tracking Relay, Panic Jack) or a kept agreement.");
  out.push(estimate(state, r));
  return out;
}

// ---------- room, fight and turn hooks ----------

export function pilotsRoomStart(state: GameState) {
  const t = state.team;
  const pursuing = t.pursuit === "active" || t.pursuit === "disrupted";
  for (const r of state.roster) {
    if ((r.rest ?? 0) > 0) r.rest! -= 1;
    if (r.away > 0) {
      r.away -= 1;
      if (!r.away) log(state, `${r.name} finds their way back to you.`);
    }
    if (r.agreed === "kept" && isTeam(r) && !pursuing && t.pursuit !== "dormant") {
      r.agreed = "";
      if (r.custody === "captive" || r.custody === "ally") shiftLoyalty(state, r, PR.agreeKept, "you kept your word: they never fought their section");
    }
    if (r.custody === "captive") {
      // Harsh equipment is resented, room by room.
      for (const x of r.slots) if (x && PR.harsh[x.id]) shiftLoyalty(state, r, PR.harsh[x.id], ITEMS[x.id].name);
      // Escape strain: their will to get out, less what holds them.
      const holder = state.units.find((u) => u.uid === state.captives.find((c) => c.pilot === r.id)?.holder);
      const less = r.slots.reduce((n, x) => n + (x ? (ITEMS[x.id].strain ?? 0) : 0), 0) + (holder?.kind === "pod" ? PR.strainPod : 0);
      const add = Math.max(0, PR.strainBase[band(r.loyalty)] - less);
      if (r.assignment === "") r.strain = Math.min(100, r.strain + add);
      if (r.strain >= 100) {
        log(state, `${r.name} slips custody.`);
        r.strain = 0;
        const holderUid = state.captives.find((c) => c.pilot === r.id)?.holder;
        if (holderUid) loseCaptive(state, holderUid, "worked free over time");
        continue;
      }
      if (r.strain >= PR.strainWarn) log(state, `${r.name} is restless. Restraints are being worked at.`);
      else if (has(r, "diagrelay") && r.strain >= PR.strainWarnDiag) log(state, `Custody Diagnostic Relay: ${r.name}'s restraints are under steady strain (${r.strain}).`);
      // Suit transmitter: radio, not speech. A gag does nothing; an isolator does.
      if (isTeam(r) && pursuing && !has(r, "isolator") && chance(state, PR.beaconPing)) {
        t.knowsPlayer = true;
        if (has(r, "monitor")) log(state, `Communication Monitor: ${r.name}'s suit transmitter just pinged their section. Your position is out.`);
      }
    }
    if (r.custody === "ally" && band(r.loyalty) === 0) {
      log(state, `${r.name} is gone in the night. You strip their kit off the bunk they left.`);
      moveToInventory(state, r, () => true, "Recovered");
      unassign(state, r);
      note(r, "Deserted.");
      if (isTeam(r)) setPilot(state, r.id, "escaped", "deserted your crew");
      else r.custody = "free";
    }
  }
}

function fielded(state: GameState): { r: PilotRec; u: Unit }[] {
  const out: { r: PilotRec; u: Unit }[] = [];
  for (const u of living(state, "friendly")) {
    const r = rec(state, u.pilot);
    if (r && (u.kind === "frame" || u.kind === "pilot")) out.push({ r, u });
  }
  return out;
}

function teamPresent(state: GameState): boolean {
  return living(state, "enemy").some((e) => is(e, "team") && !!e.pilot);
}

export function pilotsFightStart(state: GameState) {
  state.nightmareFight = state.extension || living(state, "enemy").some((e) => ["rifleman", "prisoner", "deadframe", "mimic", "casket"].includes(e.kind)) || living(state, "friendly").some((u) => u.kind === "casket");
  if (state.nightmareFight && state.roster.some((r) => r.assignment)) log(state, "This is a Nightmare fight. Your pilots' Mental will matter.");
  for (const f of living(state, "friendly").filter((u) => u.kind === "frame")) {
    if (f.faults?.includes("reactor")) deal(state, f, 1, "Frame reactor fault", { noLeech: true });
    const r = rec(state, f.pilot);
    if (r && assignBlock({ ...state, phase: "route" } as GameState, r, f.uid)) {
      log(state, `${r.name} will not get into the frame.`);
      unassign(state, r);
    }
  }
  for (const r of state.roster) {
    if (r.assignment !== "foot") continue;
    const bad = assignBlock({ ...state, phase: "route" } as GameState, r, "foot");
    const slot = freeFriendSlot(state);
    if (bad || slot < 0 || r.hp <= 0) {
      if (bad) unassign(state, r);
      continue;
    }
    spawn(state, "pilot", "friendly", slot, { pilot: r.id, hp: Math.min(r.hp, maxHp(r)), maxHp: maxHp(r), temp: true, note: r.name });
  }
  const present = teamPresent(state);
  for (const { r, u } of fielded(state)) {
    r.boltTurn = undefined;
    if (present && isTeam(r) && r.agreed === "kept") {
      r.agreed = "broken";
      shiftLoyalty(state, r, PR.agreeBroken, "you sent them against their own section, after you promised");
    }
    // Hidden: does this sortie end with them running?
    const b = band(r.loyalty);
    const table = r.custody === "captive" ? PR.betrayCaptive : PR.betrayAlly;
    let p = table[b] + (b <= 3 ? (TRAITS[r.trait]?.betray ?? 0) : 0);
    if (u.kind === "frame" && u.chassis === "light" && p > 0) p += PR.betrayFastFrame;
    if (present && isTeam(r) && p > 0) p += PR.betrayTeamPresent;
    if (has(r, "shackles")) p *= PR.superviseShackles;
    if (has(r, "tracker")) p *= PR.superviseTracker;
    if (allies(state, "jack").some((j) => j.protect === u.uid)) p *= PR.superviseJack;
    if (p > 0 && chance(state, Math.min(0.9, p))) r.boltTurn = 2;
  }
  // Held R-8 captives shout when their section is in the room. Gags stop speech, nothing else.
  if (present) {
    for (const r of state.roster.filter((x) => x.custody === "captive" && isTeam(x) && !x.assignment)) {
      const g = r.slots.findIndex((x) => x && ITEMS[x.id].cat === "gag");
      const gag = g >= 0 ? r.slots[g]!.id : "";
      if (gag === "muffle" && chance(state, PR.muffleSlip)) {
        state.items.push(r.slots[g]!);
        r.slots[g] = null;
        log(state, `${r.name} works the Muffle Wrap loose.`);
      }
      const now = r.slots.find((x) => x && ITEMS[x.id].cat === "gag")?.id ?? "";
      const blocked = now === "voiceseal" || now === "acoustic" || now === "muffle" || (now === "muzzle" && chance(state, 0.5));
      if (!blocked) {
        state.teamScouted = true;
        log(state, `${r.name} shouts to their section through the wall. They know you are here.`);
      } else if (now !== "acoustic" && chance(state, 0.25)) log(state, `[muffled shouting from your holding unit]`);
    }
  }
}

export function pilotsTurnStart(state: GameState) {
  for (const { r, u } of fielded(state)) {
    if (r.boltTurn !== state.turn || u.bolting) continue;
    u.bolting = true;
    u.mood = "PULLING AWAY";
    log(state, `${r.name} keeps looking at the far door.${has(r, "shackles") ? " You could lock the shackles." : ""}`);
  }
}

export function pilotsTurnEnd(state: GameState) {
  for (const r of state.roster) {
    if (r.recovering > 0) r.recovering = Math.max(0, r.recovering - PR.recoverPerTurn);
  }
}

export function lockShackles(state: GameState, u: Unit): boolean {
  const r = rec(state, u.pilot);
  if (!r || !u.bolting || !has(r, "shackles")) return false;
  u.bolting = false;
  u.mood = "shackled";
  r.boltTurn = undefined;
  log(state, `The Remote Release Shackles lock. ${r.name} goes nowhere.`);
  shiftLoyalty(state, r, PR.lockShackles, "you locked them down in the field");
  return true;
}

function runner(state: GameState, r: PilotRec, slot: number) {
  const s = freeEnemySlot(state);
  if (s < 0) {
    log(state, `There is no way through the crowd to chase ${r.name}. They are gone.`);
    void slot;
    return syncAfterBolt(state, r, true);
  }
  spawn(state, "capsule", "enemy", s, { pilot: r.id, role: r.role ?? "runner", hp: Math.max(1, r.hp), maxHp: Math.max(1, maxHp(r)), exitIn: has(r, "ankle") ? 3 : 2, note: `${r.name}, on foot` });
}

function bolt(state: GameState, u: Unit, r: PilotRec) {
  const wasCaptive = r.custody === "captive";
  dropCaptiveRecord(state, r.id);
  r.boltTurn = undefined;
  r.assignment = "";
  if (u.kind === "frame" && u.chassis === "light") {
    state.units = state.units.filter((x) => x.uid !== u.uid);
    log(state, `${r.name} opens the light frame's throttle and is through the far door before you can turn. Frame and pilot are gone.`);
    r.custody = "fleeing";
    syncAfterBolt(state, r, wasCaptive);
    return;
  }
  if (u.kind === "frame") {
    u.pilot = undefined;
    u.bolting = false;
    u.mood = "empty";
    log(state, `${r.name} pops the hatch and runs. The frame stays behind.`);
  } else {
    state.units = state.units.filter((x) => x.uid !== u.uid);
    log(state, `${r.name} breaks away and runs.`);
  }
  r.custody = "fleeing";
  runner(state, r, u.slot);
}
function syncAfterBolt(state: GameState, r: PilotRec, wasCaptive: boolean) {
  // They are clear of the room: the same as any escape.
  void wasCaptive;
  if (state.team.pilots.some((p) => p.id === r.id)) setPilot(state, r.id, "escaped", "bolted in your frame");
  else syncRoster(state, r.id, "escaped");
}

// ---------- in-fight actions ----------

export function frameAct(state: GameState, u: Unit, attack: (tgt: Unit, dmg: number, p: number) => void, fighters: Unit[]) {
  const r = rec(state, u.pilot);
  if (!r) {
    u.mood = "empty";
    return;
  }
  if (u.bolting) return bolt(state, u, r);
  if (u.faults?.includes("movement") && state.turn % 2 === 0) {
    log(state, `${r.name}'s frame lurches on its bad leg and loses the turn.`);
    return;
  }
  if (chance(state, misfire(r))) {
    log(state, `${r.name} freezes at the controls (Madness ${madnessTotal(r)}%).`);
    return;
  }
  let foes = fighters;
  const refuse = isTeam(r) && (r.custody === "captive" ? band(r.loyalty) <= 2 : band(r.loyalty) <= 2);
  if (refuse) foes = foes.filter((e) => !is(e, "team"));
  if (!foes.length) {
    if (refuse && fighters.length) log(state, `${r.name} will not fire on their former section.`);
    return;
  }
  const tgt = foes.slice().sort((a, b) => Math.abs(a.slot - u.slot) - Math.abs(b.slot - u.slot))[0];
  const dmg = Math.max(0, u.atk - (u.faults?.includes("weapon") ? 1 : 0) + assaultBonus(r, u));
  attack(tgt, dmg, frameHit(state, r, u));
}

export function footAct(state: GameState, u: Unit, fighters: Unit[]) {
  const r = rec(state, u.pilot);
  if (!r) return;
  if (u.bolting) return bolt(state, u, r);
  if (chance(state, misfire(r))) {
    log(state, `${r.name} freezes (Madness ${madnessTotal(r)}%).`);
    return;
  }
  const w = weapon(r);
  if (!w) {
    u.mood = "keeping low";
    return;
  }
  let foes = fighters;
  if (isTeam(r) && band(r.loyalty) <= 2) foes = foes.filter((e) => !is(e, "team"));
  const tgt = foes.slice().sort((a, b) => Math.abs(a.slot - u.slot) - Math.abs(b.slot - u.slot))[0];
  if (!tgt) return;
  for (let i = 0; i < (w.shots ?? 1); i++) {
    if (tgt.hp <= 0) break;
    if (!chance(state, clampHit((w.hit ?? 0.7) + accuracy(state, r)))) {
      log(state, `${r.name}'s ${w.name} misses.`);
      continue;
    }
    if (w.stun) {
      if (tgt.kind && ["small", "medium"].includes(String(sizeOf(tgt.kind)))) {
        tgt.stunned = Math.max(tgt.stunned, 1);
        log(state, `${r.name}'s Shock Pistol locks up the ${label(tgt.kind)}.`);
      } else log(state, `The Shock Pistol does nothing to something that size.`);
      continue;
    }
    deal(state, tgt, (w.dmg ?? 1) + assaultBonus(r), `${r.name}'s ${w.name}`, { attackerUid: u.uid, ranged: true });
  }
}
function sizeOf(kind: UnitKind) {
  return UNITS[kind].size;
}

/** Armor, cover and Block are already applied. Stats prevent at most one point per hit. */
export function pilotDefense(state: GameState, u: Unit, dmg: number): number {
  const r = rec(state, u.pilot);
  if (!r || dmg <= 0) return dmg;
  if (has(r, "reflexamp") && chance(state, 0.05)) {
    log(state, `${r.name} is already moving: the shot misses.`);
    return 0;
  }
  if (state.nightmareFight && chance(state, nightmareResist(r))) {
    log(state, `${r.name}'s Mental holds: 1 damage ignored.`);
    return dmg - 1;
  }
  if (chance(state, damageResist(r))) {
    log(state, `${r.name}'s Endurance: 1 damage ignored.`);
    return dmg - 1;
  }
  return dmg;
}
/** One survival check per lethal event, never for an unsurvivable one. */
export function avoidDeath(state: GameState, r: PilotRec): boolean {
  if (chance(state, deathAvoid(r))) {
    log(state, `${r.name} should not have survived that. They are down to 1 HP.`);
    return true;
  }
  return false;
}

/** Damage to a pilot who is not a unit on the lane: gas, a frame coming apart. */
export function exposure(state: GameState, r: PilotRec, dmg: number, why: string, unsurvivable = false): boolean {
  let d = dmg;
  if (d > 0 && state.nightmareFight && chance(state, nightmareResist(r))) d -= 1;
  else if (d > 0 && chance(state, damageResist(r))) {
    d -= 1;
    log(state, `${r.name}'s Endurance takes the edge off.`);
  }
  r.hp -= d;
  if (d > 0) log(state, `${why}: ${r.name} takes ${d}. (${Math.max(0, r.hp)}/${maxHp(r)})`);
  if (r.hp > 0) return true;
  if (!unsurvivable && avoidDeath(state, r)) {
    r.hp = 1;
    return true;
  }
  return false;
}

/** A piloted frame destroyed. Returns the pilot's fate for the caller to apply. */
export function frameLost(state: GameState, f: Unit): "dead" | "away" | "back" | "none" {
  const r = rec(state, f.pilot);
  if (!r) return "none";
  f.pilot = undefined;
  r.assignment = "";
  const seal = f.faults?.includes("seal") && !has(r, "escapebeacon");
  const unsurvivable = !!seal && !!f.faults?.includes("reactor");
  log(state, seal ? `The frame's weak seal jams. ${r.name} is still inside when it comes apart.` : `${r.name} ejects as the frame comes apart.`);
  const alive = exposure(state, r, seal ? PR.sealExposure : PR.ejectExposure, "Frame destroyed", unsurvivable);
  if (!alive) return "dead";
  if (!seal && !has(r, "escapebeacon") && r.spec !== "Recovery" && chance(state, PR.separated)) {
    r.away = 2;
    log(state, `${r.name} came down somewhere else. They will be a room or two finding you.`);
    return "away";
  }
  return "back";
}

export function pilotsFightEnd(state: GameState) {
  let beacon = false;
  for (const { r, u } of fielded(state)) {
    if (u.kind === "pilot") r.hp = Math.max(1, u.hp);
    r.sorties += 1;
    gainXp(state, r, PR.xpSortie, "sortie");
    if (state.nightmareFight) {
      r.madness = Math.min(100, r.madness + PR.nightmareMadness);
      log(state, `${r.name} saw too much in there: +${PR.nightmareMadness}% Madness.`);
    }
    if (r.custody === "captive") gain(state, r, PR.assignGainCaptive, "a sortie done without running");
    else if (band(r.loyalty) < 4) gain(state, r, PR.assignGainAlly, "a sortie together");
    if (u.kind === "frame") {
      const fix = (r.spec === "Recovery" ? (r.level >= 5 ? 2 : 1) : 0) + (has(r, "toolkit") ? 1 : 0);
      if (fix && u.hp < u.maxHp) {
        u.hp = Math.min(u.maxHp, u.hp + fix);
        log(state, `${r.name} patches the frame: ${u.hp}/${u.maxHp}.`);
      }
    }
    if (has(r, "salvagebeacon")) beacon = true;
    r.boltTurn = undefined;
    u.bolting = false;
  }
  if (beacon && state.wrecks.length) {
    const w = state.wrecks.find((x) => !x.free) ?? state.wrecks[0];
    takeWreck(state, w.id);
    addScrap(state, w.value, "Salvage Beacon: a wreck recovered without the noise");
  }
}

/** A separated captive is an escape; a separated crew member just comes back later. */
export function setAwayCaptive(state: GameState, id: string | undefined) {
  const r = rec(state, id);
  if (r?.custody !== "captive") return;
  r.away = 0;
  const holder = state.captives.find((c) => c.pilot === r.id)?.holder;
  if (holder) loseCaptive(state, holder, "came down out of sight and kept going");
}

export function creditKill(state: GameState, killerUid: string | undefined) {
  const k = state.units.find((u) => u.uid === killerUid);
  const r = rec(state, k?.pilot);
  if (!k || k.side !== "friendly" || !r) return;
  r.kills += 1;
  gainXp(state, r, PR.xpKill, "kill");
}

// ---------- frames ----------

export function spawnFrame(state: GameState, chassis: Chassis, faults: string[], hpLoss: number): Unit | undefined {
  const slot = freeFriendSlot(state);
  if (slot < 0) return undefined;
  const [hp, atk, armor] = PR.frameStats[chassis];
  return spawn(state, "frame", "friendly", slot, { chassis, faults, hp: hp - hpLoss, maxHp: hp, atk, armor });
}

export function frameText(f: Unit): string {
  const faults = f.faults?.length ? f.faults.map((x) => FRAME_FAULTS[x].name).join(", ") : "no known faults";
  return `${f.chassis} frame, ${f.hp}/${f.maxHp} HP, ${f.atk} dmg${f.armor ? `, ${f.armor} armor` : ""}. ${faults}.`;
}

// ---------- the fleeing pilot ----------

export function makeFleeing(state: GameState): PilotRec {
  const used = new Set(state.roster.map((r) => r.name));
  const names = FLEE_NAMES.filter((n) => !used.has(n));
  const name = names.length ? pick(state, names) : `Operator ${state.roster.length + 1}`;
  const trait = pick(state, FLEEING_TRAITS);
  const spec = TRAIT_SPEC[trait] ?? pick(state, ["Scout", "Assault", "Recovery", "Heavy", "Command", "Technician"]);
  const r = makePilot(state, { id: "p-x" + state.uidSeq, name, origin: "Unaffiliated", level: 1, spec, trait, loyalty: 55 + Math.floor(roll(state) * 21), custody: "free" });
  state.uidSeq += 1;
  if (chance(state, PR.fleeingMad)) r.recovering = PR.fleeingMadRange[0] + Math.floor(roll(state) * (PR.fleeingMadRange[1] - PR.fleeingMadRange[0] + 1));
  if (trait === "wounded") r.hp = Math.max(1, r.hp - 2);
  if (chance(state, 0.5)) r.slots[0] = newItem(state, pick(state, ["sidearm", "medkit", "scanner", "toolkit"]));
  return r;
}

// ---------- the player's pilot actions ----------

export function medkitCharge(state: GameState, prefer?: PilotRec): ItemInst | undefined {
  const own = prefer && item(prefer, "medkit");
  if (own && (own.charges ?? 0) > 0) return own;
  const inv = state.items.find((x) => x.id === "medkit" && (x.charges ?? 0) > 0);
  if (inv) return inv;
  for (const r of state.roster) {
    if (r.custody !== "ally") continue;
    const m = item(r, "medkit");
    if (m && (m.charges ?? 0) > 0) return m;
  }
  return undefined;
}
export function spendCharge(state: GameState, it: ItemInst) {
  it.charges = (it.charges ?? 1) - 1;
  if (it.charges > 0) return;
  state.items = state.items.filter((x) => x !== it);
  for (const r of state.roster) r.slots = r.slots.map((x) => (x === it ? null : x));
  log(state, "The medkit is empty.");
}

export function gagBlocksTalk(r: PilotRec): boolean {
  return r.slots.some((x) => x && ["muffle", "voiceseal", "acoustic"].includes(x.id));
}

export const OUT_OF_FIGHT = ["route", "tech", "reward", "salvage", "decon"];

export function pilotOpBlock(state: GameState, r: PilotRec, op: string, a: { item?: string; slot?: number; stat?: string; target?: string }): string | null {
  if (!OUT_OF_FIGHT.includes(state.phase)) return "not now";
  if (r.custody !== "ally" && r.custody !== "captive") return "not yours to manage";
  switch (op) {
    case "equip": {
      const it = state.items.find((x) => x.uid === a.item);
      if (!it) return "not in inventory";
      return cannotEquip(r, it, a.slot ?? -1);
    }
    case "unequip":
      return r.slots[a.slot ?? -1] ? null : "empty slot";
    case "unlock":
      if (r.slot4) return "already unlocked";
      return state.parts >= PR.slot4Parts ? null : `needs ${PR.slot4Parts} Cockpit Parts (you have ${state.parts})`;
    case "stat": {
      if (r.points <= 0) return "no points";
      const s = a.stat as Stat;
      if (!STATS.includes(s)) return "no such stat";
      return statOf(r, s) >= statCap(r.level) ? `at the level ${r.level} cap (${statCap(r.level)})` : null;
    }
    case "assign":
      return assignBlock(state, r, a.target ?? "")?.reason ?? null;
    case "talk":
      if (r.custody !== "captive") return "only captives";
      if (r.talkedRoom === state.room) return "already talked this room";
      if (gagBlocksTalk(r)) return "gagged: take it off first";
      return null;
    case "treat":
      if (!medkitCharge(state, r)) return "no medkit charges";
      return r.hp < maxHp(r) || r.injuredUntreated ? null : "not hurt";
    case "agree":
      if (r.custody !== "captive" || !isTeam(r)) return "only captured section pilots";
      return r.agreed ? "already agreed" : null;
    case "recruit":
      if (r.custody !== "captive") return "not a captive";
      return band(r.loyalty) >= 3 ? null : `needs Cooperative (${PR.bands[3]}+); now ${BAND_NAMES[band(r.loyalty)]}`;
    case "tighten":
      if (r.custody !== "captive") return "not a captive";
      if (state.phase !== "tech") return "at a Tech Stop";
      if (r.tightenedRoom === state.room) return "already tightened this room";
      return state.scrap >= PR.tightenScrap ? null : "needs 1 Scrap";
  }
  return "unknown";
}

export function pilotOp(state: GameState, id: string, op: string, a: { item?: string; slot?: number; stat?: string; target?: string }) {
  const r = rec(state, id);
  if (!r || pilotOpBlock(state, r, op, a)) return;
  switch (op) {
    case "equip": {
      const it = state.items.find((x) => x.uid === a.item)!;
      state.items = state.items.filter((x) => x !== it);
      const prev = r.slots[a.slot!];
      if (prev) state.items.push(prev);
      r.slots[a.slot!] = it;
      log(state, `${r.name}: ${ITEMS[it.id].name} fitted${prev ? `, replacing ${ITEMS[prev.id].name}` : ""}.`);
      break;
    }
    case "unequip": {
      const it = r.slots[a.slot!]!;
      r.slots[a.slot!] = null;
      state.items.push(it);
      log(state, `${r.name}: ${ITEMS[it.id].name} removed.`);
      break;
    }
    case "unlock":
      state.parts -= PR.slot4Parts;
      r.slot4 = true;
      note(r, "Fourth slot fitted.");
      log(state, `${r.name}'s fourth equipment slot is unlocked. It stays theirs.`);
      break;
    case "stat":
      r.earned[a.stat as Stat] += 1;
      r.points -= 1;
      log(state, `${r.name}: +1 ${a.stat}.`);
      break;
    case "assign":
      assign(state, r, a.target ?? "");
      break;
    case "talk": {
      r.talkedRoom = state.room;
      const b = band(r.loyalty);
      log(state, `You sit down with ${r.name} for a while.`);
      gain(state, r, b === 0 ? PR.talkGainHostile : PR.talkGain, "talked");
      break;
    }
    case "treat": {
      spendCharge(state, medkitCharge(state, r)!);
      r.hp = Math.min(maxHp(r), r.hp + 2);
      log(state, `${r.name} treated: ${r.hp}/${maxHp(r)} HP.`);
      if (r.custody === "captive" && r.injuredUntreated) {
        r.injuredUntreated = false;
        gain(state, r, PR.treatGain, "you treated their injuries");
      }
      r.injuredUntreated = false;
      break;
    }
    case "agree":
      r.agreed = "kept";
      log(state, `You promise ${r.name} they will never be sent against their own section.`);
      gain(state, r, PR.agreeGain, "an agreement");
      break;
    case "recruit":
      dropCaptiveRecord(state, r.id);
      moveToInventory(state, r, (d) => d.side === "captive", `${r.name}'s restraints come off`);
      r.custody = "ally";
      r.strain = 0;
      note(r, "Joined your crew.");
      log(state, `${r.name} joins your crew.`);
      if (isTeam(r)) setPilot(state, r.id, "turned");
      break;
    case "tighten":
      state.scrap -= PR.tightenScrap;
      r.tightenedRoom = state.room;
      r.strain = Math.max(0, r.strain - PR.tightenAmount);
      log(state, `You re-seat ${r.name}'s restraints.`);
      break;
  }
}

export function rollShop(state: GameState) {
  const pool = state.captives.length ? [...ALLY_ITEMS, ...CAPTIVE_ITEMS] : [...ALLY_ITEMS, ...CAPTIVE_ITEMS.filter((x) => ["muffle", "plockbands", "cuffs"].includes(x))];
  state.shop = [];
  for (let i = 0; i < PR.shopSize; i++) state.shop.push(pick(state, pool));
}
export function buy(state: GameState, index: number) {
  const id = state.shop[index];
  if (!id || state.phase !== "tech") return;
  const price = ITEMS[id].price;
  if (state.scrap < price) return;
  state.scrap -= price;
  state.items.push(newItem(state, id));
  state.shop = state.shop.map((x, i) => (i === index ? "" : x));
  log(state, `Bought ${ITEMS[id].name} for ${price} Scrap.`);
}

export function crewCount(state: GameState): number {
  return state.roster.filter((r) => r.custody === "ally" || r.custody === "captive").length;
}

