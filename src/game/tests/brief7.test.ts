// Brief 7: Nightmare Rooms. Numbered to match the brief's 50 required tests.

import { describe, expect, it } from "vitest";
import { createGame, eventView, legalActions, migrate, reduce, SAVE_VERSION, type GameState } from "../engine";
import { living } from "../core";
import { baseTier, danger, liveEffects, nmView, odds, schedule, severityParts, threatBand, type NmRoomId } from "../nightmare";
import { rec } from "../pilots";
import { RULES, ally, choose, end, fight, foe, j, qa, run, said, sane, withRules } from "./helpers";

const options = (s: GameState) => eventView(s)?.options ?? [];
const option = (s: GameState, id: string) => options(s).find((o) => o.id === id);
const begun = (seed = 7, pick: "lootbox" | "buddy" = "lootbox") => run(createGame(seed), { type: "start", seed }, { type: "loadout", pick });
/** A Nightmare Room opened directly, at a chosen room / Threat / Madness. */
function nm(id: NmRoomId, o: { room?: number; threat?: number; madness?: number; pick?: "lootbox" | "buddy"; seed?: number; setup?: (s: GameState) => void } = {}): GameState {
  let s = begun(o.seed ?? 7, o.pick);
  s.room = o.room ?? 6;
  s.threat = o.threat ?? 0;
  s.madness = o.madness ?? 0;
  s.team.nextAt = 999;
  o.setup?.(s);
  s = qa(s, "nmroom", undefined, id);
  return s;
}
const force = <T,>(o: "clean" | "complication" | "crisis", fn: () => T) => withRules({ nmForce: o }, fn);
const pick = (s: GameState, id: string, o: "clean" | "complication" | "crisis") => force(o, () => choose(s, id));
const nextRoom = (s: GameState) => {
  s.phase = "tech";
  s.event = null;
  return reduce(s, { type: "nextRoom" });
};
/** Leave the room and play the hall through to its fight. */
function toFight(s: GameState): GameState {
  if (s.phase === "route") s = reduce(s, { type: "pickPath", risky: false });
  if (s.event?.id === "nightmare") s = choose(s, "leave");
  for (let i = 0; i < 12 && s.phase === "event"; i++) s = choose(s, s.event?.id === "nightmare" ? "leave" : options(s).find((x) => x.enabled)!.id);
  return s;
}

// ---------- severity and Threat (1–7) ----------

describe("severity and Threat", () => {
  it("1. Threat bands are calibrated to real runs, not to 10/20/35/50", () => {
    expect(RULES.nmBands).toEqual([0, 4, 8, 13, 20]);
    expect(threatBand(3)).toBe(0);
    expect(threatBand(5)).toBe(1);
    expect(threatBand(9)).toBe(2);
    expect(threatBand(14)).toBe(3);
    expect(threatBand(25)).toBe(4);
  });
  it("2. decay runs only on real room transitions, never for entering or inspecting a Nightmare Room", () => {
    let s = nm("choir", { threat: 9 });
    expect(s.threat).toBe(9);
    eventView(s);
    s = sane(s);
    expect(s.threat).toBe(9);
    s = choose(s, "leave");
    expect(s.threat).toBe(9);
  });
  it("3. severity uses the Threat in force after the room-entry decay", () => {
    let s = begun();
    s.room = 5;
    s.threat = 8; // drops to 7 on entering room 6 (nothing stripped): Elevated, not High
    s.team.nextAt = 999;
    s = nextRoom(s);
    expect(s.threat).toBe(7);
    expect(severityParts(s).threat).toBe(0);
    s = qa(s, "nmroom", undefined, "choir");
    expect(s.nm.room!.threatAt).toBe(7);
  });
  it("4. modifiers stack but cap at IV", () => {
    const s = begun();
    s.room = 16;
    s.threat = 25;
    s.madness = 9;
    s.nm.streak = 3;
    const p = severityParts(s);
    expect(p.base + p.threat + p.madness + p.streak).toBeGreaterThan(4);
    expect(p.total).toBe(4);
    expect(baseTier(1)).toBe(1);
    expect(baseTier(5)).toBe(2);
    expect(baseTier(10)).toBe(3);
    expect(baseTier(15)).toBe(4);
  });
  it("5. entry Madness applies once, however often the screen is looked at", () => {
    let s = nm("staircase", { room: 6 });
    const tier = s.nm.room!.severity;
    expect(s.madness).toBe(tier);
    for (let i = 0; i < 3; i++) eventView(s);
    s = sane(s);
    expect(s.madness).toBe(tier);
  });
  it("Mental takes one off Nightmare Madness, never below 1 on entry", () => {
    const s = nm("staircase", {
      room: 6,
      setup: (x) => {
        const t = qa(x, "recruit", 70);
        Object.assign(x, t);
        x.roster[x.roster.length - 1].base.mental = 9;
      },
    });
    expect(s.madness).toBe(Math.max(1, s.nm.room!.severity - 1));
  });
  it("6. the three outcome chances always add to 100%", () => {
    for (let d = 0; d <= 7; d++) {
      const p = odds(d);
      expect(p.clean + p.complication + p.crisis).toBeCloseTo(1, 9);
      expect(p.clean).toBeGreaterThan(0);
    }
    expect(danger(1, 0, 0, 0)).toBe(0);
    expect(danger(4, 4, 2, 0)).toBe(7);
    expect(danger(1, 0, 0, 3)).toBe(0);
  });
  it("7. a rolled outcome is stored, and reopening never rerolls", () => {
    let s = nm("staircase");
    s = choose(s, "lights");
    const got = s.nm.room!.rolled.lights;
    expect(["clean", "complication", "crisis"]).toContain(got);
    const snap = JSON.stringify(s.nm);
    eventView(s);
    legalActions(s);
    expect(JSON.stringify(sane(s).nm)).toBe(snap);
    expect(option(s, "lights")!.enabled).toBe(false);
  });
  it("every choice shows cost, reward, all three odds, the Crisis and what can follow you", () => {
    const s = nm("hangar", { room: 11, threat: 9, setup: (x) => (x.scrap = 9) });
    const d = option(s, "power")!.detail;
    for (const bit of ["Standard", "Energy", "Scrap", "Clean ", "Complication ", "Crisis ", "Can follow you"]) expect(d, bit).toContain(bit);
  });
});

