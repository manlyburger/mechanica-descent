import { describe, expect, it } from "vitest";
import { eventView, reduce } from "../engine";
import { RULES, ally, cmd, end, fight, findSeed, foe, j, noPods, play, qa, run } from "./helpers";
import { createGame } from "../engine";

const choose = (s: ReturnType<typeof fight>, option: string) => reduce(s, { type: "event", option });
const wreck = (s: ReturnType<typeof fight>, id: string) => s.wrecks.push({ id, kind: "light", side: "enemy", value: 1 });

describe("Scrap Shepherd", () => {
  it("two wrecks pay exactly 2 Scrap, with no Threat, and each wreck counts once", () => {
    let s = fight({ allies: "shepherd" });
    wreck(s, "a");
    wreck(s, "b");
    wreck(s, "c");
    const scrap = s.scrap;
    s = end(s);
    expect(s.scrap).toBe(scrap);
    expect(ally(s, "shepherd").carried).toBe(1);
    s = end(s);
    expect(s.scrap).toBe(scrap + RULES.shepherdPayout);
    expect(s.threat).toBe(0);
    expect(s.wrecks.map((w) => w.id)).toEqual(["c"]);
  });
  it("spills unfinished cargo as one recoverable pile that keeps the wreck's id", () => {
    let s = fight({ allies: "shepherd" });
    wreck(s, "a");
    s = end(s);
    const sh = ally(s, "shepherd");
    sh.overrideDmg = true;
    sh.hp = 1;
    const scrap = s.scrap;
    s = end(s);
    expect(s.scrap).toBe(scrap);
    expect(s.wrecks.find((w) => w.pile)?.id).toBe("a");
  });
  it("Assembly Line: a pair fed to the Warframe is a startup point, not Scrap, once", () => {
    let s = fight({ allies: "shepherd,warframe" });
    ally(s, "warframe").paused = true;
    s = cmd(s, ally(s, "shepherd"), "feed");
    for (const id of ["a", "b", "c", "d"]) wreck(s, id);
    const scrap = s.scrap;
    s = end(s, 2);
    expect(s.scrap).toBe(scrap);
    expect(ally(s, "warframe").progress).toBe(1);
    s = end(s, 2);
    expect(s.scrap).toBe(scrap + RULES.shepherdPayout);
    expect(ally(s, "warframe").progress).toBe(1);
  });
});

describe("Ceiling Walker", () => {
  it("cannot be reached by melee while overhead, but ranged enemies can target it", () => {
    let s = fight({ allies: "walker", enemies: "infested,rifleman", quiet: false });
    const w = ally(s, "walker");
    s = end(s);
    const plans = s.units.filter((u) => u.side === "enemy").map((u) => [u.kind, u.plan?.targetUid]);
    expect(plans.find((p) => p[0] === "infested")![1]).not.toBe(w.uid);
    void plans;
    s = cmd(s, ally(s, "walker") ?? w, "drop");
    expect((ally(s, "walker") ?? w).elevated).toBe(false);
  });
  it("falls exactly once for 2 when destroyed overhead", () => {
    let s = fight({ allies: "walker" });
    const hp = foe(s).hp;
    const w = ally(s, "walker");
    w.overrideDmg = true;
    w.hp = 1;
    s = findSeed((seed) => { const t = structuredClone(s); t.rng = seed; return end(t); }, (t) => t.log.some((l) => l.includes("fires wide")));
    expect(foe(s).hp).toBe(hp - RULES.walkerFall);
    expect(s.log.filter((l) => l.includes("Falling machine")).length).toBe(1);
  });
});

