// Choice events: the Scared Mech, hall offers, Wrong Hallway and its rooms,
// The Drone Remembers, The Patient Machine, and The Assembly Yard.
// Every random outcome is rolled once when the event opens and stored in
// event.data, so closing and reopening the screen can never reroll it.

import { CHOICES, DAMAGE_NOTES, REWARD_POOL, CARDS, RULES, SCARED_STORY, label, type ChoiceId, type UnitKind } from "./data";
import {
  addCard,
  addScrap,
  allies,
  canPayEnergy,
  chance,
  deal,
  giveRocketAmmo,
  hasAlly,
  inDeck,
  jubey,
  log,
  payEnergy,
  pick,
  removeFromPiles,
  repair,
  roll,
  spawn,
  freeFriendSlot,
} from "./core";
import type { GameState, Unit } from "./state";
import { isStory, resolveStory, storyView } from "./story";

export interface Option {
  id: string;
  label: string;
  detail: string;
  enabled: boolean;
}
export interface EventView {
  title: string;
  lines: string[];
  options: Option[];
  /** The Prisoner's expression screen: ellipses and punctuation only, with a sound caption. */
  screen?: { glyph: string; anim: string; caption: string };
}

/** Hooks the engine provides, so this module never drives room flow itself. */
export interface Flow {
  continueHall(state: GameState): void;
  finishRoom(state: GameState): void;
  startExtension(state: GameState, kinds: UnitKind[], setup?: (state: GameState, foes: Unit[]) => void): void;
  afterCustody(state: GameState): void;
}

type Data = Record<string, number | string | boolean | string[]>;

export function openEvent(state: GameState, id: string, data: Data = {}, lines: string[] = []) {
  state.phase = "event";
  state.energy = state.energyCap;
  state.event = { id, data, lines };
}
function say(state: GameState, line: string) {
  state.event?.lines.push(line);
  log(state, line);
}
function set(state: GameState, key: string, value: number | string | boolean) {
  if (state.event) state.event.data[key] = value;
}
const opt = (id: string, name: string, detail: string, enabled = true): Option => ({ id, label: name, detail, enabled });
const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Faulty Access Badge used outside a fight: the same check as in one. */
function badgeCheck(state: GameState, hostile = false) {
  const p = RULES.badgeFlag + (hostile ? RULES.badgeHostilePenalty : 0);
  if (chance(state, p)) {
    state.threat += 1;
    say(state, `Security verification: CREDENTIAL FLAGGED. Lights come up down the hall. Threat ${state.threat}.`);
  } else say(state, "Security verification: the reader blinks, loses interest, and goes dark.");
}

function damagedEnemy(state: GameState): UnitKind {
  return state.room >= 3 && chance(state, 0.4) ? "lvl2" : "light";
}
/** Marks an enemy as arriving already hurt. Never claims a history it does not have. */
export function applyDamage(state: GameState, u: Unit) {
  const note = pick(state, DAMAGE_NOTES);
  u.note = note;
  u.hp = Math.max(2, u.hp - (u.kind === "lvl2" ? 3 : 2));
  if (note === "missing armor") {
    if (u.armor > 0) u.armor -= 1;
    else u.weak = true;
  }
  if (note === "broken weapon mounts") u.missiles = 0;
  if (note === "damaged sensors") u.accMod = -1;
  if (note === "a failing power system") u.stunned = 1;
}

// ---------- which events can open ----------

export function rollChoice(state: GameState) {
  const pool = CHOICES.map((c) => c.id);
  const a = pool.splice(Math.floor(roll(state) * pool.length), 1)[0];
  const b = pool.splice(Math.floor(roll(state) * pool.length), 1)[0];
  state.choiceShown = [a, b];
  openEvent(state, "choice");
  log(state, "The hall offers something.");
}

export function openRemembers(state: GameState) {
  state.seen.droneRemembers = true;
  openEvent(state, "remembers", { follow: Math.floor(roll(state) * 4), alone: Math.floor(roll(state) * 3) }, [
    "The Builder Drone stops. Its head turns to a sealed maintenance hatch and stays there. It starts toward the wall as if it has done this before.",
  ]);
  log(state, "The Drone Remembers.");
}

export function openPatient(state: GameState) {
  state.seen.patient = true;
  const h = RULES.patientHostile;
  openEvent(
    state,
    "patient",
    {
      hRepair: chance(state, h.repair),
      hStrip: chance(state, h.strip),
      hInspect: chance(state, h.inspect),
      memory: Math.floor(roll(state) * 5),
      part: chance(state, 0.35),
    },
    [
      "A repair ward. A large machine hangs in an industrial cradle, combat systems dark. Its diagnostic screen says REPAIR REQUESTED, clears, and says it again.",
    ],
  );
  log(state, "The Patient Machine.");
}

