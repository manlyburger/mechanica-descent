import { RULES } from "../game/data";
import { PROX_NAMES, captiveOf, integrityBand, whyNotRestrainable, P, PT, gearLine, type GameState, type Unit } from "../game/engine";
import { SHORT } from "./shared";

export function planText(state: GameState, u: Unit): string {
  const p = u.plan;
  if (!p) return "";
  const t = state.units.find((x) => x.uid === p.targetUid);
  const at = t ? SHORT[t.kind] : "—";
  if (p.type === "attack") return `${p.note ? p.note + ": " : ""}shot ${p.dmg} → ${at}`;
  if (p.type === "missile") return `MISSILE ${p.dmg} → ${at}`;
  if (p.type === "disabled") return u.foam ? "foamed" : (u.sealed ?? 0) > 0 ? `sealed ${u.sealed}` : "stunned";
  if (p.type === "eject") return p.note ?? "PREPARING TO EJECT";
  if (p.type === "detonate") return "REACTOR FAILURE THIS TURN";
  if (p.type === "reload") return "RELOADING";
  return p.note ?? p.type;
}

export function statusLines(state: GameState, u: Unit): string[] {
  const s: string[] = [];
  if (u.side === "enemy") {
    if (u.cap) s.push(`${u.cap.state === "secured" ? "SECURED" : "BEING SECURED"} · restraint ${integrityBand(u.cap.integrity)}${u.cap.bands ? ` · ${u.cap.bands} band${u.cap.bands > 1 ? "s" : ""}` : ""}`);
    s.push(planText(state, u));
    if (u.prox !== undefined) s.push(PROX_NAMES[u.prox]);
    if (u.pilot) s.push(u.kind === "capsule" ? "pilot inside" : "pilot aboard");
    else if (["needleback", "latchback", "widow", "kilnheart", "bishop"].includes(u.kind)) s.push("no pilot");
    if ((u.wedge ?? 0) > 0) s.push(`COCKPIT WEDGED ${u.wedge}`);
    if (u.kind === "kilnheart") s.push(`reactor ${["stable", "HEATED", "CRITICAL"][u.heat ?? 0]}${(u.heat ?? 0) >= 2 ? `: detonates in ${u.fuse}` : ""}`);
    if (u.kind === "capsule" && u.exitIn !== undefined) s.push(u.flying ? "airborne: crane and hook cannot reach" : "on the floor");
    if (u.replacement) s.push("replacement frame");
    if (u.guardBy) s.push("covered by the Brawler");
    if (u.missiles > 0) s.push(`lock ${u.lock}/2`);
    if (u.plan?.laser && u.plan.targetUid) s.push(`red dot on ${SHORT[state.units.find((x) => x.uid === u.plan!.targetUid)?.kind ?? "jubey"]}`);
    const mods = gearLine(u);
    if (mods) s.push(mods);
    const parts = PT.partLine(u);
    if (parts) s.push(parts);

    if (u.ammo !== undefined && u.ammo <= 1) s.push(u.ammo === 0 ? "magazine empty" : "last round");
    if (u.kind === "capsule" && u.occupant === "empty") s.push("hatch open");
    if (u.note && !u.note.includes("tapped")) s.push(u.note);
    const why = whyNotRestrainable(u);
    if (why && why !== "not a machine") s.push(why);
  }
  if (u.leech) s.push(`${u.leech.temp ? "offspring " : ""}leech ${u.leech.count}/${RULES.leechMax}`);
  if (u.armor > 0) s.push(`armor ${u.armor}: −${u.armor} per hit`);
  const cover = PT.coverFrom(state, u);
  if (cover) s.push(`in cover (${SHORT[cover.kind]}): −1 per shot`);
  if (u.weak) s.push("exposed: takes +1");
  if (u.burn) s.push(`burning ${u.burn}`);
  if (u.side === "friendly") {
    if (u.malf === "wrongRepair") s.push("MALFUNCTION: will repair an enemy");
    if (u.malf === "uncontrolled") s.push("UNCONTROLLED");
    if (u.malf === "hostile") s.push("HOSTILE STARTUP");
    if (u.foam) s.push("foamed");
    if ((u.sealed ?? 0) > 0) s.push(`sealed ${u.sealed}`);
    if (u.kind === "builder") s.push(u.jammed ? "jammed" : (u.timer ?? 0) <= 1 ? "job due" : `job in ${u.timer}`);
    if (u.order) s.push(`order: ${u.order}`);
    if (u.kind === "warframe" && u.inert) s.push(`startup ${u.progress ?? 0}/${RULES.warframeNeed}${u.paused ? " paused" : ""}`);
    if (u.kind === "shepherd") s.push(`hauling ${u.carried ?? 0}/${RULES.shepherdPair}${u.secured ? " secured" : ""}${u.feed ? " → frame" : ""}${u.hold ? " holding" : ""}`);
    if (u.kind === "possum") s.push(u.shutdown ? "playing dead" : `takings ${u.carried ?? 0}`);
    if (u.kind === "walker") s.push(u.elevated ? "overhead" : "on the floor");
    if (u.kind === "jack") s.push(u.protect ? `guards ${SHORT[state.units.find((x) => x.uid === u.protect)?.kind ?? "jubey"]}${u.intercepted ? " (spent)" : ""}` : "no ward");
    if (u.kind === "gunnest") s.push(u.clamp ? "clamped +2" : "crawling");
    if (u.bolting) s.push("PULLING AWAY");
    if (u.kind === "frame") {
      const r = P.rec(state, u.pilot);
      s.push(`${u.chassis} frame${r ? ` · ${r.name}, ${Math.round(P.frameHit(state, r, u) * 100)}% to hit` : " · EMPTY"}`);
      if (u.faults?.length) s.push(u.faults.join(", "));
    }
    if (u.kind === "pilot") {
      const r = P.rec(state, u.pilot);
      if (r) s.push(`${P.weapon(r)?.name ?? "unarmed"} · ${P.BAND_NAMES[P.band(r.loyalty)]}${P.madnessTotal(r) ? ` · Mad ${P.madnessTotal(r)}%` : ""}`);
    }
    if (u.kind === "clampjaw" || u.kind === "pod") {
      const c = captiveOf(state, u.uid);
      const field = state.units.find((x) => x.cap?.by === u.uid);
      s.push(c ? `holding ${c.label}` : field ? `clamped on ${SHORT[field.kind]}` : u.apprehend ? "moving in" : "empty");
      if (u.kind === "pod" && c) s.push(`seal ${integrityBand(u.podIntegrity ?? 100)}${u.powerOff ? " · POWER CUT" : ` · upkeep in ${RULES.podUpkeepTurns - (u.occupied ?? 0)}`}`);
    }
    if (u.kind === "bulkhead") s.push(`covers ${SHORT[state.units.find((x) => x.uid === u.guards)?.kind ?? "jubey"]}`);
    if (u.roomsLeft !== undefined) s.push(`${u.roomsLeft} fight${u.roomsLeft > 1 ? "s" : ""} left`);
    if ((u.ward ?? 0) > 0) s.push(`prevents ${u.ward}`);
    if (u.mood && s.length < 3) s.push(u.mood);
  }
  return s.filter(Boolean);
}

