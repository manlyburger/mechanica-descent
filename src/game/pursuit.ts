// In-fight behavior added by brief 4: melee closing, ejectable cockpits and
// escape capsules, the five R-8 chassis, the Kilnheart reactor, and Bishop's
// one team order per round. Hooks into core's planning and acting.

import { RULES, UNITS, label } from "./data";
import { addWreck, attackPlan, chance, deal, freeEnemySlot, is, living, log, pick, spawn, toDiscard, unit } from "./core";
import { secured, struggle } from "./capture";
import { chassisFor } from "./recovery";
import type { GameState, Plan, Unit } from "./state";
import { bishopCommanding, coordination, ejectAt, pursuing, radio, say, setPilot } from "./team";
import { WEDGED_DISTRESS, type Role } from "./team-text";

export const PROX_NAMES = ["DISTANT", "CLOSING", "MELEE READY"];

/** Enemies allied machines will shoot at: not restrained, not a fleeing capsule. */
export function fighters(state: GameState): Unit[] {
  return living(state, "enemy").filter((u) => !secured(u) && u.kind !== "capsule");
}
/**
 * Enemies that keep a fight going. A flying pod or a running pilot is still
 * getting away; a pod sitting on the floor waits for the recovery screen.
 */
export function hostiles(state: GameState): Unit[] {
  return living(state, "enemy").filter((u) => !secured(u) && !(u.kind === "capsule" && !u.flying && u.role !== "runner"));
}
export function engaged(u: Unit): boolean {
  return (u.prox ?? 0) >= RULES.proxEngaged;
}
function teamMechs(state: GameState): Unit[] {
  return living(state, "enemy").filter((u) => is(u, "team") && !!u.pilot && u.kind !== "capsule");
}
function capsuleToRecover(state: GameState): Unit | undefined {
  return living(state, "enemy").find((u) => u.kind === "capsule" && !u.towed && !secured(u));
}

// ---------- planning ----------

function wantsOut(state: GameState, u: Unit): boolean {
  if (!u.pilot || !is(u, "team")) return false;
  if (u.kind === "kilnheart") return (u.heat ?? 0) >= 2;
  if (u.cap) return true; // a restrained frame is a reason to leave it
  if (u.hp <= ejectAt(u)) return true;
  // Bishop does not fight to the death: alone on the field, it leaves.
  return u.kind === "bishop" && hostiles(state).filter((x) => x.uid !== u.uid && x.kind !== "capsule").length === 0 && u.hp < u.maxHp;
}

function ejectPlan(state: GameState, u: Unit): Plan {
  if (!u.ejecting) {
    u.ejecting = true;
    if (u.kind === "needleback") radio(state, "ep1-withdraw");
    if (u.kind === "bishop") radio(state, "bishop-cornered");
  }
  const blocked = (u.wedge ?? 0) > 0;
  return { type: "eject", note: blocked ? "EJECTION BLOCKED" : "PREPARING TO EJECT" };
}

function latchTarget(state: GameState, u: Unit): Unit | undefined {
  const mine = living(state, "friendly").filter((f) => !f.foam && !f.elevated && !f.shutdown);
  const prize = mine.find((f) => f.kind === "clampjaw" && (f.holding || living(state, "enemy").some((e) => e.cap?.by === f.uid)))
    ?? mine.find((f) => f.kind === "pod" && f.holding)
    ?? mine.find((f) => f.kind === "builder")
    ?? mine.find((f) => f.kind === "shepherd")
    ?? mine.find((f) => f.kind === "warframe" && f.inert);
  void u;
  return prize;
}

