// Pilot tables: items, specializations, personalities, names and every
// tunable number the pilot brief marks PROPOSED or TUNE LATER.

export const PR = {
  slots: 3,
  slot4Parts: 3,
  partDrop: 0.2,

  // Stat generation by level: [min, max]. A level's max is also its stat cap.
  statRange: { 1: [1, 5], 2: [2, 7], 3: [2, 9], 4: [3, 11], 5: [4, 12] } as Record<number, [number, number]>,
  xpFor: [0, 0, 10, 25, 45, 70], // xp needed to reach level n
  maxLevel: 5,

  // Stat effects
  mentalMadness: 0.04, mentalMadnessCap: 0.4,
  mentalNightmare: 0.02, mentalNightmareCap: 0.24,
  skillAcc: 0.03, skillAccCap: 0.3,
  endResist: 0.025, endResistCap: 0.3,
  endSurvive: 0.03, endSurviveCap: 0.36,
  baseHp: 3, // pilot max HP = 3 + floor(Endurance / 2)

  pilotBaseHit: 0.7,
  hitFloor: 0.05,
  hitCeiling: 0.95,

  // XP
  xpSortie: 3,
  xpKill: 1,
  xpInspect: 2,

  // Madness, on the 0-100 pilot scale
  nightmareMadness: 5,
  recoverPerTurn: 2,
  deconMadness: 10,
  fleeingMad: 0.8,
  fleeingMadRange: [10, 20] as [number, number],

  // Loyalty bands: lower bound of each band
  bands: [0, 25, 45, 65, 85],
  talkGain: 5,
  talkGainHostile: 4,
  pursuitGain: 0.75, // R-8 captives warm up slower while their section is still hunting
  assignGainCaptive: 6,
  assignGainAlly: 2,
  treatGain: 6,
  agreeGain: 8,
  agreeBroken: -20,
  agreeKept: 10,
  harsh: { voiceseal: -1, acoustic: -1, harness: -2 } as Record<string, number>,
  againstTeam: -8,
  lockShackles: -5,

  // Betrayal (hidden) per sortie, by band index: 0 hostile .. 4 loyal
  betrayCaptive: [1, 1, 0.25, 0.1, 0.03],
  betrayAlly: [1, 1, 0.08, 0, 0],
  betrayFastFrame: 0.1,
  betrayTeamPresent: 0.15,
  superviseShackles: 0.5,
  superviseTracker: 0.75,
  superviseJack: 0.75,

  // Custody strain per room, by band index, and what each restraint takes off it
  strainBase: [20, 15, 8, 2, 0],
  strainPod: 5,
  strainWarn: 70,
  strainWarnDiag: 55,
  tightenScrap: 1,
  tightenAmount: 30,
  beaconPing: 0.3,
  muffleSlip: 0.2,

  // Frames
  frameStats: { light: [5, 2, 0], medium: [7, 2, 0], heavy: [9, 3, 1] } as Record<string, [number, number, number]>,
  frameDamaged: 0.25,
  frameRepairScrap: 2, // per fault
  frameSalvage: { light: 3, medium: 4, heavy: 5 } as Record<string, number>,
  incompatibleSkill: -2,
  ejectExposure: 1,
  sealExposure: 3,
  separated: 0.25,

  // Encounters
  mechChance: 0.1,
  cargoChance: 0.12,
  fleeingChance: 0.1,
  fleeingFromRoom: 2,
  gasChance: 0.15,
  gasDamage: 2,
  gasLoyalty: { coop: [3, 7], pw: [5, 10], hostile: [10, 15], concealed: [10, 15] } as Record<string, [number, number]>,
  fleeingAccept: 0.85,
  fleeingFollowed: 0.3,

  // Tech Stop quartermaster
  shopSize: 3,
};

export type Stat = "mental" | "skill" | "endurance";
export type Spec = "Scout" | "Assault" | "Recovery" | "Heavy" | "Command" | "Technician";
export type Chassis = "light" | "medium" | "heavy";

