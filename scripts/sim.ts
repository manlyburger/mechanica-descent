// Balance sim: npm run sim [runs]
import { CAREFUL, GREEDY, PASSIVE, playRun, type BotStyle } from "../src/game/bot.ts";
import { RULES } from "../src/game/data.ts";

const N = Number(process.argv[2] ?? 2000);
const D = RULES.deconEvery;
const styles: [string, BotStyle][] = [
  ["passive: lootbox, no machines, no salvage", PASSIVE],
  ["careful + Shabby Lootbox", { ...CAREFUL, loadout: "lootbox" }],
  ["careful + AM Mine", { ...CAREFUL, loadout: "mine" }],
  ["careful + Lil Robobuddy", CAREFUL],
  ["careful, old cards only (no machines)", { ...CAREFUL, machines: false }],
  ["greedy: red hall, strips everything", GREEDY],
  ["careful, goes deeper once (2 legs)", { ...CAREFUL, legs: 2 }],
  ["greedy, goes deeper twice (3 legs)", { ...GREEDY, legs: 3 }],
];
const pct = (n: number) => ((100 * n) / N).toFixed(1) + "%";
for (const [name, style] of styles) {
  let out = 0, first = 0, depth = 0, r12 = 0, scrap = 0, machines = 0, met = 0, crew = 0, lost = 0;
  let nmRooms = 0, nmFollow = 0;
  let stalked = 0, killedStalker = 0, buddyDown = 0, rebuilt = 0, podPilots = 0, peakThreat = 0;
  const ends: Record<string, number> = {};
  const fates: Record<string, number> = {};
  for (let i = 1; i <= N; i++) {
    const r = playRun(i * 7919 + 13, style);
    const f = r.final;
    if (r.win) out++;
    if (f.tally.decons >= 1 || f.room > D) first++;
    if (f.room > 2 || r.win) r12++;
    depth += f.room;
    if (f.team.introduced) met++;
    crew += f.roster.filter((r) => r.custody === "ally").length;
    lost += f.roster.filter((r) => r.custody === "dead" && !r.role).length;
    ends[f.team.pursuit] = (ends[f.team.pursuit] ?? 0) + 1;
    for (const p of f.team.pilots) fates[p.status] = (fates[p.status] ?? 0) + 1;
    scrap += f.tally.salvaged;
    nmRooms += f.nm.seen.length;
    nmFollow += f.nm.effects.filter((e) => e.type === "zombie" || e.type === "mimic").length;
    if (f.stalkers.length) stalked++;
    killedStalker += f.stalkers.filter((x) => x.state === "defeated").length;
    buddyDown += f.buddy.deaths;
    rebuilt += f.buddy.rebuilt;
    podPilots += f.roster.filter((x) => x.id.startsWith("p-a")).length;
    peakThreat += f.threat;
    machines += f.deck.filter((c) => ["BUILDER", "JACK", "SHEPHERD", "WALKER", "POSSUM", "WARFRAME"].includes(c.id)).length;
  }
  console.log(`\n${name}`);
  console.log(`  past room 2 ${pct(r12)}   reached first Decon ${pct(first)}   walked out clean ${pct(out)}   avg final room ${(depth / N).toFixed(1)}`);
  console.log(`  R-8 met ${pct(met)}   pursuit at end: ${Object.entries(ends).map(([k, v]) => `${k} ${pct(v)}`).join(", ")}`);
  console.log(`  pilots per run: ${Object.entries(fates).map(([k, v]) => `${k} ${(v / N).toFixed(2)}`).join(", ")}`);
  console.log(`  crew at end/run ${(crew / N).toFixed(2)}   recruits lost/run ${(lost / N).toFixed(2)}`);
  console.log(`  wrecks stripped/run ${(scrap / N).toFixed(2)}   machine cards in deck at end ${(machines / N).toFixed(2)}`);
  console.log(`  stalked ${pct(stalked)}   stalkers eliminated/run ${(killedStalker / N).toFixed(2)}   pod pilots met/run ${(podPilots / N).toFixed(2)}   Threat at end ${(peakThreat / N).toFixed(1)}`);
  console.log(`  Nightmare Rooms/run ${(nmRooms / N).toFixed(2)}   things that followed you/run ${(nmFollow / N).toFixed(2)}`);
  console.log(`  Robobuddy downed/run ${(buddyDown / N).toFixed(2)}   rebuilt/run ${(rebuilt / N).toFixed(2)}`);
}
