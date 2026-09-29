import {
  CHOICES,
  type ChoiceId,
  DEPTH,
  ENERGY_UP,
  HP_UP,
  RULES,
  type Phase,
  type Side,
  type UnitKind,
  type ChoiceDef,
  depthFor,
  label,
} from "./data";

export interface Unit {
  uid: string;
  kind: UnitKind;
  side: Side;
  slot: number;
  hp: number;
  maxHp: number;
  lock: number;
  missiles: number;
  burn: number;
  stunned: number;
  crazy: boolean;
  wreck: boolean;
}

export interface GameState {
  seed: number;
  rng: number;
  phase: Phase;
  room: number;
  turn: number;
  log: string[];
  units: Unit[];
  uidSeq: number;
  energy: number;
  energyCap: number;
  bonusEnergy: number;
  scrap: number;
  rs: number;
  cash: number;
  threat: number;
  madness: number;
  nightmare: number;
  hpUpRank: number;
  jubeyMax: number;
  craneUsed: boolean;
  gunUsed: boolean;
  rocketUsed: boolean;
  ownsRocket: boolean;
  rocketEquipped: boolean;
  rocketAmmo: number;
  rocketFindChance: number;
  farmed: boolean;
  pathRisky: boolean;
  extraCrazy: number;
  extraNightmare: number;
  pendingInfested: number;
  choiceShown: ChoiceDef[];
  lastHook: string;
  accModEnemy: number;
  accModPlayerFlat: number;
}

function mulberry(_n: number) {
  return () => 0;
}
void mulberry;
void DEPTH;

export function createGame(seed = 1): GameState {
  return {
    seed,
    rng: seed >>> 0,
    phase: "title",
    room: 0,
    turn: 0,
    log: ["MECHANICA DESCENT. White rig. Abandoned base. Decon is four rooms down."],
    units: [],
    uidSeq: 1,
    energy: RULES.startEnergy,
    energyCap: RULES.startEnergy,
    bonusEnergy: 0,
    scrap: 0,
    rs: 0,
    cash: 0,
    threat: 0,
    madness: 0,
    nightmare: 0,
    hpUpRank: 0,
    jubeyMax: RULES.startHp,
    craneUsed: false,
    gunUsed: false,
    rocketUsed: false,
    ownsRocket: false,
    rocketEquipped: false,
    rocketAmmo: 0,
    rocketFindChance: RULES.rocketFindBase,
    farmed: false,
    pathRisky: false,
    extraCrazy: 0,
    extraNightmare: 0,
    pendingInfested: 0,
    choiceShown: [],
    lastHook: "",
    accModEnemy: 0,
    accModPlayerFlat: 0,
  };
}

