import { describe, expect, it } from "vitest";
import { CAREFUL, GREEDY, PASSIVE, playRun, randomRun } from "../bot";
import { CARDS, REWARD_POOL, RULES, STARTING_DECK, VARIANTS, type CardId } from "../data";
import { createGame, legalActions, living, reduce, type GameState } from "../engine";
import { sane } from "./helpers";

function checkInvariants(s: GameState) {
  for (const k of ["energy", "threat", "madness", "scrap", "cash", "contamination", "nightmare"] as const) expect(s[k], k).toBeGreaterThanOrEqual(0);
  expect(s.equip.cell).toBeGreaterThanOrEqual(0);
  expect(s.loadoutAd.length).toBeLessThanOrEqual(RULES.adSlots);
  for (const u of s.units) {
    expect(u.hp, u.kind).toBeLessThanOrEqual(u.maxHp);
    if (u.kind !== "jubey") expect(u.hp).toBeGreaterThan(0);
  }
  for (const side of ["enemy", "friendly"] as const) {
    const slots = living(s, side).map((u) => u.slot);
    expect(new Set(slots).size, `${side} slots`).toBe(slots.length);
    for (const slot of slots) expect(slot >= 0 && slot < RULES.lanes).toBe(true);
  }
  const ids = s.wrecks.map((w) => w.id);
  expect(new Set(ids).size).toBe(ids.length); // a wreck exists once
  const piles = [...s.draw, ...s.hand, ...s.discard, ...s.armed].filter((c) => !c.temp).map((c) => c.uid);
  expect(new Set(piles).size, "card duplicated").toBe(piles.length);
  const deck = new Set(s.deck.map((c) => c.uid));
  for (const id of piles) expect(deck.has(id), "card not owned by deck").toBe(true);
  const bound = s.units.map((u) => u.cardUid).filter(Boolean);
  for (const id of bound) expect(piles.includes(id!), "deployed card also in a pile").toBe(false);
  for (const u of s.units) if (u.leech?.cardUid) expect(piles.includes(u.leech.cardUid)).toBe(false);
  if (s.phase === "event") expect(legalActions(s).length, "event with no way out").toBeGreaterThan(0);
  // Capture: one captive per holder, each captive held once, no pilot in two places.
  const holders = s.captives.map((c) => c.holder);
  expect(new Set(holders).size, "holder with two captives").toBe(holders.length);
  expect(new Set(s.captives.map((c) => c.id)).size, "captive duplicated").toBe(s.captives.length);
  for (const c of s.captives) expect(s.units.some((u) => u.uid === c.holder && u.holding === c.id), "captive without its holder").toBe(true);
  // Pilots as people: one record per id, one place at a time.
  expect(new Set(s.roster.map((r) => r.id)).size, "pilot record duplicated").toBe(s.roster.length);
  for (const r of s.roster) {
    expect(r.slots.length).toBe(4);
    if (!r.slot4) expect(r.slots[3], "item in a locked slot").toBeNull();
    const equipped = r.slots.filter(Boolean).map((x) => x!.uid);
    for (const id of equipped) expect(s.items.some((x) => x.uid === id), "item both equipped and in inventory").toBe(false);
    const fieldUnits = s.units.filter((u) => u.pilot === r.id && u.hp > 0 && (u.kind === "frame" || u.kind === "pilot")).length;
    expect(fieldUnits, `${r.name} fielded twice`).toBeLessThanOrEqual(1);
    if (r.custody === "dead" || r.custody === "free") expect(fieldUnits, `${r.custody} pilot ${r.name} in your lane`).toBe(0);
    expect(r.loyalty >= 0 && r.loyalty <= 100).toBe(true);
    expect(r.recovering >= 0 && r.madness >= 0 && r.madness <= 100).toBe(true);
    for (const st of ["mental", "skill", "endurance"] as const) expect(r.base[st] + r.earned[st]).toBeGreaterThanOrEqual(1);
  }
  const allItems = [...s.items.map((x) => x.uid), ...s.roster.flatMap((r) => r.slots.filter(Boolean).map((x) => x!.uid))];
  expect(new Set(allItems).size, "item duplicated").toBe(allItems.length);
  for (const c of s.captives) if (c.pilot) expect(s.roster.find((r) => r.id === c.pilot)?.custody, "held pilot not marked captive").toBe("captive");
  for (const p of s.team.pilots) {
    const inUnits = s.units.filter((u) => u.pilot === p.id && u.hp > 0 && u.side === "enemy").length;
    const inCustody = s.captives.filter((c) => c.pilot === p.id).length + s.custody.filter((c) => c.pilot === p.id).length;
    expect(inUnits + inCustody, `pilot ${p.id} in two places`).toBeLessThanOrEqual(1);
    if (p.status === "captured" || p.status === "dead" || p.status === "withdrawn") {
      expect(inUnits, `${p.status} pilot ${p.id} on the field`).toBe(0);
      expect(p.returnsIn, `${p.status} pilot ${p.id} scheduled to return`).toBeUndefined();
    }
  }
  if (!["active", "disrupted", "dormant"].includes(s.team.pursuit)) expect(s.pendingTeam.length, "team spawn after the pursuit ended").toBe(0);
  for (const u of s.units) if (u.prox !== undefined) expect(u.prox >= 0 && u.prox <= RULES.proxEngaged).toBe(true);
  // Brief 6. Pods: one record per pod, one person per pod, nobody in a pod and in custody at once.
  expect(new Set(s.pods.map((p) => p.id)).size, "pod duplicated").toBe(s.pods.length);
  const podPilots = s.pods.filter((p) => p.pilot && !p.resolved).map((p) => p.pilot!);
  expect(new Set(podPilots).size, "one pilot in two pods").toBe(podPilots.length);
  for (const id of podPilots) {
    expect(s.captives.some((c) => c.pilot === id), "pilot both in a pod and held").toBe(false);
    expect(s.units.some((u) => u.pilot === id && u.hp > 0), "pilot both in a pod and on the field").toBe(false);
  }
  for (const r of s.roster) expect(r.base.observation + r.earned.observation, "Observation").toBeGreaterThanOrEqual(1);
  // Robobuddy: a shell is never also standing on the line.
  if (s.buddy.status === "wrecked") expect(s.units.some((u) => u.kind === "robobuddy" && u.hp > 0), "wrecked Robobuddy fielded").toBe(false);
  // Stalkers: within the cap, defeated once, never an R-8 pilot.
  expect(s.stalkers.filter((x) => x.state !== "defeated").length).toBeLessThanOrEqual(RULES.stalkerMax);
  for (const st of s.stalkers) {
    if (st.pilot) expect(s.team.pilots.some((p) => p.id === st.pilot), "stalker driven by an R-8 pilot").toBe(false);
    if (st.state === "defeated") expect(st.reduction, "defeat without its reduction").toBeGreaterThan(0);
    const fielded = s.units.filter((u) => u.stalkerId === st.id && u.hp > 0).length;
    expect(fielded, "stalker fielded twice").toBeLessThanOrEqual(1);
    if (st.state === "defeated") expect(fielded, "defeated stalker on the field").toBe(0);
  }
  for (const w of s.wrecks) expect(w.value, "wreck spent below zero").toBeGreaterThan(0);
  for (const u of s.units) if (u.ammo !== undefined) expect(u.ammo >= 0).toBe(true);
}