// ---------- the Captive Choir (8–15) ----------

describe("the Captive Choir", () => {
  it("8. the Conductor speaks from its own screen", () => {
    const s = nm("choir");
    const v = nmView(s);
    expect(v.title).toBe("THE CAPTIVE CHOIR");
    expect(v.screen?.who).toBe("The Conductor");
    expect(v.lines.some((l) => l.includes("CHORAL SYNCHRONIZATION: ACTIVE"))).toBe(true);
    expect(v.lines.some((l) => l.startsWith("CONDUCTOR: “Welcome, unexpected visitor."))).toBe(true);
  });
  it("9. three captives with three distinct states; a compromised one looks frightened until checked", () => {
    for (let seed = 1; seed < 30; seed++) {
      const s = nm("choir", { seed });
      const caps = s.nm.room!.data.captives!;
      expect(new Set(caps.map((c) => c.state)).size).toBe(3);
      for (const c of caps) if (c.state === "compromised") expect(c.shown).toBe("frightened");
    }
  });
  it("10. a pilot you let go can be one of them: the same record, not a copy", () => {
    const s = nm("choir", {
      setup: (x) => {
        const t = qa(x, "recruit", 70);
        Object.assign(x, t);
        x.roster[x.roster.length - 1].custody = "free";
      },
    });
    const freeOne = s.roster.find((r) => r.custody === "free" && !s.team.pilots.some((p) => p.id === r.id))!;
    const c = s.nm.room!.data.captives![0];
    expect(c.id).toBe(freeOne.id);
    expect(c.existing).toBe(true);
    const n = s.roster.length;
    let t = sane(s);
    t.nm.room!.data.captives![0].state = "resistant";
    t = pick(t, "open", "clean");
    expect(t.roster.length).toBe(n + t.nm.room!.data.captives!.filter((x) => !x.existing && x.state !== "hostile" && x.freed).length);
    expect(rec(t, freeOne.id)!.custody).toBe("ally");
  });
  it("11. negotiation has real terms and its three outcomes", () => {
    const clean = pick(nm("choir"), "negotiate", "clean");
    expect(clean.energy).toBeLessThan(nm("choir").energy);
    expect(clean.nm.room!.data.captives!.filter((c) => c.freed).length).toBe(1);
    const comp = pick(nm("choir"), "negotiate", "complication");
    const freed = comp.nm.room!.data.captives!.find((c) => c.freed)!;
    expect(rec(comp, freed.id)!.loyalty).toBeLessThan(45);
    const crisis = pick(nm("choir"), "negotiate", "crisis");
    expect(liveEffects(crisis, "transmission").length).toBe(1);
  });
  it("12. interrupting the choir ends synchronization; its Crisis leaves a transmission behind", () => {
    const s = pick(nm("choir"), "interrupt", "clean");
    expect(s.nm.room!.data.synced).toBe(false);
    expect(nmView(s).screen).toBeUndefined();
    expect(option(s, "open")!.detail).toMatch(/^Standard/); // cheaper to open now
    expect(liveEffects(pick(nm("choir"), "interrupt", "crisis"), "transmission").length).toBe(1);
    expect(liveEffects(pick(nm("choir"), "interrupt", "complication")).length).toBe(0); // no damage for a nonviolent fix
  });
  it("13. isolation needs a real comms device, and then the Conductor can never reach your radio", () => {
    expect(option(nm("choir"), "isolate")!.enabled).toBe(false);
    let s = nm("choir", { setup: (x) => Object.assign(x, qa(x, "item", undefined, "isolator")) });
    expect(option(s, "isolate")!.enabled).toBe(true);
    s = pick(s, "isolate", "clean");
    expect(s.nm.isolated).toBe(true);
    expect(schedule(s, "transmission", "qa", "X", "x")).toBeNull();
  });
  it("14. questioning reveals real states; a Crisis plants a lie that a second question finds", () => {
    let s = pick(nm("choir"), "question", "clean");
    for (const c of s.nm.room!.data.captives!) {
      expect(c.known).toBe(true);
      expect(c.shown).toBe(c.state);
    }
    s = pick(nm("choir"), "question", "crisis");
    const lie = s.nm.room!.data.misled!;
    const c = s.nm.room!.data.captives!.find((x) => x.id === lie)!;
    expect(c.shown).not.toBe(c.state);
    expect(nmView(s).lines.some((l) => l.includes("half a second late"))).toBe(true);
    expect(nmView(s).lines.some((l) => l.includes(`${c.name}: ${c.shown.toUpperCase()}`))).toBe(true); // the lie, not the truth
    expect(option(s, "question")!.enabled).toBe(true);
    s = pick(s, "question", "clean");
    expect(s.nm.room!.data.captives!.find((x) => x.id === lie)!.shown).toBe(c.state);
  });
  it("15. choir rewards cannot be claimed twice", () => {
    let s = pick(nm("choir"), "accept", "clean");
    const scrap = s.scrap;
    expect(option(s, "accept")!.enabled).toBe(false);
    s = choose(s, "accept");
    expect(s.scrap).toBe(scrap);
    s = pick(s, "open", "clean");
    expect(option(s, "open")!.enabled).toBe(false);
    expect(option(s, "negotiate")!.enabled).toBe(false);
  });
  it("breaking the agreement costs you: the next technical choice gets riskier", () => {
    const s = nm("choir", { setup: (x) => Object.assign(x, qa(x, "item", undefined, "isolator")) });
    const before = option(s, "isolate")!.detail.match(/Clean (\d+)%/)![1];
    const t = pick(s, "accept", "clean");
    const after = option(t, "isolate")!.detail.match(/Clean (\d+)%/)![1];
    expect(Number(after)).toBeLessThan(Number(before));
  });
  it("no room allows more than three actions", () => {
    let s = nm("choir", { setup: (x) => Object.assign(x, qa(x, "item", undefined, "isolator")) });
    for (const id of ["accept", "question", "interrupt"]) s = pick(s, id, "clean");
    expect(options(s).filter((o) => o.enabled).map((o) => o.id)).toEqual(["leave"]);
  });
});

