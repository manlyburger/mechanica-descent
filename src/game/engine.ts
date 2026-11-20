// Pure, deterministic game engine. No DOM, no React, no Math.random.
// reduce(state, action) -> new state. Same seed + same actions = same run.

import {
  CARDS,
  ENERGY_UP,
  HP_UP,
  LOOTBOX_POOL,
  RARITY_WEIGHT,
  REWARD_POOL,
  RULES,
  STARTING_DECK,
  UNITS,
  VARIANTS,
  cardName,
  depthFor,
  label,
  type CardId,
  type UnitKind,
} from "./data";
import {
  addCard,
  addContamination,
  addNightmare,
  addScrap,
  allies,
  allyAct,
  chance,
  deal,
  drawCards,
  enemyAct,
  freeEnemySlot,
  freeFriendSlot,
  giveRocketAmmo,
  jubey,
  living,
  log,
  pick,
  planEnemies,
  repair,
  roll,
  shuffle,
  spawn,
  stripWreck,
  takeWreck,
  tripMine,
  is,
} from "./core";
import { canPlay, commandsFor, ejectedCommand, playCard, runCommand, tapCommands, validTargets } from "./cards";
import { captiveOf, dismantleCaptive, gatherCustody, loseCaptive, podUpkeep } from "./capture";
import { hostiles } from "./pursuit";
import { openBrawler, openCustody, openPod, openPrisoner, openRecovery, openRelay, openTalk } from "./story";
import { advanceEpisode, deploy, enterRoom, introduce, pilotByRole, pursuing, radio, setPilot } from "./team";
import { CALLSIGN, type Role } from "./team-text";
import { OUT_OF_FIGHT, buy, crewCount, initRoster, makeFleeing, maxHp, newItem, pilotOp, pilotOpBlock, pilotsFightEnd, pilotsFightStart, pilotsRoomStart, pilotsTurnEnd, pilotsTurnStart, rollShop, spawnFrame } from "./pilots";
import { crew, openCargo, openFleeing, openMech } from "./pilot-events";
import { PR } from "./pilots-data";
import { eventView, openEvent, openHallway, openPatient, openRemembers, openYard, resolveEvent, rollChoice, type Flow } from "./events";
import { createGame, type Action, type GameState, type Unit } from "./state";

export { SAVE_VERSION, createGame } from "./state";
export type { Action, CardInst, GameState, Unit, Wreck, Plan } from "./state";
export { canPlay, whyNot, validTargets, commandsFor, ejectedCommand, tapCommands, type Command } from "./cards";
export { integrityBand, captiveOf, whyNotRestrainable } from "./capture";
export { teamSummary, pilotRoster, coordination, pursuing } from "./team";
export { PROX_NAMES, engaged } from "./pursuit";
export * as P from "./pilots";
export { PR, ITEMS, SPECS, TRAITS, FRAME_FAULTS } from "./pilots-data";
import { ITEMS as PILOT_ITEMS } from "./pilots-data";
export { eventView, type EventView, type Option } from "./events";
export { living, jubey, enemyHitChance, allies } from "./core";

// ---------- room flow ----------

export function riskyOdds(room: number): { crazy: number; nightmare: number } {
  return { crazy: 0.01 + (room - 1) * 0.013, nightmare: 0.03 + (room - 1) * 0.04 };
}
export function leg(room: number): number {
  return Math.floor((room - 1) / RULES.deconEvery);
}
export function rotCards(state: GameState): number {
  return Math.min(RULES.contamRotMax, Math.floor(state.contamination / RULES.contamPerRot));
}

function rollPack(state: GameState): UnitKind[] {
  const d = depthFor(state.room);
  const kinds: UnitKind[] = [];
  const lights = d.alwaysLight + leg(state.room) * RULES.legExtraLight;
  for (let i = 0; i < lights; i++) kinds.push("light");
  if (chance(state, d.extraLight)) kinds.push("light");
  if (chance(state, d.infested)) kinds.push("infested");
  if (state.room >= 3 && chance(state, d.lvl2)) {
    const idx = kinds.indexOf("light");
    if (idx >= 0) kinds[idx] = "lvl2";
    else kinds.push("lvl2");
  }
  if (state.room >= RULES.zombieFromRoom && chance(state, RULES.zombieChance)) kinds.push("zombie");
  if (state.room >= RULES.poweredFromRoom && chance(state, RULES.poweredChance)) kinds.push("powered");
  return kinds;
}

function startRoom(state: GameState) {
  state.room += 1;
  state.turn = 0;
  state.units = state.units.filter((u) => u.side === "friendly" && u.hp > 0);
  state.wrecks = [];
  if (!jubey(state)) spawn(state, "jubey", "friendly", 2);
  state.pathRisky = false;
  state.pendingInfested = 0;
  state.extraCrazy = 0;
  state.extraNightmare = 0;
  state.bonusEnergy = 0;
  state.queue = [];
  state.hallStage = 0;
  state.hallwayArmed = false;
  state.hallwayDone = false;
  state.extension = false;
  state.energy = state.energyCap;
  state.nextPack = rollPack(state);
  state.teamEpisode = enterRoom(state);
  pilotsRoomStart(state);
  state.phase = "route";
  log(state, `— Room ${state.room} path —`);
  if (state.room > RULES.deconEvery) addContamination(state, RULES.contamPerLegRoom, "The deep halls get on the rig.");
}

