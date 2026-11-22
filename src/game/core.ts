// Shared rules machinery: RNG, piles, damage, destruction, wreckage, repairs,
// reactions, and the autonomous behavior of allied machines and enemies.

import {
  BUILDER_MOODS,
  CARDS,
  LEECH_RADIO,
  RECORDER_LINES,
  RULES,
  UNITS,
  hasTag,
  label,
  cardName,
  type CardId,
  type Side,
  type Tag,
  type UnitKind,
} from "./data";
import type { CardInst, GameState, Plan, Unit, Wreck } from "./state";
import { clampLost, clampjawAct, loseCaptive } from "./capture";
import { actSpecial, engaged, fighters, onDamaged, onEnemyKilled, planSpecial, teamOrders } from "./pursuit";
import { PILOTED, avoidDeath, commandBonus, creditKill, footAct, frameAct, frameLost, pilotDefense, rec as pilotRec, rollParts, setAwayCaptive } from "./pilots";
import { setPilot } from "./team";
import { has as hasGear, laserBonus, missilePod, reload, salvageGear, spendRound } from "./gear";
import { anonEject, buddyDown } from "./recovery";
import { onStalkerKilled } from "./stalkers";
import { afterCover, partDown, partHit, rangeSteps } from "./parts";
import { casketAct, nmOnKilled, nmPlan } from "./nightmare";

/** Scrap a wreck of this kind holds. */
export function wreckValue(kind: UnitKind): number {
  return RULES.wreckValue[kind] ?? 1;
}

// ---------- RNG, log ----------

