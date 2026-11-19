import type { CustodyItem } from "./capture";
import { RULES, type CardId, type ChoiceId, type Phase, type Side, type UnitKind } from "./data";

export const SAVE_VERSION = 5;

export interface Leech {
  cardUid?: string; // absent for temporary leeches
  variant?: string;
  count: number;
  stripped: boolean;
  firedTurn: boolean;
  temp?: boolean;
}

/** What an enemy has decided to do this turn. Rolled at the start of the player's turn so it can be shown. */
export interface Plan {
  type:
    | "attack" | "missile" | "purge" | "tear" | "removeLeech" | "scavenge" | "jam" | "shake" | "break" | "hold" | "disabled"
    | "approach" | "rush" | "eject" | "recover" | "command" | "mark" | "struggle" | "flee" | "detonate";
  targetUid?: string;
  dmg?: number;
  note?: string;
}

export interface Unit {
  uid: string;
  kind: UnitKind;
  side: Side;
  slot: number;
  hp: number;
  maxHp: number;
  atk: number;
  /** Deducts this much from every instance of damage taken. */
  armor: number;
  lock: number;
  missiles: number;
  burn: number;
  stunned: number;
  crazy: boolean;
  dmgTurn: number;

  cardUid?: string; // the card this unit was deployed from
  variant?: string;
  temp?: boolean; // gone when the fight ends
  roomsLeft?: number; // temporary ally: fights remaining
  away?: number; // fights until it returns
  mood?: string;
  note?: string;
  plan?: Plan;
  accMod?: number;
  weak?: boolean; // armor stripped: takes +1
  leech?: Leech;
  foam?: boolean;
  sealed?: number;
  ward?: number;
  pacified?: number;
  malf?: "wrongRepair" | "uncontrolled" | "hostile";
  overrideDmg?: boolean;
  acted?: boolean; // skips its autonomous action this turn

  // builder
  timer?: number;
  jobs?: number;
  sorted?: number;
  emergencyUsed?: boolean;
  remember?: string;
  order?: "patch" | "sort" | "commission";
  jammed?: boolean;
  // possum / shepherd
  shutdown?: boolean;
  carried?: number;
  carriedIds?: string[];
  secured?: boolean;
  hold?: boolean;
  feed?: boolean;
  // walker
  elevated?: boolean;
  scouting?: boolean;
  // jack
  protect?: string;
  intercepted?: boolean;
  rage?: boolean;
  grudge?: string;
  // warframe
  inert?: boolean;
  progress?: number;
  paused?: boolean;
  abortPaid?: boolean;
  emergUsed?: boolean;
  fed?: boolean;
  // bulkhead / gun nest
  guards?: string;
  clamp?: string;

  // melee closing: 0 Distant, 1 Closing, 2 Engaged
  prox?: number;
  // ejectable cockpit
  pilot?: string; // stable pilot id; absent once the pilot has left
  ejecting?: boolean; // preparing to eject: launches on its next action
  wedge?: number; // turns of Cockpit Wedge left
  refused?: boolean; // Kilnheart has already ignored one eject order
  replacement?: boolean; // a substitute frame
  // Kilnheart reactor: 0 Stable, 1 Heated, 2 Critical
  heat?: number;
  fuse?: number; // turns to detonation once Critical
  // escape capsule
  exitIn?: number;
  flying?: boolean;
  towed?: boolean;
  role?: string; // which chassis a capsule came from
  guardBy?: string; // Latchback covering this unit this turn
  regen?: number;
  // capture
  cap?: Restraint;
  // clampjaw
  apprehend?: string; // ordered target
  holding?: string; // captive id carried between fights
  // pod
  powerOff?: boolean;
  occupied?: number; // occupied turns since the last upkeep
  podIntegrity?: number;
}

export interface Restraint {
  state: "securing" | "secured";
  integrity: number; // 0-100
  bands: number;
  by?: string; // the Clampjaw holding it
}

/** A captive carried between fights by exactly one holder. */
export interface Captive {
  id: string;
  kind: UnitKind;
  /** Set when the captive is a person: the pilot id. */
  pilot?: string;
  label: string;
  holder: string; // uid of the Clampjaw or Pod
  bands: number;
  tapped: boolean;
  hp: number;
}

export type PilotStatus = "active" | "escaped" | "recovered" | "captured" | "dead" | "withdrawn";

export interface Pilot {
  id: string;
  role: string;
  status: PilotStatus;
  /** Rooms until this pilot comes back in a replacement frame. */
  returnsIn?: number;
  /** The one replacement opportunity has been used. */
  replaced: boolean;
}