/** Walk the hall: each possible event gets one chance, then the fight. */
function continueHall(state: GameState) {
  while (state.hallStage < 8) {
    const stage = state.hallStage++;
    const deep = state.room >= 2;
    const t = state.team;
    if (stage === 5) {
      // Relay Section R-8: one authored beat per room, driven by real pilot state.
      const ep = state.teamEpisode;
      state.teamEpisode = 0;
      if (t.pursuit !== "dormant" && !pursuing(state)) continue;
      if (state.room < t.truceUntil) continue;
      if (t.podEscaped && pursuing(state)) return openPod(state);
      if (pursuing(state) && !t.talked && t.leverage >= RULES.negotiateAt && pilotByRole(state, "bishop").status !== "captured") return openTalk(state);
      if (!ep) continue;
      if (ep === 1) {
        introduce(state);
        // The scout looks like an ordinary patrol: it takes a Light's place in the pack.
        if (deploy(state, "needleback")) {
          const i = state.nextPack.indexOf("light");
          if (i >= 0) state.nextPack.splice(i, 1);
        }
        advanceEpisode(state);
        continue;
      }
      if (ep === 2) {
        if (pilotByRole(state, "widow").status === "active") return openRecovery(state);
        advanceEpisode(state, 0);
        state.teamEpisode = 3;
        state.hallStage -= 1;
        continue;
      }
      if (ep === 3) {
        if (pilotByRole(state, "latchback").status === "active") return openBrawler(state);
        advanceEpisode(state, 0);
        state.teamEpisode = 4;
        state.hallStage -= 1;
        continue;
      }
      if (ep === 4) {
        introduce(state);
        if (deploy(state, "kilnheart")) log(state, "The floor is shaking in a slow rhythm. R-8 has sent its furnace.");
        advanceEpisode(state);
        continue;
      }
      if (pilotByRole(state, "bishop").status === "active") return openRelay(state);
      continue;
    }
    if (stage === 6) {
      if (state.room >= RULES.prisonerFromRoom && !state.seen.prisoner && chance(state, RULES.prisonerChance)) return openPrisoner(state);
      continue;
    }
    if (stage === 7) {
      // Pilot encounters: at most one a room.
      const leg = state.seen;
      if (!leg.mech && chance(state, PR.mechChance)) return openMech(state);
      const sender = crew(state).length > 0 || allies(state).some((u) => ["builder", "clampjaw", "robobuddy", "possum"].includes(u.kind));
      if (!leg.cargo && sender && chance(state, PR.cargoChance)) return openCargo(state);
      if (state.room >= PR.fleeingFromRoom && (leg.fleeing ?? 0) < 2 && chance(state, PR.fleeingChance)) return openFleeing(state);
      continue;
    }
    if (stage === 0) {
      const b = allies(state, "builder").find((x) => !x.temp);
      if (b && !state.seen.droneRemembers && chance(state, RULES.droneRemembersChance)) return openRemembers(state);
    } else if (stage === 1) {
      const has = state.units.some((u) => u.kind === "scared" && u.hp > 0);
      if (!state.metScared && !has && state.room >= RULES.scaredFromRoom && chance(state, RULES.scaredChance)) {
        state.metScared = true;
        log(state, "Something is breathing in the smoke.");
        return openEvent(state, "scared");
      }
    } else if (stage === 2) {
      if (deep && !state.seen.patient && chance(state, RULES.patientChance)) return openPatient(state);
    } else if (stage === 3) {
      if (deep && !state.seen.yard && chance(state, RULES.yardChance)) return openYard(state);
    } else if (stage === 4) {
      if (chance(state, RULES.choiceChance)) return rollChoice(state);
    }
  }
  beginFight(state);
}

function arrive(state: GameState) {
  for (let i = 0; i < RULES.arrivalsPerTurn && state.queue.length; i++) {
    const slot = freeEnemySlot(state);
    if (slot < 0) return;
    const kind = state.queue.shift()!;
    const u = spawn(state, kind, "enemy", slot);
    log(state, `${label(kind)} enters column ${slot + 1}.`);
    if (state.turn >= 1) tripMine(state, u);
  }
}

