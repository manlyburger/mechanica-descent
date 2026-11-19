import { describe, expect, it } from "vitest";
import { commandsFor, eventView, reduce, validTargets } from "../engine";
import { RULES, ally, card, choose, cmd, end, fight, findSeed, foe, j, pilotStatus, play, qa, said, sane } from "./helpers";

const weaken = (s: ReturnType<typeof fight>, kind?: string) => {
  const u = foe(s, kind);
  u.hp = Math.min(u.hp, RULES.captureHp);
  return u;
};
/** A Light being grappled, with a stunned Zombie alongside so the fight keeps going. */
const capture = (o: Parameters<typeof fight>[0] = {}) => {
  let s = fight({ allies: "clampjaw", enemies: "light,zombie", ...o });
  weaken(s, "light");
  s = cmd(s, ally(s, "clampjaw"), "apprehend", foe(s, "light"));
  s = end(s); // grapple
  for (const e of s.units.filter((u) => u.side === "enemy")) e.stunned = 99;
  return s;
};
const light = (s: ReturnType<typeof fight>) => foe(s, "light");
const clearRoom = (s: ReturnType<typeof fight>) => {
  // kill everything that is not restrained
  for (const u of s.units.filter((x) => x.side === "enemy" && x.cap?.state !== "secured")) u.hp = 1;
  s = qa(s, "hand", undefined, "BURST");
  s = qa(s, "energy", 9);
  return play(s, "BURST");
};

describe("Clampjaw Drone", () => {
  it("captures in two actions: grapple, then lock", () => {
    let s = capture();
    expect(light(s).cap).toMatchObject({ state: "securing", integrity: RULES.grappleIntegrity });
    s = end(s);
    expect(light(s).cap!.state).toBe("secured");
    expect(light(s).cap!.integrity).toBeGreaterThanOrEqual(RULES.lockIntegrity - RULES.strainStrong);
  });
  it("only takes a weakened or disabled target, and says why a heavy one is refused", () => {
    let s = fight({ allies: "clampjaw", enemies: "light,lvl2", quiet: false });
    const offered = () => commandsFor(s, ally(s, "clampjaw")).find((c) => c.cmd === "apprehend")!.targets!;
    expect(offered()).toEqual([]);
    foe(s, "light").hp = 3;
    foe(s, "lvl2").hp = 1;
    expect(offered()).toEqual([foe(s, "light").uid]);
    s = qa(s, "hand", undefined, "FOAM");
    foe(s, "light").hp = 4;
    s = play(s, "FOAM", foe(s, "light"));
    expect(offered()).toEqual([foe(s, "light").uid]); // disabled counts
  });
  it("holds exactly one captive and will not start a second", () => {
    let s = capture({ enemies: "light,drone,zombie" });
    expect(commandsFor(s, ally(s, "clampjaw")).some((c) => c.cmd === "apprehend")).toBe(false);
    const other = foe(s, "drone");
    expect(reduce(s, { type: "command", uid: ally(s, "clampjaw").uid, cmd: "apprehend", targetId: other.uid }).units.find((u) => u.uid === other.uid)!.cap).toBeUndefined();
  });
  it("loses a bare hold when destroyed, but Lockbands stay on", () => {
    for (const bands of [0, 1]) {
      let s = capture();
      s = end(s);
      if (bands) {
        s = qa(s, "hand", undefined, "LOCKBANDS");
        s = play(s, "LOCKBANDS", light(s));
      }
      const c = ally(s, "clampjaw");
      Object.assign(c, { overrideDmg: true, hp: 1 });
      s = end(s);
      expect(s.units.some((u) => u.kind === "clampjaw")).toBe(false);
      expect(!!light(s).cap).toBe(bands === 1);
    }
  });
  it("is hurt by a captive thrashing at critical integrity, and loses it at zero", () => {
    let s = capture();
    s = end(s);
    const hp = ally(s, "clampjaw").hp;
    light(s).stunned = 0;
    light(s).cap!.integrity = RULES.strainCritical;
    ally(s, "clampjaw").acted = true; // skips re-seating its grip this turn
    s = end(s);
    expect(ally(s, "clampjaw").hp).toBe(hp - 1);
    light(s).cap!.integrity = 5;
    ally(s, "clampjaw").acted = true;
    s = end(s);
    expect(light(s).cap).toBeUndefined();
    expect(said(s, "BREAKS THE RESTRAINT")).toBe(true);
  });
});

