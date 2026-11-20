// Enemy equipment cards, enemy magazines, and the Observation checks that can
// identify equipment before it acts. Everything is rolled once per enemy
// instance and stored on it: inspecting never rerolls.

import { RULES, label, type UnitKind } from "./data";
import { addScrap, chance, deal, is, living, log, pick, roll, uid } from "./core";
import { newItem, partyObservation } from "./pilots";
import type { EnemyGear, GameState, Unit } from "./state";

export const GEAR: Record<EnemyGear["id"], { name: string; text: string; conceal: number; weight: number }> = {
  missilepod: { name: "Add-On Missile Pod", text: `A shoulder rack: a 2-damage missile at a random target every ${RULES.missilePodCooldown + 1} turns.`, conceal: 0, weight: 1 },
  extmag: { name: "Extended Magazine", text: `Holds ${Math.ceil(RULES.magazine * 1.5)} rounds instead of ${RULES.magazine}: it reloads less often.`, conceal: 0.1, weight: 2 },
  laser: { name: "Laser Sight", text: `+${Math.round(RULES.laserBonus * 100)}% to hit.`, conceal: 0.05, weight: 1 },
};

/** Enemies with a gun that has to be reloaded. */
const MAGAZINE: UnitKind[] = ["light", "lvl2", "powered", "needleback", "widow", "bishop", "tracker", "predator"];
/** Enemies that can roll random equipment. Authored enemies get theirs from their own records. */
const RANDOM_GEAR: UnitKind[] = ["light", "lvl2", "powered", "zombie"];

export function has(u: Unit, id: EnemyGear["id"]): EnemyGear | undefined {
  return u.gear?.find((g) => g.id === id);
}
export function magazine(u: Unit): number {
  return has(u, "extmag") ? Math.ceil(RULES.magazine * 1.5) : RULES.magazine;
}
export function allowed(kind: UnitKind, id: EnemyGear["id"]): boolean {
  if (id === "missilepod") return true;
  return MAGAZINE.includes(kind); // a sight or a magazine needs a gun
}

export function depthGear(room: number): { chance: number; max: number } {
  let row = RULES.gearDepth[0];
  for (const r of RULES.gearDepth) if (room >= r[0]) row = r;
  return { chance: row[1], max: row[2] };
}

export function makeGear(state: GameState, id: EnemyGear["id"]): EnemyGear {
  return { uid: uid(state, "g"), id, seen: false, revealed: false, checked: false, rechecked: false, cd: 0, last: -1 };
}

function rollIds(state: GameState, kind: UnitKind, n: number): EnemyGear["id"][] {
  const out: EnemyGear["id"][] = [];
  const pool = (Object.keys(GEAR) as EnemyGear["id"][]).filter((g) => allowed(kind, g));
  for (let i = 0; i < n && pool.length; i++) {
    const total = pool.reduce((t, g) => t + GEAR[g].weight, 0);
    let r = roll(state) * total;
    const g = pool.find((x) => (r -= GEAR[x].weight) < 0) ?? pool[0];
    out.push(g);
    pool.splice(pool.indexOf(g), 1);
  }
  return out;
}
export function stalkerGear(state: GameState, kind: UnitKind, n: number): EnemyGear["id"][] {
  return rollIds(state, kind, n);
}

export function discoveryChance(obv: number, id: EnemyGear["id"]): number {
  return Math.max(RULES.obvMin, Math.min(RULES.obvMax, RULES.obvBase + RULES.obvPer * obv - GEAR[id].conceal));
}

function check(state: GameState, u: Unit, g: EnemyGear) {
  const { obv, who } = partyObservation(state);
  if (chance(state, discoveryChance(obv, g.id))) {
    g.seen = true;
    g.revealed = true;
    log(state, `OBSERVED: ${GEAR[g.id].name.toUpperCase()} on the ${label(u.kind)}${who ? ` (${who})` : ""}. ${GEAR[g.id].text}`);
  }
}