export type Pursuit = "dormant" | "active" | "disrupted" | "withdrawn" | "broken" | "commanderCaptured";

export interface Team {
  introduced: boolean;
  pursuit: Pursuit;
  pilots: Pilot[];
  episode: number; // next authored episode, 1-5
  nextAt: number; // room the next episode may run in
  pressure: number;
  leverage: number;
  networkCut: boolean;
  knowsPlayer: boolean;
  knownRoute: boolean;
  bishopExposed: boolean; // the Brawler was lured away
  podEscaped: boolean;
  talked: boolean; // Bishop's unprompted offer has been made
  truceUntil: number; // safe passage: no team activity before this room
  said: string[];
  ending: string;
}

export interface Wreck {
  id: string;
  kind: UnitKind;
  side: Side;
  value: number;
  /** Awarded at room clear with no Threat (Builder Drone's Last Useful Act, spilled cargo). */
  free?: boolean;
  pile?: boolean;
}

export interface CardInst {
  uid: string;
  id: CardId;
  variant?: string;
  rounds?: number;
  temp?: boolean; // removed when the fight ends
  expires?: number; // room number after which a loaned card is removed
}

export interface EventState {
  id: string;
  /** Free-form, JSON-safe. Pre-rolled outcomes live here so reopening never rerolls. */
  data: Record<string, number | string | boolean | string[]>;
  lines: string[];
}

export interface GameState {
  v: number;
  seed: number;
  rng: number;
  phase: Phase;
  room: number;
  turn: number;
  log: string[];
  events: string[];
  lastAction: string;
  units: Unit[];
  wrecks: Wreck[];
  uidSeq: number;

  energy: number;
  energyCap: number;
  bonusEnergy: number;
  block: number;
  stripped: number;

  scrap: number;
  rs: number;
  cash: number;
  threat: number;
  madness: number;
  nightmare: number;
  contamination: number;
  hpUpRank: number;
  jubeyMax: number;

  deck: CardInst[];
  draw: CardInst[];
  hand: CardInst[];
  discard: CardInst[];
  /** Reaction cards armed for this fight. */
  armed: CardInst[];
  /** Auto-deploy cards (max RULES.adSlots). */
  loadoutAd: CardId[];
  minesArmed: number;

  equip: { servo: boolean; hand: boolean; cell: number };
  servoUsed: boolean;
  handUsed: boolean;
  reflexUsed: boolean;
  recorderUsed: boolean;
  redmouth: string | null; // uid of the loaded Red-Mouth card
  bonusDraw: number;
  overrides: number;
  symbioticPaid: number;
  possumPaid: number;
  pendingScrap: number; // Possum takings, paid at room clear

  ejected: { card: CardInst; count: number; stripped: boolean } | null;

  captives: Captive[];
  /** Pilots alive inside wedged wrecks, waiting for someone to cut them out. */
  pinned: { pilot: string; role: UnitKind }[];
  /** Restrained enemies to deal with now that the fight is over. */
  custody: CustodyItem[];
  /** A Memory Tap waiting for its three-way choice. Holds the source id. */
  tap: string | null;
  intel: { weak: boolean; cache: number; questionable: boolean };
  team: Team;
  /** R-8 mechs joining this room's fight. */
  pendingTeam: { kind: UnitKind; pilot: string; replacement?: boolean }[];
  /** This round's team order, shown to the player. */
  teamOrder: string | null;
  teamMark: boolean;
  teamScouted: boolean;
  interceptBishop: boolean;
  teamEpisode: number;
  podStart: string;
  badge: { turns: number; flagged: boolean; hostile: boolean };

  ownsRocket: boolean;
  rocketAmmo: number;
  rocketFindChance: number;

  salvagedThisTurn: boolean;
  pathRisky: boolean;
  extraCrazy: number;
  extraNightmare: number;
  pendingInfested: number;
  accModEnemy: number;
  queue: UnitKind[];
  /** Extra enemies an event has added to the next fight. */
  pendingSpawn: UnitKind[];
  patientRepairable: boolean;
  /** The next room's base pack, rolled on arrival so it can be scouted. */
  nextPack: UnitKind[];
  metScared: boolean;
  rewardShown: CardId[];

  // room and anomaly flow
  hallStage: number;
  hallwayArmed: boolean;
  hallwayDone: boolean;
  extension: boolean;
  navFlag: boolean;
  lastKilled: UnitKind | null;
  seen: { droneRemembers: boolean; patient: boolean; yard: boolean; prisoner: boolean };
  preCommission: boolean;
  revealNext: boolean;
  firstStrike: boolean; // player gets +1 Energy on turn 1 of the next fight
  enemyInitiative: boolean; // enemies act before turn 1 of the next fight
  event: EventState | null;
  choiceShown: ChoiceId[];

