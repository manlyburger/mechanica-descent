import { RULES } from "../data";
import { createGame, jubey, living, reduce, type Action, type GameState, type Unit } from "../engine";

export const run = (s: GameState, ...acts: Action[]) => acts.reduce(reduce, s);
export const qa = (s: GameState, cmd: string, n?: number, str?: string) => reduce(s, { type: "qa", cmd, n, s: str });

export interface Setup {
  seed?: number;
  enemies?: string;
  allies?: string;
  hand?: string;
  scrap?: number;
  energy?: number;
  /** Stun every enemy for the whole test so only what is under test happens. */
  quiet?: boolean;
  pick?: "lootbox" | "mine" | "buddy";
  /** R-8 mechs to field, with their real pilots: "needleback,bishop". */
  team?: string;
}

/** A clean fight with exactly the pieces a test needs. */
export function fight(o: Setup = {}): GameState {
  let s = run(createGame(o.seed ?? 5), { type: "start", seed: o.seed ?? 5 }, { type: "loadout", pick: o.pick ?? "lootbox" });
  s = qa(s, "scrap", o.scrap ?? 20);
  if (o.allies) s = qa(s, "ally", undefined, o.allies);
  if (o.team) s = qa(s, "team", undefined, o.team);
  s = qa(s, "fight", o.pick === "mine" ? 1 : 0, o.enemies ?? (o.team ? "" : "zombie"));
  if (o.hand) s = qa(s, "hand", undefined, o.hand);
  s = qa(s, "energy", o.energy ?? 9);
  if (o.quiet !== false) for (const e of living(s, "enemy")) e.stunned = 99;
  return s;
}

export const foe = (s: GameState, kind?: string): Unit => living(s, "enemy").find((u) => !kind || u.kind === kind)!;
export const ally = (s: GameState, kind: string): Unit => living(s, "friendly").find((u) => u.kind === kind)!;
export const card = (s: GameState, id: string) => s.hand.find((c) => c.id === id)!;
export const play = (s: GameState, id: string, target?: Unit | number): GameState =>
  reduce(s, { type: "play", uid: card(s, id).uid, targetId: typeof target === "object" ? target.uid : undefined, slot: typeof target === "number" ? target : undefined });
export const cmd = (s: GameState, u: Unit | "ejected", c: string, target?: Unit): GameState =>
  reduce(s, { type: "command", uid: u === "ejected" ? "ejected" : u.uid, cmd: c, targetId: target?.uid });
export const end = (s: GameState, times = 1): GameState => {
  for (let i = 0; i < times; i++) s = reduce(s, { type: "endTurn" });
  return s;
};
export const j = (s: GameState) => jubey(s)!;
export const sane = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

/** Try seeds until a predicate holds, so probabilistic branches get a deterministic test. */
export function findSeed<T>(make: (seed: number) => T, ok: (t: T) => boolean, max = 400): T {
  for (let seed = 1; seed <= max; seed++) {
    const t = make(seed);
    if (ok(t)) return t;
  }
  throw new Error("no seed produced the wanted branch");
}

export { RULES };

/** Runs fn with some RULES values swapped, then puts them back. */
export function withRules<T>(over: Partial<typeof RULES>, fn: () => T): T {
  const keep: Record<string, unknown> = {};
  for (const k of Object.keys(over)) keep[k] = (RULES as Record<string, unknown>)[k];
  Object.assign(RULES, over);
  try {
    return fn();
  } finally {
    Object.assign(RULES, keep);
  }
}
/** No anonymous escape pods: for tests about something else that kill ordinary mechs. */
export const noPods = <T>(fn: () => T): T => withRules({ anonEject: {} }, fn);

export const choose = (s: GameState, option: string) => reduce(s, { type: "event", option });
export const pilotStatus = (s: GameState, id: string) => s.team.pilots.find((p) => p.id === id)!.status;
/** Ends turns with every enemy plan left alone, re-quieting nothing. */
export const said = (s: GameState, text: string) => s.log.some((l) => l.includes(text));