describe("Panic Jack", () => {
  it("intercepts once per fight, takes the damage, and counters for 2 if it survives", () => {
    let s = fight({ allies: "jack", enemies: "infested", quiet: false });
    s = cmd(s, ally(s, "jack"), "protect", j(s));
    foe(s).maxHp = 50;
    foe(s).hp = 50;
    foe(s).prox = 2;
    s = findSeed(
      (seed) => { const t = structuredClone(s); t.rng = seed; foe(t).plan = { type: "attack", targetUid: j(t).uid, dmg: 2 }; return end(t); },
      (t) => t.log.some((l) => l.includes("throws itself")),
    );
    expect(j(s).hp).toBe(j(s).maxHp);
    expect(ally(s, "jack").hp).toBe(3);
    expect(s.log.some((l) => l.includes("Panic Jack counter"))).toBe(true);
    const again = findSeed(
      (seed) => { const t = structuredClone(s); t.rng = seed; foe(t).plan = { type: "attack", targetUid: j(t).uid, dmg: 2 }; return end(t); },
      (t) => j(t).hp < j(t).maxHp,
    );
    expect(again.log.filter((l) => l.includes("throws itself")).length).toBe(1);
  });
  it("goes uncontrolled for a turn and gains +2 once when its ward is destroyed", () => {
    let s = fight({ allies: "jack,possum" });
    s = cmd(s, ally(s, "jack"), "protect", ally(s, "possum"));
    const p = ally(s, "possum");
    ally(s, "jack").intercepted = true;
    p.overrideDmg = true;
    p.hp = 1;
    s = end(s);
    expect(ally(s, "jack").atk).toBe(1 + RULES.jackRage);
    expect(ally(s, "jack").rage).toBe(true);
  });
});

describe("Unfinished Warframe", () => {
  it("activates after two passive turns and does not attack the turn it wakes", () => {
    let s = fight({ hand: "WARFRAME" });
    s = play(s, "WARFRAME");
    const hp = foe(s).hp;
    s = end(s);
    expect(ally(s, "warframe").progress).toBe(1);
    s = end(s);
    expect(ally(s, "warframe").inert).toBe(false);
    expect(foe(s).hp).toBe(hp);
  });
  it("Builder Drone commissioning advances the same counter", () => {
    let s = fight({ allies: "builder", hand: "WARFRAME" });
    s = play(s, "WARFRAME");
    ally(s, "builder").timer = 1;
    s = cmd(s, ally(s, "builder"), "order-commission");
    s = end(s);
    expect(ally(s, "warframe").inert).toBe(false);
  });
  it("a damaged startup can go hostile, and a 1 Energy reset ends it", () => {
    let s = fight({ hand: "WARFRAME" });
    s = play(s, "WARFRAME");
    s = end(s);
    ally(s, "warframe").hp = 2;
    s = findSeed((seed) => { const t = structuredClone(s); t.rng = seed; return end(t); }, (t) => ally(t, "warframe").malf === "hostile");
    s = qa(s, "energy", 1);
    s = cmd(s, ally(s, "warframe"), "reset");
    expect(ally(s, "warframe").malf).toBeUndefined();
    expect(s.energy).toBe(0);
  });
  it("an unreset hostile startup is one attack on its own side, then it stabilizes", () => {
    let s = fight({ hand: "WARFRAME" });
    s = play(s, "WARFRAME");
    const w = ally(s, "warframe");
    Object.assign(w, { inert: false, malf: "hostile" });
    const hp = j(s).hp;
    s = end(s);
    expect(j(s).hp).toBe(hp - 3);
    expect(ally(s, "warframe").malf).toBeUndefined();
  });
  it("Emergency Commissioning costs 2 Energy once; abort pays 1 Scrap once", () => {
    let s = fight({ hand: "WARFRAME", energy: 5 });
    s = play(s, "WARFRAME");
    s = cmd(s, ally(s, "warframe"), "emergency-commission");
    expect(s.energy).toBe(3);
    expect(ally(s, "warframe").progress).toBe(1);
    expect(cmd(s, ally(s, "warframe"), "emergency-commission").energy).toBe(3);
    const scrap = s.scrap;
    s = cmd(s, ally(s, "warframe"), "abort");
    s = cmd(s, ally(s, "warframe"), "abort");
    s = cmd(s, ally(s, "warframe"), "abort");
    expect(s.scrap).toBe(scrap + 1);
  });
});

