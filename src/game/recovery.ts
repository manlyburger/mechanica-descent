// Brief 6: what is left on the floor after the shooting stops. Escape pods
// (named and anonymous), Lil Robobuddy's shell and the wreck Scrap that can
// rebuild it, and abandoned R-8 frames you can claim. One screen,
// "COMBAT COMPLETE — RECOVERY AVAILABLE", before custody and the room's exit.

import { RULES, UNITS, label, type UnitKind } from "./data";
import { addScrap, chance, deal, freeEnemySlot, freeFriendSlot, jubey, living, log, pick, roll, spawn, takeWreck } from "./core";
import { freeClampjaw, podFits, secured, takeCaptive, vacantPod, type CustodyItem } from "./capture";
import { BAND_NAMES, band, makePilot, maxHp, medkitCharge, newItem, partyObservation, rec, spawnFrame, spendCharge, statOf } from "./pilots";
import { FLEE_NAMES, FRAME_FAULTS, PR, type Chassis, type Spec } from "./pilots-data";
import type { EventView, Option } from "./events";
import type { GameState, PilotRec, PodRec, Unit, Wreck } from "./state";
import { setPilot } from "./team";

export const isRecovery = (id: string) => id === "recovery";
const opt = (id: string, name: string, detail: string, enabled = true): Option => ({ id, label: name, detail, enabled });

// ---------- Lil Robobuddy ----------

export function buddyDown(state: GameState) {
  const b = state.buddy;
  if (b.status === "wrecked") return;
  b.status = "wrecked";
  b.penalty = true;
  b.deaths += 1;
  log(state, `LIL ROBOBUDDY DISABLED. The shell holds together. Rebuild it from ${RULES.buddyRebuildCost} wreck Scrap after the fight, or leaving it costs +${RULES.buddyLossThreat} Threat.`);
}
export function buddyMaxHp(): number {
  return UNITS.robobuddy.hp;
}
export function wreckScrap(w: Wreck): number {
  return w.value * RULES.salvageScrap;
}
/** Wrecks with enough Scrap left in them for a rebuild. */
export function rebuildWrecks(state: GameState): Wreck[] {
  return state.wrecks.filter((w) => wreckScrap(w) >= RULES.buddyRebuildCost);
}
export function rebuildBlock(state: GameState, wreckId?: string): string | null {
  if (state.buddy.status !== "wrecked") return "Robobuddy is not wrecked";
  const ok = rebuildWrecks(state);
  if (!ok.length) {
    const best = Math.max(0, ...state.wrecks.map(wreckScrap));
    return state.wrecks.length ? `No wreck holds ${RULES.buddyRebuildCost} Scrap (best: ${best}).` : "No wreckage here to rebuild from.";
  }
  if (wreckId && !ok.some((w) => w.id === wreckId)) return "That wreck does not hold enough Scrap.";
  if (freeFriendSlot(state) < 0) return "No room on the line for it.";
  return null;
}
/** Takes the Scrap out of one wreck and puts Robobuddy back together. The Scrap is gone from the wreck: it cannot be stripped again. */
export function rebuildBuddy(state: GameState, wreckId: string): boolean {
  if (rebuildBlock(state, wreckId)) return false;
  const w = state.wrecks.find((x) => x.id === wreckId)!;
  w.value -= RULES.buddyRebuildCost / RULES.salvageScrap;
  if (w.value <= 0) takeWreck(state, w.id);
  const hp = Math.ceil(buddyMaxHp() * RULES.buddyRebuildHp);
  spawn(state, "robobuddy", "friendly", freeFriendSlot(state), { hp, maxHp: buddyMaxHp() });
  const b = state.buddy;
  const avoided = b.penalty;
  b.status = "active";
  b.penalty = false;
  b.rebuilt += 1;
  log(state, `ROBOBUDDY RECONSTRUCTED from the ${w.pile ? "spilled cargo" : label(w.kind) + " wreck"}: −${RULES.buddyRebuildCost} Scrap from it, ${hp}/${buddyMaxHp()} HP. ${avoided ? `Pending +${RULES.buddyLossThreat} Threat avoided.` : "The Threat from leaving it earlier stands."}`);
  return true;
}
/** Leaving the room with Robobuddy still a shell: the loss is felt once per destruction. */
export function settleBuddy(state: GameState) {
  const b = state.buddy;
  if (b.status !== "wrecked" || !b.penalty) return;
  b.penalty = false;
  state.threat += RULES.buddyLossThreat;
  log(state, `You carry Lil Robobuddy's shell out unrepaired. Threat +${RULES.buddyLossThreat} (${state.threat}). It can still be rebuilt from a later wreck.`);
}