function nextRng(state: GameState): number {
  let x = state.rng || 1;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  state.rng = x >>> 0;
  return (state.rng % 10000) / 10000;
}
function roll(state: GameState): number {
  return nextRng(state);
}
function chance(state: GameState, p: number): boolean {
  return roll(state) < p;
}
function log(state: GameState, msg: string) {
  state.log = [msg, ...state.log].slice(0, 80);
}
function uid(state: GameState): string {
  state.uidSeq += 1;
  return "u" + state.uidSeq;
}
function stats(kind: UnitKind): { hp: number; missiles: number } {
  switch (kind) {
    case "jubey":
      return { hp: RULES.startHp, missiles: 0 };
    case "light":
    case "scared":
      return { hp: 4, missiles: 2 };
    case "lvl2":
      return { hp: 8, missiles: 2 };
    case "infested":
      return { hp: 5, missiles: 0 };
    case "drone":
      return { hp: 2, missiles: 0 };
    case "zombie":
      return { hp: 10, missiles: 0 };
    case "rifleman":
      return { hp: 1, missiles: 0 };
  }
}
function spawn(state: GameState, kind: UnitKind, side: Side, slot: number, crazy = false): Unit {
  const st = stats(kind);
  const u: Unit = {
    uid: uid(state),
    kind,
    side,
    slot,
    hp: kind === "jubey" ? state.jubeyMax : st.hp,
    maxHp: kind === "jubey" ? state.jubeyMax : st.hp,
    lock: 0,
    missiles: st.missiles,
    burn: 0,
    stunned: 0,
    crazy,
    wreck: false,
  };
  state.units.push(u);
  return u;
}
function living(state: GameState, side?: Side): Unit[] {
  return state.units.filter((u) => !u.wreck && u.hp > 0 && (side ? u.side === side : true));
}
function jubey(state: GameState): Unit | undefined {
  return state.units.find((u) => u.kind === "jubey" && !u.wreck);
}
function isDead(state: GameState): boolean {
  return !jubey(state) || state.phase === "dead";
}
function hitChance(baseHit: number, steps: number): number {
  let miss = 1 - baseHit;
  if (steps > 0) for (let i = 0; i < steps; i++) miss *= 0.5;
  else if (steps < 0) for (let i = 0; i < -steps; i++) miss = Math.min(1, miss * 2);
  return 1 - miss;
}
function playerHit(state: GameState): number {
  return hitChance(Math.max(0, 1 - state.accModPlayerFlat), 0);
}
function enemyHit(state: GameState, extra = 0): number {
  return hitChance(0.75, state.accModEnemy + extra);
}
function madFail(state: GameState): boolean {
  return state.madness > 0 && chance(state, state.madness / 100);
}
function crazyDmg(base: number, crazy: boolean, state: GameState): number {
  if (!crazy) return base;
  const half = base * 1.5;
  if (base % 2 === 0) return Math.round(half);
  const down = Math.floor(half);
  return chance(state, 0.5) ? down + 1 : down;
}
function applyBurnTicks(state: GameState) {
  for (const u of living(state)) {
    if (u.burn > 0) {
      u.hp -= 1;
      u.burn -= 1;
      log(state, `${label(u.kind)} burns (1). ${u.hp} HP left.`);
      if (u.hp <= 0) kill(state, u);
    }
  }
}
function legalWeaponDrop(u: Unit): boolean {
  if (u.side !== "enemy") return false;
  if (u.kind === "infested" || u.kind === "rifleman" || u.kind === "drone") return false;
  return u.kind === "light" || u.kind === "lvl2" || u.kind === "zombie";
}
function rollWeaponFinds(state: GameState, dead: Unit) {
  if (!legalWeaponDrop(dead)) return;
  if (!state.ownsRocket) {
    const doubled = dead.kind === "lvl2";
    const rollP = doubled ? Math.min(0.8, state.rocketFindChance * 2) : state.rocketFindChance;
    const hit = chance(state, rollP);
    log(state, `Rocket frame roll ${Math.round(rollP * 100)}%${doubled ? " (Lvl2 double)" : ""} — ${hit ? "FOUND" : "miss"}.`);
    if (hit) {
      state.ownsRocket = true;
      state.rocketAmmo += 1;
      state.rocketFindChance = RULES.rocketFindBase;
      log(state, "Rocket launcher recovered. +1 ammo. Equip it at Tech Stop.");
    } else {
      state.rocketFindChance = Math.min(RULES.rocketFindCap, state.rocketFindChance + RULES.rocketFindPity);
    }
  }
  const ammoP = dead.kind === "lvl2" ? RULES.rocketAmmoLvl2 : RULES.rocketAmmoLight;
  if (chance(state, ammoP)) {
    state.rocketAmmo += 1;
    log(state, `HEAP round in the wreck. Rocket ammo ${state.rocketAmmo}.`);
  }
}
function kill(state: GameState, u: Unit) {
  if (u.wreck) return;
  u.hp = 0;
  u.wreck = true;
  log(state, `${label(u.kind)} down.`);
  if (u.kind === "jubey") {
    state.phase = "dead";
    log(state, "Jubey is still. The hall keeps the rig.");
    return;
  }
  if (u.kind === "infested") {
    state.nightmare += 1;
    log(state, `Nightmare count ${state.nightmare}/${RULES.nightmareThreshold}. No scrap.`);
    if (state.nightmare >= RULES.nightmareThreshold) {
      state.nightmare = 0;
      log(state, "Red Metal Teeth sweep the lane. Defenses stripped (placeholder).");
    }
  } else if (u.side === "enemy") {
    if ((u.kind === "light" || u.kind === "lvl2" || u.kind === "zombie") && chance(state, RULES.rsDrop)) {
      state.rs += 1;
      log(state, "+1 Reactor Salvage.");
    }
    rollWeaponFinds(state, u);
  }
}
function deal(state: GameState, target: Unit, amount: number, src: string) {
  if (!target || target.wreck) return;
  target.hp -= amount;
  log(state, `${src} hits ${label(target.kind)} for ${amount}. (${target.hp}/${target.maxHp})`);
  if (target.hp <= 0) kill(state, target);
}
function nearestFriend(state: GameState, fromSlot: number): Unit | undefined {
  const foes = living(state, "friendly");
  if (!foes.length) return;
  return foes.slice().sort((a, b) => Math.abs(a.slot - fromSlot) - Math.abs(b.slot - fromSlot) || a.slot - b.slot)[0];
}
function unitById(state: GameState, id: string): Unit | undefined {
  return state.units.find((u) => u.uid === id);
}
function beginPlayerTurn(state: GameState) {
  state.phase = "player";
  state.turn += 1;
  state.energy = state.energyCap + state.bonusEnergy;
  state.craneUsed = false;
  state.gunUsed = false;
  state.rocketUsed = false;
  state.farmed = false;
  state.accModEnemy = 0;
  applyBurnTicks(state);
  if (isDead(state)) {
    state.phase = "dead";
    return;
  }
  if (!living(state, "enemy").length) finishRoom(state);
}
function finishRoom(state: GameState) {
  state.bonusEnergy = 0;
  state.extraCrazy = 0;
  state.extraNightmare = 0;
  state.pendingInfested = 0;
  if (state.room >= RULES.roomsToDecon) {
    state.phase = "win";
    log(state, "Decon Bay. Gold light. The rig comes clean.");
    return;
  }
  state.phase = "tech";
  log(state, `Room ${state.room} clear. Tech Stop.`);
}
function spawnPack(state: GameState) {
  const d = depthFor(state.room);
  const kinds: UnitKind[] = [];
  for (let i = 0; i < d.alwaysLight; i++) kinds.push("light");
  if (chance(state, d.extraLight)) kinds.push("light");
  if (chance(state, d.infested)) kinds.push("infested");
  for (let i = 0; i < state.pendingInfested; i++) kinds.push("infested");
  if (chance(state, d.lvl2) && state.room >= 3) {
    const idx = kinds.findIndex((k) => k === "light");
    if (idx >= 0) kinds[idx] = "lvl2";
    else kinds.push("lvl2");
  }
  let crazy = false;
  const crazyP = (state.pathRisky ? 0.01 + (state.room - 1) * 0.013 : 0) + state.extraCrazy;
  const nightP = (state.pathRisky ? 0.03 + (state.room - 1) * 0.04 : 0) + state.extraNightmare;
  log(state, `Room ${state.room} odds  crazy ${Math.round(crazyP * 100)}%  nightmare ${Math.round(nightP * 100)}%  infested table ${Math.round(d.infested * 100)}%.`);
  if (chance(state, nightP)) {
    log(state, "Nightmare card: THE RIFLEMEN FILE IN.");
    for (let i = 0; i < 6; i++) spawn(state, "rifleman", "enemy", i, false);
  } else if (chance(state, crazyP)) {
    crazy = true;
    log(state, "A mech comes in CRAZY.");
  }
  let slot = 0;
  for (const k of kinds) {
    const u = spawn(state, k, "enemy", slot, crazy && k !== "infested" && k !== "rifleman");
    log(state, `Spawn ${label(u.kind)}${u.crazy ? " [CRAZY]" : ""} col ${slot + 1}.`);
    slot = (slot + 1) % 6;
  }
}
function startRoom(state: GameState) {
  state.room += 1;
  state.turn = 0;
  state.units = state.units.filter((u) => u.side === "friendly" && !u.wreck);
  if (!jubey(state)) spawn(state, "jubey", "friendly", 2);
  state.pathRisky = false;
  state.pendingInfested = 0;
  state.extraCrazy = 0;
  state.extraNightmare = 0;
  state.phase = "route";
  log(state, `— Room ${state.room} path —`);
}
function enterChosenPath(state: GameState) {
  if (chance(state, RULES.choiceChance)) {
    const pool = [...CHOICES];
    const a = pool.splice(Math.floor(roll(state) * pool.length), 1)[0];
    const b = pool.splice(Math.floor(roll(state) * pool.length), 1)[0];
    state.choiceShown = [a, b];
    state.lastHook = a.hook;
    state.phase = "choice";
    log(state, "Choice encounter.");
    return;
  }
  spawnPack(state);
  beginPlayerTurn(state);
}
export type Action =
  | { type: "start"; seed?: number }
  | { type: "pickPath"; risky: boolean }
  | { type: "pickChoice"; id: ChoiceId | "NONE" }
  | { type: "gun"; targetId: string }
  | { type: "crane"; slot: number }
  | { type: "rocket"; targetId: string }
  | { type: "salvage"; targetId: string }
  | { type: "endTurn" }
  | { type: "buyEnergy" }
  | { type: "buyHp" }
  | { type: "equipRocket"; on: boolean }
  | { type: "nextRoom" }
  | { type: "qa"; cmd: string; n?: number; id?: string };
