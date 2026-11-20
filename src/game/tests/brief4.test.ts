import { describe, expect, it } from "vitest";
import { commandsFor, coordination, createGame, eventView, pursuing, validTargets, type GameState } from "../engine";
import { enterRoom, radio, setPilot } from "../team";
import { RULES, ally, card, choose, cmd, end, fight, findSeed, foe, j, pilotStatus, play, qa, run, said, sane } from "./helpers";

const tough = (s: GameState) => {
  j(s).hp = j(s).maxHp = 80;
  return s;
};
const pilots = (s: GameState, id: string) => s.units.filter((u) => u.pilot === id).length;

describe("melee closing", () => {
  it("a Latchback starts Distant, steps down toward you, and cannot hit before it is Engaged", () => {
    let s = tough(fight({ team: "latchback", quiet: false }));
    expect(foe(s).prox).toBe(0);
    expect(["approach", "rush"]).toContain(foe(s).plan!.type);
    foe(s).plan = { type: "approach" };
    s = end(s);
    expect(foe(s).prox).toBe(1);
    expect(j(s).hp).toBe(80);
    foe(s).plan = { type: "approach" };
    s = end(s);
    expect(foe(s).prox).toBe(RULES.proxEngaged);
    expect(j(s).hp).toBe(80);
    expect(["attack"]).toContain(foe(s).plan!.type);
    s = findSeed((seed) => { const t = structuredClone(s); t.rng = seed; return end(t); }, (t) => j(t).hp < 80);
    expect(j(s).hp).toBe(80 - 3);
  });
  it("Hydraulic Rush is telegraphed, closes all the way, and still does not strike that turn", () => {
    let s = tough(fight({ team: "latchback", quiet: false }));
    foe(s).plan = { type: "rush", note: "HYDRAULIC RUSH" };
    s = end(s);
    expect(foe(s).prox).toBe(RULES.proxEngaged);
    expect(j(s).hp).toBe(80);
  });
  it("an immobilized melee unit does not close", () => {
    let s = fight({ team: "latchback" }); // stunned
    s = end(s, 2);
    expect(foe(s).prox).toBe(0);
  });
  it("Crane Hook knocks a melee unit back a step", () => {
    let s = fight({ team: "latchback", hand: "HOOK" });
    foe(s).prox = 2;
    s = play(s, "HOOK", foe(s));
    expect(foe(s).prox).toBe(1);
    expect(said(s, "throws it back a step")).toBe(true);
  });
  it("Kilnheart's drills chew through cover while it closes", () => {
    let s = tough(fight({ team: "kilnheart", hand: "BULKHEAD", quiet: false }));
    s = play(s, "BULKHEAD", j(s));
    foe(s).plan = { type: "approach" };
    s = end(s);
    expect(ally(s, "bulkhead").hp).toBe(6 - RULES.kilnCoverDamage);
  });
  it("ordinary melee enemies close too, and ranged ones never shift", () => {
    let s = tough(fight({ enemies: "infested,light", quiet: false }));
    expect(foe(s, "infested").prox).toBe(1);
    expect(foe(s, "light").prox).toBeUndefined();
    s = end(s);
    expect(foe(s, "infested").prox).toBe(2);
    expect(foe(s, "light").prox).toBeUndefined();
  });
  it("range survives a save and reload", () => {
    let s = tough(fight({ team: "latchback", quiet: false }));
    foe(s).plan = { type: "approach" };
    s = end(s);
    expect(end(sane(s))).toEqual(end(s));
    expect(sane(s).units.find((u) => u.kind === "latchback")!.prox).toBe(1);
  });
});

