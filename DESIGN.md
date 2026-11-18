# Mechanica Descent — build notes (v0.3)

Rules, numbers and card text live in `src/game/data.ts`. Every value the briefs mark TUNE LATER is a field in `RULES`.

| File | What it holds |
| --- | --- |
| `src/game/data.ts` | Rules, unit stats and tags, all card definitions, variants |
| `src/game/text.ts` | Original story and choice text, verbatim |
| `src/game/state.ts` | State shape and actions |
| `src/game/core.ts` | Damage, destruction, wreckage, Leech, reactions, ally and enemy behavior |
| `src/game/cards.ts` | Playing cards, unit commands |
| `src/game/events.ts` | Wrong Hallway and its rooms, Patient Machine, Assembly Yard, Drone Remembers |
| `src/game/engine.ts` | Room flow, Decon, turns, reducer, legal actions, QA hooks |
| `src/game/bot.ts` | Heuristic bot (sim) and random bot (fuzz) |
| `src/game/tests/` | 93 tests: the briefs' scenarios, invariants under random play, save/reload |

## What v0.3 adds

### Go deeper or get clean (overhaul idea 2)

- The descent is open-ended. A Decon Bay follows every 4th room.
- At Decon you either walk out (the run ends as a win and the room number is recorded as your best) or go deeper.
- Going deeper clears Contamination, heals 2, and starts a harder leg: +1 guaranteed Light per leg, the existing room 5+ tables, Zombie Mechs from room 6.
- Contamination: +1 per Infested hit on Jubey, +1 per room entered past the first Decon. Every 3 points adds one unplayable Contaminated Seal to each fight (max 3). At 9+ the Infested always hunt Jubey. Only Decon clears it. Jubey's token stains as it rises.
- Dying past a Decon records nothing.

### Starting loadout

One of three, chosen before room 1:

- **Shabby Lootbox**: one random basic item card (Fuel Canister, Flare, Maintenance Foam, Go Quiet, Crane Hook) and 1 Scrap.
- **AM Mine**: an auto-deploy card. Deploys itself every fight; after turn 1 the first enemy machine to enter or advance takes 2. Consumed when it fires. The rack holds 2 auto-deploy cards; spare mines can turn up as rewards.
- **Lil Robobuddy**: 2 HP ally. At the end of each fight it collects one wreck for 1 Scrap with no Threat and no Teeth.

### Armor and Powered Armor (Prompt 5)

- **Armor** deducts 1 per point from every instance of damage: card hits, ally shots, burn ticks, the mine, splash. A 1-damage hit on 1 Armor does nothing.
- **Powered Armor**: enemy, 3 HP, 1 Armor, 1 damage. Decisions made here, not in the prompt: it is an enemy, it hits for 1, it can join any pack from room 2 at 20%, it leaves a wreck and can host a Leech.
- Sim cost of adding it: 3 to 9 points off the first-Decon rate, depending on loadout.

### Brief 1: card expansion and encounters

All 12 base cards, all 7 variants, Wrong Hallway with its 5 navigation choices and 4 events, The Hallway That Eats Machines, The Drone Remembers, enemy Leech counterplay, and the behavior tags.

### Brief 2: improvised army and machine encounters

All 9 cards, The Patient Machine, The Assembly Yard, Assembly Line, coordinated commands, and the enemy responses to machine-heavy play.

## How the briefs were fitted to this game

The briefs say to implement the smallest compatible equivalent where a concept is not supported. These are those equivalents.

| Brief concept | In this build |
| --- | --- |
| Scrap costs | Machine and equipment cards cost Scrap to play, not Energy. A misfire refunds the Scrap. |
| Ally persistence | Machine allies stay between rooms while alive; their card stays bound to them and returns when they are destroyed. Structures (Bulkhead, Beacon, Gun Nest) last one fight. |
| Positions and movement | One lane of 6 columns per side. Gun Nest crawls one column a turn and clamps when it lines up. Builder's Instinct is "next job goes to the wreck". |
| Cover and line of sight | A Bulkhead covers one chosen ally. No enemy has cover yet, so the Ceiling Walker's "ignores ground cover" has nothing to ignore; its overhead rule is that melee enemies (Infested, Zombie) cannot target it. |
| Armor | A real stat (Prompt 5): each point deducts 1 from every instance of damage, to a minimum of 0. The Leech's second pull removes 1 Armor; on a host with none it does nothing. |
| Reactions | Dead Pilot's Reflex and Black-Box Recorder are armed by playing them, then fire automatically (Reflex first, then Recorder). Most machines die on the enemy's turn, when the hand is empty, so a prompt would rarely be usable. |
| Telegraphing | Each enemy's action for the turn is rolled at the start of your turn and shown on its token, including purges, Leech removal, jamming, scavenging and sabotage. |
| Possessed Builder malfunction | Rolled at the start of your turn so it is visible and the Manual Override Hand can cancel it. |
| Hostile Warframe startup | One action against its own side, then it stabilizes. Reset with 1 Energy, a Builder job, or the Hand. |
| Energy outside fights | Events use a full Energy bar (your cap). A Cold Reactor Cell charge can cover 1 of it. |
| Event fights | A pre-fight event that wakes something (Patient Machine, Assembly Yard) adds it to that room's fight. Wrong Hallway events start their own extension fight. |
| Hostile Patient after a repair | Stun, foam or seal it and it stabilizes into the promised ally instead of dying. |
| Variants | Tech Stop rebuilds, 2 Scrap, permanent, one per card instance. |
| Wrong Hallway trigger | The card arms it for the current room. Rooms also go wrong on their own 8% of the time. |
| Neutral maintenance machines | They exist in events. In fights the Faulty Access Badge applies to Drones only: they hold fire for 2 turns, then one check. |
| Enemy complications (brief 2 §12.5) | Mapped onto existing enemies: Drones scavenge wrecks, jam Builders and cut Leeches off; Lights go for an inert Warframe; Level 2s and Zombies prioritize an active Warframe and shake off Gun Nests. No new enemy units. |
| Animations | A mood word on the unit sheet and a log line. No art exists yet. |
| Madness thresholds | The briefs assume 5 on a 0–10 scale. Madness here rarely passes 6, so "high" is 3. |