describe("Industrial Lockbands", () => {
  it("first band finishes a grapple, second is redundancy, third is rejected", () => {
    let s = capture();
    s = qa(s, "hand", undefined, "LOCKBANDS,LOCKBANDS,LOCKBANDS");
    const scrap = s.scrap;
    s = play(s, "LOCKBANDS", light(s));
    expect(light(s).cap).toMatchObject({ state: "secured", bands: 1, integrity: RULES.grappleIntegrity + RULES.bandIntegrity });
    s = play(s, "LOCKBANDS", light(s));
    expect(light(s).cap).toMatchObject({ bands: 2, integrity: 100 });
    expect(s.scrap).toBe(scrap - 2);
    expect(validTargets(s, card(s, "LOCKBANDS"))).toEqual([]);
  });
  it("secures a disabled machine on its own, and halves strain with two bands", () => {
    let s = fight({ enemies: "drone,zombie", hand: "LOCKBANDS,LOCKBANDS", quiet: false });
    const d = () => foe(s, "drone");
    foe(s, "zombie").stunned = 99;
    j(s).hp = j(s).maxHp;
    expect(validTargets(s, card(s, "LOCKBANDS"))).toEqual([foe(s, "zombie").uid].filter(() => false));
    d().stunned = 1;
    s = play(s, "LOCKBANDS", d());
    expect(d().cap).toMatchObject({ state: "secured", bands: 1, integrity: RULES.bandBase + RULES.bandIntegrity });
    s = play(s, "LOCKBANDS", d());
    const before = d().cap!.integrity;
    d().stunned = 0;
    s = end(s);
    expect(before - d().cap!.integrity).toBe(Math.ceil(RULES.strain / 2));
    expect(j(s).hp).toBe(j(s).maxHp); // a secured machine does not attack
  });
});