// ---------- anonymous ejection ----------

const ORIGIN_SPECS: Partial<Record<UnitKind, Spec[]>> = {
  light: ["Scout", "Assault"],
  lvl2: ["Assault", "Heavy"],
  powered: ["Assault"],
  needleback: ["Scout"],
  latchback: ["Assault"],
  widow: ["Recovery", "Technician"],
  kilnheart: ["Heavy", "Assault"],
  bishop: ["Command"],
  hunter: ["Assault", "Heavy"],
  tracker: ["Scout"],
  predator: ["Recovery", "Technician"],
};
const ORIGIN_CHASSIS: Partial<Record<UnitKind, Chassis>> = {
  light: "light", needleback: "light", tracker: "light", lvl2: "medium", latchback: "medium", widow: "medium", bishop: "medium", powered: "medium", kilnheart: "heavy", hunter: "heavy", predator: "heavy",
};
export function chassisFor(kind: UnitKind): Chassis {
  return ORIGIN_CHASSIS[kind] ?? "medium";
}

/** An ordinary mech going down may fire its cockpit. Returns the reserved pilot id for its wreck's Cockpit Parts key. */
export function anonEject(state: GameState, u: Unit): string | undefined {
  const p = RULES.anonEject[u.kind];
  if (!p || u.pilot || u.stalkerId || !chance(state, p)) return undefined;
  const slot = freeEnemySlot(state);
  if (slot < 0) return undefined;
  const reserved = `p-a${state.uidSeq++}`;
  const empty = chance(state, RULES.anonEmptyPod);
  spawn(state, "capsule", "enemy", slot, { role: u.kind, reserved, occupant: empty ? "empty" : "unresolved", exitIn: 2, note: "escape pod" });
  log(state, `The ${label(u.kind)}'s cockpit punches out as it falls. An escape pod skids into column ${slot + 1}.`);
  return reserved;
}

/** Ground pods still on the floor when the last fighter drops. Flying pods and runners are still getting away. */
export function grounded(u: Unit): boolean {
  return u.kind === "capsule" && !u.flying && u.role !== "runner" && !secured(u);
}

/** A pod that was clamped during the fight: who is inside is settled now, once, so custody sees a person. */
export function resolveCapsule(state: GameState, u: Unit) {
  if (u.pilot || u.kind !== "capsule" || !u.occupant) return;
  const pod: PodRec = { id: u.uid, origin: (u.role as UnitKind) ?? "light", occupant: u.occupant, hp: u.hp, maxHp: u.maxHp, srcKey: "pilot:" + (u.reserved ?? u.uid), opened: true, subdued: false, helped: false, asked: false, tried: false, resolved: true, secured: true };
  const r = resolveOccupant(state, pod);
  u.occupant = undefined;
  if (r) u.pilot = r.id;
}

export function collectPods(state: GameState) {
  for (const u of living(state, "enemy").filter(grounded)) {
    const named = !!u.pilot;
    state.pods.push({
      id: u.uid,
      origin: (u.role as UnitKind) ?? "light",
      pilot: u.pilot,
      occupant: named ? "named" : u.occupant === "empty" ? "empty" : "unresolved",
      hp: u.hp,
      maxHp: u.maxHp,
      srcKey: "pilot:" + (u.pilot ?? u.reserved ?? u.uid),
      opened: false,
      subdued: false,
      helped: false,
      asked: false,
      tried: false,
      resolved: false,
      secured: false,
    });
    state.units = state.units.filter((x) => x.uid !== u.uid);
  }
}

// ---------- pod occupants ----------