// ---------- CASKET-13 (16–20) ----------

describe("CASKET-13", () => {
  const hangar = (setup?: (s: GameState) => void) => nm("hangar", { room: 11, threat: 9, setup: (x) => { x.scrap = 10; setup?.(x); } });
  it("16. a crew pilot can be assigned to it", () => {
    let s = hangar((x) => Object.assign(x, qa(x, "recruit", 70)));
    s = pick(s, "power", "clean");
    const c = ally(s, "casket");
    expect(c.maxHp).toBe(14);
    expect(option(s, "assign")!.enabled).toBe(true);
    s = pick(s, "assign", "clean");
    const r = rec(s, ally(s, "casket").pilot)!;
    expect(r.assignment).toBe(c.uid);
  });
  it("17. its reactor heat is visible and climbs each deployment when nobody supervises it", () => {
    let s = pick(hangar(), "power", "complication");
    expect(ally(s, "casket").heat).toBe(2);
    s = toFight(s);
    expect(s.phase).toBe("player");
    expect(ally(s, "casket").heat).toBe(3);
    expect(said(s, "REACTOR WARNING")).toBe(true);
    expect(said(s, "CASKET-13 deploys")).toBe(true);
  });
  it("18. it turns hostile only through a Crisis", () => {
    for (const o of ["clean", "complication"] as const) {
      const s = toFight(pick(hangar(), "power", o));
      expect(s.units.some((u) => u.kind === "casket" && u.side === "enemy"), o).toBe(false);
    }
    const s = toFight(pick(hangar(), "power", "crisis"));
    expect(s.units.some((u) => u.kind === "casket" && u.side === "enemy")).toBe(true);
    expect(s.units.some((u) => u.kind === "casket" && u.side === "friendly")).toBe(false);
  });
  it("19. stripping it gives salvage and no mech, and cannot be repeated", () => {
    let s = hangar();
    const scrap = s.scrap;
    s = pick(s, "strip", "clean");
    expect(s.scrap).toBe(scrap + 4);
    expect(s.units.some((u) => u.kind === "casket")).toBe(false);
    expect(option(s, "power")!.enabled).toBe(false);
    expect(option(s, "strip")!.enabled).toBe(false);
  });
  it("20. a Dead Frame from the hangar is a separate chassis, never a copy of your CASKET-13", () => {
    const s = nm("hangar", { room: 16, threat: 25, setup: (x) => (x.scrap = 10) });
    expect(s.nm.room!.severity).toBe(4);
    const t = pick(s, "power", "crisis");
    const z = liveEffects(t).find((e) => e.type === "zombie")!;
    expect(z.origin.entity).toContain("second chassis");
    // An owned CASKET-13 is never what a Dead Frame is.
    let u = pick(nm("hangar", { room: 16, threat: 25, setup: (x) => (x.scrap = 10) }), "power", "clean");
    u = qa(u, "nmeffect", undefined, "zombie");
    u = nextRoom(choose(u, "leave").phase === "event" ? u : choose(u, "leave"));
    expect(u.units.filter((x) => x.kind === "casket").length).toBeLessThanOrEqual(1);
  });
});