describe("ejectable cockpits", () => {
  const kinds = ["needleback", "latchback", "widow", "kilnheart", "bishop"] as const;
  const ids = { needleback: "p-needle", latchback: "p-latch", widow: "p-widow", kilnheart: "p-kiln", bishop: "p-bishop" };
  const ready = (kind: (typeof kinds)[number], wedge = false) => {
    let s = tough(fight({ team: kind, enemies: "zombie", hand: "WEDGE", quiet: false }));
    foe(s, "zombie").stunned = 99;
    const u = foe(s, kind);
    if (wedge) s = play(s, "WEDGE", u);
    Object.assign(foe(s, kind), { hp: 2, ejecting: true, plan: { type: "eject" }, refused: true, ...(kind === "kilnheart" ? { heat: 2, fuse: 5 } : {}) });
    return s;
  };

  for (const kind of kinds) {
    it(`${kind}: the cockpit leaves as its own capsule and the pilot goes with it`, () => {
      const s = end(ready(kind));
      expect(s.units.some((u) => u.kind === kind)).toBe(false);
      const pod = s.units.find((u) => u.kind === "capsule")!;
      expect(pod.pilot).toBe(ids[kind]);
      expect(pod.role).toBe(kind);
      expect(pilots(s, ids[kind])).toBe(1);
      expect(said(s, "EJECTS.")).toBe(true);
      if (kind === "bishop") expect(pod.flying).toBe(true);
      if (kind !== "kilnheart") expect(s.wrecks.some((w) => w.kind === kind && w.value === 2)).toBe(true);
    });
    it(`${kind}: a Cockpit Wedge keeps the pilot in the frame`, () => {
      const s = end(ready(kind, true));
      expect(s.units.some((u) => u.kind === "capsule")).toBe(false);
      expect(s.units.find((u) => u.kind === kind)!.pilot).toBe(ids[kind]);
      expect(said(s, "COCKPIT RELEASE OBSTRUCTED")).toBe(true);
    });
  }

  it("a capsule stays on the field until it actually leaves, then the pilot is at large", () => {
    let s = end(ready("latchback"));
    expect(s.units.find((u) => u.kind === "capsule")!.exitIn).toBe(2); // two turns to act on it
    expect(pilotStatus(s, "p-latch")).toBe("active");
    s = end(s);
    expect(s.units.some((u) => u.kind === "capsule")).toBe(true);
    s = end(s);
    expect(s.units.some((u) => u.kind === "capsule")).toBe(false);
    expect(["escaped", "withdrawn"]).toContain(pilotStatus(s, "p-latch"));
  });
  it("a capsule can be shot down, stopped, or grabbed", () => {
    const base = end(ready("widow"));
    const pod = base.units.find((u) => u.kind === "capsule")!;
    let shot = qa(base, "hand", undefined, "SLUG");
    shot = play(qa(shot, "energy", 5), "SLUG", pod);
    expect(pilotStatus(shot, "p-widow")).toBe("dead");
    let held = qa(base, "ally", undefined, "clampjaw");
    held = cmd(held, ally(held, "clampjaw"), "apprehend", pod);
    held = end(held, 2);
    expect(held.units.find((u) => u.kind === "capsule")!.cap!.state).toBe("secured");
    expect(pilotStatus(held, "p-widow")).toBe("active"); // secured is not yet custody
  });
  it("the flying command pod is out of reach of crane and hook, not of guns", () => {
    let s = end(ready("bishop"));
    s = qa(s, "hand", undefined, "HOOK,GUN");
    const pod = s.units.find((u) => u.kind === "capsule")!;
    expect(validTargets(s, card(s, "HOOK"))).not.toContain(pod.uid);
    expect(validTargets(s, card(s, "GUN"))).toContain(pod.uid);
  });
  it("a frame destroyed outright resolves its pilot one way or the other, exactly once", () => {
    for (let seed = 1; seed <= 12; seed++) {
      let s = fight({ seed, team: "needleback", enemies: "zombie", hand: "SLUG" });
      s = play(s, "SLUG", foe(s, "needleback"));
      const capsule = s.units.filter((u) => u.kind === "capsule").length;
      expect(capsule === 1 ? pilotStatus(s, "p-needle") === "active" : pilotStatus(s, "p-needle") === "dead").toBe(true);
      expect(pilots(s, "p-needle")).toBe(capsule);
    }
  });
  it("Kilnheart's reactor is tracked apart from HP, warns, and can be cooled", () => {
    let s = tough(fight({ team: "kilnheart", hand: "SLUG,SLUG,FOAM" }));
    s = play(s, "SLUG", foe(s));
    expect(foe(s).heat).toBe(1);
    s = play(s, "SLUG", foe(s));
    expect([foe(s).heat, foe(s).fuse]).toEqual([2, RULES.kilnFuse]);
    expect(said(s, "REACTOR INSTABILITY DETECTED")).toBe(true);
    foe(s).stunned = 0;
    s = findSeed((seed) => { const t = structuredClone(s); t.rng = seed; return play(t, "FOAM", foe(t)); }, (t) => !!foe(t).foam);
    expect([foe(s).heat, foe(s).fuse]).toEqual([1, undefined]);
  });
  it("an uncooled Critical reactor detonates on schedule, telegraphed the turn before", () => {
    let s = tough(fight({ team: "kilnheart", enemies: "drone", quiet: false }));
    Object.assign(foe(s, "kilnheart"), { hp: 4, heat: 2, fuse: 2, refused: true, wedge: 9, prox: 2, slot: 0 });
    foe(s, "drone").slot = 1;
    s = end(s);
    expect(foe(s, "kilnheart").plan).toMatchObject({ type: "detonate" });
    s = end(s);
    expect(s.units.some((u) => u.kind === "kilnheart" || u.kind === "drone")).toBe(false);
    expect(j(s).hp).toBeLessThan(80);
  });
});

