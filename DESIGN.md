# Mechanica Descent — build notes (v0.4)

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
| `src/game/capture.ts` | Restraint integrity, Clampjaw, Lockbands, Containment Pod, custody, Memory Tap |
| `src/game/pursuit.ts` | Melee closing, ejection and capsules, the five R-8 chassis, Kilnheart's reactor, Bishop's orders |
| `src/game/team.ts` | Relay Section R-8's persistent state: pilots, coordination, replacements, pursuit endings |
| `src/game/story.ts` | Custody, the R-8 episodes and negotiation, The Prisoner That Repairs Itself |
| `src/game/team-text.ts` | R-8 radio dialogue (verbatim from the brief) and the Prisoner's screen tells |
| `src/game/tests/` | 190 tests: the briefs' scenarios, invariants under random play, save/reload |

## What v0.4 adds

### Kept from Prompt 6

The Salvage Leech's second pull strips 1 Armor; on a host with no Armor it falls back to making the host take +1 from every hit.

### Brief 3: capture, containment and the Prisoner

- **Clampjaw Drone, Industrial Lockbands, Cockpit Wedge, Mobile Containment Pod, Memory Tap**: all five cards.
- **Restraint Integrity** 0–100, shown as stable / strained / CRITICAL. Restrained machines stop fighting and strain every turn. Nothing escapes from a stable restraint without warning.
- **One captive each**: a Clampjaw and a Pod hold a single captive id. Transfers are atomic.
- **Custody**: when a fight ends with machines still restrained, each one is resolved in turn: keep it (needs a free holder), tap it, dismantle it, or let it go.
- **The Prisoner That Repairs Itself**: a multi-beat encounter. Its screen shows only ellipses and punctuation, with a bracketed sound caption. Each beat shows what it is about to do before you choose.

### Brief 4: melee closing, ejectable mechs, Relay Section R-8

- **Melee closing**: melee enemies are Distant, Closing or Engaged. Their card slides down the lane and they cannot hit until Engaged. Stun, foam and sealant stop the advance. Crane Hook knocks them back a step.
- **Five mechs**: Needleback Courier, Latchback Brawler, Gantry Widow, Kilnheart Breaker, Relay Bishop, at the brief's stats.
- **Ejection**: each prepares for a turn (telegraphed), then the cockpit leaves as a capsule unit carrying the pilot. The capsule stays on the field for 1 or 2 turns and can be shot down, stopped, grabbed, or towed out by the Widow.
- **Persistent team**: five pilots with stable ids and one status each. Coordination (0–3), recovery, pursuit state and every spawn are derived from those statuses.
- **Replacements**: an escaped pilot returns once, within 1–3 rooms, in a replacement frame, at most two per room. Captured, dead and withdrawn pilots never spawn or speak.
- **Story**: five episodes in order from room 2, then Cut the Relay with five approaches (assault, network, flying pod, interception, negotiation).
- **Endings**: withdrawal negotiated, team broken, or commander captured. Each one cancels all further team spawns.

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
| Capture eligibility (brief 3) | Small and medium machines at 3 HP or less, or disabled (stunned, foamed, sealed). Heavy frames (Level 2, Zombie, Kilnheart, Patient, Relay) are refused, and the unit sheet says so. |
| "Consumes a player action" | Playing the card is the action. Lockbands and Wedge cost Scrap, not Energy. |
| Fight end with captives | A fight ends when every enemy left is secured. Capsules on the field keep it going until they leave or are dealt with. |
| Pilot custody vs chassis custody | A restrained R-8 frame without a Wedge still ejects its pilot, during the fight or as you reach for the hatch. With a Wedge, the pilot can be pulled out at custody, if a holder is free. |
| Pod contents | A pilot, a capsule, a Drone, Powered Armor, or the Prisoner. It travels between rooms, unlike other structures. |
| Pod upkeep | Charged automatically at the start of every third occupied turn. You can cut power. Each missed cycle costs 20 seal; at 0 the captive is out. |
| Held captives between fights | Stable unless the holder is destroyed or the Pod loses power. Only the Prisoner keeps working on the Pod from inside. |
| Memory Tap choices | Hazard Scan reveals the next room; Weakness Analysis makes one machine in the next fight take +1; Cache Trace pays at the next Tech Stop (so a cache always has a real place). Corrupted reads are labeled UNVERIFIED. |
| Tapping pilots | Cockpits and capsules can be read. A pilot pulled out of a cockpit is a person and cannot. |
| Supervised Conversion | Exists for the Prisoner only (Recruit Under Supervision). |
| Melee range (brief 4) | One number per melee unit, used for both the rule and the slide. Infested start Closing; Zombie, Latchback and Kilnheart start Distant. |
| Ejection response window | The preparing turn, plus the 1–2 turns the capsule is on the field. |
| Destroyed before ejecting | 50% the cockpit blows clear as a damaged capsule; otherwise the pilot is lost. Wedged: 50% survives pinned in the wreck. Inside a reactor blast: 10%. All three are `RULES` values. |
| Kilnheart reactor | Heated at 7 HP, Critical at 4. Critical counts down 2 turns to detonation, shown on the token. Foam or sealant cools it one stage. |
| Bishop's orders | One per round, only with coordination 2+, and it costs Bishop its own action: Cover the Commander, Recover the Pilot, Organized Withdrawal, Press the Attack. |
| Flying command pod | Crane Smash and Crane Hook cannot reach it; everything else can. If it leaves, the next room opens Hunt the Flying Cockpit. |
| Network branch | A Command Relay unit (6 HP, 1 Armor) with two Drones replaces that room's pack. Destroying it drops coordination by 2. |
| Negotiation | Opens at leverage 2; "call them off" works at 3. Leverage: +1 per captured pilot, +2 for Bishop, +1 for the Widow lost, +1 for the relay cut. |
| First contact | The Needleback takes a Light's place in room 2's pack, so it looks like an ordinary patrol. |
| Animations | The melee slide and the Prisoner's screen are real CSS animation with reduced-motion fallbacks. Everything else is a status word and a log line. No art exists yet. |
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

