// Playing cards and issuing commands to units.

import { CARDS, LEECH_RADIO, OVERRIDE_LINES, RULES, cardName, label, type CardDef } from "./data";
import {
  addProgress,
  addScrap,
  allies,
  canPayEnergy,
  chance,
  damagedAllies,
  deal,
  destroyCard,
  drawCards,
  freeFriendSlot,
  gainBlock,
  is,
  jubey,
  living,
  log,
  payEnergy,
  pick,
  repair,
  roll,
  spawn,
  stripWreck,
  toDiscard,
  unit,
} from "./core";
import type { CardInst, GameState, Unit } from "./state";
import { applyBand, bandTargets, canApprehend, captiveOf, dismantleCaptive, heldBy, loseCaptive, podFits, resolveTap, secured, tapSources, transferCaptive, vacantPod, type TapChoice } from "./capture";
import { stabilize } from "./pursuit";
import { setPilot } from "./team";

// ---------- targets ----------

/** Unit ids a card may be aimed at, "column" for lane targeting, or null for no target. */
export function validTargets(state: GameState, card: CardInst): string[] | "column" | null {
  const def = CARDS[card.id];
  const foes = living(state, "enemy");
  const mine = living(state, "friendly");
  switch (def.target) {
    case "none":
      return null;
    case "column":
      return "column";
    case "enemy":
      // A flying command pod is out of reach of crane and fist.
      return foes.filter((u) => !(def.melee && u.flying)).map((u) => u.uid);
    case "band":
      return bandTargets(state).map((u) => u.uid);
    case "cockpit":
      return foes.filter((u) => is(u, "piloted") && !!(u.pilot || !is(u, "team")) && !(u.wedge ?? 0)).map((u) => u.uid);
    case "tap":
      return tapSources(state);
    case "enemyMech":
      if (card.variant === "symbiotic") return mine.filter((u) => is(u, "machine") && !u.leech).map((u) => u.uid);
      return foes.filter((u) => is(u, "mechanical") && !u.leech).map((u) => u.uid);
    case "friend":
      return mine.filter((u) => u.kind !== "bulkhead" && !mine.some((b) => b.kind === "bulkhead" && b.guards === u.uid)).map((u) => u.uid);
    case "foam":
      return [...mine.filter((u) => u.kind !== "jubey" && !u.foam), ...foes.filter((u) => !u.foam)].map((u) => u.uid);
    case "machine":
      return [...mine.filter((u) => is(u, "machine")), ...foes.filter((u) => is(u, "mechanical"))]
        .filter((u) => !(u.sealed ?? 0))
        .map((u) => u.uid);
  }
}

export function whyNot(state: GameState, card: CardInst): string | null {
  const def = CARDS[card.id];
  if (state.phase !== "player") return "not your turn";
  if (def.unplayable) return "unplayable";
  if (!canPayEnergy(state, def.cost, !!def.tech)) return "not enough Energy";
  if ((def.scrap ?? 0) > state.scrap) return "not enough Scrap";
  if (def.needsWreck && !state.wrecks.length) return "no wreck";
  if (def.deploys && freeFriendSlot(state) < 0) return "lane full";
  const t = validTargets(state, card);
  if (Array.isArray(t) && !t.length) return "no target";
  if (card.id === "SERVO" && state.equip.servo) return "already equipped";
  if (card.id === "HAND" && state.equip.hand) return "already equipped";
  if (card.id === "HALLWAY" && (state.hallwayArmed || state.extension)) return "the hall is already wrong";
  if (card.id === "BADGE" && (state.badge.flagged || state.badge.turns > 0)) return state.badge.flagged ? "badge flagged in this room" : "badge still active";
  if (card.id === "REDMOUTH" && state.redmouth) return "already loaded";
  if (state.tap) return "finish the Memory Tap first";
  return null;
}
export function canPlay(state: GameState, card: CardInst): boolean {
  return whyNot(state, card) === null;
}

// ---------- playing ----------