function depthLevel(state: GameState, origin: UnitKind): number {
  const base = 1 + Math.floor((state.room - 1) / 4) + (origin === "lvl2" ? 1 : 0);
  return Math.max(1, Math.min(PR.maxLevel, base));
}
const OUTCOME_TRAITS = {
  cooperative: ["pragmatic", "quiet", "rookie"],
  frightened: ["frightened", "rookie"],
  hostile: ["defiant", "stubborn", "overconfident"],
  incapacitated: ["wounded", "quiet"],
} as const;
const OUTCOME_LOYALTY = { cooperative: [48, 64], frightened: [30, 44], hostile: [5, 22], incapacitated: [35, 50] } as const;
const SPEC_GEAR: Record<Spec, string> = { Scout: "scanner", Assault: "sidearm", Recovery: "medkit", Heavy: "padding", Command: "sync", Technician: "toolkit" };

function rollOutcome(state: GameState): PodRec["outcome"] {
  const w = RULES.podOutcome;
  let r = roll(state);
  for (const k of ["cooperative", "frightened", "hostile", "incapacitated"] as const) if ((r -= w[k]) < 0) return k;
  return "cooperative";
}

/** One occupant per pod, made the first time it is opened, from what the pod came out of. */
export function resolveOccupant(state: GameState, pod: PodRec): PilotRec | undefined {
  if (pod.occupant === "empty") {
    pod.outcome = "empty";
    return undefined;
  }
  if (pod.occupant === "named") {
    const r = rec(state, pod.pilot);
    if (!r) return undefined;
    pod.outcome = r.hp <= 1 ? "incapacitated" : band(r.loyalty) === 0 ? "hostile" : band(r.loyalty) === 1 ? "frightened" : "cooperative";
    return r;
  }
  const outcome = rollOutcome(state)!;
  const used = new Set(state.roster.map((x) => x.name));
  const names = FLEE_NAMES.filter((n) => !used.has(n));
  const id = pod.srcKey.slice("pilot:".length);
  const spec = pick(state, ORIGIN_SPECS[pod.origin] ?? ["Assault"]);
  const [lo, hi] = OUTCOME_LOYALTY[outcome as keyof typeof OUTCOME_LOYALTY];
  const r = makePilot(state, {
    id,
    name: names.length ? pick(state, names) : `Operator ${state.roster.length + 1}`,
    origin: `Pilot of a ${label(pod.origin)}`,
    level: depthLevel(state, pod.origin),
    spec,
    trait: pick(state, OUTCOME_TRAITS[outcome as keyof typeof OUTCOME_TRAITS] as unknown as string[]),
    loyalty: lo + Math.floor(roll(state) * (hi - lo + 1)),
    custody: "free",
  });
  r.eligible = pod.origin;
  r.partsKey = pod.srcKey;
  if (chance(state, 0.6)) r.slots[0] = newItem(state, SPEC_GEAR[spec as Spec]);
  if (outcome === "frightened") r.recovering = 10 + Math.floor(roll(state) * 16);
  if (outcome === "incapacitated") {
    r.hp = 1;
    r.injuredUntreated = true;
    r.rest = 1;
  }
  r.history = [`Pulled from a ${label(pod.origin)} escape pod in room ${state.room}.`];
  state.roster.push(r);
  pod.pilot = r.id;
  pod.outcome = outcome;
  return r;
}

function holderFor(state: GameState): Unit | undefined {
  return freeClampjaw(state) ?? (podFits("capsule", false) ? vacantPod(state) : undefined);
}

export function secureBlock(state: GameState, pod: PodRec): string | null {
  if (pod.outcome === "hostile" && !pod.subdued) return "Hostile and fighting the hatch: subdue them first.";
  if (!holderFor(state)) return "Nothing free to hold a person: a Clampjaw or a Containment Pod holds one captive each.";
  return null;
}
export function recruitBlock(pod: PodRec, r: PilotRec | undefined): string | null {
  if (!r) return "nobody to talk to";
  if (pod.outcome === "hostile") return "Hostile: they will not hear it here.";
  if (pod.outcome === "incapacitated" && !pod.helped) return "Unconscious. Treat them first.";
  if (pod.tried) return "You already asked.";
  return null;
}
export function recruitChance(pod: PodRec, r: PilotRec): number {
  return Math.max(0.05, Math.min(0.9, 0.15 + (r.loyalty - 25) / 50 + (pod.helped ? 0.15 : 0)));
}

