// Events added by briefs 3 and 4: custody after a fight, the Relay Section R-8
// story (recovery attempt, the Brawler, Cut the Relay, the flying pod,
// negotiation), and The Prisoner That Repairs Itself.

import { CARDS, REWARD_POOL, RULES } from "./data";
import { addCard, addScrap, allies, canPayEnergy, chance, deal, freeFriendSlot, hasAlly, inDeck, jubey, log, payEnergy, pick, roll, spawn } from "./core";
import { PILOTED, rollParts } from "./pilots";
import { dismantleValue, freeClampjaw, integrityBand, loseCaptive, podFits, resolveTap, takeCaptive, vacantPod, type TapChoice } from "./capture";
import type { EventView, Flow, Option } from "./events";
import type { GameState } from "./state";
import { advanceEpisode, deploy, introduce, pilotByRole, radio, recoveryUp, say, setPilot, withdraw } from "./team";
import { CALLSIGN, INTENT_TELL, type Intent, type Role } from "./team-text";

const IDS = ["custody", "r8-recovery", "r8-brawler", "r8-relay", "r8-pod", "r8-talk", "prisoner"];
export const isStory = (id: string) => IDS.includes(id);

const opt = (id: string, name: string, detail: string, enabled = true): Option => ({ id, label: name, detail, enabled });

function open(state: GameState, id: string, data: Record<string, number | string | boolean | string[]> = {}, lines: string[] = []) {
  state.phase = "event";
  state.energy = state.energyCap;
  state.event = { id, data, lines };
}
function note(state: GameState, line: string) {
  state.event?.lines.push(line);
  log(state, line);
}

// ---------- openers ----------

export function openCustody(state: GameState) {
  open(state, "custody", {}, ["The shooting has stopped. What you restrained is still here."]);
}

export function openRecovery(state: GameState) {
  introduce(state);
  radio(state, "ep2-recovery");
  open(state, "r8-recovery", {}, [
    "Ahead, a six-legged industrial frame is working a wreck with its winches. It is not salvaging. It is looking for someone.",
    "The Gantry Widow has not seen you yet.",
  ]);
}
export function openBrawler(state: GameState) {
  introduce(state);
  radio(state, "ep3-brawler");
  open(state, "r8-brawler", {}, [
    "Something broad-shouldered is standing in the next junction with its fists already up. It has been sent to stop you, or it sent itself.",
  ]);
}
export function openRelay(state: GameState) {
  introduce(state);
  const t = state.team;
  const lines = ["Every R-8 transmission you have heard has been routed through one machine. It is close. Tall silhouette, relay fins, teal sensors, thin armor."];
  if (t.knownRoute) lines.push("You have their recovery route. You know where Bishop will stop moving.");
  if (t.bishopExposed) lines.push("The Brawler is still chasing the false trail you left it.");
  if (t.networkCut) lines.push("With the relay down, Bishop is shouting into individual radios.");
  open(state, "r8-relay", {}, lines);
  log(state, "Cut the Relay.");
}
export function openPod(state: GameState) {
  state.team.podEscaped = false;
  open(state, "r8-pod", { walker: roll(state) }, [
    "A teal running light crosses the ceiling of the next hall. The command pod is still in the air, still transmitting, looking for somewhere to set down.",
  ]);
  log(state, "Hunt the Flying Cockpit.");
}
export function openTalk(state: GameState) {
  state.team.talked = true;
  radio(state, "bishop-leverage");
  open(state, "r8-talk", {}, ["The channel opens on its own. Bishop is not asking for a ceasefire. Bishop is asking a question."]);
}

function nextIntent(state: GameState): Intent {
  const d = state.event!.data;
  const hot = Number(d.stage) >= 3 || Number(d.integrity) <= 40;
  const canTrap = !!inDeck(state, "MEMTAP") && !d.tapped;
  const w: [Intent, number][] = hot
    ? [["desperate", 40], ["break", 40], ["repair", 20]]
    : [["repair", canTrap ? 35 : 45], ["break", 25], ["rest", 15], ["feign", 15], ["trap", canTrap ? 10 : 0]];
  let r = roll(state) * w.reduce((n, x) => n + x[1], 0);
  for (const [intent, weight] of w) if ((r -= weight) < 0) return intent;
  return "repair";
}

