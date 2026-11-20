import { describe, expect, it } from "vitest";
import { eventView, reduce } from "../engine";
import { RULES, ally, card, cmd, end, fight, findSeed, foe, j, play, qa } from "./helpers";

describe("Half-Awake Builder Drone", () => {
  it("repairs when only a repair is possible", () => {
    let s = fight({ allies: "builder" });
    ally(s, "builder").sorted = RULES.builderSortCap; // reset each fight, so set after setup
    j(s).hp = 2;
    s = end(s);
    ally(s, "builder").sorted = RULES.builderSortCap;
    s = end(s);
    expect(j(s).hp).toBe(2 + RULES.builderPatch);
  });
  it("idles without losing its turn when nothing is possible", () => {
    let s = fight({ allies: "builder" });
    s = end(s);
    ally(s, "builder").sorted = RULES.builderSortCap;
    const scrap = s.scrap;
    s = end(s);
    expect(s.scrap).toBe(scrap);
    expect(ally(s, "builder").timer).toBe(0);
    expect(ally(s, "builder").jobs ?? 0).toBe(0);
  });
  it("picks one of the two jobs when both are possible", () => {
    let s = fight({ allies: "builder" });
    j(s).hp = 2;
    const scrap = s.scrap;
    s = end(s, 2);
    const repaired = j(s).hp === 2 + RULES.builderPatch;
    const sorted = s.scrap === scrap + RULES.builderSort;
    expect(repaired !== sorted).toBe(true);
  });
  it("Emergency Repair costs 1 Energy, heals 1, once a turn, and leaves the cycle alone", () => {
    let s = fight({ allies: "builder", energy: 3 });
    j(s).hp = 2;
    const timer = ally(s, "builder").timer;
    s = cmd(s, ally(s, "builder"), "emergency", j(s));
    expect(j(s).hp).toBe(3);
    expect(s.energy).toBe(2);
    expect(ally(s, "builder").timer).toBe(timer);
    s = cmd(s, ally(s, "builder"), "emergency", j(s));
    expect(j(s).hp).toBe(3);
  });
  it("destroyed before its maintenance turn: no job, and 1 Scrap is recovered once at room clear", () => {
    let s = fight({ allies: "builder", enemies: "drone", hand: "SLUG" });
    const scrap = s.scrap;
    ally(s, "builder").hp = 0;
    s.units = s.units.filter((u) => u.kind !== "builder");
    s.wrecks.push({ id: "wb", kind: "builder", side: "friendly", value: 1, free: true });
    s = play(s, "SLUG", foe(s));
    expect(s.phase).not.toBe("player");
    expect(s.scrap).toBe(scrap + 1);
    expect(s.wrecks.some((w) => w.id === "wb")).toBe(false);
  });
  it("Overworked Drone works every turn and burns 1 HP after its third job", () => {
    let s = fight({ allies: "builder:overworked" });
    s = end(s, 3);
    const b = ally(s, "builder");
    expect(b.jobs).toBe(3);
    expect(b.hp).toBe(b.maxHp - 1);
  });
  it("Possessed Builder repairs an enemy when it malfunctions", () => {
    let s = fight({ allies: "builder:possessed" });
    j(s).hp = 2;
    s = end(s);
    foe(s).hp = 4;
    ally(s, "builder").malf = "wrongRepair";
    s = end(s);
    expect(foe(s).hp).toBe(4 + RULES.possessedPatch);
    expect(j(s).hp).toBe(2);
  });
  it("Fully Awake Drone does the job you ordered", () => {
    let s = fight({ allies: "builder:awake" });
    j(s).hp = 2;
    s = cmd(s, ally(s, "builder"), "order-sort");
    const scrap = s.scrap;
    s = end(s);
    s = cmd(s, ally(s, "builder"), "order-sort");
    s = end(s);
    expect(s.scrap).toBe(scrap + RULES.builderSort);
    expect(j(s).hp).toBe(2);
  });
  it("Scavenger Drone sorts 2 and never repairs", () => {
    let s = fight({ allies: "builder:scavenger" });
    j(s).hp = 1;
    const scrap = s.scrap;
    s = end(s, 2);
    expect(s.scrap).toBe(scrap + RULES.scavengerSort);
    expect(j(s).hp).toBe(1);
  });
  it("goes to an ally's wreck and salvages it once", () => {
    let s = fight({ allies: "builder,possum", enemies: "light", quiet: false });
    foe(s).stunned = 0;
    const p = ally(s, "possum");
    p.hp = 1;
    s = findSeed(
      (seed) => {
        const t = structuredClone(s);
        t.rng = seed;
        foe(t).plan = { type: "attack", targetUid: p.uid, dmg: 1 };
        return end(t);
      },
      (t) => !t.units.some((u) => u.kind === "possum"),
    );
    expect(ally(s, "builder").remember).toBeTruthy();
    for (const e of s.units.filter((u) => u.side === "enemy")) e.stunned = 99;
    const scrap = s.scrap;
    s = end(s);
    expect(s.scrap).toBe(scrap + 1);
    expect(s.wrecks.filter((w) => w.kind === "possum").length).toBe(0);
  });
});