function spawnPack(state: GameState) {
  const odds = riskyOdds(state.room);
  const crazyP = (state.pathRisky ? odds.crazy : 0) + state.extraCrazy;
  const nightP = (state.pathRisky ? odds.nightmare : 0) + state.extraNightmare;
  const extra: UnitKind[] = [...state.pendingSpawn];
  state.pendingSpawn = [];

  if (chance(state, nightP)) {
    log(state, "Nightmare card: THE RIFLEMEN FILE IN.");
    for (let i = 0; i < RULES.riflemen; i++) state.queue.push("rifleman");
    arrive(state);
  } else {
    const kinds = [...state.nextPack];
    for (let i = 0; i < state.pendingInfested; i++) kinds.push("infested");
    const crazy = chance(state, crazyP);
    if (crazy) log(state, "A mech comes in CRAZY.");
    for (const k of kinds) {
      const slot = freeEnemySlot(state);
      if (slot < 0) {
        state.queue.push(k);
        continue;
      }
      const u = spawn(state, k, "enemy", slot, { crazy: crazy && k !== "infested" });
      log(state, `${label(u.kind)}${u.crazy ? " [CRAZY]" : ""} in column ${slot + 1}.`);
    }
  }
  for (const k of extra) {
    const slot = freeEnemySlot(state);
    if (slot < 0) {
      state.queue.push(k);
      continue;
    }
    const u = spawn(state, k, "enemy", slot);
    if (k === "patient") {
      if (state.patientRepairable) u.note = "repairable";
      state.patientRepairable = false;
      log(state, "The Patient Machine is here, weapons up, screen still asking for repair.");
    } else log(state, `${label(k)} followed you in.`);
  }
  // R-8: spawned from persistent pilot state, never as anonymous extras.
  const team = state.pendingTeam;
  state.pendingTeam = [];
  for (const m of team) {
    const slot = freeEnemySlot(state);
    if (slot < 0) continue;
    if (m.kind === "capsule") {
      const pod = spawn(state, "capsule", "enemy", slot, { pilot: m.pilot, role: "bishop", hp: RULES.bishopPodHp, maxHp: RULES.bishopPodHp, exitIn: state.podStart === "late" ? 1 : 2, flying: state.podStart !== "grounded", stunned: state.podStart === "grounded" ? 1 : 0, note: state.podStart === "grounded" ? "command pod, grounded" : "flying command pod" });
      state.podStart = "";
      log(state, `Bishop's command pod is ${pod.flying ? "overhead" : "down and skidding"} in column ${slot + 1}.`);
      continue;
    }
    const u = spawn(state, m.kind, "enemy", slot, { pilot: m.pilot, replacement: m.replacement });
    if (m.replacement) {
      u.maxHp = Math.max(2, u.maxHp - RULES.replacementHpLoss);
      u.hp = u.maxHp;
    }
    if (m.kind === "bishop" && state.interceptBishop) {
      state.interceptBishop = false;
      u.hp = Math.max(4, u.hp - 2);
    }
    const role = state.team.pilots.find((p) => p.id === m.pilot)?.role as Role;
    log(state, `${label(u.kind)} in column ${slot + 1}${m.replacement ? `: ${CALLSIGN[role]}'s pilot, in a replacement frame` : ""}.`);
    if (m.kind === "needleback" && !m.replacement) radio(state, "ep1-contact");
  }
  // Tracked escapees: they did not get clear.
  const waiting: string[] = [];
  for (const id of state.pendingRunners) {
    const r = state.roster.find((x) => x.id === id);
    const slot = freeEnemySlot(state);
    if (!r || r.custody !== "fleeing") continue;
    if (slot < 0) {
      waiting.push(id);
      continue;
    }
    spawn(state, "capsule", "enemy", slot, { pilot: r.id, role: r.role ?? "runner", hp: Math.max(1, r.hp), maxHp: Math.max(1, maxHp(r)), exitIn: 2, note: `${r.name}, on foot` });
    log(state, `Your Tracking Relay leads you straight to ${r.name}, running, in column ${slot + 1}.`);
  }
  state.pendingRunners = waiting;
  if (team.length && state.team.knowsPlayer) {
    state.team.knowsPlayer = false;
    state.teamScouted = true;
  }
  for (const u of living(state, "enemy")) if (is(u, "melee") && u.prox === undefined) u.prox = UNITS[u.kind].startProx ?? 0;
  if (state.intel.weak) {
    state.intel.weak = false;
    const tough = living(state, "enemy").sort((a, b) => b.maxHp - a.maxHp)[0];
    if (tough) {
      tough.weak = true;
      log(state, `Your records were right about the ${label(tough.kind)}: it takes +1 from every hit.`);
    }
  }
  const drones = Math.min(RULES.threatDroneMax, Math.floor(state.threat / RULES.threatPerDrone));
  if (drones > 0) log(state, `Threat ${state.threat}: ${drones} Drone${drones > 1 ? "s" : ""} inbound.`);
  const shadow = state.pathRisky ? RULES.riskyDrones : 0;
  if (shadow > 0) log(state, "Something small follows you down the red hall.");
  for (let i = 0; i < drones + shadow; i++) state.queue.push("drone");
}

function resetFightState(state: GameState) {
  const bound = new Set(state.units.filter((u) => u.hp > 0).map((u) => u.cardUid));
  state.draw = shuffle(state, state.deck.filter((c) => !bound.has(c.uid)));
  for (let i = 0; i < rotCards(state); i++) state.draw.push({ uid: `rot${state.uidSeq++}`, id: "ROT", temp: true });
  if (rotCards(state) > 0) {
    state.draw = shuffle(state, state.draw);
    log(state, `Contamination ${state.contamination}: ${rotCards(state)} Contaminated Seal${rotCards(state) > 1 ? "s" : ""} in the deck this fight.`);
  }
  state.hand = [];
  state.discard = [];
  state.armed = [];
  state.block = 0;
  state.turn = 0;
  state.handUsed = false;
  state.recorderUsed = false;
  state.symbioticPaid = 0;
  state.possumPaid = 0;
  state.redmouth = null;
  state.bonusDraw = 0;
  state.ejected = null;
  state.tap = null;
  state.teamOrder = null;
  state.teamMark = false;
  state.pinned = [];
  state.badge = { turns: 0, flagged: false, hostile: false };
  state.minesArmed = state.loadoutAd.filter((c) => c === "MINE").length;
  if (state.minesArmed > 0) log(state, `AM Mine deploys itself by the door (${state.minesArmed}).`);
  pilotsFightStart(state);
  for (const u of state.units) {
    u.intercepted = false;
    u.sorted = 0;
    u.emergencyUsed = false;
    u.dmgTurn = 0;
    u.plan = undefined;
  }
}

function beginFight(state: GameState) {
  state.extension = false;
  spawnPack(state);
  resetFightState(state);
  openTurnOne(state);
}

function startExtension(state: GameState, kinds: UnitKind[], setup?: (state: GameState, foes: Unit[]) => void) {
  state.extension = true;
  state.wrecks = state.wrecks.filter((w) => w.free);
  state.queue = [];
  const foes = kinds.map((k) => spawn(state, k, "enemy", Math.max(0, freeEnemySlot(state))));
  for (const f of foes) if (is(f, "melee")) f.prox = UNITS[f.kind].startProx ?? 0;
  resetFightState(state);
  setup?.(state, foes);
  for (const f of foes) log(state, `${label(f.kind)}${f.note ? ` (${f.note})` : ""} in column ${f.slot + 1}.`);
  openTurnOne(state);
}

function openTurnOne(state: GameState) {
  state.phase = "player";
  if (state.enemyInitiative) {
    state.enemyInitiative = false;
    log(state, "It gets the first shot.");
    planEnemies(state);
    for (const u of living(state, "enemy")) if (u.hp > 0 && state.phase === "player") enemyAct(state, u);
    if (isOver(state)) return;
  }
  beginPlayerTurn(state);
  if (state.teamScouted && state.phase === "player") {
    state.teamScouted = false;
    state.accModEnemy += 1;
    log(state, "They knew where you would be. R-8 opens this fight with sharper aim.");
  }
  if (state.firstStrike && state.phase === "player") {
    state.firstStrike = false;
    state.energy += 1;
    log(state, "You are set and waiting: +1 Energy this turn.");
  }
}

function isOver(state: GameState): boolean {
  if (state.phase === "dead" || !jubey(state)) {
    state.phase = "dead";
    return true;
  }
  return false;
}

function beginPlayerTurn(state: GameState) {
  state.phase = "player";
  state.turn += 1;
  state.energy = state.energyCap + state.bonusEnergy;
  state.block = 0;
  state.salvagedThisTurn = false;
  state.accModEnemy = 0;
  state.servoUsed = false;
  state.reflexUsed = false;
  for (const u of living(state)) {
    u.dmgTurn = 0;
    u.ward = 0;
    u.shutdown = false;
    u.emergencyUsed = false;
    if (u.leech) u.leech.firedTurn = false;
    if (u.foam) {
      u.foam = false;
      u.mood = undefined;
      log(state, `The foam cracks off ${label(u.kind)}.`);
      if (u.side === "friendly") repair(state, u, RULES.foamHeal, "Maintenance Foam");
    }
  }
  for (const u of living(state)) {
    if (u.burn > 0 && u.hp > 0) {
      u.burn -= 1;
      log(state, `${label(u.kind)} burns.`);
      deal(state, u, 1, "Fire", { noLeech: false });
    }
  }
  if (isOver(state)) return;
  // Possessed Builder: roll the malfunction now so it can be seen and overridden.
  for (const b of allies(state, "builder")) {
    b.malf = undefined;
    const due = (b.timer ?? RULES.builderInterval) <= 1 && !b.jammed;
    const enemyHurt = living(state, "enemy").some((e) => is(e, "mechanical") && e.hp < e.maxHp);
    const allyHurt = living(state, "friendly").some((f) => f.uid !== b.uid && f.hp < f.maxHp);
    if (b.variant === "possessed" && due && enemyHurt && allyHurt && chance(state, RULES.possessedWrong)) {
      b.malf = "wrongRepair";
      b.mood = "staring at the enemy";
      log(state, "The Possessed Builder turns toward a damaged enemy and starts warming its welder.");
    }
  }
  for (const u of living(state)) {
    if (u.kind === "prisoner" && u.side === "enemy" && u.hp < u.maxHp && !u.cap) {
      u.hp = Math.min(u.maxHp, u.hp + RULES.prisonerRegen);
      log(state, "… [repeated internal welding clicks] The Prisoner knits a plate back into place.");
    }
    if (u.kind === "prisoner" && u.side === "friendly" && u.note === "unstable" && !u.malf && state.turn === 1 && chance(state, 0.25)) {
      u.malf = "hostile";
      log(state, "…? The Prisoner's control loop slips. It is looking at your own machines.");
    }
  }
  podUpkeep(state);
  if (isOver(state)) return;
  drawCards(state, RULES.handSize - state.hand.length + state.bonusDraw);
  state.bonusDraw = 0;
  planEnemies(state);
  pilotsTurnStart(state);
  checkClear(state);
}

/** Runs once when a fight ends: pays out, clears statuses, sends temporary things home. */
function endFight(state: GameState) {
  pilotsFightEnd(state);
  if (state.pendingScrap > 0) {
    addScrap(state, state.pendingScrap, "Bonus salvage");
    state.pendingScrap = 0;
  }
  for (const p of allies(state, "possum")) {
    if ((p.carried ?? 0) > 0) addScrap(state, p.carried!, "Machine Possum hands over its takings");
    p.carried = 0;
  }
  for (const w of state.wrecks.filter((x) => x.free)) {
    takeWreck(state, w.id);
    addScrap(state, w.value, "Recovered from a friendly wreck");
  }
  const buddy = allies(state, "robobuddy")[0];
  const pickup = state.wrecks[0];
  if (buddy && pickup) {
    takeWreck(state, pickup.id);
    addScrap(state, pickup.value, "Lil Robobuddy drags a wreck over, quietly");
  }
  state.units = state.units.filter((u) => u.side === "friendly" && u.hp > 0 && !u.temp && !["gunnest", "bulkhead", "beacon"].includes(u.kind));
  for (const u of state.units) {
    u.foam = false;
    u.sealed = 0;
    u.apprehend = undefined;
    u.leech = undefined;
    u.malf = undefined;
    u.ward = 0;
    u.shutdown = false;
    u.jammed = false;
    u.acted = false;
    u.overrideDmg = false;
    u.burn = 0;
    u.protect = state.units.some((x) => x.uid === u.protect) ? u.protect : undefined;
    if (u.rage) {
      u.rage = false;
      u.atk -= RULES.jackRage;
    }
    if (u.away) {
      u.away -= 1;
      if (!u.away) {
        if (u.note === "ret-salvage") addScrap(state, 2, "The Builder Drone catches up, dragging salvage");
        else if (u.note === "ret-damaged") {
          u.hp = Math.max(1, u.hp - 2);
          log(state, `The Builder Drone catches up, scorched (${u.hp}/${u.maxHp}).`);
        } else if (u.note === "ret-late") {
          u.away = 1;
          u.note = "ret-late0";
          log(state, "No sign of the Builder Drone yet. Its signal is still moving.");
        } else log(state, "The Builder Drone catches up, chirping.");
        if (!u.away) u.note = undefined;
      }
    } else if (u.roomsLeft !== undefined) {
      u.roomsLeft -= 1;
      if (u.roomsLeft <= 0) {
        u.hp = 0;
        log(state, u.kind === "prisoner" ? "… The Prisoner stops, mid-step, and does not start again." : "The Patient Machine stops walking. Its screen says DONE and goes dark.");
      }
    }
  }
  state.units = state.units.filter((u) => u.hp > 0);
  state.draw = [];
  state.hand = [];
  state.discard = [];
  state.armed = [];
  state.redmouth = null;
  state.ejected = null;
  state.minesArmed = 0;
  state.block = 0;
  state.queue = [];
  state.energy = state.energyCap;
}

function checkClear(state: GameState) {
  if (state.phase !== "player") return;
  if (hostiles(state).length || state.queue.length) return;
  const wasExtension = state.extension;
  log(state, wasExtension ? "The hallway is quiet." : `Room ${state.room} clear.`);
  state.custody = gatherCustody(state);
  for (const pin of state.pinned) {
    state.custody.push({ id: "pin-" + pin.pilot, kind: "capsule", pilot: pin.pilot, person: true, label: `${CALLSIGN[pin.role as Role] ?? "The"}'s pilot, pinned in the wreck`, bands: 0, hp: 1, tapped: true });
  }
  state.pinned = [];
  endFight(state);
  if (state.custody.length) return openCustody(state);
  afterFight(state, wasExtension);
}

function afterFight(state: GameState, wasExtension: boolean) {
  if (!wasExtension) {
    state.bonusEnergy = 0;
    state.extraCrazy = 0;
    state.extraNightmare = 0;
    state.pendingInfested = 0;
    if (state.pathRisky) addScrap(state, RULES.riskyClearScrap, "Red hall pays");
    if (!state.hallwayDone && (state.hallwayArmed || chance(state, RULES.hallwayChance))) return openHallway(state);
  }
  finishRoom(state);
}

function finishRoom(state: GameState) {
  state.extension = false;
  state.hallwayDone = true;
  state.event = null;
  state.energy = state.energyCap;
  const expired = state.deck.filter((c) => c.expires !== undefined && c.expires <= state.room);
  for (const c of expired) {
    state.deck = state.deck.filter((x) => x.uid !== c.uid);
    log(state, `The borrowed ${cardName(c.id)} stops moving and is left behind.`);
  }
  if (isOver(state)) return;
  if (state.wrecks.length) {
    state.phase = "salvage";
    log(state, "The wrecks are still warm. Strip them, or leave them.");
  } else toReward(state);
}

function toReward(state: GameState) {
  state.wrecks = [];
  const pool = REWARD_POOL.slice();
  const shown: CardId[] = [];
  while (shown.length < 3 && pool.length) {
    const total = pool.reduce((n, id) => n + RARITY_WEIGHT[CARDS[id].rarity], 0);
    let r = roll(state) * total;
    const i = pool.findIndex((id) => (r -= RARITY_WEIGHT[CARDS[id].rarity]) < 0);
    shown.push(pool.splice(Math.max(0, i), 1)[0]);
  }
  if (state.loadoutAd.length < RULES.adSlots && chance(state, 0.15)) shown[2] = "MINE";
  state.rewardShown = shown;
  state.phase = "reward";
}

function afterReward(state: GameState) {
  state.rewardShown = [];
  if (state.room % RULES.deconEvery === 0) {
    state.phase = "decon";
    log(state, "Decon Bay. Gold light under the door.");
  } else toTech(state);
}

function toTech(state: GameState) {
  state.phase = "tech";
  rollShop(state);
  if (state.intel.cache > 0) addScrap(state, state.intel.cache, "The parts locker your records pointed to");
  else if (state.intel.cache < 0) {
    state.threat += 1;
    log(state, `The locker your records pointed to is a sensor plate with a door painted on it. Threat ${state.threat}.`);
  }
  state.intel.cache = 0;
  state.intel.questionable = false;
  if (RULES.restHeal > 0) repair(state, jubey(state), RULES.restHeal, "Rest");
  log(state, "Tech Stop.");
}

const flow: Flow = { continueHall, finishRoom, startExtension, afterCustody: (state) => afterFight(state, state.extension) };

// ---------- turn ----------

function endTurn(state: GameState) {
  if (state.phase !== "player") return;
  state.discard.push(...state.hand.filter((c) => !c.temp || c.id === "ROT"));
  state.hand = [];
  if (state.redmouth) {
    const c = state.deck.find((x) => x.uid === state.redmouth);
    if (c) state.discard.push(c);
    state.redmouth = null;
    log(state, "The Red-Mouth round is unloaded, unfired.");
  }
  for (const a of living(state, "friendly")) {
    if (a.kind === "jubey" || a.hp <= 0 || state.phase !== "player") continue;
    allyAct(state, a);
  }
  if (isOver(state)) return;
  if (state.ejected) {
    log(state, "A foot comes down on the ejected Leech. Gone for this fight.");
    state.ejected = null;
  }
  for (const u of living(state, "enemy")) {
    if (state.phase !== "player") break;
    if (u.hp <= 0) continue;
    enemyAct(state, u);
  }
  if (isOver(state)) return;
  arrive(state);
  if (state.badge.turns > 0) {
    state.badge.turns -= 1;
    for (const d of living(state, "enemy")) if ((d.pacified ?? 0) > 0) d.pacified! -= 1;
    if (state.badge.turns === 0) {
      state.badge.flagged = true; // one check per room, pass or fail
      const p = RULES.badgeFlag + (state.badge.hostile ? RULES.badgeHostilePenalty : 0);
      if (chance(state, p)) {
        state.threat += 1;
        log(state, `Security verification: CREDENTIAL FLAGGED. Threat ${state.threat}.`);
      } else log(state, "Security verification: the badge expires quietly.");
    }
  }
  for (const u of living(state, "enemy")) {
    if ((u.wedge ?? 0) > 0) {
      u.wedge! -= 1;
      if (u.wedge === 0) log(state, `The Cockpit Wedge works loose from the ${label(u.kind)}.`);
    }
  }
  if (state.stripped > 0) state.stripped -= 1;
  state.madness = Math.max(0, state.madness - RULES.madnessDecay);
  if (!state.salvagedThisTurn) state.threat = Math.max(0, state.threat - 1);
  pilotsTurnEnd(state);
  beginPlayerTurn(state);
}

/** A hostile Patient Machine that gets stunned, foamed or sealed stabilizes instead of dying. */
function stabilizePatient(state: GameState) {
  const p = living(state, "enemy").find((u) => u.kind === "patient" && u.note === "repairable" && (u.foam || (u.sealed ?? 0) > 0 || u.stunned > 0));
  const slot = freeFriendSlot(state);
  if (!p || slot < 0) return;
  Object.assign(p, { side: "friendly", slot, foam: false, sealed: 0, stunned: 0, note: undefined, plan: undefined, leech: undefined, roomsLeft: RULES.patientRooms, acted: true });
  log(state, "Held still long enough, the Patient Machine's combat systems drop out. Its screen says REPAIR ACCEPTED. It turns to face the room with you.");
}

// ---------- reducer ----------

export function reduce(prev: GameState, action: Action): GameState {
  if (action.type === "start") {
    const fresh = createGame(action.seed ?? prev.seed);
    fresh.best = prev.best ?? 0;
    fresh.lastAction = "start";
    for (const id of STARTING_DECK) addCard(fresh, id);
    initRoster(fresh);
    fresh.phase = "loadout";
    log(fresh, "Pick one thing to carry in.");
    return fresh;
  }
  const state: GameState = structuredClone(prev);
  state.events = [];
  state.lastAction = action.type;
  switch (action.type) {
    case "loadout": {
      if (state.phase !== "loadout") break;
      if (action.pick === "lootbox") {
        const id = pick(state, LOOTBOX_POOL);
        addCard(state, id);
        state.scrap += RULES.lootboxScrap;
        log(state, `Shabby Lootbox: ${CARDS[id].name} and ${RULES.lootboxScrap} Scrap.`);
      } else if (action.pick === "mine") {
        state.loadoutAd.push("MINE");
        log(state, "AM Mine clipped to the rig. It will place itself.");
      } else {
        spawn(state, "jubey", "friendly", 2);
        spawn(state, "robobuddy", "friendly", 3);
        log(state, "Lil Robobuddy falls in beside the rig.");
      }
      startRoom(state);
      break;
    }
    case "pickPath":
      if (state.phase !== "route") break;
      state.pathRisky = action.risky;
      state.revealNext = false;
      log(state, action.risky ? "Risky red hall." : "Normal hall.");
      continueHall(state);
      break;
    case "event":
      if (state.phase !== "event") break;
      resolveEvent(state, action.option, flow);
      isOver(state);
      break;
    case "play":
      playCard(state, action.uid, action.targetId, action.slot);
      stabilizePatient(state);
      if (!isOver(state)) checkClear(state);
      break;
    case "command":
      runCommand(state, action.uid, action.cmd, action.targetId);
      if (!isOver(state)) checkClear(state);
      break;
    case "endTurn":
      endTurn(state);
      break;
    case "salvage":
      if (state.phase !== "salvage" || !state.wrecks.some((w) => w.id === action.targetId)) break;
      stripWreck(state, action.targetId, RULES.salvageScrap);
      if (!state.wrecks.length) toReward(state);
      break;
    case "leaveSalvage":
      if (state.phase === "salvage") toReward(state);
      break;
    case "pickReward":
      if (state.phase !== "reward") break;
      if (action.id !== "NONE") {
        if (!state.rewardShown.includes(action.id)) break;
        if (action.id === "MINE") {
          if (state.loadoutAd.length >= RULES.adSlots) break;
          state.loadoutAd.push("MINE");
          log(state, "AM Mine added to the auto-deploy rack.");
        } else {
          addCard(state, action.id);
          log(state, `${CARDS[action.id].name} added to the deck.`);
        }
      }
      afterReward(state);
      break;
    case "decon":
      if (state.phase !== "decon") break;
      state.tally.decons += 1;
      if (!action.deeper) {
        state.best = Math.max(state.best, state.room);
        state.phase = "win";
        log(state, "Decon Bay. Gold light. The rig comes clean. You walk out.");
        break;
      }
      state.contamination = 0;
      state.seen = { droneRemembers: false, patient: false, yard: false, prisoner: false, mech: false, cargo: false, fleeing: 0 };
      log(state, "Gold cleansing light. The ivory comes clean. Then you turn around and go back down.");
      for (const r of state.roster) {
        if (r.custody !== "ally" && r.custody !== "captive") continue;
        r.hp = maxHp(r);
        r.madness = Math.max(0, r.madness - PR.deconMadness);
      }
      repair(state, jubey(state), RULES.deconHeal, "Decon");
      toTech(state);
      break;
    case "buyEnergy": {
      if (state.phase !== "tech") break;
      const row = ENERGY_UP.find((e) => e.from === state.energyCap);
      if (!row || state.scrap < row.scrap || state.rs < row.rs) break;
      state.scrap -= row.scrap;
      state.rs -= row.rs;
      state.energyCap = row.to;
      log(state, `Energy cap ${state.energyCap}.`);
      break;
    }
    case "buyHp": {
      if (state.phase !== "tech") break;
      const row = HP_UP.find((h) => h.rank === state.hpUpRank + 1);
      const j = jubey(state);
      if (!row || !j || state.scrap < row.scrap) break;
      state.scrap -= row.scrap;
      state.hpUpRank += 1;
      state.jubeyMax += 1;
      j.maxHp = state.jubeyMax;
      j.hp += 1;
      log(state, `Jubey max HP ${state.jubeyMax}.`);
      break;
    }
    case "patch": {
      const j = jubey(state);
      if (state.phase !== "tech" || !j || j.hp >= j.maxHp || state.scrap < RULES.patchScrap) break;
      state.scrap -= RULES.patchScrap;
      repair(state, j, 1, "Hull patch");
      break;
    }
    case "repair": {
      const j = jubey(state);
      if (state.phase !== "tech" || !j || j.hp >= j.maxHp || state.cash < RULES.repairCash) break;
      state.cash -= RULES.repairCash;
      repair(state, j, RULES.repairHeal, "Paid repair");
      break;
    }
    case "removeCard": {
      if (state.phase !== "tech" || state.cash < RULES.removeCardCash || state.deck.length <= 5) break;
      const c = state.deck.find((x) => x.uid === action.uid);
      if (!c || state.units.some((u) => u.cardUid === c.uid)) break;
      state.cash -= RULES.removeCardCash;
      state.deck = state.deck.filter((x) => x.uid !== c.uid);
      log(state, `${cardName(c.id, c.variant)} cut from the deck.`);
      break;
    }
    case "specialize": {
      if (state.phase !== "tech" || state.scrap < RULES.variantScrap) break;
      const c = state.deck.find((x) => x.uid === action.uid);
      const v = VARIANTS.find((x) => x.id === action.variant);
      if (!c || !v || v.card !== c.id || c.variant) break;
      state.scrap -= RULES.variantScrap;
      c.variant = v.id;
      const live = state.units.find((u) => u.cardUid === c.uid);
      if (live) live.variant = v.id;
      log(state, `${CARDS[c.id].name} rebuilt as ${v.name}.`);
      break;
    }
    case "unequip":
      if (state.phase !== "tech" || !state.equip.servo) break;
      state.equip.servo = false;
      addCard(state, "SERVO");
      log(state, "Captured Servo Limb unbolted and stowed.");
      break;
    case "captive": {
      if (state.phase !== "tech" || !captiveOf(state, action.holder)) break;
      if (action.what === "dismantle") dismantleCaptive(state, action.holder);
      else loseCaptive(state, action.holder, "you opened it", true);
      break;
    }
    case "pilot":
      pilotOp(state, action.id, action.op, action);
      break;
    case "buy":
      buy(state, action.index);
      break;
    case "nextRoom":
      if (state.phase === "tech") startRoom(state);
      break;
    case "qa":
      applyQa(state, action.cmd, action.n, action.s);
      break;
  }
  return state;
}

// ---------- legal actions (UI hints, bot, fuzz test) ----------

const ITEMS_ = PILOT_ITEMS;

function pilotActions(state: GameState): Action[] {
  const out: Action[] = [];
  if (!OUT_OF_FIGHT.includes(state.phase) || !crewCount(state)) return out;
  const frames = state.units.filter((u) => u.kind === "frame" && u.side === "friendly" && u.hp > 0).map((u) => u.uid);
  for (const r of state.roster) {
    const tries: Action[] = [];
    for (const op of ["talk", "treat", "agree", "recruit", "tighten", "unlock"] as const) tries.push({ type: "pilot", id: r.id, op });
    for (const stat of ["mental", "skill", "endurance"]) tries.push({ type: "pilot", id: r.id, op: "stat", stat });
    for (const target of ["", "foot", ...frames]) tries.push({ type: "pilot", id: r.id, op: "assign", target });
    for (let slot = 0; slot < 4; slot++) {
      tries.push({ type: "pilot", id: r.id, op: "unequip", slot });
      for (const it of state.items.slice(0, 4)) tries.push({ type: "pilot", id: r.id, op: "equip", item: it.uid, slot });
    }
    for (const a of tries) if (a.type === "pilot" && !pilotOpBlock(state, r, a.op, a)) out.push(a);
  }
  return out;
}

export function legalActions(state: GameState): Action[] {
  const out: Action[] = pilotActions(state);
  switch (state.phase) {
    case "title":
    case "win":
    case "dead":
      out.push({ type: "start" });
      break;
    case "loadout":
      for (const p of ["lootbox", "mine", "buddy"] as const) out.push({ type: "loadout", pick: p });
      break;
    case "route":
      out.push({ type: "pickPath", risky: false }, { type: "pickPath", risky: true });
      break;
    case "event":
      for (const o of eventView(state)?.options ?? []) if (o.enabled) out.push({ type: "event", option: o.id });
      break;
    case "player": {
      if (state.tap) {
        for (const c of tapCommands(state)) out.push({ type: "command", uid: "tap", cmd: c.cmd });
        break;
      }
      for (const c of state.hand) {
        if (!canPlay(state, c)) continue;
        const t = validTargets(state, c);
        if (t === null) out.push({ type: "play", uid: c.uid });
        else if (t === "column") for (let s = 0; s < RULES.lanes; s++) out.push({ type: "play", uid: c.uid, slot: s });
        else for (const id of t) out.push({ type: "play", uid: c.uid, targetId: id });
      }
      for (const u of living(state)) {
        for (const cmd of commandsFor(state, u)) {
          if (!cmd.enabled) continue;
          if (cmd.targets) for (const id of cmd.targets) out.push({ type: "command", uid: u.uid, cmd: cmd.cmd, targetId: id });
          else out.push({ type: "command", uid: u.uid, cmd: cmd.cmd });
        }
      }
      if (ejectedCommand(state)?.enabled) out.push({ type: "command", uid: "ejected", cmd: "retrieve" });
      out.push({ type: "endTurn" });
      break;
    }
    case "salvage":
      for (const w of state.wrecks) out.push({ type: "salvage", targetId: w.id });
      out.push({ type: "leaveSalvage" });
      break;
    case "reward":
      for (const id of state.rewardShown) if (id !== "MINE" || state.loadoutAd.length < RULES.adSlots) out.push({ type: "pickReward", id });
      out.push({ type: "pickReward", id: "NONE" });
      break;
    case "decon":
      out.push({ type: "decon", deeper: true }, { type: "decon", deeper: false });
      break;
    case "tech": {
      const j = jubey(state);
      const e = ENERGY_UP.find((x) => x.from === state.energyCap);
      const h = HP_UP.find((x) => x.rank === state.hpUpRank + 1);
      if (e && state.scrap >= e.scrap && state.rs >= e.rs) out.push({ type: "buyEnergy" });
      if (h && state.scrap >= h.scrap) out.push({ type: "buyHp" });
      if (j && j.hp < j.maxHp && state.scrap >= RULES.patchScrap) out.push({ type: "patch" });
      if (j && j.hp < j.maxHp && state.cash >= RULES.repairCash) out.push({ type: "repair" });
      if (state.scrap >= RULES.variantScrap) {
        for (const c of state.deck) if (!c.variant) for (const v of VARIANTS) if (v.card === c.id) out.push({ type: "specialize", uid: c.uid, variant: v.id });
      }
      if (state.equip.servo) out.push({ type: "unequip", what: "servo" });
      state.shop.forEach((id, i) => {
        if (id && state.scrap >= ITEMS_[id].price) out.push({ type: "buy", index: i });
      });
      for (const c of state.captives) {
        out.push({ type: "captive", holder: c.holder, what: "release" });
        if (!c.pilot) out.push({ type: "captive", holder: c.holder, what: "dismantle" });
      }
      out.push({ type: "nextRoom" });
      break;
    }
  }
  return out;
}

// ---------- QA: scenario setup for tests and the console ----------

function applyQa(state: GameState, cmd: string, n?: number, s?: string) {
  const list = (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  switch (cmd) {
    case "scrap": state.scrap += n ?? 5; break;
    case "cash": state.cash += n ?? 6; break;
    case "energy": state.energy = n ?? 9; break;
    case "threat": state.threat = n ?? 5; break;
    case "madness": state.madness = n ?? 4; break;
    case "contamination": state.contamination = n ?? 6; break;
    case "nightmare": addNightmare(state, n ?? RULES.nightmareThreshold); break;
    case "heal": repair(state, jubey(state), n ?? 99, "QA"); break;
    case "room": state.room = n ?? 4; break;
    case "rocket":
      if (!state.ownsRocket) {
        state.ownsRocket = true;
        giveRocketAmmo(state, 1 + state.rocketAmmo);
        state.rocketAmmo = 0;
      }
      giveRocketAmmo(state, n ?? 0);
      break;
    case "fight": {
      // Drop straight into a clean fight against the listed enemies.
      state.event = null;
      state.units = state.units.filter((u) => u.side === "friendly" && u.hp > 0);
      if (!jubey(state)) spawn(state, "jubey", "friendly", 2);
      if (!state.room) state.room = 1;
      state.wrecks = [];
      state.queue = [];
      state.pendingSpawn = [];
      state.extension = false;
      state.hallwayDone = true;
      state.hallwayArmed = false;
      for (const k of list) spawn(state, k as UnitKind, "enemy", freeEnemySlot(state));
      for (const m of state.pendingTeam) spawn(state, m.kind, "enemy", freeEnemySlot(state), { pilot: m.pilot, replacement: m.replacement });
      state.pendingTeam = [];
      for (const u of living(state, "enemy")) if (is(u, "melee") && u.prox === undefined) u.prox = UNITS[u.kind].startProx ?? 0;
      resetFightState(state);
      state.minesArmed = n === 1 ? state.minesArmed : 0;
      openTurnOne(state);
      break;
    }
    case "hand":
      // "LEECH:queen,GUN" puts those cards straight into the hand.
      for (const item of list) {
        const [id, variant] = item.split(":");
        const c = addCard(state, id as CardId, variant ? { variant } : {});
        state.hand.push(c);
      }
      break;
    case "ally":
      for (const k of list) {
        const [kind, variant] = k.split(":");
        const u = spawn(state, kind as UnitKind, "friendly", freeFriendSlot(state), { variant });
        if (kind === "builder") u.timer = variant === "overworked" ? 1 : RULES.builderInterval;
        if (kind === "walker") u.elevated = true;
        if (kind === "pod") u.podIntegrity = 100;
        if (kind === "warframe") Object.assign(u, { inert: true, progress: 0 });
      }
      break;
    case "recruit": {
      // A Level 1 crew member, as if from a Fleeing Pilot encounter.
      const r = makeFleeing(state);
      r.custody = "ally";
      if (n !== undefined) r.loyalty = n;
      state.roster.push(r);
      break;
    }
    case "frame": {
      const [chassis, ...faults] = list.length ? list : ["medium"];
      spawnFrame(state, chassis as "light", faults, 0);
      break;
    }
    case "item":
      for (const id of list) state.items.push(newItem(state, id));
      break;
    case "parts":
      state.parts += n ?? 3;
      break;
    case "captive": {
      // Puts an R-8 pilot into a vacant Pod (spawning one if needed), as if captured.
      const id = s ?? "p-needle";
      let pod = state.units.find((u) => u.kind === "pod" && u.side === "friendly" && !u.holding);
      if (!pod) pod = spawn(state, "pod", "friendly", freeFriendSlot(state), { podIntegrity: 100 });
      state.captives.push({ id: "qa-" + id, kind: "capsule", pilot: id, label: `${CALLSIGN[(state.team.pilots.find((p) => p.id === id)?.role ?? "bishop") as Role]}'s pilot`, holder: pod.uid, bands: 0, tapped: false, hp: 2 });
      pod.holding = "qa-" + id;
      introduce(state);
      setPilot(state, id, "captured");
      break;
    }
    case "team":
      // "needleback,bishop" deploys those R-8 mechs into the next qa fight.
      introduce(state);
      for (const r of list) deploy(state, r as Role);
      break;
    case "event":
      if (s === "prisoner") openPrisoner(state);
      else if (s === "r8-recovery") openRecovery(state);
      else if (s === "r8-brawler") openBrawler(state);
      else if (s === "r8-relay") openRelay(state);
      else if (s === "r8-pod") openPod(state);
      else if (s === "r8-talk") openTalk(state);
      else if (s === "patient") openPatient(state);
      else if (s === "mech") openMech(state);
      else if (s === "cargo") openCargo(state);
      else if (s === "fleeing") openFleeing(state);
      else if (s === "yard") openYard(state);
      else if (s === "remembers") openRemembers(state);
      else if (s === "hallway") openHallway(state);
      else if (s) {
        openHallway(state);
        state.event!.data.next = s;
      }
      break;
  }
  log(state, `QA ${cmd} ${n ?? ""} ${s ?? ""}`.trim());
}

export function installQa(dispatch: (a: Action) => void, get: () => GameState) {
  const qa = (cmd: string) => (n?: number, s?: string) => dispatch({ type: "qa", cmd, n, s });
  const api = {
    giveScrap: qa("scrap"),
    giveCash: qa("cash"),
    giveRocket: qa("rocket"),
    setThreat: qa("threat"),
    setMadness: qa("madness"),
    setContamination: qa("contamination"),
    addNightmare: qa("nightmare"),
    heal: qa("heal"),
    hand: (cards: string) => dispatch({ type: "qa", cmd: "hand", s: cards }),
    ally: (kinds: string) => dispatch({ type: "qa", cmd: "ally", s: kinds }),
    fight: (kinds: string) => dispatch({ type: "qa", cmd: "fight", s: kinds }),
    event: (id: string) => dispatch({ type: "qa", cmd: "event", s: id }),
    team: (roles: string) => dispatch({ type: "qa", cmd: "team", s: roles }),
    act: (a: Action) => dispatch(a),
    start: (seed: number) => dispatch({ type: "start", seed }),
    state: get,
  };
  (window as unknown as { __descent: typeof api }).__descent = api;
}