export function openPrisoner(state: GameState) {
  state.seen.prisoner = true;
  open(
    state,
    "prisoner",
    { stage: 0, integrity: RULES.prisonerIntegrity, bands: 0, intent: "repair", strip: 0, memory: Math.floor(roll(state) * 4), recruit: roll(state), part: chance(state, RULES.prisonerPart) },
    [
      "An old containment station. A tall, battered machine is strapped to the far wall under reinforced bands: torso, limbs, every joint. Its voice housing has been sealed over.",
      "It is still moving. Small mechanisms click under the armor. Its faceplate is a single screen.",
    ],
  );
  log(state, "The Prisoner That Repairs Itself.");
}

// ---------- views ----------

export function storyView(state: GameState): EventView | null {
  const ev = state.event;
  if (!ev) return null;
  const d = ev.data;
  const t = state.team;
  const o: Option[] = [];
  const en = (n: number) => canPayEnergy(state, n, true);

  switch (ev.id) {
    case "custody": {
      const item = state.custody[0];
      if (!item) return { title: "Custody", lines: ev.lines, options: [opt("done", "Move on", "")] };
      const own = state.units.find((u) => u.uid === item.by && u.hp > 0 && !u.holding);
      const other = freeClampjaw(state);
      const pod = vacantPod(state);
      const lines = [...ev.lines, `${item.label}. ${item.bands ? `${item.bands} Lockband${item.bands > 1 ? "s" : ""}.` : "Held by clamps alone."} ${state.custody.length > 1 ? `${state.custody.length - 1} more after this.` : ""}`];
      if (item.pilot && !own && !other && !(pod && podFits(item.kind, item.person))) lines.push("You have nothing free to hold a person with. A Clampjaw or a Pod holds one captive each.");
      if (own) o.push(opt("keep-clamp", "Keep it in the Clampjaw", "The drone carries it. It cannot capture again until it hands this one over."));
      else if (other) o.push(opt("keep-clamp", "Hand it to a free Clampjaw", "That drone carries it from here."));
      if (pod && podFits(item.kind, item.person)) o.push(opt("keep-pod", "Lock it in the Containment Pod", "Contained. The Pod is then full."));
      if (inDeck(state, "MEMTAP") && !item.tapped && !item.person) {
        o.push(opt("tap-hazard", "Memory Tap: Hazard Scan", "1 Energy. What is in the next room.", en(1)));
        o.push(opt("tap-weak", "Memory Tap: Weakness Analysis", "1 Energy. One machine in the next fight takes +1.", en(1)));
        o.push(opt("tap-cache", "Memory Tap: Cache Trace", "1 Energy. A parts locker by the next Tech Stop.", en(1)));
      }
      if (!item.pilot) o.push(opt("dismantle", "Dismantle it", `+${dismantleValue(item)} Scrap. No Threat.`));
      o.push(opt("release", item.pilot ? "Let the pilot go" : "Leave it", item.pilot ? "They walk out. They may come back in a new frame." : "No reward."));
      return { title: "In your custody", lines, options: o };
    }
    case "r8-recovery":
      o.push(opt("attack", "Attack the recovery operation", "The Widow joins this room's fight. +2 Scrap from the wreck it was working."));
      o.push(opt("observe", "Observe the recovery route", "Learn where R-8 takes its pilots. The Widow finishes its work: anyone regrouping returns sooner."));
      o.push(opt("avoid", "Avoid the team", "Spend nothing. Learn nothing."));
      return { title: "The Recovery Attempt", lines: ev.lines, options: o };
    case "r8-brawler": {
      const bait = inDeck(state, "FLARE") || inDeck(state, "QUIET") || inDeck(state, "BEACON") || t.knownRoute;
      o.push(opt("face", "Face it", "The Latchback Brawler joins this room's fight. It has to close before it can hit."));
      o.push(opt("evade", "Evade it", "Slip past. Bishop keeps its bodyguard."));
      o.push(opt("lure", "Lure it away", bait ? "Send it after a false trail. Bishop will be unguarded when you get there." : "Needs something to bait it with: a Flare, Go Quiet, a Threat Beacon, or R-8's route.", !!bait));
      return { title: "The Team Pushes Back", lines: ev.lines, options: o };
    }
    case "r8-relay": {
      const guard = pilotByRole(state, "latchback").status === "active" && !t.bishopExposed;
      o.push(opt("assault", "Direct Assault", `Fight Bishop${guard ? ", its Brawler" : ""}${recoveryUp(state) && pilotByRole(state, "widow").status === "active" ? " and the Widow" : ""}. It will try to eject rather than die.`));
      if (!t.networkCut) o.push(opt("network", "Disable the Network", `Go for the Command Relay instead: 6 HP, armored, ${RULES.relayGuards} Drones. Bishop is not in this fight.`));
      if (t.knownRoute) o.push(opt("intercept", "Intercept at the rendezvous", "Catch Bishop alone and already hurt. You act first."));
      o.push(opt("talk", "Open a channel", t.leverage >= RULES.negotiateAt ? `You have leverage (${t.leverage}). Bishop will listen.` : `Bishop has no reason to talk yet. Leverage ${t.leverage}/${RULES.negotiateAt}: capture pilots or cut the net.`, t.leverage >= RULES.negotiateAt));
      o.push(opt("wait", "Not yet", "Leave Bishop for a later room."));
      return { title: "Cut the Relay", lines: ev.lines, options: o };
    }
    case "r8-pod": {
      const control = inDeck(state, "FOAM") || inDeck(state, "COFFIN") || inDeck(state, "FUEL") || inDeck(state, "WELDER");
      o.push(opt("pursue", "Pursue immediately", "The pod joins this room's fight. It is airborne, so crane and hook cannot reach it, and it leaves in 2 turns."));
      o.push(opt("ground", "Disable its propulsion", control ? "Foam, sealant or fire brings it down: it starts the fight grounded and stunned." : "Needs Foam, a Sealant Coffin, a Fuel Canister or an Arc Welder in your deck.", !!control));
      if (hasAlly(state, "walker")) o.push(opt("walker", "Send the Ceiling Walker", "60% it reaches the pod first and brings it down. Otherwise the pod leaves a turn sooner."));
      o.push(opt("track", "Let it go and track it", "No fight. You learn R-8's route. Bishop will regroup."));
      return { title: "Hunt the Flying Cockpit", lines: ev.lines, options: o };
    }
    case "r8-talk": {
      const hostage = state.captives.find((c) => c.pilot && c.pilot !== "p-bishop");
      const strong = t.leverage >= RULES.withdrawAt;
      o.push(opt("call", "“Call them off.”", strong ? `Leverage ${t.leverage}: Bishop will agree. R-8 withdraws for good.` : `Leverage ${t.leverage}/${RULES.withdrawAt}: Bishop will refuse.`));
      o.push(opt("exchange", "Offer an exchange", hostage ? `Release ${hostage.label}. In return R-8 withdraws.` : "You hold none of their pilots.", !!hostage));
      o.push(opt("codes", "“Give me the route codes.”", `Safe passage for ${RULES.safePassageRooms} rooms, R-8's route, and 3 Scrap from a cache they give up. Not a peace.`));
      o.push(opt("come", "“Come here yourself.”", strong ? "Bishop comes alone to the next room." : "Bishop sends the Brawler instead."));
      o.push(opt("keep", "“Keep sending machines. I'll keep taking them.”", "Talks end. +1 Threat."));
      return { title: "Bishop on the channel", lines: ev.lines, options: o };
    }
    case "prisoner": {
      const intent = String(d.intent) as Intent;
      const tell = INTENT_TELL[intent];
      const integrity = Number(d.integrity);
      const bands = Number(d.bands);
      const lines = [...ev.lines.slice(-4), tell.motion, `Restraints: ${integrityBand(integrity).toUpperCase()}${bands ? ` · ${bands} Lockband${bands > 1 ? "s" : ""} added` : ""} · Repair stage ${d.stage}/4`];
      if (d.inspected) lines.push(`Inspection: ${{ repair: "it is rebuilding itself, one weld at a time", break: "it is about to tear at one restraint", rest: "it really has stopped, to save power", feign: "it is faking. It is waiting for you to get close", trap: "it is watching the data port", desperate: "it is about to throw everything at the restraints", sabotage: "it is working on the controls" }[intent]}.`);
      const builder = allies(state, "builder")[0];
      const pod = vacantPod(state);
      o.push(opt("strip", "Strip It for Parts", `+2 Scrap now, +2 and a possible component on the second cut (${d.strip}/2). It keeps repairing while you work.`));
      if (inDeck(state, "LOCKBANDS")) o.push(opt("band", "Reinforce: Industrial Lockbands", bands >= RULES.maxBands ? "Two bands already." : `1 Scrap. +${RULES.bandIntegrity} restraint. A second band also sets its repairs back.`, bands < RULES.maxBands && state.scrap >= 1));
      if (builder && !d.droneUsed) o.push(opt("drone", "Reinforce: Builder Drone", "The drone re-seats the old bands: +20 restraint. Once."));
      if (pod) o.push(opt("contain", "Move it into the Containment Pod", integrity > 40 ? "Contained. It travels with you, and it will keep testing the Pod." : "Too risky to move while the restraints are critical.", integrity > 40));
      if (inDeck(state, "MEMTAP") && !d.tapped) o.push(opt("tap", "Memory Tap", "1 Energy. Its records are unusual. They may not be honest.", en(1)));
      if (builder || state.equip.hand) o.push(opt("recruit", "Recruit Under Supervision", integrity >= 76 && Number(d.stage) <= 2 ? "Rewrite its control loop while it is held. It may come out an ally, an unstable ally, or loose." : "Needs stable restraints and repair stage 2 or lower.", integrity >= 76 && Number(d.stage) <= 2 && freeFriendSlot(state) >= 0));
      o.push(opt("inspect", "Inspect it", "Spend a moment working out what it is actually doing. It keeps doing it."));
      o.push(opt("leave", "Leave It Alone", "Walk away. It stays as it is."));
      return { title: "The Prisoner That Repairs Itself", lines, options: o, screen: { glyph: tell.glyph, anim: tell.anim, caption: tell.caption } };
    }
  }
  return null;
}

