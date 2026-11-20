// The pilot brief's three choice encounters: an empty-cockpit mech, suspicious
// cargo up a ladder, and a fleeing pilot. Every roll happens when the event
// opens and is stored in event.data, so reopening never rerolls anything.

import { log, roll, chance, pick, addScrap, allies, freeFriendSlot, living, canPayEnergy } from "./core";
import { FLEE_STORIES, FRAME_FAULTS, ITEMS, ALLY_ITEMS, CAPTIVE_ITEMS, PR, SPECS, type Chassis, type Spec } from "./pilots-data";
import {
  BAND_NAMES,
  assign,
  band,
  exposure,
  frameText,
  gainXp,
  has,
  makeFleeing,
  medkitCharge,
  newItem,
  rec,
  rollParts,
  shiftLoyalty,
  skillFor,
  spawnFrame,
} from "./pilots";
import type { EventView, Flow, Option } from "./events";
import type { GameState, PilotRec } from "./state";
import { setPilot } from "./team";

const IDS = ["mech", "cargo", "fleeing"];
export const isPilotEvent = (id: string) => IDS.includes(id);
const opt = (id: string, name: string, detail: string, enabled = true): Option => ({ id, label: name, detail, enabled });

function open(state: GameState, id: string, data: Record<string, number | string | boolean | string[]>, lines: string[]) {
  state.phase = "event";
  state.energy = state.energyCap;
  state.event = { id, data, lines };
}
function say(state: GameState, line: string) {
  state.event?.lines.push(line);
  log(state, line);
}

/** Pilots you could send somewhere: crew, or captives willing enough. */
export function crew(state: GameState): PilotRec[] {
  return state.roster.filter((r) => r.custody === "ally" || r.custody === "captive");
}
function inFrame(state: GameState, r: PilotRec): boolean {
  return state.units.some((u) => u.kind === "frame" && u.pilot === r.id && u.hp > 0);
}
/** Can this pilot take a frame right now? */
function frameBlock(r: PilotRec): string | null {
  if (r.away > 0) return "separated";
  if (r.hp <= 0) return "down";
  const b = band(r.loyalty);
  if (b <= 1) return "UNWILLING — ASSIGNMENT RESTRICTED";
  if (has(r, "harness")) return "in the Armored Restraint Harness";
  if (r.custody === "captive" && b < 3) return "Partially Willing captives do limited tasks only";
  return null;
}
/** Can this pilot climb a ladder for you? */
function climbBlock(state: GameState, r: PilotRec): string | null {
  if (r.away > 0) return "separated";
  if (r.hp <= 0) return "down";
  if (inFrame(state, r)) return "inside a frame";
  if (band(r.loyalty) <= 1) return "UNWILLING — ASSIGNMENT RESTRICTED";
  if (has(r, "harness")) return "in the Armored Restraint Harness";
  return null;
}
function bestInspect(state: GameState): { skill: number; who: string } {
  let best = { skill: 0, who: "" };
  for (const r of crew(state)) {
    if (r.away > 0 || band(r.loyalty) <= 1) continue;
    const s = skillFor(state, r, "inspect");
    if (s > best.skill) best = { skill: s, who: r.name };
  }
  return best;
}
function bestTech(state: GameState): { skill: number; who: string } {
  let best = { skill: 0, who: "" };
  for (const r of crew(state)) {
    if (r.away > 0 || band(r.loyalty) <= 1) continue;
    const s = skillFor(state, r, "tech");
    if (s > best.skill) best = { skill: s, who: r.name };
  }
  return best;
}
function anyScanner(state: GameState): boolean {
  return state.items.some((x) => x.id === "scanner") || crew(state).some((r) => has(r, "scanner"));
}

// ---------- openers ----------

