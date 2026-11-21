
import {
  eventView,
  type GameState,
} from "../game/engine";
import { TeamBar } from "./Battle";
import { type Dispatch } from "./shared";

export function EventPanel({ state, dispatch }: { state: GameState; dispatch: Dispatch }) {
  const v = eventView(state);
  if (!v) return null;
  return (
    <section className="panel event">
      <h2>{v.title}</h2>
      {state.event?.id.startsWith("r8") && <TeamBar state={state} />}
      {v.screen && (
        <div className="pscreen" role="img" aria-label={`The Prisoner's screen shows ${v.screen.glyph}. ${v.screen.caption}`}>
          <div className={`pglyph ${v.screen.anim}`}>{v.screen.glyph}</div>
          <div className="pcaption">{v.screen.caption}</div>
        </div>
      )}
      {v.lines.map((l, i) => (
        <p key={i} className="hook">
          {l}
        </p>
      ))}
      <p className="muted">Energy {state.energy}{state.equip.cell ? ` · Cell ${state.equip.cell}` : ""} · Scrap {state.scrap}</p>
      <div className="col">
        {v.options.map((o) => (
          <button key={o.id} className="btn" disabled={!o.enabled} onClick={() => dispatch({ type: "event", option: o.id })}>
            {o.label}
            <small>{o.detail}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------- battle ----------
