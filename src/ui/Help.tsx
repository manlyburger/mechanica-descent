import { CARDS, RULES } from "../game/data";
import {
  type GameState,
} from "../game/engine";
import { pct } from "./shared";

/** Equipment, armed reactions and other standing effects. */
export function Gear({ state }: { state: GameState }) {
  const g: string[] = [];
  if (state.loadoutAd.length) g.push(`AM Mine ×${state.loadoutAd.length}${state.phase === "player" && state.minesArmed ? " armed" : ""}`);
  if (state.equip.servo) g.push("Servo Limb");
  if (state.equip.hand) g.push(`Override Hand${state.handUsed && state.phase === "player" ? " (used)" : ""}`);
  if (state.equip.cell > 0) g.push(`Cell ${state.equip.cell}${state.equip.cell === 1 ? " LAST CHARGE" : ""}`);
  for (const c of state.armed) g.push(`${CARDS[c.id].name} armed`);
  if (state.redmouth) g.push(state.madness >= RULES.highMadness ? "RED-MOUTH UNSTABLE" : "Red-Mouth loaded");
  if (state.navFlag) g.push("Corridor marked");
  if (state.badge.turns > 0) g.push(`Badge ${state.badge.turns}`);
  if (state.hallwayArmed) g.push("Exit is wrong");
  if (state.preCommission) g.push("Warframe pre-commissioned");
  for (const c of state.captives) g.push(`Held: ${c.label}`);
  if (state.intel.weak) g.push("Records: a weak point next fight");
  if (state.intel.cache > 0) g.push(`Records: cache at next Tech Stop`);
  if (state.intel.questionable) g.push("RECORDS UNVERIFIED");
  if (state.team.knownRoute && state.team.introduced) g.push("R-8 route known");
  if (state.parts) g.push(`Cockpit Parts ${state.parts}/3`);
  for (const r of state.roster) if (r.custody === "captive" && r.strain >= 70) g.push(`${r.name} RESTLESS`);
  if (!g.length) return null;
  return (
    <div className="gear">
      {g.map((x) => (
        <span key={x} className={/UNSTABLE|LAST|UNVERIFIED|RESTLESS/.test(x) ? "warn" : ""}>
          {x}
        </span>
      ))}
    </div>
  );
}

export function Help() {
  return (
    <div className="helpbox">
      <p>
        <b>Cards.</b> Draw {RULES.handSize} a turn. Tap a card to read it, then tap its target (or tap it again). Gold number is
        Energy; "S" is Scrap.
      </p>
      <p>
        <b>Armor</b> (◈) takes 1 off every hit, so 1-damage hits do nothing. A Salvage Leech's second pull strips a point.
      </p>
      <p>
        <b>Melee</b> enemies have to reach you. Their card slides down the lane: Distant, Closing, Melee Ready. Only then can
        they hit. Stun or foam stops the advance; Crane Hook throws them back a step.
      </p>
      <p>
        <b>Capture.</b> A machine at {RULES.captureHp} HP or less, or a disabled one, can be grappled by a Clampjaw or banded with
        Lockbands. Secured machines stop fighting and strain at the restraint. A Clampjaw and a Pod hold one captive each.
      </p>
      <p>
        <b>Pilots.</b> Some mechs eject. A capsule that leaves the room means a pilot who may come back in a new frame. A
        Cockpit Wedge blocks the ejection, not the radio and not the reactor.
      </p>
      <p>
        <b>Pilots.</b> Captured and recruited pilots are people with stats, gear and loyalty. Open <b>crew</b> to equip them,
        talk to them, and assign them on foot or to a salvaged frame. Unwilling captives cannot be assigned at all.
      </p>
      <p>
        <b>Machines.</b> Tap any unit to inspect it and give orders. Allied machines act on their own after your turn, and stay
        with you between rooms while they live.
      </p>
      <p>
        <b>Threat</b> rises when you strip wrecks. Every {RULES.threatPerDrone} Threat calls a Drone into the next room. At{" "}
        {RULES.threatHunt}+ the Infested hunt Jubey. Drains 1 per turn you leave wrecks alone.
      </p>
      <p>
        <b>Madness.</b> Each point is a {pct(RULES.madnessMisfire)} misfire chance. At {RULES.highMadness}+ Nightmare gear acts
        on its own. Drains 1 per turn.
      </p>
      <p>
        <b>Teeth.</b> Infested kills and stripped wrecks fill it. At {RULES.nightmareThreshold}: no Block for{" "}
        {RULES.teethStripTurns} turns.
      </p>
      <p>
        <b>Contamination</b> comes from Infested hits and the deep halls. Every {RULES.contamPerRot} adds a dead card to each
        fight. Only a Decon Bay clears it. There is one after every {RULES.deconEvery}th room: walk out, or go deeper.
      </p>
    </div>
  );
}
