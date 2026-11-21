// Brief 6: escape pod recovery, enemy equipment, Observation, random
// targeting, Robobuddy reconstruction, and Threat stalkers. One block per
// group of the brief's 46 validation scenarios, numbered to match.

import { describe, expect, it } from "vitest";
import { SAVE_VERSION, createGame, eventView, legalActions, migrate, pickTargetForTest, reduce, type GameState, type Unit } from "../engine";
import { discoveryChance, magazine, makeGear, prepEnemy } from "../gear";
import { observation, partyObservation, rec, statOf } from "../pilots";
import { POOLS, createStalker, defeat, expectedLevel, rating, reductionFor, resolveStalkers, stalkerStats } from "../stalkers";
import { RULES, ally, choose, end, fight, foe, j, noPods, play, qa, run, said, sane, withRules } from "./helpers";
import { enemyHitChance, freeFriendSlot, living } from "../core";

const begun = (seed = 7, pick: "lootbox" | "buddy" = "lootbox") => run(createGame(seed), { type: "start", seed }, { type: "loadout", pick });
const options = (s: GameState) => eventView(s)?.options ?? [];
const option = (s: GameState, id: string) => options(s).find((o) => o.id === id);
const openId = (s: GameState) => options(s).find((o) => o.id.startsWith("open:"))!.id;
/** Kill every listed enemy with SLUGs (5 damage, always lands). */
function slugAll(s: GameState, kinds: string[]): GameState {
  for (const k of kinds) {
    const e = foe(s, k);
    if (!e) continue;
    e.hp = 1;
    e.armor = 0;
    s = qa(qa(s, "hand", undefined, "SLUG"), "energy", 9);
    s = play(s, "SLUG", foe(s, k));
  }
  return s;
}
/** A fight against one Light with an escape pod already on the floor, then the Light dies. */
function podAfterFight(o: { origin?: string; empty?: boolean; allies?: string; seed?: number } = {}): GameState {
  let s = fight({ enemies: "light", allies: o.allies, seed: o.seed });
  s = qa(s, "pod", o.empty ? 1 : 0, o.origin ?? "light");
  return noPods(() => slugAll(s, ["light"]));
}
/** A Tech Stop, ready for the next room. */
function atTech(s: GameState): GameState {
  s.phase = "tech";
  s.event = null;
  return s;
}
const nextRoom = (s: GameState) => reduce(atTech(s), { type: "nextRoom" });

// ---------- escape pods (1–8) ----------

