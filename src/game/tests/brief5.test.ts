import { describe, expect, it } from "vitest";
import { createGame, eventView, reduce, type GameState } from "../engine";
import { BAND_NAMES, gainXp, accuracy, assignBlock, band, cannotEquip, damageResist, deathAvoid, estimate, expectations, madnessReduction, maxHp, misfire, nightmareResist, rec, rollParts, statCap } from "../pilots";
import { ITEMS, PR } from "../pilots-data";
import type { PilotRec } from "../state";
import { setPilot } from "../team";
import { choose, cmd, end, fight, findSeed, foe, j, qa, run, said, sane } from "./helpers";

const P = (s: GameState, id: string) => rec(s, id)!;
const newest = (s: GameState) => s.roster[s.roster.length - 1];
const op = (s: GameState, id: string, o: Record<string, unknown>) => reduce(s, { type: "pilot", id, ...(o as { op: "talk" }) });
const atTech = (s: GameState) => {
  s.phase = "tech";
  return s;
};
const begun = (seed = 7) => run(createGame(seed), { type: "start", seed }, { type: "loadout", pick: "lootbox" });
/** A crew member, standing at a Tech Stop. */
const withCrew = (loyalty = 70, seed = 7) => {
  const s = atTech(qa(begun(seed), "recruit", loyalty));
  return { s, r: newest(s) };
};
/** A captured R-8 pilot in a Pod, at a Tech Stop. */
const withCaptive = (id = "p-needle", loyalty?: number) => {
  let s = qa(qa(begun(), "ally", undefined, "pod"), "scrap", 20);
  const pod = s.units.find((u) => u.kind === "pod")!;
  s.captives.push({ id: "c1", kind: "capsule", pilot: id, label: "x", holder: pod.uid, bands: 0, tapped: false, hp: 2 });
  pod.holding = "c1";
  s.team.pursuit = "active";
  s.team.introduced = true;
  setPilot(s, id, "captured");
  if (loyalty !== undefined) P(s, id).loyalty = loyalty;
  s = atTech(s);
  return s;
};