/** Called once when an enemy first enters a fight. */
export function prepEnemy(state: GameState, u: Unit) {
  if (u.side !== "enemy") return;
  if (!u.gearRolled) {
    u.gearRolled = true;
    if (RANDOM_GEAR.includes(u.kind) && !u.temp) {
      const { chance: p, max } = depthGear(state.room);
      if (max > 0 && chance(state, p)) {
        const n = max > 1 && chance(state, 0.4) ? 2 : 1;
        u.gear = rollIds(state, u.kind, n).map((id) => makeGear(state, id));
      }
    }
  }
  if (u.ammo === undefined && MAGAZINE.includes(u.kind)) u.ammo = magazine(u);
  for (const g of u.gear ?? []) {
    if (g.checked) continue;
    g.checked = true;
    check(state, u, g);
  }
}
export function prepEnemies(state: GameState) {
  for (const u of living(state, "enemy")) prepEnemy(state, u);
}

/** A scouting action with a real cost: one more look at anything still hidden. */
export function rescan(state: GameState): number {
  let n = 0;
  for (const u of living(state, "enemy")) {
    for (const g of u.gear ?? []) {
      if (g.revealed || g.rechecked) continue;
      g.rechecked = true;
      n++;
      check(state, u, g);
    }
  }
  return n;
}

export function reveal(state: GameState, u: Unit, id: EnemyGear["id"], how: string) {
  const g = has(u, id);
  if (!g || g.revealed) return;
  g.revealed = true;
  log(state, `${how} ${label(u.kind)}: ${GEAR[id].name}. ${GEAR[id].text}`);
}

export function laserBonus(u: Unit | undefined): number {
  return u && has(u, "laser") ? RULES.laserBonus : 0;
}

/** Ordinary shots spend rounds. An empty magazine means the next turn goes to reloading. */
export function spendRound(state: GameState, u: Unit) {
  if (u.ammo === undefined) return;
  u.ammo = Math.max(0, u.ammo - 1);
  u.shots = (u.shots ?? 0) + 1;
  if (u.shots > RULES.magazine) reveal(state, u, "extmag", "It should have run dry by now. Extended Magazine on the");
  if (has(u, "laser")) reveal(state, u, "laser", "A red dot settled on its target before it fired. Laser Sight on the");
}
export function reload(state: GameState, u: Unit) {
  u.ammo = magazine(u);
  u.shots = 0;
  log(state, `${label(u.kind)} reloads.`);
}

/** After the unit's own action: the missile pod fires on its own schedule, never more than once a turn. */
export function missilePod(state: GameState, u: Unit, pickTarget: (u: Unit) => Unit | undefined, hit: number) {
  const g = has(u, "missilepod");
  if (!g || u.hp <= 0 || !state.units.includes(u) || u.cap || g.last === state.turn) return;
  g.last = state.turn;
  if (g.cd > 0) {
    g.cd -= 1;
    return;
  }
  const t = pickTarget(u);
  if (!t) return;
  g.cd = RULES.missilePodCooldown;
  reveal(state, u, "missilepod", "A rack on its shoulder fires: Add-On Missile Pod on the");
  if (chance(state, hit)) deal(state, t, RULES.missilePodDamage, `${label(u.kind)}'s missile pod`, { attackerUid: u.uid });
  else log(state, `The missile pod round goes wide.`);
}

/** One salvage roll per installed item, ever. A sight can become pilot equipment. */
export function salvageGear(state: GameState, u: Unit) {
  for (const g of u.gear ?? []) {
    if (!chance(state, RULES.gearSalvage)) continue;
    if (g.id === "laser") {
      state.items.push(newItem(state, "targeting"));
      log(state, "The Laser Sight comes off intact: Stabilized Targeting module for your pilots.");
    } else addScrap(state, 2, `Salvaged ${GEAR[g.id].name}`);
  }
}

export function gearLine(u: Unit): string {
  const known = (u.gear ?? []).filter((g) => g.revealed);
  return known.map((g) => `${GEAR[g.id].name}${g.id === "missilepod" ? (g.cd === 0 ? " READY" : ` ${g.cd}`) : ""}`).join(" · ");
}

void pick;
void is;