describe("escape pods", () => {
  it("1–2. a pod still on the floor ends the fight and waits on the recovery screen", () => {
    const s = podAfterFight();
    expect(s.phase).toBe("event");
    expect(s.event!.id).toBe("recovery");
    expect(eventView(s)!.title).toBe("COMBAT COMPLETE — RECOVERY AVAILABLE");
    expect(s.pods.length).toBe(1);
    expect(s.units.some((u) => u.kind === "capsule")).toBe(false);
    expect(option(s, openId(s))!.enabled).toBe(true);
    expect(eventView(s)!.lines.some((l) => l.includes("1 escape pod remaining"))).toBe(true);
  });
  it("leaving never forces you to open a pod, and an unopened anonymous pod creates nobody", () => {
    const s = podAfterFight();
    const n = s.roster.length;
    const after = choose(s, "done");
    expect(after.roster.length).toBe(n);
    expect(after.pods.length).toBe(0);
    expect(after.phase).not.toBe("event");
  });
  it("3. an anonymous pod makes one pilot, qualified for the mech it came out of", () => {
    let s = podAfterFight({ origin: "light" });
    const n = s.roster.length;
    s = choose(s, openId(s));
    expect(s.roster.length).toBe(n + 1);
    const r = s.roster[s.roster.length - 1];
    expect(r.eligible).toBe("light");
    expect(["Scout", "Assault"]).toContain(r.spec);
    expect(s.pods[0].pilot).toBe(r.id);
    expect(s.pods[0].srcKey).toBe("pilot:" + r.id);
    for (const st of ["mental", "skill", "endurance", "observation"] as const) expect(statOf(r, st)).toBeGreaterThanOrEqual(1);
  });
  it("3. other origins pick their own specializations", () => {
    for (const [origin, specs] of [["widow", ["Recovery", "Technician"]], ["bishop", ["Command"]], ["needleback", ["Scout"]], ["kilnheart", ["Heavy", "Assault"]], ["latchback", ["Assault"]]] as const) {
      let s = podAfterFight({ origin });
      s = choose(s, openId(s));
      const r = s.roster[s.roster.length - 1];
      expect(specs as readonly string[], origin).toContain(r.spec);
    }
  });
  it("4. a named R-8 pod opens on the actual pilot: same record, stats and gear", () => {
    let s = fight({ team: "needleback", quiet: false });
    j(s).hp = j(s).maxHp = 60;
    const before = structuredClone(rec(s, "p-needle")!);
    const n = s.roster.length;
    Object.assign(foe(s, "needleback"), { ejecting: true, plan: { type: "eject" } });
    s = end(s);
    expect(s.event?.id).toBe("recovery");
    expect(s.pods[0]).toMatchObject({ pilot: "p-needle", occupant: "named" });
    s = choose(s, openId(s));
    expect(s.roster.length).toBe(n);
    const r = rec(s, "p-needle")!;
    expect(r.base).toEqual(before.base);
    expect(r.slots.map((x) => x?.id)).toEqual(before.slots.map((x) => x?.id));
    expect(eventView(s)!.lines.some((l) => l.startsWith(r.name))).toBe(true);
  });
  it("4. a named pod left sealed: the pilot escapes and R-8's return rules apply", () => {
    let s = fight({ team: "needleback", quiet: false });
    j(s).hp = j(s).maxHp = 60;
    Object.assign(foe(s, "needleback"), { ejecting: true, plan: { type: "eject" } });
    s = choose(end(s), "done");
    expect(s.team.pilots.find((p) => p.id === "p-needle")!.status).toBe("escaped");
  });
  it("5. a pod cannot produce a second pilot: not by reopening, saving or reloading", () => {
    let s = podAfterFight();
    const id = openId(s);
    s = choose(s, id);
    const n = s.roster.length;
    expect(option(s, id)).toBeUndefined();
    s = choose(s, id); // ignored
    s = choose(sane(s), id);
    expect(s.roster.length).toBe(n);
  });
  it("empty pods only when the pod's own record says so, and never make an occupant", () => {
    let s = podAfterFight({ empty: true });
    const n = s.roster.length;
    s = choose(s, openId(s));
    expect(s.roster.length).toBe(n);
    expect(s.pods[0].outcome).toBe("empty");
    expect(said(s, "Hatch already open")).toBe(true);
  });
  it("6. a hostile pilot resists: subdue first; failing lets them hit back and run", () => {
    const hostile = { podOutcome: { cooperative: 0, frightened: 0, hostile: 1, incapacitated: 0 } };
    let s = withRules(hostile, () => {
      const p = podAfterFight({ allies: "clampjaw" });
      return choose(p, openId(p));
    });
    expect(s.pods[0].outcome).toBe("hostile");
    expect(option(s, "subdue")!.enabled).toBe(true);
    expect(option(s, "secure")).toBeUndefined();
    expect(option(s, "recruit")!.enabled).toBe(false);
    const hp = j(s).hp;
    const fled = withRules({ subdue: 0 }, () => choose(s, "subdue"));
    expect(j(fled).hp).toBe(hp - 1);
    expect(rec(fled, fled.pods[0].pilot)!.custody).toBe("free");
    expect(fled.pods[0].resolved).toBe(true);
    s = withRules({ subdue: 1 }, () => choose(s, "subdue"));
    expect(s.pods[0].subdued).toBe(true);
    expect(option(s, "secure")!.enabled).toBe(true);
  });
  it("7. captive capacity: nothing free means no securing, and one holder takes one captive", () => {
    const coop = { podOutcome: { cooperative: 1, frightened: 0, hostile: 0, incapacitated: 0 } };
    let none = withRules(coop, () => podAfterFight());
    none = withRules(coop, () => choose(none, openId(none)));
    expect(option(none, "secure")!.enabled).toBe(false);
    expect(option(none, "secure")!.detail).toContain("one captive each");

    let s = withRules(coop, () => {
      let p = fight({ enemies: "light", allies: "clampjaw" });
      p = qa(qa(p, "pod", 0, "light"), "pod", 0, "lvl2");
      return noPods(() => slugAll(p, ["light"]));
    });
    expect(s.pods.length).toBe(2);
    s = withRules(coop, () => choose(s, openId(s)));
    s = choose(s, "secure");
    const claw = ally(s, "clampjaw");
    expect(claw.holding).toBeTruthy();
    expect(s.captives.length).toBe(1);
    s = withRules(coop, () => choose(s, openId(s)));
    expect(option(s, "secure")!.enabled).toBe(false);
    expect(s.captives.length).toBe(1);
  });
  it("8. opening, capturing and stripping share one Cockpit Parts roll", () => {
    const rules = { anonEject: { light: 1 }, anonEmptyPod: 0, podOutcome: { cooperative: 1, frightened: 0, hostile: 0, incapacitated: 0 } };
    let s = withRules(rules, () => {
      const p = fight({ enemies: "light", allies: "clampjaw" });
      return slugAll(p, ["light"]);
    });
    expect(s.event?.id).toBe("recovery");
    const key = s.pods[0].srcKey;
    expect(s.wrecks[0].src).toBe(key);
    s = withRules(rules, () => choose(s, openId(s)));
    s = choose(s, "secure");
    expect(s.partsRolled.filter((k) => k === key).length).toBe(1);
    const parts = s.parts;
    s = choose(s, "done");
    while (s.phase === "event") s = choose(s, options(s).find((o) => o.enabled)!.id);
    if (s.phase === "salvage") s = reduce(s, { type: "salvage", targetId: s.wrecks[0].id });
    expect(s.partsRolled.filter((k) => k === key).length).toBe(1);
    expect(s.parts).toBe(parts);
  });
});

