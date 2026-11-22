// v0.9: the Light Mech's cousins (Scout, Gunner, Shield and Mortar Mechs),
// packs that grow with depth, and the Hangar and Last Safe Room from tier II.

import { describe, expect, it } from "vitest";
import { basicOutlook, createGame, legalActions, reduce, type Unit } from "../engine";
import { enemyHitChance, living } from "../core";
import { magazine } from "../gear";
import { coverFrom } from "../parts";
import { nmEligible } from "../nightmare";
import { PILOTED } from "../pilots";
import { RULES, cmd, end, fight, foe, j, play, qa, run, said, withRules } from "./helpers";

const begun = (seed = 7) => run(createGame(seed), { type: "start", seed }, { type: "loadout", pick: "lootbox" });

/** Packs rolled for a room across many seeds. */
function packs(room: number, n = 300): string[][] {
  const out: string[][] = [];
  for (let seed = 1; seed <= n; seed++) {
    const s = begun(seed);
    s.room = room - 1;
    s.team.nextAt = 999;
    s.phase = "tech";
    const t = reduce(s, { type: "nextRoom" });
    out.push([...t.nextPack]);
  }
  return out;
}
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("packs scale with depth", () => {
  it("room 1 is as it was; deeper packs are bigger", () => {
    const r1 = avg(packs(1).map((p) => p.length));
    const r6 = avg(packs(6).map((p) => p.length));
    const r10 = avg(packs(10).map((p) => p.length));
    const r13 = avg(packs(13).map((p) => p.length));
    expect(r1).toBeLessThan(2.1);
    expect(r6).toBeGreaterThan(r1);
    expect(r10).toBeGreaterThan(r6 + 0.7);
    expect(r13).toBeGreaterThan(r10 + 0.7);
  });
  it("cousins arrive by depth: Scouts from room 2, Gunners from 3, Shield and Mortar Mechs from 5", () => {
    const has = (room: number, k: string) => packs(room).some((p) => p.includes(k));
    expect(has(1, "scout")).toBe(false);
    expect(has(2, "scout")).toBe(true);
    expect(has(2, "gunner")).toBe(false);
    expect(has(3, "gunner")).toBe(true);
    for (const k of ["shieldmech", "mortar"]) {
      expect(has(4, k), k).toBe(false);
      expect(has(6, k), k).toBe(true);
    }
  });
  it("the outlook matches the rules: swap odds rise and cap, extras every three rooms from room 7, at most three", () => {
    expect(basicOutlook(1)).toMatchObject({ variant: 0, extras: 0 });
    expect(basicOutlook(4).variant).toBeCloseTo(0.3);
    expect(basicOutlook(20).variant).toBe(RULES.variantMax);
    expect([4, 6, 7, 10, 13, 30].map((r) => basicOutlook(r).extras)).toEqual([0, 0, 1, 2, 3, 3]);
  });
});

describe("Scout Mech", () => {
  it("a hit spots the target: the rest of the pack aims better at it this turn", () => {
    const s = fight({ enemies: "scout,light" });
    const l = foe(s, "light");
    const before = enemyHitChance(s, l, j(s));
    j(s).spotted = s.turn;
    expect(enemyHitChance(s, l, j(s))).toBeGreaterThan(before);
    expect(enemyHitChance(s, foe(s, "scout"), j(s))).toBe(enemyHitChance(s, foe(s, "scout"))); // not its own bonus
  });
  it("it acts first and marks what it hits", () => {
    let s = fight({ enemies: "light,scout", quiet: false });
    j(s).hp = j(s).maxHp = 40;
    s.accModEnemy = 9;
    for (const e of living(s, "enemy")) Object.assign(e, { missiles: 0, plan: { type: "attack", targetUid: j(s).uid, dmg: 1 } });
    s = withRules({ randomTarget: 1, partHitChance: 0 }, () => end(s));
    const i = s.events.findIndex((e) => e.includes("SPOTTED"));
    const lightHit = s.events.findIndex((e) => e.startsWith("Light Mech hits"));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(lightHit);
  });
});

describe("Gunner Mech", () => {
  it("fires two bursts a turn, each with its own round, then reloads", () => {
    let s = fight({ enemies: "gunner", quiet: false });
    j(s).hp = j(s).maxHp = 60;
    expect(magazine(foe(s, "gunner"))).toBe(4);
    s = withRules({ partHitChance: 0 }, () => end(s));
    expect(s.events.filter((e) => e.includes("keeps the trigger down")).length).toBe(1);
    expect(foe(s, "gunner").ammo).toBe(2);
    s = withRules({ partHitChance: 0 }, () => end(s));
    expect(foe(s, "gunner").ammo).toBe(0);
    expect(foe(s, "gunner").plan?.type).toBe("reload");
  });
});

describe("Shield Mech", () => {
  it("covers the enemies beside it against your guns", () => {
    let s = fight({ enemies: "light,shieldmech" });
    const sh = foe(s, "shieldmech");
    const l = foe(s, "light");
    l.slot = sh.slot === 0 ? 1 : sh.slot - 1;
    expect(coverFrom(s, l)?.kind).toBe("shieldmech");
    l.hp = l.maxHp = 10;
    s = qa(s, "hand", undefined, "SLUG");
    s = withRules({ partHitChance: 0 }, () => play(s, "SLUG", foe(s, "light")));
    expect(foe(s, "light").hp).toBe(6);
  });
});