/** Returns a plan for anything this module owns, or null to fall through to core. */
export function planSpecial(state: GameState, u: Unit): Plan | null {
  if (u.kind === "capsule") {
    if (u.cap) return { type: "struggle", note: u.cap.state === "securing" ? "being secured" : "secured" };
    return { type: "flee", note: u.towed ? "under tow: gone next action" : `leaving in ${u.exitIn ?? 1}` };
  }
  if (u.kind === "relay") return { type: "hold", note: "carrying R-8's command net" };

  if (u.kind === "kilnheart" && (u.heat ?? 0) >= 2 && (u.fuse ?? 0) <= 1) return { type: "detonate", note: "REACTOR FAILURE THIS TURN" };

  if (wantsOut(state, u)) {
    if (u.kind === "kilnheart" && !u.refused && chance(state, RULES.kilnStubborn)) {
      u.refused = true;
      radio(state, "ep4-furnace");
    } else return ejectPlan(state, u);
  }
  if (u.cap) return { type: "struggle", note: u.cap.state === "securing" ? "being secured" : "straining at the restraints" };

  if (u.kind === "widow" && u.pilot) {
    if (capsuleToRecover(state)) return { type: "recover", note: "moving to recover the capsule" };
    if (state.wrecks.length && chance(state, RULES.widowScavenge)) return { type: "scavenge", note: "winching up wreckage" };
  }
  if (u.kind === "needleback" && u.pilot && state.turn % 2 === 1 && teamMechs(state).length > 1) {
    return { type: "mark", note: "marking a target for the section" };
  }

  if (is(u, "melee")) {
    const prox = u.prox ?? 0;
    const heat = u.kind === "kilnheart" && (u.heat ?? 0) >= 2 ? ` · REACTOR CRITICAL: ${u.fuse}` : "";
    if (prox < RULES.proxEngaged) {
      if (u.kind === "latchback" && prox === 0 && chance(state, 0.5)) return { type: "rush", note: "HYDRAULIC RUSH: closing all the way" + heat };
      return { type: "approach", note: (prox === 0 ? "closing in" : "almost in reach") + heat };
    }
    const t = u.kind === "latchback" ? latchTarget(state, u) : undefined;
    const p = attackPlan(state, u, t);
    return heat ? { ...p, note: heat.slice(3) } : p;
  }
  return null;
}

// ---------- ejection ----------

function chassisGone(state: GameState, u: Unit) {
  state.units = state.units.filter((x) => x.uid !== u.uid);
  for (const n of state.units) {
    if (n.clamp === u.uid) n.clamp = undefined;
    if (n.guardBy === u.uid) n.guardBy = undefined;
  }
  if (u.leech && !u.leech.temp) toDiscard(state, u.leech.cardUid);
}

function launch(state: GameState, u: Unit) {
  const role = u.kind as Role;
  const def = UNITS[u.kind];
  log(state, `${label(u.kind)} EJECTS. ${def.ejection}`);
  const critical = u.kind === "kilnheart" && (u.heat ?? 0) >= 2;
  const pilotId = u.pilot;
  u.pilot = undefined; // the pilot now belongs to the capsule, never to both
  chassisGone(state, u);
  let slot = u.slot;
  if (u.kind === "latchback") {
    const other = freeEnemySlot(state);
    if (other >= 0) slot = other;
  }
  // A Critical Kilnheart goes up behind the rocket; the capsule is already clear of it.
  if (critical) explode(state, u, false);
  else {
    addWreck(state, { kind: u.kind, side: "enemy", value: 2, src: "pilot:" + pilotId, abandoned: chassisFor(u.kind) });
    log(state, "The abandoned frame is yours to strip, or to claim after the fight.");
  }
  spawn(state, "capsule", "enemy", slot, {
    pilot: pilotId,
    role,
    hp: role === "bishop" ? RULES.bishopPodHp : RULES.capsuleHp,
    maxHp: role === "bishop" ? RULES.bishopPodHp : RULES.capsuleHp,
    exitIn: def.capsuleTurns ?? 1,
    flying: role === "bishop",
    note: role === "bishop" ? "flying command pod" : `${label(u.kind)} cockpit`,
  });
}

function explode(state: GameState, u: Unit, pilotInside: boolean) {
  log(state, "KILNHEART REACTOR FAILURE. The frame goes up.");
  const near = living(state, "enemy").filter((e) => e.uid !== u.uid && Math.abs(e.slot - u.slot) <= 1);
  for (const e of near) deal(state, e, RULES.kilnBlast, "Reactor blast", { noLeech: true });
  if (engaged(u)) {
    const t = unit(state, u.plan?.targetUid) ?? living(state, "friendly").find((f) => f.kind === "jubey");
    if (t && t.side === "friendly") deal(state, t, RULES.kilnBlast, "Reactor blast", { noLeech: true });
  }
  if (pilotInside && u.pilot) {
    const id = u.pilot;
    u.pilot = undefined;
    if (chance(state, RULES.blastSurvival)) {
      log(state, "Somehow the cockpit is thrown clear, intact.");
      setPilot(state, id, "escaped", "thrown clear of the blast");
    } else {
      log(state, (u.wedge ?? 0) > 0 ? "The cockpit never opened. The Wedge held." : "The pilot stayed too long.");
      setPilot(state, id, "dead");
    }
  }
  radio(state, "kiln-blast");
}