describe("Salvage Leech", () => {
  const leeched = (variant = "") => {
    let s = fight({ hand: `LEECH${variant},GUN,GUN,SLUG,SLUG` });
    s = play(s, "LEECH", foe(s));
    return s;
  };

  it("needs 3 damage in one turn: 2 is not enough", () => {
    let s = leeched();
    const scrap = s.scrap;
    foe(s).hp = 10;
    s = qa(s, "hand", undefined, "FUEL");
    s = play(s, "FUEL", foe(s)); // 2 damage
    expect(s.scrap).toBe(scrap);
    expect(foe(s).leech!.count).toBe(0);
  });
  it("exactly 3 triggers one extraction", () => {
    let s = leeched();
    const scrap = s.scrap;
    s = qa(s, "hand", undefined, "CRANE");
    s = play(s, "CRANE", foe(s).slot); // 3 damage
    expect(s.scrap).toBe(scrap + 1);
    expect(foe(s).leech!.count).toBe(1);
  });
  it("several hits add up, and it fires once per turn", () => {
    let s = leeched();
    const scrap = s.scrap;
    s = qa(s, "hand", undefined, "FUEL,FUEL,SLUG");
    s = play(s, "FUEL", foe(s));
    expect(s.scrap).toBe(scrap);
    s = play(s, "FUEL", foe(s));
    expect(s.scrap).toBe(scrap + 1);
    s = play(s, "SLUG", foe(s));
    expect(s.scrap).toBe(scrap + 1);
  });
  it("strips 1 Armor once, after the second extraction", () => {
    let s = leeched();
    foe(s).armor = 2;
    foe(s).maxHp = 40;
    foe(s).hp = 40;
    s = qa(s, "hand", undefined, "CRANE,CRANE");
    s = qa(s, "hand", undefined, "SLUG");
    s = play(s, "SLUG", foe(s)); // 5 - 2 armor = 3
    expect(foe(s).armor).toBe(2);
    s = end(s);
    foe(s).stunned = 99;
    s = qa(s, "hand", undefined, "SLUG");
    s = qa(s, "energy", 9);
    s = play(s, "SLUG", foe(s));
    expect(foe(s).armor).toBe(1);
    expect(foe(s).leech!.stripped).toBe(true);
    s = end(s);
    foe(s).stunned = 99;
    s = qa(s, "hand", undefined, "SLUG");
    s = qa(s, "energy", 9);
    s = play(s, "SLUG", foe(s)); // third pull: no further strip
    expect(foe(s).armor).toBe(1);
  });
  it("resolves the last extraction before the host dies, then either returns the card or loses it for the fight", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      let s = fight({ seed, enemies: "light,zombie", hand: "LEECH,SLUG" });
      const host = foe(s, "light");
      const id = card(s, "LEECH").uid;
      const scrap = s.scrap;
      s = play(s, "LEECH", host);
      s = play(s, "SLUG", host); // 5 damage kills a 4 HP Light
      expect(s.units.some((u) => u.uid === host.uid)).toBe(false);
      expect(s.scrap).toBe(scrap - 1 + 1); // paid 1, extracted 1
      expect(s.deck.some((c) => c.uid === id)).toBe(true); // never lost from the deck
      const back = s.discard.some((c) => c.uid === id);
      const piles = [...s.draw, ...s.hand, ...s.discard].filter((c) => c.uid === id).length;
      expect(piles).toBe(back ? 1 : 0);
    }
  });
  it("a heavy host purges it; it lies on the floor for one turn and can be retrieved", () => {
    let s = leeched();
    const id = foe(s).leech!.cardUid;
    foe(s).stunned = 0;
    foe(s).plan = { type: "purge" };
    s = end(s);
    expect(s.ejected?.card.uid).toBe(id);
    s = qa(s, "energy", 2);
    s = cmd(s, "ejected", "retrieve");
    expect(s.ejected).toBeNull();
    expect(s.hand.some((c) => c.uid === id)).toBe(true);
    expect(s.energy).toBe(1);
  });
  it("is crushed if nobody picks it up", () => {
    let s = leeched();
    const id = foe(s).leech!.cardUid!;
    foe(s).stunned = 0;
    foe(s).plan = { type: "purge" };
    s = end(s);
    foe(s).stunned = 99;
    s = end(s);
    expect(s.ejected).toBeNull();
    expect([...s.draw, ...s.hand, ...s.discard].some((c) => c.uid === id)).toBe(false);
    expect(s.deck.some((c) => c.uid === id)).toBe(true);
  });
  it("a Builder Drone collects an ejected Leech", () => {
    let s = fight({ allies: "builder", hand: "LEECH" });
    s = play(s, "LEECH", foe(s));
    const id = foe(s).leech!.cardUid!;
    foe(s).stunned = 0;
    foe(s).plan = { type: "purge" };
    s = end(s);
    foe(s).stunned = 99;
    ally(s, "builder").timer = 1;
    s = end(s);
    expect(s.ejected).toBeNull();
    expect([...s.draw, ...s.hand, ...s.discard].some((c) => c.uid === id)).toBe(true);
  });
  it("Risky Extraction: +2 Scrap, 1 damage, Leech spent, no extra extraction", () => {
    let s = leeched();
    const scrap = s.scrap;
    const hp = foe(s).hp;
    foe(s).dmgTurn = 2; // one more point would normally trigger
    s = cmd(s, foe(s), "risky");
    expect(s.scrap).toBe(scrap + RULES.riskyExtractScrap);
    expect(foe(s).hp).toBe(hp - 1);
    expect(foe(s).leech).toBeUndefined();
    expect(reduce(s, { type: "command", uid: foe(s).uid, cmd: "risky" }).scrap).toBe(s.scrap);
  });
  it("Blood-Scrap Leech bites for 1 on each extraction without chaining", () => {
    let s = leeched(":blood");
    const hp = foe(s).hp;
    const scrap = s.scrap;
    s = qa(s, "hand", undefined, "CRANE");
    s = play(s, "CRANE", foe(s).slot);
    expect(foe(s).hp).toBe(hp - 3 - 1);
    expect(s.scrap).toBe(scrap + 1);
  });
  it("Symbiotic Leech pays on real repairs only, twice a fight", () => {
    let s = fight({ allies: "builder,possum", hand: "LEECH:symbiotic" });
    const p = ally(s, "possum");
    s = play(s, "LEECH", p);
    const scrap = s.scrap;
    s = cmd(s, ally(s, "builder"), "emergency", ally(s, "possum")); // full HP: not offered, no effect
    expect(s.scrap).toBe(scrap);
    for (let i = 0; i < 3; i++) {
      ally(s, "possum").hp = 1;
      ally(s, "builder").emergencyUsed = false;
      s = cmd(s, ally(s, "builder"), "emergency", ally(s, "possum"));
    }
    expect(s.scrap).toBe(scrap + RULES.symbioticMax);
  });
  it("Queen Salvager spawns one temporary offspring, which cannot spawn another", () => {
    let s = fight({ enemies: "light,light,light", hand: "LEECH:queen,SLUG,SLUG" });
    const [a, b] = s.units.filter((u) => u.side === "enemy");
    s = play(s, "LEECH", a);
    s = play(s, "SLUG", a);
    const hosts = s.units.filter((u) => u.leech);
    expect(hosts.length).toBe(1);
    expect(hosts[0].leech!.temp).toBe(true);
    s = reduce(s, { type: "play", uid: s.hand.find((c) => c.id === "SLUG")!.uid, targetId: hosts[0].uid });
    expect(s.units.filter((u) => u.leech).length).toBe(0);
    void b;
  });
});

