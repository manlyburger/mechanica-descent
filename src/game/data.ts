// All tunable rules, tables and card text. Every number marked TUNE in the
// briefs lives in RULES so it can be changed without touching the engine.

export * from "./text";

export type Phase =
  | "title"
  | "loadout"
  | "route"
  | "event"
  | "player"
  | "salvage"
  | "reward"
  | "decon"
  | "tech"
  | "win"
  | "dead";

export type Side = "friendly" | "enemy";

export type UnitKind =
  | "jubey"
  | "light"
  | "lvl2"
  | "infested"
  | "scared"
  | "drone"
  | "zombie"
  | "rifleman"
  | "powered"
  | "patient"
  | "robobuddy"
  | "builder"
  | "possum"
  | "gunnest"
  | "bulkhead"
  | "beacon"
  | "shepherd"
  | "walker"
  | "jack"
  | "warframe"
  | "clampjaw"
  | "pod"
  | "needleback"
  | "latchback"
  | "widow"
  | "kilnheart"
  | "bishop"
  | "capsule"
  | "relay"
  | "prisoner";

export interface DepthRow {
  alwaysLight: number;
  extraLight: number;
  infested: number;
  lvl2: number;
}

// Carried over unchanged from the first slice.
// OPEN QUESTION: room 1 Infested is 0.75 while room 2 is 0.08. Typo for 0.075?
export const DEPTH: Record<number, DepthRow> = {
  1: { alwaysLight: 1, extraLight: 0, infested: 0.75, lvl2: 0 },
  2: { alwaysLight: 2, extraLight: 0.25, infested: 0.08, lvl2: 0 },
  3: { alwaysLight: 1, extraLight: 0.4, infested: 0.1, lvl2: 0.12 },
  4: { alwaysLight: 1, extraLight: 0.45, infested: 0.12, lvl2: 0.2 },
  5: { alwaysLight: 1, extraLight: 0.5, infested: 0.14, lvl2: 0.28 },
  6: { alwaysLight: 1, extraLight: 0.5, infested: 0.16, lvl2: 0.36 },
};

export function depthFor(room: number): DepthRow {
  if (DEPTH[room]) return DEPTH[room];
  const n = Math.max(7, room);
  return {
    alwaysLight: 1,
    extraLight: 0.5,
    infested: 0.18,
    lvl2: Math.min(0.5, 0.36 + 0.08 * (n - 6)),
  };
}

