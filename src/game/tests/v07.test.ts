// Prompt 10 (v0.7): non-combat bots out of the line of fire, Threat drain per
// room, early enemy equipment, part damage, cover and positioning, restraints
// as capture tools, and the grouped log.

import { describe, expect, it } from "vitest";
import { createGame, eventView, legalActions, pickTargetForTest, reduce, type GameState } from "../engine";
import { enemyHitChance, freeFriendSlot } from "../core";
import { makeGear, magazine } from "../gear";
import { coverFrom, partDown } from "../parts";
import { boundCaptives, restrainChance } from "../restraint";
import { makePilot, rec } from "../pilots";
import { isFlavor, logGroups } from "../../ui/shared";
import { RULES, ally, choose, cmd, end, fight, foe, j, noPods, play, qa, run, said, withRules } from "./helpers";

const options = (s: GameState) => eventView(s)?.options ?? [];
const option = (s: GameState, id: string) => options(s).find((o) => o.id === id);

function share(s: GameState, attacker: string, n = 4000) {
  const u = foe(s, attacker);
  const count: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const t = pickTargetForTest(s, u)!;
    count[t.kind] = (count[t.kind] ?? 0) + 1 / n;
  }
  return count;
}

describe("non-combat bots", () => {
  it("are picked far less often than anything that fights", () => {
    const s = fight({ pick: "buddy", enemies: "light", allies: "possum,clampjaw" });
    const c = share(s, "light");
    // Before v0.7 each of these took a quarter of the random picks (0.19 each).
    for (const k of ["robobuddy", "possum", "clampjaw"]) expect(c[k] ?? 0, k).toBeLessThan(0.075);
    expect(c.jubey).toBeGreaterThan(0.8);
  });
  it("ally mechs and fighting bots keep their full share", () => {
    const s = fight({ enemies: "light", allies: "walker,frame" });
    const c = share(s, "light");
    for (const k of ["walker", "frame"]) expect(c[k], k).toBeGreaterThan(0.2);
  });
  it("bots that build toward a threat are not reduced (Builder, Warframe) or reduced less (Shepherd)", () => {
    const s = fight({ enemies: "light", allies: "builder,warframe,shepherd" });
    s.units.find((u) => u.kind === "warframe")!.inert = true;
    const c = share(s, "light", 6000);
    expect(c.builder).toBeGreaterThan(0.17);
    expect(c.warframe).toBeGreaterThan(0.17);
    expect(c.shepherd).toBeGreaterThan(0.08);
    expect(c.shepherd).toBeLessThan(c.builder);
  });
  it("a thinking enemy never wastes its tactical shot on one, unless nothing else is there", () => {
    const s = fight({ pick: "buddy", enemies: "light" });
    ally(s, "robobuddy").hp = 1;
    const c = withRules({ randomTarget: 0 }, () => share(s, "light", 500));
    expect(c.robobuddy ?? 0).toBe(0);
    j(s).foam = true; // Jubey out of reach: the buddy is all that is left
    const only = withRules({ randomTarget: 0 }, () => share(s, "light", 50));
    expect(only.robobuddy).toBeCloseTo(1, 6);
  });
});

describe("Threat drains per room", () => {
  it("drops on entering a room after a quiet one, holds after stripping, never per turn", () => {
    let s = fight({ enemies: "light,light", quiet: true });
    s.threat = 5;
    s = end(s, 3);
    expect(s.threat).toBe(5); // no drain inside a fight
    const quiet = (t: GameState) => {
      t.phase = "tech";
      t.event = null;
      return reduce(t, { type: "nextRoom" });
    };
    let a = quiet(s);
    expect(a.threat).toBe(4);
    expect(said(a, "Threat settles")).toBe(true);
    a = quiet(a);
    expect(a.threat).toBe(3);
    const b = structuredClone(s);
    b.salvagedThisRoom = true;
    expect(quiet(b).threat).toBe(5);
    const z = structuredClone(s);
    z.threat = 0;
    expect(quiet(z).threat).toBe(0);
  });
});

