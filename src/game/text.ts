// Story and choice text from the first slice, carried over verbatim.

export const SCARED_STORY = {
  title: "Something is breathing in the smoke",
  hook: "A light mech is folded against the wall, vents open, shaking so hard the plates chatter. It does not raise a weapon. The visor tracks Jubey and then the floor. Smoke pours from the shoulders like it has been holding its breath since the last crew died.",
  option: "Open the vents. Let them walk behind you.",
  take: "The rig stands. It does not speak. It takes the column to Jubey's left and keeps the gun low. You have a scared ally.",
};

export type ChoiceId =
  | "CHOICE_SCRAP_BAIT"
  | "CHOICE_ROCKET_MADNESS"
  | "CHOICE_COOLANT_SIPHON"
  | "CHOICE_SEALED_LOCKER"
  | "CHOICE_CUT_COMMS"
  | "CHOICE_FLARE_CHARGE";

export interface ChoiceDef {
  id: ChoiceId;
  title: string;
  hook: string;
  take: string;
  blurb: string;
}

export const CHOICES: ChoiceDef[] = [
  {
    id: "CHOICE_SCRAP_BAIT",
    title: "Cut the salvage tags",
    blurb: "+2 Scrap. 50% extra Infested this room.",
    hook: "The hall lights are dead. Something in a collapsed locker is ticking like a cooling reactor. Yellow salvage tags hang off a torn harness. Whatever wore it is not in the harness anymore.",
    take: "You rip the tags and bag the plates. Two clean Scrap. Behind you the ticking stops, then starts again from the ceiling tiles.",
  },
  {
    id: "CHOICE_ROCKET_MADNESS",
    title: "Take the rocket",
    blurb: "+1 Rocket ammo. +2 Madness.",
    hook: "A crate is wedged under a collapsed catwalk. The stencil says HEAP. The thing that was sitting on the crate is still there, folded wrong, visor facing the wall. It is holding the crate shut with both hands.",
    take: "You pry the fingers off. The visor turns. You see what was keeping the lid down. The rocket comes free. So does the picture of the hands.",
  },
  {
    id: "CHOICE_COOLANT_SIPHON",
    title: "Siphon the coolant",
    blurb: "Heal 1. +1 Threat.",
    hook: "A ruptured line is spraying pale coolant across the deck. It smells like church metal and rain. The puddle is deeper than it should be. Something downstream is still drawing from this pipe.",
    take: "You fill a reserve cell and dump it through the rig's heat sink. The cockpit stops tasting like blood. Far down the pipe, pumps kick on that should have been dead.",
  },
  {
    id: "CHOICE_SEALED_LOCKER",
    title: "Crack the sealed locker",
    blurb: "40% +1 RS. +1 Madness either way.",
    hook: "A locker is welded from the inside. Fresh welds. Someone did this recently and did not want it opened from this side.",
    take: "The crane splits the seam. Inside: a part that should not be that clean, or a shape that should not be that still. Either way you keep looking a second too long.",
  },
  {
    id: "CHOICE_CUT_COMMS",
    title: "Cut the comms cable",
    blurb: "-1 Threat. +8% Crazy this room.",
    hook: "A fat fiber trunk is still live, pulsing red status. The base is talking to itself. If you cut it, the talking stops. If you cut it, whatever was listening will come look for the break.",
    take: "The trunk dies with a smell of burnt dust. The hall goes quiet in a way halls should not. Something answers the quiet from the next junction.",
  },
  {
    id: "CHOICE_FLARE_CHARGE",
    title: "Pocket the flare charge",
    blurb: "+1 Energy this room. 25% extra Nightmare chance.",
    hook: "A flare charge is taped under a bench like an offering. Gold foil, church-issue, the kind they use in Decon. Someone left it where a person would have to kneel to take it.",
    take: "You take it. The foil leaves a gold print on the glove. For a second the hall is brighter than the lights allow. Then it is not.",
  },
];