export const RULES = {
  lanes: 6,
  handSize: 5,
  braceBlock: 2,
  plateBlock: 5,
  startHp: 5,
  startEnergy: 1,
  maxEnergyCap: 4,
  choiceChance: 0.5,
  scaredChance: 0.5,
  scaredFromRoom: 2,

  // ---- Descent: go deeper or get clean ----
  deconEvery: 4, // a Decon Bay after every 4th room
  deconHeal: 2,
  legExtraLight: 1, // +1 guaranteed Light per completed leg
  zombieFromRoom: 6,
  zombieChance: 0.15,
  poweredFromRoom: 2,
  poweredChance: 0.2,
  contamPerInfestedHit: 1,
  contamPerLegRoom: 1, // each room entered past the first Decon
  contamPerRot: 3, // every 3 Contamination adds a Rot card to each fight
  contamRotMax: 3,
  contamHunt: 9, // at 9+ the Infested always hunt Jubey

  // ---- Loadout ----
  adSlots: 2, // max auto-deploy cards carried
  mineDamage: 2,
  buddyHp: 2,
  lootboxScrap: 1,

  // ---- Salvage, Threat, Madness, Teeth ----
  salvageScrap: 1,
  salvageThreat: 1,
  fieldStripScrap: 2,
  rsDrop: 0.25,
  riskyClearScrap: 1,
  riskyDrones: 1,
  riskyRsMult: 2,
  threatHunt: 5,
  threatPerDrone: 2,
  threatDroneMax: 2,
  madnessMisfire: 0.05,
  madnessDecay: 1,
  highMadness: 3, // briefs assume 5 on a 0-10 scale; ours rarely passes 6
  nightmareThreshold: 9,
  teethStripTurns: 3,

  crazyFriendlyFire: 0.25,
  enemyBaseHit: 0.75,
  allyHit: 0.6,
  machineHit: 0.8,

  riflemen: 6,
  arrivalsPerTurn: 2,
  rifleCash: 2,
  rifleMadness: 1,

  rocketFindBase: 0.02,
  rocketFindPity: 0.02,
  rocketFindCap: 0.4,
  rocketAmmoLight: 0.08,
  rocketAmmoLvl2: 0.16,

  // ---- Tech Stop ----
  patchScrap: 1,
  repairCash: 2,
  repairHeal: 2,
  removeCardCash: 3,
  restHeal: 0,
  variantScrap: 2,

  // ---- Builder Drone ----
  builderInterval: 2,
  builderPatch: 2,
  builderSort: 1,
  builderSortCap: 3, // Scrap Sorting per encounter, per drone
  scavengerSort: 2,
  overworkedEvery: 3,
  possessedPatch: 3,
  possessedWrong: 0.2,
  emergencyRepair: 1,
  droneRemembersChance: 0.2,

  // ---- Salvage Leech ----
  leechThreshold: 3,
  leechMax: 3,
  leechStripAt: 2,
  leechDeathLoss: 0.25,
  riskyExtractScrap: 2,
  symbioticMax: 2,
  purgeChanceHeavy: 0.5,
  tearChancePiloted: 0.3,
  droneRemoveLeech: 0.4,

  // ---- Wrong Hallway ----
  hallwayChance: 0.08, // rooms that go wrong without the card
  forceExitEnergy: 2,
  forceExitScrap: 1,
  searchFind: 0.6,
  searchScrap: 2,
  scout: { safe: 0.4, salvage: 0.25, separated: 0.2, hazard: 0.15 },
  eatsMachinesWeight: 2, // vs weight 1 for each ordinary event

  // ---- Other brief-1 cards ----
  beaconScrap: 4,
  beaconThreat: 2,
  servoBonus: 2,
  servoSwing: 0.2,
  cellCharges: 3,
  cellOutcome: { safe: 0.6, scrap: 0.25, burst: 0.15 },
  cellBurst: 2,
  possumCap: 3,
  nestClampBonus: 2,
  redmouthBonus: 3,
  redmouthRounds: 3,
  redmouthAuto: 0.2,
  foamHeal: 2,
  foamResistHeavy: 0.5,
  collapsePrevent: 2,

  // ---- Brief-2 cards ----
  shepherdPair: 2,
  shepherdPayout: 2,
  walkerFall: 2,
  jackCounter: 2,
  jackRage: 2,
  warframeNeed: 2,
  warframeCorruptHp: 3,
  warframeCorrupt: 0.3,
  emergencyCommissionEnergy: 2,
  badgeTurns: 2,
  badgeFlag: 0.35,
  badgeHostilePenalty: 0.2,
  coffinActions: 2,
  coffinHeal: 3,
  coffinEarlyHeal: 1,
  recorderScrap: 1,
  recorderDraw: 2,
  patientChance: 0.1,
  patientHostile: { repair: 0.2, strip: 0.3, inspect: 0.25 },
  patientRooms: 2,
  yardChance: 0.08,

  // ---- Capture and containment (brief 3) ----
  captureHp: 3, // a machine at this HP or less, or disabled, can be apprehended
  grappleIntegrity: 50,
  lockIntegrity: 60,
  bandIntegrity: 30,
  bandBase: 20, // integrity of a disabled target secured by a band alone
  maxBands: 2,
  holdReinforce: 15, // a holding Clampjaw adds this each action
  strain: 15, // ordinary struggle per enemy turn
  strainStrong: 25, // medium machines above captureHp, the prisoner
  strainCritical: 40, // at or below this the captor takes 1 when struggled against
  podUpkeepTurns: 3,
  podLowPowerLoss: 20,
  podContainedStrain: 5,
  wedgeTurns: 2,
  wedgeRemoveEnergy: 1,
  trappedSurvival: 0.5, // pilot wedged in a chassis that is destroyed
  blastSurvival: 0.1, // pilot inside a reactor explosion
  bailSurvival: 0.5, // pilot of a chassis destroyed before it could eject
  dismantle: { small: 2, medium: 3 },
  chassisScrap: 4, // an intact R-8 chassis recovered
  tap: { clean: 0.6, partial: 0.3 },
  tapCache: { clean: 3, partial: 1 },

  // ---- The Prisoner That Repairs Itself ----
  prisonerChance: 0.08,
  prisonerFromRoom: 3,
  prisonerIntegrity: 70,
  prisonerScrap: 4,
  prisonerPart: 0.35,
  prisonerFights: 3,
  prisonerRegen: 1,

  // ---- Melee closing (brief 4) ----
  proxEngaged: 2,
  kilnCoverDamage: 2,

  // ---- Relay Section R-8 ----
  teamFromRoom: 2,
  teamBonusMax: 2, // team-related bonus enemies in one room
  returnWindow: 3, // an escaped pilot returns within 1..3 rooms
  returnWithoutRecovery: 0.5,
  replacementHpLoss: 2,
  capsuleHp: 2,
  bishopPodHp: 3,
  kilnFuse: 2, // turns from Critical to detonation
  kilnBlast: 3,
  kilnHeatAt: [7, 4], // HP at which the reactor goes Heated, then Critical
  kilnStubborn: 0.5,
  widowScavenge: 0.4,
  negotiateAt: 2, // leverage needed to open talks
  withdrawAt: 3, // leverage needed for "call them off" to succeed
  safePassageRooms: 3,
  relayGuards: 2,

  // ---- Enemy counterplay ----
  droneScavenge: 0.35,
  droneJam: 0.25,
  shakeClamp: 0.25,
  saboteur: 0.3,
};

