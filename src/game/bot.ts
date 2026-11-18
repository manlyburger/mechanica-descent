// A heuristic player for the balance sim, and a random player for the fuzz test.
// The heuristic bot is a decent-but-not-clever pilot: its results are a floor.

import { CARDS, ENERGY_UP, HP_UP, RULES, hasTag, type CardId } from "./data";
import { allies, enemyHitChance, eventView, jubey, legalActions, living, reduce, type Action, type GameState } from "./engine";

export interface BotStyle {
  loadout: "lootbox" | "mine" | "buddy";
  risky: boolean;
  /** Strip wrecks while Threat stays under this. 0 = never salvage. */
  salvageUnderThreat: number;
  /** Take risky event options. */
  bold: boolean;
  /** Decon Bays to pass before cashing out. */
  legs: number;
  /** Use the brief's machine cards. */
  machines: boolean;
}

export const CAREFUL: BotStyle = { loadout: "buddy", risky: false, salvageUnderThreat: 3, bold: false, legs: 1, machines: true };
export const GREEDY: BotStyle = { loadout: "buddy", risky: true, salvageUnderThreat: 99, bold: true, legs: 1, machines: true };
export const PASSIVE: BotStyle = { loadout: "lootbox", risky: false, salvageUnderThreat: 0, bold: false, legs: 1, machines: false };

const REWARD_ORDER: CardId[] = [
  "SLUG", "HOOK", "BUILDER", "BURST", "JACK", "LEECH", "SHEPHERD", "WALKER", "FLUSH", "FOAM", "PLATE", "POSSUM", "GUNNEST",
  "WARFRAME", "WELDER", "CELL", "COFFIN", "BULKHEAD", "FLARE", "SERVO", "REFLEX", "STRIP", "QUIET", "BEACON",
];
const MACHINE_CARDS: CardId[] = ["BUILDER", "JACK", "SHEPHERD", "WALKER", "POSSUM", "GUNNEST", "WARFRAME", "BULKHEAD", "LEECH", "SERVO", "HAND", "BEACON"];

// Safest-first and boldest-first option orders per event.
const SAFE: Record<string, string[]> = {
  scared: ["accept", "leave"],
  choice: ["CHOICE_SCRAP_BAIT", "CHOICE_SEALED_LOCKER", "CHOICE_CUT_COMMS", "NONE"],
  remembers: ["recall"],
  patient: ["walker", "leave"],
  yard: ["badge", "sabotage", "leave"],
  hallway: ["mark", "search", "force", "follow"],
  "hw-maint": ["assist", "sneak"],
  "hw-behind": ["ambush"],
  "hw-salvage": ["drone", "none"],
  "hw-circle": ["drone", "inspect", "mark", "fight"],
  "hw-eats": ["seal", "retreat"],
};
const BOLD: Record<string, string[]> = {
  scared: ["accept", "leave"],
  choice: ["CHOICE_SCRAP_BAIT", "CHOICE_SEALED_LOCKER", "CHOICE_COOLANT_SIPHON", "CHOICE_CUT_COMMS", "NONE"],
  remembers: ["follow"],
  patient: ["badge", "walker", "repair", "strip", "leave"],
  yard: ["badge", "commission", "scavenge", "leave"],
  hallway: ["search", "scout", "mark", "follow"],
  "hw-maint": ["assist", "dismantle", "sneak"],
  "hw-behind": ["walker", "ambush"],
  "hw-salvage": ["leech", "drone", "all"],
  "hw-circle": ["leech", "mark", "fight"],
  "hw-eats": ["harvest", "extract", "seal"],
};

function incoming(s: GameState): number {
  const j = jubey(s);
  let sum = 0;
  for (const e of living(s, "enemy")) {
    const p = e.plan;
    if (!p || (p.type !== "attack" && p.type !== "missile") || p.targetUid !== j?.uid) continue;
    sum += (p.dmg ?? 1) * enemyHitChance(s, e);
  }
  return sum;
}