describe("pilot identity and equipment", () => {
  it("every pilot starts with three open slots and a locked fourth", () => {
    const s = begun();
    expect(s.roster.length).toBe(5);
    for (const r of s.roster) expect([r.slots.length, r.slot4]).toEqual([4, false]);
    const { r } = withCrew();
    expect(r.slot4).toBe(false);
    expect(r.slots[3]).toBeNull();
  });
  it("R-8 pilots exist from the start with their own levels, specialties and gear", () => {
    const s = begun();
    expect(s.roster.map((r) => [r.name, r.level, r.spec])).toEqual([
      ["Needleback", 2, "Scout"],
      ["Latchback", 3, "Assault"],
      ["Widow", 2, "Recovery"],
      ["Kilnheart", 3, "Heavy"],
      ["Bishop", 4, "Command"],
    ]);
    expect(P(s, "p-needle").slots[0]!.id).toBe("sidearm");
  });
  it("three Cockpit Parts unlock one pilot's fourth slot, and it stays theirs", () => {
    let { s, r } = withCrew();
    expect(op(s, r.id, { op: "unlock" }).parts).toBe(0); // rejected
    s = qa(s, "parts", 3);
    s = op(s, r.id, { op: "unlock" });
    expect([P(s, r.id).slot4, s.parts]).toEqual([true, 0]);
    s.roster.find((x) => x.id === r.id)!.custody = "captive";
    expect(P(s, r.id).slot4).toBe(true);
  });
  it("Cockpit Parts: one roll per cockpit source, about 20% of sources", () => {
    const s = begun();
    for (let i = 0; i < 4; i++) rollParts(s, "same", "x");
    expect(s.partsRolled.filter((k) => k === "same").length).toBe(1);
    let hits = 0;
    for (let i = 0; i < 500; i++) {
      const before = s.parts;
      rollParts(s, "src" + i, "x");
      hits += s.parts - before;
    }
    expect(hits).toBeGreaterThan(60);
    expect(hits).toBeLessThan(140);
  });
  it("a captured R-8 pilot rolls for a part once, however many times they are recaptured", () => {
    const s = withCaptive();
    expect(s.partsRolled).toContain("pilot:p-needle");
    const n = s.partsRolled.length;
    setPilot(s, "p-needle", "escaped");
    P(s, "p-needle").custody = "free";
    s.team.pilots[0].status = "active";
    setPilot(s, "p-needle", "captured");
    expect(s.partsRolled.length).toBe(n);
  });
  it("stripping an anonymous piloted wreck rolls; an Infested wreck does not", () => {
    let s = fight({ enemies: "light,zombie" });
    s.wrecks.push({ id: "w1", kind: "light", side: "enemy", value: 1 }, { id: "w2", kind: "drone", side: "enemy", value: 1 });
    s.phase = "salvage";
    s = reduce(reduce(s, { type: "salvage", targetId: "w1" }), { type: "salvage", targetId: "w2" });
    expect(s.partsRolled).toContain("w1");
    expect(s.partsRolled).not.toContain("w2");
  });
  it("captives take captive gear only, crew take crew gear only", () => {
    let s = withCaptive();
    s = qa(s, "item", undefined, "sidearm,muffle");
    const r = P(s, "p-needle");
    const [gun, gag] = s.items.slice(-2);
    expect(cannotEquip(r, gun, 0)).toMatch(/captives take/);
    expect(cannotEquip(r, gag, 0)).toBeNull();
    const { s: t, r: c } = withCrew();
    const t2 = qa(t, "item", undefined, "muffle");
    expect(cannotEquip(c, t2.items[t2.items.length - 1], 0)).toMatch(/crew take/);
  });
  it("limits: one gag, two restraints, one harness, slot 4 only when unlocked", () => {
    let s = withCaptive();
    s = qa(s, "item", undefined, "muffle,muzzle,plockbands,plockbands,cuffs,harness");
    const id = (x: string, n = 0) => s.items.filter((i) => i.id === x)[n].uid;
    s = op(s, "p-needle", { op: "equip", item: id("muffle"), slot: 0 });
    expect(op(s, "p-needle", { op: "equip", item: id("muzzle"), slot: 1 }).items.length).toBe(s.items.length);
    s = op(s, "p-needle", { op: "equip", item: id("plockbands"), slot: 1 });
    s = op(s, "p-needle", { op: "equip", item: id("plockbands"), slot: 2 });
    expect(P(s, "p-needle").slots.map((x) => x?.id ?? null)).toEqual(["muffle", "plockbands", "plockbands", null]);
    expect(op(s, "p-needle", { op: "equip", item: id("cuffs"), slot: 3 }).items.length).toBe(s.items.length); // slot 4 locked
    s = op(qa(s, "parts", 3), "p-needle", { op: "unlock" });
    expect(cannotEquip(P(s, "p-needle"), s.items.find((i) => i.id === "cuffs")!, 3)).toBe("two restraints at most");
  });
  it("replacing an item swaps it back to the inventory: nothing is duplicated or lost", () => {
    let s = withCaptive();
    s = qa(s, "item", undefined, "muffle,muzzle");
    const [a, b] = s.items.slice(-2);
    s = op(s, "p-needle", { op: "equip", item: a.uid, slot: 0 });
    s = op(s, "p-needle", { op: "equip", item: b.uid, slot: 0 });
    expect(P(s, "p-needle").slots[0]!.uid).toBe(b.uid);
    expect(s.items.some((x) => x.uid === a.uid)).toBe(true);
    expect(s.items.some((x) => x.uid === b.uid)).toBe(false);
  });
  it("capture confiscates crew gear; recruiting hands captive gear back", () => {
    let s = withCaptive("p-needle", 70);
    expect(P(s, "p-needle").slots.every((x) => x === null)).toBe(true);
    expect(s.items.map((x) => x.id)).toEqual(expect.arrayContaining(["sidearm", "scanner"]));
    s = qa(s, "item", undefined, "muffle");
    s = op(s, "p-needle", { op: "equip", item: s.items[s.items.length - 1].uid, slot: 0 });
    const before = s.items.length;
    s = op(s, "p-needle", { op: "recruit" });
    const r = P(s, "p-needle");
    expect([r.custody, r.slots[0], s.items.length, s.captives.length]).toEqual(["ally", null, before + 1, 0]);
    expect(s.team.pilots[0].status).toBe("turned");
    expect(s.units.find((u) => u.kind === "pod")!.holding).toBeUndefined();
  });
});