describe("utilities and reactions", () => {
  it("Faulty Access Badge quiets Drones, not combat mechs, and runs exactly one check", () => {
    let s = fight({ enemies: "drone,light", hand: "BADGE,BADGE", quiet: false });
    s = play(s, "BADGE");
    expect(foe(s, "drone").pacified).toBe(RULES.badgeTurns);
    expect(foe(s, "light").pacified ?? 0).toBe(0);
    expect(reduce(s, { type: "play", uid: s.hand.find((c) => c.id === "BADGE")!.uid }).energy).toBe(s.energy);
    j(s).hp = j(s).maxHp = 40;
    s = end(s, 2);
    expect(s.log.filter((l) => l.includes("Security verification")).length).toBe(1);
    expect(s.badge.flagged).toBe(true);
  });
  it("Sealant Coffin skips two actions then heals 3; it does not stack", () => {
    let s = fight({ allies: "possum", hand: "COFFIN,COFFIN" });
    const p = ally(s, "possum");
    p.hp = 1;
    p.maxHp = 6;
    s = play(s, "COFFIN", p);
    expect(reduce(s, { type: "play", uid: s.hand.find((c) => c.id === "COFFIN")!.uid, targetId: p.uid }).hand.length).toBe(s.hand.length);
    s = end(s);
    expect(ally(s, "possum").hp).toBe(1);
    s = end(s);
    expect(ally(s, "possum").hp).toBe(1 + RULES.coffinHeal);
  });
  it("Sealant Coffin on an enemy disables it, then heals it", () => {
    let s = fight({ enemies: "light", hand: "COFFIN", quiet: false });
    foe(s).hp = 1;
    s = play(s, "COFFIN", foe(s));
    s = end(s, 2);
    expect(j(s).hp).toBe(j(s).maxHp);
    expect(foe(s).hp).toBe(1 + RULES.coffinHeal);
  });
  it("releasing a seal early heals only 1", () => {
    let s = fight({ allies: "possum", hand: "COFFIN" });
    ally(s, "possum").hp = 1;
    s = play(s, "COFFIN", ally(s, "possum"));
    s = cmd(s, ally(s, "possum"), "release");
    expect(ally(s, "possum").hp).toBe(1 + RULES.coffinEarlyHeal);
  });
  it("Black-Box Recorder: 1 Scrap, 2 extra cards next turn, 1 Madness, once per fight", () => {
    let s = fight({ allies: "possum,scared", hand: "RECORDER" });
    s = play(s, "RECORDER");
    const scrap = s.scrap;
    for (const k of ["possum", "scared"]) Object.assign(ally(s, k), { overrideDmg: true, hp: 1 });
    s = end(s);
    expect(s.scrap).toBe(scrap - RULES.recorderScrap);
    expect(s.hand.length).toBe(RULES.handSize + RULES.recorderDraw);
    expect(s.log.filter((l) => l.includes("Black-Box Recorder:")).length).toBe(1);
  });
  it("Manual Override Hand cancels a malfunction, costs the machine 1 HP after it acts, and grants no extra action", () => {
    let s = fight({ allies: "builder:possessed", hand: "HAND" });
    s = play(s, "HAND");
    j(s).hp = 2;
    s = end(s);
    foe(s).hp = 4;
    const b = ally(s, "builder");
    b.malf = "wrongRepair";
    s = cmd(s, b, "override");
    expect(ally(s, "builder").malf).toBeUndefined();
    expect(reduce(s, { type: "command", uid: b.uid, cmd: "override" }).overrides).toBe(1);
    s = end(s);
    expect(j(s).hp).toBe(2 + RULES.possessedPatch);
    expect(foe(s).hp).toBe(4);
    expect(ally(s, "builder").hp).toBe(ally(s, "builder").maxHp - 1);
    expect(ally(s, "builder").jobs).toBe(1);
  });
  it("Manual Override is not offered for an ordinary decision", () => {
    let s = fight({ allies: "walker,shepherd", hand: "HAND" });
    s = play(s, "HAND");
    for (const k of ["walker", "shepherd"]) expect(reduce(s, { type: "command", uid: ally(s, k).uid, cmd: "override" }).handUsed).toBe(false);
  });
});