/** Firearm damage bonus from loaded Red-Mouth. May hijack the target at high Madness. */
function fireRedmouth(state: GameState, target: Unit | undefined): { bonus: number; target: Unit | undefined } {
  const loaded = state.deck.find((c) => c.uid === state.redmouth);
  if (!loaded) return { bonus: 0, target };
  state.redmouth = null;
  loaded.rounds = (loaded.rounds ?? 1) - 1;
  state.madness += 1;
  log(state, `Red-Mouth round chambers. The seams look like teeth. +1 Madness. ${loaded.rounds} left.`);
  if (loaded.rounds <= 0) {
    destroyCard(state, loaded.uid);
    log(state, "The Red-Mouth magazine is empty.");
  } else toDiscard(state, loaded.uid);
  let tgt = target;
  if (target && state.madness >= RULES.highMadness && chance(state, RULES.redmouthAuto)) {
    const pool = [...living(state, "enemy"), ...allies(state).filter((a) => !a.foam)];
    tgt = pick(state, pool);
    log(state, `The gun fires before you finish aiming. It picks ${label(tgt.kind)}.`);
  }
  return { bonus: RULES.redmouthBonus, target: tgt };
}

function servoBonus(state: GameState, def: CardDef): number {
  if (!def.melee || !state.equip.servo || state.servoUsed) return 0;
  state.servoUsed = true;
  log(state, `Captured Servo Limb drives the blow: +${RULES.servoBonus}.`);
  return RULES.servoBonus;
}
function servoMalfunction(state: GameState, boosted: boolean) {
  if (!boosted || state.madness < RULES.highMadness || !chance(state, RULES.servoSwing)) return;
  const pool = [...living(state, "enemy"), ...allies(state).filter((a) => !a.foam)];
  if (!pool.length) return;
  const t = pick(state, pool);
  log(state, `The Servo Limb swings again on its own, at ${label(t.kind)}.`);
  deal(state, t, 2, "Involuntary swing", { noLeech: false });
}