describe("Relay Section R-8 in a fight", () => {
  it("Bishop spends its turn ordering the Brawler to cover it; the Brawler takes the next aimed shot", () => {
    let s = tough(fight({ team: "bishop,latchback", hand: "SLUG", quiet: false }));
    foe(s, "bishop").hp = 5;
    s = end(s);
    expect(s.teamOrder).toBe("Cover the Commander");
    expect(foe(s, "bishop").plan!.type).toBe("command");
    expect(foe(s, "latchback").plan!.note).toBe("covering the commander");
    s = qa(s, "hand", undefined, "SLUG");
    s = qa(s, "energy", 5);
    const hp = foe(s, "latchback").hp;
    s = play(s, "SLUG", foe(s, "bishop"));
    expect(foe(s, "bishop").hp).toBe(5);
    expect(foe(s, "latchback").hp).toBe(hp - 4); // 5, less 1 Armor
  });
  it("gives at most one order a round, and none once the net is down", () => {
    let s = tough(fight({ team: "bishop,latchback,kilnheart", quiet: false }));
    foe(s, "bishop").hp = 5;
    s = end(s);
    expect(s.events.filter((l) => l.startsWith("R-8 ORDER")).length).toBe(1);
    s.team.networkCut = true;
    s = end(s);
    expect(s.teamOrder).toBeNull();
    expect(coordination(s)).toBeLessThanOrEqual(1);
  });
  it("the Widow tows an ejected capsule out unless you stop one of them", () => {
    let s = tough(fight({ team: "needleback,widow", quiet: false }));
    Object.assign(foe(s, "needleback"), { hp: 2, ejecting: true, plan: { type: "eject" } });
    foe(s, "widow").plan = { type: "attack" };
    s = end(s); // ejects
    expect(foe(s, "widow").plan!.type).toBe("recover");
    const stopped = (() => {
      const t = structuredClone(s);
      foe(t, "widow").stunned = 2;
      return end(t);
    })();
    expect(stopped.units.find((u) => u.kind === "capsule")?.towed ?? false).toBe(false);
    s = end(s); // capsule moves first (leaving in 0 → gone) or is towed
    s = s.units.some((u) => u.kind === "capsule") ? end(s) : s;
    expect(["recovered", "escaped"]).toContain(pilotStatus(s, "p-needle"));
  });
  it("Needleback's mark makes the section's next shot land", () => {
    let s = tough(fight({ team: "needleback,widow", quiet: false }));
    foe(s, "needleback").plan = { type: "mark" };
    foe(s, "widow").plan = { type: "attack", targetUid: j(s).uid, dmg: 2 };
    s.accModEnemy = -9; // would otherwise always miss
    s = end(s);
    expect(said(s, "fires on Needleback's mark")).toBe(true);
    expect(j(s).hp).toBe(78);
  });
  it("a wedged pilot keeps transmitting; a captured one never speaks again", () => {
    let s = fight({ team: "bishop", enemies: "zombie", hand: "WEDGE", quiet: false });
    foe(s, "zombie").stunned = 99;
    tough(s);
    s = play(s, "WEDGE", foe(s, "bishop"));
    Object.assign(foe(s, "bishop"), { hp: 2, ejecting: true, plan: { type: "eject" } });
    s = end(s);
    expect(s.log.some((l) => l.startsWith("Bishop: “"))).toBe(true);
    const t = structuredClone(s);
    setPilot(t, "p-latch", "captured");
    const before = t.log.length;
    t.team.said = [];
    radio(t, "ep3-brawler");
    expect(t.log.slice(0, t.log.length - before + 1).some((l) => l.startsWith("Latchback: “"))).toBe(false);
    expect(t.log.some((l) => l.includes("PILOT UNAVAILABLE"))).toBe(true);
  });
  it("cutting the Command Relay drops coordination without silencing individual radios", () => {
    let s = fight({ enemies: "relay", hand: "SLUG,SLUG,SLUG" });
    s.team.pursuit = "active";
    expect(coordination(s)).toBe(3);
    for (let i = 0; i < 3 && s.phase === "player"; i++) s = play(s, "SLUG", foe(s));
    expect(s.team.networkCut).toBe(true);
    expect(coordination(s)).toBe(1);
    expect(pursuing(s)).toBe(true);
    const lines = s.log.length;
    radio(s, "ep2-recovery");
    expect(s.log.length).toBeGreaterThan(lines);
  });
});