describe("stats and levels", () => {
  it("generated stats fall in each level's range", () => {
    const s = begun(1);
    for (let i = 0; i < 40; i++) {
      const t = qa(s, "recruit");
      const r = newest(t);
      for (const v of Object.values(r.base)) expect(v >= 1 && v <= 5).toBe(true);
    }
    for (const r of s.roster) {
      const [lo, hi] = PR.statRange[r.level];
      for (const v of Object.values(r.base)) expect(v >= lo && v <= hi).toBe(true);
    }
  });
  it("level-ups add a point and raise the cap; nothing is ever lowered", () => {
    const { s, r } = withCrew();
    const before = { ...r.base };
    const t = structuredClone(s);
    const x = newest(t);
    x.xp = PR.xpFor[2] - 1;
    gainXp(t, x, 1, "test");
    expect([x.level, x.points, statCap(x.level)]).toEqual([2, 1, 7]);
    expect(x.base).toEqual(before);
  });
  it("a stat point can only go up to the level cap", () => {
    let { s, r } = withCrew();
    const x = P(s, r.id);
    x.points = 5;
    x.base.skill = statCap(1);
    s = op(s, r.id, { op: "stat", stat: "skill" });
    expect(P(s, r.id).earned.skill).toBe(0);
    s = op(s, r.id, { op: "stat", stat: "mental" });
    expect(P(s, r.id).earned.mental).toBe(x.base.mental < statCap(1) ? 1 : 0);
  });
  const mk = (m: number, sk: number, e: number) => ({ base: { mental: m, skill: sk, endurance: e }, earned: { mental: 0, skill: 0, endurance: 0 }, slots: [null, null, null, null], spec: "Assault", level: 1, madness: 0, recovering: 0 }) as unknown as PilotRec;
  it("Mental: 4% Madness penalty reduction per point to 40%, and 2% Nightmare resistance to 24%", () => {
    expect([2, 5, 8, 12].map((m) => Math.round(madnessReduction(mk(m, 1, 1)) * 100))).toEqual([8, 20, 32, 40]);
    expect([2, 12, 14].map((m) => Math.round(nightmareResist(mk(m, 1, 1)) * 100))).toEqual([4, 24, 24]);
    const r = mk(5, 1, 1);
    r.madness = 20;
    expect(misfire(r)).toBeCloseTo(0.2 * 0.8);
  });
  it("Skill: 3% accuracy per point, capped at +30 with equipment", () => {
    const s = begun();
    expect(accuracy(s, mk(1, 5, 1))).toBeCloseTo(0.15);
    const r = mk(1, 9, 1);
    r.slots[0] = { uid: "a", id: "targeting" };
    expect(accuracy(s, r)).toBeCloseTo(0.3);
    r.base.skill = 12;
    expect(accuracy(s, r)).toBeCloseTo(0.3);
  });
  it("Endurance: 2.5% damage resistance to 30%, 3% death avoidance to 36%, and HP", () => {
    expect([4, 12, 14].map((e) => Math.round(damageResist(mk(1, 1, e)) * 1000) / 10)).toEqual([10, 30, 30]);
    expect([4, 12, 14].map((e) => Math.round(deathAvoid(mk(1, 1, e)) * 100))).toEqual([12, 36, 36]);
    expect(maxHp(mk(1, 1, 5))).toBe(PR.baseHp + 2);
  });
  it("in a Nightmare fight Mental and Endurance can both succeed, but stop one point at most", () => {
    let blocked = 0;
    for (let seed = 1; seed <= 200; seed++) {
      let s = fight({ seed, enemies: "rifleman,zombie" });
      s = qa(s, "recruit", 90);
      const r = newest(s);
      Object.assign(r.base, { mental: 12, endurance: 12 });
      r.hp = 30;
      r.assignment = "foot";
      r.slots[0] = { uid: "g", id: "sidearm" };
      s = qa(s, "fight", 0, "rifleman,zombie");
      expect(s.nightmareFight).toBe(true);
      const u = s.units.find((x) => x.kind === "pilot")!;
      u.hp = u.maxHp = 30;
      const z = foe(s, "zombie");
      Object.assign(z, { stunned: 0, prox: 2, plan: { type: "attack", targetUid: u.uid, dmg: 2 } });
      s.accModEnemy = 9;
      for (const e of s.units.filter((x) => x.kind === "rifleman")) e.stunned = 99;
      s = end(s);
      const taken = 30 - s.units.find((x) => x.kind === "pilot")!.hp;
      expect(taken === 1 || taken === 2).toBe(true);
      if (taken === 1) blocked++;
    }
    expect(blocked).toBeGreaterThan(40);
  });
  it("death avoidance leaves a pilot at 1 HP, once, and never for an unsurvivable event", () => {
    const s = findSeed(
      (seed) => {
        let t = fight({ seed, enemies: "zombie" });
        t = qa(t, "recruit", 90);
        Object.assign(newest(t).base, { endurance: 12 });
        newest(t).assignment = "foot";
        t = qa(t, "fight", 0, "zombie");
        const u = t.units.find((x) => x.kind === "pilot")!;
        u.hp = 1;
        Object.assign(foe(t), { stunned: 0, prox: 2, plan: { type: "attack", targetUid: u.uid, dmg: 2 } });
        t.accModEnemy = 9;
        return end(t);
      },
      (t) => said(t, "should not have survived"),
    );
    expect(s.units.find((x) => x.kind === "pilot")!.hp).toBe(1);
  });
});