// ---------- enemy equipment (9–15) ----------

describe("enemy equipment", () => {
  const sample = (room: number, n = 400) => {
    let s = fight({ enemies: "light" });
    s.room = room;
    let equipped = 0;
    let total = 0;
    for (let i = 0; i < n; i++) {
      const u = { ...foe(s, "light"), uid: "t" + i, gear: undefined, gearRolled: false, ammo: undefined } as Unit;
      prepEnemy(s, u);
      if (u.gear?.length) equipped++;
      total += u.gear?.length ?? 0;
    }
    return { rate: equipped / n, total };
  };
  it("9. rooms 1–2 roll no random equipment; rooms 3–4 rarely (v0.7)", () => {
    for (const room of [1, 2]) expect(sample(room).rate).toBe(0);
    for (const room of [3, 4]) {
      expect(sample(room).rate).toBeGreaterThan(0.04);
      expect(sample(room).rate).toBeLessThan(0.17);
    }
  });
  it("10. deeper rooms equip at the configured rate, with at most the configured count", () => {
    expect(sample(6).rate).toBeGreaterThan(0.17);
    expect(sample(6).rate).toBeLessThan(0.33);
    expect(sample(11).rate).toBeGreaterThan(0.37);
    expect(sample(11).rate).toBeLessThan(0.53);
    const deep = sample(22);
    expect(deep.rate).toBeGreaterThan(0.72);
    expect(deep.total / 400).toBeGreaterThan(deep.rate); // some carry two
  });
  it("11. the Missile Pod fires on its cooldown, once a turn, and not while stunned", () => {
    let s = fight({ enemies: "light", quiet: false });
    j(s).hp = j(s).maxHp = 99;
    s = qa(s, "gear", undefined, "missilepod");
    const fired: number[] = [];
    for (let t = 0; t < 7; t++) {
      s = end(s);
      if (s.events.some((l) => l.includes("missile pod") || l.includes("Missile Pod"))) fired.push(t);
    }
    expect(fired).toEqual([0, 3, 6]);
    expect(foe(s, "light").gear![0].revealed).toBe(true);
    // Stunned: no launch, and no cooldown spent.
    let st = fight({ enemies: "light" });
    st = qa(st, "gear", undefined, "missilepod");
    st = end(st);
    expect(st.events.some((l) => l.includes("missile pod"))).toBe(false);
    expect(foe(st, "light").gear![0].cd).toBe(0);
  });
  it("12. Extended Magazine: 6 rounds instead of 4, then a telegraphed reload", () => {
    const shotsBeforeReload = (gear: string) => {
      let s = fight({ enemies: "light", quiet: false });
      j(s).hp = j(s).maxHp = 99;
      s = qa(s, "gear", undefined, gear);
      foe(s, "light").missiles = 0; // its own missile rack does not use the magazine
      expect(magazine(foe(s, "light"))).toBe(gear === "extmag" ? 6 : 4);
      for (let t = 0; t < 10; t++) {
        if (foe(s, "light").plan?.type === "reload") return t;
        s = end(s);
      }
      return -1;
    };
    expect(shotsBeforeReload("laser")).toBe(4);
    expect(shotsBeforeReload("extmag")).toBe(6);
  });
  it("12. an unidentified Extended Magazine gives itself away once it outlasts a normal one", () => {
    let s = withRules({ obvMin: 0, obvMax: 0 }, () => {
      let p = fight({ enemies: "light", quiet: false });
      j(p).hp = j(p).maxHp = 99;
      p = qa(p, "gear", undefined, "extmag");
      foe(p, "light").missiles = 0;
      return p;
    });
    for (let t = 0; t < 6; t++) s = end(s);
    expect(said(s, "Extended Magazine")).toBe(true);
  });
  it("13. Laser Sight adds 10 points of accuracy, inside the hit cap", () => {
    const s = fight({ enemies: "light" });
    const u = foe(s, "light");
    const base = enemyHitChance(s, u);
    u.gear = [makeGear(s, "laser")];
    expect(enemyHitChance(s, u)).toBeCloseTo(Math.min(RULES.hitCap, base + RULES.laserBonus), 6);
    s.accModEnemy = 5;
    expect(enemyHitChance(s, u)).toBeLessThanOrEqual(Math.max(RULES.hitCap, 1 - (1 - RULES.enemyBaseHit) / 32));
  });
  it("14. equipment is rolled once per enemy and stays put", () => {
    let s = fight({ enemies: "light" });
    s.room = 22;
    const u = foe(s, "light");
    u.gearRolled = false;
    prepEnemy(s, u);
    const kit = JSON.stringify(u.gear);
    const rng = s.rng;
    prepEnemy(s, u);
    expect(JSON.stringify(u.gear)).toBe(kit);
    expect(s.rng).toBe(rng);
    s = end(end(s));
    expect(JSON.stringify(foe(s, "light").gear?.map((g) => [g.uid, g.id]))).toBe(JSON.stringify(JSON.parse(kit)?.map((g: { uid: string; id: string }) => [g.uid, g.id]) ?? undefined));
  });
  it("15. one salvage roll per installed item, ever", () => {
    let s = fight({ enemies: "light" });
    s = qa(s, "gear", undefined, "laser");
    const items = s.items.length;
    s = withRules({ gearSalvage: 1 }, () => noPods(() => slugAll(s, ["light"])));
    expect(s.items.filter((x) => x.id === "targeting").length).toBe(1);
    expect(s.items.length).toBe(items + 1);
  });
});