function combatMove(s: GameState, style: BotStyle): Action {
  const acts = legalActions(s);
  const foes = living(s, "enemy");
  const j = jubey(s)!;
  if (!foes.length) return { type: "endTurn" };
  const threat = incoming(s) - s.block;
  const missile = foes.some((e) => e.plan?.type === "missile" && e.plan.targetUid === j.uid);
  const ranked = foes.slice().sort((a, b) => (a.plan?.type === "missile" ? 0 : 1) - (b.plan?.type === "missile" ? 0 : 1) || a.hp - b.hp);
  const prime = ranked[0];

  let best: Action = { type: "endTurn" };
  let bestScore = 0;
  const consider = (a: Action, score: number) => {
    if (score > bestScore) [best, bestScore] = [a, score];
  };

  for (const a of acts) {
    if (a.type === "command") {
      const u = s.units.find((x) => x.uid === a.uid);
      if (a.cmd === "reset" || a.cmd === "override") consider(a, 90);
      else if (a.cmd === "protect" && u && !u.protect && a.targetId === j.uid) consider(a, 40);
      else if (a.cmd === "order-commission") consider(a, 35);
      else if (a.cmd === "retrieve") consider(a, 30);
      else if (a.cmd === "emergency" && a.targetId === j.uid && j.hp <= 2) consider(a, 45);
      else if (a.cmd === "risky" && u && u.hp <= 1) consider(a, 20);
      continue;
    }
    if (a.type !== "play") continue;
    const card = s.hand.find((c) => c.uid === a.uid)!;
    const def = CARDS[card.id];
    if (!style.machines && MACHINE_CARDS.includes(card.id)) continue;
    const t = s.units.find((u) => u.uid === a.targetId);
    switch (card.id) {
      case "FLUSH": consider(a, 100); break;
      case "OVERCLOCK": if (s.madness === 0 && s.hand.length >= 3) consider(a, 95); break;
      case "BRACE": case "PLATE":
        if (s.stripped === 0 && s.block === 0 && (missile || (s.energy >= 2 && threat >= 2))) consider(a, card.id === "PLATE" && threat < 4 ? 60 : 70);
        else if (s.stripped === 0 && threat > 0) consider(a, 5);
        break;
      case "CRANE": {
        const n = foes.filter((e) => Math.abs(e.slot - a.slot!) <= 1).length;
        if (n >= 2) consider(a, 50 + n);
        else if (n === 1 && Math.abs(prime.slot - a.slot!) <= 1) consider(a, a.slot === prime.slot ? 44 : 43);
        break;
      }
      case "BURST": if (foes.length >= 2) consider(a, 48); else consider(a, 30); break;
      case "ROCKET": if (t === prime) consider(a, 49); break;
      case "SLUG": if (t === prime && prime.hp >= 3) consider(a, 47); break;
      case "HOOK": if (t === prime) consider(a, 46); break;
      case "FUEL": case "WELDER": if (t === prime) consider(a, 42); break;
      case "GUN": if (t === prime) consider(a, 41); break;
      case "PATCH": if (j.hp <= j.maxHp - 2) consider(a, 20); else if (j.hp < j.maxHp) consider(a, 3); break;
      case "STRIP": if (s.threat + 1 < RULES.threatPerDrone) consider(a, 10); break;
      case "QUIET": if (s.threat >= 2) consider(a, 12); break;
      case "FLARE": if (threat >= 1) consider(a, 11); break;
      case "BUILDER": case "JACK": case "SHEPHERD": case "WALKER": case "POSSUM": case "GUNNEST": case "WARFRAME":
        consider(a, s.turn <= 2 ? 80 : 25);
        break;
      case "LEECH": if (t && t.side === "enemy" && t.hp >= 4) consider(a, 38); break;
      case "BULKHEAD": if (t === j && threat >= 2) consider(a, 36); break;
      case "BEACON": if (foes.length >= 2 && s.threat === 0) consider(a, 15); break;
      case "SERVO": case "HAND": case "CELL": consider(a, 85); break;
      case "REFLEX": case "RECORDER": if (allies(s).some((x) => hasTag(x.kind, "machine"))) consider(a, 32); break;
      case "REDMOUTH": if (s.madness < RULES.highMadness - 1 && s.hand.some((c) => CARDS[c.id].firearm && c.uid !== card.uid) && s.energy >= 1) consider(a, 52); break;
      case "FOAM": case "COFFIN":
        if (t && t.side === "enemy" && t.plan?.type === "missile") consider(a, 65);
        else if (t && t.side === "friendly" && t.hp <= t.maxHp - 2 && t.kind !== "warframe") consider(a, 8);
        break;
      case "BADGE": if (foes.some((e) => e.kind === "drone")) consider(a, 14); break;
      case "HALLWAY": if (style.bold && j.hp >= 4) consider(a, 9); break;
      default: void def; break;
    }
  }
  return best;
}