export type Tag =
  | "mechanical"
  | "repair_capable"
  | "salvage_sensitive"
  | "leech_purge"
  | "defensive"
  | "aggressive"
  | "neutral_maintenance"
  | "heavy_machine"
  | "anomaly_eligible"
  | "piloted"
  | "melee"
  | "machine" // allied machine: reactions, Coffin, Override
  | "structure"
  | "team"; // Relay Section R-8: ejectable cockpit, persistent pilot

export interface UnitDef {
  name: string;
  hp: number;
  atk: number;
  missiles: number;
  /** Each point deducts 1 from every instance of damage taken. */
  armor?: number;
  /** Capture class. Clampjaw and Lockbands handle small and medium machines only. */
  size?: "small" | "medium" | "heavy";
  /** Melee units start this many steps toward the player (0 Distant, 1 Closing, 2 Engaged). */
  startProx?: number;
  /** R-8 mechs: the pilot prepares to eject at this HP or less. */
  ejectAt?: number;
  /** Turns the escape capsule stays on the field before it is gone. */
  capsuleTurns?: number;
  /** How the cockpit leaves, shown when it does. */
  ejection?: string;
  tags: Tag[];
}

export const UNITS: Record<UnitKind, UnitDef> = {
  jubey: { name: "Jubey", hp: RULES.startHp, atk: 0, missiles: 0, tags: ["mechanical"] },
  light: { name: "Light Mech", hp: 4, atk: 1, missiles: 2, size: "medium", tags: ["mechanical", "aggressive", "piloted", "anomaly_eligible"] },
  lvl2: { name: "Level 2 Mech", hp: 8, atk: 2, missiles: 2, size: "heavy", tags: ["mechanical", "heavy_machine", "defensive", "leech_purge", "piloted", "anomaly_eligible"] },
  infested: { name: "Infested Mech", hp: 5, atk: 2, missiles: 0, size: "medium", startProx: 1, tags: ["mechanical", "aggressive", "melee"] },
  drone: { name: "Drone", hp: 2, atk: 1, missiles: 0, size: "small", tags: ["mechanical", "repair_capable", "salvage_sensitive", "neutral_maintenance"] },
  zombie: { name: "Zombie Mech", hp: 10, atk: 2, missiles: 0, size: "heavy", tags: ["mechanical", "heavy_machine", "aggressive", "melee"] },
  rifleman: { name: "Rifleman", hp: 1, atk: 1, missiles: 0, tags: [] },
  powered: { name: "Powered Armor", hp: 3, atk: 1, missiles: 0, armor: 1, size: "small", tags: ["mechanical", "piloted", "anomaly_eligible"] },
  patient: { name: "Patient Machine", hp: 6, atk: 2, missiles: 0, size: "heavy", tags: ["mechanical", "machine", "heavy_machine"] },
  scared: { name: "Scared Mech", hp: 4, atk: 1, missiles: 0, tags: ["mechanical", "machine"] },
  robobuddy: { name: "Lil Robobuddy", hp: RULES.buddyHp, atk: 0, missiles: 0, tags: ["mechanical", "machine"] },
  builder: { name: "Builder Drone", hp: 4, atk: 1, missiles: 0, tags: ["mechanical", "machine"] },
  possum: { name: "Machine Possum", hp: 3, atk: 0, missiles: 0, tags: ["mechanical", "machine"] },
  gunnest: { name: "Gun Nest", hp: 5, atk: 2, missiles: 0, tags: ["mechanical", "machine"] },
  bulkhead: { name: "Bulkhead", hp: 6, atk: 0, missiles: 0, tags: ["mechanical", "structure"] },
  beacon: { name: "Threat Beacon", hp: 5, atk: 0, missiles: 0, tags: ["mechanical", "structure"] },
  shepherd: { name: "Scrap Shepherd", hp: 4, atk: 0, missiles: 0, tags: ["mechanical", "machine"] },
  walker: { name: "Ceiling Walker", hp: 3, atk: 2, missiles: 0, tags: ["mechanical", "machine"] },
  jack: { name: "Panic Jack", hp: 5, atk: 1, missiles: 0, tags: ["mechanical", "machine"] },
  warframe: { name: "Unfinished Warframe", hp: 8, atk: 3, missiles: 0, tags: ["mechanical", "machine"] },
  clampjaw: { name: "Clampjaw Drone", hp: 4, atk: 0, missiles: 0, tags: ["mechanical", "machine"] },
  pod: { name: "Containment Pod", hp: 7, atk: 0, missiles: 0, tags: ["mechanical", "structure"] },
  needleback: { name: "Needleback Courier", hp: 5, atk: 2, missiles: 0, size: "medium", ejectAt: 2, capsuleTurns: 1, ejection: "The rear cockpit detaches and rocket rails throw it backward down the hall.", tags: ["mechanical", "piloted", "team", "anomaly_eligible"] },
  latchback: { name: "Latchback Brawler", hp: 9, atk: 3, missiles: 0, armor: 1, size: "medium", ejectAt: 3, capsuleTurns: 2, ejection: "The cockpit rotates up over the shoulder plating and the launcher fires it at the ceiling. It comes down two columns over.", tags: ["mechanical", "piloted", "team", "melee", "aggressive"] },
  widow: { name: "Gantry Widow", hp: 8, atk: 2, missiles: 0, size: "medium", ejectAt: 3, capsuleTurns: 2, ejection: "The crane legs spread and the cockpit drops out from under the frame onto its skids.", tags: ["mechanical", "piloted", "team", "repair_capable"] },
  kilnheart: { name: "Kilnheart Breaker", hp: 11, atk: 4, missiles: 0, size: "heavy", capsuleTurns: 1, ejection: "The escape rocket lights and the cockpit tears free of the burning frame.", tags: ["mechanical", "piloted", "team", "melee", "heavy_machine"] },
  bishop: { name: "Relay Bishop", hp: 7, atk: 2, missiles: 0, size: "medium", ejectAt: 3, capsuleTurns: 2, ejection: "The command pod lifts off the chassis under its own power, antennae still turning.", tags: ["mechanical", "piloted", "team"] },
  capsule: { name: "Escape Capsule", hp: RULES.capsuleHp, atk: 0, missiles: 0, size: "small", tags: ["mechanical"] },
  relay: { name: "Command Relay", hp: 6, atk: 0, missiles: 0, armor: 1, size: "heavy", tags: ["mechanical"] },
  prisoner: { name: "The Prisoner", hp: 7, atk: 3, missiles: 0, size: "medium", tags: ["mechanical", "machine"] },
};