export function openYard(state: GameState) {
  state.seen.yard = true;
  openEvent(state, "yard", { hScav: chance(state, 0.35), hComm: chance(state, 0.25), hPower: chance(state, 0.25) }, [
    "An assembly station nobody shut down properly. Wreckage piles, industrial arms frozen mid-reach, damaged frames on the line, a power coupling that sparks when you look at it.",
  ]);
  log(state, "The Assembly Yard.");
}

const HALL_EVENTS = ["hw-maint", "hw-behind", "hw-salvage", "hw-circle"];

export function openHallway(state: GameState) {
  state.hallwayDone = true;
  state.hallwayArmed = false;
  const special = hasAlly(state, "builder") && !!inDeck(state, "LEECH");
  const pool = [...HALL_EVENTS, ...(special ? Array(RULES.eatsMachinesWeight).fill("hw-eats") : [])];
  const data: Data = { next: pick(state, pool), budget: 3 + Math.floor(roll(state) * 3), scout: roll(state), search: roll(state) };
  const lines = ["The fight is over and the exit is not where it was. The door you came through opens on a corridor that should be a wall."];
  if (state.navFlag) {
    state.navFlag = false;
    data.revealed = true;
    data.eased = true;
    lines.push("Your corridor marks from last time still line up. You can read this one before you commit.");
  }
  openEvent(state, "hallway", data, lines);
  log(state, "Wrong Hallway: additional encounter unlocked");
}

const HALL_NAMES: Record<string, string> = {
  "hw-maint": "Maintenance Shift",
  "hw-behind": "Something Behind You",
  "hw-salvage": "The Salvage Room",
  "hw-circle": "Circular Route",
  "hw-eats": "The Hallway That Eats Machines",
};

function openSub(state: GameState) {
  const prev = state.event!.data;
  const id = String(prev.next);
  const eased = !!prev.eased;
  const data: Data = { eased, budget: prev.budget };
  const lines: string[] = [];
  switch (id) {
    case "hw-maint":
      Object.assign(data, { alarm: roll(state), redirect: roll(state), ally: chance(state, 0.3) });
      lines.push("A bay of construction machinery wakes as you enter. Three builder drones: one welding a doorframe, one trying to repair a dead security mech, one polishing a floor that is already clean.");
      if (hasAlly(state, "builder")) lines.push("Your own Builder Drone chirps. Two of them chirp back.");
      if (inDeck(state, "LEECH")) lines.push("The drone nearest you notices the Leech on your rig and backs away.");
      break;
    case "hw-behind":
      Object.assign(data, { kind: damagedEnemy(state), hide: roll(state), walker: Math.floor(roll(state) * 4) });
      lines.push("Heavy footsteps. Servo noise. Nothing in front of you. It is coming from the way you came.");
      break;
    case "hw-salvage":
      Object.assign(data, { minor: chance(state, 0.3), drone: chance(state, 0.65) });
      lines.push("A chamber of disassembled industrial machines, sorted by size. One cache has not been touched. It sits under a defense mount that is not moving.");
      break;
    case "hw-circle":
      Object.assign(data, { kind: state.lastKilled && state.lastKilled !== "rifleman" ? state.lastKilled : "light", inspect: chance(state, 0.6), drone: chance(state, 0.5) });
      lines.push("The corridor ends at the door you entered by. Same scorch marks. Same wreck positions. Something that looks like what you just killed is standing in it, wearing the same damage.");
      break;
    case "hw-eats":
      Object.assign(data, { hostile: chance(state, 0.3), extract: roll(state) });
      lines.push("The Builder Drone finds a signal behind a false wall. Inside: a cavity packed with dismantled construction machines. Several are still running. Others are crusted with dormant salvage parasites.", "Your drone is talking to them.");
      if (allies(state, "builder").some((b) => b.variant === "possessed") && chance(state, 0.5)) {
        data.hostile = true;
        lines.push("The Possessed Builder is already inside, waking things up.");
      }
      break;
  }
  state.event = { id, data, lines };
  log(state, `Wrong Hallway: ${HALL_NAMES[id]}.`);
}

// ---------- views ----------