export function botMove(s: GameState, style: BotStyle): Action {
  const j = jubey(s);
  switch (s.phase) {
    case "title": case "win": case "dead":
      return { type: "start" };
    case "loadout":
      return { type: "loadout", pick: style.loadout };
    case "route":
      return { type: "pickPath", risky: style.risky };
    case "event": {
      const view = eventView(s)!;
      const order = (style.bold ? BOLD : SAFE)[s.event!.id] ?? [];
      for (const id of order) {
        if (id === "CHOICE_COOLANT_SIPHON" && j && j.hp >= j.maxHp) continue;
        if (view.options.some((o) => o.id === id && o.enabled)) return { type: "event", option: id };
      }
      const fallback = view.options.filter((o) => o.enabled);
      return { type: "event", option: fallback[fallback.length - 1].id };
    }
    case "player":
      return combatMove(s, style);
    case "salvage": {
      const w = s.wrecks[0];
      if (w && s.threat + 1 < style.salvageUnderThreat && s.nightmare + 1 < RULES.nightmareThreshold) return { type: "salvage", targetId: w.id };
      return { type: "leaveSalvage" };
    }
    case "reward": {
      if (s.rewardShown.includes("MINE") && s.loadoutAd.length < RULES.adSlots) return { type: "pickReward", id: "MINE" };
      const id = REWARD_ORDER.find((r) => s.rewardShown.includes(r) && (style.machines || !MACHINE_CARDS.includes(r)));
      return { type: "pickReward", id: id ?? "NONE" };
    }
    case "decon":
      return { type: "decon", deeper: s.tally.decons + 1 < style.legs && !!j && j.hp >= 3 };
    case "tech": {
      if (j && j.hp < j.maxHp && s.cash >= RULES.repairCash) return { type: "repair" };
      if (j && j.hp <= j.maxHp - 2 && s.scrap >= RULES.patchScrap) return { type: "patch" };
      const en = ENERGY_UP.find((e) => e.from === s.energyCap);
      if (en && s.scrap >= en.scrap && s.rs >= en.rs) return { type: "buyEnergy" };
      const hpUp = HP_UP.find((h) => h.rank === s.hpUpRank + 1);
      const reserve = style.machines && s.deck.some((c) => (CARDS[c.id].scrap ?? 0) > 0) ? 2 : 0;
      if (hpUp && s.scrap >= hpUp.scrap + reserve && (!en || en.rs > s.rs || s.energyCap >= 2)) return { type: "buyHp" };
      return { type: "nextRoom" };
    }
  }
}

export interface RunResult {
  win: boolean;
  room: number;
  steps: number;
  final: GameState;
}

function step(s: GameState, a: Action): GameState {
  const next = reduce(s, a);
  // A rejected action must never stall a run.
  if (next.phase === "player" && s.phase === "player" && next.turn === s.turn && next.log.length === s.log.length && next.log[0] === s.log[0] && a.type !== "endTurn") {
    return reduce(next, { type: "endTurn" });
  }
  return next;
}

export function playRun(seed: number, style: BotStyle, maxSteps = 6000): RunResult {
  let s = reduce({ seed, best: 0 } as GameState, { type: "start", seed });
  let steps = 0;
  let stall = 0;
  while (s.phase !== "win" && s.phase !== "dead" && steps++ < maxSteps) {
    const before = s;
    s = step(s, botMove(s, style));
    stall = s.phase === "player" && before.turn === s.turn && before.room === s.room ? stall + 1 : 0;
    if (stall > 25) {
      s = reduce(s, { type: "endTurn" });
      stall = 0;
    }
  }
  return { win: s.phase === "win", room: s.room, steps, final: s };
}

/** Uniformly random legal actions, driven by its own tiny RNG. For fuzzing. */
export function randomRun(seed: number, maxSteps = 1500, visit?: (s: GameState, a: Action) => void): GameState {
  let x = seed >>> 0 || 1;
  const rnd = () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
  let s = reduce({ seed, best: 0 } as GameState, { type: "start", seed });
  for (let i = 0; i < maxSteps && s.phase !== "win" && s.phase !== "dead"; i++) {
    const acts = legalActions(s);
    // Bias toward ending the turn so fights progress, and away from leaving at Decon.
    let a = acts[Math.floor(rnd() * acts.length)];
    if (s.phase === "player" && rnd() < 0.25) a = { type: "endTurn" };
    if (s.phase === "decon" && rnd() < 0.7) a = { type: "decon", deeper: true };
    s = reduce(s, a);
    visit?.(s, a);
  }
  return s;
}