export const SPECS: Record<Spec, { text: string; frames: Chassis[]; improved: string }> = {
  Scout: { text: "+2 Skill on inspection checks.", frames: ["light", "medium"], improved: "+4 Skill on inspection checks." },
  Assault: { text: "+1 damage, in a frame or on foot.", frames: ["medium", "heavy"], improved: "+2 damage." },
  Recovery: { text: "Its frame repairs 1 HP after each fight. Ejected safely, it is always found.", frames: ["light", "medium"], improved: "Its frame repairs 2 HP after each fight." },
  Heavy: { text: "Handles heavy frames without penalty.", frames: ["heavy"], improved: "+1 damage in a heavy frame." },
  Command: { text: "While fielded, your machines hit 5% more often.", frames: ["light", "medium"], improved: "Machines hit 10% more often." },
  Technician: { text: "+2 Skill on technical checks. Frame repairs cost 1 less Scrap.", frames: ["light", "medium"], improved: "+4 Skill on technical checks." },
};

export interface Trait {
  name: string;
  gain: number; // loyalty gain multiplier
  betray: number; // added to betrayal chance
  note: string;
}

export const TRAITS: Record<string, Trait> = {
  cautious: { name: "Cautious scout", gain: 1, betray: 0.05, note: "Watches the exits." },
  stubborn: { name: "Stubborn bodyguard", gain: 0.7, betray: 0, note: "Does not change sides easily, in either direction." },
  pragmatic: { name: "Pragmatic recovery specialist", gain: 1.3, betray: 0, note: "Responds to fair terms." },
  defiant: { name: "Defiant", gain: 0.8, betray: 0.05, note: "Will not talk while hurt and untreated." },
  commander: { name: "Section commander", gain: 0.5, betray: 0.1, note: "Loyal to a section that is still out there." },
  rookie: { name: "Nervous rookie", gain: 1.2, betray: 0, note: "Wants to be told what to do." },
  overconfident: { name: "Overconfident trainee", gain: 1, betray: 0.05, note: "Thinks they could do better on their own." },
  quiet: { name: "Quiet maintenance operator", gain: 1.1, betray: 0, note: "Says little. Fixes things." },
  wounded: { name: "Wounded scout", gain: 1.1, betray: 0, note: "Came in hurt." },
  recovery: { name: "Former recovery specialist", gain: 1.1, betray: 0, note: "Has pulled people out before." },
  frightened: { name: "Frightened civilian-trained operator", gain: 1.3, betray: 0, note: "Never meant to be down here." },
};

export const FLEEING_TRAITS = ["rookie", "overconfident", "quiet", "wounded", "recovery", "frightened"];
export const TRAIT_SPEC: Record<string, Spec | undefined> = { quiet: "Technician", wounded: "Scout", recovery: "Recovery" };

export const FLEE_NAMES = ["Pell", "Vey", "Okafor", "Lindqvist", "Marrow", "Ishida", "Calloway", "Brandt", "Teague", "Soler", "Abernathy", "Kwan"];

export const FLEE_STORIES: { text: string; effect: "infested" | "nav" | "none" | "reveal" }[] = [
  { text: "“Something big in the loading bay. It wasn't a mech. It was wearing one.”", effect: "infested" },
  { text: "“The corridor behind me wasn't there yesterday. I counted the doors.”", effect: "nav" },
  { text: "“Lost my frame two rooms back. Reactor scram. I ran.”", effect: "none" },
  { text: "“There's a patrol in the next room. Light frames. I hid under the floor grate until they passed.”", effect: "reveal" },
  { text: "“My group split up at the junction. I don't know where they went.”", effect: "none" },
];

// ---------- items ----------

export type ItemCat = "gag" | "restraint" | "relay" | "weapon" | "module" | "support";
export type ItemSide = "captive" | "ally";

export interface ItemDef {
  id: string;
  name: string;
  cat: ItemCat;
  side: ItemSide;
  price: number; // Scrap at the Tech Stop
  text: string;
  charges?: number;
  // weapons
  dmg?: number;
  shots?: number;
  hit?: number;
  stun?: boolean;
  // effects
  strain?: number;
  harsh?: boolean;
}

const I = (d: ItemDef) => d;