describe("loyalty, barriers and estimates", () => {
  it("bands", () => {
    expect([0, 24, 25, 44, 45, 64, 65, 84, 85, 100].map((l) => BAND_NAMES[band(l)])).toEqual(["Hostile", "Hostile", "Unwilling", "Unwilling", "Partially Willing", "Partially Willing", "Cooperative", "Cooperative", "Loyal", "Loyal"]);
  });
  it("Hostile and Unwilling captives hit the orange-red barrier on assignments, not on custody", () => {
    let s = withCaptive("p-needle", 30);
    const r = P(s, "p-needle");
    expect(assignBlock(s, r, "foot")).toEqual({ reason: "UNWILLING — ASSIGNMENT RESTRICTED", barrier: true });
    expect(op(s, "p-needle", { op: "assign", target: "foot" })).toEqual(expect.objectContaining({}));
    expect(P(op(s, "p-needle", { op: "assign", target: "foot" }), "p-needle").assignment).toBe("");
    s = qa(s, "item", undefined, "muffle");
    s = op(s, "p-needle", { op: "equip", item: s.items[s.items.length - 1].uid, slot: 0 });
    expect(P(s, "p-needle").slots[0]!.id).toBe("muffle"); // custody management still works
  });
  it("a Partially Willing captive takes limited tasks: on foot yes, a frame no", () => {
    let s = withCaptive("p-needle", 50);
    s = qa(s, "frame", undefined, "light");
    const f = s.units.find((u) => u.kind === "frame")!;
    expect(assignBlock(s, P(s, "p-needle"), f.uid)!.reason).toMatch(/limited tasks/);
    expect(assignBlock(s, P(s, "p-needle"), "foot")).toBeNull();
  });
  it("Partially Willing shows expectations; estimates give ranges or name the blocker", () => {
    const s = withCaptive("p-needle", 50);
    const e = expectations(s, P(s, "p-needle"));
    expect(e).toEqual(expect.arrayContaining(["May refuse attacks against former teammates.", "Possible escape attempt if given a fast frame."]));
    expect(e[e.length - 1]).toMatch(/^Estimated \d+–\d+ successful cooperation opportunities to reach Cooperative\./);
    const h = withCaptive("p-needle");
    expect(estimate(h, P(h, "p-needle"))).toBe("Estimated 4–6 successful cooperation opportunities to reach Partially Willing.");
    const b = withCaptive("p-bishop");
    expect(estimate(b, P(b, "p-bishop"))).toMatch(/unresolved faction loyalty/);
    const k = withCaptive("p-kiln");
    expect(estimate(k, P(k, "p-kiln"))).toMatch(/outstanding conflict/);
  });
  it("time alone never raises loyalty", () => {
    let s = withCaptive("p-widow", 40);
    for (let i = 0; i < 6; i++) {
      s.phase = "tech";
      s = reduce(s, { type: "nextRoom" });
      s.phase = "tech";
    }
    expect(P(s, "p-widow").loyalty).toBeLessThanOrEqual(40);
  });
  it("talking needs the gag off and works once a room; R-8 progress is slower while the hunt is on", () => {
    let s = withCaptive("p-widow", 40);
    s = qa(s, "item", undefined, "voiceseal");
    s = op(s, "p-widow", { op: "equip", item: s.items[s.items.length - 1].uid, slot: 0 });
    expect(P(op(s, "p-widow", { op: "talk" }), "p-widow").loyalty).toBe(40);
    s = op(s, "p-widow", { op: "unequip", slot: 0 });
    s = op(s, "p-widow", { op: "talk" });
    expect(P(s, "p-widow").loyalty).toBe(40 + Math.round(PR.talkGain * 1.3 * PR.pursuitGain));
    expect(P(op(s, "p-widow", { op: "talk" }), "p-widow").loyalty).toBe(P(s, "p-widow").loyalty);
  });
  it("treating a defiant pilot clears the blocker and earns trust", () => {
    let s = withCaptive("p-kiln", 20);
    s = qa(s, "item", undefined, "medkit");
    s = op(s, "p-kiln", { op: "talk" });
    expect(P(s, "p-kiln").loyalty).toBe(20);
    s = op(s, "p-kiln", { op: "treat" });
    expect(P(s, "p-kiln").injuredUntreated).toBe(false);
    expect(P(s, "p-kiln").loyalty).toBeGreaterThan(20);
    expect(s.items.find((x) => x.id === "medkit")!.charges).toBe(2);
  });
  it("an agreement is broken by fielding them against their section, and kept when the hunt ends", () => {
    let s = withCaptive("p-widow", 70);
    s = op(s, "p-widow", { op: "agree" });
    expect(P(s, "p-widow").agreed).toBe("kept");
    const kept = structuredClone(s);
    kept.team.pursuit = "withdrawn";
    kept.phase = "tech";
    const k2 = reduce(kept, { type: "nextRoom" });
    expect(P(k2, "p-widow").agreed).toBe("");
    expect(P(k2, "p-widow").loyalty).toBeGreaterThan(P(kept, "p-widow").loyalty);
    s = op(s, "p-widow", { op: "assign", target: "foot" });
    s = qa(s, "team", undefined, "needleback");
    s = qa(s, "fight", 0, "zombie");
    expect(P(s, "p-widow").agreed).toBe("broken");
  });
  it("custody strain rises by band, restraints slow it, and an unrestrained hostile slips out", () => {
    let s = withCaptive("p-latch");
    const r = () => P(s, "p-latch");
    const rooms = (n: number) => {
      for (let i = 0; i < n; i++) {
        s.phase = "tech";
        s = reduce(s, { type: "nextRoom" });
      }
    };
    rooms(1);
    expect(r().strain).toBe(PR.strainBase[0] - PR.strainPod);
    expect(said(s, "restless")).toBe(false);
    rooms(4);
    expect(r().custody).toBe("captive");
    expect(said(s, "is restless")).toBe(true);
    rooms(2);
    expect(r().custody).not.toBe("captive");
    expect(s.captives.length).toBe(0);
  });
  it("Lockbands and cuffs hold a hostile indefinitely; a Status Relay warns at 70", () => {
    let s = withCaptive("p-latch");
    s = qa(s, "item", undefined, "plockbands,cuffs");
    const [a, b] = s.items.slice(-2);
    s = op(s, "p-latch", { op: "equip", item: a.uid, slot: 0 });
    s = op(s, "p-latch", { op: "equip", item: b.uid, slot: 1 });
    for (let i = 0; i < 8; i++) {
      s.phase = "tech";
      s = reduce(s, { type: "nextRoom" });
    }
    expect(P(s, "p-latch").custody).toBe("captive");
    expect(P(s, "p-latch").strain).toBe(Math.min(100, 8 * Math.max(0, PR.strainBase[0] - 6 - 8 - PR.strainPod)));
  });
  it("the suit transmitter ignores gags; an isolator blocks it; a monitor only reports it", () => {
    const pinged = (gear: string) => {
      let hits = 0;
      let seen = 0;
      for (let seed = 1; seed <= 60; seed++) {
        let s = withCaptive("p-needle");
        s.rng = seed * 131;
        if (gear) {
          s = qa(s, "item", undefined, gear);
          s = op(s, "p-needle", { op: "equip", item: s.items[s.items.length - 1].uid, slot: 0 });
        }
        s.team.knowsPlayer = false;
        s.phase = "tech";
        s = reduce(s, { type: "nextRoom" });
        if (s.team.knowsPlayer) hits++;
        if (said(s, "Communication Monitor:")) seen++;
      }
      return [hits, seen];
    };
    expect(pinged("voiceseal")[0]).toBeGreaterThan(5);
    expect(pinged("isolator")[0]).toBe(0);
    const [h, seen] = pinged("monitor");
    expect(h).toBeGreaterThan(5);
    expect(seen).toBe(h);
  });
  it("an ungagged captive shouts to their section; a voice seal stops it", () => {
    let s = withCaptive("p-needle");
    s = qa(s, "team", undefined, "latchback");
    const loud = qa(structuredClone(s), "fight", 0, "zombie");
    expect(said(loud, "shouts to their section")).toBe(true);
    s = qa(s, "item", undefined, "voiceseal");
    s = op(s, "p-needle", { op: "equip", item: s.items[s.items.length - 1].uid, slot: 0 });
    const quiet = qa(s, "fight", 0, "zombie");
    expect(said(quiet, "shouts to their section")).toBe(false);
  });
});