export function eventView(state: GameState): EventView | null {
  const ev = state.event;
  if (!ev) return null;
  if (isStory(ev.id)) return storyView(state);
  const d = ev.data;
  const en = (n: number) => canPayEnergy(state, n, true);
  const builder = allies(state, "builder")[0];
  const leech = inDeck(state, "LEECH");
  const badge = inDeck(state, "BADGE");
  const o: Option[] = [];
  let title = "";

  switch (ev.id) {
    case "scared":
      title = SCARED_STORY.title;
      o.push(opt("accept", SCARED_STORY.option, "Gain a Scared Mech ally. It draws fire and shoots when it dares.", freeFriendSlot(state) >= 0));
      o.push(opt("leave", "Leave it", "Walk on alone."));
      return { title, lines: [SCARED_STORY.hook, ...ev.lines], options: o };
    case "choice": {
      title = "The hall offers something";
      const defs = state.choiceShown.map((id) => CHOICES.find((c) => c.id === id)!);
      for (const c of defs) o.push(opt(c.id, c.title, c.blurb));
      o.push(opt("NONE", "Keep moving", "Leave it. The room stays what the path promised."));
      return { title, lines: [...defs.map((c) => c.hook), ...ev.lines], options: o };
    }
    case "remembers":
      title = "The Drone Remembers";
      o.push(opt("follow", "Follow the Drone", "A short detour. Salvage, parts, a device, or something that should have stayed off. The drone is exposed."));
      o.push(opt("recall", "Recall the Drone", "Keep the ally. Lose whatever is behind the hatch."));
      o.push(opt("alone", "Let it investigate alone", "It misses the next fight, then comes back with salvage, damage, or a longer delay. It always comes back."));
      break;
    case "patient": {
      title = "The Patient Machine";
      const h = RULES.patientHostile;
      const mod = d.badge ? "badge accepted, risk halved" : "";
      o.push(opt("repair", "Repair the Patient", `2 Scrap. Temporary ally, 6 HP / 2, for ${RULES.patientRooms} fights. ${d.seen ? (d.hRepair ? "The Walker saw live weapons relays. It WILL wake hostile." : "The Walker saw nothing live. Safe.") : `${pct(h.repair)} it wakes hostile.`} ${mod}`, state.scrap >= 2 && freeFriendSlot(state) >= 0));
      if (builder) o.push(opt("repair-drone", "Have the Builder Drone repair it", "No Scrap. The drone works slowly and skips its next two jobs. Same risk.", freeFriendSlot(state) >= 0));
      o.push(opt("strip", "Strip it for parts", `+4 Scrap${hasAlly(state, "shepherd") ? " (+1, Shepherd)" : ""}, 35% a component card. ${pct(h.strip)} its defenses wake. ${mod}`));
      if (!d.inspected) o.push(opt("inspect", "Inspect its memory", `1 Energy. A clue, a cache, or a warning. ${pct(h.inspect)} a defensive routine wakes.`, en(1)));
      if (badge && !d.badge) o.push(opt("badge", "Show the Faulty Access Badge", "Authorized diagnostic access: halves the chance it wakes hostile. Then a security check."));
      if (hasAlly(state, "walker") && !d.seen) o.push(opt("walker", "Send the Ceiling Walker up", "It inspects the overhead cabling and reports whether a repair is safe."));
      o.push(opt("leave", "Leave it alone", "No reward. No risk."));
      break;
    }
    case "yard":
      title = "The Assembly Yard";
      o.push(opt("scavenge", "Scavenge the Yard", `+3 Scrap${hasAlly(state, "shepherd") ? " (+1, Shepherd)" : ""}. ${d.safe ? "Authorized: safe." : "35% a defense machine joins the next fight."}`));
      if (inDeck(state, "WARFRAME") && !state.preCommission) o.push(opt("commission", "Commission a Warframe", `1 Scrap. Your next Warframe deploys at 1/2 startup. ${d.safe ? "Authorized: no check." : "25% a security check."}`, state.scrap >= 1));
      o.push(opt("power", "Restore station power", `2 Scrap. The arms repair Jubey 1 and every machine 2. ${d.safe ? "Authorized: safe." : "25% something unwanted powers up too."}`, state.scrap >= 2));
      o.push(opt("sabotage", "Sabotage the Yard", "Kill the power. Nothing here wakes up. −1 Threat. No rewards."));
      if (badge && !d.safe) o.push(opt("badge", "Use false authorization", "The station treats you as staff: the other options become safe. Then a security check."));
      o.push(opt("leave", "Leave", "Keep what you have."));
      break;
    case "hallway": {
      title = "Wrong Hallway";
      const lines = [...ev.lines];
      if (d.revealed) lines.push(`Ahead: ${HALL_NAMES[String(d.next)]}.`);
      o.push(opt("force", "Force the Exit", `${RULES.forceExitEnergy} Energy. Skip what is ahead. +${RULES.forceExitScrap} Scrap only.`, en(RULES.forceExitEnergy)));
      o.push(opt("search", "Search the Walls", d.searched ? "Already searched." : `${pct(RULES.searchFind)}: +${RULES.searchScrap} Scrap. Otherwise a hazard or an alert. You still have to pick a way out.`, !d.searched));
      o.push(opt("follow", "Follow the Noise", "Commit to whatever is ahead. Full danger, full reward."));
      if (builder) o.push(opt("scout", "Send the Builder Drone", d.scouted ? "Already sent." : "40% safe look ahead, 25% salvage, 20% it gets separated, 15% it finds something bad.", !d.scouted));
      o.push(opt("mark", "Mark the Corridor", d.marked ? "Marked." : "Next Wrong Hallway: see what is ahead first, and it starts easier. Does not stack.", !d.marked && !state.navFlag));
      if (badge && !d.badged) o.push(opt("badge", "Try the badge reader", "Tells you which route is real: reveals what is ahead. Then a security check."));
      return { title, lines, options: o };
    }
    case "hw-maint":
      title = HALL_NAMES[ev.id];
      o.push(opt("sneak", "Remain Unnoticed", `+1 Scrap from the floor. ${leech ? "25%" : "15%"} an alarm trips.`));
      o.push(opt("redirect", "Redirect the Drones", `1 Scrap. ${badge ? "85%" : "60%"} they repair Jubey and your machines for 2. Otherwise a machine wakes.`, state.scrap >= 1));
      o.push(opt("dismantle", "Dismantle the Drones", "+3 Scrap. The other two turn on you: fight 2 Drones."));
      o.push(opt("assist", "Assist Maintenance", "2 Scrap. Finish their repair: +4 Scrap cache, and maybe one follows you.", state.scrap >= 2));
      break;
    case "hw-behind":
      title = HALL_NAMES[ev.id];
      o.push(opt("ambush", "Prepare an Ambush", "You get +1 Energy on turn 1 and it enters stunned."));
      o.push(opt("scan", "Scan the Hallway", "Learn what it is and where it is hurt: it takes +1 from everything."));
      o.push(opt("move", "Keep Moving", "Spend nothing. It gets the first shot."));
      o.push(opt("hide", "Hide", `${inDeck(state, "QUIET") ? "75%" : "50%"} it walks past. Otherwise it gets the first shot.`));
      if (hasAlly(state, "walker")) o.push(opt("walker", "Send the Ceiling Walker", "It scouts from above: an ambush, a weak point, a way around, or it gives you away."));
      break;
    case "hw-salvage":
      title = HALL_NAMES[ev.id];
      o.push(opt("all", "Take Everything", `+${d.budget} Scrap. The defense mount wakes: fight it.`));
      o.push(opt("little", "Take a Little", "+2 Scrap. 30% a minor hazard."));
      o.push(opt("none", "Leave It Alone", "+1 Scrap from loose debris. Nothing wakes."));
      if (builder) o.push(opt("drone", "Use the Builder Drone", `65% it finds the trap: +${Number(d.budget) - 1} Scrap, no fight. Otherwise the mount wakes on the drone.`));
      if (leech) o.push(opt("leech", "Plant the Salvage Leech", `Attach it to the dormant mount for free, then take everything: +${d.budget} Scrap and a fight with the Leech already on.`));
      break;
    case "hw-circle":
      title = HALL_NAMES[ev.id];
      o.push(opt("fight", "Fight the Apparition", "Put it down again. +1 Scrap."));
      o.push(opt("inspect", "Inspect the Environment", "60% you find the seam and step through. Otherwise you only weaken it."));
      o.push(opt("mark", "Mark the Entrance", "It enters stunned and hurt. Uses your corridor marks if you have them.", true));
      if (builder) o.push(opt("drone", "Use the Builder Drone", "50% it finds a maintenance hatch: skip the fight, +1 Scrap."));
      if (leech) o.push(opt("leech", "Use the Leech", "Fight it with the Leech already attached, free."));
      break;
    case "hw-eats": {
      title = HALL_NAMES[ev.id];
      const b = builder?.variant;
      o.push(opt("harvest", "Harvest the Machines", `+${b === "scavenger" ? 5 : 4} Scrap. The parasites wake: fight an infested defense unit${leech?.variant === "queen" ? " and a Drone the Queen provokes" : ""}.`));
      o.push(opt("reactivate", "Reactivate the Machinery", `2 Scrap. A temporary Builder Drone joins you. ${d.hostile ? "Something else is already stirring." : "30% a damaged machine wakes too."}`, state.scrap >= 2 && freeFriendSlot(state) >= 0));
      o.push(opt("extract", "Extract the Parasites", `${b === "awake" ? "80%" : "60%"} a spare Leech for the next room. Otherwise one gets into your drone.`));
      o.push(opt("seal", "Seal the Cavity", `${inDeck(state, "FOAM") || inDeck(state, "COFFIN") ? "Foam it shut, no cost" : "1 Energy"}. +2 Scrap, nothing wakes.`, !!inDeck(state, "FOAM") || !!inDeck(state, "COFFIN") || en(1)));
      o.push(opt("retreat", "Retreat", "Back to the corridor. This will not be offered again."));
      break;
    }
  }
  return { title, lines: ev.lines, options: o };
}