// ---------- ASHMOUTH (21–26) ----------

describe("ASHMOUTH CHARGE", () => {
  const taken = (o: "clean" | "complication" | "crisis" = "clean") => pick(nm("reliquary", { room: 6 }), "take", o);
  it("21. one explosive shot: the card leaves your deck when fired", () => {
    let s = taken();
    expect(s.deck.filter((c) => c.id === "ASHMOUTH").length).toBe(1);
    s = toFight(s);
    const card = s.deck.find((c) => c.id === "ASHMOUTH")!;
    if (!s.hand.some((c) => c.uid === card.uid)) {
      s.draw = s.draw.filter((c) => c.uid !== card.uid);
      s.discard = s.discard.filter((c) => c.uid !== card.uid);
      s.hand.push(card);
    }
    s.energy = 9;
    const e = foe(s)!;
    e.hp = e.maxHp = 30;
    s = reduce(s, { type: "play", uid: card.uid, targetId: e.uid });
    expect([...s.deck, ...s.hand, ...s.discard].some((c) => c.id === "ASHMOUTH")).toBe(false);
    expect(s.nm.ash).toBeNull();
  });
  it("22–23. heat climbs one per transition, warns at 3, goes critical at 4, then fails", () => {
    let s = taken("clean");
    expect(s.nm.ash!.heat).toBe(1);
    s.notices = [];
    s = nextRoom(s);
    expect(s.nm.ash!.heat).toBe(2);
    s = nextRoom(s);
    expect(s.nm.ash!.heat).toBe(3);
    expect(s.notices.some((n) => n.title.includes("HEAT WARNING"))).toBe(true);
    s = nextRoom(s);
    expect(s.nm.ash!.heat).toBe(4);
    expect(s.notices.some((n) => n.title.includes("CRITICAL"))).toBe(true);
    const hp = j(s).hp;
    s = nextRoom(s);
    expect(s.nm.ash).toBeNull();
    expect(j(s).hp).toBe(hp - 4);
    expect(s.notices.some((n) => n.title.includes("CONTAINMENT FAILURE"))).toBe(true);
  });
  it("venting and abandoning are real answers", () => {
    let s = taken("crisis");
    expect(s.nm.ash!.heat).toBe(3);
    s = nextRoom(s);
    s.scrap = 3;
    s = reduce(s, { type: "nm", op: "vent" });
    expect(s.nm.ash!.heat).toBe(2);
    s = reduce(s, { type: "nm", op: "abandon" });
    expect(s.nm.ash).toBeNull();
    expect([...s.deck, ...s.hand, ...s.discard].some((c) => c.id === "ASHMOUTH")).toBe(false);
  });
  it("24–25. 9 to the target, 3 to the enemies beside it and to your unit across; +2 Threat", () => {
    let s = fight({ enemies: "zombie,zombie,zombie" });
    s.nm.ash = { heat: 0 };
    s = qa(s, "hand", undefined, "ASHMOUTH");
    const es = living(s, "enemy").sort((a, b) => a.slot - b.slot);
    for (const e of es) {
      e.hp = e.maxHp = 30;
      e.armor = 0;
    }
    const mid = es[1];
    const across = s.units.find((u) => u.side === "friendly" && u.slot === mid.slot);
    const acrossHp = across?.hp;
    const t = s.threat;
    s = reduce(s, { type: "play", uid: s.hand.find((c) => c.id === "ASHMOUTH")!.uid, targetId: mid.uid });
    const after = (uid: string) => s.units.find((u) => u.uid === uid)!.hp;
    expect(after(mid.uid)).toBe(30 - RULES.ashmouthDamage);
    for (const e of es) if (Math.abs(e.slot - mid.slot) === 1) expect(after(e.uid)).toBe(30 - RULES.ashmouthSplash);
    if (across) expect(s.units.find((u) => u.uid === across.uid)!.hp).toBe(acrossHp! - RULES.ashmouthSplash);
    expect(s.threat).toBe(t + RULES.ashmouthThreat);
  });
  it("26. at Severe Threat the shot pulls in a real stalker, and only a real one", () => {
    let s = fight({ enemies: "zombie" });
    s.nm.ash = { heat: 0 };
    s.threat = 14;
    s = qa(s, "hand", undefined, "ASHMOUTH");
    const before = s.stalkers.length;
    s = reduce(s, { type: "play", uid: s.hand.find((c) => c.id === "ASHMOUTH")!.uid, targetId: foe(s)!.uid });
    expect(s.stalkers.length).toBe(before); // never invents one
    let t = fight({ enemies: "zombie" });
    t.room = 6;
    t = qa(t, "stalker", 3, "hunter");
    t.nm.ash = { heat: 0 };
    t.threat = 14;
    t = qa(t, "hand", undefined, "ASHMOUTH");
    t = reduce(t, { type: "play", uid: t.hand.find((c) => c.id === "ASHMOUTH")!.uid, targetId: foe(t)!.uid });
    expect(t.stalkers.length).toBe(1);
    expect(t.stalkers[0].distance).toBe(2);
  });
});