export function openMech(state: GameState) {
  state.seen.mech = true;
  const r = roll(state);
  const chassis: Chassis = r < 0.4 ? "light" : r < 0.8 ? "medium" : "heavy";
  const damaged = chance(state, PR.frameDamaged);
  const pool = Object.keys(FRAME_FAULTS);
  const faults: string[] = [];
  if (damaged) {
    const n = 1 + (chance(state, 0.5) ? 1 : 0);
    while (faults.length < n) {
      const f = pick(state, pool);
      if (!faults.includes(f)) faults.push(f);
    }
  }
  const lines = ["A maintenance bay. A mech frame stands in the cradle with its cockpit hatch open and nobody in it. The seat is cold."];
  if (damaged) lines.push("Scorch marks run up one leg. A hydraulic line is weeping onto the floor. Something is wrong with it.");
  open(state, "mech", { chassis, damaged, faults, hpLoss: damaged ? 2 + (chance(state, 0.5) ? 1 : 0) : 0, inspected: false, cockpit: false, known: false }, lines);
  log(state, "Empty-Cockpit Mech.");
}

export function openCargo(state: GameState) {
  state.seen.cargo = true;
  const r = roll(state);
  const reward = r < 0.12 ? "parts" : r < 0.4 ? "scrap" : pick(state, chance(state, 0.7) ? ALLY_ITEMS : CAPTIVE_ITEMS);
  const senders = crew(state).map((p) => p.id);
  open(
    state,
    "cargo",
    { gas: chance(state, PR.gasChance), reward, spoil: chance(state, 0.5), stage: "below", known: false, hint: "", refuse: senders.map((id) => (chance(state, 0.5) ? id : "")).filter(Boolean), loss: Math.floor(roll(state) * 1000) },
    ["A storage platform, three metres up a service ladder. One crate on it. The warning label has been torn off; what is left of it is yellow and black."],
  );
  log(state, "Suspicious Cargo Above.");
}

export function openFleeing(state: GameState) {
  state.seen.fleeing = (state.seen.fleeing ?? 0) + 1;
  const r = makeFleeing(state);
  state.roster.push(r);
  open(
    state,
    "fleeing",
    { id: r.id, story: Math.floor(roll(state) * FLEE_STORIES.length), accept: chance(state, PR.fleeingAccept), followed: chance(state, PR.fleeingFollowed), asked: false, helped: false },
    [`Someone comes out of a side corridor at a dead run, in a pilot's suit with no mech around it. They see your rig and stop so hard they nearly fall.`],
  );
  log(state, "Fleeing Pilot.");
}

// ---------- views ----------

function faultLine(d: Record<string, unknown>, state: GameState): string {
  const faults = d.faults as string[];
  if (!d.damaged) return "No damage you can find.";
  if (!d.known) return `Damaged. ${bestInspect(state).skill >= 4 ? "" : "You cannot tell where without Skill 4."}`.trim();
  return faults.map((f) => `${FRAME_FAULTS[f].name}: ${FRAME_FAULTS[f].text}`).join(" ");
}
function repairCost(state: GameState, faults: string[]): number {
  const fixable = faults.filter((f) => f !== "reactor" || bestTech(state).skill >= 8);
  const discount = crew(state).some((r) => r.spec === "Technician" || has(r, "toolkit")) || state.items.some((x) => x.id === "toolkit") ? 1 : 0;
  return Math.max(0, fixable.length * PR.frameRepairScrap - discount);
}