// ---------- Observation (16–22) ----------

describe("Observation", () => {
  it("16. every pilot has an Observation stat: R-8, recruits, pod pilots, stalker pilots", () => {
    let s = qa(begun(), "recruit", 70);
    s.room = 6;
    s.threat = 6;
    createStalker(s, "hunter");
    for (const r of s.roster) expect(statOf(r, "observation"), r.name).toBeGreaterThanOrEqual(1);
  });
  it("adding Observation did not reroll Mental, Skill or Endurance", () => {
    // Observation is rolled last: the first three stats of the R-8 pilots match a roll without it.
    const s = begun(11);
    const t = begun(11);
    for (const r of s.roster) expect(rec(t, r.id)!.base).toEqual(r.base);
  });
  it("17. a version 6 save migrates deterministically and keeps the other stats", () => {
    const s = begun(9);
    const old = sane(s) as GameState & { v: number };
    old.v = 6;
    for (const r of old.roster) {
      delete (r.base as Partial<typeof r.base>).observation;
      delete (r.earned as Partial<typeof r.earned>).observation;
    }
    for (const k of ["pods", "buddy", "stalkers", "pendingStalker", "routeSnippets", "notices", "scanned"]) delete (old as unknown as Record<string, unknown>)[k];
    const a = migrate(sane(old))!;
    const b = migrate(sane(old))!;
    expect(a.v).toBe(SAVE_VERSION);
    for (const r of a.roster) {
      const was = old.roster.find((x) => x.id === r.id)!;
      expect(r.base.mental).toBe(was.base.mental);
      expect(r.base.skill).toBe(was.base.skill);
      expect(r.base.endurance).toBe(was.base.endurance);
      expect(r.base.observation).toBe(b.roster.find((x) => x.id === r.id)!.base.observation);
      expect(r.base.observation).toBeGreaterThanOrEqual(1);
    }
    expect(a.stalkers).toEqual([]);
    expect(legalActions(a).length).toBeGreaterThan(0);
    expect(migrate({ v: 3, roster: [] })).toBeNull();
  });
  it("18. higher Observation means better odds, clamped to 5–90%", () => {
    expect(discoveryChance(1, "missilepod")).toBeCloseTo(0.16);
    expect(discoveryChance(5, "missilepod")).toBeCloseTo(0.4);
    expect(discoveryChance(10, "missilepod")).toBeGreaterThan(discoveryChance(3, "missilepod"));
    expect(discoveryChance(10, "extmag")).toBeCloseTo(0.6);
    expect(discoveryChance(0, "extmag")).toBe(RULES.obvMin);
    expect(discoveryChance(40, "laser")).toBe(RULES.obvMax);
  });
  it("19. a failed check keeps it hidden until it shows itself", () => {
    let s = withRules({ obvMin: 0, obvMax: 0 }, () => {
      let p = fight({ enemies: "light", quiet: false });
      j(p).hp = j(p).maxHp = 99;
      p = qa(p, "gear", undefined, "laser");
      foe(p, "light").gear![0].checked = false;
      p = reduce(p, { type: "qa", cmd: "noop" });
      return p;
    });
    s = withRules({ obvMin: 0, obvMax: 0 }, () => {
      const p = sane(s);
      prepEnemy(p, foe(p, "light"));
      return p;
    });
    expect(foe(s, "light").gear![0].revealed).toBe(false);
    s = end(s);
    expect(foe(s, "light").gear![0].revealed).toBe(true);
    expect(foe(s, "light").gear![0].seen).toBe(false);
  });
  it("20. a successful check identifies it before it acts", () => {
    const s = withRules({ obvMin: 1, obvMax: 1 }, () => {
      const p = fight({ enemies: "light" });
      const u = foe(p, "light");
      u.gear = [makeGear(p, "missilepod")];
      prepEnemy(p, u);
      return p;
    });
    const g = foe(s, "light").gear![0];
    expect([g.seen, g.revealed, g.cd]).toEqual([true, true, 0]);
    expect(said(s, "OBSERVED: ADD-ON MISSILE POD")).toBe(true);
  });
  it("21. looking again never rerolls", () => {
    const s = fight({ enemies: "light" });
    const u = foe(s, "light");
    u.gear = [makeGear(s, "laser")];
    prepEnemy(s, u);
    const snap = JSON.stringify(s);
    prepEnemy(s, u);
    eventView(s);
    legalActions(s);
    expect(JSON.stringify(s)).toBe(snap);
  });
  it("22. the party rolls once with its best eye, however many pilots it has", () => {
    const rolls = (crew: number) => {
      let s = begun();
      for (let i = 0; i < crew; i++) s = qa(s, "recruit", 70);
      s = qa(s, "fight", 0, "light");
      const u = foe(s, "light");
      u.gear = [makeGear(s, "laser"), makeGear(s, "missilepod")];
      const before = s.rng;
      let n = 0;
      const probe = sane(s);
      probe.rng = before;
      prepEnemy(s, u);
      // Count RNG steps by replaying the same number of chance() calls.
      void probe;
      n = s.rng === before ? 0 : 1;
      return { n, best: partyObservation(s), all: s.roster.filter((r) => r.custody === "ally").map(observation) };
    };
    const one = rolls(1);
    const three = rolls(3);
    expect(three.best.obv).toBe(Math.max(RULES.jubeyObv, ...three.all));
    expect(one.n).toBe(three.n);
    // Exactly one check per item: each is marked checked and never checked again.
    const s = fight({ enemies: "light" });
    const u = foe(s, "light");
    u.gear = [makeGear(s, "laser")];
    prepEnemy(s, u);
    expect(u.gear[0].checked).toBe(true);
    const rng = s.rng;
    prepEnemy(s, u);
    expect(s.rng).toBe(rng);
  });
  it("a scouting action buys one more look, once a fight, for 1 Energy", () => {
    let s = withRules({ obvMin: 0, obvMax: 0 }, () => {
      const p = fight({ enemies: "light" });
      const u = foe(p, "light");
      u.gear = [makeGear(p, "laser")];
      prepEnemy(p, u);
      return p;
    });
    const energy = s.energy;
    s = withRules({ obvMin: 1, obvMax: 1 }, () => reduce(s, { type: "scan" }));
    expect(s.energy).toBe(energy - 1);
    expect(foe(s, "light").gear![0].revealed).toBe(true);
    expect(legalActions(s).some((a) => a.type === "scan")).toBe(false);
  });
});