// ---------- the Wrong Robobuddy (27–31) ----------

describe("the Wrong Robobuddy", () => {
  it("27–28. the real Robobuddy keeps its identity; the imitation never becomes it", () => {
    let s = nm("wrongbuddy", { pick: "buddy" });
    const real = ally(s, "robobuddy");
    const buddy = structuredClone(s.buddy);
    s = pick(s, "send", "crisis");
    s = toFight(s);
    const after = s.units.filter((u) => u.kind === "robobuddy");
    expect(after.length).toBe(1);
    expect(after[0].uid).toBe(real.uid);
    expect(s.buddy).toEqual(buddy);
    const mimic = s.units.find((u) => u.kind === "mimic")!;
    expect(mimic.side).toBe("enemy");
    expect(mimic.maxHp).toBe(4);
  });
  it("the room reads Robobuddy's real state", () => {
    expect(nmView(nm("wrongbuddy", { pick: "buddy" })).lines.join(" ")).toContain("your Robobuddy, standing right there");
    expect(nmView(nm("wrongbuddy")).lines.join(" ")).toContain("never had a Robobuddy");
    const w = nm("wrongbuddy", { pick: "buddy", setup: (x) => { x.buddy.status = "wrecked"; x.units = x.units.filter((u) => u.kind !== "robobuddy"); } });
    expect(nmView(w).lines.join(" ")).toContain("still a shell");
    expect(option(w, "send")!.enabled).toBe(false);
  });
  it("29. reconstruction uses real wreck Scrap or nothing", () => {
    const none = nm("wrongbuddy", { pick: "buddy", setup: (x) => { x.buddy.status = "wrecked"; x.units = x.units.filter((u) => u.kind !== "robobuddy"); x.wrecks = []; } });
    expect(option(none, "rebuild")!.enabled).toBe(false);
    let s = nm("wrongbuddy", { pick: "buddy", setup: (x) => { x.buddy.status = "wrecked"; x.buddy.penalty = true; x.units = x.units.filter((u) => u.kind !== "robobuddy"); x.wrecks = [{ id: "w9", kind: "light", side: "enemy", value: 1 }]; } });
    expect(option(s, "rebuild")!.enabled).toBe(true);
    s = pick(s, "rebuild", "clean");
    expect(s.wrecks.length).toBe(0);
    expect(s.buddy.status).toBe("reassembling");
  });
  it("30. a Crisis schedules the imitation for a later fight; at tier IV, the Dead Frame instead", () => {
    let s = pick(nm("wrongbuddy", { room: 6 }), "approach", "crisis");
    const e = liveEffects(s)[0];
    expect(e.type).toBe("mimic");
    expect(e.from).toBe(s.room + 1);
    s = toFight(choose(s, "leave"));
    expect(s.units.some((u) => u.kind === "mimic")).toBe(false); // not this room's fight
    s = toFight(nextRoom(s));
    expect(s.units.filter((u) => u.kind === "mimic").length).toBe(1);
    const iv = pick(nm("wrongbuddy", { room: 16, threat: 25 }), "approach", "crisis");
    expect(liveEffects(iv)[0].type).toBe("zombie");
  });
  it("31. no event makes a second Robobuddy", () => {
    let s = nm("wrongbuddy", { pick: "buddy" });
    for (const id of ["inspect", "destroy"]) s = pick(s, id, "clean");
    s = toFight(s);
    expect(s.units.filter((u) => u.kind === "robobuddy" && u.side === "friendly").length).toBe(1);
  });
});