function finish(pod: PodRec) {
  pod.resolved = true;
}

// ---------- the recovery screen ----------

export function abandonedFrames(state: GameState): Wreck[] {
  return state.wrecks.filter((w) => !!w.abandoned);
}

/** Is there anything for the recovery screen to show? */
export function recoveryAvailable(state: GameState): boolean {
  if (state.pods.some((p) => !p.resolved)) return true;
  if (state.buddy.status === "wrecked" && (state.buddy.penalty || rebuildWrecks(state).length > 0)) return true;
  return abandonedFrames(state).length > 0;
}

export function openRecoveryScreen(state: GameState) {
  state.phase = "event";
  state.event = { id: "recovery", data: {}, lines: [] };
}

function focus(state: GameState): PodRec | undefined {
  return state.pods.find((p) => p.opened && !p.resolved);
}

export function recoveryView(state: GameState): EventView {
  const lines: string[] = [];
  const open = state.pods.filter((p) => !p.resolved);
  const scrap = state.wrecks.reduce((n, w) => n + wreckScrap(w), 0);
  const frames = abandonedFrames(state);
  if (open.length) lines.push(`• ${open.length} escape pod${open.length > 1 ? "s" : ""} remaining.`);
  if (state.wrecks.length) lines.push(`• ${state.wrecks.length} wreck${state.wrecks.length > 1 ? "s" : ""} available (${scrap} Scrap in all).`);
  if (frames.length) lines.push(`• ${frames.length} damaged mech chassis.`);
  const b = state.buddy;
  if (b.status === "wrecked") {
    const best = Math.max(0, ...state.wrecks.map(wreckScrap));
    lines.push(`ROBOBUDDY DISABLED · Eligible wreck salvage: ${best} Scrap · Recovery requirement: ${RULES.buddyRebuildCost} Scrap.${b.penalty ? ` Reconstruction avoids the pending +${RULES.buddyLossThreat} Threat.` : " (Its Threat was already paid.)"}`);
  }
  const said = state.event?.lines ?? [];

  const o: Option[] = [];
  const f = focus(state);
  if (f) {
    const r = rec(state, f.pilot);
    if (r) {
      const heading = `${r.name} · ${r.origin} · level ${r.level} ${r.spec} · ${({ cooperative: "COOPERATIVE", frightened: "FRIGHTENED", hostile: "HOSTILE", incapacitated: "INCAPACITATED" } as Record<string, string>)[f.outcome ?? ""] ?? ""}`;
      lines.push(heading);
      if (f.asked) lines.push(`Stats: Mental ${statOf(r, "mental")} · Skill ${statOf(r, "skill")} · Endurance ${statOf(r, "endurance")} · Obv ${statOf(r, "observation")} · ${BAND_NAMES[band(r.loyalty)]}${r.eligible ? ` · qualified for a ${label(r.eligible)}` : ""}.`);
      lines.push(...said);
      if (f.outcome === "hostile" && !f.subdued) {
        o.push(opt("subdue", "Subdue them", `${Math.round(subdueChance(state) * 100)}%. Fail and they hit back and run.`));
      } else {
        const sb = secureBlock(state, f);
        o.push(opt("secure", "Secure as captive", sb ?? "Into a free Clampjaw or Containment Pod.", !sb));
      }
      const rb = recruitBlock(f, r);
      o.push(opt("recruit", "Attempt peaceful recruitment", rb ?? `${Math.round(recruitChance(f, r) * 100)}% they agree. ${f.outcome === "frightened" ? "If not, they bolt." : ""}`, !rb));
      const kit = medkitCharge(state);
      const mb = f.helped ? "Already treated." : f.outcome === "hostile" && !f.subdued ? "They will not let you near." : !kit && state.scrap < 1 ? "No medkit and no Scrap for a field dressing." : null;
      o.push(opt("medical", "Offer medical assistance", mb ?? (kit ? "Uses one medkit charge." : "1 Scrap: a field dressing."), !mb));
      o.push(opt("question", "Question or inspect", f.asked ? "Done." : "Stats, loyalty and the mech they are qualified for.", !f.asked));
      o.push(opt("release", "Release", f.pilot && state.team.pilots.some((p) => p.id === f.pilot) ? "They walk. R-8 will get them back into a frame." : "They walk away."));
      return { title: "COMBAT COMPLETE — RECOVERY AVAILABLE", lines, options: o };
    }
  }
  lines.push(...said);
  for (const p of open) {
    if (p.opened) continue;
    o.push(opt(`open:${p.id}`, `OPEN ESCAPE POD — ${label(p.origin)}`, p.occupant === "named" ? "The pod's transponder still answers." : "One occupant at most. Whoever it is."));
  }
  if (b.status === "wrecked") {
    const ok = rebuildWrecks(state);
    const why = rebuildBlock(state);
    if (why) o.push(opt("rebuild-none", "RECONSTRUCT ROBOBUDDY", why, false));
    else for (const w of ok) o.push(opt(`rebuild:${w.id}`, `RECONSTRUCT ROBOBUDDY from the ${w.pile ? "spilled cargo" : label(w.kind) + " wreck"}`, `${wreckScrap(w)} Scrap → ${wreckScrap(w) - RULES.buddyRebuildCost} left to strip. ${Math.ceil(buddyMaxHp() * RULES.buddyRebuildHp)} HP.`));
  }
  for (const w of frames) {
    const slot = freeFriendSlot(state);
    o.push(opt(`claim:${w.id}`, `Claim the abandoned ${label(w.kind)} chassis`, slot < 0 ? "No room on the line." : `A damaged ${w.abandoned} frame for your crew. It will not be stripped.`, slot >= 0));
  }
  const left = open.filter((p) => !p.opened).length;
  o.push(opt("done", "Leave the rest", `${left ? `${left} unopened pod${left > 1 ? "s" : ""} will be abandoned. ` : ""}${b.status === "wrecked" && b.penalty ? `Robobuddy stays a shell: +${RULES.buddyLossThreat} Threat. ` : ""}Wrecks can still be stripped.`));
  return { title: "COMBAT COMPLETE — RECOVERY AVAILABLE", lines, options: o };
}