export function playCard(state: GameState, cardUid: string, targetId?: string, slot?: number) {
  const idx = state.hand.findIndex((c) => c.uid === cardUid);
  if (idx < 0) return;
  const card = state.hand[idx];
  const def = CARDS[card.id];
  if (!canPlay(state, card)) return;

  const valid = validTargets(state, card);
  let target: Unit | undefined;
  if (Array.isArray(valid)) {
    if (!targetId || !valid.includes(targetId)) return;
    target = unit(state, targetId);
    if (!target) return;
  }
  if (valid === "column" && (slot === undefined || slot < 0 || slot >= RULES.lanes)) return;

  // Cover the Commander: the Brawler takes one aimed shot meant for the Bishop.
  if (target && target.side === "enemy" && def.target === "enemy") {
    const guard = unit(state, target.guardBy);
    if (guard && !secured(guard)) {
      log(state, `Latchback Brawler steps into the line of fire meant for the ${label(target.kind)}.`);
      target.guardBy = undefined;
      target = guard;
    }
  }

  payEnergy(state, def.cost, !!def.tech);
  state.scrap -= def.scrap ?? 0;
  state.hand.splice(idx, 1);
  state.tally.cards += 1;
  const name = cardName(card.id, card.variant);

  if (state.madness > 0 && chance(state, state.madness * RULES.madnessMisfire)) {
    log(state, `${name} misfires (Madness).`);
    state.scrap += def.scrap ?? 0; // parts are not lost to a misfire
    state.discard.push(card);
    return;
  }

  let keep: "discard" | "bound" | "gone" | "armed" | "once" = def.exhaust ? "gone" : def.once ? "once" : "discard";

  switch (card.id) {
    case "GUN":
    case "SLUG": {
      const r = fireRedmouth(state, target);
      const base = card.id === "GUN" ? 1 + Math.floor(roll(state) * 3) : 5;
      deal(state, r.target, base + r.bonus, card.id === "GUN" ? "Machine gun" : "Deadbolt slug");
      break;
    }
    case "BURST": {
      const r = fireRedmouth(state, undefined);
      for (const t of living(state, "enemy")) deal(state, t, 1 + r.bonus, "Suppressing burst");
      break;
    }
    case "WELDER":
      deal(state, target, 1, "Arc welder");
      if (target!.hp > 0) {
        target!.burn = Math.max(target!.burn, 3);
        log(state, `${label(target!.kind)} ignited.`);
      }
      break;
    case "FUEL":
      deal(state, target, 2, "Fuel canister");
      if (target!.hp > 0) {
        target!.burn = Math.max(target!.burn, 2);
        log(state, `${label(target!.kind)} is burning.`);
      }
      break;
    case "HOOK": {
      const bonus = servoBonus(state, def);
      deal(state, target, 2 + bonus, "Crane hook");
      if (target!.hp > 0) {
        target!.stunned = 1;
        log(state, `${label(target!.kind)} stunned.`);
        if (is(target!, "melee") && (target!.prox ?? 0) > 0) {
          target!.prox = (target!.prox ?? 0) - 1;
          log(state, `The hook throws it back a step: ${["DISTANT", "CLOSING", "MELEE READY"][target!.prox]}.`);
        }
      }
      servoMalfunction(state, bonus > 0);
      break;
    }
    case "CRANE": {
      const bonus = servoBonus(state, def);
      const hits = living(state, "enemy").filter((u) => Math.abs(u.slot - slot!) <= 1 && !u.flying);
      if (!hits.length) log(state, "Crane Smash hits empty air.");
      let sharper = 0;
      for (const t of hits) {
        deal(state, t, 3 + bonus, "Crane Smash");
        if (t.hp <= 0) continue;
        if (chance(state, 0.25)) {
          t.stunned = 1;
          log(state, `${label(t.kind)} stunned.`);
        }
        sharper += 1;
      }
      if (sharper) {
        state.accModEnemy += sharper;
        log(state, "Survivors aim sharper.");
      }
      servoMalfunction(state, bonus > 0);
      break;
    }
    case "ROCKET": {
      const t = target!;
      const splash = living(state, "enemy").filter((u) => Math.abs(u.slot - t.slot) === 1);
      deal(state, t, 4, "Rocket");
      if (t.hp > 0) t.burn = Math.max(t.burn, 2);
      for (const s of splash) {
        deal(state, s, 2, "Rocket splash");
        if (s.hp > 0) s.burn = Math.max(s.burn, 2);
      }
      break;
    }
    case "BRACE":
      gainBlock(state, RULES.braceBlock);
      break;
    case "PLATE":
      gainBlock(state, RULES.plateBlock);
      break;
    case "PATCH":
      repair(state, jubey(state), 2, "Patch Weld");
      break;
    case "FLUSH":
      drawCards(state, 2);
      break;
    case "OVERCLOCK":
      state.energy += 2;
      state.madness += 2;
      log(state, `Overclock. Madness ${state.madness}.`);
      break;
    case "STRIP":
      stripWreck(state, state.wrecks[0].id, RULES.fieldStripScrap);
      break;
    case "QUIET":
      state.threat = Math.max(0, state.threat - 2);
      log(state, `Going quiet. Threat ${state.threat}.`);
      drawCards(state, 1);
      break;
    case "FLARE":
      state.accModEnemy -= 1;
      log(state, "Flare. Enemy aim degraded this turn.");
      drawCards(state, 1);
      break;

    // ---- machines and structures ----
    case "BUILDER":
    case "POSSUM":
    case "SHEPHERD":
    case "WALKER":
    case "JACK":
    case "WARFRAME":
    case "CLAMPJAW":
    case "POD":
    case "GUNNEST":
    case "BULKHEAD":
    case "BEACON": {
      const u = spawn(state, def.deploys!, "friendly", freeFriendSlot(state), { cardUid: card.uid, variant: card.variant });
      keep = card.id === "BEACON" ? "gone" : "bound";
      log(state, `${name} deployed in column ${u.slot + 1}.`);
      if (u.kind === "builder") u.timer = card.variant === "overworked" ? 1 : RULES.builderInterval;
      if (u.kind === "walker") u.elevated = true;
      if (u.kind === "pod") u.podIntegrity = 100;
      if (u.kind === "gunnest" || u.kind === "bulkhead" || u.kind === "beacon") u.temp = false;
      if (u.kind === "warframe") {
        u.inert = true;
        u.progress = 0;
        if (state.preCommission) {
          state.preCommission = false;
          u.progress = 1;
          log(state, "The Assembly Yard already did half the work: startup 1/2.");
        }
      }
      if (u.kind === "bulkhead") {
        u.guards = target!.uid;
        log(state, `It seals shut in front of ${label(target!.kind)}.`);
      }
      if (u.kind === "beacon") {
        addScrap(state, RULES.beaconScrap, "Threat Beacon payout");
        state.threat += RULES.beaconThreat;
        log(state, `The Beacon starts broadcasting. Threat ${state.threat}. Everything in the room turns toward it.`);
      }
      break;
    }

    case "LEECH": {
      target!.leech = { cardUid: card.uid, variant: card.variant, count: 0, stripped: false, firedTurn: false };
      keep = "bound";
      log(state, `${name} latches onto ${label(target!.kind)}.`);
      if (target!.side === "enemy" && is(target!, "piloted")) log(state, `${label(target!.kind)}: ${pick(state, LEECH_RADIO)}`);
      break;
    }
    case "HALLWAY":
      state.hallwayArmed = true;
      state.hallwayDone = false;
      log(state, "Something about the far door stops making sense. Finish the fight first.");
      break;
    case "SERVO":
      state.equip.servo = true;
      keep = "gone";
      log(state, "Captured Servo Limb bolted on. It flexes without being asked.");
      break;
    case "HAND":
      state.equip.hand = true;
      keep = "gone";
      log(state, "Manual Override Hand fitted.");
      break;
    case "CELL":
      state.equip.cell += RULES.cellCharges;
      keep = "gone";
      log(state, `Cold Reactor Cell seated. ${state.equip.cell} Charges.`);
      break;
    case "REDMOUTH":
      state.redmouth = card.uid;
      keep = "bound";
      log(state, state.madness >= RULES.highMadness ? "Red-Mouth loaded. WARNING: it is running hot and may pick its own target." : "Red-Mouth loaded. Next firearm card this turn hits harder.");
      break;
    case "REFLEX":
    case "RECORDER":
      state.armed.push(card);
      keep = "armed";
      log(state, `${name} armed.`);
      break;
    case "FOAM": {
      const t = target!;
      if (t.side === "enemy" && is(t, "heavy_machine") && chance(state, RULES.foamResistHeavy)) {
        log(state, `${label(t.kind)} shoulders through the foam before it sets.`);
        break;
      }
      t.foam = true;
      t.mood = "foamed";
      log(state, `Industrial foam swallows ${label(t.kind)}.`);
      stabilize(state, t);
      break;
    }
    case "COFFIN": {
      const t = target!;
      const heavy = t.side === "enemy" && is(t, "heavy_machine");
      t.sealed = heavy ? 1 : RULES.coffinActions;
      t.mood = "sealed";
      log(state, `Sealant hardens around ${label(t.kind)}: ${t.sealed} action${t.sealed > 1 ? "s" : ""}.`);
      stabilize(state, t);
      break;
    }
    case "BADGE": {
      state.badge.turns = RULES.badgeTurns;
      state.badge.hostile = false;
      const drones = living(state, "enemy").filter((e) => is(e, "neutral_maintenance"));
      for (const d of drones) {
        d.pacified = RULES.badgeTurns;
        d.plan = { type: "hold", note: "badge accepted" };
      }
      log(state, drones.length ? "You hold up the badge. The Drones lower their emitters." : "You hold up the badge. Nothing here cares.");
      break;
    }
    case "LOCKBANDS":
      applyBand(state, target!);
      break;
    case "WEDGE": {
      const t = target!;
      t.wedge = RULES.wedgeTurns;
      log(state, `Cockpit Wedge hammered into the ${label(t.kind)}'s release track. COCKPIT EJECTION BLOCKED for ${RULES.wedgeTurns} turns. It can still fight and still transmit.`);
      if (t.kind === "kilnheart" && (t.heat ?? 0) >= 2) log(state, "REACTOR INSTABILITY DETECTED. PILOT STILL INSIDE. DETONATION RISK: HIGH.");
      if (t.ejecting) t.plan = { type: "eject", note: "EJECTION BLOCKED" };
      break;
    }
    case "MEMTAP":
      state.tap = target!.uid;
      log(state, `Memory Tap connected to ${target!.side === "enemy" ? "the " + label(target!.kind) : captiveOf(state, target!.uid)?.label ?? "the captive"}. Choose what to read.`);
      break;
    default:
      break;
  }

  if (keep === "discard") state.discard.push(card);
  else if (keep === "gone") state.deck = state.deck.filter((x) => x.uid !== card.uid);
  // "bound", "armed" and "once" stay out of the piles for now; the deck still owns them.
}