## Readings I had to choose

- **"AM mine … hits first Mech that enters fight after first turn"**: a reinforcement arriving after turn 1 trips it; if nothing is inbound, the first enemy machine to act from turn 2 trips it. Under a strict "reinforcements only" reading it would almost never fire in rooms 1 and 2.
- **"max of 2 AD cards in loadout"**: a 2-slot auto-deploy rack. Only the AM Mine uses it so far.
- **Lil Robobuddy "collects 1 wreck at end"**: at the end of every fight, 1 Scrap, no Threat, no Teeth.
- **Builder Drone repairs Jubey**: the rig counts as allied Tech.
- **Builder Scrap Sorting**: capped at 3 per drone per fight so a stalled fight cannot farm it.
- **Threat Beacon**: the card is used up when played, so the 4 Scrap is paid once.
- **Red-Mouth Ammunition**: 3 rounds; playing it loads your next firearm card that turn.

## Not done, or thinner than the brief

- **Per-unit art and animation**: none. All feedback is text.
- **Shepherd commands**: Hold and Feed the Warframe exist. Collect Selected, Retreat and Unload do not; there are no positions for them to mean anything.
- **Ceiling Walker**: Hunt, Drop, Climb and Scout exist. Perch and Scuttle do not.
- **Enemy cover, bosses, immune targets**: none exist yet, so those clauses have nothing to act on.
- **Neutral drones in Maintenance Shift**: described and reactive in text; they are not units on the lane until they turn hostile.
- **Manual Override long-term reactions**: flavor lines from the third use in a run. No mechanical effect.
- **Circular Route enemy**: a shell with no loot. What it actually is stays open.

## Balance, as measured

`npm run sim` plays 1,500 runs per row with a simple heuristic bot. A person should beat these. The bot uses machine cards crudely.

| Bot | Past room 2 | Reached first Decon | Walked out clean |
| --- | --- | --- | --- |
| Careful, Shabby Lootbox | 59% | 44% | 44% |
| Careful, AM Mine | 72% | 51% | 51% |
| Careful, Lil Robobuddy | 57% | 45% | 45% |
| Careful, old cards only | 56% | 42% | 42% |
| Greedy (red hall, strips everything) | 66% | 62% | 62% |
| Careful, goes deeper once | 57% | 45% | 32% |
| Greedy, goes deeper twice | 66% | 62% | 40% |

What that says:

- The AM Mine does the job asked of the loadout: 13 points more runs get past room 2. The Lootbox and Robobuddy barely move early survival; Robobuddy pays in Scrap instead.
- Greedy still beats careful on the first leg.
- The deeper legs are survivable about two times in three for a bot that reached them. That is probably too gentle.
- The bot gains almost nothing from machine cards, so these numbers say little about whether the Improvised Army is too strong or too weak. That needs hands.

## Open questions carried over

- Room 1 Infested is 75% and room 2 is 8% (`DEPTH`). Left as found.
- Everything under OPEN / TUNE LATER in both briefs is still open; the defaults are the briefs' proposed values.

## Source appendix

Original prompts and amendments, verbatim. Interpretation lives above, not here.

**Prompt 1 (2026-11-17)**

> Evaluate the Descent card game on my
> GitHub for starting a new build for it, as well as the first enhancements and additions to make

**Prompt 2 (2026-11-17), in reply to "Want me to start the new build on that foundation?"**

> Yes

**Prompt 3 (2026-11-18)**

> Overhaul ideas

**Prompt 4 (2026-11-18)**, with two attached briefs

> @"/mnt/user-data/uploads/21929cca-attachment.txt" @"/mnt/user-data/uploads/29fd95ce-attachment.txt" I’ll leave big overhauling for later. Do 2 and add a choice at start to make the first 2 rooms easier: shabby lootbox (random basic item card like a tossable fuel canister, plus 1 scrap) AM mine (auto deploy card, hits first Mech that enters fight after first turn for 2, you start game with a max of 2 AD cards in loadout and this one is consumable) or Lil Robobuddy (2 HP, collects 1 wreck at end without raising threat)
> Also add these new cards and their other content

"2" refers to item 2 of the overhaul list given in reply to Prompt 3: "Go deeper or get clean".

The two briefs are stored verbatim:

- `docs/briefs/01-card-expansion-and-encounters.txt`
- `docs/briefs/02-improvised-army-and-machine-encounters.txt`

**Prompt 5 (2026-11-18)**

> Push. Armor will deduct one point of damage from every damage instance. Add Powered Armor unit with only 3 health and 1 armor.