function subdueChance(state: GameState): number {
  const fighters = state.roster.filter((r) => r.custody === "ally" && r.hp > 0 && r.away <= 0);
  const best = Math.max(0, ...fighters.map((r) => statOf(r, "endurance")));
  return Math.min(0.95, RULES.subdue + best * 0.02);
}

function say(state: GameState, line: string) {
  state.event?.lines.push(line);
  log(state, line);
}

/** Returns true when the screen is finished. */
export function resolveRecovery(state: GameState, option: string): boolean {
  const view = recoveryView(state);
  const chosen = view.options.find((o) => o.id === option);
  if (!chosen || !chosen.enabled) return false;
  if (state.event) state.event.lines = [];
  const f = focus(state);
  const r = f ? rec(state, f.pilot) : undefined;

  if (option.startsWith("open:")) {
    const pod = state.pods.find((p) => p.id === option.slice(5));
    if (!pod) return false;
    pod.opened = true;
    const who = resolveOccupant(state, pod);
    if (!who) {
      finish(pod);
      say(state, "Hatch already open. Whoever was inside got out during the fight.");
      if (chance(state, 0.5)) addScrap(state, 1, "An emergency kit left behind in the pod");
      return false;
    }
    const lines: Record<string, string> = {
      cooperative: `${who.name} climbs out with their hands where you can see them.`,
      frightened: `${who.name} is shaking. They look at the exit, then at you.`,
      hostile: `${who.name} has the hatch locked from inside and is kicking at the release.`,
      incapacitated: `${who.name} is slumped in the harness. Breathing.`,
    };
    say(state, lines[pod.outcome ?? "cooperative"]);
    const { obv, who: eye } = partyObservation(state);
    if (obv >= 6 && pod.outcome === "hostile") say(state, `${eye} spots a sidearm wedged beside the seat before the hatch is fully up.`);
    return false;
  }
  if (option.startsWith("rebuild:")) {
    rebuildBuddy(state, option.slice(8));
    return false;
  }
  if (option.startsWith("claim:")) {
    const w = state.wrecks.find((x) => x.id === option.slice(6));
    if (!w?.abandoned) return false;
    const chassis = w.abandoned as Chassis;
    const [hp] = PR.frameStats[chassis];
    const fault = pick(state, Object.keys(FRAME_FAULTS));
    const frame = spawnFrame(state, chassis, [fault], Math.floor(hp / 2));
    if (!frame) return false;
    takeWreck(state, w.id);
    say(state, `You claim the abandoned ${label(w.kind)} chassis: ${chassis} frame, ${frame.hp}/${frame.maxHp} HP, ${FRAME_FAULTS[fault].name.toLowerCase()}. Assign a pilot at the Tech Stop.`);
    return false;
  }
  if (option === "done") {
    leaveRecovery(state);
    return true;
  }
  if (!f || !r) return false;

  switch (option) {
    case "subdue": {
      if (chance(state, subdueChance(state))) {
        f.subdued = true;
        say(state, `You get ${r.name} out of the harness and face down on the deck.`);
      } else {
        const j = jubey(state);
        say(state, `${r.name} comes out swinging, catches the rig with something heavy, and is gone down the hall.`);
        if (j) deal(state, j, 1, `${r.name}'s parting shot`, { noLeech: true });
        setPilot(state, r.id, "escaped", "broke out of the pod");
        finish(f);
      }
      return false;
    }
    case "secure": {
      const holder = holderFor(state)!;
      const item: CustodyItem = { id: f.id, kind: "capsule", pilot: r.id, person: false, label: `${r.name}, from the escape pod`, bands: 0, hp: Math.max(1, r.hp), tapped: true };
      takeCaptive(state, item, holder);
      f.secured = true;
      finish(f);
      return false;
    }
    case "recruit": {
      f.tried = true;
      if (chance(state, recruitChance(f, r))) {
        if (state.team.pilots.some((p) => p.id === r.id)) setPilot(state, r.id, "turned");
        r.custody = "ally";
        r.history = [`Joined your crew out of an escape pod in room ${state.room}.`, ...r.history];
        say(state, `${r.name} takes the hand up. They are with you. Loyalty ${BAND_NAMES[band(r.loyalty)]}.`);
        finish(f);
      } else if (f.outcome === "frightened") {
        say(state, `${r.name} shakes their head and runs for it.`);
        setPilot(state, r.id, "escaped", "ran from the pod");
        finish(f);
      } else say(state, `${r.name} says no. Not yet.`);
      return false;
    }
    case "medical": {
      f.helped = true;
      const kit = medkitCharge(state);
      if (kit) spendCharge(state, kit);
      else state.scrap -= 1;
      r.hp = Math.max(r.hp, Math.ceil(maxHp(r) / 2));
      r.injuredUntreated = false;
      r.loyalty = Math.min(100, r.loyalty + 10);
      if (f.outcome === "incapacitated") say(state, `${r.name} comes round under your hands. They will need a room before they can fly.`);
      else say(state, `You patch ${r.name} up. They watch you do it.`);
      return false;
    }
    case "question": {
      f.asked = true;
      say(state, `${r.name}: ${r.origin}. ${r.spec}. ${r.eligible ? `Flies ${label(r.eligible)}s.` : ""}`);
      return false;
    }
    case "release":
      setPilot(state, r.id, "escaped", "you let them go");
      say(state, `${r.name} walks away down the hall.`);
      finish(f);
      return false;
  }
  return false;
}

/** Leaving: unopened pods are abandoned, an opened pilot walks, and Robobuddy's loss is settled. */
export function leaveRecovery(state: GameState) {
  for (const p of state.pods) {
    if (p.resolved) continue;
    p.resolved = true;
    if (p.opened && p.pilot) setPilot(state, p.pilot, "escaped", "left at the pod");
    else if (p.occupant === "named" && p.pilot) {
      const r = rec(state, p.pilot);
      log(state, `You leave the ${label(p.origin)} pod sealed. ${r?.name ?? "Its pilot"} slips away after you go.`);
      setPilot(state, p.pilot, "escaped", "left in the pod");
    } else log(state, `The ${label(p.origin)} pod stays sealed behind you.`);
  }
  state.pods = [];
  settleBuddy(state);
  state.event = null;
}
