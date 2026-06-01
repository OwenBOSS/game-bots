# Adaptive Strategy

## Purpose
Production Screeps bot. Per-room phase-driven strategy that scouts adjacent rooms, builds economy, then independently chooses RUSH or DEFEND per owned room. Multi-room defense layer handles inbound attacks concurrently. Each room resets to economy phase after combat resolves.

## Phase Machine (per-room, offense-only)
```
ECONOMY (build up) → ASSESS (scout) → RUSH (weak enemy) or DEFEND (strong enemy)
                                    ↓ on clear/timeout/wipe
                               ECONOMY (reset)
```
State is stored in `room.memory.phase` — each owned room runs this FSM independently.
Multiple rooms can simultaneously be in RUSH, DEFEND, ECONOMY, etc.

Thresholds in `managers/strategyManager.ts:3-8`:
- `ECONOMY_CREEP_TARGET = 5` — creep floor before transitioning to ASSESS
- `RUSH_STRENGTH_THRESHOLD = 10` — enemy strength below this → RUSH, else DEFEND
- `RUSH_TIMEOUT = 2000` — ticks before abandoning a failed RUSH

Defense is **not** a phase — it runs concurrently via `defenseManager` regardless of offense phase.

## Build & Deploy
```bash
npm install
npm run build    # rollup: src/ → dist/main.js
npm run deploy   # build + copy to Screeps AppData branch "adaptive"
```

## Source Layout
```
src/
  main.ts              loop() entry — calls all managers then all creep roles
  types.d.ts           all types: CreepRole, GamePhase, Memory, RoomMemory, RoomThreat, …
  utils/
    bodyBuilder.ts     buildBody(role, budget) — single function, scales all bodies
  managers/            15 managers, each called once per owned room per tick
  roles/               12 creep role files, each exports one run*(creep) function
```

## Manager Execution Order (per owned room, per tick)
```
main.ts:37-48
```
1. `trackEnergyFlow`    — sample energy/containers/sources → update room.memory.energyStatus
2. `manageDefense`      — detect threats (WARNING/ACTIVE), dispatch defenders cross-room
3. `updatePhase`        — per-room offense phase machine transitions
4. `manageConstruction` — place/prune construction sites
5. `manageSpawns`       — spawn creeps; calls `pruneExcessCreeps`
6. `manageCombat`       — towers, safe-mode trigger, per-room RALLY/MARCH/ENGAGE state
7. `manageLinkTransfers`— drain source links → hub link
8. `manageExpansion`    — IDLE→CLAIMING→BOOTSTRAPPING→ACTIVE expansion FSM
9. `manageMarket`       — buy ghodium from market (every 200 ticks, RCL 6+)
10. `manageTransfers`   — inter-room energy balance; terminal.send() at RCL 6+
11. `reportStats`       — console log (every 50t) + Memory.statsLog snapshot (every 200t)

## Global Memory Registry
Truly global state (shared across all rooms):

| Key | Owner (writes) | Readers |
|-----|---------------|---------|
| `Memory.roomIntel` | `scout.ts` | strategyManager, expansionManager, defenseManager, tacticsManager |
| `Memory.roomThreats` | `defenseManager` | defenseManager, spawnManager |
| `Memory.roadsPlanned`, `Memory.lastRCL` | `constructionManager` | constructionManager |
| `Memory.expansionState/Target/RoomName` | `expansionManager` | spawnManager |
| `Memory.statsLog` | `statsReporter` | — |

## Per-Room Memory (`room.memory.*`)
All per-room offense state so rooms operate independently:

| Key | Owner |
|-----|-------|
| `room.memory.energyHistory` | economyManager |
| `room.memory.energyStatus` | economyManager (incl. `bottleneck` field) |
| `room.memory.phase` | strategyManager |
| `room.memory.phaseTick` | strategyManager |
| `room.memory.scoutTick` | scout.ts (writes to all owned rooms), strategyManager (clears) |
| `room.memory.combatState` | combatManager |
| `room.memory.rallyTick` | combatManager |
| `room.memory.enemyRoomName` | scout.ts (writes to all owned rooms), strategyManager (clears) |
| `room.memory.enemyStrength` | scout.ts (writes to all owned rooms), strategyManager (clears) |
| `room.memory.platoonOrders` | tacticsManager |
| `room.memory.coordinatedAttackTick` | tacticsManager |
| `room.memory.energySurplus` | transferManager |