describe("escaped pilots and replacement frames", () => {
  const begin = () => {
    const s = run(createGame(4), { type: "start", seed: 4 }, { type: "loadout", pick: "lootbox" });
    s.team.pursuit = "active";
    s.team.introduced = true;
    s.team.nextAt = 99;
    return s;
  };
  const rooms = (s: GameState, n: number) => {
    const out: string[][] = [];
    for (let i = 0; i < n; i++) {
      s.room += 1;
      enterRoom(s);
      out.push(s.pendingTeam.map((m) => `${m.pilot}:${m.kind}:${!!m.replacement}`));
    }
    return out;
  };

  it("an escaped pilot returns once, in a replacement frame, within the window", () => {
    const s = begin();
    setPilot(s, "p-needle", "escaped");
    const p = s.team.pilots[0];
    expect(p.returnsIn).toBeGreaterThanOrEqual(1);
    expect(p.returnsIn).toBeLessThanOrEqual(RULES.returnWindow);
    const seen = rooms(s, RULES.returnWindow + 2).flat();
    expect(seen).toEqual(["p-needle:needleback:true"]);
    expect([p.status, p.replaced]).toEqual(["active", true]);
  });
  it("escaping raises pursuit pressure and Threat once; capture lowers them once", () => {
    const s = begin();
    setPilot(s, "p-needle", "escaped");
    expect([s.team.pressure, s.threat]).toEqual([1, 1]);
    setPilot(s, "p-needle", "escaped");
    expect([s.team.pressure, s.threat]).toEqual([1, 1]);
    s.team.pilots[0].status = "active";
    setPilot(s, "p-needle", "captured");
    expect([s.team.pressure, s.threat, s.team.leverage]).toEqual([0, 0, 1]);
  });
  it("a captured pilot never returns", () => {
    const s = begin();
    setPilot(s, "p-needle", "captured");
    expect(rooms(s, 5).flat()).toEqual([]);
  });
  it("a second escape after the replacement is the end of that pilot's hunt", () => {
    const s = begin();
    setPilot(s, "p-latch", "escaped");
    rooms(s, RULES.returnWindow + 1);
    setPilot(s, "p-latch", "escaped");
    expect(pilotStatus(s, "p-latch")).toBe("withdrawn");
    expect(rooms(s, 5).flat()).toEqual([]);
  });
  it("no more than two team bonus enemies arrive in one room", () => {
    const s = begin();
    for (const id of ["p-needle", "p-latch", "p-kiln"]) setPilot(s, id, "recovered");
    for (const p of s.team.pilots) if (p.returnsIn) p.returnsIn = 1;
    const seen = rooms(s, 3);
    expect(seen[0].length).toBe(RULES.teamBonusMax);
    expect(seen.flat().length).toBe(3);
  });
  it("the Kilnheart pilot comes back in something without a reactor", () => {
    const s = begin();
    setPilot(s, "p-kiln", "recovered");
    expect(rooms(s, 4).flat()[0]).not.toContain(":kilnheart:");
  });
  it("without the Widow, an escaping pilot may not make it back at all", () => {
    let home = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const s = begin();
      s.rng = seed * 97;
      setPilot(s, "p-widow", "captured");
      setPilot(s, "p-needle", "escaped");
      if (pilotStatus(s, "p-needle") === "withdrawn") home++;
    }
    expect(home).toBeGreaterThan(10);
    expect(home).toBeLessThan(50);
    const s = begin();
    setPilot(s, "p-needle", "escaped");
    expect(pilotStatus(s, "p-needle")).toBe("escaped"); // with recovery up: always
  });
  it("capturing the commander ends the organized pursuit and cancels pending returns", () => {
    const s = begin();
    setPilot(s, "p-needle", "escaped");
    setPilot(s, "p-bishop", "captured");
    expect(s.team.pursuit).toBe("commanderCaptured");
    expect(rooms(s, 5).flat()).toEqual([]);
    expect(enterRoom(s)).toBe(0);
  });
  it("losing Bishop and all but one pilot breaks the team even with a survivor", () => {
    const s = begin();
    for (const id of ["p-bishop", "p-needle", "p-latch", "p-kiln"]) setPilot(s, id, "dead");
    expect(s.team.pursuit).toBe("broken");
    expect(pilotStatus(s, "p-widow")).toBe("active");
  });
});