describe("Armor and Powered Armor", () => {
  it("Powered Armor has 3 HP and 1 Armor", () => {
    const s = fight({ enemies: "powered" });
    expect([foe(s).hp, foe(s).armor]).toEqual([3, 1]);
  });
  it("Armor takes 1 off every instance of damage, and 1-damage hits do nothing", () => {
    let s = fight({ enemies: "powered", hand: "BURST,HOOK,WELDER" });
    s = play(s, "BURST"); // 1 damage
    expect(foe(s).hp).toBe(3);
    s = play(s, "HOOK", foe(s)); // 2 damage
    expect(foe(s).hp).toBe(2);
    s = play(s, "WELDER", foe(s)); // 1 damage, then Burn 3
    expect(foe(s).hp).toBe(2);
    s = end(s, 3); // three burn ticks of 1 each
    expect(foe(s).hp).toBe(2);
  });
  it("each hit is reduced separately, not the turn's total", () => {
    let s = fight({ enemies: "powered,powered", hand: "CRANE" });
    s = play(s, "CRANE", 0); // 3 to each, 2 after armor
    expect(s.units.filter((u) => u.side === "enemy").map((u) => u.hp)).toEqual([1, 1]);
  });
  it("leaves a wreck and can host a Leech", () => {
    let s = fight({ enemies: "powered,zombie", hand: "LEECH,SLUG" });
    const p = foe(s, "powered");
    s = play(s, "LEECH", p);
    s = play(s, "SLUG", p); // 4 after armor: dies, and the Leech extracts first
    expect(s.wrecks.some((w) => w.kind === "powered")).toBe(true);
    expect(s.log.some((l) => l.includes("extracts from Powered Armor"))).toBe(true);
  });
});

