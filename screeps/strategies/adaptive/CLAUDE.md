# Adaptive Strategy

## Purpose
Production Screeps bot. Phase-driven strategy that scouts adjacent rooms, builds economy, then chooses RUSH or DEFEND based on enemy strength. Separate defense layer handles inbound attacks on any owned room. Self-resets after combat and re-enters economy phase to scale.

## Phase Machine (global, offense-only)
```
ECONOMY (build up) → ASSESS (scout) → RUSH (weak enemy) or DEFEND (strong enemy)
                                    ↓ on clear/timeout/wipe
                               ECONOMY (reset)
```
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
  managers/            10 managers, each called once per owned room per tick
  roles/               10 creep role files, each exports one run*(creep) function
```

## Manager Execution Order (per owned room, per tick)
```
main.ts:37-46
```
1. `trackEnergyFlow`   — sample energy/containers/sources → update room.memory.energyStatus
2. `manageDefense`     — detect threats (WARNING/ACTIVE), dispatch defenders cross-room
3. `updatePhase`       — offense phase machine transitions
4. `manageConstruction`— place/prune construction sites
5. `manageSpawns`      — spawn creeps; calls `pruneExcessCreeps`
6. `manageCombat`      — towers, safe-mode trigger, RALLY/MARCH/ENGAGE state
7. `manageLinkTransfers`— drain source links → hub link
8. `manageExpansion`   — IDLE→CLAIMING→BOOTSTRAPPING→ACTIVE expansion FSM
9. `manageMarket`      — buy ghodium from market (every 200 ticks, RCL 6+)
10. `reportStats`      — console log (every 50t) + Memory.statsLog snapshot (every 200t)

## Global Memory Registry
See `types.d.ts` for full interface. Key ownership:

| Key | Owner (writes) | Readers |
|-----|---------------|---------|
| `Memory.phase` | strategyManager | spawnManager, statsReporter |
| `Memory.phaseTick` | strategyManager | strategyManager, spawnManager |
| `Memory.scoutTick` | strategyManager (reset), scout.ts (set) | strategyManager, combatManager |
| `Memory.combatState` | combatManager | defenseManager, spawnManager, warrior/ranger/healer |
| `Memory.rallyTick` | combatManager | combatManager |
| `Memory.enemyRoomName` | scout.ts (set), strategyManager (clear) | combatManager, tacticsManager, statsReporter |
| `Memory.enemyStrength` | scout.ts (set), strategyManager (clear) | strategyManager |
| `Memory.roomIntel` | scout.ts | strategyManager, expansionManager, defenseManager, tacticsManager |
| `Memory.roomThreats` | defenseManager | defenseManager, spawnManager |
| `Memory.platoonOrders` | tacticsManager | warrior, ranger, healer |
| `Memory.roadsPlanned`, `Memory.lastRCL` | constructionManager | constructionManager |
| `Memory.expansionState/Target/RoomName` | expansionManager | spawnManager |
| `Memory.statsLog` | statsReporter | — |

## Per-Room Memory (`room.memory.*`)
Stored per room so multi-room setups don't clobber each other.

| Key | Owner |
|-----|-------|
| `room.memory.energyHistory` | economyManager |
| `room.memory.energyStatus` | economyManager (incl. `bottleneck` field) |

## CreepMemory Fields
| Field | Set by | Used by |
|-------|--------|---------|
| `role` | spawnManager | all |
| `working` | each role | harvester, hauler, upgrader, builder, repairer |
| `homeRoom` | spawnManager (at spawn) | warrior, ranger, healer — retreat & dispatch recall |
| `defendingRoom` | defenseManager | warrior, ranger, healer — cross-room defense routing |
| `targetRoomName` | spawnManager, defenseManager, scout | scout, warrior, ranger, healer, claimer |
| `sourceId` | harvester | harvester — least-contested source assignment |
| `platoonId` | spawnManager | warrior, ranger, healer — platoon coordination |
| `scoutComplete` | scout | scout — prevent re-recording on same tick |

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
src/managers/combatManager.ts:13    export function manageCombat(room)
src/managers/tacticsManager.ts:20   export function manageTactics()
src/managers/expansionManager.ts:14 export function manageExpansion(mainRoom)
src/managers/expansionManager.ts:89 export function bootstrapTargets()
src/managers/linkManager.ts:6       export function manageLinkTransfers(room)
src/managers/marketManager.ts:10    export function manageMarket(room)
src/managers/statsReporter.ts:14    export function reportStats(room)

src/roles/harvester.ts:4    export function runHarvester(creep)
src/roles/hauler.ts:5       export function runHauler(creep)
src/roles/upgrader.ts:5     export function runUpgrader(creep)
src/roles/builder.ts:6      export function runBuilder(creep)
src/roles/repairer.ts:7     export function runRepairer(creep)
src/roles/scout.ts:9        export function runScout(creep)
src/roles/claimer.ts:4      export function runClaimer(creep)
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