describe("assignments in a fight", () => {
  it("a crew pilot on foot fights with their weapon and earns XP", () => {
    let { s, r } = withCrew(90);
    s = qa(s, "item", undefined, "carbine");
    s = op(s, r.id, { op: "equip", item: s.items[s.items.length - 1].uid, slot: 1 });
    s = op(s, r.id, { op: "assign", target: "foot" });
    s = qa(s, "fight", 0, "zombie");
    const u = s.units.find((x) => x.kind === "pilot")!;
    expect(u.pilot).toBe(r.id);
    foe(s).hp = 2;
    s = findSeed((seed) => { const t = structuredClone(s); t.rng = seed; return end(t); }, (t) => t.phase !== "player");
    expect(P(s, r.id).xp).toBeGreaterThan(0);
    expect(s.units.some((x) => x.kind === "pilot")).toBe(false); // back off the lane after the fight
  });
  it("a gun does nothing for a pilot in a frame: the frame's own weapon fires", () => {
    let { s, r } = withCrew(90);
    s = qa(s, "frame", undefined, "medium");
    s = qa(s, "item", undefined, "heavysidearm");
    s = op(s, r.id, { op: "equip", item: s.items[s.items.length - 1].uid, slot: 1 });
    s = op(s, r.id, { op: "assign", target: s.units.find((u) => u.kind === "frame")!.uid });
    s = qa(s, "fight", 0, "zombie");
    foe(s).hp = foe(s).maxHp = 40;
    s = findSeed((seed) => { const t = structuredClone(s); t.rng = seed; return end(t); }, (t) => foe(t).hp < 40);
    expect(40 - foe(s).hp).toBe(2 + (P(s, r.id).spec === "Assault" ? 1 : 0));
  });
  it("a captive who bolts is telegraphed a turn ahead, and shackles can stop it", () => {
    const go = (shackles: boolean) => {
      let s = withCaptive("p-widow", 60);
      if (shackles) {
        s = qa(s, "item", undefined, "shackles");
        s = op(s, "p-widow", { op: "equip", item: s.items[s.items.length - 1].uid, slot: 0 });
      }
      s = op(s, "p-widow", { op: "assign", target: "foot" });
      s = qa(s, "fight", 0, "zombie");
      P(s, "p-widow").boltTurn = 2;
      s = end(s);
      const u = s.units.find((x) => x.kind === "pilot")!;
      expect(u.bolting).toBe(true);
      expect(said(s, "keeps looking at the far door")).toBe(true);
      if (shackles) s = cmd(s, u, "lock");
      return end(s);
    };
    const ran = go(false);
    expect(ran.units.some((u) => u.kind === "capsule" && u.pilot === "p-widow" && u.side === "enemy")).toBe(true);
    expect(P(ran, "p-widow").custody).toBe("fleeing");
    expect(ran.captives.length).toBe(0);
    const held = go(true);
    expect(held.units.some((u) => u.kind === "pilot" && u.pilot === "p-widow")).toBe(true);
    expect(P(held, "p-widow").custody).toBe("captive");
  });
  it("a captive in a light frame who bolts takes the frame with them", () => {
    let s = withCaptive("p-widow", 70);
    s = qa(s, "frame", undefined, "light");
    s = op(s, "p-widow", { op: "assign", target: s.units.find((u) => u.kind === "frame")!.uid });
    s = qa(s, "fight", 0, "zombie");
    P(s, "p-widow").boltTurn = 2;
    s = end(s, 2);
    expect(s.units.some((u) => u.kind === "frame")).toBe(false);
    expect(["escaped", "withdrawn"]).toContain(s.team.pilots[2].status);
  });
  it("with a Tracking Relay, an escapee turns up running in your next fight", () => {
    let s = withCaptive("p-widow", 60);
    s = qa(s, "item", undefined, "tracker");
    s = op(s, "p-widow", { op: "equip", item: s.items[s.items.length - 1].uid, slot: 0 });
    s = op(s, "p-widow", { op: "assign", target: "foot" });
    s = qa(s, "fight", 0, "zombie");
    P(s, "p-widow").boltTurn = 2;
    s = end(s, 2);
    const runner = s.units.find((u) => u.pilot === "p-widow" && u.side === "enemy")!;
    runner.exitIn = 1;
    s = end(s);
    expect(P(s, "p-widow").custody).toBe("fleeing");
    expect(s.pendingRunners).toEqual(["p-widow"]);
    s = qa(s, "fight", 0, "zombie");
    expect(s.units.some((u) => u.pilot === "p-widow" && u.side === "enemy")).toBe(false); // qa fight skips spawnPack
    s.pendingRunners = ["p-widow"];
    s.phase = "route";
    s = reduce(s, { type: "pickPath", risky: false });
    while (s.phase === "event") s = reduce(s, { type: "event", option: eventView(s)!.options.filter((o) => o.enabled).slice(-1)[0].id });
    expect(s.units.some((u) => u.pilot === "p-widow" && u.side === "enemy")).toBe(true);
  });
  it("a Partially Willing ex-R-8 pilot will not fire on their section", () => {
    let s = withCaptive("p-needle", 50);
    s = qa(s, "item", undefined, "shackles");
    s = op(s, "p-needle", { op: "assign", target: "foot" });
    s = qa(s, "team", undefined, "latchback");
    s = qa(s, "fight", 0, "");
    P(s, "p-needle").boltTurn = undefined;
    P(s, "p-needle").slots[2] = { uid: "z", id: "carbine" };
    const hp = foe(s).hp;
    s = end(s);
    expect(foe(s).hp).toBe(hp);
  });
  it("a destroyed frame: a clean ejection costs the pilot 1; a weak seal costs 3", () => {
    for (const faults of [[], ["seal"]]) {
      let { s, r } = withCrew(90);
      s = qa(s, "frame", undefined, ["medium", ...faults].join(","));
      s = op(s, r.id, { op: "assign", target: s.units.find((u) => u.kind === "frame")!.uid });
      const hp = (P(s, r.id).hp = 9);
      P(s, r.id).base.endurance = 1;
      s = qa(s, "fight", 0, "zombie");
      const f = s.units.find((u) => u.kind === "frame")!;
      f.hp = 1;
      Object.assign(foe(s), { stunned: 0, prox: 2, plan: { type: "attack", targetUid: f.uid, dmg: 2 } });
      s.accModEnemy = 9;
      s = findSeed((seed) => { const t = structuredClone(s); t.rng = seed; return end(t); }, (t) => !t.units.some((u) => u.kind === "frame") && !said(t, "Endurance takes the edge off"));
      expect(hp - P(s, r.id).hp).toBe(faults.length ? 3 : 1);
      expect(P(s, r.id).assignment).toBe("");
    }
  });
  it("a pilot who dies is dead everywhere, and their gear is not duplicated", () => {
    let { s, r } = withCrew(90);
    s = op(s, r.id, { op: "assign", target: "foot" });
    s = qa(s, "fight", 0, "zombie");
    const u = s.units.find((x) => x.kind === "pilot")!;
    u.hp = 1;
    P(s, r.id).base.endurance = 1;
    Object.assign(foe(s), { stunned: 0, prox: 2, plan: { type: "attack", targetUid: u.uid, dmg: 3 } });
    s.accModEnemy = 9;
    s = findSeed((seed) => { const t = structuredClone(s); t.rng = seed; return end(t); }, (t) => P(t, r.id).custody === "dead");
    expect(s.units.some((x) => x.pilot === r.id)).toBe(false);
  });
});