export const ITEMS: Record<string, ItemDef> = {
  // Captive: gags. They stop speech. Radios, alarms and suit transmitters are another channel.
  muffle: I({ id: "muffle", name: "Basic Muffle Wrap", cat: "gag", side: "captive", price: 1, text: "Blocks spoken warnings. Cheap. A captive can work it loose in a fight near their old section." }),
  voiceseal: I({ id: "voiceseal", name: "Reinforced Voice Seal", cat: "gag", side: "captive", price: 2, harsh: true, text: "Blocks speech and stays on. Talking needs it removed. −1 loyalty per room." }),
  acoustic: I({ id: "acoustic", name: "Acoustic Suppression Mask", cat: "gag", side: "captive", price: 3, harsh: true, text: "Blocks speech, and masks even muffled noise at a distance. −1 loyalty per room." }),
  muzzle: I({ id: "muzzle", name: "Quick-Release Muzzle", cat: "gag", side: "captive", price: 1, text: "Stops half of spoken warnings. You can talk to them without taking it off." }),
  // Captive: restraints. At most two, at most one harness.
  plockbands: I({ id: "plockbands", name: "Industrial Lockbands", cat: "restraint", side: "captive", price: 1, strain: 6, text: "−6 escape strain per room. Two can be fitted." }),
  cuffs: I({ id: "cuffs", name: "Reinforced Cuffs", cat: "restraint", side: "captive", price: 2, strain: 8, text: "−8 escape strain per room." }),
  ankle: I({ id: "ankle", name: "Magnetic Ankle Locks", cat: "restraint", side: "captive", price: 2, strain: 5, text: "−5 escape strain per room. A runner wearing them is a turn slower." }),
  harness: I({ id: "harness", name: "Armored Restraint Harness", cat: "restraint", side: "captive", price: 3, strain: 12, harsh: true, text: "−12 escape strain per room. No field assignments while worn. −2 loyalty per room." }),
  shackles: I({ id: "shackles", name: "Remote Release Shackles", cat: "restraint", side: "captive", price: 3, strain: 4, text: "−4 strain. Stays on during assignments: halves the chance they bolt, and you can lock it remotely when they try." }),
  // Captive: relays. Monitoring tells you; it does not stop anything.
  statusrelay: I({ id: "statusrelay", name: "Captive Status Relay", cat: "relay", side: "captive", price: 1, text: "Shows exact escape strain. Warns at 70." }),
  monitor: I({ id: "monitor", name: "Communication Monitor", cat: "relay", side: "captive", price: 2, text: "Reports when their suit transmitter pings their old section. Does not block it." }),
  isolator: I({ id: "isolator", name: "Local Signal Isolator", cat: "relay", side: "captive", price: 3, text: "Blocks the suit-band transmitter while worn. Does nothing about speech." }),
  tracker: I({ id: "tracker", name: "Tracking Relay", cat: "relay", side: "captive", price: 2, text: "If they escape, they do not get clear: they turn up running in your next fight. Also deters bolting." }),
  diagrelay: I({ id: "diagrelay", name: "Custody Diagnostic Relay", cat: "relay", side: "captive", price: 1, text: "Projects next room's strain and warns from 55." }),
  // Ally: weapons. Personal weapons are for on-foot assignments only.
  sidearm: I({ id: "sidearm", name: "Standard Sidearm", cat: "weapon", side: "ally", price: 2, dmg: 2, hit: 0.75, text: "On foot: 2 damage." }),
  heavysidearm: I({ id: "heavysidearm", name: "Heavy Sidearm", cat: "weapon", side: "ally", price: 3, dmg: 3, hit: 0.6, text: "On foot: 3 damage, less accurate." }),
  smg: I({ id: "smg", name: "Compact SMG", cat: "weapon", side: "ally", price: 3, dmg: 1, shots: 2, hit: 0.7, text: "On foot: two 1-damage shots." }),
  carbine: I({ id: "carbine", name: "Emergency Carbine", cat: "weapon", side: "ally", price: 3, dmg: 2, hit: 0.85, text: "On foot: 2 damage, reliable." }),
  shock: I({ id: "shock", name: "Shock Pistol", cat: "weapon", side: "ally", price: 2, dmg: 0, hit: 0.7, stun: true, text: "On foot: stuns a small or medium target for a turn. No damage." }),
  // Ally: enhancement modules. Bonuses share the stat caps.
  targeting: I({ id: "targeting", name: "Stabilized Targeting", cat: "module", side: "ally", price: 2, text: "+5% accuracy (within the +30% cap)." }),
  dampener: I({ id: "dampener", name: "Mental Dampener", cat: "module", side: "ally", price: 2, text: "+15% Madness penalty reduction (within the 40% cap)." }),
  padding: I({ id: "padding", name: "Reinforced Suit Padding", cat: "module", side: "ally", price: 2, text: "+10% chance to ignore a point of damage (within the 30% cap)." }),
  reflexamp: I({ id: "reflexamp", name: "Reflex Amplifier", cat: "module", side: "ally", price: 2, text: "On foot: enemies are 5% less likely to hit." }),
  sync: I({ id: "sync", name: "Cockpit Synchronizer", cat: "module", side: "ally", price: 3, text: "In a frame: +10% accuracy (within the cap)." }),
  // Ally: support
  medkit: I({ id: "medkit", name: "Emergency Medkit", cat: "support", side: "ally", price: 2, charges: 3, text: "3 charges. A charge heals a pilot 2, or treats a captive." }),
  scanner: I({ id: "scanner", name: "Portable Scanner", cat: "support", side: "ally", price: 2, text: "+2 Skill on inspections. Lets you scan suspicious cargo from below." }),
  toolkit: I({ id: "toolkit", name: "Repair Toolkit", cat: "support", side: "ally", price: 2, text: "Its pilot's frame repairs 1 HP after each fight. Frame repairs cost 1 less Scrap." }),
  salvagebeacon: I({ id: "salvagebeacon", name: "Salvage Beacon", cat: "support", side: "ally", price: 2, text: "If its pilot fought, one wreck is recovered at the end with no Threat." }),
  escapebeacon: I({ id: "escapebeacon", name: "Emergency Escape Beacon", cat: "support", side: "ally", price: 2, text: "If its pilot's frame goes down, they eject cleanly and are always found." }),
};