- **Sound**: none. Every audio cue in the briefs is a bracketed caption instead.
- **Distinct ejection animations**: each chassis has its own ejection text and capsule behavior. There is no per-chassis animation.
- **Clampjaw commands**: Apprehend, Transfer and Release exist. Reinforce is automatic while it holds. Hold and Retreat have no positions to mean anything.
- **Lockbands on pilots, band damage as a separate track**: bands are a count on the restraint, not damageable equipment.
- **Enemy rescue of captives**: the Latchback targets a Clampjaw or Pod that is holding someone. No other rescue behavior.
- **Subsystem damage (actuators, hatch, sensors)**: only the Wedge and the reactor are modeled. A "destroyed shoulder actuator" cannot happen.
- **Clampjaw closing in visibly**: its sheet says "moving in"; it has no slide of its own. Panic Jack does not shift either.
- **Needleback retreating behind teammates, intel accuracy limits**: it marks, shoots and ejects. Its report gives R-8 sharper aim at the start of their next fight.
- **Prisoner variants and piloted variant**: one behavior profile.
- **Captives identifying you to their faction, exchanges beyond the one negotiation option**: not built.

- **Per-unit art and animation**: none. All feedback is text.
- **Shepherd commands**: Hold and Feed the Warframe exist. Collect Selected, Retreat and Unload do not; there are no positions for them to mean anything.
- **Ceiling Walker**: Hunt, Drop, Climb and Scout exist. Perch and Scuttle do not.
- **Enemy cover, bosses, immune targets**: none exist yet, so those clauses have nothing to act on.
- **Neutral drones in Maintenance Shift**: described and reactive in text; they are not units on the lane until they turn hostile.
- **Manual Override long-term reactions**: flavor lines from the third use in a run. No mechanical effect.
- **Circular Route enemy**: a shell with no loot. What it actually is stays open.

## Balance, as measured

`npm run sim` plays 1,200 runs per row with a simple heuristic bot. The bot does not capture anyone and barely uses machines.

| Bot | Past room 2 | Reached first Decon | Walked out clean |
| --- | --- | --- | --- |
| Careful, Shabby Lootbox | 72% | 56% | 56% |
| Careful, AM Mine | 81% | 63% | 63% |
| Careful, Lil Robobuddy | 73% | 63% | 63% |
| Careful, old cards only | 71% | 59% | 59% |
| Greedy (red hall, strips everything) | 86% | 70% | 70% |
| Careful, goes deeper once | 73% | 63% | 38% |
| Greedy, goes deeper twice | 86% | 70% | 46% |

What that says:

- **The first leg got about 10 points easier than v0.3.** Melee closing gives you a free turn against the Infested, which was the main killer in rooms 1 and 2.
- **The second leg got harder**: about 6 in 10 bots that go deeper once come back, down from 7 in 10. That is R-8 arriving in force.
- **The bot kills pilots; it never captures them.** Across all rows it captured a pilot in well under 1% of runs, so capture, custody, negotiation and the nonlethal endings are verified by tests and by hand, not by the sim.
- Greedy still beats careful.

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

**Prompt 6 (2026-11-19)**, with two attached briefs

> @"/mnt/user-data/uploads/311fb14f-attachment.txt" @"/mnt/user-data/uploads/436e95f9-attachment.txt" Keep the fallback
> 2 briefs for next update

"Keep the fallback" answers the question asked after Prompt 5: whether the Leech's second pull should keep making an unarmored host take +1. "2 briefs for next update" was read as an instruction to build both now as v0.4.

- `docs/briefs/03-capture-containment-and-the-self-repairing-prisoner.txt`
- `docs/briefs/04-ejectable-mechs-melee-closing-and-the-pursuit-team.txt`