/** A run that starts rich and tough with every card, so the fuzzer reaches everything. */
function loaded(seed: number): GameState {
  let s = reduce(createGame(seed), { type: "start", seed });
  s = reduce(s, { type: "loadout", pick: (["lootbox", "mine", "buddy"] as const)[seed % 3] });
  const ids = [...REWARD_POOL, ...REWARD_POOL.filter((c) => CARDS[c].deploys), "BUILDER", "BUILDER", "LEECH", "LEECH"] as CardId[];
  s = reduce(s, { type: "qa", cmd: "hand", s: ids.join(",") });
  s.hand = [];
  for (const v of VARIANTS) if (seed % 2) s.deck.find((c) => c.id === v.card && !c.variant)!.variant = v.id;
  s = reduce(s, { type: "qa", cmd: "recruit", n: 70 });
  if (seed % 2) s = reduce(s, { type: "qa", cmd: "recruit", n: 50 });
  s = reduce(s, { type: "qa", cmd: "item", s: "sidearm,medkit,muffle,plockbands,shackles,tracker,scanner,sync" });
  if (seed % 3 === 0) s = reduce(s, { type: "qa", cmd: "parts", n: 3 });
  if (seed % 2 === 0) s.threat = 6; // stalkers start hunting from the next room
  s.scrap = 40;
  s.energyCap = 3;
  s.jubeyMax = 25;
  for (const u of s.units) if (u.kind === "jubey") u.hp = u.maxHp = 25;
  return s;
}