export function label(kind: UnitKind): string {
  return UNITS[kind].name;
}
export function hasTag(kind: UnitKind, tag: Tag): boolean {
  return UNITS[kind].tags.includes(tag);
}

// ---------- Cards ----------

export type CardId =
  // starting deck and v0.2 rewards
  | "GUN" | "CRANE" | "BRACE" | "PATCH" | "ROCKET" | "BURST" | "WELDER" | "FLUSH"
  | "OVERCLOCK" | "SLUG" | "HOOK" | "PLATE" | "STRIP" | "QUIET" | "FLARE"
  // loadout
  | "FUEL" | "MINE" | "ROT"
  // brief 1
  | "BUILDER" | "LEECH" | "HALLWAY" | "BULKHEAD" | "BEACON" | "SERVO" | "CELL"
  | "POSSUM" | "GUNNEST" | "REDMOUTH" | "FOAM" | "REFLEX"
  // brief 2
  | "SHEPHERD" | "WALKER" | "JACK" | "WARFRAME" | "BADGE" | "COFFIN" | "RECORDER" | "HAND"
  // brief 3
  | "CLAMPJAW" | "LOCKBANDS" | "WEDGE" | "POD" | "MEMTAP";

export type Category =
  | "Attack" | "Defense" | "Utility" | "Machine Ally" | "Attachment" | "Equipment"
  | "Consumable" | "Structure" | "Reaction" | "Encounter Modifier" | "Nightmare" | "Auto-Deploy";