// ---------- unit commands ----------

export interface Command {
  uid: string;
  cmd: string;
  label: string;
  detail: string;
  enabled: boolean;
  /** If set, the command needs one of these units as a target. */
  targets?: string[];
}

export function commandsFor(state: GameState, u: Unit): Command[] {
  if (state.phase !== "player") return [];
  const out: Command[] = [];
  const add = (cmd: string, name: string, detail: string, enabled = true, targets?: string[]) =>
    out.push({ uid: u.uid, cmd, label: name, detail, enabled: enabled && (!targets || targets.length > 0), targets });
  const en = (n: number) => canPayEnergy(state, n, true);

  if (u.side === "enemy") {
    if (u.leech && !u.leech.temp) add("risky", "Risky Extraction", `+${RULES.riskyExtractScrap} Scrap, 1 damage to host. The Leech is spent for this fight.`);
    if ((u.wedge ?? 0) > 0) add("unwedge", "Remove the Wedge", `${RULES.wedgeRemoveEnergy} Energy. The cockpit can open and eject again.`, en(RULES.wedgeRemoveEnergy));
    if (u.cap) add("unbind", "Release it", "Take the restraints off. It is free again.");
    return out;
  }
  if (u.malf && state.equip.hand && !state.handUsed) add("override", "Manual Override", "Cancel the malfunction and take control. The machine takes 1 after it acts.");
  const locked = u.malf === "uncontrolled" || !!u.foam;
  if ((u.sealed ?? 0) > 0) {
    add("release", "Release early", `Break the seal now. Heals only ${RULES.coffinEarlyHeal}.`);
    return out;
  }
  if (locked) return out;

  switch (u.kind) {
    case "builder": {
      const hurt = damagedAllies(state, u.uid).map((x) => x.uid);
      if (u.variant !== "scavenger") add("emergency", "Emergency Repair", `1 Energy: repair ${RULES.emergencyRepair} now.`, !u.emergencyUsed && en(1), hurt);
      if (u.variant === "awake") {
        add("order-patch", "Next job: Patch", `Repair ${RULES.builderPatch}.`, u.order !== "patch" && hurt.length > 0);
        add("order-sort", "Next job: Sort scrap", `+${RULES.builderSort} Scrap.`, u.order !== "sort" && (u.sorted ?? 0) < RULES.builderSortCap);
      }
      if (allies(state, "warframe").some((w) => w.inert)) add("order-commission", "Commission Warframe", "Spend the next maintenance job on the frame.", u.order !== "commission");
      break;
    }
    case "clampjaw": {
      const held = heldBy(state, u);
      const cap = captiveOf(state, u.uid);
      const pod = vacantPod(state);
      if (!held && !cap) add("apprehend", "Apprehend", `Grapple one machine at ${RULES.captureHp} HP or less, or a disabled one. It locks on the following action.`, true, living(state, "enemy").filter(canApprehend).map((x) => x.uid));
      if (cap) add("transfer", "Transfer to the Pod", pod ? "Hand the captive over. The Clampjaw is free to capture again." : "No vacant Pod.", !!pod && podFits(cap.kind, !!cap.pilot && cap.kind !== "capsule"));
      if (cap) add("letgo", "Release the captive", "Open the clamps on purpose.");
      if (held) add("letgo", "Let go", "Open the clamps. Lockbands, if any, stay on.");
      break;
    }
    case "pod": {
      const cap = captiveOf(state, u.uid);
      if (!cap) {
        const fits = living(state, "enemy").filter((x) => secured(x) && podFits(x.kind, false)).map((x) => x.uid);
        add("contain", "Contain", "Move one secured capsule, Drone or small machine into the Pod.", true, fits);
      } else {
        add("power", u.powerOff ? "Restore power" : "Cut power", u.powerOff ? "The Pod draws its upkeep again." : "Stop paying upkeep. The seal weakens every cycle.");
        if (!cap.pilot) add("dismantle", "Dismantle the captive", "Break it down for Scrap. Frees the Pod.");
        add("letgo", "Release the captive", "Open the Pod on purpose.");
      }
      break;
    }
    case "bulkhead":
      add("collapse", "Emergency Collapse", `Destroy it: every ally prevents ${RULES.collapsePrevent} damage this turn.`);
      break;
    case "shepherd":
      add("hold", u.hold ? "Resume collecting" : "Hold position", u.hold ? "Go back to hauling wrecks." : "Stop hauling for now.");
      if (allies(state, "warframe").some((w) => w.inert && !w.fed)) add("feed", u.feed ? "Haul for Scrap" : "Feed the Warframe", u.feed ? "Pairs pay Scrap again." : "Next pair becomes 1 startup point, not Scrap.");
      break;
    case "walker":
      add("drop", u.elevated ? "Drop" : "Climb", u.elevated ? "Come down. Melee can reach it." : "Back overhead.");
      add("scout", "Scout", "Skip its attack this turn to report what is inbound.", !u.scouting);
      break;
    case "jack": {
      const wards = living(state, "friendly").filter((f) => f.uid !== u.uid && f.uid !== u.protect).map((f) => f.uid);
      add("protect", "Protect", u.intercepted ? "Already intercepted this fight." : "Take the next hit meant for one ally.", !u.intercepted, wards);
      if (u.protect) add("unprotect", "Stand down", "Clear the guard order.");
      break;
    }
    case "warframe":
      if (u.malf === "hostile") add("reset", "Emergency Reset", "1 Energy: end the hostile startup.", en(1));
      if (u.inert) {
        add("emergency-commission", "Emergency Commissioning", `${RULES.emergencyCommissionEnergy} Energy: +1 startup point. Once.`, !u.emergUsed && en(RULES.emergencyCommissionEnergy));
        if ((u.progress ?? 0) === 1) add("abort", u.paused ? "Resume startup" : "Abort startup", u.paused ? "Let it keep booting." : u.abortPaid ? "Pause the boot." : "Pause the boot and recover 1 Scrap.");
      }
      break;
    default:
      break;
  }
  return out;
}