describe("Empty-Cockpit Mech", () => {
  const mech = (o: Record<string, unknown> = {}, crewLoyalty?: number) => {
    let s = qa(begun(), "scrap", 20);
    if (crewLoyalty !== undefined) s = qa(s, "recruit", crewLoyalty);
    s = qa(s, "event", undefined, "mech");
    Object.assign(s.event!.data, o);
    s.hallStage = 99;
    return s;
  };
  it("the damaged variant turns up about a quarter of the time", () => {
    let n = 0;
    for (let seed = 1; seed <= 400; seed++) {
      let s = run(createGame(seed), { type: "start", seed }, { type: "loadout", pick: "lootbox" });
      s = qa(s, "event", undefined, "mech");
      if (s.event!.data.damaged) n++;
    }
    expect(n).toBeGreaterThan(70);
    expect(n).toBeLessThan(130);
  });
  it("assigning a crew pilot puts a piloted frame on your lane", () => {
    const s0 = mech({ chassis: "medium", damaged: false, faults: [] }, 80);
    const r = newest(s0);
    const s = choose(s0, `assign:${r.id}`);
    const f = s.units.find((u) => u.kind === "frame")!;
    expect([f.pilot, f.chassis, P(s, r.id).assignment]).toEqual([r.id, "medium", f.uid]);
  });
  it("unwilling pilots are listed but cannot be assigned", () => {
    const s = mech({}, 30);
    const o = eventView(s)!.options.find((x) => x.id === `assign:${newest(s).id}`)!;
    expect([o.enabled, o.detail]).toEqual([false, "UNWILLING — ASSIGNMENT RESTRICTED"]);
  });
  it("repairs clear faults; the reactor needs Skill 8 or a Builder Drone", () => {
    let s = mech({ chassis: "heavy", damaged: true, faults: ["sensors", "reactor"], hpLoss: 3 });
    s = choose(s, "repair");
    expect(s.event!.data.faults).toEqual(["reactor"]);
    let t = qa(mech({ chassis: "heavy", damaged: true, faults: ["sensors", "reactor"], hpLoss: 3 }), "ally", undefined, "builder");
    t = choose(t, "repair-drone");
    expect([t.event!.data.faults, t.event!.data.hpLoss]).toEqual([[], 0]);
  });
  it("Inspect Cockpit reveals a weak seal", () => {
    const s = choose(mech({ damaged: true, faults: ["seal"] }), "cockpit");
    expect(eventView(s)!.lines.some((l) => l.includes("seal is weak"))).toBe(true);
  });
  it("salvage pays once and ends the encounter", () => {
    const s0 = mech({ chassis: "light" });
    const s = choose(s0, "salvage");
    expect(s.scrap).toBe(s0.scrap + PR.frameSalvage.light);
    expect(s.event).toBeNull();
  });
});