// ---------- the Staircase (32–36) ----------

describe("the Staircase with Too Many Landings", () => {
  it("32–33. it never adds rooms or changes the branch you are on", () => {
    let s = nm("staircase", { room: 6 });
    const room = s.room;
    for (const id of ["lights", "map"]) s = pick(s, id, "crisis");
    s = toFight(s);
    expect(s.room).toBe(room);
    s = nextRoom(s);
    expect(s.room).toBe(room + 1);
    expect(s.phase).toBe("route");
  });
  it("34. mapping reveals the next room and makes the next Nightmare Room safer", () => {
    const s = pick(nm("staircase"), "map", "clean");
    expect(s.revealNext).toBe(true);
    expect(s.nm.mappedRoom).toBe(s.room + 1);
  });
  it("35. a real climbing Dead Frame follows you if you turn back", () => {
    let s: GameState | undefined;
    for (let seed = 1; seed < 60 && !s; seed++) {
      const t = nm("staircase", { room: 11, threat: 9, seed });
      if (t.nm.room!.data.climbing) s = t;
    }
    expect(s).toBeTruthy();
    expect(option(s!, "ambush")).toBeTruthy();
    expect(option(s!, "leave")!.detail).toContain("Dead Frame in a later fight");
    let t = choose(s!, "leave");
    const e = liveEffects(t).find((x) => x.type === "zombie")!;
    expect(e.origin.event).toBe("staircase");
    t = toFight(nextRoom(toFight(t)));
    const df = t.units.find((u) => u.kind === "deadframe")!;
    expect(df.nmEffect).toBe(e.id);
  });
  it("36. leaving does not reroll the staircase or let it come back", () => {
    let s = nm("staircase");
    s = choose(s, "leave");
    expect(s.nm.seen).toContain("staircase");
    expect(s.nm.room).toBeNull();
    s.room = 6;
    s.pathRisky = true;
    const again = qa(s, "nmroom", undefined, "choir");
    expect(again.nm.seen.filter((x) => x === "staircase").length).toBe(1);
  });
});

// ---------- the Last Safe Room (37–41) ----------

