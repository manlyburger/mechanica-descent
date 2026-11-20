import { useState } from "react";
import { FRAME_FAULTS, ITEMS, PR, SPECS, TRAITS, P, type Action, type GameState } from "./game/engine";
import type { PilotRec } from "./game/state";

type Dispatch = (a: Action) => void;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const BANDS = P.BAND_NAMES;

function custodyText(state: GameState, r: PilotRec): string {
  if (r.custody === "ally") return "Crew";
  if (r.custody === "captive") {
    const c = state.captives.find((x) => x.pilot === r.id);
    const h = state.units.find((u) => u.uid === c?.holder);
    return `Captive${h ? `, held by the ${h.kind === "pod" ? "Containment Pod" : "Clampjaw"}` : ""}`;
  }
  return r.custody === "fleeing" ? "On the run" : r.custody === "dead" ? "Lost" : "Not yours";
}
function assignmentText(state: GameState, r: PilotRec): string {
  if (r.away) return `Separated (${r.away} room${r.away > 1 ? "s" : ""})`;
  if (r.assignment === "foot") return "On foot";
  const f = state.units.find((u) => u.uid === r.assignment);
  return f ? `In the ${f.chassis} frame` : "Unassigned";
}
const initials = (n: string) =>
  n
    .split(/\s+/)
    .map((x) => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export function Crew({ state, dispatch, onClose }: { state: GameState; dispatch: Dispatch; onClose: () => void }) {
  const people = state.roster.filter((r) => r.custody === "ally" || r.custody === "captive" || r.custody === "fleeing" || (r.custody === "dead" && r.history.length));
  const [sel, setSel] = useState<string | null>(people[0]?.id ?? null);
  const r = people.find((x) => x.id === sel) ?? null;
  const frames = state.units.filter((u) => u.kind === "frame" && u.side === "friendly" && u.hp > 0);
  const live = P.OUT_OF_FIGHT.includes(state.phase);
  return (
    <div className="crew" role="dialog" aria-label="Crew">
      <div className="crewbar">
        <b>CREW</b>
        <span>
          Cockpit Parts {state.parts}/{PR.slot4Parts} · {state.items.length} item{state.items.length === 1 ? "" : "s"}
        </span>
        <button className="help" onClick={onClose}>
          close
        </button>
      </div>
      {!live && <div className="crewnote">{state.phase === "player" ? "Mid-fight: view only. Changes wait until the shooting stops." : "Finish the choice in front of you first. View only for now."}</div>}
      <div className="roster">
        {people.map((p) => (
          <button key={p.id} className={`rostercard ${p.id === sel ? "sel" : ""} ${p.custody}`} onClick={() => setSel(p.id)}>
            <span className="face">{initials(p.name)}</span>
            <span className="rname">{p.name}</span>
            <span className="rmeta">
              Lv {p.level} · {p.spec}
            </span>
            <span className={`rband b${P.band(p.loyalty)}`}>{p.custody === "dead" ? "Lost" : BANDS[P.band(p.loyalty)]}</span>
            <span className="rmeta">
              {p.custody === "captive" ? "Captive" : p.custody === "ally" ? "Crew" : p.custody === "fleeing" ? "Running" : "—"}
              {P.madnessTotal(p) ? ` · Mad ${P.madnessTotal(p)}%` : ""} · {p.slots.filter(Boolean).length}/{P.slotCount(p)}
            </span>
          </button>
        ))}
        {!people.length && <div className="muted">Nobody yet. Capture a pilot, or take in someone you find running.</div>}
      </div>
      {r && <PilotSheet key={r.id} state={state} r={r} dispatch={dispatch} live={live} frames={frames} />}
      {frames.length > 0 && (
        <div className="crewsec">
          <div className="lane-label">FRAMES</div>
          {frames.map((f) => (
            <div key={f.uid} className="sheet-line">
              {P.frameText(f)} {f.pilot ? `Pilot: ${P.rec(state, f.pilot)?.name}.` : "Empty."}
            </div>
          ))}
        </div>
      )}
      {state.items.length > 0 && (
        <div className="crewsec">
          <div className="lane-label">INVENTORY</div>
          {state.items.map((it) => (
            <div key={it.uid} className="sheet-line">
              <b>{ITEMS[it.id].name}</b> <span className="muted">({ITEMS[it.id].side === "captive" ? "captive" : "crew"} {ITEMS[it.id].cat}{it.charges !== undefined ? `, ${it.charges} charges` : ""})</span> {ITEMS[it.id].text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PilotSheet({ state, r, dispatch, live, frames }: { state: GameState; r: PilotRec; dispatch: Dispatch; live: boolean; frames: GameState["units"] }) {
  const [slot, setSlot] = useState<number | null>(null);
  const [why, setWhy] = useState(false);
  const act = (op: string, extra: Record<string, unknown> = {}) => dispatch({ type: "pilot", id: r.id, op, ...extra } as Action);
  const block = (op: string, extra: Record<string, unknown> = {}) => (live ? P.pilotOpBlock(state, r, op, extra) : "not now");
  const b = P.band(r.loyalty);
  const nextXp = PR.xpFor[Math.min(PR.maxLevel, r.level + 1)];
  const skill = P.statOf(r, "skill");
  const mine = r.custody === "ally" || r.custody === "captive";
  const barrier = mine && b <= 1;
  const cap = P.statCap(r.level);

  const btn = (op: string, label: string, detail: string, extra: Record<string, unknown> = {}) => {
    const no = block(op, extra);
    return (
      <button key={op + label} className="btn mini" disabled={!!no} onClick={() => act(op, extra)}>
        {label}
        <small>{no ?? detail}</small>
      </button>
    );
  };

  return (
    <div className="psheet">
      <div className="phead">
        <span className="face big">{initials(r.name)}</span>
        <div>
          <b>{r.name}</b>
          <div className="rmeta">
            Level {r.level} · XP {r.xp}
            {r.level < PR.maxLevel ? `/${nextXp}` : " (max)"} · {r.spec} · {TRAITS[r.trait]?.name}
          </div>
          <div className="rmeta">
            {r.origin} · {custodyText(state, r)} · {assignmentText(state, r)}
          </div>
        </div>
      </div>

      <div className="lane-label">EQUIPMENT</div>
      <div className="slots">
        {[0, 1, 2, 3].map((i) => {
          const it = r.slots[i];
          const locked = i === 3 && !r.slot4;
          return (
            <button key={i} className={`slot ${slot === i ? "sel" : ""} ${locked ? "locked" : ""}`} onClick={() => setSlot(slot === i ? null : i)}>
              <span className="snum">{i + 1}</span>
              {locked ? <span className="sname">Locked</span> : it ? <span className="sname">{ITEMS[it.id].name}</span> : <span className="sname muted">empty</span>}
              {it?.charges !== undefined && <span className="rmeta">{it.charges} left</span>}
            </button>
          );
        })}
      </div>
      {slot === 3 && !r.slot4 && btn("unlock", "Unlock slot 4", `Spend ${PR.slot4Parts} Cockpit Parts. It stays with ${r.name}.`)}
      {slot !== null && (slot < 3 || r.slot4) && (
        <div className="choose">
          {r.slots[slot] && (
            <>
              <div className="sheet-line">
                <b>{ITEMS[r.slots[slot]!.id].name}:</b> {ITEMS[r.slots[slot]!.id].text}
              </div>
              {btn("unequip", "Remove", "Back to the inventory.", { slot })}
            </>
          )}
          {state.items.map((it) => {
            const no = live ? P.cannotEquip(r, it, slot) : "not now";
            if (no && /take|crew take/.test(no)) return null;
            const cur = r.slots[slot];
            return (
              <button key={it.uid} className="btn mini" disabled={!!no} onClick={() => act("equip", { item: it.uid, slot })}>
                {cur ? `Replace with ${ITEMS[it.id].name}` : `Fit ${ITEMS[it.id].name}`}
                <small>{no ?? ITEMS[it.id].text}</small>
              </button>
            );
          })}
        </div>
      )}

      <div className="lane-label">STATS{r.points ? ` · ${r.points} point${r.points > 1 ? "s" : ""} to spend (cap ${cap})` : ""}</div>
      <div className="stats">
        {(["mental", "skill", "endurance"] as const).map((s) => (
          <div key={s} className="statrow">
            <span className="sname">
              {s[0].toUpperCase() + s.slice(1)} <b>{P.statOf(r, s)}</b>
            </span>
            <span className="rmeta">
              {s === "mental" && `Madness penalties −${pct(P.madnessReduction(r))} · Nightmare: ${pct(P.nightmareResist(r))} to ignore 1`}
              {s === "skill" && `Accuracy +${pct(P.accuracy(state, r))} · checks ${[4, 6, 8, 10].map((t) => `${t}${skill >= t ? "✓" : "✗"}`).join(" ")}`}
              {s === "endurance" && `${pct(P.damageResist(r))} to ignore 1 · ${pct(P.deathAvoid(r))} to survive a killing blow`}
            </span>
            {r.points > 0 && (
              <button className="plus" disabled={!!block("stat", { stat: s })} onClick={() => act("stat", { stat: s })} aria-label={`raise ${s}`}>
                +
              </button>
            )}
          </div>
        ))}
        <div className="statrow">
          <span className="sname">
            HP <b>{Math.max(0, r.hp)}/{P.maxHp(r)}</b>
          </span>
          <span className="rmeta">
            Madness {P.madnessTotal(r)}%{r.recovering ? ` (${r.recovering}% fading, −${PR.recoverPerTurn} a turn)` : ""} · {pct(P.misfire(r))} chance to freeze
          </span>
        </div>
        <div className="rmeta">
          {r.spec}: {SPECS[r.spec as keyof typeof SPECS].text} Frames: {SPECS[r.spec as keyof typeof SPECS].frames.join(", ")}.
        </div>
      </div>

      {mine && (
        <>
          <div className="lane-label">LOYALTY</div>
          <div className="loyal">
            <div className="lbar">
              <span className={`lfill b${b}`} style={{ width: `${r.loyalty}%` }} />
            </div>
            <div className="sheet-line">
              <b className={`rband b${b}`}>{BANDS[b]}</b> {TRAITS[r.trait]?.note}
            </div>
            {b === 2 ? P.expectations(state, r).map((x) => <div key={x} className="sheet-line">· {x}</div>) : b < 4 && <div className="sheet-line">{P.estimate(state, r)}</div>}
            {r.custody === "captive" && (
              <div className="sheet-line">
                Escape strain: {P.has(r, "statusrelay") ? `${r.strain}/100` : r.strain >= PR.strainWarn ? "RESTLESS" : "no sign"}
                {P.has(r, "diagrelay") ? ` · next room about ${Math.min(100, r.strain + Math.max(0, PR.strainBase[b] - r.slots.reduce((n, x) => n + (x ? ITEMS[x.id].strain ?? 0 : 0), 0)))}` : ""}
              </div>
            )}
          </div>
        </>
      )}

      {mine && (
        <>
          <div className="lane-label">ASSIGNMENT</div>
          <div className="assignwrap">
            <div className={`assign ${barrier ? "blocked" : ""}`}>
              {btn("assign", "Unassigned", r.custody === "captive" ? "Stays in custody." : "Stays back.", { target: "" })}
              {btn("assign", "On foot", "Fights beside the rig with their personal weapon.", { target: "foot" })}
              {frames.map((f) => btn("assign", `${(f.chassis ?? "frame")[0].toUpperCase() + (f.chassis ?? "frame").slice(1)} frame${f.pilot && f.pilot !== r.id ? ` (now ${P.rec(state, f.pilot)?.name})` : ""}`, `${f.hp}/${f.maxHp} HP${SPECS[r.spec as keyof typeof SPECS].frames.includes(f.chassis as "light") ? "" : " · untrained: −2 Skill"}${f.faults?.length ? ` · ${f.faults.map((x) => FRAME_FAULTS[x].name).join(", ")}` : ""}`, { target: f.uid }))}
            </div>
            {barrier && (
              <button className="barrier" onClick={() => setWhy(!why)} aria-expanded={why}>
                <span className="lock">⚠</span>
                <span>UNWILLING — ASSIGNMENT RESTRICTED</span>
                <small>tap for why</small>
              </button>
            )}
          </div>
          {barrier && why && (
            <div className="explain">
              <div className="sheet-line">
                <b>Why:</b> {r.name} is {BANDS[b]} ({r.loyalty}/100). Voluntary assignments open at Partially Willing (45).
              </div>
              <div className="sheet-line">
                <b>What helps:</b> talking (once a room, gag off), treating injuries, an agreement not to send them against their section, and time spent without harsh restraints.
              </div>
              <div className="sheet-line">
                <b>Estimate:</b> {P.estimate(state, r)}
              </div>
              <div className="sheet-line">Custody and equipment can still be managed from this screen.</div>
            </div>
          )}

          <div className="lane-label">ACTIONS</div>
          <div className="col">
            {r.custody === "captive" && btn("talk", "Talk to them", "A cooperation opportunity. Once a room. Not through a gag.")}
            {btn("treat", "Treat injuries", "A medkit charge: heal 2." + (r.custody === "captive" && r.injuredUntreated ? " Earns trust." : ""))}
            {r.custody === "captive" && P.isTeam(r) && btn("agree", "Promise: never against their section", "Earns trust now. Break it and they will remember.")}
            {r.custody === "captive" && btn("recruit", "Offer a place on the crew", "From Cooperative. Restraints come off; crew gear goes on.")}
            {r.custody === "captive" && btn("tighten", "Tighten restraints", `${PR.tightenScrap} Scrap at a Tech Stop: −${PR.tightenAmount} escape strain.`)}
          </div>
        </>
      )}

      {r.history.length > 0 && (
        <>
          <div className="lane-label">HISTORY</div>
          {r.history.map((h, i) => (
            <div key={i} className="sheet-line">
              {h}
            </div>
          ))}
          <div className="rmeta">
            {r.sorties} sortie{r.sorties === 1 ? "" : "s"} · {r.kills} kill{r.kills === 1 ? "" : "s"}
          </div>
        </>
      )}
    </div>
  );
}
