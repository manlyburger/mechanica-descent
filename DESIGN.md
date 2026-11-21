# Mechanica Descent — build notes (v0.6.1)

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
| `src/game/pilots-data.ts` | Pilot items, specializations, personalities, frame faults, every pilot tuning value (`PR`) |
| `src/game/pilots.ts` | Pilot records, stats, levels, equipment, loyalty, custody strain, assignments, pilots in fights |
| `src/game/pilot-events.ts` | Empty-Cockpit Mech, Suspicious Cargo Above, Fleeing Pilot |
| `src/game/gear.ts` | Enemy equipment cards, enemy magazines, Observation checks, equipment salvage |
| `src/game/recovery.ts` | The post-combat recovery screen: escape pods and their occupants, Robobuddy reconstruction, abandoned frames |
| `src/game/stalkers.ts` | Threat stalkers: creation, level, movement, interception, elimination, orange route snippets |
| `src/Crew.tsx` | The crew panel: roster, equipment screen, stats, loyalty, assignment barrier |
| `src/game/tests/` | 314 tests: the briefs' scenarios, invariants under random play, save/reload |

## What v0.6.1 changes

- **Robobuddy reassembly takes two rooms** (Prompt 9). Rebuilding it on the recovery screen still takes the wreck's Scrap and cancels the pending Threat at once. It then sits out the next two rooms and rejoins at the start of the third, at half HP: rebuilt after room 5's fight, it is back for room 8. If the line is full when its room comes, it waits in the rig until a slot opens. The route and recovery screens say which room it returns in. Tunable as `RULES.buddyReassemblyRooms`.
- Effect, measured: careful Robobuddy runs reaching the first Decon went from 84% to 81%. It is still the strongest start, mostly because random targeting makes it a decoy during fights. Also raising the rebuild cost to 2 Scrap only took it to 78%.

## What v0.6 adds

Brief 6: escape pod recovery, enemy equipment, Observation, Robobuddy reconstruction and Threat stalkers. This section is the completion report the brief asks for, in its order.

### 1. Implemented

- **Post-combat recovery.** A pod still on the floor when the last fighter drops no longer keeps the fight going. It waits on a new screen, COMBAT COMPLETE — RECOVERY AVAILABLE, which lists pods, wrecks (with their Scrap), damaged chassis and Robobuddy. Flying pods and running pilots still keep a fight going: they are getting away. Nothing has to be opened before you leave.
- **Escape pods.** Light Mechs (30%) and Level 2 Mechs (40%) may fire their cockpit as they die. An R-8 ejection or a stalker's cockpit gives a named pod. Opening a pod has four outcomes (cooperative, frightened, hostile, incapacitated), or an empty pod when the pod's own record says so. Choices: recruit, secure, medical, question, release, or leave it sealed.
- **Enemy equipment.** Add-On Missile Pod, Extended Magazine and Laser Sight, rolled once per enemy from the brief's depth table. Ranged enemies now have a 4-round magazine and a telegraphed reload turn, because Extended Magazine needs one to extend.
- **Observation (Obv).** A fourth pilot stat, rolled and raised like the others. Discovery chance is 10% + 6% × the party's best effective Obv − concealment, clamped to 5–90%. Equipment is checked once when an enemy enters, and once more with the new **Scan for mods** action (1 Energy, once a fight).
- **Random targeting.** 75% uniform among legal targets, 25% tactical.
- **Robobuddy reconstruction** from one wreck's Scrap, with a loss penalty only if you leave it a shell.
- **Threat stalkers.** Heavy Hunter, Recon Stalker, Recovery Predator and Nightmare Stalker, one at a time from Threat 5. Each has a level, a route state and a door it waits behind. Eliminating one shows STALKING THREAT ELIMINATED and takes Threat down by its level plus the difficulty bonus.
- **Orange route snippets** above the path choices, drawn from the stalker's real state.

### 2. Existing systems reused

- Capsules and `launch()` from v0.4 carry named pods. Pods become the recovery screen's records when the fight ends.
- `makePilot`, the level tables, specializations, traits, loyalty bands and items from v0.5 make pod pilots and stalker pilots. These are ordinary roster records, so custody, strain, talking, recruiting and equipment all apply.
- Securing a pod uses `takeCaptive`, so the one-captive-per-holder rule and the Cockpit Parts key are the existing ones.
- Claiming an abandoned chassis uses `spawnFrame`. A random fault and half HP make it a damaged frame.
- `setPilot` decides what an escape means. A released or abandoned R-8 pilot gets R-8's replacement-frame rules; a pilot wearing a Tracking Relay becomes a runner.
- Stalker units are ordinary enemy units with tags, melee closing, armor and the new equipment.