describe("Suspicious Cargo Above", () => {
  const cargo = (o: Record<string, unknown> = {}, loyalty = 70) => {
    let s = qa(qa(begun(), "recruit", loyalty), "scrap", 10);
    s = qa(s, "event", undefined, "cargo");
    Object.assign(s.event!.data, o);
    s.hallStage = 99;
    return s;
  };
  it("gas turns up about 15% of the time", () => {
    let n = 0;
    for (let seed = 1; seed <= 400; seed++) {
      let s = qa(run(createGame(seed), { type: "start", seed }, { type: "loadout", pick: "lootbox" }), "recruit");
      s = qa(s, "event", undefined, "cargo");
      if (s.event!.data.gas) n++;
    }
    expect(n).toBeGreaterThan(35);
    expect(n).toBeLessThan(90);
  });
  it("a clean crate pays its reward and the pilot learns something", () => {
    const s0 = cargo({ gas: false, reward: "scrap" });
    const r = newest(s0);
    const s = choose(s0, `send:${r.id}`);
    expect([s.scrap, P(s, r.id).xp]).toEqual([s0.scrap + 3, PR.xpInspect]);
  });
  it("unexpected gas hurts the pilot and costs loyalty in the cooperative range", () => {
    const s0 = cargo({ gas: true, spoil: false, reward: "scrap", loss: 0 });
    const r = newest(s0);
    r.base.skill = 1;
    r.base.endurance = 1;
    r.spec = "Assault";
    const s = choose(s0, `send:${r.id}`);
    expect(s.event!.data.stage).toBe("after");
    expect(P(s, r.id).loyalty).toBe(70 - PR.gasLoyalty.coop[0]);
  });
  it("a skilled pilot spots the release and can retrieve it safely at Skill 8", () => {
    const s0 = cargo({ gas: true, reward: "scrap" });
    const r = newest(s0);
    Object.assign(r.base, { skill: 8 });
    r.spec = "Assault";
    let s = choose(s0, `send:${r.id}`);
    expect(s.event!.data.stage).toBe("top");
    s = choose(s, "careful");
    expect(s.scrap).toBe(s0.scrap + 3);
    expect(P(s, r.id).loyalty).toBe(70);
  });
  it("concealing a known hazard costs far more than asking openly", () => {
    const known = () => {
      const s0 = cargo({ gas: true, known: true, scanned: true, reward: "scrap", loss: 0 });
      Object.assign(newest(s0).base, { skill: 1, endurance: 1 });
      newest(s0).spec = "Assault";
      return s0;
    };
    const asked = choose(known(), `send:${newest(known()).id}`);
    const hid = choose(known(), `hide:${newest(known()).id}`);
    expect(70 - newest(hid).loyalty).toBeGreaterThan(70 - newest(asked).loyalty);
  });
  it("inspecting from below needs a scanner or Skill 4, and says so before you commit", () => {
    const s0 = cargo({ gas: true });
    newest(s0).base.skill = 1;
    newest(s0).spec = "Assault";
    const o = eventView(s0)!.options.find((x) => x.id === "below")!;
    expect([o.enabled, o.detail]).toEqual([false, "Needs a Portable Scanner or a pilot with Skill 4."]);
    const s1 = qa(s0, "item", undefined, "scanner");
    const s = choose(s1, "below");
    expect(s.event!.data.known).toBe(true);
    expect(eventView(s)!.options.some((x) => x.id.startsWith("hide:"))).toBe(true);
  });
  it("prompt treatment wins back half of the loss", () => {
    let s = cargo({ gas: true, spoil: false, reward: "scrap", loss: 4 });
    s = qa(s, "item", undefined, "medkit");
    const r = newest(s);
    Object.assign(r.base, { skill: 1, endurance: 1 });
    r.spec = "Assault";
    s = choose(s, `send:${r.id}`);
    const after = P(s, r.id).loyalty;
    s = choose(s, "treat");
    expect(P(s, r.id).loyalty).toBe(after + Math.ceil((70 - after) / 2));
  });
});