export const ITEM_IDS = Object.keys(ITEMS);
export const ALLY_ITEMS = ITEM_IDS.filter((i) => ITEMS[i].side === "ally");
export const CAPTIVE_ITEMS = ITEM_IDS.filter((i) => ITEMS[i].side === "captive");

/** R-8 pilots: who they are before you meet them. Stats are rolled from their level at run start. */
export const R8_PILOTS: Record<string, { level: number; spec: Spec; trait: string; loyalty: number; gear: string[] }> = {
  "p-needle": { level: 2, spec: "Scout", trait: "cautious", loyalty: 30, gear: ["sidearm", "scanner"] },
  "p-latch": { level: 3, spec: "Assault", trait: "stubborn", loyalty: 15, gear: ["heavysidearm", "padding"] },
  "p-widow": { level: 2, spec: "Recovery", trait: "pragmatic", loyalty: 35, gear: ["sidearm", "toolkit", "medkit"] },
  "p-kiln": { level: 3, spec: "Heavy", trait: "defiant", loyalty: 10, gear: ["carbine", "padding"] },
  "p-bishop": { level: 4, spec: "Command", trait: "commander", loyalty: 5, gear: ["sidearm", "sync", "escapebeacon"] },
};

export const FRAME_FAULTS: Record<string, { name: string; text: string; skill?: number }> = {
  weapon: { name: "Damaged weapon", text: "−1 damage." },
  sensors: { name: "Faulty sensors", text: "−10% accuracy." },
  seal: { name: "Weak cockpit seal", text: "Ejection may fail. A pilot inside a destroyed frame takes 3." },
  movement: { name: "Unstable movement", text: "Acts only every other turn." },
  reactor: { name: "Reactor problem", text: "Loses 1 HP at the start of every fight. Needs Skill 8 or a Builder Drone to fix.", skill: 8 },
};