describe("Cockpit Wedge", () => {
  it("only fits a real piloted cockpit", () => {
    const s = fight({ enemies: "drone,infested,light", hand: "WEDGE" });
    expect(validTargets(s, card(s, "WEDGE"))).toEqual([foe(s, "light").uid]);
  });
  it("blocks ejection but not weapons or the radio", () => {
    let s = fight({ team: "needleback", hand: "WEDGE", quiet: false });
    const n = foe(s, "needleback");
    n.hp = 2;
    j(s).hp = j(s).maxHp = 40;
    s = play(s, "WEDGE", n);
    Object.assign(foe(s, "needleback"), { ejecting: true, plan: { type: "eject" } });
    s = end(s);
    expect(said(s, "COCKPIT RELEASE OBSTRUCTED")).toBe(true);
    expect(s.units.some((u) => u.kind === "capsule")).toBe(false);
    expect(foe(s, "needleback").pilot).toBe("p-needle");
    expect(s.log.some((l) => l.startsWith("Needleback: “"))).toBe(true); // still transmitting
    s = end(s);
    expect(foe(s, "needleback").wedge).toBe(0);
    s = end(s);
    expect(s.units.some((u) => u.kind === "capsule")).toBe(true); // wedge gone: ejection works again
  });
  it("can be removed for 1 Energy", () => {
    let s = fight({ team: "latchback", hand: "WEDGE", energy: 1 });
    s = play(s, "WEDGE", foe(s));
    s = cmd(s, foe(s), "unwedge");
    expect([foe(s).wedge, s.energy]).toEqual([0, 0]);
  });
  it("leaves a trapped pilot inside a reactor that goes up", () => {
    const s = findSeed(
      (seed) => {
        let t = fight({ seed, team: "kilnheart", hand: "WEDGE", quiet: false });
        const k = foe(t);
        j(t).hp = j(t).maxHp = 60;
        t = play(t, "WEDGE", k);
        Object.assign(foe(t), { hp: 4, heat: 2, fuse: 1, wedge: 5, refused: true });
        return end(t, 2);
      },
      (t) => pilotStatus(t, "p-kiln") === "dead",
    );
    expect(said(s, "KILNHEART REACTOR FAILURE")).toBe(true);
    expect(said(s, "The cockpit never opened")).toBe(true);
    expect(s.units.some((u) => u.kind === "capsule")).toBe(false);
  });
  it("is not custody: a restrained frame without a wedge still loses its pilot", () => {
    let s = fight({ team: "needleback", hand: "LOCKBANDS", energy: 9 });
    foe(s).hp = 5;
    s = play(s, "LOCKBANDS", foe(s));
    s = clearRoom(s);
    expect(pilotStatus(s, "p-needle")).not.toBe("captured");
    expect(said(s, "Securing the frame never secured the pilot")).toBe(true);
    expect(s.custody.map((c) => c.label)).toEqual(["The Needleback Courier chassis"]);
  });
  it("wedged and restrained: the pilot can be taken, if something is free to hold them", () => {
    let s = fight({ team: "needleback", enemies: "zombie", allies: "pod", hand: "LOCKBANDS,WEDGE", energy: 9 });
    s = play(s, "LOCKBANDS", foe(s, "needleback"));
    s = play(s, "WEDGE", foe(s, "needleback"));
    s = clearRoom(s);
    expect(s.event!.id).toBe("custody");
    expect(s.custody[0].person).toBe(true);
    s = choose(s, "keep-pod");
    expect(pilotStatus(s, "p-needle")).toBe("captured");
    expect(s.captives.length).toBe(1);
    const scrap = s.scrap;
    s = choose(s, "dismantle");
    expect(s.scrap).toBe(scrap + RULES.chassisScrap);
    expect(s.event).toBeNull();
  });
  it("with nothing free to hold a person, the only choice is to let them go", () => {
    let s = fight({ team: "needleback", enemies: "zombie", hand: "LOCKBANDS,WEDGE", energy: 9 });
    s = play(s, "LOCKBANDS", foe(s, "needleback"));
    s = play(s, "WEDGE", foe(s, "needleback"));
    s = clearRoom(s);
    expect(eventView(s)!.options.map((o) => o.id)).toEqual(["release"]);
    s = choose(s, "release");
    expect(["escaped", "withdrawn"]).toContain(pilotStatus(s, "p-needle"));
  });
});