export function pilotEventView(state: GameState): EventView | null {
  const ev = state.event;
  if (!ev) return null;
  const d = ev.data;
  const o: Option[] = [];
  switch (ev.id) {
    case "mech": {
      const chassis = String(d.chassis) as Chassis;
      const faults = d.faults as string[];
      const lines = [...ev.lines];
      if (d.inspected) {
        lines.push(`Inspection: a ${chassis} frame. ${faultLine(d, state)}`);
        const fits = crew(state).filter((r) => SPECS[r.spec as Spec].frames.includes(chassis)).map((r) => r.name);
        lines.push(fits.length ? `Suited to: ${fits.join(", ")}.` : "None of your pilots is trained for this class. Anyone can fly it at −2 Skill.");
      }
      if (d.cockpit) lines.push(faults.includes("seal") ? "Cockpit: the seal is weak. If this frame goes down, its pilot may not get out." : "Cockpit: the ejection system tests clean.");
      if (!d.inspected) o.push(opt("inspect", "Inspect the Frame", `Learn its class, condition and who could fly it.${d.damaged ? " Skill 4 finds the damage." : ""}`));
      if (d.damaged && !d.cockpit) o.push(opt("cockpit", "Inspect Cockpit", "Check whether the ejection system works."));
      if (d.damaged && faults.length) {
        const cost = repairCost(state, faults);
        const reactorStuck = faults.includes("reactor") && bestTech(state).skill < 8;
        o.push(opt("repair", "Repair First", `${cost} Scrap. ${d.known ? "" : "You will find out what was wrong as you go. "}${reactorStuck ? "The reactor needs Skill 8 (Technician helps) or a Builder Drone." : "Fixes everything you can reach."}`, state.scrap >= cost && (!reactorStuck || faults.length > 1)));
        if (allies(state, "builder").length) o.push(opt("repair-drone", "Repair First: Builder Drone", "No Scrap. Fixes every fault, the reactor included. The drone loses its next two jobs."));
      }
      const label = d.damaged && faults.length ? "Pilot immediately" : "Assign";
      const free = freeFriendSlot(state) >= 0;
      for (const r of crew(state)) {
        const block = frameBlock(r);
        const fit = SPECS[r.spec as Spec].frames.includes(chassis) ? "" : " · untrained for this class: −2 Skill";
        const who = r.custody === "captive" ? "cooperative captive" : "crew";
        o.push(opt(`assign:${r.id}`, `${label}: ${r.name}`, block ?? `Lv ${r.level} ${r.spec}, ${who}, Skill ${skillFor(state, r, "combat")}${fit}.${inFrame(state, r) ? " Leaves their current frame." : ""}${r.custody === "captive" ? " Captives in the field may run." : ""}`, !block && free));
      }
      o.push(opt("take", "Take it with you, unpiloted", free ? "It joins your lane, empty. Assign someone later from the crew panel." : "Your lane is full.", free));
      o.push(opt("salvage", d.damaged ? "Strip for Components" : "Salvage", `+${PR.frameSalvage[chassis]} Scrap and a chance at a Cockpit Part.`));
      o.push(opt("leave", "Leave", "Walk past it."));
      return { title: d.damaged ? "Empty-Cockpit Mech (damaged)" : "Empty-Cockpit Mech", lines, options: o };
    }
    case "cargo": {
      const lines = [...ev.lines];
      if (d.hint) lines.push(String(d.hint));
      if (d.stage === "top") {
        const r = rec(state, String(d.sender))!;
        const s = skillFor(state, r, "inspect");
        lines.push(`${r.name} is on the platform. They have found a pressure-release mechanism on the lid.`);
        o.push(opt("careful", "Retrieve it carefully", s >= 8 ? `${r.name} has Skill ${s}: they can get it out without tripping the release.` : `Needs Skill 8 (${r.name} has ${s}). Without it, the release fires.`));
        o.push(opt("open", "Open it anyway", "Accept the risk."));
        o.push(opt("down", "Come back down", "Leave the crate. They learned something."));
        return { title: "Suspicious Cargo Above", lines, options: o };
      }
      if (d.stage === "after") {
        const r = rec(state, String(d.sender));
        const can = r && !!medkitCharge(state, r) && r.custody !== "dead";
        o.push(opt("treat", "Treat them now", can ? "A medkit charge: heal 2 and win back half the trust you lost." : "No medkit charge.", !!can && !d.treated));
        o.push(opt("done", "Move on", ""));
        return { title: "Suspicious Cargo Above", lines, options: o };
      }
      const best = bestInspect(state);
      const scanner = anyScanner(state);
      if (!d.scanned) o.push(opt("below", "Inspect from Below", scanner ? "Portable Scanner: reads whether the crate is pressurized." : best.skill >= 4 ? `${best.who} (Skill ${best.skill}) looks it over. Skill 6 spots a pressure release from here.` : "Needs a Portable Scanner or a pilot with Skill 4.", scanner || best.skill >= 4));
      for (const r of crew(state)) {
        const block = climbBlock(state, r);
        const s = skillFor(state, r, "inspect");
        const checks = s >= 8 ? "Skill 8+: can retrieve it without triggering anything" : s >= 6 ? "Skill 6+: will spot a pressure release" : s >= 4 ? "Skill 4+: reads damaged markings" : "Skill under 4: will just open it";
        const captive = r.custody === "captive" ? " Captive: needs their cooperation." : "";
        if (d.known && d.gas) {
          o.push(opt(`send:${r.id}`, `Ask ${r.name} to go, and tell them`, block ?? `They know it may vent. They may say no.${captive}`, !block));
          o.push(opt(`hide:${r.id}`, `Send ${r.name} without mentioning it`, block ?? "If it vents, they will know you knew.", !block));
        } else o.push(opt(`send:${r.id}`, `Send ${r.name} up`, block ?? `Skill ${s}. ${checks}.${captive}`, !block));
      }
      const drone = allies(state).find((u) => ["builder", "clampjaw", "robobuddy", "possum"].includes(u.kind));
      if (drone) o.push(opt("drone", `Send the ${drone.kind === "robobuddy" ? "Lil Robobuddy" : drone.kind === "possum" ? "Machine Possum" : drone.kind === "clampjaw" ? "Clampjaw" : "Builder Drone"}`, "No pilot at risk. Clumsy: if anything vents, the contents may be ruined."));
      o.push(opt("leave", "Leave the Cargo", "No reward, no risk."));
      return { title: "Suspicious Cargo Above", lines, options: o };
    }
    case "fleeing": {
      const r = rec(state, String(d.id))!;
      const lines = [...ev.lines];
      lines.push(`${r.name}. Level 1 ${r.spec}. ${r.recovering ? "Shaking: something got to them." : "Scared, but steady."}`);
      if (d.asked) lines.push(FLEE_STORIES[Number(d.story)].text);
      const empty = living(state, "friendly").find((u) => u.kind === "frame" && !u.pilot);
      o.push(opt("shelter", "Offer Shelter", d.helped ? "They will come with you." : "They may say yes. They may not trust you."));
      if (!d.asked) o.push(opt("ask", "Ask What Happened", "A short account. Maybe a warning."));
      if (!d.helped) {
        const kit = medkitCharge(state);
        o.push(opt("help", "Provide Medical Help", kit ? "A medkit charge: patch them up and calm them down." : "2 Scrap of field dressings: patch them up and calm them down.", !!kit || state.scrap >= 2));
      }
      if (empty) o.push(opt("assign", "Recruit and Assign Immediately", `Put them straight into your empty ${empty.chassis} frame, Madness and all.`));
      o.push(opt("away", "Send Them Away", "They keep running."));
      return { title: "Fleeing Pilot", lines, options: o };
    }
  }
  return null;
}

