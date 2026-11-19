// Radio dialogue for Relay Section R-8 (PROPOSED name, not canon) and the
// Prisoner's screen. Lines marked in the brief are carried over verbatim.

export type Role = "needleback" | "latchback" | "widow" | "kilnheart" | "bishop";

export const CALLSIGN: Record<Role | "system", string> = {
  needleback: "Needleback",
  latchback: "Latchback",
  widow: "Widow",
  kilnheart: "Kilnheart",
  bishop: "Bishop",
  system: "System",
};

export const PILOT_ID: Record<Role, string> = {
  needleback: "p-needle",
  latchback: "p-latch",
  widow: "p-widow",
  kilnheart: "p-kiln",
  bishop: "p-bishop",
};

export type Line = [Role | "system", string];

/** key -> exchange. Each key is spoken at most once per run. */
export const RADIO: Record<string, Line[]> = {
  "ep1-contact": [
    ["needleback", "Contact confirmed. Requesting instructions."],
    ["bishop", "Maintain distance. Report their equipment."],
  ],
  "ep1-withdraw": [
    ["needleback", "They're closing! I'm withdrawing!"],
    ["bishop", "Preserve the pilot. We can replace the frame."],
  ],
  "ep2-recovery": [
    ["widow", "Recovery route clear. Deploying tow claws."],
    ["bishop", "Bring back whoever you can."],
    ["widow", "And the frames?"],
    ["bishop", "Pilots first. Machinery second."],
  ],
  "ep3-brawler": [
    ["latchback", "You're the one taking our machines apart?"],
    ["bishop", "Do not engage without support."],
    ["latchback", "Too late."],
  ],
  "ep4-furnace": [
    ["kilnheart", "Reactor temperature climbing."],
    ["bishop", "Eject before it reaches critical."],
    ["kilnheart", "Negative. I can still hold them."],
    ["bishop", "That's an order!"],
  ],
  "widow-lost": [
    ["needleback", "Where's recovery?"],
    ["bishop", "There is no recovery. Reach the exit on your own."],
  ],
  "latch-captured": [
    ["bishop", "Brawler, acknowledge."],
    ["system", "PILOT UNAVAILABLE."],
    ["bishop", "…Understood. Changing formation."],
  ],
  "bishop-cornered": [
    ["bishop", "I'm not dying in this machine."],
    ["system", "COCKPIT RELEASE READY."],
    ["bishop", "Section, cover my withdrawal."],
  ],
  "bishop-wedged": [
    ["system", "COCKPIT RELEASE OBSTRUCTED."],
    ["bishop", "What? No—remove it! NOW!"],
  ],
  "bishop-leverage": [["bishop", "You've taken enough of my people. What do you want?"]],
  "kiln-blast": [["bishop", "Kilnheart, respond. …Section, nobody goes near that wreck."]],
  "bishop-down": [["system", "COMMAND CHANNEL: NO CARRIER."]],
};

/** Lines a wedged pilot sends. The Wedge never stops a transmission. */
export const WEDGED_DISTRESS = [
  "Hatch is jammed. Something is in the release track!",
  "Section, I can't get out. Somebody get this off me.",
  "Still here. Still fighting. Get me recovery.",
];

// ---------- The Prisoner That Repairs Itself ----------
// It never produces an intelligible word. Its screen shows ellipses and
// punctuation only; captions describe the sound so nothing depends on audio.

export interface Tell {
  glyph: string;
  anim: "slow" | "fast" | "still" | "pulse" | "flicker" | "bright";
  caption: string;
  motion: string;
}

export const STAGE_TELL: Tell[] = [
  { glyph: "…", anim: "slow", caption: "[low mechanical hum]", motion: "Almost no movement. Something small is working under the armor." },
  { glyph: "… …", anim: "slow", caption: "[small metallic clicks, a muffled murmur]", motion: "Fingers flex. A shoulder shifts. One restraint draws tight." },
  { glyph: "……", anim: "pulse", caption: "[rhythmic pressure pulses, getting deliberate]", motion: "One restraint has started to bend." },
  { glyph: "…!", anim: "fast", caption: "[a long muffled protest, then a sharp clamp noise]", motion: "It braces and twists against the bands." },
  { glyph: "…!!", anim: "bright", caption: "[metal snapping, pressure release, a muffled burst]", motion: "A restraint lets go." },
];

export type Intent = "repair" | "break" | "feign" | "rest" | "sabotage" | "trap" | "desperate";

export const INTENT_TELL: Record<Intent, Tell> = {
  repair: { glyph: "…", anim: "slow", caption: "[repeated internal welding clicks]", motion: "Light moves behind a seam in its chest plating." },
  break: { glyph: "… …!", anim: "fast", caption: "[clamp strain, a shoulder twisting]", motion: "It is working one arm against the band, hard." },
  feign: { glyph: "……", anim: "still", caption: "[mechanical activity stops. one tiny muffled sound]", motion: "It has gone completely still. The restraints look stable." },
  rest: { glyph: "……", anim: "still", caption: "[mechanical activity stops. one tiny muffled sound]", motion: "It has gone completely still. The restraints look stable." },
  sabotage: { glyph: "…!", anim: "pulse", caption: "[tapping, close to the Pod controls]", motion: "Two fingers have found the edge of the control housing." },
  trap: { glyph: "…?", anim: "flicker", caption: "[faint sensor chatter near the data port]", motion: "Its head has turned a few degrees toward the Tap connection." },
  desperate: { glyph: "…!!", anim: "bright", caption: "[rapid, uneven rattling]", motion: "Every joint is straining at once." },
};