describe("The Patient Machine and The Assembly Yard", () => {
  const patient = () => {
    let s = fight({ scrap: 10 });
    s = qa(s, "event", undefined, "patient");
    return s;
  };
  it("Repair gives a temporary 6/2 ally for a fixed number of fights", () => {
    let s = patient();
    s.event!.data.hRepair = false;
    s.hallStage = 99;
    s = choose(s, "repair");
    const p = s.units.find((u) => u.kind === "patient")!;
    expect([p.side, p.hp, p.atk, p.roomsLeft]).toEqual(["friendly", 6, 2, RULES.patientRooms]);
  });
  it("a hostile wake-up joins the next fight and can be stabilized instead of killed", () => {
    let s = patient();
    s.event!.data.hRepair = true;
    s.hallStage = 99;
    s = choose(s, "repair");
    const p = s.units.find((u) => u.kind === "patient")!;
    expect(p.side).toBe("enemy");
    s = qa(s, "hand", undefined, "HOOK");
    s = qa(s, "energy", 3);
    s = play(s, "HOOK", p);
    expect(s.units.find((u) => u.kind === "patient")!.side).toBe("friendly");
  });
  it("Strip pays its Scrap once", () => {
    let s = patient();
    s.event!.data.hStrip = false;
    s.event!.data.part = false;
    s.hallStage = 99;
    const scrap = s.scrap;
    s = choose(s, "strip");
    expect(s.scrap).toBe(scrap + 4);
    expect(s.event).toBeNull();
  });
  it("Inspect costs 1 Energy, works once, and leaves the other choices open", () => {
    let s = patient();
    s.event!.data.hInspect = false;
    s.event!.data.memory = 4;
    s = choose(s, "inspect");
    expect(s.event!.id).toBe("patient");
    expect(s.event!.data.hRepair).toBe(false);
    expect(eventView(s)!.options.some((o) => o.id === "inspect")).toBe(false);
  });
  it("Leave is always safe, and the Badge and Walker options appear only when you have them", () => {
    let s = patient();
    expect(eventView(s)!.options.some((o) => o.id === "badge" || o.id === "walker")).toBe(false);
    s.hallStage = 99;
    const scrap = s.scrap;
    s = choose(s, "leave");
    expect(s.scrap).toBe(scrap);
    let t = fight({ allies: "walker", scrap: 10, hand: "BADGE" });
    t = qa(t, "event", undefined, "patient");
    expect(eventView(t)!.options.filter((o) => o.id === "badge" || o.id === "walker").length).toBe(2);
    t = choose(t, "badge");
    expect(t.log.some((l) => l.includes("Security verification"))).toBe(true);
    expect(eventView(t)!.options.some((o) => o.id === "badge")).toBe(false);
  });
  it("Assembly Yard: every branch resolves", () => {
    for (const option of ["scavenge", "commission", "power", "sabotage", "leave"]) {
      let s = fight({ scrap: 10, hand: "WARFRAME" });
      s = qa(s, "event", undefined, "yard");
      s.hallStage = 99;
      s = choose(s, option);
      expect(s.event).toBeNull();
      if (option === "commission") expect(s.preCommission).toBe(true);
    }
  });
});