/** Kilnheart's reactor tracks damage separately from HP: Stable, Heated, Critical. */
export function onDamaged(state: GameState, u: Unit) {
  if (u.kind !== "kilnheart" || u.hp <= 0) return;
  const [heated, critical] = RULES.kilnHeatAt;
  const want = u.hp <= critical ? 2 : u.hp <= heated ? 1 : 0;
  if (want <= (u.heat ?? 0)) return;
  u.heat = want;
  if (want === 1) log(state, "Kilnheart's heat exchangers go from orange to white. Reactor: HEATED.");
  else {
    u.fuse = RULES.kilnFuse;
    log(state, `REACTOR INSTABILITY DETECTED. Kilnheart is CRITICAL: detonation in ${u.fuse} turns unless it is cooled.${(u.wedge ?? 0) > 0 ? " COCKPIT EJECTION BLOCKED. PILOT STILL INSIDE. DETONATION RISK: HIGH." : ""}`);
  }
}
/** Foam or sealant cools a Critical reactor back to Heated. */
export function stabilize(state: GameState, u: Unit) {
  if (u.kind !== "kilnheart" || (u.heat ?? 0) < 2) return;
  u.heat = 1;
  u.fuse = undefined;
  u.ejecting = false;
  log(state, "The reactor housing is smothered. Kilnheart drops back to HEATED.");
}

/** Called when an enemy dies. Resolves the pilot. Returns true if no wreck should be left. */
export function onEnemyKilled(state: GameState, u: Unit): boolean {
  if (u.kind === "capsule") {
    if (u.pilot) {
      log(state, "The capsule breaks open.");
      setPilot(state, u.pilot, "dead");
    }
    return true;
  }
  if (u.kind === "relay") {
    state.team.networkCut = true;
    state.team.leverage += 1;
    log(state, "The Command Relay goes dark. R-8's pilots still have their own radios. They no longer have a net.");
    return false;
  }
  if (!u.pilot || !is(u, "team")) return false;
  if (u.kind === "kilnheart" && (u.heat ?? 0) >= 2) {
    explode(state, u, true);
    return true;
  }
  const id = u.pilot;
  u.pilot = undefined;
  if ((u.wedge ?? 0) > 0) {
    if (chance(state, RULES.trappedSurvival)) {
      log(state, "The frame folds with the cockpit still wedged shut. The pilot is alive in there, pinned.");
      state.pinned.push({ pilot: id, role: u.kind });
    } else {
      log(state, "The frame folds with the cockpit still wedged shut.");
      setPilot(state, id, "dead");
    }
    return false;
  }
  if (chance(state, RULES.bailSurvival)) {
    const slot = freeEnemySlot(state);
    log(state, "The cockpit blows clear of the collapsing frame at the last instant.");
    spawn(state, "capsule", "enemy", slot >= 0 ? slot : u.slot, { pilot: id, role: u.kind, hp: 1, maxHp: 1, exitIn: 1, note: "damaged capsule" });
  } else setPilot(state, id, "dead");
  return false;
}

// ---------- acting ----------

function capsuleLeaves(state: GameState, c: Unit, recovered: boolean) {
  state.units = state.units.filter((x) => x.uid !== c.uid);
  if (c.role === "bishop") {
    state.team.podEscaped = true;
    log(state, "The command pod clears the room, still transmitting.");
  } else log(state, recovered ? "The Widow drags the capsule out through the far door." : "The capsule is gone down the hall.");
  setPilot(state, c.pilot, recovered ? "recovered" : "escaped");
}