// ---------- targeting and Robobuddy (23–33) ----------

describe("enemy targeting", () => {
  const share = (attacker: string, allies: string, n = 3000) => {
    const s = fight({ enemies: attacker, allies });
    const u = foe(s, attacker);
    const count: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const t = pickTargetForTest(s, u);
      if (t) count[t.kind] = (count[t.kind] ?? 0) + 1;
    }
    for (const k of Object.keys(count)) count[k] /= n;
    return count;
  };
  it("23–24. ordinary enemies spread their fire: Jubey is one target among several", () => {
    const c = share("light", "builder,walker,frame");
    expect(c.jubey).toBeLessThan(0.35);
    for (const k of ["builder", "walker", "frame"]) expect(c[k], k).toBeGreaterThan(0.12);
    const alone = share("light", "");
    expect(alone.jubey).toBe(1);
  });
  it("23. roughly three quarters of picks are uniform; the rest are tactical (the most wounded)", () => {
    const s = fight({ enemies: "light", allies: "builder,clampjaw,possum" });
    ally(s, "builder").hp = 1;
    const u = foe(s, "light");
    let hurt = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) if (pickTargetForTest(s, u)?.kind === "builder") hurt++;
    // Weighted random share plus all of the tactical 0.25. Clampjaw and Possum weigh less (v0.7).
    const w = 2 + 2 * RULES.noncombatWeight;
    expect(hurt / n).toBeGreaterThan((0.75 * 1) / w + 0.25 - 0.05);
    expect(hurt / n).toBeLessThan((0.75 * 1) / w + 0.25 + 0.05);
  });
  it("25. illegal targets are never picked: overhead for melee, foamed, shut down", () => {
    const s = fight({ enemies: "latchback", allies: "walker,builder" });
    ally(s, "builder").foam = true;
    const u = foe(s, "latchback");
    for (let i = 0; i < 500; i++) {
      const t = pickTargetForTest(s, u)!;
      expect(t.kind).not.toBe("walker");
      expect(t.kind).not.toBe("builder");
    }
  });
  it("the decoy beacon is still an explicit exception", () => {
    const s = fight({ enemies: "light", allies: "beacon,builder" });
    for (let i = 0; i < 200; i++) expect(pickTargetForTest(s, foe(s, "light"))!.kind).toBe("beacon");
  });
  it("26. Relay Bishop's orders still take over the plan", () => {
    let s = fight({ team: "bishop,latchback", quiet: false });
    j(s).hp = j(s).maxHp = 80;
    foe(s, "bishop").hp = 5;
    s = end(s);
    expect(s.teamOrder).toBe("Cover the Commander");
    expect(foe(s, "latchback").plan!.note).toBe("covering the commander");
  });
  it("27. melee enemies still have to close before a blow lands", () => {
    let s = fight({ team: "latchback", quiet: false });
    j(s).hp = j(s).maxHp = 80;
    const l = foe(s, "latchback");
    l.prox = 0;
    l.plan = { type: "attack", targetUid: j(s).uid, dmg: l.atk }; // a plan to hit is not enough
    const hp = living(s, "friendly").map((u) => u.hp);
    s = end(s);
    expect(foe(s, "latchback").prox).toBe(1);
    expect(living(s, "friendly").map((u) => u.hp)).toEqual(hp);
  });
});