## CreepMemory Fields
| Field | Set by | Used by |
|-------|--------|---------|
| `role` | spawnManager | all |
| `working` | each role | harvester, hauler, upgrader, builder, repairer, scavenger, courier |
| `homeRoom` | spawnManager (at spawn) | warrior, ranger, healer, scavenger, courier — retreat & dispatch recall |
| `defendingRoom` | defenseManager | warrior, ranger, healer — cross-room defense routing |
| `targetRoomName` | spawnManager, defenseManager, scout | scout, warrior, ranger, healer, claimer |
| `sourceId` | harvester | harvester — least-contested source assignment |
| `platoonId` | spawnManager | warrior, ranger, healer — platoon coordination |
| `scoutComplete` | scout | scout — prevent re-recording on same tick |
| `scavengeRoom` | manual / spawnManager | scavenger — optional remote room to loot |
| `courierTarget` | spawnManager | courier — destination room for energy delivery |

## Key Symbol Index
Jump to any symbol with `file:line`:

```
src/main.ts:22                     export function loop()
src/types.d.ts:1                   all type definitions
src/utils/bodyBuilder.ts:6         export function buildBody(role, budget)

src/managers/strategyManager.ts:10  export function updatePhase(room)
src/managers/economyManager.ts:35   export function trackEnergyFlow(room)
src/managers/economyManager.ts:141  export function calcDynamicTargets(room)
src/managers/economyManager.ts:22   export type EnergyLevel / Bottleneck
src/managers/defenseManager.ts:19   export function manageDefense(room)
src/managers/spawnManager.ts:18     export function manageSpawns(room)
src/managers/spawnManager.ts:123    export function pruneExcessCreeps(room)
src/managers/constructionManager.ts:3  export function manageConstruction(room)
src/managers/combatManager.ts:14    export function manageCombat(room)
src/managers/tacticsManager.ts:29   export function manageTactics(room)
src/managers/expansionManager.ts:14 export function manageExpansion(mainRoom)
src/managers/expansionManager.ts:89 export function bootstrapTargets()
src/managers/linkManager.ts:6       export function manageLinkTransfers(room)
src/managers/marketManager.ts:10    export function manageMarket(room)
src/managers/transferManager.ts:21  export function manageTransfers(room)
src/managers/statsReporter.ts:14    export function reportStats(room)

src/roles/harvester.ts:4    export function runHarvester(creep)
src/roles/hauler.ts:5       export function runHauler(creep)
src/roles/upgrader.ts:5     export function runUpgrader(creep)
src/roles/builder.ts:6      export function runBuilder(creep)
src/roles/repairer.ts:7     export function runRepairer(creep)
src/roles/scout.ts:9        export function runScout(creep)
src/roles/claimer.ts:4      export function runClaimer(creep)
src/roles/scavenger.ts:11   export function runScavenger(creep)
src/roles/courier.ts:11     export function runCourier(creep)
src/roles/warrior.ts:5      export function runWarrior(creep)
src/roles/ranger.ts:7       export function runRanger(creep)
src/roles/healer.ts:8       export function runHealer(creep)
```

## Gotchas
- `FIND_MY_CONSTRUCTION_SITES` misses containers (`my:false`). Use `FIND_CONSTRUCTION_SITES` for containers.
- Stationary harvester mode requires a container within range 1 of the source (`harvester.ts:93`).
- `bodyBuilder.ts` caps sizes: harvesters max 6 WORK, upgraders max 10 units.
- Construction manager re-plans only on RCL increase (`Memory.roadsPlanned` flag).
- `defenseManager` dispatch only redirects units in `RALLY` state — active offense campaigns (`MARCH`/`ENGAGE`) are never interrupted.
- `homeRoom` is only set on creeps spawned after this field was added. Legacy creeps fall back to "any owned room" in `isHome()`.
- Energy tracking (`energyHistory`, `energyStatus`) is per-room on `room.memory`, not global.
- Per-room combat: `room.memory.combatState` is independent per room. Combat creeps always read `Game.rooms[creep.memory.homeRoom].memory.combatState`.
- Scout writes `scoutTick` and `enemyRoomName` to **all** owned rooms so each room's strategy FSM gets updated intel simultaneously.
- Scavenger is spawned by `calcDynamicTargets` (target=1 once containers>0). Assign `scavengeRoom` in the Screeps console to send it to loot an enemy room.
- Courier bodies have no TOUGH — they travel through owned rooms only. Don't route them through hostile territory.