/** Performs anything this module planned. Returns true when the unit's action is spent. */
export function actSpecial(state: GameState, u: Unit, plan: Plan): boolean {
  const name = label(u.kind);
  if (u.kind === "kilnheart" && (u.heat ?? 0) >= 2 && plan.type !== "detonate") {
    u.fuse = (u.fuse ?? RULES.kilnFuse) - 1;
  }
  if (plan.type === "eject") {
    if ((u.wedge ?? 0) > 0) {
      log(state, `${name}: COCKPIT RELEASE OBSTRUCTED. The Wedge holds.`);
      if (u.kind === "bishop") radio(state, "bishop-wedged");
      say(state, u.kind as Role, pick(state, WEDGED_DISTRESS));
      return true;
    }
    if (u.cap) log(state, "The restraints hold the frame. Nothing was holding the cockpit.");
    launch(state, u);
    return true;
  }
  if (u.cap) {
    struggle(state, u);
    return true;
  }
  switch (plan.type) {
    case "detonate":
      u.hp = 0;
      state.units = state.units.filter((x) => x.uid !== u.uid);
      explode(state, u, true);
      return true;
    case "flee": {
      if (u.towed) {
        capsuleLeaves(state, u, true);
        return true;
      }
      u.exitIn = (u.exitIn ?? 1) - 1;
      if (u.exitIn <= 0) capsuleLeaves(state, u, false);
      else log(state, u.flying ? "The command pod weaves for the exit." : "The capsule skids toward the exit.");
      return true;
    }
    case "approach":
    case "rush": {
      const sudden = u.kind === "deadframe" && plan.type === "rush";
      const limp = u.partsDown?.includes("actuator") || (u.kind === "deadframe" && !sudden);
      if (limp && state.turn % 2 === 1) {
        log(state, u.kind === "deadframe" ? `${name} stands perfectly still. Then its head turns. It does not close.` : `${name} drags its damaged actuator and does not close.`);
        return true;
      }
      if (sudden) {
        u.suddenUsed = true;
        log(state, `${name} jerks forward all at once.`);
      }
      u.prox = plan.type === "rush" && (!limp || sudden) ? RULES.proxEngaged : Math.min(RULES.proxEngaged, (u.prox ?? 0) + 1);
      log(state, `${name} ${plan.type === "rush" ? "charges" : "closes"}: ${PROX_NAMES[u.prox]}.`);
      if (u.kind === "kilnheart") {
        const cover = living(state, "friendly").find((f) => f.kind === "bulkhead");
        if (cover) deal(state, cover, RULES.kilnCoverDamage, "Kilnheart's drills", { attackerUid: u.uid });
      }
      return true;
    }
    case "recover": {
      const c = capsuleToRecover(state);
      if (!c) return false;
      c.towed = true;
      c.plan = { type: "flee", note: "under tow: gone next action" };
      log(state, "Gantry Widow's tow claws close on the capsule. Stop one of them before it moves again.");
      return true;
    }
    case "mark":
      state.teamMark = true;
      log(state, "Needleback paints a target. The section's next shot will not miss.");
      return true;
    case "command":
      log(state, `Relay Bishop spends its turn on the net: ${plan.note}.`);
      return true;
    case "hold":
      if (u.kind === "relay") return true;
      if (plan.note === "covering the commander") {
        log(state, "Latchback stands in front of the Bishop.");
        return true;
      }
      return false;
    default:
      return false;
  }
}

// ---------- Bishop's orders: at most one per round, and it costs Bishop its action ----------

export function teamOrders(state: GameState) {
  state.teamOrder = null;
  for (const u of living(state, "enemy")) u.guardBy = undefined;
  if (!pursuing(state) || !bishopCommanding(state)) return;
  const c = coordination(state);
  if (c <= 1) return; // fragmented: no combined orders
  const bishop = living(state, "enemy").find((u) => u.pilot === "p-bishop");
  if (!bishop || bishop.cap || bishop.stunned > 0 || bishop.foam || (bishop.sealed ?? 0) > 0) return;
  if (bishop.kind !== "capsule" && bishop.plan?.type === "eject") return;
  if (c === 2 && chance(state, 0.5)) return; // disrupted: orders come less often
  const mechs = teamMechs(state).filter((m) => !m.cap && m.stunned === 0 && !m.foam);
  const latch = mechs.find((m) => m.kind === "latchback");
  const kiln = mechs.find((m) => m.kind === "kilnheart");
  const widow = mechs.find((m) => m.kind === "widow");
  const hurt = mechs.filter((m) => m.uid !== bishop.uid && m.kind !== "kilnheart" && m.hp <= ejectAt(m) + 1 && m.plan?.type !== "eject");
  let order = "";
  if (capsuleToRecover(state) && widow && widow.plan?.type !== "recover") {
    widow.plan = { type: "recover", note: "ordered to recover the capsule" };
    order = "Recover the Pilot";
  } else if (bishop.kind === "bishop" && bishop.hp < bishop.maxHp && latch) {
    bishop.guardBy = latch.uid;
    latch.plan = { type: "hold", note: "covering the commander" };
    order = "Cover the Commander";
  } else if (hurt.length >= 2) {
    for (const m of hurt) {
      m.ejecting = true;
      m.plan = { type: "eject", note: (m.wedge ?? 0) > 0 ? "EJECTION BLOCKED" : "PREPARING TO EJECT" };
    }
    order = "Organized Withdrawal";
  } else if (kiln && (kiln.prox ?? 0) < RULES.proxEngaged && kiln.plan?.type === "approach") {
    kiln.plan = { type: "rush", note: "ordered forward: closing all the way" };
    order = "Press the Attack";
  }
  if (!order) return;
  state.teamOrder = order;
  log(state, `R-8 ORDER: ${order}.`);
  if (bishop.kind === "bishop") bishop.plan = { type: "command", note: order };
}