### 3. Proposed or incomplete

- **Subsystem damage disabling equipment** (sensor damage switching off a sight, weapon damage switching off a magazine): there is no subsystem damage to hang it on. Smoke and ECM still work through the accuracy steps, and the sight adds on top of them.
- **Intact capture improving equipment salvage**: not built. Each installed item gets one salvage roll when its enemy is destroyed: a Laser Sight becomes a Stabilized Targeting module, anything else 2 Scrap.
- **Cover, elevation and line of fire for missiles**: the lane has none. The missile pod reaches anything a ranged weapon can, including overhead targets.
- **More than one stalker at extreme Threat**: `stalkerMax` is 1. At Threat 9+ the active stalker closes two rooms per transition instead.
- **"Search nearby rooms" and "react to combat noise"**: movement is distance-based. A missed interception makes it pick a door again; the Recon Stalker reads your last path 75% of the time.
- **Stalker art and per-archetype models**: they reuse the heavy-frame token. A ◆ marks them.

### 4. Targeting changes

- Every ordinary attack: 75% a uniformly random legal target, 25% tactical. Tactical means the most wounded target it can reach, with exceptions: Level 2s, Zombies and the Patient still go for an awake Warframe; the Infested still hunt Jubey at high Threat or Contamination; the Predator prefers machines; the Nightmare Stalker prefers people.
- Kept as explicit exceptions, applied on top: the Threat Beacon decoy, the saboteur run at the Warframe, the Latchback covering Bishop, the Widow's capsule recovery, the Needleback's mark, Bishop's orders.
- Melee range is checked first, so a random pick never lets a melee unit skip closing. The Missile Pod picks its own target and can hit overhead units.
- Survivability: no ally HP was raised. Robobuddy gets reconstruction. Everything else takes its share of fire as the brief intends.

### 5. Robobuddy recovery

- At 0 HP it becomes a shell: off the line, no strippable wreck, record kept (`state.buddy`).
- On the recovery screen: RECONSTRUCT ROBOBUDDY from any wreck holding at least `buddyRebuildCost` Scrap. That Scrap leaves the wreck, so it cannot also be stripped. It comes back at 50% HP, rounded up. Since v0.6.1 it sits out two rooms first.
- If you leave it a shell, Threat +1, once per destruction. It stays rebuildable from a later wreck, with no refund.
- **Changed from the brief**: the cost is 1 Scrap, not 2. Ordinary wrecks here hold 1 Scrap, so a cost of 2 meant almost no rebuilds before room 5. Raising every wreck to 2 Scrap made the whole game about 15 points easier (see Balance).

### 6. Pod occupants

- **Named**: an R-8 pilot or a stalker's pilot. Opening it shows that exact record, with its stats, gear and story state. Its outcome follows its loyalty band, or incapacitated at 1 HP.
- **Anonymous**: the pilot id is reserved when the pod fires. That id is the Cockpit Parts key shared by the wreck and the pod. Opening generates exactly one pilot: specialization from the origin mech (Light: Scout or Assault; Level 2: Assault or Heavy; Widow: Recovery or Technician, and so on), level from depth, all four stats, a gear profile, and condition and loyalty from the outcome. They are marked as qualified for their origin mech. Incapacitated pilots rest a room before taking a frame.
- A pod clamped during the fight settles its occupant when custody opens, so custody always sees a person.
- Left sealed: a named pilot escapes. An anonymous occupant is never generated.

### 7. Stalker difficulty and Threat reduction

- Expected enemy level for a room: 1 + ⌊(room − 1) / 3⌋. The game had no enemy level curve, so this is new.
- Stalker level, fixed at creation: expected level + 1 at Threat 5–6, + 2 at 7–8, + 3 at 9+. HP is the base plus 2 per level above 1. Damage is the base plus 1 per two levels above 1.
- Difficulty rating: level + 1 per equipment card.
- Reduction: level + max(0, rating − expected level for the room it dies in). Threat never drops below 0. The reduction applies once per stalker.
- Counts as eliminated: frame destroyed with an unpiloted stalker, or the pilot dead, captured or recruited. A pilot who gets away leaves it unresolved: it returns 3 rooms out in a refit, same level.

### 8. UI changes

- **Route**: orange snippets, and Robobuddy's shell status.
- **Battle**: equipment icons on identified enemies (◎ sight, ▮▮ magazine, ⇈ missile pod, solid when ready), a red dot on any enemy whose Laser Sight is aiming (shown before it is identified), RELOADING and last-round status, ◆ on stalkers, and the Scan for mods button.
- **Events**: the recovery screen.
- **Anywhere**: a notice card for STALKING THREAT ELIMINATED.
- **Crew panel**: the Observation row with its discovery chance, plus a qualified-for and resting note.
- **Saves**: a version 6 save loads, migrated.