/** Who a card may be aimed at. Resolved to concrete units by the engine. */
export type TargetMode =
  | "none" | "enemy" | "column"
  | "enemyMech" // Salvage Leech
  | "friend" // any friendly unit (Bulkhead cover)
  | "foam" // friendly machine or structure, or any enemy
  | "machine" // friendly machine or mechanical enemy (Sealant Coffin)
  | "band" // a disabled, grappled or secured enemy machine (Industrial Lockbands)
  | "cockpit" // a piloted enemy mech (Cockpit Wedge)
  | "tap"; // a secured enemy machine, or your own Clampjaw or Pod holding one (Memory Tap)

export type Rarity = "starter" | "common" | "uncommon" | "rare" | "special";

export interface CardDef {
  id: CardId;
  name: string;
  cost: number; // Energy
  scrap?: number; // Scrap
  target: TargetMode;
  cats: Category[];
  rarity: Rarity;
  text: string;
  /** Deploys this unit; the card stays bound to it while it lives. */
  deploys?: UnitKind;
  /** Gone from the deck for good when played or used up. */
  exhaust?: boolean;
  /** Usable once per fight; returns to the deck next room. */
  once?: boolean;
  needsWreck?: boolean;
  firearm?: boolean;
  melee?: boolean;
  /** Tech ability: a Cold Reactor Cell charge can pay 1 of its Energy. */
  tech?: boolean;
  unplayable?: boolean;
}

const R = RULES;
const c = (d: CardDef) => d;