describe("other brief-1 cards", () => {
  it("Emergency Bulkhead takes hits for its ward, and Collapse prevents 2 for everyone", () => {
    let s = fight({ enemies: "infested", hand: "BULKHEAD", quiet: false });
    foe(s).prox = 2;
    foe(s).plan = { type: "attack", targetUid: j(s).uid, dmg: 2 };
    s = play(s, "BULKHEAD", j(s));
    s = findSeed((seed) => { const t = structuredClone(s); t.rng = seed; return end(t); }, (t) => ally(t, "bulkhead")?.hp === 4);
    expect(j(s).hp).toBe(j(s).maxHp);
    foe(s).plan = { type: "attack", targetUid: j(s).uid, dmg: 2 };
    s = cmd(s, ally(s, "bulkhead"), "collapse");
    expect(s.units.some((u) => u.kind === "bulkhead")).toBe(false);
    s = end(s);
    expect(j(s).hp).toBe(j(s).maxHp);
  });
  it("Threat Beacon pays once, raises Threat, and draws fire", () => {
    let s = fight({ enemies: "light", hand: "BEACON", quiet: false });
    const scrap = s.scrap;
    const id = card(s, "BEACON").uid;
    s = play(s, "BEACON");
    expect(s.scrap).toBe(scrap + RULES.beaconScrap);
    expect(s.threat).toBe(RULES.beaconThreat);
    expect(s.deck.some((c) => c.uid === id)).toBe(false);
    s = end(s);
    expect(foe(s).plan?.targetUid).toBe(ally(s, "beacon").uid);
  });
  it("Servo Limb adds +2 to the first melee card each turn only", () => {
    let s = fight({ hand: "SERVO,HOOK,HOOK" });
    s = play(s, "SERVO");
    const hp = foe(s).hp;
    s = play(s, "HOOK", foe(s));
    expect(foe(s).hp).toBe(hp - 4);
    s = play(s, "HOOK", foe(s));
    expect(foe(s).hp).toBe(hp - 6);
  });
  it("Servo Limb can swing again at high Madness, once", () => {
    const s = findSeed(
      (seed) => {
        let t = fight({ seed, enemies: "zombie", hand: "SERVO,HOOK" });
        t = play(t, "SERVO");
        t.madness = RULES.highMadness;
        t.hand = t.hand.filter((c) => c.id === "HOOK");
        const before = t.log.length;
        t = play(t, "HOOK", foe(t));
        return { t, before };
      },
      ({ t }) => t.log.some((l) => l.includes("swings again")),
    ).t;
    expect(s.log.filter((l) => l.includes("swings again")).length).toBe(1);
  });
  it("Cold Reactor Cell pays 1 Energy of a Tech card and rolls an outcome when it empties", () => {
    let s = fight({ hand: "CELL,FOAM,FOAM,FOAM", energy: 0 });
    const foams = s.hand.filter((c) => c.id === "FOAM").length;
    s = play(s, "CELL");
    expect(s.equip.cell).toBe(RULES.cellCharges);
    for (let i = 0; i < 3; i++) {
      foe(s).foam = false;
      s = play(s, "FOAM", foe(s));
    }
    expect(s.equip.cell).toBe(0);
    expect(s.log.some((l) => /discharges safely|empty Cell casing|REACTOR BURST/.test(l))).toBe(true);
    expect(s.hand.filter((c) => c.id === "FOAM").length).toBe(foams - 3);
  });
  it("a Cell charge does not pay for non-Tech cards", () => {
    let s = fight({ hand: "CELL,GUN", energy: 0 });
    s = play(s, "CELL");
    const hp = foe(s).hp;
    s = play(s, "GUN", foe(s));
    expect(foe(s).hp).toBe(hp);
  });
  it("Machine Possum plays dead after one hit and banks at most 3 Scrap a fight", () => {
    let s = fight({ allies: "possum", enemies: "rifleman,rifleman,rifleman,rifleman,zombie", hand: "BURST" });
    const scrap = s.scrap;
    s = play(s, "BURST");
    expect(ally(s, "possum").carried).toBe(RULES.possumCap);
    expect(s.scrap).toBe(scrap);
    s = qa(s, "hand", undefined, "SLUG,SLUG");
    foe(s).hp = 5;
    s.madness = 0; // the riflemen's Madness could make the Slug misfire
    s = play(s, "SLUG", foe(s));
    expect(s.scrap).toBe(scrap + RULES.possumCap);
  });
  it("Machine Possum cannot be targeted again the turn it is hit", () => {
    let s = fight({ allies: "possum", enemies: "rifleman,rifleman", quiet: false });
    const p = ally(s, "possum");
    s = findSeed(
      (seed) => {
        const t = structuredClone(s);
        t.rng = seed;
        for (const e of t.units.filter((u) => u.side === "enemy")) e.plan = { type: "attack", targetUid: p.uid, dmg: 1 };
        return end(t);
      },
      (t) => ally(t, "possum")?.hp === 2 && j(t).hp < j(t).maxHp,
    );
    expect(ally(s, "possum").hp).toBe(2);
  });
  it("Gun Nest crawls, clamps for +2, and never attacks twice in a turn", () => {
    let s = fight({ hand: "GUNNEST" });
    foe(s).slot = 5;
    foe(s).maxHp = 60;
    foe(s).hp = 60;
    s = play(s, "GUNNEST");
    const start = ally(s, "gunnest").slot;
    s = end(s);
    expect(Math.abs(ally(s, "gunnest").slot - 5)).toBe(Math.abs(start - 5) - 1);
    let guard = 0;
    while (!ally(s, "gunnest").clamp && guard++ < 6) s = end(s);
    expect(ally(s, "gunnest").clamp).toBe(foe(s).uid);
    const hp = foe(s).hp;
    s = findSeed((seed) => { const t = structuredClone(s); t.rng = seed; return end(t); }, (t) => foe(t).hp < hp);
    expect(hp - foe(s).hp).toBe(2 + RULES.nestClampBonus);
  });
  it("Red-Mouth adds +3 and 1 Madness and counts its rounds", () => {
    let s = fight({ hand: "REDMOUTH,SLUG" });
    const hp = foe(s).hp;
    s = play(s, "REDMOUTH");
    s = play(s, "SLUG", foe(s));
    expect(foe(s).hp).toBe(hp - 5 - RULES.redmouthBonus);
    expect(s.madness).toBe(1);
    expect(s.deck.find((c) => c.id === "REDMOUTH")!.rounds).toBe(RULES.redmouthRounds - 1);
  });
  it("Red-Mouth can pick its own target at high Madness", () => {
    const s = findSeed(
      (seed) => {
        let t = fight({ seed, enemies: "zombie,zombie,zombie", hand: "REDMOUTH,SLUG" });
        t.madness = RULES.highMadness;
        t.hand = t.hand.filter((c) => c.id === "REDMOUTH" || c.id === "SLUG");
        t = play(t, "REDMOUTH");
        return play(t, "SLUG", foe(t));
      },
      (t) => t.log.some((l) => l.includes("before you finish aiming")),
    );
    expect(s.log.some((l) => l.includes("WARNING"))).toBe(true);
  });
  it("Maintenance Foam hides an ally for a turn, then heals 2", () => {
    let s = fight({ allies: "possum", enemies: "rifleman", hand: "FOAM", quiet: false });
    ally(s, "possum").hp = 1;
    s = play(s, "FOAM", ally(s, "possum"));
    s = end(s);
    expect(ally(s, "possum").hp).toBe(1 + RULES.foamHeal);
    expect(ally(s, "possum").foam).toBe(false);
  });
  it("Maintenance Foam disables an ordinary enemy for one turn only", () => {
    let s = fight({ enemies: "light", hand: "FOAM", quiet: false });
    s = play(s, "FOAM", foe(s));
    s = end(s);
    expect(j(s).hp).toBe(j(s).maxHp);
    expect(foe(s).foam).toBe(false);
  });
  it("Dead Pilot's Reflex strikes for the lost machine's attack, once per turn", () => {
    let s = fight({ allies: "builder,scared", hand: "REFLEX" });
    s = play(s, "REFLEX");
    const hp = foe(s).hp;
    const kill = (kind: string) => {
      const u = ally(s, kind);
      s.hand.push({ uid: "t" + s.uidSeq++, id: "COFFIN" });
      u.overrideDmg = true;
      u.hp = 1;
    };
    kill("builder");
    kill("scared");
    s = end(s);
    expect(s.units.some((u) => u.kind === "builder" || u.kind === "scared")).toBe(false);
    expect(hp - foe(s).hp).toBeLessThanOrEqual(1 + 1 + 1); // one reflex (1) plus at most the allies' own shots
    expect(s.log.filter((l) => l.includes("Jubey's arm moves")).length).toBe(1);
    expect(s.madness).toBe(0); // +1, then the turn's decay
  });
});