// ---------- resolution ----------

function prisonerBeat(state: GameState, did: string, flow: Flow) {
  const d = state.event!.data;
  const intent = String(d.intent) as Intent;
  const tell = INTENT_TELL[intent];
  const half = Number(d.bands) >= 2 ? 0.5 : 1;
  const hurt = (n: number) => (d.integrity = Math.max(0, Number(d.integrity) - Math.ceil(n * half)));
  const careful = did === "inspect" || did === "band" || did === "drone";
  log(state, `${tell.glyph} ${tell.caption}`);
  switch (intent) {
    case "repair":
      d.stage = Math.min(4, Number(d.stage) + 1);
      break;
    case "break":
      hurt(30);
      note(state, "A band shrieks and gives a centimetre.");
      break;
    case "feign":
      if (careful) note(state, "You were watching. It does not move. Its screen holds one long ……");
      else {
        hurt(40);
        d.stage = Math.min(4, Number(d.stage) + 1);
        note(state, "The moment your hands are busy, it moves. It was never resting.");
      }
      break;
    case "trap":
      if (did === "tap") {
        hurt(20);
        state.threat += 1;
        state.intel.questionable = true;
        note(state, `…? The records it gives you were written for you. Something goes out over the Tap before you pull it. Threat ${state.threat}.`);
      }
      break;
    case "desperate":
      hurt(50);
      note(state, "Everything strains at once.");
      break;
    default:
      break;
  }
  d.inspected = false;
  if (Number(d.integrity) <= 0) {
    log(state, "…!! [metal snapping, pressure release, a muffled burst]");
    log(state, "The restraints are on the floor. The Prisoner is in the next room before you are.");
    state.pendingSpawn.push("prisoner");
    state.event = null;
    return flow.continueHall(state);
  }
  if (Number(d.stage) >= 4) {
    log(state, "…!! [metal snapping, pressure release, a muffled burst]");
    d.stage = 2;
    hurt(40);
    note(state, "One arm comes free and swings before the remaining bands catch it. You can still hold it. For now.");
    deal(state, jubey(state), 1, "A freed arm", { noLeech: true });
    if (Number(d.integrity) <= 0) {
      state.pendingSpawn.push("prisoner");
      state.event = null;
      return flow.continueHall(state);
    }
  }
  d.intent = nextIntent(state);
}