// ---------- resolution ----------

function attachFreeLeech(state: GameState, host: Unit | undefined) {
  const card = inDeck(state, "LEECH");
  if (!card || !host) return;
  removeFromPiles(state, card.uid);
  host.leech = { cardUid: card.uid, variant: card.variant === "symbiotic" ? undefined : card.variant, count: 0, stripped: false, firedTurn: false };
  log(state, `The Leech is already on the ${label(host.kind)} when it wakes.`);
}

function applyChoice(state: GameState, id: ChoiceId | "NONE") {
  const def = CHOICES.find((c) => c.id === id);
  if (!def) {
    log(state, "Keep moving.");
    return;
  }
  log(state, def.take);
  switch (def.id) {
    case "CHOICE_SCRAP_BAIT":
      state.scrap += 2;
      if (chance(state, 0.5)) {
        state.pendingInfested += 1;
        log(state, "The ticking becomes a body. Extra Infested this room.");
      }
      break;
    case "CHOICE_ROCKET_MADNESS":
      state.madness += 2;
      giveRocketAmmo(state, 1);
      log(state, `Madness ${state.madness}.`);
      break;
    case "CHOICE_COOLANT_SIPHON":
      repair(state, jubey(state), 1, "Coolant");
      state.threat += 1;
      break;
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
      break;
    case "CHOICE_FLARE_CHARGE":
      state.bonusEnergy += 1;
      state.extraNightmare += 0.25;
      break;
  }
}