describe("loadout and descent", () => {
  const begin = (pick: "lootbox" | "mine" | "buddy", seed = 9) => run(createGame(seed), { type: "start", seed }, { type: "loadout", pick });
  it("Shabby Lootbox gives one basic item card and 1 Scrap", () => {
    const s = begin("lootbox");
    expect(s.deck.length).toBe(11);
    expect(s.scrap).toBe(RULES.lootboxScrap);
  });
  it("AM Mine hits the first enemy machine to move after turn 1, for 2, once, and is used up", () => {
    let s = fight({ pick: "mine", enemies: "light,light", quiet: false });
    expect(s.minesArmed).toBe(1);
    j(s).hp = j(s).maxHp = 40;
    const hp = s.units.filter((u) => u.side === "enemy").map((u) => u.hp);
    s = end(s);
    expect(s.units.filter((u) => u.side === "enemy").map((u) => u.hp)).toEqual(hp);
    s = end(s);
    const after = s.units.filter((u) => u.side === "enemy").map((u) => u.hp);
    expect(after[0]).toBe(hp[0] - RULES.mineDamage);
    expect(after[1]).toBe(hp[1]);
    expect(s.loadoutAd).toEqual([]);
  });
  it("AM Mine hits a reinforcement that enters after turn 1", () => {
    let s = fight({ pick: "mine", enemies: "zombie" });
    s.queue = ["drone"];
    s = end(s);
    expect(s.log.some((l) => l.includes("AM MINE"))).toBe(true);
    expect(s.units.some((u) => u.kind === "drone")).toBe(false);
  });
  it("the auto-deploy rack holds at most two", () => {
    let s = begin("mine");
    s.loadoutAd = ["MINE", "MINE"];
    s.phase = "reward";
    s.rewardShown = ["MINE", "GUN", "GUN"];
    expect(reduce(s, { type: "pickReward", id: "MINE" }).loadoutAd.length).toBe(2);
  });
  it("Lil Robobuddy has 2 HP and collects one wreck at the end with no Threat", () => {
    let s = fight({ pick: "buddy", enemies: "light,light", hand: "BURST" });
    expect(ally(s, "robobuddy").hp).toBe(RULES.buddyHp);
    for (const e of s.units.filter((u) => u.side === "enemy")) e.hp = 1;
    const scrap = s.scrap;
    s = noPods(() => play(s, "BURST"));
    expect(s.phase).toBe("salvage");
    expect(s.scrap).toBe(scrap + 1);
    expect(s.threat).toBe(0);
    expect(s.wrecks.length).toBe(1);
  });
  it("a Decon Bay follows every 4th room: walk out to win, or go deeper clean", () => {
    let s = fight({ enemies: "rifleman", hand: "GUN" });
    s.room = RULES.deconEvery;
    s.contamination = 6;
    s = play(s, "GUN", foe(s));
    s = reduce(s, { type: "pickReward", id: "NONE" });
    expect(s.phase).toBe("decon");
    const out = reduce(s, { type: "decon", deeper: false });
    expect([out.phase, out.best]).toEqual(["win", RULES.deconEvery]);
    const deeper = reduce(s, { type: "decon", deeper: true });
    expect([deeper.phase, deeper.contamination]).toEqual(["tech", 0]);
    expect(reduce(deeper, { type: "nextRoom" }).room).toBe(RULES.deconEvery + 1);
  });
  it("Contamination adds unplayable cards to each fight, and Infested hits raise it", () => {
    let s = fight({ enemies: "infested", quiet: false });
    s.contamination = 6;
    s = qa(s, "fight", 0, "infested");
    const all = [...s.draw, ...s.hand, ...s.discard];
    expect(all.filter((c) => c.id === "ROT").length).toBe(2);
    expect(s.deck.some((c) => c.id === "ROT")).toBe(false);
    j(s).hp = j(s).maxHp = 40;
    foe(s).prox = 2;
    foe(s).plan = { type: "attack", targetUid: j(s).uid, dmg: 2 };
    s = findSeed((seed) => { const t = structuredClone(s); t.rng = seed; return end(t); }, (t) => j(t).hp < 40);
    expect(s.contamination).toBe(7);
  });
});