describe("part damage", () => {
  const hit = (dmg: number, chanceRule = 1) =>
    withRules({ partHitChance: chanceRule }, () => {
      let s = fight({ enemies: "zombie", hand: "SLUG" });
      foe(s, "zombie").hp = 20;
      foe(s, "zombie").maxHp = 20;
      s = reduce(s, { type: "qa", cmd: "hand", s: "SLUG" });
      if (dmg < 5) foe(s, "zombie").armor = 5 - dmg;
      return play(s, "SLUG", foe(s, "zombie"));
    });
  it("a hard hit can knock out one part; small hits cannot", () => {
    const s = hit(5);
    expect(foe(s, "zombie").partsDown!.length).toBe(1);
    expect(said(s, "PART DAMAGE")).toBe(true);
    expect(foe(hit(1), "zombie").partsDown ?? []).toEqual([]);
    expect(foe(hit(5, 0), "zombie").partsDown ?? []).toEqual([]);
  });
  it("each part goes once", () => {
    let s = fight({ enemies: "zombie" });
    const z = foe(s, "zombie");
    z.hp = z.maxHp = 60;
    z.armor = 0;
    for (let i = 0; i < 6; i++) {
      s = qa(qa(s, "hand", undefined, "SLUG"), "energy", 9);
      s = withRules({ partHitChance: 1 }, () => play(s, "SLUG", foe(s, "zombie")));
    }
    expect([...foe(s, "zombie").partsDown!].sort()).toEqual(["actuator", "sensors", "weapon"]);
  });
  it("sensors: a step of aim and the Laser Sight; weapon: a point of damage and the Extended Magazine", () => {
    const s = fight({ enemies: "light" });
    const u = foe(s, "light");
    u.gear = [makeGear(s, "laser"), makeGear(s, "extmag")];
    const aim = enemyHitChance(s, u);
    const mag = magazine(u);
    u.partsDown = ["sensors"];
    expect(enemyHitChance(s, u)).toBeLessThan(aim - RULES.laserBonus);
    u.partsDown = ["weapon"];
    expect(magazine(u)).toBe(RULES.magazine);
    expect(mag).toBeGreaterThan(RULES.magazine);
  });
  it("weapon damage takes a point off its hits", () => {
    let s = fight({ enemies: "light", quiet: false });
    j(s).hp = j(s).maxHp = 50;
    const l = foe(s, "light");
    Object.assign(l, { atk: 2, missiles: 0, partsDown: ["weapon"], plan: { type: "attack", targetUid: j(s).uid, dmg: 2 } });
    s.accModEnemy = 9;
    s = withRules({ randomTarget: 1, partHitChance: 0 }, () => end(s));
    expect(s.events.some((e) => e.includes("Light Mech hits Jubey for 1"))).toBe(true);
  });
  it("actuator: no Missile Pod, and a melee unit drags its leg", () => {
    let s = fight({ team: "latchback", quiet: false });
    j(s).hp = j(s).maxHp = 80;
    const l = foe(s, "latchback");
    l.prox = 0;
    l.partsDown = ["actuator"];
    l.gear = [makeGear(s, "missilepod")];
    const before = [l.prox];
    for (let t = 0; t < 2; t++) {
      s = end(s);
      before.push(foe(s, "latchback").prox ?? 0);
    }
    expect(before[2] - before[0]).toBeLessThanOrEqual(1);
    expect(s.log.some((x) => x.includes("drags its damaged actuator"))).toBe(true);
    expect(s.log.some((x) => x.toLowerCase().includes("missile pod"))).toBe(false);
    expect(partDown(foe(s, "latchback"), "actuator")).toBe(true);
  });
});