function patientWakes(state: GameState, repairable: boolean) {
  state.pendingSpawn.push("patient");
  set(state, "woke", true);
  if (repairable) state.patientRepairable = true;
  say(state, "The cradle clamps blow. Its combat systems come up before its judgment does. It will be waiting in the next room.");
  if (repairable) log(state, "If you can stun, foam or seal it, it may still stabilize.");
}

export function resolveEvent(state: GameState, option: string, flow: Flow) {
  const ev = state.event;
  if (!ev) return;
  if (isStory(ev.id)) return resolveStory(state, option, flow);
  const view = eventView(state);
  const chosen = view?.options.find((x) => x.id === option);
  if (!chosen || !chosen.enabled) return;
  const d = ev.data;
  const builder = allies(state, "builder")[0];
  const closeHall = () => {
    state.event = null;
    flow.continueHall(state);
  };
  const closeRoom = () => {
    state.event = null;
    flow.finishRoom(state);
  };
  const fight = (kinds: UnitKind[], setup?: (s: GameState, foes: Unit[]) => void) => {
    state.event = null;
    flow.startExtension(state, kinds, setup);
  };
  const eased = (foes: Unit[]) => {
    if (d.eased) for (const f of foes) f.hp = Math.max(1, f.hp - 2);
  };

  switch (ev.id) {
    case "scared":
      if (option === "accept") {
        spawn(state, "scared", "friendly", freeFriendSlot(state));
        log(state, SCARED_STORY.take);
      } else log(state, "You leave it shaking in the smoke.");
      return closeHall();

    case "choice":
      applyChoice(state, option as ChoiceId | "NONE");
      state.choiceShown = [];
      return closeHall();

    case "remembers": {
      if (!builder) return closeHall();
      if (option === "follow") {
        const r = Number(d.follow);
        if (r === 0) addScrap(state, 2, "Behind the hatch: a sorted parts bin");
        else if (r === 1) {
          state.rs += 1;
          log(state, "Behind the hatch: an intact reactor coupling. +1 RS.");
        } else if (r === 2) {
          addCard(state, "GUNNEST");
          log(state, "Behind the hatch: an unfinished device on a workbench. The drone finishes it. Gun Nest added to the deck.");
        } else {
          state.threat += 1;
          builder.hp = Math.max(1, builder.hp - 2);
          log(state, `Behind the hatch: a system that should have stayed off. The drone is burned (${builder.hp}/${builder.maxHp}). Threat ${state.threat}.`);
        }
      } else if (option === "recall") log(state, "The drone comes back. It looks at the hatch once more.");
      else {
        builder.away = 1;
        builder.note = ["ret-salvage", "ret-damaged", "ret-late"][Number(d.alone)];
        log(state, "The drone squeezes through the hatch and is gone. It will find you.");
      }
      return closeHall();
    }

    case "patient": {
      const half = (key: string) => {
        if (d[key] && chance(state, 0.5)) d[key] = false;
      };
      if (option === "badge") {
        set(state, "badge", true);
        half("hRepair");
        half("hStrip");
        half("hInspect");
        say(state, "The cradle reads the badge and opens a maintenance menu.");
        badgeCheck(state);
        return;
      }
      if (option === "walker") {
        set(state, "seen", true);
        say(state, d.hRepair ? "The Walker taps twice on a live weapons relay." : "The Walker traces every cable and finds nothing live.");
        return;
      }
      if (option === "inspect") {
        payEnergy(state, 1, true);
        set(state, "inspected", true);
        if (d.hInspect) {
          patientWakes(state, false);
          return closeHall();
        }
        const m = Number(d.memory);
        if (m === 0) {
          state.revealNext = true;
          state.navFlag = true;
          say(state, "A route record survives. You know the next room, and you can read the next wrong corridor.");
        } else if (m === 1) {
          state.revealNext = true;
          say(state, "A patrol log. You know what is in the next room.");
        } else if (m === 2) addScrap(state, 2, "A maintenance cache is listed two panels down");
        else if (m === 3) {
          state.navFlag = true;
          say(state, "A warning about corridors that do not stay put. You will read the next one.");
        } else {
          d.hRepair = false;
          say(state, "A stabilization procedure, intact. A repair is now safe.");
        }
        return;
      }
      if (option === "repair" || option === "repair-drone") {
        if (option === "repair") state.scrap -= 2;
        else if (builder) builder.timer = (builder.timer ?? RULES.builderInterval) + 2 * RULES.builderInterval;
        if (d.hRepair) {
          patientWakes(state, true);
          return closeHall();
        }
        const p = spawn(state, "patient", "friendly", freeFriendSlot(state), { roomsLeft: RULES.patientRooms });
        log(state, `The Patient Machine stands (${p.hp} HP / ${p.atk}). Its screen says THANK YOU. Then OPERATOR? It follows you for ${RULES.patientRooms} fights.`);
        return closeHall();
      }
      if (option === "strip") {
        if (d.hStrip) {
          addScrap(state, 2, "You get two plates off before it moves");
          patientWakes(state, false);
          return closeHall();
        }
        addScrap(state, 4 + (hasAlly(state, "shepherd") ? 1 : 0), "Stripped the Patient Machine");
        if (d.part) {
          const id = pick(state, REWARD_POOL.filter((c) => CARDS[c].rarity === "uncommon"));
          addCard(state, id);
          log(state, `One component is worth keeping whole: ${CARDS[id].name} added to the deck.`);
        }
        return closeHall();
      }
      log(state, "You leave. Behind you the screen changes to WAITING.");
      return closeHall();
    }

    case "yard": {
      if (option === "badge") {
        set(state, "safe", true);
        d.hScav = d.hComm = d.hPower = false;
        say(state, "The station logs you in as night shift.");
        badgeCheck(state);
        return;
      }
      if (option === "scavenge") {
        addScrap(state, 3 + (hasAlly(state, "shepherd") ? 1 : 0), "Scavenged the Yard");
        if (d.hScav) {
          state.pendingSpawn.push("drone");
          log(state, "A salvage-defense unit detaches from the ceiling and follows you out.");
        }
      } else if (option === "commission") {
        state.scrap -= 1;
        state.preCommission = true;
        log(state, "The assembly arms do half a startup sequence on your Warframe's core.");
        if (d.hComm) badgeCheck(state, true);
      } else if (option === "power") {
        state.scrap -= 2;
        repair(state, jubey(state), 1, "Assembly arms");
        for (const a of allies(state)) repair(state, a, 2, "Assembly arms");
        if (d.hPower) {
          state.pendingSpawn.push("light");
          log(state, "Something else on the line powers up with the station. It will be in the next room.");
        }
      } else if (option === "sabotage") {
        state.threat = Math.max(0, state.threat - 1);
        log(state, `You cut the coupling. The Yard goes dark for good. Threat ${state.threat}.`);
      } else log(state, "You leave the Yard as you found it.");
      return closeHall();
    }

    case "hallway": {
      if (option === "force") {
        payEnergy(state, RULES.forceExitEnergy, true);
        addScrap(state, RULES.forceExitScrap, "You cut the lock and take what is by the door");
        return closeRoom();
      }
      if (option === "search") {
        set(state, "searched", true);
        if (Number(d.search) < RULES.searchFind) addScrap(state, RULES.searchScrap, "Behind a loose panel");
        else if (Number(d.search) < 0.8) {
          say(state, "A panel comes away live.");
          deal(state, jubey(state), 1, "Arcing panel", { noLeech: true });
        } else {
          state.threat += 1;
          say(state, `The panel was a sensor. Threat ${state.threat}.`);
        }
        return;
      }
      if (option === "mark") {
        set(state, "marked", true);
        state.navFlag = true;
        say(state, "You score the wall and log the geometry. Next time you will know.");
        return;
      }
      if (option === "badge") {
        set(state, "badged", true);
        set(state, "revealed", true);
        say(state, "The reader lists one real route.");
        badgeCheck(state);
        return;
      }
      if (option === "scout" && builder) {
        set(state, "scouted", true);
        const r = Number(d.scout);
        const s = RULES.scout;
        if (r < s.safe) {
          set(state, "revealed", true);
          set(state, "eased", true);
          say(state, "The drone comes back with a clean look ahead.");
        } else if (r < s.safe + s.salvage) addScrap(state, 2, "The drone comes back dragging salvage");
        else if (r < s.safe + s.salvage + s.separated) {
          builder.away = 1;
          builder.note = "ret-late0";
          say(state, "The corridor closes behind the drone. It will find its own way back after the next fight.");
        } else {
          state.threat += 1;
          builder.hp = Math.max(1, builder.hp - 1);
          say(state, `The drone finds a live maintenance system and wakes it. It comes back singed. Threat ${state.threat}.`);
        }
        return;
      }
      if (option === "follow") return openSub(state);
      return;
    }

    case "hw-maint": {
      if (option === "sneak") {
        addScrap(state, 1, "Loose debris");
        if (Number(d.alarm) < (inDeck(state, "LEECH") ? 0.25 : 0.15)) {
          log(state, "One drone looks up. Then all of them do.");
          return fight(["drone"], (_s, f) => eased(f));
        }
        log(state, "The welder never looks up.");
        return closeRoom();
      }
      if (option === "redirect") {
        state.scrap -= 1;
        if (Number(d.redirect) < (inDeck(state, "BADGE") ? 0.85 : 0.6)) {
          repair(state, jubey(state), 2, "Maintenance drones");
          for (const a of allies(state)) repair(state, a, 2, "Maintenance drones");
          return closeRoom();
        }
        log(state, "They finish the repair they were already doing. The dead security mech sits up.");
        return fight(["light"], (s, f) => {
          applyDamage(s, f[0]);
          eased(f);
        });
      }
      if (option === "dismantle") {
        addScrap(state, 3, "Dismantled a maintenance drone");
        return fight(["drone", "drone"], (_s, f) => eased(f));
      }
      state.scrap -= 2;
      addScrap(state, 4, "The finished repair opens a parts cache");
      if (d.ally && freeFriendSlot(state) >= 0) {
        addCard(state, "BUILDER");
        log(state, "The floor-polishing drone follows you out. Builder Drone added to the deck.");
      }
      return closeRoom();
    }

    case "hw-behind": {
      const kind = d.kind as UnitKind;
      const base = (s: GameState, f: Unit[]) => {
        applyDamage(s, f[0]);
        eased(f);
        log(s, `It is a ${label(kind)} with ${f[0].note}.`);
      };
      if (option === "walker") {
        const r = Number(d.walker);
        if (r === 2) {
          addScrap(state, 1, "The Walker finds a crawlway around it");
          return closeRoom();
        }
        option = ["ambush", "scan", "", "move"][r];
        log(state, ["The Walker pins its position from above.", "The Walker spots where it is hurt.", "", "The Walker's grip slips. It heard that."][r]);
      }
      if (option === "hide") {
        if (Number(d.hide) < (inDeck(state, "QUIET") ? 0.75 : 0.5)) {
          log(state, "It passes close enough to hear its coolant pump. It does not turn.");
          return closeRoom();
        }
        option = "move";
      }
      if (option === "ambush") {
        state.firstStrike = true;
        return fight([kind], (s, f) => {
          base(s, f);
          f[0].stunned = 1;
        });
      }
      if (option === "scan") {
        return fight([kind], (s, f) => {
          base(s, f);
          f[0].weak = true;
        });
      }
      state.enemyInitiative = true;
      return fight([kind], base);
    }

    case "hw-salvage": {
      const budget = Number(d.budget);
      if (option === "none") {
        addScrap(state, 1, "Loose debris");
        return closeRoom();
      }
      if (option === "little") {
        addScrap(state, 2, "A careful handful");
        if (d.minor) deal(state, jubey(state), 1, "Tripwire charge", { noLeech: true });
        return closeRoom();
      }
      if (option === "drone" && builder) {
        if (d.drone) {
          addScrap(state, budget - 1, "The drone sorts the cache around the trigger plate");
          return closeRoom();
        }
        addScrap(state, 2, "The drone grabs what it can");
        log(state, "The defense mount wakes on the drone.");
        deal(state, builder, 2, "Defense mount", { noLeech: true });
        return fight(["lvl2"], (s, f) => {
          applyDamage(s, f[0]);
          eased(f);
        });
      }
      addScrap(state, budget, "You take the whole cache");
      return fight(["lvl2"], (s, f) => {
        applyDamage(s, f[0]);
        eased(f);
        if (option === "leech") attachFreeLeech(s, f[0]);
      });
    }

    case "hw-circle": {
      const kind = d.kind as UnitKind;
      const shell = (_s: GameState, f: Unit[]) => {
        const u = f[0];
        u.temp = true; // an apparition: no drops, no wreck
        u.note = "an apparition";
        u.hp = Math.max(2, Math.ceil(u.maxHp / 2));
        u.missiles = 0;
        eased(f);
      };
      if (option === "inspect" && d.inspect) {
        log(state, "The scorch marks are mirrored. You step through the seam and the room lets go.");
        return closeRoom();
      }
      if (option === "drone" && d.drone) {
        addScrap(state, 1, "The drone opens a maintenance hatch that was not there before");
        return closeRoom();
      }
      state.pendingScrap += 1;
      return fight([kind], (s, f) => {
        shell(s, f);
        if (option === "inspect") f[0].hp = Math.max(1, f[0].hp - 2);
        if (option === "mark") {
          s.navFlag = false;
          f[0].stunned = 1;
          f[0].hp = Math.max(1, f[0].hp - 1);
        }
        if (option === "leech") attachFreeLeech(s, f[0]);
      });
    }

    case "hw-eats": {
      if (option === "retreat") {
        state.event = { id: "hallway", data: { next: pick(state, HALL_EVENTS), budget: d.budget, searched: true, scouted: true, marked: true, badged: true, scout: 1, search: 1 }, lines: ["You back out and the false wall closes. The corridor is still wrong."] };
        return;
      }
      if (option === "seal") {
        if (!inDeck(state, "FOAM") && !inDeck(state, "COFFIN")) payEnergy(state, 1, true);
        addScrap(state, 2, "You seal the cavity and take what was outside it");
        return closeRoom();
      }
      if (option === "harvest") {
        addScrap(state, builder?.variant === "scavenger" ? 5 : 4, "Harvested the machines");
        const queen = inDeck(state, "LEECH")?.variant === "queen";
        return fight(queen ? ["infested", "drone"] : ["infested"], (_s, f) => eased(f));
      }
      if (option === "extract") {
        if (Number(d.extract) < (builder?.variant === "awake" ? 0.8 : 0.6)) {
          addCard(state, "LEECH", { expires: state.room + 1 });
          log(state, "You peel one parasite off whole. A spare Salvage Leech, good for the next room.");
        } else if (builder) {
          builder.jammed = true;
          log(state, "One wakes in your hand and goes into the Builder Drone's casing.");
          deal(state, builder, 1, "Parasite", { noLeech: true });
        }
        return closeRoom();
      }
      // reactivate
      state.scrap -= 2;
      if (inDeck(state, "LEECH")?.variant === "symbiotic") addScrap(state, 1, "The Symbiotic Leech feeds on the maintenance signal");
      const helper = spawn(state, "builder", "friendly", freeFriendSlot(state), { temp: true, timer: 1 });
      log(state, "A second Builder Drone unfolds from the pile and falls in behind yours.");
      if (d.hostile) {
        log(state, "So does something else.");
        return fight([damagedEnemy(state)], (s, f) => {
          applyDamage(s, f[0]);
          eased(f);
        });
      }
      const hurt = [jubey(state), ...allies(state)].filter((u): u is Unit => !!u && u.hp < u.maxHp).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      if (hurt) repair(state, hurt, RULES.builderPatch, "The borrowed Builder Drone");
      state.units = state.units.filter((u) => u.uid !== helper.uid);
      log(state, "With nothing left to fix, it folds itself back into the pile.");
      return closeRoom();
    }
  }
}

