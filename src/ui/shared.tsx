import { useState } from "react";
import { CARDS, cardName, cardText, type CardId, type UnitKind } from "../game/data";
import { type Action } from "../game/engine";

export type Dispatch = (a: Action) => void;

export const newSeed = () => (Date.now() % 99991) + 1;

export const pct = (n: number) => `${Math.round(n * 100)}%`;

export const SHORT: Record<UnitKind, string> = {
  jubey: "Jubey", light: "Light", lvl2: "Level 2", infested: "Infested", scared: "Scared", drone: "Drone", zombie: "Zombie",
  rifleman: "Rifle", powered: "P. Armor", patient: "Patient", robobuddy: "Buddy", builder: "Builder", possum: "Possum", gunnest: "Nest",
  bulkhead: "Bulkhead", beacon: "Beacon", shepherd: "Shepherd", walker: "Walker", jack: "Panic Jack", warframe: "Warframe",
  clampjaw: "Clampjaw", pod: "Pod", needleback: "Courier", latchback: "Brawler", widow: "Widow", kilnheart: "Breaker",
  bishop: "Bishop", capsule: "Capsule", relay: "Relay", prisoner: "Prisoner", frame: "Frame", pilot: "Pilot",
  hunter: "Hunter", tracker: "Recon", predator: "Predator", nightmare: "Nightmare", deadframe: "Dead Frame", mimic: "Imitation", casket: "CASKET-13",
};

export function Chip({ k, v, hot }: { k: string; v: string; hot?: boolean }) {
  return (
    <span className={`chip ${hot ? "hot" : ""}`}>
      <em>{k}</em> {v}
    </span>
  );
}

export function CardView({ card, selected, dim, big, onClick, disabled }: { card: { id: CardId; variant?: string; rounds?: number }; selected?: boolean; dim?: boolean; big?: boolean; onClick?: () => void; disabled?: boolean }) {
  const d = CARDS[card.id];
  const cls = ["card", selected ? "sel" : "", dim ? "dim" : "", big ? "big" : "", d.cats.includes("Nightmare") ? "night" : "", d.deploys ? "machine" : "", d.exhaust || card.rounds !== undefined ? "ammo" : ""].join(" ");
  return (
    <button className={cls} onClick={onClick} disabled={disabled}>
      <span className="costs">
        {!d.unplayable && <span className="cost">{d.cost}</span>}
        {d.scrap ? <span className="scrapcost">{d.scrap}S</span> : null}
      </span>
      <span className="cname">{cardName(card.id, card.variant)}</span>
      <span className="ctext">{big ? cardText(card.id, card.variant) : d.cats[0]}</span>
    </button>
  );
}

/** Radio chatter, sound captions and debug lines: shown only when asked for. */
export function isFlavor(line: string): boolean {
  if (line.startsWith("SIGNAL ANOMALY") || line.startsWith("CONDUCTOR")) return false; // Nightmare transmissions are information, not chatter
  return line.includes("“") || line.startsWith("[") || line.startsWith("QA ");
}
const isMarker = (line: string) => line.startsWith("— ");

/** Newest first, split at turn and room markers. */
export function logGroups(lines: string[]): { title: string; lines: string[] }[] {
  const out: { title: string; lines: string[] }[] = [];
  let cur: string[] = [];
  for (const l of lines) {
    if (isMarker(l)) {
      out.push({ title: l.replace(/—/g, "").trim(), lines: cur });
      cur = [];
    } else cur.push(l);
  }
  if (cur.length) out.push({ title: "Earlier", lines: cur });
  return out.filter((g) => g.lines.length > 0);
}

/** The log, grouped by turn: the latest turn open, earlier turns folded, flavor hidden unless asked for. */
export function Log({ lines }: { lines: string[] }) {
  const [flavor, setFlavor] = useState(false);
  const groups = logGroups(lines)
    .map((g) => ({ ...g, all: g.lines.length, lines: flavor ? g.lines : g.lines.filter((l) => !isFlavor(l)) }))
    .filter((g) => g.lines.length > 0);
  const hidden = lines.filter(isFlavor).length;
  return (
    <aside className="log">
      <div className="logbar">
        <span>Log</span>
        {(hidden > 0 || flavor) && (
          <button className="btn mini ghost" onClick={() => setFlavor(!flavor)}>
            {flavor ? "Hide chatter" : `Show chatter (${hidden})`}
          </button>
        )}
      </div>
      {groups.map((g, i) =>
        i === 0 ? (
          <section key={i} className="loggroup open">
            <div className="logtitle">{g.title === "Earlier" ? "Latest" : g.title}</div>
            {g.lines.map((l, j) => (
              <div key={j} className={isFlavor(l) ? "flavor" : undefined}>
                {l}
              </div>
            ))}
          </section>
        ) : (
          <details key={i} className="loggroup">
            <summary>
              {g.title} · {g.lines.length} line{g.lines.length > 1 ? "s" : ""}
            </summary>
            {g.lines.map((l, j) => (
              <div key={j} className={isFlavor(l) ? "flavor" : undefined}>
                {l}
              </div>
            ))}
          </details>
        ),
      )}
    </aside>
  );
}