describe("cover and positioning", () => {
  it("a Bulkhead covers the units beside it: a point off each direct-fire hit, nothing off melee", () => {
    let s = fight({ enemies: "light", allies: "bulkhead", quiet: false });
    const b = ally(s, "bulkhead");
    expect(coverFrom(s, j(s))?.uid).toBe(Math.abs(b.slot - j(s).slot) === 1 ? b.uid : undefined);
    // Put the bulkhead right beside Jubey.
    b.slot = j(s).slot + 1;
    expect(coverFrom(s, j(s))?.kind).toBe("bulkhead");
    j(s).hp = j(s).maxHp = 50;
    const l = foe(s, "light");
    Object.assign(l, { atk: 2, missiles: 0, slot: j(s).slot, plan: { type: "attack", targetUid: j(s).uid, dmg: 2 } });
    s.accModEnemy = 9;
    s = withRules({ randomTarget: 1, partHitChance: 0 }, () => end(s));
    expect(s.events.some((e) => e.includes("in cover behind the Bulkhead"))).toBe(true);
    expect(s.events.some((e) => e.includes("Light Mech hits Jubey for 1"))).toBe(true);
  });
  it("a Command Relay covers the enemies beside it against your guns", () => {
    let s = fight({ enemies: "light,relay" });
    const r = foe(s, "relay");
    const l = foe(s, "light");
    l.slot = r.slot + 1 > 5 ? r.slot - 1 : r.slot + 1;
    l.hp = l.maxHp = 10;
    s = qa(s, "hand", undefined, "SLUG");
    s = withRules({ partHitChance: 0 }, () => play(s, "SLUG", foe(s, "light")));
    expect(foe(s, "light").hp).toBe(10 - 4);
  });
  it("enemy fire from four or more columns across loses a step of aim", () => {
    const s = fight({ enemies: "light", allies: "walker" });
    const l = foe(s, "light");
    const near = { ...j(s), slot: l.slot };
    const far = { ...j(s), slot: l.slot >= 3 ? l.slot - 4 : l.slot + 4 };
    expect(enemyHitChance(s, l, far)).toBeLessThan(enemyHitChance(s, l, near));
  });
  it("allies shift a column for free once a turn; Jubey pays 1 Energy; cover pieces stay put", () => {
    let s = fight({ enemies: "light", allies: "walker,bulkhead" });
    const w = ally(s, "walker");
    const dir = freeFriendSlot(s) > w.slot ? "shift-right" : "shift-left";
    const target = w.slot + (dir === "shift-right" ? 1 : -1);
    if (s.units.some((u) => u.side === "friendly" && u.slot === target)) return; // layout-dependent; covered by the fuzz test
    s = cmd(s, w, dir);
    expect(ally(s, "walker").slot).toBe(target);
    expect(legalActions(s).some((a) => a.type === "command" && a.uid === w.uid && a.cmd.startsWith("shift"))).toBe(false);
    const b = ally(s, "bulkhead");
    expect(legalActions(s).some((a) => a.type === "command" && a.uid === b.uid && a.cmd.startsWith("shift"))).toBe(false);
    const e = s.energy;
    const jd = [-1, 1].find((d) => j(s).slot + d >= 0 && j(s).slot + d <= 5 && !s.units.some((u) => u.side === "friendly" && u.slot === j(s).slot + d));
    if (jd !== undefined) {
      s = cmd(s, j(s), jd < 0 ? "shift-left" : "shift-right");
      expect(s.energy).toBe(e - RULES.jubeyMoveEnergy);
    }
    s = end(s);
    expect(legalActions(s).some((a) => a.type === "command" && a.uid === w.uid && a.cmd.startsWith("shift"))).toBe(true);
  });
});