export const CARDS: Record<CardId, CardDef> = {
  GUN: c({ id: "GUN", name: "Machine Gun", cost: 1, target: "enemy", cats: ["Attack"], rarity: "starter", firearm: true, text: "1–3 damage." }),
  CRANE: c({ id: "CRANE", name: "Crane Smash", cost: 1, target: "column", cats: ["Attack"], rarity: "starter", melee: true, text: "3 damage across 3 columns. 25% stun. Survivors aim sharper." }),
  BRACE: c({ id: "BRACE", name: "Brace", cost: 1, target: "none", cats: ["Defense"], rarity: "starter", text: `Block ${R.braceBlock} this turn.` }),
  PATCH: c({ id: "PATCH", name: "Patch Weld", cost: 1, target: "none", cats: ["Utility"], rarity: "starter", once: true, tech: true, text: "Heal 2. Once per fight." }),
  ROCKET: c({ id: "ROCKET", name: "HEAP Rocket", cost: 1, target: "enemy", cats: ["Attack", "Consumable"], rarity: "special", exhaust: true, text: "4 damage, 2 splash, Burn 2. Ammo: gone once fired." }),
  BURST: c({ id: "BURST", name: "Suppressing Burst", cost: 1, target: "none", cats: ["Attack"], rarity: "common", firearm: true, text: "1 damage to every enemy." }),
  WELDER: c({ id: "WELDER", name: "Arc Welder", cost: 1, target: "enemy", cats: ["Attack"], rarity: "common", tech: true, text: "1 damage. Burn 3." }),
  FLUSH: c({ id: "FLUSH", name: "Coolant Flush", cost: 0, target: "none", cats: ["Utility"], rarity: "common", text: "Draw 2." }),
  OVERCLOCK: c({ id: "OVERCLOCK", name: "Overclock", cost: 0, target: "none", cats: ["Utility", "Nightmare"], rarity: "common", text: "+2 Energy. +2 Madness." }),
  SLUG: c({ id: "SLUG", name: "Deadbolt Slug", cost: 2, target: "enemy", cats: ["Attack"], rarity: "common", firearm: true, text: "5 damage." }),
  HOOK: c({ id: "HOOK", name: "Crane Hook", cost: 1, target: "enemy", cats: ["Attack"], rarity: "common", melee: true, text: "2 damage. Stun." }),
  PLATE: c({ id: "PLATE", name: "Scrap Plate", cost: 2, target: "none", cats: ["Defense"], rarity: "common", text: `Block ${R.plateBlock} this turn.` }),
  STRIP: c({ id: "STRIP", name: "Field Strip", cost: 1, target: "none", cats: ["Utility"], rarity: "common", needsWreck: true, text: `Strip a wreck mid-fight: +${R.fieldStripScrap} Scrap, +1 Threat.` }),
  QUIET: c({ id: "QUIET", name: "Go Quiet", cost: 1, target: "none", cats: ["Utility"], rarity: "common", text: "−2 Threat. Draw 1." }),
  FLARE: c({ id: "FLARE", name: "Flare", cost: 1, target: "none", cats: ["Utility"], rarity: "common", text: "Enemies aim worse this turn. Draw 1." }),

  FUEL: c({ id: "FUEL", name: "Fuel Canister", cost: 1, target: "enemy", cats: ["Attack", "Consumable"], rarity: "special", exhaust: true, text: "Toss it: 2 damage, Burn 2. One use." }),
  MINE: c({ id: "MINE", name: "AM Mine", cost: 0, target: "none", cats: ["Auto-Deploy", "Consumable"], rarity: "special", unplayable: true, text: `Deploys itself each fight. After turn 1, the first enemy machine to enter or advance takes ${R.mineDamage}. One use.` }),
  ROT: c({ id: "ROT", name: "Contaminated Seal", cost: 0, target: "none", cats: ["Nightmare"], rarity: "special", unplayable: true, text: "Unplayable. Contamination clogs the rig until Decon." }),

  BUILDER: c({ id: "BUILDER", name: "Half-Awake Builder Drone", cost: 0, scrap: 2, target: "none", cats: ["Machine Ally"], rarity: "common", deploys: "builder", text: `4 HP / 1. Every ${R.builderInterval}nd turn: repairs ${R.builderPatch} or sorts ${R.builderSort} Scrap. Leaves 1 Scrap when destroyed.` }),
  LEECH: c({ id: "LEECH", name: "Salvage Leech", cost: 0, scrap: 1, target: "enemyMech", cats: ["Attachment"], rarity: "uncommon", tech: true, text: `Attach to an enemy machine. Each turn it takes ${R.leechThreshold}+ damage: +1 Scrap (max ${R.leechMax}). 2nd pull strips 1 Armor.` }),
  HALLWAY: c({ id: "HALLWAY", name: "Wrong Hallway", cost: 0, target: "none", cats: ["Encounter Modifier"], rarity: "rare", once: true, text: "After this fight the exit is wrong. Extra choices, extra danger, extra salvage." }),
  BULKHEAD: c({ id: "BULKHEAD", name: "Emergency Bulkhead", cost: 0, scrap: 2, target: "friend", cats: ["Structure"], rarity: "common", deploys: "bulkhead", text: `6 HP cover for one ally. Collapse it to prevent ${R.collapsePrevent} damage to every ally this turn.` }),
  BEACON: c({ id: "BEACON", name: "Threat Beacon", cost: 0, target: "none", cats: ["Structure", "Utility"], rarity: "uncommon", deploys: "beacon", exhaust: true, text: `+${R.beaconScrap} Scrap, +${R.beaconThreat} Threat. 5 HP decoy: enemies attack it first. One use.` }),
  SERVO: c({ id: "SERVO", name: "Captured Servo Limb", cost: 0, scrap: 1, target: "none", cats: ["Equipment"], rarity: "uncommon", text: `Equip: first melee card each turn +${R.servoBonus}. At Madness ${R.highMadness}+ it may swing again at anything.` }),
  CELL: c({ id: "CELL", name: "Cold Reactor Cell", cost: 0, target: "none", cats: ["Equipment"], rarity: "rare", text: `Equip: ${R.cellCharges} Charges. A Charge pays 1 Energy of a Tech ability. The last one may burst.` }),
  POSSUM: c({ id: "POSSUM", name: "Machine Possum", cost: 0, scrap: 1, target: "none", cats: ["Machine Ally"], rarity: "common", deploys: "possum", text: `3 HP / 0. Plays dead after one hit. Each enemy death: +1 Scrap at room end (max ${R.possumCap}).` }),
  GUNNEST: c({ id: "GUNNEST", name: "Floor-Crawler Gun Nest", cost: 0, scrap: 2, target: "none", cats: ["Structure"], rarity: "uncommon", deploys: "gunnest", text: `5 HP / 2. Crawls to the nearest enemy and clamps on for +${R.nestClampBonus}. Lasts the fight.` }),
  REDMOUTH: c({ id: "REDMOUTH", name: "Red-Mouth Ammunition", cost: 0, target: "none", cats: ["Nightmare", "Consumable"], rarity: "uncommon", text: `Load: your next firearm card this turn +${R.redmouthBonus}, +1 Madness. ${R.redmouthRounds} rounds. At Madness ${R.highMadness}+ it may pick its own target.` }),
  FOAM: c({ id: "FOAM", name: "Maintenance Foam", cost: 1, target: "foam", cats: ["Utility"], rarity: "common", tech: true, text: `Ally machine: untargetable and idle for a turn, then heal ${R.foamHeal}. Enemy: disabled for a turn.` }),
  REFLEX: c({ id: "REFLEX", name: "Dead Pilot's Reflex", cost: 0, target: "none", cats: ["Reaction", "Nightmare"], rarity: "uncommon", text: "Arm it. When an allied machine is destroyed, Jubey strikes for its attack. +1 Madness." }),

  SHEPHERD: c({ id: "SHEPHERD", name: "Scrap Shepherd", cost: 0, scrap: 2, target: "none", cats: ["Machine Ally"], rarity: "common", deploys: "shepherd", text: `4 HP / 0. Hauls one wreck a turn, no Threat. Every ${R.shepherdPair} wrecks: +${R.shepherdPayout} Scrap.` }),
  WALKER: c({ id: "WALKER", name: "Ceiling Walker", cost: 0, scrap: 2, target: "none", cats: ["Machine Ally"], rarity: "uncommon", deploys: "walker", text: `3 HP / 2. Overhead: melee can't reach it. Hunts the weakest enemy. Falls for ${R.walkerFall} when destroyed.` }),
  JACK: c({ id: "JACK", name: "Panic Jack", cost: 0, scrap: 2, target: "none", cats: ["Machine Ally"], rarity: "uncommon", deploys: "jack", text: `5 HP / 1. Guards one ally: once a fight it takes the hit and counters for ${R.jackCounter}.` }),
  WARFRAME: c({ id: "WARFRAME", name: "Unfinished Warframe", cost: 0, scrap: 3, target: "none", cats: ["Machine Ally"], rarity: "rare", deploys: "warframe", text: `8 HP / 3. Inert until ${R.warframeNeed} startup points: 1 per turn, 1 per Builder job. Damaged startups can go wrong.` }),
  BADGE: c({ id: "BADGE", name: "Faulty Access Badge", cost: 1, target: "none", cats: ["Utility"], rarity: "common", tech: true, text: `Drones hold fire for ${R.badgeTurns} turns. Then a check: ${Math.round(R.badgeFlag * 100)}% flagged, +1 Threat. Opens doors in events.` }),
  COFFIN: c({ id: "COFFIN", name: "Sealant Coffin", cost: 1, target: "machine", cats: ["Utility"], rarity: "common", tech: true, text: `Seal a machine: it skips ${R.coffinActions} actions, then heals ${R.coffinHeal}. Works on enemies. They heal too.` }),
  RECORDER: c({ id: "RECORDER", name: "Black-Box Recorder", cost: 0, target: "none", cats: ["Reaction", "Nightmare"], rarity: "uncommon", text: `Arm it. When an allied machine is destroyed: pay ${R.recorderScrap} Scrap, draw ${R.recorderDraw}, +1 Madness. Once a fight.` }),
  HAND: c({ id: "HAND", name: "Manual Override Hand", cost: 0, scrap: 2, target: "none", cats: ["Equipment", "Nightmare"], rarity: "rare", text: "Equip: once a fight, cancel an allied machine's malfunction and take control. It takes 1 damage." }),

  CLAMPJAW: c({ id: "CLAMPJAW", name: "Clampjaw Drone", cost: 0, scrap: 2, target: "none", cats: ["Machine Ally"], rarity: "common", deploys: "clampjaw", text: `4 HP / 0. Order it to apprehend a machine at ${R.captureHp} HP or less, or a disabled one: grapple, then lock. Holds ONE captive.` }),
  LOCKBANDS: c({ id: "LOCKBANDS", name: "Industrial Lockbands", cost: 0, scrap: 1, target: "band", cats: ["Utility", "Equipment"], rarity: "common", text: `Band a disabled, grappled or secured machine: +${R.bandIntegrity} restraint. Finishes a grapple. Max ${R.maxBands} per captive.` }),
  WEDGE: c({ id: "WEDGE", name: "Cockpit Wedge", cost: 0, scrap: 1, target: "cockpit", cats: ["Attachment"], rarity: "uncommon", text: `Jam a piloted mech's cockpit for ${R.wedgeTurns} turns: no ejection. Radio, weapons and reactors are untouched. A trapped pilot can die in there.` }),
  POD: c({ id: "POD", name: "Mobile Containment Pod", cost: 0, scrap: 3, target: "none", cats: ["Structure"], rarity: "rare", deploys: "pod", text: `7 HP. Holds ONE secured pilot, capsule, Drone or small machine. 1 Energy every ${R.podUpkeepTurns} occupied turns. Travels with you.` }),
  MEMTAP: c({ id: "MEMTAP", name: "Memory Tap", cost: 1, target: "tap", cats: ["Utility"], rarity: "uncommon", tech: true, text: "Read a secured or contained machine's records: a hazard scan, a weakness, or a cache trace. Once per captive. Records can be corrupt." }),
};