const seen = new Set<string>();
const played = new Set<string>();
const endings = new Set<string>();
const statuses = new Set<string>();
const brief6 = new Set<string>();
function note6(s: GameState) {
  for (const st of s.stalkers) brief6.add("stalker:" + st.state);
  if (s.pods.some((p) => p.opened)) brief6.add("pod:opened");
  if (s.buddy.rebuilt > 0) brief6.add("buddy:rebuilt");
  if (s.units.some((u) => u.gear?.some((g) => g.revealed))) brief6.add("gear:revealed");
  if (s.units.some((u) => u.plan?.type === "reload")) brief6.add("reload");
}

describe("engine", () => {
  it("starts on the loadout screen with the starting deck", () => {
    const s = reduce(createGame(7), { type: "start", seed: 7 });
    expect(s.phase).toBe("loadout");
    expect(s.deck.map((c) => c.id).sort()).toEqual([...STARTING_DECK].sort());
  });

  it("is deterministic for a seed", () => {
    for (const seed of [1, 42, 9001]) expect(playRun(seed, GREEDY).final).toEqual(playRun(seed, GREEDY).final);
  });

  it("does not mutate the previous state", () => {
    const s = reduce(reduce(createGame(3), { type: "start", seed: 3 }), { type: "loadout", pick: "buddy" });
    const frozen = JSON.stringify(s);
    reduce(s, { type: "pickPath", risky: true });
    expect(JSON.stringify(s)).toBe(frozen);
  });

  it("heuristic bots finish 300 runs with invariants intact", () => {
    for (const style of [PASSIVE, CAREFUL, { ...GREEDY, legs: 3 }]) {
      for (let seed = 1; seed <= 100; seed++) {
        const r = playRun(seed * 31 + 5, style);
        expect(["win", "dead"]).toContain(r.final.phase);
        checkInvariants(r.final);
      }
    }
  }, 120_000);

  it.each(Array.from({ length: 13 }, (_, i) => 1 + i * 20))("random play from a fully loaded start: 20 runs from seed %i, every state checked", async (from) => {
    for (let seed = from; seed < from + 20; seed++) {
      await new Promise((r) => setTimeout(r, 0)); // let the test runner breathe
      let s = loaded(seed);
      let x = seed * 2654435761 >>> 0 || 1;
      const rnd = () => ((x ^= x << 13), (x ^= x >>> 17), (x ^= x << 5), (x >>>= 0), x / 4294967296);
      for (let i = 0; i < 900 && s.phase !== "win" && s.phase !== "dead"; i++) {
        const acts = legalActions(s);
        expect(acts.length).toBeGreaterThan(0);
        let a = acts[Math.floor(rnd() * acts.length)];
        if (s.phase === "player" && rnd() < 0.2) a = { type: "endTurn" };
        if (s.phase === "decon") a = { type: "decon", deeper: rnd() < 0.85 };
        // Memory Tap has a target only for a moment: take it when it does, half the time.
        const tap = acts.find((x) => x.type === "play" && s.hand.find((c) => c.uid === x.uid)?.id === "MEMTAP");
        if (tap && rnd() < 0.5) a = tap;
        if (a.type === "play") played.add(s.hand.find((c) => c.uid === (a as { uid: string }).uid)!.id);
        if (a.type === "pilot") played.add("pilot:" + a.op + (a.op === "assign" ? (a.target === "foot" ? ":foot" : a.target ? ":frame" : "") : ""));
        s = reduce(s, a);
        if (s.event) seen.add(s.event.id);
        if (!["active", "disrupted", "dormant"].includes(s.team.pursuit)) endings.add(s.team.pursuit);
        for (const p of s.team.pilots) statuses.add(p.status);
        note6(s);
        checkInvariants(s);
      }
    }
  }, 200_000);

  it("random play reached every event, card, pilot action and ending", () => {
    for (const id of ["hallway", "hw-maint", "hw-behind", "hw-salvage", "hw-circle", "hw-eats", "patient", "yard", "remembers", "scared", "choice", "custody", "r8-recovery", "r8-brawler", "r8-relay", "r8-talk", "prisoner", "mech", "cargo", "fleeing", "recovery"]) expect(seen.has(id), `event ${id} never opened`).toBe(true);
    for (const id of REWARD_POOL) expect(played.has(id), `card ${id} never played`).toBe(true);
    for (const op of ["equip", "unequip", "assign:foot", "assign:frame", "talk", "treat", "stat", "unlock"]) expect(played.has("pilot:" + op), `pilot op ${op} never used`).toBe(true);
    expect(endings.size, "no run ever ended the pursuit").toBeGreaterThanOrEqual(1);
    for (const k of ["stalker:hunting", "stalker:intercepting", "stalker:engaged", "stalker:defeated", "pod:opened", "gear:revealed", "reload"]) expect(brief6.has(k), `${k} never happened: ${[...brief6].join(", ")}`).toBe(true);
    expect(statuses.has("dead") && (statuses.has("escaped") || statuses.has("withdrawn")), `pilot outcomes seen: ${[...statuses].join(", ")}`).toBe(true);
  });

  it("a save made mid-event or mid-fight reloads to the same future", () => {
    for (let seed = 1; seed <= 40; seed++) {
      let s = loaded(seed);
      let x = seed * 40503 || 1;
      const rnd = () => ((x ^= x << 13), (x ^= x >>> 17), (x ^= x << 5), (x >>>= 0), x / 4294967296);
      for (let i = 0; i < 120 && s.phase !== "win" && s.phase !== "dead"; i++) {
        const acts = legalActions(s);
        const a = acts[Math.floor(rnd() * acts.length)];
        const direct = reduce(s, a);
        expect(reduce(sane(s), a)).toEqual(direct);
        s = direct;
      }
    }
  }, 120_000);

  it("random play with the plain starting deck also holds up", () => {
    for (let seed = 1; seed <= 150; seed++) randomRun(seed * 17 + 3, 1500, (s) => checkInvariants(s));
  }, 120_000);

  it("ignores illegal actions", () => {
    const s = reduce(reduce(createGame(5), { type: "start", seed: 5 }), { type: "loadout", pick: "mine" });
    expect(reduce(s, { type: "buyHp" }).scrap).toBe(s.scrap);
    expect(reduce(s, { type: "endTurn" }).phase).toBe("route");
    expect(reduce(s, { type: "play", uid: "nope" }).phase).toBe("route");
    expect(reduce(s, { type: "event", option: "follow" }).phase).toBe("route");
    expect(reduce(s, { type: "decon", deeper: true }).phase).toBe("route");
  });
});