function applyChoice(state: GameState, id: ChoiceId | "NONE") {
  if (id === "NONE") {
    log(state, "Keep moving.");
    spawnPack(state);
    beginPlayerTurn(state);
    return;
  }
  const def = CHOICES.find((c) => c.id === id);
  if (!def) return;
  log(state, def.take);
  switch (id) {
    case "CHOICE_SCRAP_BAIT":
      state.scrap += 2;
      if (chance(state, 0.5)) {
        state.pendingInfested += 1;
        log(state, "The ticking becomes a body. Extra Infested this room.");
      }
      break;
    case "CHOICE_ROCKET_MADNESS":
      state.rocketAmmo += 1;
      state.madness += 2;
      log(state, `Rocket ammo ${state.rocketAmmo}. Madness ${state.madness}%.`);
      break;
    case "CHOICE_COOLANT_SIPHON": {
      const j = jubey(state);
      if (j && j.hp < state.jubeyMax) {
        j.hp += 1;
        log(state, `Jubey heals to ${j.hp}.`);
      }
      state.threat += 1;
      break;
    }
    case "CHOICE_SEALED_LOCKER":
      state.madness += 1;
      if (chance(state, 0.4)) {
        state.rs += 1;
        log(state, "+1 RS from the locker.");
      } else log(state, "Locker: nothing you can use.");
      break;
    case "CHOICE_CUT_COMMS":
      state.threat = Math.max(0, state.threat - 1);
      state.extraCrazy += 0.08;
      log(state, `Threat ${state.threat}. +8% Crazy this room.`);
      break;
    case "CHOICE_FLARE_CHARGE":
      state.bonusEnergy += 1;
      state.extraNightmare += 0.25;
      log(state, "+1 Energy this room. 25% extra Nightmare.");
      break;
  }
  spawnPack(state);
  beginPlayerTurn(state);
}
function fireGun(state: GameState, targetId: string) {
  if (state.phase !== "player" || state.gunUsed || state.energy < 1) return;
  const t = unitById(state, targetId);
  if (!t || t.side !== "enemy" || t.wreck) return;
  if (madFail(state)) {
    log(state, "Machine gun fails (Madness).");
    state.energy -= 1;
    state.gunUsed = true;
    return;
  }
  state.energy -= 1;
  state.gunUsed = true;
  if (!chance(state, playerHit(state))) {
    log(state, "Machine gun misses.");
    return;
  }
  deal(state, t, 1 + Math.floor(roll(state) * 3), "Salvaged machine gun");
}
function fireCrane(state: GameState, slot: number) {
  if (state.phase !== "player" || state.craneUsed || state.energy < 1) return;
  if (madFail(state)) {
    log(state, "Crane Smash fails (Madness).");
    state.energy -= 1;
    state.craneUsed = true;
    return;
  }
  state.energy -= 1;
  state.craneUsed = true;
  const slots = [slot - 1, slot, slot + 1].filter((s) => s >= 0 && s < 6);
  const hits = living(state, "enemy").filter((u) => slots.includes(u.slot));
  if (!hits.length) {
    log(state, "Crane Smash hits empty air.");
    return;
  }
  for (const t of hits) {
    deal(state, t, 3, "Crane Smash");
    if (!t.wreck && chance(state, 0.25)) {
      t.stunned = 1;
      log(state, `${label(t.kind)} stunned.`);
    }
    if (!t.wreck) {
      state.accModEnemy += 1;
      log(state, `${label(t.kind)} survivors aim sharper (+1 acc step).`);
    }
  }
}
function fireRocket(state: GameState, targetId: string) {
  if (state.phase !== "player") return;
  if (!state.ownsRocket || !state.rocketEquipped || state.rocketAmmo < 1 || state.rocketUsed) return;
  if (state.energy < 1) return;
  const t = unitById(state, targetId);
  if (!t || t.side !== "enemy" || t.wreck) return;
  if (madFail(state)) {
    log(state, "Rocket fizzles (Madness). Ammo kept.");
    return;
  }
  state.energy -= 1;
  state.rocketAmmo -= 1;
  state.rocketUsed = true;
  if (!chance(state, playerHit(state))) {
    log(state, "Rocket misses. Ammo spent.");
    return;
  }
  const splash = living(state, "enemy").filter((u) => Math.abs(u.slot - t.slot) === 1);
  deal(state, t, 4, "Rocket");
  if (!t.wreck) t.burn = Math.max(t.burn, 2);
  for (const s of splash) {
    deal(state, s, 2, "Rocket splash");
    if (!s.wreck) s.burn = Math.max(s.burn, 2);
  }
  log(state, `Rocket ammo left: ${state.rocketAmmo}.`);
}
function salvage(state: GameState, targetId: string) {
  if (state.phase !== "player") return;
  const t = unitById(state, targetId);
  if (!t || !t.wreck || t.side !== "enemy") return;
  if (t.kind === "infested") {
    log(state, "Infested wreck gives nothing.");
    state.units = state.units.filter((u) => u.uid !== t.uid);
    return;
  }
  state.scrap += RULES.salvageScrap;
  state.threat += RULES.salvageThreat;
  state.farmed = true;
  state.nightmare += 1;
  log(state, `Salvage +1 Scrap +1 Threat. Nightmare ${state.nightmare}.`);
  if (state.nightmare >= RULES.nightmareThreshold) {
    state.nightmare = 0;
    log(state, "Red Metal Teeth sweep.");
  }
  state.units = state.units.filter((u) => u.uid !== t.uid);
}
function enemyAct(state: GameState, u: Unit) {
  if (u.stunned > 0) {
    u.stunned -= 1;
    log(state, `${label(u.kind)} is stunned.`);
    return;
  }
  if (u.kind === "rifleman") {
    const tgt = nearestFriend(state, u.slot);
    if (!tgt) return;
    if (chance(state, enemyHit(state))) deal(state, tgt, 1, label(u.kind));
    else log(state, `${label(u.kind)} misses.`);
    return;
  }
  if (u.kind === "infested") {
    const tgt = state.threat >= RULES.threatHunt ? jubey(state) ?? nearestFriend(state, u.slot) : nearestFriend(state, u.slot);
    if (!tgt) return;
    if (chance(state, enemyHit(state))) deal(state, tgt, 2, "Infested");
    else log(state, "Infested misses.");
    return;
  }
  let tgt =
    u.kind === "lvl2" || u.kind === "light" || u.kind === "zombie"
      ? jubey(state) ?? nearestFriend(state, u.slot)
      : nearestFriend(state, u.slot);
  if (u.crazy && chance(state, RULES.crazyFriendlyFire)) {
    const allies = living(state, "enemy").filter((a) => a.uid !== u.uid && Math.abs(a.slot - u.slot) <= 1);
    if (allies.length) {
      tgt = allies[Math.floor(roll(state) * allies.length)];
      log(state, `${label(u.kind)} [CRAZY] swings at its own.`);
    }
  }
  if (!tgt) return;
  const shot = u.kind === "lvl2" ? 2 : 1;
  const missile = u.kind === "lvl2" ? 6 : 3;
  if (u.lock >= 2 && u.missiles > 0) {
    if (chance(state, enemyHit(state))) {
      deal(state, tgt, crazyDmg(missile, u.crazy, state), `${label(u.kind)} missile`);
      if (!tgt.wreck && chance(state, 0.5)) {
        tgt.burn = Math.max(tgt.burn, 2);
        log(state, `${label(tgt.kind)} ignited.`);
      }
    } else log(state, `${label(u.kind)} missile misses.`);
    u.lock = 0;
    u.missiles -= 1;
    return;
  }
  if (chance(state, enemyHit(state))) {
    deal(state, tgt, crazyDmg(shot, u.crazy, state), label(u.kind));
    if (!tgt.wreck) u.lock += 1;
  } else log(state, `${label(u.kind)} misses.`);
}
function endTurn(state: GameState) {
  if (state.phase !== "player") return;
  state.phase = "resolving";
  for (const u of living(state, "enemy")) {
    if (isDead(state)) break;
    enemyAct(state, u);
  }
  if (isDead(state)) {
    state.phase = "dead";
    return;
  }
  state.madness = Math.max(0, state.madness - 2);
  if (!state.farmed) state.threat = Math.max(0, state.threat - 1);
  if (!living(state, "enemy").length) {
    finishRoom(state);
    return;
  }
  beginPlayerTurn(state);
}
function buyEnergy(state: GameState) {
  if (state.phase !== "tech") return;
  const row = ENERGY_UP.find((e) => e.from === state.energyCap);
  if (!row) return;
  if (state.scrap < row.scrap || state.rs < row.rs) {
    log(state, "Not enough salvage for energy.");
    return;
  }
  state.scrap -= row.scrap;
  state.rs -= row.rs;
  state.energyCap = row.to;
  log(state, `Energy cap ${state.energyCap}.`);
}
function buyHp(state: GameState) {
  if (state.phase !== "tech") return;
  const next = state.hpUpRank + 1;
  const row = HP_UP.find((h) => h.rank === next);
  if (!row) return;
  if (state.scrap < row.scrap) {
    log(state, "Not enough scrap for HP.");
    return;
  }
  state.scrap -= row.scrap;
  state.hpUpRank = next;
  state.jubeyMax += 1;
  const j = jubey(state);
  if (j) {
    j.maxHp = state.jubeyMax;
    j.hp = Math.min(state.jubeyMax, j.hp + 1);
  }
  log(state, `Jubey max HP ${state.jubeyMax}.`);
}
export function reduce(prev: GameState, action: Action): GameState {
  const state: GameState = structuredClone(prev);
  switch (action.type) {
    case "start": {
      const fresh = createGame(action.seed ?? state.seed);
      spawn(fresh, "jubey", "friendly", 2);
      fresh.room = 0;
      startRoom(fresh);
      return fresh;
    }
    case "pickPath":
      state.pathRisky = action.risky;
      log(state, action.risky ? "Risky red hall." : "Normal hall.");
      enterChosenPath(state);
      break;
    case "pickChoice":
      applyChoice(state, action.id);
      break;
    case "gun":
      fireGun(state, action.targetId);
      if (!living(state, "enemy").length && state.phase === "player") finishRoom(state);
      break;
    case "crane":
      fireCrane(state, action.slot);
      if (!living(state, "enemy").length && state.phase === "player") finishRoom(state);
      break;
    case "rocket":
      fireRocket(state, action.targetId);
      if (!living(state, "enemy").length && state.phase === "player") finishRoom(state);
      break;
    case "salvage":
      salvage(state, action.targetId);
      break;
    case "endTurn":
      endTurn(state);
      break;
    case "buyEnergy":
      buyEnergy(state);
      break;
    case "buyHp":
      buyHp(state);
      break;
    case "equipRocket":
      if (!state.ownsRocket) break;
      state.rocketEquipped = action.on;
      log(state, action.on ? "Rocket equipped (slot A)." : "Rocket stowed.");
      break;
    case "nextRoom":
      if (state.phase === "tech") startRoom(state);
      break;
    case "qa":
      applyQa(state, action.cmd, action.n);
      break;
  }
  return state;
}
function applyQa(state: GameState, cmd: string, n?: number) {
  switch (cmd) {
    case "scrap":
      state.scrap += n ?? 5;
      break;
    case "ammo":
      state.rocketAmmo += n ?? 3;
      break;
    case "rocket":
      state.ownsRocket = true;
      state.rocketEquipped = true;
      state.rocketAmmo = Math.max(state.rocketAmmo, n ?? 2);
      log(state, "QA: rocket equipped.");
      break;
    case "threat":
      state.threat = n ?? 5;
      break;
    case "madness":
      state.madness = n ?? 20;
      break;
    case "room":
      state.room = n ?? 3;
      break;
    case "seed":
      state.seed = n ?? 1;
      state.rng = state.seed >>> 0;
      break;
    default:
      log(state, `QA ${cmd}`);
  }
}
export function installQa(dispatch: (a: Action) => void, get: () => GameState) {
  const api = {
    seed: (n: number) => dispatch({ type: "qa", cmd: "seed", n }),
    giveScrap: (n: number) => dispatch({ type: "qa", cmd: "scrap", n }),
    giveAmmo: (n: number) => dispatch({ type: "qa", cmd: "ammo", n }),
    giveWeapon: () => dispatch({ type: "qa", cmd: "rocket" }),
    setThreat: (n: number) => dispatch({ type: "qa", cmd: "threat", n }),
    setMadness: (n: number) => dispatch({ type: "qa", cmd: "madness", n }),
    setRoom: (n: number) => dispatch({ type: "qa", cmd: "room", n }),
    log: () => get().log,
    state: get,
  };
  (window as unknown as { __descent: typeof api }).__descent = api;
}