// ---------- resolution ----------

function rewardText(id: string): string {
  return id === "scrap" ? "3 Scrap" : id === "parts" ? "a Cockpit Part" : ITEMS[id].name;
}
function giveReward(state: GameState, id: string) {
  if (id === "scrap") addScrap(state, 3, "In the crate");
  else if (id === "parts") {
    state.parts += 1;
    log(state, `In the crate: a Cockpit Part (${state.parts}/${PR.slot4Parts}).`);
  } else {
    state.items.push(newItem(state, id));
    log(state, `In the crate: ${ITEMS[id].name}.`);
  }
}

function vent(state: GameState, r: PilotRec, concealed: boolean, voluntary: boolean) {
  const d = state.event!.data;
  say(state, "The lid comes up and the crate vents: a yellow-green spray, straight into their face. They fall back down half the ladder.");
  const alive = exposure(state, r, PR.gasDamage, "Toxic gas");
  if (!alive) {
    setPilot(state, r.id, "dead");
    say(state, `${r.name} does not get up.`);
  } else {
    const b = band(r.loyalty);
    const range = concealed ? PR.gasLoyalty.concealed : b <= 1 ? PR.gasLoyalty.hostile : b === 2 ? PR.gasLoyalty.pw : PR.gasLoyalty.coop;
    let loss = range[0] + (Number(d.loss) % (range[1] - range[0] + 1));
    if (voluntary) loss = Math.ceil(loss / 3);
    d.lost = loss;
    shiftLoyalty(state, r, -loss, concealed ? "you knew, and sent them anyway" : voluntary ? "they knew the risk" : "you sent them up there");
  }
  if (d.spoil) say(state, `Whatever was in it is ruined.`);
  else giveReward(state, String(d.reward));
  d.stage = "after";
}