export function roll(state: GameState): number {
  let x = state.rng || 1;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  state.rng = x >>> 0;
  return (state.rng % 10000) / 10000;
}
export function chance(state: GameState, p: number): boolean {
  return roll(state) < p;
}
export function pick<T>(state: GameState, arr: T[]): T {
  return arr[Math.min(arr.length - 1, Math.floor(roll(state) * arr.length))];
}
export function shuffle<T>(state: GameState, arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(roll(state) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function log(state: GameState, msg: string) {
  state.log = [msg, ...state.log].slice(0, 120);
  state.events.push(msg);
}
export function uid(state: GameState, prefix: string): string {
  state.uidSeq += 1;
  return prefix + state.uidSeq;
}

// ---------- unit queries ----------

export function living(state: GameState, side?: Side): Unit[] {
  return state.units.filter((u) => u.hp > 0 && !u.away && (side ? u.side === side : true));
}
export function jubey(state: GameState): Unit | undefined {
  return state.units.find((u) => u.kind === "jubey" && u.hp > 0);
}
export function unit(state: GameState, id: string | undefined): Unit | undefined {
  return id ? state.units.find((u) => u.uid === id && u.hp > 0) : undefined;
}
export function is(u: Unit, tag: Tag): boolean {
  return hasTag(u.kind, tag);
}
export function disabled(u: Unit): boolean {
  return !!u.foam || (u.sealed ?? 0) > 0 || u.stunned > 0;
}
export function allies(state: GameState, kind?: UnitKind): Unit[] {
  return living(state, "friendly").filter((u) => u.kind !== "jubey" && (!kind || u.kind === kind));
}
export function hasAlly(state: GameState, kind: UnitKind): boolean {
  return state.units.some((u) => u.kind === kind && u.side === "friendly" && u.hp > 0);
}
export function inDeck(state: GameState, id: CardId): CardInst | undefined {
  return state.deck.find((c) => c.id === id);
}
export function resolving(state: GameState): boolean {
  return state.lastAction === "endTurn";
}

function freeSlot(state: GameState, side: Side, order: number[]): number {
  const used = new Set(state.units.filter((u) => u.side === side && u.hp > 0).map((u) => u.slot));
  for (const i of order) if (!used.has(i)) return i;
  return -1;
}
export function freeEnemySlot(state: GameState): number {
  return freeSlot(state, "enemy", [0, 1, 2, 3, 4, 5]);
}
export function freeFriendSlot(state: GameState): number {
  return freeSlot(state, "friendly", [3, 1, 4, 0, 5, 2]);
}

export function spawn(state: GameState, kind: UnitKind, side: Side, slot: number, extra: Partial<Unit> = {}): Unit {
  const def = UNITS[kind];
  const hp = kind === "jubey" ? state.jubeyMax : def.hp;
  const u: Unit = {
    uid: uid(state, "u"),
    kind,
    side,
    slot,
    hp,
    maxHp: hp,
    atk: def.atk,
    armor: def.armor ?? 0,
    lock: 0,
    missiles: def.missiles,
    burn: 0,
    stunned: 0,
    crazy: false,
    dmgTurn: 0,
    ...extra,
  };
  state.units.push(u);
  if (kind === "robobuddy" && side === "friendly") state.buddy.status = "active";
  return u;
}

// ---------- cards and piles ----------

export function addCard(state: GameState, id: CardId, extra: Partial<CardInst> = {}, toDiscard = false): CardInst {
  const card: CardInst = { uid: uid(state, "c"), id, ...extra };
  if (id === "REDMOUTH" && card.rounds === undefined) card.rounds = RULES.redmouthRounds;
  state.deck.push(card);
  if (toDiscard && state.phase === "player") state.discard.push(card);
  return card;
}
export function removeFromPiles(state: GameState, cardUid: string) {
  for (const k of ["draw", "hand", "discard", "armed"] as const) state[k] = state[k].filter((c) => c.uid !== cardUid);
}
export function destroyCard(state: GameState, cardUid: string) {
  removeFromPiles(state, cardUid);
  state.deck = state.deck.filter((c) => c.uid !== cardUid);
}
export function drawCards(state: GameState, n: number) {
  for (let i = 0; i < n; i++) {
    if (!state.draw.length) {
      if (!state.discard.length) return;
      state.draw = shuffle(state, state.discard);
      state.discard = [];
    }
    state.hand.push(state.draw.pop()!);
  }
}
/** Put a card back into circulation for this fight if a fight is running. */
export function toDiscard(state: GameState, cardUid: string | undefined) {
  if (!cardUid || state.phase !== "player") return;
  const card = state.deck.find((c) => c.uid === cardUid);
  if (!card) return;
  const inPiles = [...state.draw, ...state.hand, ...state.discard, ...state.armed].some((c) => c.uid === cardUid);
  if (!inPiles) state.discard.push(card);
}

export function addScrap(state: GameState, n: number, why: string) {
  if (n <= 0) return;
  state.scrap += n;
  log(state, `${why}: +${n} Scrap`);
}

export function canPayEnergy(state: GameState, n: number, tech: boolean): boolean {
  return state.energy >= n || (tech && n > 0 && state.equip.cell > 0 && state.energy >= n - 1);
}
/** Pays Energy. A Cold Reactor Cell charge covers at most 1 Energy of a Tech ability. */
export function payEnergy(state: GameState, n: number, tech: boolean): boolean {
  if (!canPayEnergy(state, n, tech)) return false;
  if (state.energy >= n) {
    state.energy -= n;
    return true;
  }
  state.energy -= n - 1;
  state.equip.cell -= 1;
  log(state, `Cold Reactor Cell pays 1 Energy. ${state.equip.cell} Charge${state.equip.cell === 1 ? "" : "s"} left.`);
  if (state.equip.cell === 0) {
    const r = roll(state);
    const o = RULES.cellOutcome;
    if (r < o.safe) log(state, "The Cell discharges safely and goes dark.");
    else if (r < o.safe + o.scrap) addScrap(state, 1, "The empty Cell casing is worth something");
    else {
      log(state, "REACTOR BURST. The empty Cell cracks open.");
      const j = jubey(state);
      const near = living(state, "friendly").filter((u) => j && Math.abs(u.slot - j.slot) <= 1);
      for (const u of near) deal(state, u, RULES.cellBurst, "Reactor burst", { noLeech: true });
    }
  }
  return true;
}

// ---------- meters ----------

export function addNightmare(state: GameState, n: number) {
  state.nightmare += n;
  if (state.nightmare >= RULES.nightmareThreshold) {
    state.nightmare = 0;
    state.block = 0;
    state.stripped = RULES.teethStripTurns;
    log(state, `Red Metal Teeth sweep the lane. Defenses stripped: no Block for ${RULES.teethStripTurns} turns.`);
  }
}
export function addContamination(state: GameState, n: number, why: string) {
  if (n <= 0) return;
  state.contamination += n;
  log(state, `${why} Contamination ${state.contamination}.`);
}
export function gainBlock(state: GameState, n: number) {
  if (state.stripped > 0) {
    log(state, "Defenses stripped. No Block.");
    return;
  }
  state.block += n;
  log(state, `Block ${state.block}.`);
}

/** Restores HP. Returns the amount actually restored. */
export function repair(state: GameState, target: Unit | undefined, n: number, by: string, byUid?: string): number {
  if (!target || target.hp <= 0) return 0;
  const before = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + n);
  const got = target.hp - before;
  if (got > 0) {
    log(state, `${by} repaired ${label(target.kind)}: +${got} HP`);
    const l = target.leech;
    if (target.side === "friendly" && l?.variant === "symbiotic" && byUid !== target.uid && state.symbioticPaid < RULES.symbioticMax) {
      state.symbioticPaid += 1;
      addScrap(state, 1, "Symbiotic Leech harvested maintenance scrap");
    }
  }
  return got;
}

export function giveRocketAmmo(state: GameState, n: number) {
  if (state.ownsRocket) {
    for (let i = 0; i < n; i++) addCard(state, "ROCKET", {}, true);
    log(state, `HEAP round loaded. +${n} HEAP Rocket card.`);
  } else {
    state.rocketAmmo += n;
    log(state, `HEAP round stowed (${state.rocketAmmo}). No launcher yet.`);
  }
}

// ---------- wreckage ----------

export function addWreck(state: GameState, w: Omit<Wreck, "id"> & { id?: string }): Wreck {
  const rec: Wreck = { ...w, id: w.id ?? uid(state, "w") };
  state.wrecks.push(rec);
  return rec;
}
export function takeWreck(state: GameState, id: string): Wreck | undefined {
  const w = state.wrecks.find((x) => x.id === id);
  if (w) state.wrecks = state.wrecks.filter((x) => x.id !== id);
  return w;
}
/** Player strips a wreck: Scrap, Threat and the Teeth count. */
export function stripWreck(state: GameState, id: string, scrap: number) {
  const w = takeWreck(state, id);
  if (!w) return;
  if (w.side === "enemy" && PILOTED.includes(w.kind)) rollParts(state, w.src ?? w.id, `Stripping the ${label(w.kind)}'s cockpit`);
  state.scrap += scrap * w.value;
  state.threat += RULES.salvageThreat;
  state.salvagedThisTurn = true;
  state.salvagedThisRoom = true;
  state.tally.salvaged += 1;
  log(state, `Stripped ${w.pile ? "spilled cargo" : label(w.kind) + " wreck"}. +${scrap * w.value} Scrap, +${RULES.salvageThreat} Threat.`);
  addNightmare(state, 1);
}

// ---------- damage and destruction ----------

export interface DealOpts {
  noLeech?: boolean;
  attackerUid?: string;
  /** Explicitly unsurvivable: no Endurance survival roll. */
  unsurvivable?: boolean;
  /** Direct fire: cover takes a point off it. */
  ranged?: boolean;
}

export function deal(state: GameState, target: Unit | undefined, amount: number, src: string, opts: DealOpts = {}): number {
  if (!target || target.hp <= 0 || amount <= 0) return 0;
  let dmg = amount + (target.weak ? 1 : 0);
  if (target.armor > 0) {
    dmg = Math.max(0, dmg - target.armor);
    if (dmg === 0) {
      log(state, `${src} hits ${label(target.kind)}. Armor stops it.`);
      return 0;
    }
  }
  if (opts.ranged) {
    dmg = afterCover(state, target, dmg, src);
    if (dmg <= 0) return 0;
  }
  if (target.side === "friendly" && (target.ward ?? 0) > 0) {
    const soak = Math.min(target.ward!, dmg);
    target.ward! -= soak;
    dmg -= soak;
    if (dmg === 0) {
      log(state, `${src} hits ${label(target.kind)}. The collapsed bulkhead absorbs it.`);
      return 0;
    }
  }
  if (target.kind === "jubey" && state.block > 0) {
    const soak = Math.min(state.block, dmg);
    state.block -= soak;
    dmg -= soak;
    if (dmg === 0) {
      log(state, `${src} hits Jubey. Block holds (${soak}).`);
      return 0;
    }
  }
  if (target.kind === "pilot" && target.side === "friendly") {
    dmg = pilotDefense(state, target, dmg);
    if (dmg <= 0) return 0;
  }
  target.hp -= dmg;
  target.dmgTurn += dmg;
  if (target.side === "enemy" && (target.pacified ?? 0) > 0) {
    target.pacified = 0;
    state.badge.hostile = true;
    log(state, "You fired on a machine that trusted the badge. It will remember.");
  }
  log(state, `${src} hits ${label(target.kind)} for ${dmg}. (${Math.max(0, target.hp)}/${target.maxHp})`);
  if (target.kind === "possum" && target.hp > 0 && opts.attackerUid && !target.shutdown) {
    target.shutdown = true;
    target.mood = "playing dead";
    log(state, "Machine Possum drops and plays dead.");
  }
  onDamaged(state, target);
  if (target.hp > 0) partHit(state, target, dmg);
  const l = target.leech;
  if (l && target.side === "enemy" && !opts.noLeech && !l.firedTurn && target.dmgTurn >= RULES.leechThreshold) extract(state, target);
  if (target.hp <= 0 && target.kind === "pilot" && target.side === "friendly" && !opts.unsurvivable) {
    const r = pilotRec(state, target.pilot);
    if (r && avoidDeath(state, r)) target.hp = 1;
  }
  if (target.hp <= 0) kill(state, target, opts.attackerUid);
  return dmg;
}

function extract(state: GameState, host: Unit) {
  const l = host.leech!;
  l.firedTurn = true;
  l.count += 1;
  addScrap(state, 1, `${cardName("LEECH", l.variant)} extracts from ${label(host.kind)}`);
  if (l.count === RULES.leechStripAt && !l.stripped) {
    l.stripped = true;
    if (host.armor > 0) {
      host.armor -= 1;
      log(state, "Salvage Leech stripped armor: -1");
    } else {
      host.weak = true;
      log(state, "Salvage Leech stripped plating: the host takes +1 from every hit");
    }
  }
  if (l.variant === "blood") {
    const bite = Math.max(0, 1 - host.armor);
    host.hp -= bite;
    log(state, bite ? `Blood-Scrap Leech bites ${label(host.kind)} for 1. (${Math.max(0, host.hp)}/${host.maxHp})` : "Blood-Scrap Leech bites. Armor stops it.");
  }
  if (l.count >= RULES.leechMax && host.hp > 0) {
    log(state, "The Leech is full and drops off.");
    if (!l.temp) toDiscard(state, l.cardUid);
    host.leech = undefined;
  }
}

function leavesWreck(kind: UnitKind): boolean {
  return ["light", "lvl2", "zombie", "drone", "patient", "powered", "needleback", "latchback", "widow", "kilnheart", "bishop", "relay", "prisoner"].includes(kind);
}

function rollWeaponFinds(state: GameState, dead: Unit) {
  if (dead.kind !== "light" && dead.kind !== "lvl2" && dead.kind !== "zombie") return;
  if (!state.ownsRocket) {
    const p = dead.kind === "lvl2" ? Math.min(0.8, state.rocketFindChance * 2) : state.rocketFindChance;
    if (chance(state, p)) {
      state.ownsRocket = true;
      state.rocketFindChance = RULES.rocketFindBase;
      const rounds = 1 + state.rocketAmmo;
      state.rocketAmmo = 0;
      log(state, "Rocket launcher recovered from the wreck.");
      giveRocketAmmo(state, rounds);
    } else {
      state.rocketFindChance = Math.min(RULES.rocketFindCap, state.rocketFindChance + RULES.rocketFindPity);
    }
  }
  if (chance(state, dead.kind === "lvl2" ? RULES.rocketAmmoLvl2 : RULES.rocketAmmoLight)) giveRocketAmmo(state, 1);
}

export function kill(state: GameState, u: Unit, killerUid?: string) {
  u.hp = 0;
  log(state, `${label(u.kind)} down.`);
  if (u.kind === "jubey") {
    state.phase = "dead";
    log(state, "Jubey is still. The hall keeps the rig.");
    return;
  }
  state.units = state.units.filter((x) => x.uid !== u.uid);
  if (u.side === "enemy") creditKill(state, killerUid);
  for (const n of state.units) {
    if (n.clamp === u.uid) n.clamp = undefined;
    if (n.guards === u.uid) n.guards = undefined;
  }
  if (u.side === "enemy") killEnemy(state, u);
  else killFriendly(state, u, killerUid);
}

function killEnemy(state: GameState, u: Unit) {
  state.tally.kills += 1;
  const noWreck = onEnemyKilled(state, u) || u.kind === "capsule" || u.kind === "mimic";
  onStalkerKilled(state, u);
  nmOnKilled(state, u);
  state.lastKilled = u.kind === "patient" ? state.lastKilled : u.kind;
  if (u.kind === "infested") {
    log(state, "Infested wreck gives nothing.");
    addNightmare(state, 1);
  } else if (u.kind === "rifleman") {
    state.cash += RULES.rifleCash;
    state.madness += RULES.rifleMadness;
    log(state, `+${RULES.rifleCash} Cash off the body. +${RULES.rifleMadness} Madness.`);
  } else {
    const rsP = RULES.rsDrop * (state.pathRisky ? RULES.riskyRsMult : 1);
    if (u.kind !== "drone" && u.kind !== "capsule" && u.kind !== "relay" && !u.temp && chance(state, rsP)) {
      state.rs += 1;
      log(state, "+1 Reactor Salvage.");
    }
    if (!u.temp) rollWeaponFinds(state, u);
  }
  const reserved = !u.temp && !noWreck ? anonEject(state, u) : undefined;
  if (!u.temp) salvageGear(state, u);
  if (leavesWreck(u.kind) && !u.temp && !noWreck) addWreck(state, { kind: u.kind, side: "enemy", value: wreckValue(u.kind), src: reserved ? "pilot:" + reserved : undefined });

  // Machine Possum: one pull per corpse, capped per encounter.
  for (const p of allies(state, "possum")) {
    if (state.possumPaid >= RULES.possumCap) break;
    p.shutdown = false;
    p.carried = (p.carried ?? 0) + 1;
    p.mood = "scavenging frantically";
    state.possumPaid += 1;
    log(state, "Machine Possum wakes and drags off 1 Scrap of salvage.");
  }

  const l = u.leech;
  if (l) {
    if (l.variant === "queen") {
      const next = living(state, "enemy").find((e) => is(e, "mechanical") && !e.leech);
      if (next) {
        next.leech = { count: 0, stripped: false, firedTurn: false, temp: true };
        log(state, `Queen Salvager drops an offspring onto ${label(next.kind)}.`);
      }
    }
    if (!l.temp) {
      if (chance(state, RULES.leechDeathLoss)) log(state, "The Leech is crushed under the falling host. Gone for this fight.");
      else {
        toDiscard(state, l.cardUid);
        log(state, "The Leech crawls clear of the wreck.");
      }
    }
  }
}

function killFriendly(state: GameState, u: Unit, killerUid?: string) {
  if (u.kind === "pilot") {
    const r = pilotRec(state, u.pilot);
    log(state, `${r?.name ?? "The pilot"} does not get up.`);
    setPilot(state, u.pilot, "dead");
    return;
  }
  if (u.kind === "casket") nmOnKilled(state, u);
  if (u.kind === "frame" || (u.kind === "casket" && u.pilot)) {
    const id = u.pilot;
    const fate = frameLost(state, u);
    if (fate === "dead") setPilot(state, id, "dead");
    if (fate === "away") setAwayCaptive(state, id);
  }
  if (u.kind === "beacon") log(state, "THREAT BEACON DESTROYED. The signal cuts out with a shriek.");
  if (u.kind === "clampjaw") clampLost(state, u.uid);
  if (u.kind === "clampjaw" || u.kind === "pod") loseCaptive(state, u.uid, `the ${label(u.kind)} is destroyed`);
  if (u.leech && !u.leech.temp) toDiscard(state, u.leech.cardUid);
  if (!is(u, "machine")) {
    if (!u.temp) toDiscard(state, u.cardUid);
    return;
  }
  if (!u.temp) toDiscard(state, u.cardUid);

  // Cargo first, so nothing is duplicated.
  if (u.kind === "possum" && (u.carried ?? 0) > 0) {
    addWreck(state, { kind: "possum", side: "friendly", value: u.carried!, pile: true });
    log(state, "The Possum's takings spill across the floor.");
  } else if (u.kind === "shepherd" && (u.carried ?? 0) > 0) {
    if (u.secured) addScrap(state, 1, "Secured cargo survives the Shepherd");
    else {
      addWreck(state, { id: u.carriedIds?.[0], kind: "shepherd", side: "friendly", value: 1, pile: true });
      log(state, "Cargo spill: the Shepherd's unfinished haul lies in the open.");
    }
  }
  if (u.kind === "robobuddy") buddyDown(state);
  const w = u.temp || u.kind === "robobuddy" ? undefined : addWreck(state, { kind: u.kind, side: "friendly", value: 1, free: u.kind === "builder" });
  if (u.kind === "builder" && w) log(state, "Last Useful Act: the drone leaves 1 Scrap in its wreck.");

  if (u.kind === "walker" && u.elevated) {
    const below = living(state, "enemy").sort((a, b) => Math.abs(a.slot - u.slot) - Math.abs(b.slot - u.slot))[0];
    if (below) {
      log(state, "The Ceiling Walker loses its grip.");
      deal(state, below, RULES.walkerFall, "Falling machine", { noLeech: true });
    } else log(state, "The Ceiling Walker falls and hits nothing.");
  }

  for (const b of allies(state, "builder")) {
    if (w) b.remember = w.id;
    b.mood = "chirps in distress";
  }
  for (const j of allies(state, "jack")) {
    if (j.protect !== u.uid) continue;
    j.protect = undefined;
    j.malf = "uncontrolled";
    j.grudge = killerUid;
    if (!j.rage) {
      j.rage = true;
      j.atk += RULES.jackRage;
    }
    j.mood = "unstable";
    log(state, `Panic Jack loses its ward and goes uncontrolled. +${RULES.jackRage} damage for the fight.`);
  }

  // Reactions, in a fixed order: Reflex, then Recorder.
  if (state.phase === "dead") return;
  const reflex = state.armed.find((c) => c.id === "REFLEX");
  const printed = UNITS[u.kind].atk;
  if (reflex && !state.reflexUsed && printed > 0) {
    const tgt = fighters(state).sort((a, b) => Math.abs(a.slot - u.slot) - Math.abs(b.slot - u.slot))[0];
    if (tgt) {
      state.reflexUsed = true;
      state.madness += 1;
      log(state, `Dead Pilot's Reflex: Jubey's arm moves the way the ${label(u.kind)} did. +1 Madness.`);
      deal(state, tgt, printed, "Reflex strike", { noLeech: false });
    }
  }
  const rec = state.armed.find((c) => c.id === "RECORDER");
  if (rec && !state.recorderUsed && state.scrap >= RULES.recorderScrap && state.phase !== ("dead" as string)) {
    state.recorderUsed = true;
    state.scrap -= RULES.recorderScrap;
    state.madness += 1;
    state.armed = state.armed.filter((c) => c.uid !== rec.uid);
    state.discard.push(rec);
    log(state, `Black-Box Recorder: ${pick(state, RECORDER_LINES)} −${RULES.recorderScrap} Scrap, draw ${RULES.recorderDraw}, +1 Madness.`);
    if (resolving(state)) state.bonusDraw += RULES.recorderDraw;
    else drawCards(state, RULES.recorderDraw);
  }
}

// ---------- enemy planning (telegraphed) and actions ----------

export function enemyHitChance(state: GameState, u?: Unit, target?: Unit): number {
  let miss = 1 - RULES.enemyBaseHit;
  const spotted = target && u && u.kind !== "scout" && target.spotted === state.turn ? 1 : 0;
  const steps = state.accModEnemy + (u?.accMod ?? 0) - (partDown(u, "sensors") ? 1 : 0) - rangeSteps(u, target) + spotted;
  if (steps > 0) for (let i = 0; i < steps; i++) miss *= 0.5;
  else for (let i = 0; i < -steps; i++) miss = Math.min(1, miss * 2);
  const base = 1 - miss;
  const sight = laserBonus(u);
  // The sight works inside the existing limits: it never lifts a shot past the cap.
  return sight > 0 ? Math.max(base, Math.min(RULES.hitCap, base + sight)) : base;
}

/** One enemy's turn: its action, then anything bolted on that fires by itself. */
export function enemyTurn(state: GameState, u: Unit) {
  const free = !(u.stunned > 0 || u.foam || (u.sealed ?? 0) > 0 || (u.pacified ?? 0) > 0 || u.cap);
  enemyAct(state, u);
  // The Gunner Mech's second burst: same plan, its own aim roll, its own round.
  if (free && u.kind === "gunner" && u.plan?.type === "attack" && u.hp > 0 && state.units.includes(u) && (u.ammo ?? 1) > 0 && state.phase === "player") {
    log(state, "The Gunner Mech keeps the trigger down.");
    enemyAct(state, u);
  }
  if (free && state.phase === "player") missilePod(state, u, (x) => pickTarget(state, x, true), enemyHitChance(state, u));
}

/** Legal targets. A melee weapon cannot reach anything overhead; a missile can. */
function targetable(state: GameState, attacker: Unit, ranged = false): Unit[] {
  const melee = !ranged && is(attacker, "melee");
  return living(state, "friendly").filter((f) => !f.foam && !f.shutdown && !(melee && f.elevated));
}
function nearest(list: Unit[], slot: number): Unit | undefined {
  return list.slice().sort((a, b) => Math.abs(a.slot - slot) - Math.abs(b.slot - slot) || a.slot - b.slot)[0];
}

/** Friendly bots with no weapon and nothing building: enemies mostly look past them. */
export const NONCOMBAT: UnitKind[] = ["robobuddy", "possum", "clampjaw", "pod", "bulkhead"];
/**
 * Non-combat bots that build toward a threat over turns: the Shepherd piles
 * Scrap to feed the Warframe. Reduced less. The Builder Drone (timed builds)
 * and the Unfinished Warframe (startup) are not reduced at all.
 */
export const BUILDING: UnitKind[] = ["shepherd"];
export function targetWeight(u: Unit): number {
  if (NONCOMBAT.includes(u.kind)) return RULES.noncombatWeight;
  if (BUILDING.includes(u.kind)) return RULES.buildingWeight;
  return 1;
}
function weightedPick(state: GameState, c: Unit[]): Unit {
  const total = c.reduce((n, u) => n + targetWeight(u), 0);
  let r = roll(state) * total;
  for (const u of c) if ((r -= targetWeight(u)) < 0) return u;
  return c[c.length - 1];
}

/** The quarter of the time an enemy actually thinks about who to shoot. */
function tacticalTarget(state: GameState, u: Unit, all: Unit[]): Unit {
  // A thinking enemy does not waste a shot on a bot that cannot hurt it, unless that is all there is.
  const fighting = all.filter((f) => !NONCOMBAT.includes(f.kind));
  const c = fighting.length ? fighting : all;
  const j = c.find((f) => f.kind === "jubey");
  if (u.kind === "infested") {
    const hunt = state.threat >= RULES.threatHunt || state.contamination >= RULES.contamHunt;
    return (hunt ? j : undefined) ?? nearest(c, u.slot)!;
  }
  if (u.kind === "lvl2" || u.kind === "zombie" || u.kind === "patient") {
    const wf = c.find((f) => f.kind === "warframe" && !f.inert);
    if (wf) return wf;
  }
  if (u.kind === "predator") {
    const machines = c.filter((f) => is(f, "machine"));
    if (machines.length) return machines.sort((a, b) => a.hp - b.hp)[0];
  }
  if (u.kind === "nightmare") {
    const people = c.filter((f) => f.kind === "pilot" || (f.kind === "frame" && !!f.pilot));
    if (people.length) return nearest(people, u.slot)!;
  }
  // Finish the most wounded thing it can reach. Jubey only when Jubey is the one hurting.
  return c.slice().sort((a, b) => a.hp - b.hp || Math.abs(a.slot - u.slot) - Math.abs(b.slot - u.slot))[0];
}

/**
 * Most of the time a uniformly random legal target; the rest, a tactical pick.
 * The decoy beacon is an explicit rule and always wins. Scripted orders (the
 * Brawler's guard, Bishop's mark, the saboteur run) are applied by their own
 * planners on top of this.
 */
export function pickTarget(state: GameState, u: Unit, ranged = false): Unit | undefined {
  const c = targetable(state, u, ranged);
  if (!c.length) return undefined;
  const beacon = c.find((f) => f.kind === "beacon");
  if (beacon) return beacon;
  if (chance(state, RULES.randomTarget)) return weightedPick(state, c);
  return tacticalTarget(state, u, c);
}

export function attackPlan(state: GameState, u: Unit, target?: Unit): Plan {
  const tgt = target ?? pickTarget(state, u);
  if (u.missiles > 0 && u.lock >= 2) return { type: "missile", targetUid: tgt?.uid, dmg: u.kind === "lvl2" ? 6 : 3 };
  return { type: "attack", targetUid: tgt?.uid, dmg: u.atk };
}

export function planEnemy(state: GameState, u: Unit): Plan {
  if (u.foam || u.stunned > 0) return { type: "disabled" };
  const p = planEnemyCore(state, u);
  if (p.type === "attack" && hasGear(u, "laser")) p.laser = true;
  return p;
}
function planEnemyCore(state: GameState, u: Unit): Plan {
  if ((u.sealed ?? 0) > 0) return u.kind === "zombie" ? { type: "break", note: "breaking the seal" } : { type: "disabled" };
  if ((u.pacified ?? 0) > 0) return { type: "hold", note: "badge accepted" };
  const nmp = nmPlan(state, u);
  if (nmp) return nmp;
  const special = planSpecial(state, u);
  if (special) return special;
  if (u.leech) {
    if (is(u, "leech_purge") && chance(state, RULES.purgeChanceHeavy)) return { type: "purge", note: "purging the Leech" };
    if (u.kind === "light" && chance(state, RULES.tearChancePiloted)) return { type: "tear", note: "tearing off plating" };
  }
  if (u.kind === "drone") {
    const host = living(state, "enemy").find((e) => e.uid !== u.uid && e.leech);
    if (host && chance(state, RULES.droneRemoveLeech)) return { type: "removeLeech", targetUid: host.uid, note: "cutting the Leech off" };
    const contested = state.wrecks.length > 0 && (hasAlly(state, "shepherd") || state.wrecks.some((w) => w.pile));
    if (contested && chance(state, RULES.droneScavenge)) return { type: "scavenge", note: "recovering wreckage" };
    const b = allies(state, "builder").find((x) => !x.jammed);
    if (b && chance(state, RULES.droneJam)) return { type: "jam", targetUid: b.uid, note: "jamming the Builder" };
  }
  if (is(u, "heavy_machine") && state.units.some((n) => n.clamp === u.uid) && chance(state, RULES.shakeClamp)) {
    return { type: "shake", note: "shaking the Gun Nest loose" };
  }
  if (u.kind === "light") {
    const wf = allies(state, "warframe").find((w) => w.inert && !w.foam);
    if (wf && chance(state, RULES.saboteur)) return { ...attackPlan(state, u, wf), note: "going for the startup rig" };
  }
  if (u.kind === "predator" && state.wrecks.length && chance(state, 0.35)) return { type: "scavenge", note: "tearing into the wreckage" };
  // An empty magazine means a turn spent reloading, telegraphed like anything else.
  if (u.ammo === 0 && !(is(u, "melee") && !engaged(u))) return { type: "reload", note: u.kind === "mortar" ? "LOADING A SHELL" : "RELOADING" };
  // The Mortar Mech marks a column, not a unit: whatever stands there when it fires takes the shell.
  if (u.kind === "mortar") {
    const t = pickTarget(state, u, true);
    if (t) return { type: "shell", col: t.slot, targetUid: t.uid, note: `SHELLING column ${t.slot + 1}` };
  }
  return attackPlan(state, u);
}

export function planEnemies(state: GameState) {
  for (const u of living(state, "enemy")) u.plan = planEnemy(state, u);
  teamOrders(state);
}

/** Cover and guards step in front of a targeted ally. */
function redirect(state: GameState, attacker: Unit, tgt: Unit): Unit {
  const bulk = living(state, "friendly").find((b) => b.kind === "bulkhead" && b.guards === tgt.uid && !b.foam);
  if (bulk) {
    log(state, `Emergency Bulkhead takes the shot meant for ${label(tgt.kind)}.`);
    return bulk;
  }
  const jack = allies(state, "jack").find((j) => j.protect === tgt.uid && !j.intercepted && !disabled(j) && j.malf !== "uncontrolled" && j.uid !== tgt.uid);
  if (jack) {
    jack.intercepted = true;
    jack.grudge = attacker.uid;
    jack.mood = "staggers from the blow";
    log(state, `Panic Jack throws itself in front of ${label(tgt.kind)}.`);
    return jack;
  }
  return tgt;
}

function crazyDmg(base: number, crazy: boolean, state: GameState): number {
  if (!crazy) return base;
  const half = base * 1.5;
  if (base % 2 === 0) return Math.round(half);
  return Math.floor(half) + (chance(state, 0.5) ? 1 : 0);
}

export function tripMine(state: GameState, u: Unit) {
  if (state.minesArmed <= 0 || u.hp <= 0 || !is(u, "mechanical")) return;
  state.minesArmed -= 1;
  const i = state.loadoutAd.indexOf("MINE");
  if (i >= 0) state.loadoutAd.splice(i, 1);
  log(state, `AM MINE. ${label(u.kind)} walks onto it.`);
  deal(state, u, RULES.mineDamage, "AM Mine");
}

export function enemyAct(state: GameState, u: Unit) {
  if (state.turn >= 2) tripMine(state, u);
  if (u.hp <= 0) return;
  const name = label(u.kind);
  if (u.stunned > 0) {
    u.stunned -= 1;
    log(state, `${name} is stunned.`);
    return;
  }
  if (u.foam) {
    log(state, `${name} strains inside the foam.`);
    return;
  }
  const plan = u.plan ?? planEnemy(state, u);
  if ((u.sealed ?? 0) > 0) {
    if (plan.type === "break" || u.kind === "zombie") {
      u.sealed = 0;
      log(state, `${name} breaks the seal. No healing.`);
    } else {
      u.sealed! -= 1;
      if (u.sealed === 0) {
        log(state, `The sealant cracks off ${name}.`);
        repair(state, u, RULES.coffinHeal, "Sealant");
      } else log(state, `${name} is sealed.`);
    }
    return;
  }
  if ((u.pacified ?? 0) > 0) {
    log(state, `${name} idles, reading your badge.`);
    return;
  }
  if (actSpecial(state, u, plan)) return;
  if (u.hp <= 0 || !state.units.includes(u)) return;
  switch (plan.type) {
    case "purge": {
      const l = u.leech;
      if (!l) break;
      u.leech = undefined;
      const card = state.deck.find((c) => c.uid === l.cardUid);
      if (card && !l.temp) {
        state.ejected = { card, count: l.count, stripped: l.stripped };
        log(state, `${name} vents its plating and ejects the Leech onto the floor. One turn to get it back.`);
      } else log(state, `${name} purges the parasite.`);
      return;
    }
    case "tear": {
      const l = u.leech;
      if (!l) break;
      u.leech = undefined;
      if (!l.temp) toDiscard(state, l.cardUid);
      log(state, `${name}: ${pick(state, LEECH_RADIO)} It rips away its own plating with the Leech on it.`);
      deal(state, u, 1, "Self-inflicted purge", { noLeech: true });
      return;
    }
    case "removeLeech": {
      const host = unit(state, plan.targetUid);
      if (host?.leech) {
        if (!host.leech.temp) toDiscard(state, host.leech.cardUid);
        host.leech = undefined;
        log(state, `Drone cuts the Leech off ${label(host.kind)}.`);
        return;
      }
      break;
    }
    case "scavenge": {
      const w = state.wrecks.find((x) => x.pile) ?? state.wrecks[0];
      if (w) {
        takeWreck(state, w.id);
        log(state, `${name} drags off ${w.pile ? "the spilled cargo" : "a " + label(w.kind) + " wreck"} before you can.`);
        return;
      }
      break;
    }
    case "jam": {
      const b = unit(state, plan.targetUid);
      if (b && b.kind === "builder") {
        b.jammed = true;
        log(state, "Drone floods the Builder's band with noise. Its next action is lost.");
        return;
      }
      break;
    }
    case "shake": {
      const nest = state.units.find((n) => n.clamp === u.uid);
      if (nest) {
        nest.clamp = undefined;
        log(state, `${name} shakes the Gun Nest loose.`);
        return;
      }
      break;
    }
    case "shell": {
      const col = plan.col ?? -1;
      spendRound(state, u);
      if (!chance(state, enemyHitChance(state, u))) {
        log(state, `The Mortar Mech's shell lands short of column ${col + 1}.`);
        return;
      }
      const hit = living(state, "friendly").find((f) => f.slot === col);
      if (!hit) log(state, `A shell lands in column ${col + 1}. Nobody is standing there any more.`);
      else deal(state, hit, RULES.mortarDamage, "Mortar shell", { attackerUid: u.uid });
      for (const f of living(state, "friendly").filter((x) => Math.abs(x.slot - col) === 1)) deal(state, f, RULES.mortarSplash, "Mortar splash");
      return;
    }
    case "reassemble":
      if (!u.repaired) {
        u.repaired = true;
        u.hp = Math.min(u.maxHp, u.hp + RULES.deadframeHeal);
        log(state, `The Dead Frame pulls its plating back into place. +${RULES.deadframeHeal} HP (${u.hp}/${u.maxHp}).`);
        return;
      }
      break;
    case "reload":
      if (u.ammo !== undefined) {
        reload(state, u);
        return;
      }
      break;
    default:
      break;
  }

  // Melee is a matter of range: no blow lands before the unit is Engaged.
  if (is(u, "melee") && !engaged(u)) {
    u.prox = Math.min(RULES.proxEngaged, (u.prox ?? 0) + 1);
    log(state, `${name} closes.`);
    return;
  }
  // Attack (also the fallback when a planned counter is no longer possible).
  let tgt = unit(state, plan.targetUid);
  if (!tgt || tgt.side !== "friendly" || !targetable(state, u).includes(tgt)) tgt = pickTarget(state, u);
  if (u.crazy && chance(state, RULES.crazyFriendlyFire)) {
    const own = living(state, "enemy").filter((a) => a.uid !== u.uid && Math.abs(a.slot - u.slot) <= 1);
    if (own.length) {
      const victim = pick(state, own);
      log(state, `${name} [CRAZY] swings at its own.`);
      if (chance(state, enemyHitChance(state, u))) deal(state, victim, crazyDmg(u.atk, true, state), name, { noLeech: true });
      return;
    }
  }
  if (!tgt) {
    log(state, `${name} finds nothing to shoot.`);
    return;
  }
  const missile = u.missiles > 0 && u.lock >= 2;
  if (missile) {
    u.lock = 0;
    u.missiles -= 1;
  } else if (!is(u, "melee")) spendRound(state, u);
  const marked = state.teamMark && is(u, "team") && u.kind !== "needleback";
  if (marked) {
    state.teamMark = false;
    log(state, `${name} fires on Needleback's mark.`);
  } else if (!chance(state, enemyHitChance(state, u, missile ? undefined : tgt))) {
    log(state, `${name}${missile ? " missile" : ""} misses.`);
    return;
  }
  const final = redirect(state, u, tgt);
  const wasJack = final.kind === "jack" && final.uid !== tgt.uid;
  const base = missile ? (u.kind === "lvl2" ? 6 : 3) : Math.max(1, u.atk - (partDown(u, "weapon") ? 1 : 0));
  const done = deal(state, final, crazyDmg(base, u.crazy, state), missile ? `${name} missile` : name, { attackerUid: u.uid, ranged: !missile && !is(u, "melee") });
  if (u.kind === "infested" && final.kind === "jubey" && done > 0) addContamination(state, RULES.contamPerInfestedHit, "The Infested leaves something on the rig.");
  if (u.kind === "scout" && done > 0 && final.hp > 0) {
    final.spotted = state.turn;
    log(state, `SPOTTED: the Scout Mech paints the ${label(final.kind)}. Every other enemy aims better at it this turn.`);
  }
  if (u.kind === "nightmare" && done > 0) {
    state.madness += 1;
    log(state, "The Nightmare Stalker's frame is wrong to look at. +1 Madness.");
  }
  if (missile && final.hp > 0 && done > 0 && chance(state, 0.5)) {
    final.burn = Math.max(final.burn, 2);
    log(state, `${label(final.kind)} ignited.`);
  }
  if (!missile && u.missiles > 0 && final.hp > 0) u.lock += 1;
  if (wasJack && final.hp > 0 && u.hp > 0) {
    log(state, "Panic Jack swings back.");
    deal(state, u, RULES.jackCounter, "Panic Jack counter", { attackerUid: final.uid });
  }
}

// ---------- allied machines ----------

function machineAttack(state: GameState, a: Unit, tgt: Unit | undefined, dmg: number) {
  if (!tgt || dmg <= 0) return;
  const p = (a.kind === "scared" ? RULES.allyHit : RULES.machineHit) + commandBonus(state);
  if (chance(state, p)) deal(state, tgt, dmg, label(a.kind), { attackerUid: a.uid, ranged: !is(a, "melee") });
  else log(state, `${label(a.kind)} fires wide.`);
}
function nearestEnemy(state: GameState, a: Unit): Unit | undefined {
  return nearest(fighters(state), a.slot);
}

export function damagedAllies(state: GameState, exceptUid?: string): Unit[] {
  return living(state, "friendly").filter((u) => u.uid !== exceptUid && is(u, "mechanical") && u.hp < u.maxHp);
}
function mostDamaged(state: GameState, list: Unit[]): Unit | undefined {
  if (!list.length) return undefined;
  const worst = Math.max(...list.map((u) => 1 - u.hp / u.maxHp));
  return pick(state, list.filter((u) => 1 - u.hp / u.maxHp >= worst - 1e-9));
}

export function activateWarframe(state: GameState, w: Unit) {
  w.inert = false;
  w.acted = true;
  w.mood = "online";
  log(state, "UNFINISHED WARFRAME ONLINE. Pistons engage, armor locks, lights come up.");
  if (w.hp <= RULES.warframeCorruptHp && chance(state, RULES.warframeCorrupt)) {
    w.malf = "hostile";
    w.mood = "hostile startup";
    log(state, "CORRUPTED STARTUP. The Warframe's targeting swings toward you. Reset it before it acts.");
  }
}
export function addProgress(state: GameState, w: Unit, why: string) {
  if (!w.inert) return;
  w.progress = Math.min(RULES.warframeNeed, (w.progress ?? 0) + 1);
  log(state, `${why}: Warframe startup ${w.progress}/${RULES.warframeNeed}.`);
  if (w.progress >= RULES.warframeNeed) activateWarframe(state, w);
}

type Job = "leech" | "reset" | "wrong" | "patch" | "sort" | "commission" | "secure" | "wreck";

function builderJob(state: GameState, b: Unit): Job | null {
  if (state.ejected) return "leech";
  if (allies(state, "warframe").some((w) => w.malf === "hostile")) return "reset";
  if (b.malf === "wrongRepair") return "wrong";
  const canPatch = b.variant !== "scavenger" && damagedAllies(state, b.uid).length > 0;
  const canSort = (b.sorted ?? 0) < RULES.builderSortCap;
  const frame = allies(state, "warframe").find((w) => w.inert && !w.paused && !disabled(w));
  if (b.order === "patch" && canPatch) return "patch";
  if (b.order === "sort" && canSort) return "sort";
  if (b.order === "commission" && frame) return "commission";
  if (b.remember && state.wrecks.some((w) => w.id === b.remember)) return "wreck";
  const pool: Job[] = [];
  if (canPatch) pool.push("patch");
  if (canSort) pool.push("sort");
  if (frame) pool.push("commission");
  if (allies(state, "shepherd").some((s) => s.carried === 1 && !s.secured)) pool.push("secure");
  return pool.length ? pick(state, pool) : null;
}

function builderAct(state: GameState, b: Unit) {
  if (b.jammed) {
    b.jammed = false;
    b.mood = "jammed";
    log(state, "Builder Drone twitches through the jamming and does nothing.");
    return;
  }
  const interval = b.variant === "overworked" ? 1 : RULES.builderInterval;
  b.timer = Math.max(0, (b.timer ?? interval) - 1);
  if (b.timer > 0) {
    machineAttack(state, b, nearestEnemy(state, b), b.atk);
    return;
  }
  const job = builderJob(state, b);
  if (!job) {
    b.mood = "looks from one machine to another, confused";
    log(state, "Builder Drone finds nothing to fix and idles.");
    return; // the maintenance opportunity is kept
  }
  b.order = undefined;
  b.timer = interval;
  b.jobs = (b.jobs ?? 0) + 1;
  b.mood = pick(state, BUILDER_MOODS);
  switch (job) {
    case "leech":
      toDiscard(state, state.ejected!.card.uid);
      state.ejected = null;
      log(state, "Builder Drone scuttles out and collects the ejected Leech.");
      break;
    case "reset": {
      const w = allies(state, "warframe").find((x) => x.malf === "hostile")!;
      w.malf = undefined;
      w.mood = "online";
      log(state, "Builder Drone resets the Warframe. Control restored.");
      break;
    }
    case "wrong": {
      b.malf = undefined;
      const enemy = mostDamaged(state, living(state, "enemy").filter((e) => is(e, "mechanical") && e.hp < e.maxHp));
      if (enemy) {
        b.mood = "humming something";
        repair(state, enemy, RULES.possessedPatch, "Possessed Builder");
      }
      break;
    }
    case "patch": {
      const t = mostDamaged(state, damagedAllies(state, b.uid));
      repair(state, t, b.variant === "possessed" ? RULES.possessedPatch : RULES.builderPatch, "Builder Drone", b.uid);
      break;
    }
    case "sort": {
      const n = b.variant === "scavenger" ? RULES.scavengerSort : RULES.builderSort;
      b.sorted = (b.sorted ?? 0) + 1;
      addScrap(state, n, "Builder Drone sorts debris");
      break;
    }
    case "commission":
      addProgress(state, allies(state, "warframe").find((w) => w.inert)!, "Builder Drone commissioning");
      break;
    case "secure": {
      const s = allies(state, "shepherd").find((x) => x.carried === 1 && !x.secured)!;
      s.secured = true;
      log(state, "Builder Drone straps down the Shepherd's cargo.");
      break;
    }
    case "wreck": {
      const w = takeWreck(state, b.remember!);
      b.remember = undefined;
      if (w) addScrap(state, w.value, "Builder Drone tries to repair the wreck, understands, and salvages it");
      break;
    }
  }
  if (b.variant === "overworked" && b.jobs % RULES.overworkedEvery === 0) {
    log(state, `Overworked Drone burns out a servo.${b.hp <= 2 ? " WARNING: it will not survive much more." : ""}`);
    deal(state, b, 1, "Overwork", { noLeech: true });
  }
}

function shepherdAct(state: GameState, s: Unit) {
  if (s.hold) return;
  const w = state.wrecks.find((x) => !x.free) ?? state.wrecks[0];
  if (!w) {
    s.mood = "searching";
    return;
  }
  takeWreck(state, w.id);
  s.carried = (s.carried ?? 0) + 1;
  s.carriedIds = [...(s.carriedIds ?? []), w.id];
  s.secured = false;
  s.mood = `hauling ${s.carried}`;
  log(state, `Scrap Shepherd hauls in ${w.pile ? "the spilled cargo" : "a " + label(w.kind) + " wreck"} (${s.carried}/${RULES.shepherdPair}).`);
  if (s.carried < RULES.shepherdPair) return;
  s.carried = 0;
  s.carriedIds = [];
  const frame = allies(state, "warframe").find((f) => f.inert && !f.fed);
  if (s.feed && frame) {
    frame.fed = true;
    addProgress(state, frame, "Assembly Line: the Shepherd feeds its haul into the frame");
  } else addScrap(state, RULES.shepherdPayout, "Scrap Shepherd unloads");
}

function nestAct(state: GameState, n: Unit) {
  let tgt = unit(state, n.clamp);
  if (!tgt) {
    n.clamp = undefined;
    tgt = nearestEnemy(state, n);
  }
  if (!tgt) return;
  if (!n.clamp) {
    const dir = Math.sign(tgt.slot - n.slot);
    const next = n.slot + dir;
    const blocked = state.units.some((u) => u.side === "friendly" && u.hp > 0 && u.slot === next);
    if (dir !== 0 && !blocked) n.slot = next;
    if (n.slot === tgt.slot) {
      n.clamp = tgt.uid;
      n.mood = "clamped";
      log(state, `Gun Nest clamps onto ${label(tgt.kind)}.`);
    } else n.mood = "crawling";
  }
  if (Math.abs(n.slot - tgt.slot) <= 1) machineAttack(state, n, tgt, n.atk + (n.clamp ? RULES.nestClampBonus : 0));
}

/** One autonomous action for one allied unit. Never acts twice in a turn. */
export function allyAct(state: GameState, a: Unit) {
  if (a.acted) {
    a.acted = false;
    return;
  }
  if (a.foam) return;
  if ((a.sealed ?? 0) > 0) {
    a.sealed! -= 1;
    if (a.sealed === 0) {
      log(state, `The sealant cracks off ${label(a.kind)}.`);
      repair(state, a, RULES.coffinHeal, "Sealant");
    }
    return;
  }
  switch (a.kind) {
    case "scared":
    case "patient":
      machineAttack(state, a, nearestEnemy(state, a), a.atk);
      break;
    case "builder":
      builderAct(state, a);
      break;
    case "clampjaw":
      clampjawAct(state, a);
      break;
    case "prisoner":
      machineAttack(state, a, nearestEnemy(state, a), a.atk);
      break;
    case "frame":
      frameAct(state, a, (t, dmg, p) => {
        if (chance(state, p)) deal(state, t, dmg, `${pilotRec(state, a.pilot)?.name ?? "Frame"}'s frame`, { attackerUid: a.uid, ranged: true });
        else log(state, `${pilotRec(state, a.pilot)?.name ?? "The frame"} fires wide.`);
      }, fighters(state));
      break;
    case "pilot":
      footAct(state, a, fighters(state));
      break;
    case "casket":
      casketAct(state, a, (t, dmg) => machineAttack(state, a, t, dmg), nearestEnemy(state, a));
      break;
    case "shepherd":
      shepherdAct(state, a);
      break;
    case "gunnest":
      nestAct(state, a);
      break;
    case "walker":
      if (a.scouting) {
        a.scouting = false;
        log(state, state.queue.length ? `Ceiling Walker reports inbound: ${state.queue.map(label).join(", ")}.` : "Ceiling Walker reports nothing else inbound.");
      } else {
        const weakest = fighters(state).sort((x, y) => x.hp - y.hp)[0];
        machineAttack(state, a, weakest, a.atk);
      }
      break;
    case "jack": {
      const tgt = unit(state, a.grudge) ?? nearestEnemy(state, a);
      machineAttack(state, a, tgt?.side === "enemy" ? tgt : nearestEnemy(state, a), a.atk);
      if (a.malf === "uncontrolled") {
        a.malf = undefined;
        a.mood = "shaking";
        log(state, "Panic Jack takes commands again.");
      }
      break;
    }
    case "warframe":
      if (a.malf === "hostile") {
        const victim = nearest(living(state, "friendly").filter((f) => f.uid !== a.uid && !f.foam), a.slot);
        log(state, "The Warframe fires on its own side.");
        if (victim) deal(state, victim, a.atk, "Hostile Warframe", { attackerUid: a.uid });
        a.malf = undefined;
        a.mood = "online";
        log(state, "Warframe systems stabilize. Control restored.");
      } else if (a.inert) {
        if (!a.paused) addProgress(state, a, "Passive startup");
      } else machineAttack(state, a, nearestEnemy(state, a), a.atk);
      break;
    default:
      break;
  }
  if (a.overrideDmg && a.hp > 0) {
    a.overrideDmg = false;
    deal(state, a, 1, "Manual Override strain", { noLeech: true });
  }
}

export function cardLabel(c: CardInst): string {
  return cardName(c.id, c.variant) + (CARDS[c.id].exhaust ? "" : "");
}