export const STARTING_DECK: CardId[] = [
  "GUN", "GUN", "GUN", "GUN",
  "CRANE", "CRANE",
  "BRACE", "BRACE", "BRACE",
  "PATCH",
];

/** Reward pool: every card with a rarity of common, uncommon or rare. */
export const REWARD_POOL: CardId[] = (Object.keys(CARDS) as CardId[]).filter((id) =>
  ["common", "uncommon", "rare"].includes(CARDS[id].rarity),
);
export const RARITY_WEIGHT: Record<Rarity, number> = { starter: 0, common: 6, uncommon: 3, rare: 1, special: 0 };

export const LOOTBOX_POOL: CardId[] = ["FUEL", "FUEL", "FLARE", "FOAM", "QUIET", "HOOK"];

// ---------- Variants (Tech Stop specializations, one per card instance) ----------

export interface VariantDef {
  id: string;
  card: CardId;
  name: string;
  text: string;
}

export const VARIANTS: VariantDef[] = [
  { id: "awake", card: "BUILDER", name: "Fully Awake Drone", text: "You choose Patch Job or Scrap Sorting each time." },
  { id: "scavenger", card: "BUILDER", name: "Scavenger Drone", text: `Sorts ${R.scavengerSort} Scrap. Cannot repair. No Emergency Repair.` },
  { id: "overworked", card: "BUILDER", name: "Overworked Drone", text: `Works every turn. Loses 1 HP after every ${R.overworkedEvery}rd job.` },
  { id: "possessed", card: "BUILDER", name: "Possessed Builder", text: `Repairs ${R.possessedPatch}. ${Math.round(R.possessedWrong * 100)}% it repairs an enemy instead.` },
  { id: "blood", card: "LEECH", name: "Blood-Scrap Leech", text: "Each pull also deals 1 damage to the host." },
  { id: "symbiotic", card: "LEECH", name: "Symbiotic Leech", text: `Attach to an allied machine. Each real repair it gets: +1 Scrap (max ${R.symbioticMax} a fight).` },
  { id: "queen", card: "LEECH", name: "Queen Salvager", text: "When the host dies, spawns one temporary Leech on another enemy." },
];