### 9. Tests

312 pass: 52 new in `brief6.test.ts`, one or more per validation scenario, numbered to match. The fuzz invariants also cover pods, Observation, Robobuddy, stalkers, wreck Scrap and ammo, and the random-play coverage check now requires the recovery screen, every stalker state, an opened pod, a revealed item and a reload. Four existing tests changed: three because a pod on the floor now ends a fight, or because Observation shifts seeded rolls; one because Madness could make its Slug misfire under the new seed.

### 10. Known issues and unsupported dependencies

- **Robobuddy is now the strongest start** (see Balance). Random targeting means it absorbs a real share of fire, and it is rebuilt after most fights.
- **A captive stalker pilot who later escapes** does not restart the stalker: the elimination stands, as the brief asks for "securely removed".
- **Stalkers and R-8 never share a room.** If both would arrive, the stalker waits behind its door for another room.
- Subsystem damage, cover, and multiple simultaneous stalkers do not exist yet (see 3).

## What v0.5 adds

Brief 5: pilot equipment, progression, loyalty and three choice encounters.

- **Pilots are people.** Each has one record with a stable id: the same Needleback is the enemy pilot, the captive, the runner, and the crew member. The five R-8 pilots exist from the start with their own levels, specialties and gear.
- **Equipment.** Three slots, plus a fourth unlocked per pilot with 3 Cockpit Parts. Captives take gags, restraints and relays; crew take weapons, modules and support items. Capture confiscates crew gear; joining the crew hands captive gear back. Items move, never duplicate.
- **Cockpit Parts.** A 20% roll once per cockpit source: each anonymous piloted wreck, and each R-8 pilot once, however often they are recaptured.
- **Stats and levels.** Mental, Skill and Endurance rolled from the level table. XP from sorties, kills and safe inspections; each level adds a point and raises the stat cap. Nothing is ever rerolled or lowered.
- **Stat effects** use the brief's formulas and caps. Combined Mental and Endurance prevention stops at one point per hit.
- **Loyalty.** Five bands. Hostile and Unwilling pilots sit behind the orange-red barrier for assignments, but custody and equipment stay manageable. Partially Willing pilots show generalized expectations. Every restricted pilot gets an estimate or a named blocker. The betrayal roll stays hidden.
- **Assignments.** On foot (personal weapon) or in a salvaged frame (the frame's weapon). Captives in the field may bolt: telegraphed the turn before, and stoppable with Remote Release Shackles.
- **Custody over time.** Captives build escape strain each room; restraints slow it and relays show it. R-8 captives may ping their section through a suit transmitter, which gags do not stop, and shout to it when it is in the room, which gags do.
- **Encounters.** Empty-Cockpit Mech (25% damaged), Suspicious Cargo Above (15% toxic gas), Fleeing Pilot (Level 1 recruit; 80% start with 10–20% fading Madness).
- **Quartermaster crate.** Each Tech Stop offers three pilot items for Scrap.
- **Crew panel.** Opened from the "crew" button in the header.

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
| Commandeered Cockpit (brief 5 dependency) | Not in the game before this. The equivalent: salvaged frames (from the Empty-Cockpit Mech) that any eligible pilot can be assigned to, plus a hidden per-sortie betrayal roll for captives. |
| Dismounted pilots | "On foot" is an assignment: the pilot appears on your lane for each fight as a small unit with their own HP and personal weapon. Guns do nothing inside a frame. |
| Pilot Madness | Its own 0–100 scale per pilot, separate from your Madness meter. Effect: the chance a pilot freezes for a turn, reduced by Mental. +5% per Nightmare fight; Decon takes off 10. |
| Nightmare encounters | Fights with the Riflemen card, Wrong Hallway extension fights, and fights with the Prisoner. |
| Where stats apply | Endurance and Mental protect the pilot's own body: on foot, in toxic gas, and when their frame is destroyed. A frame takes its own damage. Skill and Madness apply both ways. |
| Specializations | Scout and Technician add Skill to inspection and technical checks. Assault adds damage. Recovery repairs its frame and is always found after ejecting. Heavy flies heavy frames. Command sharpens your machines. Untrained frame class: −2 Skill. Each improves at level 5. |
| Captive assignments | Partially Willing captives: on foot and ladders only. Cooperative captives: frames too. Assigned captives still count against their holder's one-captive limit. |
| Betrayal | Hidden chance per sortie by band and personality. More likely in a light frame or with their old section present; less with Remote Release Shackles, a Tracking Relay, or Panic Jack guarding them. A bolting pilot in a light frame takes the frame; otherwise they become a runner you can still catch. |
| Loyalty gains | Talking (once a room, gag off), treating injuries, an agreement not to field them against their section (broken if you do), and sorties. Time alone raises nothing. Harsh gear costs loyalty each room. |
| Blockers | Bishop: while any other R-8 pilot is still out there. Kilnheart (defiant): until treated. All R-8 captives warm up at 75% speed while the hunt is on. |
| Captive escape | Escape strain per room by band, less restraints and a Pod. At 100 they slip custody; with a Tracking Relay they turn up running in your next fight. No relay: "RESTLESS" from 70 is the only warning. |
| Gags and radios | Gags block speech: shouting to a section in the room. They never block the suit transmitter, which only a Local Signal Isolator stops and a Communication Monitor reports. |
| Pilot gear sources | R-8 pilots' confiscated kit, the Quartermaster crate at Tech Stops, Suspicious Cargo, and some fleeing pilots. |
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

- **Pilot portraits**: initials in a box. No art.
- **Commandeered Cockpit as its own system**: built only as far as frames and betrayal; there is no taking over an enemy mech mid-fight.
- **Personal combat beyond one attack**: on-foot pilots shoot; they do not dodge, take cover or carry items in the field.
- **Relays as separate damageable equipment**: relays only report; they cannot be damaged.
- **Loyalty from "fulfilled agreements" beyond the one agreement**: no other agreement types.
- **Scrap Shepherd recovering frames, Panic Jack guarding a pilot on foot, Unfinished Warframe piloting**: Jack can guard a frame or pilot unit (it deters bolting); the other two are not wired to pilots.
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

`npm run sim 1000` plays 1,000 runs per row with a heuristic bot. It rebuilds Robobuddy, opens pods, secures or recruits what it can and claims frames. It never equips or talks. "Careful" starts with Lil Robobuddy unless the row says otherwise.

| Bot | Past room 2 | Reached first Decon | v0.5 | Walked out clean |
| --- | --- | --- | --- | --- |
| Passive (no machines, no salvage) | 72% | 51% | — | 51% |
| Careful, Shabby Lootbox | 77% | 68% | 61% | 68% |
| Careful, AM Mine | 83% | 73% | 68% | 73% |
| Careful, Lil Robobuddy | 89% | 84% | 66% | 84% |
| Careful, old cards only | 87% | 80% | 64% | 80% |
| Greedy (red hall, strips everything) | 92% | 82% | 71% | 82% |
| Careful, goes deeper once | 89% | 84% | 66% | 58% |
| Greedy, goes deeper twice | 92% | 82% | 71% | 59% |

What that says:

- **Robobuddy runs are about 18 points easier.** Under random targeting the buddy absorbs a real share of the shots that used to go to Jubey, and it is rebuilt about 1.1 times a run for 1 Scrap. The knobs are `buddyRebuildCost` (2 would allow rebuilds only from heavy wrecks), `randomTarget`, and `buddyLossThreat`.
- **Lootbox and Mine runs are 5–7 points easier.** Pod pilots join the crew (about 0.7 a run), and the Jubey-focused fire is gone.
- **Measured and rejected:** wrecks worth 2 Scrap each, which added about 15 more points across the board. Ordinary wrecks are back to 1.
- **Stalkers mostly hunt greedy runs.** 21% of greedy runs and 41% of three-leg greedy runs are stalked. Careful bots rarely hold Threat at 5, because it drains a point every fight turn without salvage. The three-leg greedy bot eliminates 0.16 a run.
- **Enemy equipment starts at room 5**, after the first Decon, so it does not show in that column. Magazine reloads cost ranged enemies about one turn in five; on their own they changed survival by under a point.

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

**Prompt 7 (2026-11-20)**, with one attached brief

> @"/mnt/user-data/uploads/1e8b0417-attachment.txt" Push later when there’s more updates.
> Pilot units and mechanics update

"Push later when there's more updates" answers the question asked after Prompt 6: v0.4 and v0.5 stay local until a later update.

- `docs/briefs/05-pilot-equipment-progression-loyalty-and-choice-encounters.txt`

**Prompt 8 (2026-11-20)**, with one attached brief (uploaded as `454339d0-attachment.txt`)

> Next update

Read as: build the attached brief as v0.6. With v0.4, v0.5 and v0.6 all done, there are now "more updates" for Prompt 7's "push later", so the branch is pushed.

- `docs/briefs/06-escape-pods-enemy-equipment-observation-robobuddy-stalkers.txt`

**Prompt 9 (2026-11-21)**

> Add a 2 room delay for the buddy to reassemble.
> Before doing so make a list of improvement options to the game

Read as: it sits out two full rooms after a rebuild. The improvement list was given in the conversation, not stored here.