export function resolvePilotEvent(state: GameState, option: string, flow: Flow) {
  const ev = state.event;
  const view = pilotEventView(state);
  const chosen = view?.options.find((x) => x.id === option);
  if (!ev || !chosen || !chosen.enabled) return;
  const d = ev.data;
  const hall = () => {
    state.event = null;
    flow.continueHall(state);
  };

  switch (ev.id) {
    case "mech": {
      const chassis = String(d.chassis) as Chassis;
      const faults = d.faults as string[];
      if (option === "inspect") {
        d.inspected = true;
        if (bestInspect(state).skill >= 4 || anyScanner(state)) d.known = true;
        return;
      }
      if (option === "cockpit") {
        d.cockpit = true;
        return;
      }
      if (option === "repair" || option === "repair-drone") {
        if (option === "repair") {
          const cost = repairCost(state, faults);
          state.scrap -= cost;
          d.faults = faults.filter((f) => f === "reactor" && bestTech(state).skill < 8);
          say(state, `You spend ${cost} Scrap on it.${(d.faults as string[]).length ? " The reactor is beyond you." : " It runs clean."}`);
        } else {
          const b = allies(state, "builder")[0];
          b.timer = (b.timer ?? 2) + 4;
          d.faults = [];
          say(state, "The Builder Drone climbs inside and does not come out for a long time. The frame runs clean.");
        }
        d.known = true;
        d.hpLoss = 0;
        return;
      }
      if (option === "salvage") {
        addScrap(state, PR.frameSalvage[chassis], "Stripped the empty frame");
        rollParts(state, `mech:${state.room}:${state.uidSeq}`, "Its cockpit");
        return hall();
      }
      if (option === "leave") return hall();
      const f = spawnFrame(state, chassis, faults, Number(d.hpLoss));
      if (!f) return hall();
      if (option.startsWith("assign:")) {
        const r = rec(state, option.slice(7))!;
        assign(state, r, f.uid);
      } else log(state, `The ${chassis} frame walks out with you, empty.`);
      log(state, frameText(f));
      return hall();
    }

    case "cargo": {
      const sender = rec(state, String(d.sender));
      if (d.stage === "after") {
        if (option === "treat" && sender) {
          const kit = medkitCharge(state, sender)!;
          kit.charges = (kit.charges ?? 1) - 1;
          if (!kit.charges) {
            state.items = state.items.filter((x) => x !== kit);
            for (const r of state.roster) r.slots = r.slots.map((x) => (x === kit ? null : x));
          }
          sender.hp = Math.min(sender.hp + 2, PR.baseHp + 6);
          shiftLoyalty(state, sender, Math.ceil(Number(d.lost ?? 0) / 2), "you treated them straight away");
          d.treated = true;
          return;
        }
        return hall();
      }
      if (d.stage === "top" && sender) {
        if (option === "down") {
          say(state, `${sender.name} comes back down and tells you exactly how that crate was rigged.`);
          gainXp(state, sender, PR.xpInspect, "inspection");
          return hall();
        }
        if (option === "careful" && skillFor(state, sender, "inspect") >= 8) {
          say(state, `${sender.name} pins the release with a screwdriver and lifts the lid a centimetre at a time. Nothing vents.`);
          giveReward(state, String(d.reward));
          gainXp(state, sender, PR.xpInspect, "inspection");
          return hall();
        }
        vent(state, sender, false, true);
        return;
      }
      if (option === "leave") return hall();
      if (option === "below") {
        d.scanned = true;
        const scanner = anyScanner(state);
        const best = bestInspect(state);
        if (scanner || best.skill >= 6) {
          d.known = true;
          d.hint = d.gas ? `${scanner ? "Portable Scanner" : best.who}: the crate is pressurized, and the lid is rigged with a release. It will vent when opened.` : `${scanner ? "Portable Scanner" : best.who}: no pressure in it. It is just a crate.`;
        } else d.hint = `${best.who}: what is left of the label was a hazard marking, not a shipping label. That is all they can tell from down here.`;
        log(state, String(d.hint));
        return;
      }
      if (option === "drone") {
        const drone = allies(state).find((u) => ["builder", "clampjaw", "robobuddy", "possum"].includes(u.kind))!;
        if (d.gas) {
          say(state, "The drone gets the lid up and the crate vents all over it.");
          drone.hp = Math.max(1, drone.hp - 1);
          if (d.spoil) say(state, "Whatever was in it is ruined.");
          else giveReward(state, String(d.reward));
        } else giveReward(state, String(d.reward));
        return hall();
      }
      const [how, id] = option.split(":");
      const r = rec(state, id)!;
      d.sender = r.id;
      const known = !!d.known && !!d.gas;
      if (how === "send" && known && band(r.loyalty) < 3 && (d.refuse as string[]).includes(r.id)) {
        say(state, `${r.name} looks at the crate, looks at you, and says no. ${BAND_NAMES[band(r.loyalty)]} people do not climb toward gas.`);
        return;
      }
      say(state, `${r.name} climbs up.`);
      if (d.gas && !known && skillFor(state, r, "inspect") >= 6) {
        d.stage = "top";
        return;
      }
      if (!d.gas) {
        say(state, `${r.name} gets the lid open. ${rewardText(String(d.reward))}.`);
        giveReward(state, String(d.reward));
        gainXp(state, r, PR.xpInspect, "inspection");
        return hall();
      }
      if (known && how === "send" && skillFor(state, r, "inspect") >= 8) {
        say(state, `${r.name} knows what to look for, pins the release, and lifts the lid slowly. Nothing vents.`);
        giveReward(state, String(d.reward));
        gainXp(state, r, PR.xpInspect, "inspection");
        return hall();
      }
      vent(state, r, how === "hide", how === "send" && known);
      return;
    }

    case "fleeing": {
      const r = rec(state, String(d.id))!;
      const story = FLEE_STORIES[Number(d.story)];
      const followed = () => {
        if (d.followed) {
          state.pendingInfested += 1;
          log(state, "Whatever they were running from is still coming. It will be in your next fight.");
        }
      };
      if (option === "ask") {
        d.asked = true;
        say(state, story.text);
        if (story.effect === "nav") state.navFlag = true;
        if (story.effect === "reveal") state.revealNext = true;
        if (story.effect === "infested" && d.followed) say(state, "They keep looking back. It is following them.");
        return;
      }
      if (option === "help") {
        const kit = medkitCharge(state);
        if (kit) {
          kit.charges = (kit.charges ?? 1) - 1;
          if (!kit.charges) {
            state.items = state.items.filter((x) => x !== kit);
            for (const p of state.roster) p.slots = p.slots.map((x) => (x === kit ? null : x));
          }
        } else state.scrap -= 2;
        d.helped = true;
        r.hp = PR.baseHp + Math.floor((r.base.endurance + r.earned.endurance) / 2);
        r.recovering = Math.max(0, r.recovering - 4);
        r.loyalty = Math.min(100, r.loyalty + 10);
        say(state, `${r.name} sits against the wall while you work. Their breathing slows down.`);
        return;
      }
      if (option === "away") {
        say(state, `${r.name} nods once and keeps running.`);
        followed();
        return hall();
      }
      if (!d.helped && !d.accept) {
        say(state, `${r.name} backs away from the rig. “No. No, I don't know you.” They are gone down the corridor.`);
        followed();
        return hall();
      }
      r.custody = "ally";
      r.history = ["Joined your crew after you found them running.", ...r.history];
      log(state, `${r.name} joins your crew. Loyalty ${BAND_NAMES[band(r.loyalty)]}${r.recovering ? `, Madness ${r.recovering}% and fading` : ""}.`);
      if (option === "assign") {
        const empty = living(state, "friendly").find((u) => u.kind === "frame" && !u.pilot)!;
        assign(state, r, empty.uid);
      }
      followed();
      return hall();
    }
  }
}

void canPayEnergy;
