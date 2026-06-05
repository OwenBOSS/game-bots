# Adventures in the Shards

*A chronicle of autonomous creeps, failed invasions, and the slow accumulation of economic dominance.*

---

## Prologue: Blank Grid

Every Screeps empire starts the same way — a single room, a single spawn, and the blinking cursor of a `main.ts` that does nothing. The first commit here was just that: scaffolding, configs, a README promising three strategies. `economy-first`, `rush`, and `adaptive`. The Adaptive was always the one that mattered, but you have to build something before you can adapt it.

The initial expansion commit was ambitious. Full economy. Combat. Infrastructure. All at once. It was the kind of commit that says *I have a plan* even when the plan is mostly vibes.

---

## Chapter 1: Digging In

The first real architectural decision was energy. Before anything else could work — spawning, building, fighting — the bot needed to understand its own economy. `economyManager` was born to sample containers, sources, and spawn energy every five ticks, writing a rolling 100-tick picture to `room.memory.energyStatus`.

Four states: `SURPLUS`, `STABLE`, `DEFICIT`, `CRITICAL`. Four bottlenecks: `HARVESTER_SHORTAGE`, `HAULER_SHORTAGE`, `SOURCE_MAXED`, `BALANCED`. The system didn't just track energy; it diagnosed *why* the energy was wrong. A full container with an empty spawn meant haulers, not harvesters. An empty container with a drained source meant you'd hit the ceiling.

Per-room energy tracking came next with a fix: the semantic bootstrap check. Small, but important — it meant each owned room could report its own financial health independently.

The spawn manager learned to read the diagnosis. Priority queues, role counts, combat unit gating behind energy thresholds. The economy had to stay solvent before anyone was allowed to go to war.

---

## Chapter 2: Eyes on the Horizon

A bot that can only see its own room is blind. Scouts went out first — pure `MOVE` creeps, no cargo, just intelligence. They mapped border rooms, writing `Memory.roomIntel` with enemy creep counts, spawn positions, tower counts, and a `strength` score that would later decide whether to raid or run.

Multi-room defense coordination followed: `defenseManager` watching for `WARNING` signals from neighboring rooms with fresh hostile intel, and `ACTIVE` threats inside your own walls. The defense flow was careful: units were only dispatched cross-room if their home wasn't already under attack, and they were recalled automatically when the threat aged out.

Early warning scouts — neighbor intel under 100 ticks old with `enemyCreeps > 0` — bought enough time to prep towers and recall RALLY-state fighters before anything actually arrived at the gate.

---

## Chapter 3: The Empire Expands

Remote mining was the leap from survivalist to expansionist. Reservers marched out to unclaimed rooms. Remote harvesters filled containers that distance-aware haulers would then carry home — the hauler body scaling with travel time so nothing ran empty-handed the whole way.

Quad squads arrived alongside: four warriors moving as a unit, coordinated by a leader, healing inside the formation. The CPU was getting expensive; per-tick `find()` calls were memoized into `tickCache` to stay inside the 100-CPU budget.

The strategy manager grew its own offense finite state machine: `ECONOMY → ASSESS → RUSH / DEFEND → ECONOMY`. Each room kept its own state — room A could be marching while room B was peacefully upgrading its controller. This was a hard architectural problem that would cause real bugs later.

---

## Chapter 4: The Observatory and the Simulator

Before deploying to the live shards, there was a simulator. The Monte Carlo system — thousands of simulated ticks, calibrated against recorded memory snapshots, measuring expected energy rates and creep lifetimes against a probability distribution of outcomes.

The dashboard came with it: a live HTML panel fetching `Memory.statsLog` from the Screeps API, plotting energy rates, creep counts, structure health, containers fill percentages. Charts that updated as each `just deploy` pushed a new regime. The `regimes.json` file kept the history — every deploy stamped with a git hash and timestamp.

June 2nd saw four deployments in a single afternoon. Something wasn't working, and the dashboard was how you knew.

---

## Chapter 5: Season 10

Screeps seasons are a separate game — same mechanics, new scoring rules. Season 10 was about Score objects: caches of value scattered across the shard that collectors could carry to controllers. The economy of it was different enough to need its own strategy.

The Season 10 strategy was built test-first. Strategy reports written first, then 79 tests across 8 suites, then implementation — RC-tiered body builders, a `scoreTracker` with decay expiry and 10-tick throttle, a `spawnManager` that understood dynamic quotas based on storage levels, an `observerManager` for RC8 round-robin room surveillance.

Missing pieces were identified and filled in: a `builder` role that fell back to filling the spawn when no construction sites remained, a `hunter` — `[ATTACK×3, MOVE×3]` — that intercepted hostile collectors near active Score rooms, a `towerManager` with 4-priority logic (attack, heal below 80%, repair rampart below 10k, repair road below 50% when energy above 700).

By June 3rd, both strategies were deploying in parallel from the same git hash — the regimes log shows `adaptive` and `season10` pushing within seconds of each other, half a dozen times that afternoon as the tuning continued.

---

## Chapter 6: The Wars (and Why They Kept Failing)