describe("Mobile Containment Pod", () => {
  const contained = () => {
    let s = fight({ allies: "pod", enemies: "drone,zombie", hand: "LOCKBANDS" });
    foe(s, "drone").stunned = 1;
    s = play(s, "LOCKBANDS", foe(s, "drone"));
    return cmd(s, ally(s, "pod"), "contain", foe(s, "drone"));
  };
  it("takes one secured small captive off the field, atomically", () => {
    const s = contained();
    expect(s.units.some((u) => u.kind === "drone")).toBe(false);
    expect(s.captives.length).toBe(1);
    expect(ally(s, "pod").holding).toBe(s.captives[0].id);
  });
  it("rejects a second captive and rejects anything too big", () => {
    let s = contained();
    expect(commandsFor(s, ally(s, "pod")).some((c) => c.cmd === "contain")).toBe(false);
    let t = fight({ allies: "pod", enemies: "light,zombie", hand: "LOCKBANDS" });
    t = play(t, "LOCKBANDS", foe(t, "light"));
    expect(commandsFor(t, ally(t, "pod")).find((c) => c.cmd === "contain")!.targets).toEqual([]);
    void s;
  });
  it("draws 1 Energy every 3 occupied turns", () => {
    let s = contained();
    s = end(s, 2);
    expect(s.energy).toBe(s.energyCap);
    s = end(s);
    expect(s.energy).toBe(s.energyCap - 1);
    expect(ally(s, "pod").occupied).toBe(0);
  });
  it("warns on low power, recovers if power returns, and only fails after repeated misses", () => {
    let s = contained();
    s = cmd(s, ally(s, "pod"), "power");
    s = end(s, 3);
    expect(said(s, "CONTAINMENT POD LOW POWER")).toBe(true);
    expect(s.captives.length).toBe(1);
    expect(ally(s, "pod").podIntegrity).toBe(100 - RULES.podLowPowerLoss);
    s = end(s, 4);
    expect(s.captives.length).toBe(0);
    expect(s.units.some((u) => u.kind === "drone" && u.side === "enemy")).toBe(true);
  });
  it("releases its captive, still banded, when destroyed", () => {
    let s = contained();
    const pod = ally(s, "pod");
    Object.assign(pod, { hp: 1, ward: 0 });
    foe(s, "zombie").stunned = 0;
    foe(s, "zombie").prox = 2;
    s = findSeed((seed) => { const t = structuredClone(s); t.rng = seed; foe(t, "zombie").plan = { type: "attack", targetUid: pod.uid, dmg: 2 }; return end(t); }, (t) => !t.units.some((u) => u.kind === "pod"));
    expect(s.captives.length).toBe(0);
    expect(s.units.find((u) => u.kind === "drone")!.cap!.bands).toBe(1);
  });
  it("a Clampjaw hands its captive to the Pod and is free again", () => {
    let s = fight({ allies: "clampjaw,pod", enemies: "drone" });
    s = cmd(s, ally(s, "clampjaw"), "apprehend", foe(s));
    s = end(s, 2);
    s = clearRoom(s);
    s = choose(s, "keep-clamp");
    const clamp = s.units.find((u) => u.kind === "clampjaw")!;
    expect(clamp.holding).toBeTruthy();
    s = qa(s, "fight", 0, "zombie");
    s = cmd(s, ally(s, "clampjaw"), "transfer");
    expect(ally(s, "clampjaw").holding).toBeUndefined();
    expect(ally(s, "pod").holding).toBe(s.captives[0].id);
    expect(s.captives.length).toBe(1);
  });
});

describe("Memory Tap", () => {
  const tapped = (seed: number) => {
    let s = fight({ seed, enemies: "drone,zombie", hand: "LOCKBANDS,MEMTAP,MEMTAP" });
    foe(s, "drone").stunned = 1;
    s = play(s, "LOCKBANDS", foe(s, "drone"));
    return s;
  };
  it("needs a secured machine, then asks for one of three reads", () => {
    const bare = fight({ enemies: "drone", hand: "MEMTAP" });
    expect(validTargets(bare, card(bare, "MEMTAP"))).toEqual([]);
    let s = tapped(3);
    s = play(s, "MEMTAP", foe(s, "drone"));
    expect(s.tap).toBe(foe(s, "drone").uid);
    expect(reduce(s, { type: "endTurn" }).turn).toBe(s.turn + 1);
    s = reduce(s, { type: "command", uid: "tap", cmd: "hazard" });
    expect(s.tap).toBeNull();
    expect(s.revealNext).toBe(true);
  });
  it("gives clean, partial and corrupted reads, and marks corrupted ones as unverified", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      let s = tapped(seed);
      s = play(s, "MEMTAP", foe(s, "drone"));
      s = reduce(s, { type: "command", uid: "tap", cmd: "cache" });
      const q = ["CLEAN", "PARTIAL", "CORRUPTED"].find((x) => said(s, `Memory Tap: ${x}`))!;
      seen.add(q);
      if (q === "CORRUPTED") expect([s.intel.questionable, s.intel.cache]).toEqual([true, -1]);
      if (q === "CLEAN") expect(s.intel.cache).toBe(RULES.tapCache.clean);
    }
    expect([...seen].sort()).toEqual(["CLEAN", "CORRUPTED", "PARTIAL"]);
  });
  it("reads each captive once", () => {
    let s = tapped(2);
    s = play(s, "MEMTAP", foe(s, "drone"));
    s = reduce(s, { type: "command", uid: "tap", cmd: "weak" });
    expect(validTargets(s, card(s, "MEMTAP"))).toEqual([]);
  });
  it("pays a cache at the next Tech Stop, not on the spot, and only once", () => {
    let s = tapped(1);
    s.intel.cache = 3;
    const scrap = s.scrap;
    s.phase = "reward";
    s.rewardShown = [];
    s = reduce(s, { type: "pickReward", id: "NONE" });
    expect(s.scrap).toBe(scrap + 3);
    expect(s.intel.cache).toBe(0);
  });
  it("reads cockpit records, not people", () => {
    let s = fight({ team: "needleback", enemies: "zombie", allies: "pod", hand: "LOCKBANDS,WEDGE,MEMTAP", energy: 9 });
    s = play(s, "LOCKBANDS", foe(s, "needleback"));
    s = play(s, "WEDGE", foe(s, "needleback"));
    s = clearRoom(s);
    expect(eventView(s)!.options.some((o) => o.id.startsWith("tap-"))).toBe(false); // the pilot
    s = choose(s, "keep-pod");
    expect(eventView(s)!.options.some((o) => o.id === "tap-hazard")).toBe(true); // the chassis
    s = findSeed((seed) => { const t = structuredClone(s); t.rng = seed; return choose(t, "tap-hazard"); }, (t) => said(t, "Memory Tap: CLEAN"));
    expect(s.team.knownRoute).toBe(true);
    expect(eventView(s)!.options.some((o) => o.id.startsWith("tap-"))).toBe(false);
  });
});