describe("restraints as capture tools", () => {
  const someone = (endurance: number, level: number, loyalty: number) => {
    const s = run(createGame(3), { type: "start", seed: 3 }, { type: "loadout", pick: "lootbox" });
    const r = makePilot(s, { id: "p-t", name: "Test", origin: "test", level, spec: "Assault", trait: "quiet", loyalty, custody: "free" });
    r.base.endurance = endurance;
    return r;
  };
  it("odds rise with the item's rank and fall with the pilot's Endurance and level", () => {
    const r = someone(3, 1, 30);
    expect(restrainChance(r, "harness")).toBeGreaterThan(restrainChance(r, "cuffs"));
    expect(restrainChance(r, "cuffs")).toBeGreaterThan(restrainChance(r, "plockbands"));
    expect(restrainChance(someone(9, 1, 30), "cuffs")).toBeLessThan(restrainChance(r, "cuffs"));
    expect(restrainChance(someone(3, 4, 30), "cuffs")).toBeLessThan(restrainChance(r, "cuffs"));
    expect(restrainChance(r, "cuffs", { outcome: "incapacitated" })).toBeGreaterThan(restrainChance(r, "cuffs", { outcome: "hostile" }));
    expect(restrainChance(r, "cuffs", { outcome: "hostile", subdued: true })).toBeGreaterThan(restrainChance(r, "cuffs", { outcome: "hostile" }));
    expect(restrainChance(someone(20, 5, 0), "plockbands", { outcome: "hostile" })).toBe(RULES.restrainMin);
  });
  /** Needleback ejects while a stunned Light keeps the fight going. */
  const capsuleFight = () => {
    let s = fight({ team: "needleback", enemies: "light", quiet: false });
    j(s).hp = j(s).maxHp = 60;
    foe(s, "light").stunned = 99;
    s = qa(s, "item", undefined, "cuffs,harness");
    Object.assign(foe(s, "needleback"), { ejecting: true, plan: { type: "eject" } });
    s = end(s);
    return s;
  };
  it("a pilot in a grounded capsule can be bound with an item: no holder needed", () => {
    let s = capsuleFight();
    const cap = s.units.find((u) => u.kind === "capsule" && u.pilot === "p-needle")!;
    expect(cap).toBeTruthy();
    const c = legalActions(s).find((a) => a.type === "command" && a.uid === cap.uid && a.cmd === "restrain:harness");
    expect(c).toBeTruthy();
    s = withRules({ restrainMin: 1, restrainMax: 1 }, () => reduce(s, c!));
    expect(rec(s, "p-needle")!.custody).toBe("captive");
    const b = boundCaptives(s);
    expect(b.length).toBe(1);
    expect(b[0].holder).toBe("bound:" + b[0].id);
    expect(rec(s, "p-needle")!.slots.some((x) => x?.id === "harness")).toBe(true);
    expect(s.items.some((x) => x.id === "harness")).toBe(false);
    expect(s.units.some((u) => u.uid === cap.uid)).toBe(false);
  });
  it("a miss keeps the item, spends the Energy, and sends them for the exit", () => {
    let s = capsuleFight();
    const cap = s.units.find((u) => u.kind === "capsule" && u.pilot === "p-needle")!;
    expect(cap).toBeTruthy();
    const e = s.energy;
    s = withRules({ restrainMin: 0, restrainMax: 0 }, () => cmd(s, cap, "restrain:cuffs"));
    expect(s.energy).toBe(e - RULES.restrainEnergy);
    expect(s.items.some((x) => x.id === "cuffs")).toBe(true);
    const c2 = s.units.find((u) => u.uid === cap.uid)!;
    expect(c2.exitIn).toBe(1);
    expect(legalActions(s).some((a) => a.type === "command" && a.uid === cap.uid && a.cmd.startsWith("restrain:"))).toBe(false);
  });
  it("on the recovery screen, restraints secure a pod pilot with no Clampjaw or Pod", () => {
    const coop = { podOutcome: { cooperative: 1, frightened: 0, hostile: 0, incapacitated: 0 } };
    let s = withRules(coop, () => {
      let p = fight({ enemies: "light" });
      p = qa(qa(p, "pod", 0, "lvl2"), "item", undefined, "plockbands");
      p.units.find((u) => u.kind === "light")!.hp = 1;
      p = qa(p, "hand", undefined, "SLUG");
      p = noPods(() => play(p, "SLUG", foe(p, "light")));
      return choose(p, options(p).find((o) => o.id.startsWith("open:"))!.id);
    });
    expect(option(s, "secure")!.enabled).toBe(false);
    const r = option(s, "restrain:plockbands")!;
    expect(r.enabled).toBe(true);
    expect(r.detail).toMatch(/\d+% · rank 1/);
    s = withRules({ restrainMin: 1, restrainMax: 1 }, () => choose(s, "restrain:plockbands"));
    const who = rec(s, s.pods[0].pilot)!;
    expect(who.custody).toBe("captive");
    expect(boundCaptives(s).length).toBe(1);
  });
  it("a hostile pilot who slips the restraint at the pod runs", () => {
    const hostile = { podOutcome: { cooperative: 0, frightened: 0, hostile: 1, incapacitated: 0 } };
    let s = withRules(hostile, () => {
      let p = fight({ enemies: "light" });
      p = qa(qa(p, "pod", 0, "lvl2"), "item", undefined, "cuffs");
      p.units.find((u) => u.kind === "light")!.hp = 1;
      p = qa(p, "hand", undefined, "SLUG");
      p = noPods(() => play(p, "SLUG", foe(p, "light")));
      return choose(p, options(p).find((o) => o.id.startsWith("open:"))!.id);
    });
    s = withRules({ restrainMin: 0, restrainMax: 0 }, () => choose(s, "restrain:cuffs"));
    expect(rec(s, s.pods[0].pilot)!.custody).toBe("free");
    expect(s.pods[0].resolved).toBe(true);
    expect(s.items.some((x) => x.id === "cuffs")).toBe(true);
  });
  it("your crew walks at most two bound captives", () => {
    const s = fight({ enemies: "light" });
    for (let i = 0; i < RULES.boundMax; i++) s.captives.push({ id: "x" + i, kind: "capsule", pilot: "p-" + i, label: "x", holder: "bound:x" + i, bands: 0, tapped: true, hp: 1 });
    let p = qa(qa(s, "pod", 0, "lvl2"), "item", undefined, "cuffs");
    const cap = p.units.find((u) => u.kind === "capsule")!;
    const c = (legalActions(p) as { type: string; uid?: string; cmd?: string }[]).find((a) => a.uid === cap.uid && a.cmd === "restrain:cuffs");
    expect(c).toBeUndefined();
    p = cmd(p, cap, "restrain:cuffs");
    expect(p.items.some((x) => x.id === "cuffs")).toBe(true);
  });
});

describe("the log", () => {
  it("marks each turn, groups lines under it, and folds chatter away", () => {
    let s = fight({ enemies: "light" });
    s = end(s);
    expect(s.log.some((l) => l.startsWith("— Turn "))).toBe(true);
    const g = logGroups(["c", "b", "— Turn 2 —", "a", "— Turn 1 —", "z"]);
    expect(g.map((x) => x.title)).toEqual(["Turn 2", "Turn 1", "Earlier"]);
    expect(g[0].lines).toEqual(["c", "b"]);
    expect(isFlavor("Bishop: “Hold the line.”")).toBe(true);
    expect(isFlavor("QA hand SLUG")).toBe(true);
    expect(isFlavor("Light Mech hits Jubey for 1.")).toBe(false);
  });
});