describe("Mortar Mech", () => {
  const mortar = () => {
    const s = fight({ enemies: "mortar", allies: "walker", quiet: false });
    j(s).hp = j(s).maxHp = 40;
    s.accModEnemy = 9;
    return s;
  };
  it("marks a column, not a unit, and the warning shows on whatever stands there", () => {
    const s = mortar();
    const m = foe(s, "mortar");
    m.plan = { type: "shell", col: j(s).slot, targetUid: j(s).uid, note: "SHELLING" };
    expect(magazine(m)).toBe(1);
    const t = withRules({ partHitChance: 0 }, () => end(s));
    expect(j(t).hp).toBe(40 - RULES.mortarDamage);
  });
  it("moving out of the column dodges it, and cover does not help", () => {
    let s = mortar();
    const col = j(s).slot;
    foe(s, "mortar").plan = { type: "shell", col, targetUid: j(s).uid, note: "SHELLING" };
    const dir = [-1, 1].find((d) => col + d >= 0 && col + d <= 5 && !s.units.some((u) => u.side === "friendly" && u.slot === col + d))!;
    s = cmd(s, j(s), dir < 0 ? "shift-left" : "shift-right");
    const hp = j(s).hp;
    s = withRules({ partHitChance: 0 }, () => end(s));
    expect(j(s).hp).toBe(hp - RULES.mortarSplash); // the edge of the blast still reaches the next column
    expect(said(s, "Nobody is standing there")).toBe(true);
    // In cover beside a Bulkhead, the shell still lands in full.
    let c = fight({ enemies: "mortar", allies: "bulkhead", quiet: false });
    j(c).hp = j(c).maxHp = 40;
    c.accModEnemy = 9;
    const b = c.units.find((u) => u.kind === "bulkhead")!;
    b.slot = j(c).slot + 1;
    expect(coverFrom(c, j(c))).toBeTruthy();
    foe(c, "mortar").plan = { type: "shell", col: j(c).slot, targetUid: j(c).uid, note: "SHELLING" };
    c = withRules({ partHitChance: 0 }, () => end(c));
    expect(j(c).hp).toBe(40 - RULES.mortarDamage);
  });
  it("alternates: a shell, then a turn loading the next one", () => {
    let s = mortar();
    s = withRules({ partHitChance: 0 }, () => end(s));
    expect(foe(s, "mortar").plan?.type).toBe("reload");
    expect(foe(s, "mortar").plan?.note).toBe("LOADING A SHELL");
    s = end(s);
    expect(foe(s, "mortar").plan?.type).toBe("shell");
  });
});

describe("the cousins fit the existing systems", () => {
  it("they are piloted: escape pods, Cockpit Parts, enemy equipment", () => {
    for (const k of ["scout", "gunner", "shieldmech", "mortar"] as const) {
      expect(PILOTED, k).toContain(k);
      expect(RULES.anonEject[k], k).toBeGreaterThan(0);
    }
    let s = withRules({ anonEject: { mortar: 1 }, anonEmptyPod: 0, podOutcome: { cooperative: 1, frightened: 0, hostile: 0, incapacitated: 0 } }, () => {
      const p = fight({ enemies: "mortar" });
      const m = foe(p, "mortar");
      m.hp = 1;
      m.armor = 0;
      const q = qa(p, "hand", undefined, "SLUG");
      return play(q, "SLUG", foe(q, "mortar"));
    });
    expect(s.event?.id).toBe("recovery");
    s = withRules({ podOutcome: { cooperative: 1, frightened: 0, hostile: 0, incapacitated: 0 } }, () => reduce(s, { type: "event", option: s.pods.length ? `open:${s.pods[0].id}` : "done" }));
    const r = s.roster[s.roster.length - 1];
    expect(r.eligible).toBe("mortar");
    expect(["Technician", "Heavy"]).toContain(r.spec);
  });
  it("random play meets all four and never leaves the game stuck", () => {
    for (const k of ["scout", "gunner", "shieldmech", "mortar"]) {
      let s = fight({ enemies: `${k},${k},light` });
      for (let i = 0; i < 6 && s.phase === "player"; i++) s = end(s);
      expect(legalActions(s).length, k).toBeGreaterThan(0);
    }
  });
  it("the route preview names them", () => {
    const s = begun();
    s.room = 5;
    s.phase = "tech";
    const t = reduce(s, { type: "nextRoom" });
    expect(t.room).toBe(6);
    expect(basicOutlook(t.room).kinds).toEqual(expect.arrayContaining(["scout", "gunner", "shieldmech", "mortar"]));
  });
});

describe("Nightmare Rooms earlier (Prompt 12)", () => {
  it("the Hangar and the Last Safe Room can appear from tier II", () => {
    const s = begun();
    s.room = 5;
    s.threat = 0;
    expect(nmEligible(s)).toEqual(expect.arrayContaining(["hangar", "saferoom"]));
    s.room = 3;
    expect(nmEligible(s)).not.toContain("hangar");
  });
});

void ({} as Unit);