  best: number;
  tally: { kills: number; cards: number; salvaged: number; decons: number };
}

export type Action =
  | { type: "start"; seed?: number }
  | { type: "loadout"; pick: "lootbox" | "mine" | "buddy" }
  | { type: "pickPath"; risky: boolean }
  | { type: "event"; option: string }
  | { type: "play"; uid: string; targetId?: string; slot?: number }
  | { type: "command"; uid: string; cmd: string; targetId?: string }
  | { type: "endTurn" }
  | { type: "salvage"; targetId: string }
  | { type: "leaveSalvage" }
  | { type: "pickReward"; id: CardId | "NONE" }
  | { type: "decon"; deeper: boolean }
  | { type: "buyEnergy" }
  | { type: "buyHp" }
  | { type: "patch" }
  | { type: "repair" }
  | { type: "removeCard"; uid: string }
  | { type: "specialize"; uid: string; variant: string }
  | { type: "unequip"; what: "servo" }
  | { type: "captive"; holder: string; what: "release" | "dismantle" }
  | { type: "nextRoom" }
  | { type: "qa"; cmd: string; n?: number; s?: string };

export function newTeam(): Team {
  const roles = ["needleback", "latchback", "widow", "kilnheart", "bishop"];
  const ids = ["p-needle", "p-latch", "p-widow", "p-kiln", "p-bishop"];
  return {
    introduced: false,
    pursuit: "dormant",
    pilots: roles.map((role, i) => ({ id: ids[i], role, status: "active" as PilotStatus, replaced: false })),
    episode: 1,
    nextAt: RULES.teamFromRoom,
    pressure: 0,
    leverage: 0,
    networkCut: false,
    knowsPlayer: false,
    knownRoute: false,
    bishopExposed: false,
    podEscaped: false,
    talked: false,
    truceUntil: 0,
    said: [],
    ending: "",
  };
}

export function createGame(seed = 1): GameState {
  return {
    v: SAVE_VERSION,
    seed,
    rng: seed >>> 0 || 1,
    phase: "title",
    room: 0,
    turn: 0,
    log: ["MECHANICA DESCENT. White rig. Abandoned base. Decon is four rooms down."],
    events: [],
    lastAction: "",
    units: [],
    wrecks: [],
    uidSeq: 1,
    energy: RULES.startEnergy,
    energyCap: RULES.startEnergy,
    bonusEnergy: 0,
    block: 0,
    stripped: 0,
    scrap: 0,
    rs: 0,
    cash: 0,
    threat: 0,
    madness: 0,
    nightmare: 0,
    contamination: 0,
    hpUpRank: 0,
    jubeyMax: RULES.startHp,
    deck: [],
    draw: [],
    hand: [],
    discard: [],
    armed: [],
    loadoutAd: [],
    minesArmed: 0,
    equip: { servo: false, hand: false, cell: 0 },
    servoUsed: false,
    handUsed: false,
    reflexUsed: false,
    recorderUsed: false,
    redmouth: null,
    bonusDraw: 0,
    overrides: 0,
    symbioticPaid: 0,
    possumPaid: 0,
    pendingScrap: 0,
    ejected: null,
    captives: [],
    pinned: [],
    custody: [],
    tap: null,
    intel: { weak: false, cache: 0, questionable: false },
    team: newTeam(),
    pendingTeam: [],
    teamOrder: null,
    teamMark: false,
    teamScouted: false,
    interceptBishop: false,
    teamEpisode: 0,
    podStart: "",
    badge: { turns: 0, flagged: false, hostile: false },
    ownsRocket: false,
    rocketAmmo: 0,
    rocketFindChance: RULES.rocketFindBase,
    salvagedThisTurn: false,
    pathRisky: false,
    extraCrazy: 0,
    extraNightmare: 0,
    pendingInfested: 0,
    accModEnemy: 0,
    queue: [],
    pendingSpawn: [],
    patientRepairable: false,
    nextPack: [],
    metScared: false,
    rewardShown: [],
    hallStage: 0,
    hallwayArmed: false,
    hallwayDone: false,
    extension: false,
    navFlag: false,
    lastKilled: null,
    seen: { droneRemembers: false, patient: false, yard: false, prisoner: false },
    preCommission: false,
    revealNext: false,
    firstStrike: false,
    enemyInitiative: false,
    event: null,
    choiceShown: [],
    best: 0,
    tally: { kills: 0, cards: 0, salvaged: 0, decons: 0 },
  };
}
