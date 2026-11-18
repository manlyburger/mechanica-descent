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
  let out = 0, first = 0, depth = 0, r12 = 0, scrap = 0, machines = 0;
  for (let i = 1; i <= N; i++) {
    const r = playRun(i * 7919 + 13, style);
    const f = r.final;
    if (r.win) out++;
    if (f.tally.decons >= 1 || f.room > D) first++;
    if (f.room > 2 || r.win) r12++;
    depth += f.room;
    scrap += f.tally.salvaged;
    machines += f.deck.filter((c) => ["BUILDER", "JACK", "SHEPHERD", "WALKER", "POSSUM", "WARFRAME"].includes(c.id)).length;
  }
  console.log(`\n${name}`);
  console.log(`  past room 2 ${pct(r12)}   reached first Decon ${pct(first)}   walked out clean ${pct(out)}   avg final room ${(depth / N).toFixed(1)}`);
  console.log(`  wrecks stripped/run ${(scrap / N).toFixed(2)}   machine cards in deck at end ${(machines / N).toFixed(2)}`);
}