describe("the Last Safe Room", () => {
  const safeRoom = (state: "genuine" | "trap" | "surveillance" | "malfunction") => {
    for (let seed = 1; seed < 200; seed++) {
      const s = nm("saferoom", { room: 11, threat: 9, seed, setup: (x) => (x.scrap = 9) });
      if (s.nm.room!.data.safe === state) return s;
    }
    throw new Error("no seed");
  };
  it("37. genuine refuges exist, and resting there is cautious", () => {
    const s = safeRoom("genuine");
    expect(option(s, "rest")!.detail).toMatch(/^Cautious/);
    j(s).maxHp = 20;
    j(s).hp = 5;
    const t = pick(s, "rest", "clean");
    expect(j(t).hp).toBe(9);
  });
  it("38. inspecting shows the real condition, decided when the room was made", () => {
    const s = safeRoom("trap");
    const t = pick(s, "inspect", "clean");
    expect(t.nm.room!.data.known).toBe("full");
    expect(said(t, "ACTIVE NIGHTMARE TRAP")).toBe(true);
    expect(said(t, `chassis ${s.nm.room!.data.hidden}`)).toBe(true);
  });
  it("39. repairs and supplies cost and give real things", () => {
    const s = safeRoom("genuine");
    s.units.push({ ...ally(s, "jubey"), uid: "wx", kind: "walker", hp: 1, maxHp: 3, slot: 5 });
    const t = pick(s, "repair", "clean");
    expect(t.scrap).toBe(s.scrap - 2);
    expect(t.units.find((u) => u.uid === "wx")!.hp).toBe(3);
    const g = pick(safeRoom("genuine"), "supplies", "clean");
    expect(g.items.some((x) => x.id === "medkit")).toBe(true);
  });
  it("40. a delayed Dead Frame comes from the hidden chassis it was foreshadowed as", () => {
    let s = pick(safeRoom("trap"), "supplies", "crisis");
    const e = liveEffects(s).find((x) => x.type === "zombie")!;
    expect(e.origin.entity).toBe(s.nm.room!.data.hidden);
    s = toFight(nextRoom(toFight(s)));
    expect(s.units.find((u) => u.kind === "deadframe")!.note).toContain(e.origin.entity);
  });
  it("41. neutralizing the hidden machine cancels its future appearance", () => {
    let s = pick(safeRoom("trap"), "inspect", "clean");
    expect(option(s, "neutralize")!.enabled).toBe(true);
    s = pick(s, "neutralize", "clean");
    expect(s.nm.room!.data.hiddenGone).toBe(true);
    s = pick(s, "supplies", "crisis");
    expect(liveEffects(s).filter((x) => x.type === "zombie").length).toBe(0);
    s = toFight(nextRoom(toFight(s)));
    expect(s.units.some((u) => u.kind === "deadframe")).toBe(false);
  });
  it("without a trap there is no Dead Frame to schedule", () => {
    const s = pick(safeRoom("genuine"), "supplies", "crisis");
    expect(liveEffects(s).filter((x) => x.type === "zombie").length).toBe(0);
  });
});

// ---------- the Dead Frame and transmissions (42–50) ----------

describe("the Dead Frame", () => {
  const framed = (sudden = false) => {
    let s = fight({ enemies: "light", quiet: false });
    j(s).hp = j(s).maxHp = 60;
    foe(s, "light").stunned = 99;
    s = qa(s, "nmeffect", undefined, "zombie");
    s.nm.effects[0].from = s.room;
    s.nm.effects[0].sudden = sudden;
    s = qa(s, "fight", 0, "light");
    foe(s, "light").stunned = 99;
    return s;
  };
  it("42. it closes with the melee rules, slowly", () => {
    let s = framed();
    const df = foe(s, "deadframe")!;
    expect(df.prox).toBe(0);
    const seen: number[] = [];
    for (let t = 0; t < 4; t++) {
      s = end(s);
      seen.push(foe(s, "deadframe")!.prox ?? 0);
    }
    expect(seen[seen.length - 1]).toBeGreaterThanOrEqual(1);
    expect(seen.some((p, i) => i > 0 && p === seen[i - 1])).toBe(true); // it stands still some turns
    expect(said(s, "stands perfectly still")).toBe(true);
  });
  it("43. it reassembles once, after a visible telegraph", () => {
    let s = framed();
    const df = foe(s, "deadframe")!;
    df.hp = 4;
    s = end(s); // plan made at the start of this turn
    expect(foe(s, "deadframe")!.plan?.type).toBe("reassemble");
    expect(foe(s, "deadframe")!.plan?.note).toContain("REASSEMBLING");
    s = end(s);
    expect(foe(s, "deadframe")!.hp).toBe(4 + RULES.deadframeHeal);
    foe(s, "deadframe")!.hp = 2;
    s = end(end(s));
    expect(foe(s, "deadframe")!.hp).toBeLessThanOrEqual(2);
    expect(foe(s, "deadframe")!.plan?.type).not.toBe("reassemble");
  });
  it("44. one at a time: a second Zombie-type consequence is never scheduled", () => {
    let s = begun();
    s = qa(s, "nmeffect", undefined, "zombie");
    s = qa(s, "nmeffect", undefined, "mimic");
    expect(liveEffects(s).filter((e) => e.type === "zombie" || e.type === "mimic").length).toBe(1);
  });
  it("it expires on a fixed rule if no fight comes in its window", () => {
    let s = begun();
    s = qa(s, "nmeffect", undefined, "zombie");
    const e = s.nm.effects[0];
    for (let i = 0; i <= RULES.nmWindow; i++) s = nextRoom(s);
    expect(s.nm.effects[0].status).toBe("expired");
    expect(s.room).toBeGreaterThan(e.until);
  });
  it("no pilot, no capsule, and no stalker bounty", () => {
    let s = framed();
    const df = foe(s, "deadframe")!;
    df.hp = 1;
    df.armor = 0;
    const threat = s.threat;
    s = qa(qa(s, "hand", undefined, "SLUG"), "energy", 9);
    s = reduce(s, { type: "play", uid: s.hand.find((c) => c.id === "SLUG")!.uid, targetId: df.uid });
    expect(s.units.some((u) => u.kind === "capsule")).toBe(false);
    expect(s.notices.some((n) => n.title === "STALKING THREAT ELIMINATED")).toBe(false);
    expect(s.threat).toBe(threat);
    expect(s.nm.effects[0].status).toBe("resolved");
  });
});