The military looked good on paper. Warriors, rangers, healers. Quad formation. A combat state machine with three stages: **RALLY** (gathering forces), **MARCH** (moving to enemy room), **ENGAGE** (fighting). What could go wrong?

Everything, as it turned out.

**Bug 1 — The Infinite Bounce.** `manageCombatState()` used `room.find(FIND_MY_CREEPS)` to count fighters. Once warriors marched to the enemy room, the home room saw zero fighters and immediately reset to RALLY. The squad marched out, the bot called them back, they marched out again. Forever. The fix was surgical: switch to `Object.values(Game.creeps)` filtered by `homeRoom`. The fighters were always there; the game just wasn't looking in the right place.

**Bug 2 — Nobody Leading the Charge.** `coordinateQuadTargets()` required the quad leader to be in the home room before assigning targets. During ENGAGE, the leader was *in the enemy room*. No targets were ever assigned. Quads stood there doing nothing. Fixed by looking up targets in the leader's current room regardless of which room it was.

**Bug 3 — Followers Without a Follow.** `followQuadLeader()` was exported from `quadManager` but never imported or called in `warrior.ts` or `ranger.ts`. Non-leader quad members never actually followed their leader. The formation fell apart on first contact. The fix was wiring the call into `engageInRoom()` and `engage()`.

Three regression tests were written immediately to ensure none of these would be silently reintroduced.

---

## Chapter 7: The Kiting Problem

Even after the squad could march and engage, a new failure mode emerged: enemy bots that knew how to kite. A single enemy combat creep would run away from the squad, and the entire force — four fighters, one healer — would chain behind it across the map, ignoring the defenseless harvesters and haulers it was protecting.

The fix was a priority ladder, ruthlessly explicit:

1. Towers first — drain them before anything else
2. Active threats — enemy has live ATTACK or RANGED_ATTACK parts AND is within their effective attack range of one of ours
3. Reservers — CLAIM parts — killing this frees the room controller immediately
4. Economy creeps — WORK and CARRY — harvesters and haulers; loot drops on death
5. Passive and fleeing combatants — mop up only after economy is cleared

HEAL parts were deliberately excluded from the threat check. Healers don't deal damage. Ignoring them while killing the income stream was the correct trade.

The bait guard fix came separately: a stale `targetId` pointing at a kiting combat creep was discarded if the target was no longer within its own attack range of any ally and priority targets still existed. Orphaned quad members — those whose leader had died — had been locked onto old targets indefinitely. Now they reassessed.

---

## Chapter 8: The Intel Lag

One more delay, quieter than the rest but just as painful: after the room cleared, the reserver and remote miners wouldn't spawn for 200–300 ticks.

The root cause was the scout's rescan cycle. `remoteManager` and `spawnManager` both gated on `Memory.roomIntel[enemyRoom].enemyCreeps > 0`. The scout only rescanned border rooms every 100 ticks. Even with every enemy dead, the bot would wait for the next scout pass before declaring the room safe.

The solution was `refreshBattlefieldIntel()`, called every tick during ENGAGE while fighters had visibility into the enemy room. It wrote live counts — `enemyCreeps`, `enemyTowers`, `enemySpawns`, `strength` — directly to `Memory.roomIntel[roomName]` each tick. The moment the last enemy fell, `enemyCreeps` hit zero. Within one or two ticks, the reserver and remote workers began spawning.

---

## Chapter 9: The Military Overhaul

The final chapter brought structure to what had been improvised. A proper `raidManager` — economy-first raiding with a rolling 500-tick profit window. If total energy spent on raids exceeded energy captured in the last 500 ticks, all raids halted until the balance recovered. Operational posture scaled with RCL: `NONE` below 3, `OPPORTUNISTIC` at 3–4, `ORGANIZED` at 5–6, `FULL` above 6.

Strike target priority for raids: harvesters first (WORK parts), then laden haulers, then empty haulers. Any sign of a tower, abort — too dangerous at those compositions.

A `defenseManager` that could detect threats, issue `WARNING` and `ACTIVE` classifications, and dispatch or recall units across rooms. A `quadManager` that managed formation movement. A `tacticsManager` that assigned platoon orders — `DIRECT`, `FLANK`, `FEINT`, `MAIN` — at the moment of march, one platoon per three warriors.

Alongside: a hauler fix for oscillation — commit to delivery when carrying, don't return empty-handed. A harvester fix for spot competition — avoid sources with parked harvesters already occupying the mining position.

The current regime, `2026-06-05-1149ede`, is this one.

---

## Epilogue: What the Dashboard Sees

The dashboard charts tell the story at a glance: energy rates trending up or down, creep counts by role, container fill percentages, spawn energy. The `statsLog` fills in at 200-tick intervals, and the regime history in `regimes.json` marks the boundary between each experiment.

Forty-four deploy entries. Two strategies running in parallel. A bot that can now scout, expand, defend, raid, and adjust its own economy based on bottleneck diagnosis.

The shards are persistent. The game never stops. The creeps keep spawning, the energy keeps flowing, and somewhere in an enemy room a reserver is already setting the controller timer.

We'll deploy again tomorrow.