export function Token({ unit, state, target, open, onClick }: { unit: Unit; state: GameState; target?: boolean; open?: boolean; onClick?: () => void }) {
  const self = unit.side === "friendly";
  const lines = statusLines(state, unit);
  const alert = unit.plan?.type === "missile" || unit.plan?.type === "eject" || unit.plan?.type === "detonate" || !!unit.malf || (unit.heat ?? 0) >= 2;
  const cls = ["token", unit.kind, self ? "self" : "", unit.crazy ? "crazy" : "", target ? "target" : "", open ? "open" : "", alert ? "missile" : "", unit.foam || (unit.sealed ?? 0) > 0 ? "muted-unit" : "", unit.elevated ? "elevated" : "", unit.prox ? `prox-${unit.prox}` : "", unit.cap ? "restrained" : "", unit.flying ? "flying" : ""].join(" ");
  return (
    <button className={cls} onClick={onClick}>
      <div className="tn">
        {(unit.kind === "frame" || unit.kind === "pilot" || (unit.kind === "capsule" && unit.role === "runner")) && unit.pilot ? P.rec(state, unit.pilot)?.name ?? SHORT[unit.kind] : SHORT[unit.kind]}
        {unit.crazy ? " ✱" : ""}
        {unit.leech ? " ⛭" : ""}
        {unit.pilot && unit.side === "enemy" ? " ●" : ""}
        {unit.stalkerId ? " ◆" : ""}
      </div>
      {(unit.gear ?? []).some((g) => g.revealed) && (
        <div className="gearicons" aria-label={gearLine(unit)}>
          {(unit.gear ?? []).filter((g) => g.revealed).map((g) => (
            <span key={g.uid} className={`gi ${g.id}${g.id === "missilepod" && g.cd === 0 ? " ready" : ""}`}>
              {g.id === "missilepod" ? "⇈" : g.id === "extmag" ? "▮▮" : "◎"}
            </span>
          ))}
        </div>
      )}
      {unit.plan?.laser && <div className="laserdot" aria-hidden="true" />}
      {unit.prox !== undefined && unit.prox > 0 && !unit.cap && <div className="proxtag">{unit.prox >= RULES.proxEngaged ? "IN REACH" : "CLOSING"}</div>}
      {unit.cap && <div className="proxtag cap">{unit.cap.state === "secured" ? "SECURED" : "SECURING"}</div>}
      <div className="th">
        {unit.hp}/{unit.maxHp}
        {unit.armor > 0 ? ` ◈${unit.armor}` : ""}
        {unit.kind === "jubey" && state.block > 0 ? ` +${state.block}` : ""}
        {unit.burn ? ` 🔥${unit.burn}` : ""}
      </div>
      <div className="ti">{lines[0] ?? ""}</div>
    </button>
  );
}

// ---------- between fights ----------