export function resolveStory(state: GameState, option: string, flow: Flow) {
  const ev = state.event;
  const view = storyView(state);
  const chosen = view?.options.find((x) => x.id === option);
  if (!ev || !chosen || !chosen.enabled) return;
  const d = ev.data;
  const t = state.team;
  const hall = () => {
    state.event = null;
    flow.continueHall(state);
  };

  switch (ev.id) {
    case "custody": {
      const item = state.custody[0];
      if (!item) {
        state.event = null;
        return flow.afterCustody(state);
      }
      if (option.startsWith("tap-")) {
        payEnergy(state, 1, true);
        item.tapped = true;
        const role = (Object.keys(CALLSIGN) as Role[]).find((r) => item.label.startsWith(CALLSIGN[r]) || item.kind === r);
        resolveTap(state, item.id, option.slice(4) === "weak" ? "weak" : (option.slice(4) as TapChoice), { role, contained: false, anomalous: item.kind === "prisoner", damaged: item.hp <= 1, mark: () => {} });
        return;
      }
      if (option === "keep-clamp") {
        const holder = state.units.find((u) => u.uid === item.by && u.hp > 0 && !u.holding) ?? freeClampjaw(state);
        if (holder) takeCaptive(state, item, holder);
      } else if (option === "keep-pod") {
        const pod = vacantPod(state);
        if (pod) takeCaptive(state, item, pod);
      } else if (option === "dismantle") {
        addScrap(state, dismantleValue(item), `Dismantled ${item.label.replace(/^The /, "the ")}`);
        if (PILOTED.includes(item.kind)) rollParts(state, item.id, "Its cockpit");
      }
      else if (item.pilot) setPilot(state, item.pilot, "escaped", "you let them go");
      else log(state, `You leave ${item.label.replace(/^The /, "the ")} where it lies.`);
      state.custody.shift();
      if (!state.custody.length) {
        state.event = null;
        return flow.afterCustody(state);
      }
      return;
    }

    case "r8-recovery":
      if (option === "attack") {
        deploy(state, "widow");
        state.pendingScrap += 2;
        log(state, "You come in over the wreck it was working.");
      } else if (option === "observe") {
        t.knownRoute = true;
        for (const p of t.pilots) if (p.returnsIn !== undefined) p.returnsIn = 1;
        log(state, "You watch which door the Widow takes its tow line through. Now you know R-8's recovery route.");
      } else log(state, "You go around.");
      advanceEpisode(state);
      return hall();

    case "r8-brawler":
      if (option === "face") deploy(state, "latchback");
      else if (option === "lure") {
        t.bishopExposed = true;
        log(state, "You leave it something loud to chase. Its footsteps go the wrong way.");
      } else log(state, "You wait for its head to turn and take the side passage.");
      advanceEpisode(state);
      return hall();

    case "r8-relay":
      if (option === "talk") return openTalk(state);
      if (option === "wait") {
        t.nextAt = state.room + 1;
        return hall();
      }
      if (option === "network") {
        state.nextPack = ["relay", ...Array(RULES.relayGuards).fill("drone")];
        log(state, "You follow the cable trunk instead of the voice.");
      } else {
        deploy(state, "bishop");
        if (option === "assault") {
          if (!t.bishopExposed) deploy(state, "latchback");
          if (recoveryUp(state)) deploy(state, "widow");
        } else {
          state.firstStrike = true;
          d.hurt = true;
          state.interceptBishop = true;
          log(state, "You are already in the rendezvous bay when Bishop walks in.");
        }
      }
      t.nextAt = state.room + 2;
      return hall();

    case "r8-pod": {
      const p = pilotByRole(state, "bishop");
      if (option === "track") {
        t.knownRoute = true;
        log(state, "You let the light go and follow where it is heading. R-8's route is yours.");
        return hall();
      }
      p.status = "active";
      p.returnsIn = undefined;
      state.pendingTeam.push({ kind: "capsule", pilot: p.id });
      state.podStart = option === "ground" || (option === "walker" && Number(d.walker) < 0.6) ? "grounded" : option === "walker" ? "late" : "";
      if (option === "walker") log(state, state.podStart === "grounded" ? "The Walker drops on it from a cable tray and rides it down." : "The Walker misses its jump. The pod pours on speed.");
      return hall();
    }

    case "r8-talk": {
      if (option === "call") {
        if (t.leverage >= RULES.withdrawAt) {
          say(state, "bishop", "…Section, this is Bishop. Break contact. All of you. We are done here.");
          withdraw(state, "withdrawal negotiated. They stop hunting you.");
        } else say(state, "bishop", "Not for what you are holding. Not yet.");
      } else if (option === "exchange") {
        const hostage = state.captives.find((c) => c.pilot && c.pilot !== "p-bishop")!;
        const id = hostage.pilot!;
        loseCaptive(state, hostage.holder, "handed back under the agreement", true);
        const p = t.pilots.find((x) => x.id === id);
        if (p) {
          p.status = "withdrawn";
          p.returnsIn = undefined;
        }
        say(state, "bishop", "You get your hallway. I get my pilot. Section, break contact.");
        withdraw(state, "withdrawal negotiated in exchange for a pilot.");
      } else if (option === "codes") {
        t.truceUntil = state.room + RULES.safePassageRooms;
        t.knownRoute = true;
        addScrap(state, 3, "A cache R-8 gives up");
        say(state, "bishop", `Three rooms. After that I owe you nothing.`);
      } else if (option === "come") {
        if (t.leverage >= RULES.withdrawAt && deploy(state, "bishop")) {
          t.bishopExposed = true;
          say(state, "bishop", "Fine. Stay where you are.");
        } else {
          deploy(state, "latchback");
          say(state, "bishop", "I'll send someone.");
        }
      } else {
        t.pressure += 1;
        state.threat += 1;
        say(state, "bishop", "Understood.");
        log(state, `The channel closes. Threat ${state.threat}.`);
      }
      t.nextAt = Math.max(t.nextAt, state.room + 1);
      return hall();
    }

    case "prisoner": {
      const builder = allies(state, "builder")[0];
      if (option === "leave") {
        log(state, "… [low mechanical hum]");
        log(state, "You leave it strapped to the wall. Its screen follows you to the door.");
        return hall();
      }
      if (option === "contain") {
        const pod = vacantPod(state)!;
        takeCaptive(state, { id: "prisoner" + state.room, kind: "prisoner", person: false, label: "The Prisoner", bands: Number(d.bands), hp: 7, tapped: !!d.tapped }, pod);
        log(state, "The Pod locks. Inside, after a while: … [low mechanical hum]");
        return hall();
      }
      if (option === "strip") {
        d.strip = Number(d.strip) + 1;
        addScrap(state, 2, "Cut from the Prisoner");
        if (Number(d.strip) >= 2) {
          if (d.part) {
            const id = pick(state, REWARD_POOL.filter((c) => CARDS[c].rarity === "uncommon"));
            addCard(state, id);
            log(state, `One assembly comes out whole: ${CARDS[id].name} added to the deck.`);
          }
          log(state, "…? [a motor winds down and does not restart]");
          log(state, "There is not enough of it left to repair anything.");
          return hall();
        }
      } else if (option === "band") {
        state.scrap -= 1;
        d.bands = Number(d.bands) + 1;
        d.integrity = Math.min(100, Number(d.integrity) + RULES.bandIntegrity);
        if (Number(d.bands) >= 2) d.stage = Math.max(0, Number(d.stage) - 1);
        note(state, "…! It tests the new band at once, and stops.");
      } else if (option === "drone") {
        d.droneUsed = true;
        d.integrity = Math.min(100, Number(d.integrity) + 20);
        note(state, "The Builder Drone re-seats two old bands and backs away quickly.");
      } else if (option === "tap") {
        payEnergy(state, 1, true);
        d.tapped = true;
        if (String(d.intent) !== "trap") {
          const m = Number(d.memory);
          if (m === 0) {
            state.revealNext = true;
            state.navFlag = true;
            note(state, "A route record, clean. You know the next room and can read the next wrong corridor.");
          } else if (m === 1) {
            state.intel.cache += RULES.tapCache.clean;
            note(state, "A maintenance cache, logged beside the next Tech Stop.");
          } else if (m === 2) {
            state.intel.weak = true;
            note(state, "A fault record for a machine you have not met yet. It will take +1 from every hit next fight.");
          } else {
            state.navFlag = true;
            note(state, "A warning about a facility system that moves corridors. You will read the next one.");
          }
        }
      } else if (option === "inspect") {
        d.inspected = true;
        const before = String(d.intent);
        prisonerBeat(state, "inspect", flow);
        if (state.event) {
          state.event.data.inspected = true;
          note(state, `You saw it: ${before === "feign" ? "it was faking" : before === "rest" ? "it had genuinely stopped" : "it was not hiding anything"}. Now you are watching what it does next.`);
        }
        return;
      } else if (option === "recruit") {
        const r = Number(d.recruit) - (state.equip.hand ? 0.15 : 0);
        if (r < 0.75) {
          const unstable = r >= 0.45;
          spawn(state, "prisoner", "friendly", freeFriendSlot(state), { roomsLeft: RULES.prisonerFights, note: unstable ? "unstable" : undefined });
          log(state, unstable ? "… …? [a control loop catching, slipping, catching]" : "… [one steady tone, then nothing]");
          log(state, `The bands come off and it does not attack. It stands where ${builder ? "the drone" : "your hand"} points. ${unstable ? "Its screen keeps flickering …? It is with you, and it is not stable." : "Its screen shows a single …"} It follows for ${RULES.prisonerFights} fights.`);
          return hall();
        }
        log(state, "…!! [metal snapping, pressure release, a muffled burst]");
        log(state, "The rewrite does not take. The bands you loosened to reach its spine are the ones it needed.");
        state.pendingSpawn.push("prisoner");
        return hall();
      }
      return prisonerBeat(state, option, flow);
    }
  }
}