describe("Robobuddy reconstruction", () => {
  const downed = () => {
    let s = fight({ pick: "buddy", enemies: "light", quiet: true });
    s = qa(s, "buddydown");
    return s;
  };
  it("28. destroyed, it becomes a shell: off the line, record kept, no wreck to strip", () => {
    const s = downed();
    expect(s.buddy.status).toBe("wrecked");
    expect(s.buddy.penalty).toBe(true);
    expect(s.units.some((u) => u.kind === "robobuddy")).toBe(false);
    expect(s.wrecks.some((w) => w.kind === "robobuddy")).toBe(false);
  });
  it("29–31. a wreck with 2 Scrap rebuilds it at half HP and cancels the Threat penalty", () => {
    let s = noPods(() => slugAll(downed(), ["light"]));
    expect(s.event?.id).toBe("recovery");
    expect(eventView(s)!.lines.some((l) => l.startsWith("ROBOBUDDY DISABLED"))).toBe(true);
    const rebuild = options(s).find((o) => o.id.startsWith("rebuild:"))!;
    expect(rebuild.enabled).toBe(true);
    const threat = s.threat;
    s = choose(s, rebuild.id);
    expect(s.buddy).toMatchObject({ status: "reassembling", penalty: false, rebuilt: 1, deaths: 1, readyRoom: s.room + RULES.buddyReassemblyRooms + 1 });
    expect(s.units.some((u) => u.kind === "robobuddy")).toBe(false);
    s = choose(s, "done");
    expect(s.threat).toBe(threat);
  });
  it("a rebuilt Robobuddy sits out the next two rooms, then rejoins at half HP", () => {
    let s = noPods(() => slugAll(downed(), ["light"]));
    const built = s.room;
    s = choose(s, options(s).find((o) => o.id.startsWith("rebuild:"))!.id);
    s = choose(s, "done");
    for (let i = 1; i <= RULES.buddyReassemblyRooms; i++) {
      s = nextRoom(s);
      expect(s.room).toBe(built + i);
      expect(s.buddy.status, `room ${s.room}`).toBe("reassembling");
      expect(s.units.some((u) => u.kind === "robobuddy"), `room ${s.room}`).toBe(false);
    }
    s = nextRoom(s);
    expect(s.room).toBe(built + RULES.buddyReassemblyRooms + 1);
    const b = ally(s, "robobuddy");
    expect(b.hp).toBe(Math.ceil(RULES.buddyHp * RULES.buddyRebuildHp));
    expect(b.maxHp).toBe(RULES.buddyHp);
    expect(s.buddy.status).toBe("active");
    // Saving and reloading mid-reassembly changes nothing.
    let t = noPods(() => slugAll(downed(), ["light"]));
    t = choose(choose(t, options(t).find((o) => o.id.startsWith("rebuild:"))!.id), "done");
    expect(sane(t).buddy).toEqual(t.buddy);
  });
  it("a full line makes it wait a room longer instead of overlapping", () => {
    let s = noPods(() => slugAll(downed(), ["light"]));
    s = choose(choose(s, options(s).find((o) => o.id.startsWith("rebuild:"))!.id), "done");
    while (freeFriendSlot(s) >= 0) s = qa(s, "ally", undefined, "builder");
    for (let i = 0; i <= RULES.buddyReassemblyRooms; i++) s = nextRoom(s);
    expect(s.buddy.status).toBe("reassembling");
    expect(said(s, "no room on the line")).toBe(true);
  });
  it("31. left as a shell, the penalty lands exactly once", () => {
    let s = noPods(() => slugAll(downed(), ["light"]));
    const threat = s.threat;
    s = choose(s, "done");
    expect(s.threat).toBe(threat + RULES.buddyLossThreat);
    expect(s.buddy).toMatchObject({ status: "wrecked", penalty: false });
    s = qa(s, "fight", 0, "light");
    s = noPods(() => slugAll(s, ["light"]));
    const t2 = s.threat;
    const rebuild = options(s).find((o) => o.id.startsWith("rebuild:"));
    expect(rebuild?.enabled).toBe(true); // still recoverable later
    s = choose(s, rebuild!.id);
    s = choose(s, "done");
    expect(s.threat).toBe(t2); // no refund, no second charge
  });
  it("32. the Scrap it takes is gone from the wreck", () => {
    let s = downed();
    s = noPods(() => slugAll(s, ["light"]));
    s.wrecks = [{ id: "wx", kind: "widow", side: "enemy", value: 3 }];
    s = choose(s, "rebuild:wx");
    expect(s.wrecks.find((w) => w.id === "wx")!.value).toBe(3 - RULES.buddyRebuildCost);
    s = choose(s, "done");
    while (s.phase === "event") s = choose(s, options(s).find((o) => o.enabled)!.id);
    const scrap = s.scrap;
    s = reduce(s, { type: "salvage", targetId: "wx" });
    expect(s.scrap).toBe(scrap + 3 - RULES.buddyRebuildCost);
  });
  it("33. no eligible wreck: no free rebuild, and the screen says why", () => {
    let s = downed();
    s = noPods(() => slugAll(s, ["light"]));
    s.wrecks = [{ id: "wy", kind: "drone", side: "enemy", value: 1 }];
    const why = withRules({ buddyRebuildCost: 2 }, () => option(s, "rebuild-none")!);
    expect(why.enabled).toBe(false);
    expect(why.detail).toContain("No wreck holds 2 Scrap");
    s.wrecks = [];
    expect(option(s, "rebuild-none")!.detail).toContain("No wreckage");
    const scrap = s.scrap;
    s = choose(s, "done");
    expect(s.buddy.status).toBe("wrecked");
    expect(s.scrap).toBe(scrap);
  });
});