describe("The Prisoner That Repairs Itself", () => {
  const open = (o: Parameters<typeof fight>[0] = {}) => qa(fight({ scrap: 10, ...o }), "event", undefined, "prisoner");
  const set = (s: ReturnType<typeof fight>, data: Record<string, unknown>) => {
    Object.assign(s.event!.data, data);
    return s;
  };

  it("never shows or logs an intelligible word of its own", () => {
    let s = open();
    const glyph = /^[….!? ]+$/;
    const mine = (l: string) => /^[….]/.test(l);
    for (const intent of ["repair", "break", "feign", "rest", "trap", "desperate"]) {
      const v = eventView(set(s, { intent }))!;
      expect(v.screen!.glyph).toMatch(glyph);
      expect(v.screen!.caption).toMatch(/^\[.*\]$/);
    }
    for (let i = 0; i < 6 && s.event; i++) s = choose(s, "inspect");
    for (const l of s.log.filter(mine)) expect(l.replace(/\[[^\]]*\]/g, "").replace(/ (The Prisoner|Something|The records).*$/, "")).toMatch(/^[….!? ]*$/);
  });
  it("can always be walked away from, with or without capture cards", () => {
    const s = open();
    expect(eventView(s)!.options.map((o) => o.id)).toEqual(["strip", "inspect", "leave"]);
    s.hallStage = 99;
    expect(choose(s, "leave").event).toBeNull();
  });
  it("its screen changes with what it is about to do", () => {
    const s = open();
    const glyphs = ["repair", "break", "trap", "desperate"].map((intent) => eventView(set(s, { intent }))!.screen!.glyph);
    expect(new Set(glyphs).size).toBe(4);
  });
  it("feigned compliance looks like rest; inspecting exposes it before it acts", () => {
    const s = open();
    const a = eventView(set(structuredClone(s), { intent: "feign" }))!.screen;
    const b = eventView(set(structuredClone(s), { intent: "rest" }))!.screen;
    expect(a).toEqual(b);
    const caught = choose(set(structuredClone(s), { intent: "feign" }), "inspect");
    expect(caught.event!.data.integrity).toBe(RULES.prisonerIntegrity);
    expect(said(caught, "it was faking")).toBe(true);
    const fooled = choose(set(structuredClone(s), { intent: "feign" }), "strip");
    expect(Number(fooled.event!.data.integrity)).toBeLessThan(RULES.prisonerIntegrity);
  });
  it("a resting prisoner really is resting", () => {
    const s = choose(set(open(), { intent: "rest" }), "strip");
    expect(s.event!.data.integrity).toBe(RULES.prisonerIntegrity);
    expect(s.event!.data.stage).toBe(0);
  });
  it("Lockbands reinforce it, twice at most", () => {
    let s = open({ hand: "LOCKBANDS" });
    s = choose(set(s, { intent: "rest" }), "band");
    expect(s.event!.data).toMatchObject({ bands: 1, integrity: 100 });
    s = choose(set(s, { intent: "rest", stage: 2 }), "band");
    expect(s.event!.data).toMatchObject({ bands: 2, stage: 1 });
    expect(eventView(s)!.options.find((o) => o.id === "band")!.enabled).toBe(false);
  });
  it("stripping pays 4 Scrap in two cuts, once, and ends it", () => {
    let s = open();
    s.hallStage = 99;
    const scrap = s.scrap;
    s = choose(set(s, { intent: "rest", part: false }), "strip");
    s = choose(set(s, { intent: "rest" }), "strip");
    expect(s.scrap).toBe(scrap + RULES.prisonerScrap);
    expect(s.event).toBeNull();
  });
  it("breaks out when the restraints reach zero, and is waiting in the next fight", () => {
    let s = open();
    s.hallStage = 99;
    s = choose(set(s, { intent: "desperate", integrity: 30 }), "inspect");
    expect(s.event).toBeNull();
    const p = s.units.find((u) => u.kind === "prisoner")!;
    expect(p.side).toBe("enemy");
    expect(said(s, "…!!")).toBe(true);
  });
  it("at repair stage 4 it gets one arm free: a partial breakout you can still contain", () => {
    let s = open();
    s = choose(set(s, { intent: "repair", stage: 3, integrity: 100 }), "inspect");
    expect(s.event!.id).toBe("prisoner");
    expect(s.event!.data.stage).toBe(2);
    expect(j(s).hp).toBe(j(s).maxHp - 1);
  });
  it("Memory Tap can be answered with a trap, and the screen warns first", () => {
    let s = open({ hand: "MEMTAP" });
    set(s, { intent: "trap" });
    expect(eventView(s)!.screen!.glyph).toBe("…?");
    const threat = s.threat;
    s = choose(s, "tap");
    expect(s.threat).toBe(threat + 1);
    expect(s.intel.questionable).toBe(true);
    expect(eventView(s)!.options.some((o) => o.id === "tap")).toBe(false);
  });
  it("can be recruited only from stable restraints, and never permanently", () => {
    let s = open({ allies: "builder" });
    expect(eventView(s)!.options.find((o) => o.id === "recruit")!.enabled).toBe(false);
    s.hallStage = 99;
    s = choose(set(s, { integrity: 90, recruit: 0.1, intent: "rest" }), "recruit");
    const p = s.units.find((u) => u.kind === "prisoner")!;
    expect([p.side, p.roomsLeft]).toEqual(["friendly", RULES.prisonerFights]);
  });
  it("a failed recruitment turns it loose", () => {
    let s = open({ allies: "builder" });
    s.hallStage = 99;
    s = choose(set(s, { integrity: 90, recruit: 0.99, intent: "rest" }), "recruit");
    expect(s.units.find((u) => u.kind === "prisoner")!.side).toBe("enemy");
  });
  it("fits in a vacant Pod, and keeps working on it from inside", () => {
    let s = open({ allies: "pod" });
    s.hallStage = 99;
    s = choose(s, "contain");
    expect(s.captives[0].kind).toBe("prisoner");
    expect(s.units.find((u) => u.kind === "pod")!.holding).toBeTruthy();
  });
  it("a mid-encounter save reloads to the same next beat", () => {
    const s = choose(open(), "inspect");
    expect(choose(sane(s), "strip")).toEqual(choose(s, "strip"));
  });
});