describe("the R-8 story", () => {
  const at = (id: string, o: Parameters<typeof fight>[0] = {}) => {
    let s = fight({ scrap: 10, ...o });
    s.team.pursuit = "active";
    s.team.introduced = true;
    s = qa(s, "event", undefined, id);
    s.hallStage = 99;
    return s;
  };

  it("runs its five episodes in order as you descend", () => {
    let s = run(createGame(11), { type: "start", seed: 11 }, { type: "loadout", pick: "mine" });
    const seen: number[] = [];
    for (let i = 0; i < 9; i++) {
      s.room += 1;
      const ep = enterRoom(s);
      if (ep) {
        seen.push(ep);
        s.team.episode = Math.min(5, s.team.episode + 1);
        s.team.nextAt = s.room + 1;
        s.team.pursuit = "active";
      }
    }
    expect(seen.slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
  });
  it("the Recovery Attempt: attack, observe or avoid", () => {
    expect(choose(at("r8-recovery"), "attack").units.some((u) => u.kind === "widow")).toBe(true);
    const watched = choose(at("r8-recovery"), "observe");
    expect(watched.team.knownRoute).toBe(true);
    expect(watched.units.some((u) => u.kind === "widow")).toBe(false);
    expect(choose(at("r8-recovery"), "avoid").team.episode).toBe(2);
  });
  it("the Brawler can be faced, evaded, or lured if you have bait", () => {
    const bare = at("r8-brawler");
    bare.deck = bare.deck.filter((c) => !["FLARE", "QUIET", "BEACON"].includes(c.id));
    expect(eventView(bare)!.options.find((o) => o.id === "lure")!.enabled).toBe(false);
    const lured = choose(at("r8-brawler", { hand: "FLARE" }), "lure");
    expect(lured.team.bishopExposed).toBe(true);
    expect(lured.units.some((u) => u.kind === "latchback")).toBe(false);
    expect(choose(at("r8-brawler"), "face").units.some((u) => u.kind === "latchback" && u.prox === 0)).toBe(true);
  });
  it("Cut the Relay: assault brings the bodyguard; a lured Brawler is absent", () => {
    const a = choose(at("r8-relay"), "assault");
    expect(a.units.filter((u) => u.side === "enemy").map((u) => u.kind)).toEqual(expect.arrayContaining(["bishop", "latchback"]));
    const b0 = at("r8-relay");
    b0.team.bishopExposed = true;
    expect(choose(b0, "assault").units.some((u) => u.kind === "latchback")).toBe(false);
  });
  it("Cut the Relay: the network can be attacked without fighting Bishop", () => {
    const s = choose(at("r8-relay"), "network");
    const foes = s.units.filter((u) => u.side === "enemy").map((u) => u.kind);
    expect(foes).toContain("relay");
    expect(foes).not.toContain("bishop");
  });
  it("Cut the Relay: interception needs the route, and starts you ahead", () => {
    expect(eventView(at("r8-relay"))!.options.some((o) => o.id === "intercept")).toBe(false);
    const s0 = at("r8-relay");
    s0.team.knownRoute = true;
    const s = choose(s0, "intercept");
    const b = s.units.find((u) => u.kind === "bishop")!;
    expect(b.hp).toBe(5);
    expect(s.units.some((u) => u.kind === "latchback" || u.kind === "widow")).toBe(false);
    expect(s.energy).toBe(s.energyCap + 1);
  });
  it("talks only open with visible leverage, and 'call them off' needs more of it", () => {
    expect(eventView(at("r8-relay"))!.options.find((o) => o.id === "talk")!.enabled).toBe(false);
    const weak = at("r8-talk");
    weak.team.leverage = RULES.negotiateAt;
    expect(pursuing(choose(weak, "call"))).toBe(true);
    const strong = at("r8-talk");
    strong.team.leverage = RULES.withdrawAt;
    const done = choose(strong, "call");
    expect(done.team.pursuit).toBe("withdrawn");
    expect(enterRoom(done)).toBe(0);
    expect(done.team.pilots.every((p) => p.returnsIn === undefined)).toBe(true);
  });
  it("a captured pilot can be exchanged for a withdrawal, without anyone dying", () => {
    let s = at("r8-talk", { allies: "pod" });
    const pod = s.units.find((u) => u.kind === "pod")!;
    s.captives.push({ id: "x", kind: "capsule", pilot: "p-needle", label: "Needleback's pilot", holder: pod.uid, bands: 0, tapped: false, hp: 2 });
    pod.holding = "x";
    s.team.pilots[0].status = "captured";
    s = choose(s, "exchange");
    expect(s.team.pursuit).toBe("withdrawn");
    expect(s.captives.length).toBe(0);
    expect(s.team.pilots.some((p) => p.status === "dead")).toBe(false);
  });
  it("route codes buy safe passage for a few rooms, not peace", () => {
    const s = choose(at("r8-talk"), "codes");
    expect(pursuing(s)).toBe(true);
    expect(s.team.truceUntil).toBe(s.room + RULES.safePassageRooms);
    s.room += 1;
    s.team.nextAt = 0;
    expect(enterRoom(s)).toBe(0);
  });
  it("refusing to talk costs Threat and the hunt goes on", () => {
    const s0 = at("r8-talk");
    const s = choose(s0, "keep");
    expect(s.threat).toBe(s0.threat + 1);
    expect(pursuing(s)).toBe(true);
  });
  it("Bishop ejecting opens the flying-cockpit hunt next room; grounding it makes it catchable", () => {
    let s = at("r8-pod", { hand: "FOAM" });
    s.team.pilots[4].status = "escaped";
    s.team.pilots[4].returnsIn = 2;
    s = choose(s, "ground");
    const pod = s.units.find((u) => u.kind === "capsule")!;
    expect([pod.pilot, pod.flying, pod.stunned > 0]).toEqual(["p-bishop", false, true]);
    expect(pilotStatus(s, "p-bishop")).toBe("active");
    expect(s.team.pilots[4].returnsIn).toBeUndefined();
  });
  it("tracking the pod gives the route and lets Bishop regroup", () => {
    let s = at("r8-pod");
    s.team.pilots[4].status = "escaped";
    s.team.pilots[4].returnsIn = 2;
    s = choose(s, "track");
    expect(s.team.knownRoute).toBe(true);
    expect(s.team.pilots[4].returnsIn).toBe(2);
  });
  it("destroying Bishop does not make every survivor surrender", () => {
    const s = at("r8-relay");
    setPilot(s, "p-bishop", "dead");
    expect(pursuing(s)).toBe(true);
    expect(coordination(s)).toBeLessThanOrEqual(1);
    expect(s.team.pilots.filter((p) => p.status === "active").length).toBe(4);
  });
  it("played through: wedge, restrain and contain Bishop, and the hunt is over with nobody dead", () => {
    let s = fight({ team: "bishop", enemies: "zombie", allies: "pod", hand: "HOOK,LOCKBANDS,WEDGE", energy: 9 });
    s.team.nextAt = 99;
    const b = () => foe(s, "bishop");
    s = play(s, "HOOK", b()); // stunned: disabled, so bands will take
    s = play(s, "LOCKBANDS", b());
    s = play(s, "WEDGE", b());
    expect(b().cap!.state).toBe("secured");
    foe(s, "zombie").hp = 1;
    s = qa(s, "hand", undefined, "GUN");
    s = play(s, "GUN", foe(s, "zombie"));
    expect(s.event!.id).toBe("custody");
    s = choose(s, "keep-pod");
    expect(s.team.pursuit).toBe("commanderCaptured");
    expect(s.team.pilots.some((p) => p.status === "dead")).toBe(false);
    s.room += 2;
    expect(enterRoom(s)).toBe(0);
  });
  it("played through: capture three pilots and Bishop calls the section off", () => {
    let s = fight({ scrap: 10 });
    s.team.pursuit = "active";
    s.team.introduced = true;
    for (const id of ["p-needle", "p-latch", "p-kiln"]) setPilot(s, id, "captured");
    expect(s.team.leverage).toBe(RULES.withdrawAt);
    s = qa(s, "event", undefined, "r8-relay");
    s.hallStage = 99;
    expect(eventView(s)!.options.find((o) => o.id === "talk")!.enabled).toBe(true);
    s = choose(choose(s, "talk"), "call");
    expect(s.team.pursuit).toBe("withdrawn");
    expect(pilotStatus(s, "p-bishop")).toBe("withdrawn");
  });
  it("every ending survives a save and reload", () => {
    for (const end of ["withdrawn", "broken", "commanderCaptured"] as const) {
      const s = at("r8-relay");
      if (end === "withdrawn") Object.assign(s.team, { leverage: 9 });
      if (end === "broken") for (const id of ["p-bishop", "p-needle", "p-latch", "p-kiln"]) setPilot(s, id, "dead");
      if (end === "commanderCaptured") setPilot(s, "p-bishop", "captured");
      const t = end === "withdrawn" ? choose(qa(s, "event", undefined, "r8-talk"), "call") : s;
      const back = sane(t);
      expect(back.team.pursuit).toBe(end);
      back.room += 3;
      expect(enterRoom(back)).toBe(0);
      expect(back.pendingTeam).toEqual([]);
    }
  });
  void commandsFor;
  void end;
});