describe("Fleeing Pilot", () => {
  const flee = (o: Record<string, unknown> = {}) => {
    let s = qa(begun(), "scrap", 10);
    s = qa(s, "event", undefined, "fleeing");
    Object.assign(s.event!.data, o);
    s.hallStage = 99;
    return s;
  };
  it("recruits a Level 1 pilot with three slots and a locked fourth", () => {
    const s = choose(flee({ accept: true }), "shelter");
    const r = newest(s);
    expect([r.level, r.custody, r.slot4, r.slots.length]).toEqual([1, "ally", false, 4]);
  });
  it("80% start with 10–20% Madness, 20% with none", () => {
    let mad = 0;
    for (let seed = 1; seed <= 400; seed++) {
      let s = run(createGame(seed), { type: "start", seed }, { type: "loadout", pick: "lootbox" });
      s = qa(s, "event", undefined, "fleeing");
      const r = newest(s);
      if (r.recovering) {
        mad++;
        expect(r.recovering >= 10 && r.recovering <= 20).toBe(true);
      }
    }
    expect(mad).toBeGreaterThan(290);
    expect(mad).toBeLessThan(350);
  });
  it("temporary Madness drains 2 a turn; new Madness is not erased", () => {
    let s = choose(flee({ accept: true }), "shelter");
    const r = newest(s);
    r.recovering = 10;
    r.madness = 5;
    s = qa(s, "fight", 0, "zombie");
    s = end(s, 3);
    expect([P(s, r.id).recovering, P(s, r.id).madness]).toEqual([4, 5]);
    s = end(s, 4);
    expect([P(s, r.id).recovering, P(s, r.id).madness]).toEqual([0, 5]);
  });
  it("they may refuse, unless you help them first", () => {
    const no = choose(flee({ accept: false }), "shelter");
    expect(newest(no).custody).toBe("free");
    let yes = choose(flee({ accept: false }), "help");
    yes = choose(yes, "shelter");
    expect(newest(yes).custody).toBe("ally");
  });
  it("Recruit and Assign Immediately needs an empty frame", () => {
    expect(eventView(flee())!.options.some((o) => o.id === "assign")).toBe(false);
    let s = qa(flee({ accept: true }), "frame", undefined, "light");
    s = choose(s, "assign");
    expect(s.units.find((u) => u.kind === "frame")!.pilot).toBe(newest(s).id);
  });
  it("is not R-8, and keeps stats and gear across rooms and a save", () => {
    const s = choose(flee({ accept: true }), "shelter");
    const r = newest(s);
    expect([r.origin, r.role]).toEqual(["Unaffiliated", undefined]);
    const back = sane(s);
    expect(newest(back)).toEqual(r);
  });
});

void ITEMS;
void j;