export function cardName(id: CardId, variant?: string): string {
  const v = variant && VARIANTS.find((x) => x.id === variant && x.card === id);
  return v ? v.name : CARDS[id].name;
}
export function cardText(id: CardId, variant?: string): string {
  const v = variant && VARIANTS.find((x) => x.id === variant && x.card === id);
  return v ? `${CARDS[id].text} ${v.text}` : CARDS[id].text;
}

export const ENERGY_UP = [
  { from: 1, to: 2, scrap: 3, rs: 0 },
  { from: 2, to: 3, scrap: 6, rs: 1 },
  { from: 3, to: 4, scrap: 9, rs: 2 },
];

export const HP_UP = [
  { rank: 1, scrap: 2 },
  { rank: 2, scrap: 4 },
  { rank: 3, scrap: 6 },
];

// ---------- Flavor lines (inexpensive "animation": a mood word on the token + a log line) ----------

export const BUILDER_MOODS = [
  "welds the same plate again",
  "drags an oversized panel",
  "unfolds three small arms",
  "sorts scrap into neat piles",
  "does a small victory wiggle",
];
export const LEECH_RADIO = [
  "“Something's cutting into my chassis!”",
  "“Maintenance, get this thing OFF!”",
  "“It's inside the armor plating!”",
  "“Forget the damage! Pull it out!”",
];
export const RECORDER_LINES = [
  "UNIT LOSS CONFIRMED.",
  "FINAL ACTION UNRECOVERABLE.",
  "REPLAYING LAST COMMAND.",
  "OPERATOR NOT FOUND.",
  "RECORDING CONTAINS UNKNOWN VOICE.",
];
export const OVERRIDE_LINES = [
  "hesitates before taking the command",
  "prints a diagnostic nobody asked for",
  "shows a recognition prompt, then clears it",
];
export const DAMAGE_NOTES = ["missing armor", "broken weapon mounts", "damaged sensors", "a failing power system"];