describe("Wrong Hallway", () => {
  const anomaly = (o: Parameters<typeof fight>[0] = {}, next?: string) => {
    let s = fight({ enemies: "drone", hand: "HALLWAY,SLUG", ...o });
    s = play(s, "HALLWAY");
    s = play(s, "SLUG", foe(s));
    if (next) s.event!.data.next = next;
    return s;
  };
  const choose = (s: ReturnType<typeof fight>, option: string) => reduce(s, { type: "event", option });

  it("opens after the normal fight when the card was played", () => {
    const s = anomaly();
    expect(s.phase).toBe("event");
    expect(s.event!.id).toBe("hallway");
  });
  it("Force the Exit costs 2 Energy and pays 1 Scrap", () => {
    let s = anomaly();
    s.energyCap = 2;
    s.energy = 2;
    const scrap = s.scrap;
    s = choose(s, "force");
    expect(s.scrap).toBe(scrap + RULES.forceExitScrap);
    expect(["salvage", "reward"]).toContain(s.phase);
  });
  it("Force the Exit is visibly disabled without Energy, and another way out always exists", () => {
    const s = anomaly();
    const v = eventView(s)!;
    expect(v.options.find((o) => o.id === "force")!.enabled).toBe(false);
    expect(v.options.find((o) => o.id === "follow")!.enabled).toBe(true);
    expect(choose(s, "force").event!.id).toBe("hallway");
  });
  it("Search the Walls works once and does not end the hallway", () => {
    let s = anomaly();
    s = choose(s, "search");
    expect(s.event!.id).toBe("hallway");
    expect(eventView(s)!.options.find((o) => o.id === "search")!.enabled).toBe(false);
    const again = choose(s, "search");
    expect(again.scrap).toBe(s.scrap);
  });
  it("Follow the Noise reveals and enters the rolled event", () => {
    const s = choose(anomaly({}, "hw-salvage"), "follow");
    expect(s.event!.id).toBe("hw-salvage");
  });
  it("a Builder Drone can scout once; a separated drone comes back", () => {
    let s = anomaly({ allies: "builder" });
    expect(eventView(s)!.options.some((o) => o.id === "scout")).toBe(true);
    s.event!.data.scout = 0.7; // separated
    s = choose(s, "scout");
    expect(s.units.find((u) => u.kind === "builder")!.away).toBe(1);
    expect(eventView(s)!.options.some((o) => o.id === "scout" && o.enabled)).toBe(false);
    s.event!.data.next = "hw-salvage";
    s = choose(choose(s, "follow"), "all");
    expect(s.phase).toBe("player");
    expect(s.units.some((u) => u.kind === "builder" && !u.away)).toBe(false);
    for (const e of s.units.filter((u) => u.side === "enemy")) e.hp = 1;
    s = qa(s, "hand", undefined, "BURST");
    s = qa(s, "energy", 5);
    s = play(s, "BURST");
    expect(s.units.find((u) => u.kind === "builder")!.away).toBeFalsy();
  });
  it("Mark the Corridor gives one flag that the next anomaly consumes", () => {
    let s = choose(anomaly(), "mark");
    expect(s.navFlag).toBe(true);
    expect(eventView(s)!.options.find((o) => o.id === "mark")!.enabled).toBe(false);
    s = qa(s, "event", undefined, "hallway");
    expect(s.navFlag).toBe(false);
    expect(s.event!.data.revealed).toBe(true);
  });
  it("Maintenance Shift can resolve peacefully", () => {
    let s = choose(anomaly({}, "hw-maint"), "follow");
    s.event!.data.alarm = 0.9;
    const scrap = s.scrap;
    s = choose(s, "sneak");
    expect(s.scrap).toBe(scrap + 1);
    expect(s.phase).not.toBe("player");
  });
  it("Maintenance Shift turns hostile if you dismantle the drones", () => {
    let s = choose(anomaly({}, "hw-maint"), "follow");
    s = choose(s, "dismantle");
    expect(s.phase).toBe("player");
    expect(s.extension).toBe(true);
    expect(s.units.filter((u) => u.side === "enemy" && u.kind === "drone").length).toBe(2);
  });
  it("Salvage Room: taking everything pays the fixed budget once and starts the defense fight", () => {
    let s = choose(anomaly({}, "hw-salvage"), "follow");
    const budget = Number(s.event!.data.budget);
    const scrap = s.scrap;
    s = choose(s, "all");
    expect(s.scrap).toBe(scrap + budget);
    expect(s.phase).toBe("player");
    expect(reduce(s, { type: "event", option: "all" }).scrap).toBe(s.scrap);
  });
  it("Salvage Room: leaving it pays 1 and wakes nothing", () => {
    let s = choose(anomaly({}, "hw-salvage"), "follow");
    const scrap = s.scrap;
    s = choose(s, "none");
    expect(s.scrap).toBe(scrap + 1);
    expect(s.phase).not.toBe("player");
  });
  it("Something Behind You: keep moving and it shoots first", () => {
    let s = choose(anomaly({}, "hw-behind"), "follow");
    s = choose(s, "move");
    expect(s.phase === "player" || s.phase === "dead").toBe(true);
    expect(s.log.some((l) => l.includes("gets the first shot"))).toBe(true);
    expect(s.units.find((u) => u.side === "enemy")!.note).toBeTruthy();
  });
  it("Circular Route brings back a shell of the enemy you just killed, with no loot", () => {
    let s = choose(anomaly({}, "hw-circle"), "follow");
    expect(s.event!.data.kind).toBe("drone");
    s = choose(s, "fight");
    const shell = s.units.find((u) => u.side === "enemy")!;
    expect(shell.kind).toBe("drone");
    expect(shell.temp).toBe(true);
    s = qa(s, "hand", undefined, "SLUG");
    s = qa(s, "energy", 5);
    const scrap = s.scrap;
    s = play(s, "SLUG", shell);
    expect(s.wrecks.length).toBe(0);
    expect(s.scrap).toBe(scrap + 1);
  });
  it("The Hallway That Eats Machines only enters the pool with a Builder Drone and a Leech", () => {
    const without = Array.from({ length: 40 }, (_, i) => anomaly({ seed: i + 1 }).event!.data.next);
    expect(without).not.toContain("hw-eats");
    const withBoth = Array.from({ length: 40 }, (_, i) => anomaly({ seed: i + 1, allies: "builder", hand: "HALLWAY,SLUG,LEECH" }).event!.data.next);
    expect(withBoth).toContain("hw-eats");
  });
  it("The Hallway That Eats Machines: every option resolves, and retreat never rerolls it", () => {
    for (const option of ["harvest", "reactivate", "extract", "seal", "retreat"]) {
      let s = anomaly({ allies: "builder", hand: "HALLWAY,SLUG,LEECH" }, "hw-eats");
      s = choose(s, "follow");
      s.energyCap = 2;
      s.energy = 2;
      s = choose(s, option);
      if (option === "retreat") {
        expect(s.event!.id).toBe("hallway");
        expect(s.event!.data.next).not.toBe("hw-eats");
      } else expect(s.event).toBeNull();
    }
  });
  it("a borrowed Leech expires after the next room", () => {
    let s = anomaly({ allies: "builder", hand: "HALLWAY,SLUG,LEECH" }, "hw-eats");
    s = choose(s, "follow");
    s.event!.data.extract = 0;
    s = choose(s, "extract");
    const loan = s.deck.find((c) => c.expires !== undefined)!;
    expect(loan.expires).toBe(s.room + 1);
  });
  it("never opens inside its own extension fight", () => {
    let s = choose(anomaly({}, "hw-maint"), "follow");
    s = choose(s, "dismantle");
    s = qa(s, "hand", undefined, "HALLWAY,BURST,BURST");
    s = qa(s, "energy", 9);
    expect(reduce(s, { type: "play", uid: card(s, "HALLWAY").uid }).hallwayArmed).toBe(false);
    s.hallwayArmed = true; // even if something forced the flag
    s = play(s, "BURST");
    s = play(s, "BURST");
    expect(s.phase).not.toBe("player");
    expect(s.event).toBeNull();
  });
});