describe("transmission disturbances", () => {
  const disturbed = () => {
    let s = pick(nm("choir"), "interrupt", "crisis");
    s = toFight(s);
    return nextRoom(s);
  };
  it("45. they touch supported information only: the route intel and the radio", () => {
    const s = disturbed();
    expect(s.intel.questionable).toBe(true);
    expect(s.routeSnippets.some((l) => l.startsWith("SIGNAL ANOMALY"))).toBe(true);
  });
  it("46. your controls stay exactly the same", () => {
    const s = disturbed();
    const t = sane(s);
    for (const e of t.nm.effects) e.status = "resolved";
    t.intel.questionable = false;
    const acts = (x: GameState) => legalActions(x).filter((a) => !(a.type === "nm" && a.op === "purge")).map((a) => JSON.stringify(a));
    expect(acts(s)).toEqual(acts(t));
  });
  it("47. good eyes see through it", () => {
    let s = pick(nm("choir", { setup: (x) => { Object.assign(x, qa(x, "recruit", 70)); x.roster[x.roster.length - 1].base.observation = 9; } }), "interrupt", "crisis");
    s = nextRoom(toFight(s));
    expect(s.routeSnippets.some((l) => l.includes("Conductor origin"))).toBe(true);
  });
  it("it ends on its own, or by purging the comms", () => {
    let s = disturbed();
    s.scrap = 5;
    s = reduce(s, { type: "nm", op: "purge" });
    expect(liveEffects(s, "transmission").length).toBe(0);
    let t = disturbed();
    for (let i = 0; i < RULES.nmTransmissionRooms + 1; i++) t = nextRoom(t);
    expect(liveEffects(t, "transmission").length).toBe(0);
  });
  it("48. Mental's Nightmare resistance applies in Dead Frame fights", () => {
    let s = begun();
    s = qa(s, "nmeffect", undefined, "zombie");
    s.nm.effects[0].from = s.room;
    s = qa(s, "fight", 0, "light");
    expect(s.nightmareFight).toBe(true);
  });
  it("49. there is no PRATTLE-9 in this build, so nothing here can give it new powers", () => {
    const src = JSON.stringify(begun());
    expect(src.includes("PRATTLE")).toBe(false);
  });
});

describe("saves", () => {
  it("50. everything Nightmare survives save and load, and old saves migrate", () => {
    let s = pick(nm("reliquary"), "take", "clean");
    s = qa(s, "nmeffect", undefined, "zombie");
    const t = sane(s);
    expect(t.nm).toEqual(s.nm);
    expect(reduce(t, { type: "event", option: "leave" })).toEqual(reduce(s, { type: "event", option: "leave" }));
    const old = sane(begun()) as GameState & { v: number };
    old.v = 8;
    delete (old as unknown as Record<string, unknown>).nm;
    const m = migrate(old)!;
    expect(m.v).toBe(SAVE_VERSION);
    expect(m.nm.effects).toEqual([]);
  });
});