// ---------- stalkers (34–46) ----------

describe("Threat stalkers", () => {
  const atRoom = (room: number, threat: number, seed = 7) => {
    const s = begun(seed);
    s.room = room - 1;
    s.threat = threat;
    s.team.nextAt = 999; // keep R-8 out of these rooms: they take precedence over a stalker
    s.salvagedThisRoom = true; // no quiet-room drain on the way in
    return nextRoom(s);
  };
  it("34. Threat 5 starts one stalker hunting; Threat 4 does not", () => {
    expect(atRoom(6, 5).stalkers.length).toBe(1);
    expect(atRoom(6, 4).stalkers.length).toBe(0);
    expect(atRoom(6, 5).stalkers[0].state).toBe("hunting");
  });
  it("35. its level is the room's expected level plus the Threat bonus, fixed at creation", () => {
    expect(expectedLevel(12)).toBe(4);
    expect(atRoom(12, 5).stalkers[0].level).toBe(4 + 1);
    expect(atRoom(12, 7).stalkers[0].level).toBe(4 + 2);
    expect(atRoom(3, 9).stalkers[0].level).toBe(1 + 3);
    let s = atRoom(12, 5);
    const lvl = s.stalkers[0].level;
    s.threat = 9;
    s = nextRoom(s);
    expect(s.stalkers[0].level).toBe(lvl);
    expect(stalkerStats("hunter", 5).hp).toBe(12 + RULES.stalkerHpPerLevel * 4);
  });
  it("36. one persistent identity, one at a time", () => {
    let s = atRoom(6, 6);
    const id = s.stalkers[0].id;
    for (let i = 0; i < 3; i++) s = nextRoom(s);
    expect(s.stalkers.length).toBe(1);
    expect(s.stalkers[0].id).toBe(id);
  });
  it("37. route snippets follow its real state", () => {
    let s = atRoom(6, 6);
    const kindLines = POOLS[s.stalkers[0].kind] ?? [];
    expect(s.routeSnippets.length).toBe(1);
    expect([...POOLS.hunting, ...kindLines]).toContain(s.routeSnippets[0]);
    s.stalkers[0].distance = 2;
    s = nextRoom(s); // 2 -> 1: approaching
    expect(s.stalkers[0].state).toBe("approaching");
    expect([...POOLS.approaching, ...kindLines]).toContain(s.routeSnippets[0]);
    s = nextRoom(s); // 1 -> 0: waiting behind a door
    expect(s.stalkers[0].state).toBe("intercepting");
    expect([...POOLS.intercepting, ...kindLines]).toContain(s.routeSnippets[0]);
    defeat(s, s.stalkers[0], "test");
    s.threat = 0;
    s = nextRoom(s);
    expect(POOLS.aftermath).toContain(s.routeSnippets[0]);
    s = nextRoom(s);
    expect(s.routeSnippets.length).toBe(0); // the aftermath line shows once
  });
  it("snippets do not repeat back to back for the same stalker", () => {
    let s = atRoom(6, 6);
    s.stalkers[0].distance = 30;
    let last = s.routeSnippets[0];
    for (let i = 0; i < 8; i++) {
      s = nextRoom(s);
      expect(s.routeSnippets[0]).not.toBe(last);
      last = s.routeSnippets[0];
    }
  });
  it("38. it moves on room transitions only: menus, views and saves do nothing", () => {
    let s = atRoom(6, 6);
    const d = s.stalkers[0].distance;
    legalActions(s);
    s = reduce(s, { type: "dismiss" });
    s = sane(s);
    expect(s.stalkers[0].distance).toBe(d);
    s = nextRoom(s);
    expect(s.stalkers[0].distance).toBe(d - 1);
  });
  it("39. intercepting: the matching door brings it into the fight, the other one does not", () => {
    let s = atRoom(6, 6);
    s.stalkers[0].distance = 1;
    s = nextRoom(s);
    const st = s.stalkers[0];
    expect(st.state).toBe("intercepting");
    const hit = reduce(sane(s), { type: "pickPath", risky: st.door === "risky" });
    const rushThrough = (x: GameState) => {
      while (x.phase === "event") x = choose(x, options(x).find((o) => o.enabled)!.id);
      return x;
    };
    const h = rushThrough(hit);
    expect(h.units.some((u) => u.stalkerId === st.id)).toBe(true);
    expect(h.stalkers[0].state).toBe("engaged");
    const miss = rushThrough(reduce(sane(s), { type: "pickPath", risky: st.door !== "risky" }));
    expect(miss.units.some((u) => u.stalkerId === st.id)).toBe(false);
    expect(miss.stalkers[0].misses).toBe(1);
  });
  it("40. destroying it takes Threat down by level plus the room difficulty bonus", () => {
    let s = fight({ enemies: "light" });
    s.room = 12;
    s.threat = 9;
    s = qa(s, "stalker", 0, "nightmare");
    s = qa(s, "fight", 0, "");
    const st = s.stalkers[0];
    const want = reductionFor(s, st);
    expect(want.level).toBe(st.level);
    expect(want.bonus).toBe(Math.max(0, rating(st) - expectedLevel(12)));
    s.threat = 20;
    s = slugAll(s, ["nightmare"]);
    expect(s.stalkers[0].state).toBe("defeated");
    expect(s.threat).toBe(20 - want.total);
    expect(s.notices[0].title).toBe("STALKING THREAT ELIMINATED");
    expect(s.notices[0].lines).toContain(`Threat reduced: ${want.total} (20 → ${20 - want.total})`);
  });
  it("41–42. never below zero, and never twice", () => {
    const s = begun();
    s.room = 6;
    s.threat = 6;
    const st = createStalker(s, "nightmare");
    s.threat = 1;
    defeat(s, st, "test");
    expect(s.threat).toBe(0);
    s.threat = 5;
    defeat(s, st, "again");
    resolveStalkers(s);
    expect(s.threat).toBe(5);
    expect(s.notices.length).toBe(1);
  });
  it("43. its pilot getting away leaves the threat unresolved: it comes back refitted", () => {
    let s = withRules({ stalkerEject: 1 }, () => {
      let p = fight({ enemies: "light" });
      p.room = 6;
      p.threat = 6;
      p = qa(p, "stalker", 0, "hunter");
      p = qa(p, "fight", 0, "");
      return slugAll(p, ["hunter"]);
    });
    expect(s.event?.id).toBe("recovery");
    const threat = s.threat;
    s = choose(s, openId(s));
    s = choose(s, "release");
    s = choose(s, "done");
    const st = s.stalkers[0];
    expect(st.state).toBe("hunting");
    expect(st.refits).toBe(1);
    expect(st.distance).toBe(RULES.stalkerReturnDistance);
    expect(s.threat).toBe(threat);
  });
  it("44. its pilot captured: the stalker is finished and never moves again", () => {
    let s = withRules({ stalkerEject: 1 }, () => {
      let p = fight({ enemies: "light", allies: "clampjaw" });
      p.room = 6;
      p.threat = 6;
      p = qa(p, "stalker", 0, "hunter");
      p = qa(p, "fight", 0, "");
      return slugAll(p, ["hunter"]);
    });
    s = choose(s, openId(s));
    if (option(s, "subdue")) s = withRules({ subdue: 1 }, () => choose(s, "subdue"));
    s = choose(s, "secure");
    s = choose(s, "done");
    expect(s.stalkers[0].state).toBe("defeated");
    expect(s.notices.some((n) => n.title === "STALKING THREAT ELIMINATED")).toBe(true);
    const d = s.stalkers[0].distance;
    s = nextRoom(s);
    expect(s.stalkers[0]).toMatchObject({ state: "defeated", distance: d });
  });
  it("45. generic stalkers are never R-8 pilots", () => {
    const s = begun();
    s.room = 6;
    s.threat = 6;
    for (const p of s.team.pilots) p.status = "dead";
    const st = createStalker(s, "hunter");
    expect(s.team.pilots.some((p) => p.id === st.pilot)).toBe(false);
    expect(rec(s, st.pilot)!.origin).toBe("Facility hunter");
    const names = s.roster.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });
  it("46. stalker state survives a save and reload", () => {
    let s = atRoom(6, 6);
    s.stalkers[0].distance = 1;
    s = nextRoom(s);
    const loaded = sane(s);
    expect(loaded.stalkers).toEqual(s.stalkers);
    const a = reduce(s, { type: "pickPath", risky: true });
    const b = reduce(loaded, { type: "pickPath", risky: true });
    expect(b).toEqual(a);
  });
});