export function tapCommands(state: GameState): Command[] {
  if (state.phase !== "player" || !state.tap) return [];
  const mk = (cmd: string, name: string, detail: string): Command => ({ uid: "tap", cmd, label: name, detail, enabled: true });
  return [
    mk("hazard", "Hazard Scan", "What is in the next room. A clean read also lets you read the next wrong corridor."),
    mk("weak", "Weakness Analysis", "One machine in the next fight takes +1 from every hit."),
    mk("cache", "Cache Trace", "A parts locker by the next Tech Stop."),
  ];
}

export function ejectedCommand(state: GameState): Command | null {
  if (state.phase !== "player" || !state.ejected) return null;
  return { uid: "ejected", cmd: "retrieve", label: "Retrieve the Leech", detail: "1 Energy: back to your hand before something steps on it.", enabled: canPayEnergy(state, 1, true) };
}

export function runCommand(state: GameState, uidOf: string, cmd: string, targetId?: string) {
  if (state.phase !== "player") return;
  if (uidOf === "ejected") {
    const c = ejectedCommand(state);
    if (!c?.enabled) return;
    payEnergy(state, 1, true);
    state.hand.push(state.ejected!.card);
    state.ejected = null;
    log(state, "You snatch the Leech off the floor.");
    return;
  }
  if (uidOf === "tap") {
    if (!state.tap || !["hazard", "weak", "cache"].includes(cmd)) return;
    const source = state.tap;
    state.tap = null;
    resolveTap(state, source, cmd as TapChoice);
    return;
  }
  if (state.tap) return;
  const u = unit(state, uidOf);
  if (!u) return;
  const def = commandsFor(state, u).find((c) => c.cmd === cmd);
  if (!def || !def.enabled) return;
  if (def.targets && (!targetId || !def.targets.includes(targetId))) return;
  const t = unit(state, targetId);

  switch (cmd) {
    case "risky": {
      u.leech = undefined;
      addScrap(state, RULES.riskyExtractScrap, "Risky Extraction");
      log(state, "The Leech tears itself out with everything it can carry. It is spent for this fight.");
      deal(state, u, 1, "Risky Extraction", { noLeech: true });
      break;
    }
    case "override": {
      state.handUsed = true;
      state.overrides += 1;
      const was = u.malf;
      u.malf = undefined;
      u.overrideDmg = true;
      if (was === "wrongRepair") u.order = "patch";
      if (was === "uncontrolled") u.mood = "held still";
      log(state, `Manual Override: you take ${label(u.kind)} by hand.`);
      if (state.overrides >= 3) log(state, `${label(u.kind)} ${pick(state, OVERRIDE_LINES)}.`);
      break;
    }
    case "unwedge":
      payEnergy(state, RULES.wedgeRemoveEnergy, true);
      u.wedge = 0;
      log(state, `You knock the Wedge out of the ${label(u.kind)}'s release track.`);
      break;
    case "unbind":
      u.cap = undefined;
      u.plan = undefined;
      log(state, `You take the restraints off the ${label(u.kind)}.`);
      break;
    case "apprehend":
      u.apprehend = t!.uid;
      u.mood = "approaching";
      log(state, `Clampjaw turns its teal eye on the ${label(t!.kind)} and starts toward it.`);
      break;
    case "transfer":
      transferCaptive(state, u, vacantPod(state)!);
      break;
    case "letgo": {
      const held = heldBy(state, u);
      if (captiveOf(state, u.uid)) loseCaptive(state, u.uid, "you opened it", true);
      else if (held?.cap) {
        if (held.cap.bands > 0) held.cap.by = undefined;
        else held.cap = undefined;
        log(state, "Clampjaw opens its clamps.");
      }
      break;
    }
    case "contain": {
      // Atomic: the unit leaves the field and becomes the Pod's one captive in the same step.
      const cap = t!.cap!;
      const clamp = unit(state, cap.by);
      state.units = state.units.filter((x) => x.uid !== t!.uid);
      const lbl = t!.kind === "capsule" ? "The capsule and its pilot" : `The ${label(t!.kind)}`;
      state.captives.push({ id: t!.uid, kind: t!.kind, pilot: t!.pilot, label: lbl, holder: u.uid, bands: cap.bands, tapped: !!t!.note?.includes("tapped"), hp: t!.hp });
      u.holding = t!.uid;
      u.occupied = 0;
      u.podIntegrity = 100;
      if (clamp) clamp.mood = "free";
      log(state, `${lbl} goes into the Containment Pod. CONTAINED.`);
      if (t!.pilot) setPilot(state, t!.pilot, "captured");
      break;
    }
    case "power":
      u.powerOff = !u.powerOff;
      if (!u.powerOff) u.occupied = Math.min(u.occupied ?? 0, RULES.podUpkeepTurns - 1);
      log(state, u.powerOff ? "Containment Pod power cut. LOW POWER warnings will follow." : "Containment Pod back on power.");
      break;
    case "dismantle":
      dismantleCaptive(state, u.uid);
      break;
    case "release":
      u.sealed = 0;
      log(state, `You crack the sealant off ${label(u.kind)} early.`);
      repair(state, u, RULES.coffinEarlyHeal, "Sealant");
      break;
    case "emergency":
      payEnergy(state, 1, true);
      u.emergencyUsed = true;
      repair(state, t, RULES.emergencyRepair, "Emergency Repair", u.uid);
      break;
    case "order-patch":
      u.order = "patch";
      break;
    case "order-sort":
      u.order = "sort";
      break;
    case "order-commission":
      u.order = "commission";
      log(state, "Builder Drone turns toward the frame.");
      break;
    case "collapse":
      for (const f of living(state, "friendly")) if (f.uid !== u.uid) f.ward = RULES.collapsePrevent;
      log(state, `EMERGENCY COLLAPSE. The bulkhead slams down across the lane: every ally prevents ${RULES.collapsePrevent}.`);
      toDiscard(state, u.cardUid);
      state.units = state.units.filter((x) => x.uid !== u.uid);
      break;
    case "hold":
      u.hold = !u.hold;
      break;
    case "feed":
      u.feed = !u.feed;
      break;
    case "drop":
      u.elevated = !u.elevated;
      log(state, u.elevated ? "Ceiling Walker climbs back overhead." : "Ceiling Walker drops to the floor.");
      break;
    case "scout":
      u.scouting = true;
      break;
    case "protect":
      u.protect = t!.uid;
      u.mood = "guarding";
      log(state, `Panic Jack plants itself beside ${label(t!.kind)}.`);
      break;
    case "unprotect":
      u.protect = undefined;
      break;
    case "reset":
      payEnergy(state, 1, true);
      u.malf = undefined;
      u.mood = "online";
      log(state, "Emergency Reset. The Warframe's targeting swings back.");
      break;
    case "emergency-commission":
      payEnergy(state, RULES.emergencyCommissionEnergy, true);
      u.emergUsed = true;
      addProgress(state, u, "Emergency Commissioning");
      break;
    case "abort":
      u.paused = !u.paused;
      if (u.paused && !u.abortPaid) {
        u.abortPaid = true;
        addScrap(state, 1, "Startup aborted, parts recovered");
      }
      break;
  }
}
