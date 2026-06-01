# managers/

Stateless tick-functions called once per owned room per loop. Execution order is defined in `main.ts:37-46`.

## Manager Quick Reference

| File | Export | Line | Responsibility |
|------|--------|------|----------------|
| `strategyManager.ts` | `updatePhase(room)` | 10 | Offense phase FSM: ECONOMY→ASSESS→RUSH/DEFEND→ECONOMY |
| `economyManager.ts` | `trackEnergyFlow(room)` | 35 | Sample energy/containers/sources every 5t → `room.memory.energyStatus` |
| `economyManager.ts` | `calcDynamicTargets(room)` | 141 | Return spawn targets adjusted for active bottleneck |
| `defenseManager.ts` | `manageDefense(room)` | 19 | Threat detection (WARNING/ACTIVE) + cross-room unit dispatch |
| `constructionManager.ts` | `manageConstruction(room)` | 3 | Road drip-feed (max 10 pending), containers, extensions, towers, ramparts |
| `spawnManager.ts` | `manageSpawns(room)` | 18 | Priority-ordered spawn queue; local defense boost if room is ACTIVE |
| `spawnManager.ts` | `pruneExcessCreeps(room)` | 123 | Cull CRITICAL-energy bloat; kill combat units in sustained ECONOMY |
| `combatManager.ts` | `manageCombat(room)` | 13 | Towers → safe mode → RALLY/MARCH/ENGAGE state transitions |
| `tacticsManager.ts` | `manageTactics()` | 20 | Assign platoon orders (DIRECT/FLANK/FEINT/MAIN) on MARCH begin |
| `expansionManager.ts` | `manageExpansion(mainRoom)` | 14 | IDLE→CLAIMING→BOOTSTRAPPING→ACTIVE expansion FSM |
| `expansionManager.ts` | `bootstrapTargets()` | 89 | Returns `{hauler, builder}` counts needed in new room |
| `linkManager.ts` | `manageLinkTransfers(room)` | 6 | Drain source links → hub link each tick |
| `marketManager.ts` | `manageMarket(room)` | 10 | Buy ghodium (`GHODIUM_TARGET=1000`) every 200t at RCL 6+ |
| `statsReporter.ts` | `reportStats(room)` | 14 | Console log every 50t; `Memory.statsLog` snapshot every 200t |

## Key Types (economyManager.ts)

```typescript
// :22
type EnergyLevel = 'SURPLUS' | 'STABLE' | 'DEFICIT' | 'CRITICAL'
type Bottleneck  = 'HARVESTER_SHORTAGE' | 'HAULER_SHORTAGE' | 'SOURCE_MAXED' | 'BALANCED'

// :25
interface EnergyStatus { netRate, trend, pct, level: EnergyLevel, bottleneck: Bottleneck }

// :132
interface DynamicTargets { harvester, hauler, upgrader, builder, repairer, scout }
```

Bottleneck detection reads `room.memory.energyHistory` (last 8 samples = 40 ticks):
- `HARVESTER_SHORTAGE` — avg container fill < 25% AND energy DEFICIT/CRITICAL
- `HAULER_SHORTAGE`   — avg container fill > 70% AND spawn energy < 50%
- `SOURCE_MAXED`      — sources depleted > 60% of samples

## Global Memory Key Registry

| Key | Owner (primary writer) | Notes |
|-----|----------------------|-------|
| `Memory.phase` | `strategyManager.ts:10` | `GamePhase` enum |
| `Memory.phaseTick` | `strategyManager.ts` | tick of last phase change |
| `Memory.scoutTick` | `scout.ts` (set) / `strategyManager` (clear) | tick of last scout completion |
| `Memory.combatState` | `combatManager.ts` | `CombatState`: RALLY/MARCH/ENGAGE |
| `Memory.rallyTick` | `combatManager.ts` | tick MARCH began |
| `Memory.enemyRoomName` | `scout.ts` (set) / `strategyManager` (clear) | primary offensive target |
| `Memory.enemyStrength` | `scout.ts` | strength score of primary target |
| `Memory.roomIntel` | `scout.ts` | `Record<string, RoomIntel>` — all scanned rooms |
| `Memory.roomThreats` | `defenseManager.ts:19` | `Record<string, RoomThreat>` — OUR rooms under threat |
| `Memory.platoonOrders` | `tacticsManager.ts` | `Record<platoonId, PlatoonOrder>` |
| `Memory.coordinatedAttackTick` | `tacticsManager.ts` | tick coordinated attack began |
| `Memory.roadsPlanned` | `constructionManager.ts` | flag: roads already planned for current RCL |
| `Memory.lastRCL` | `constructionManager.ts` | detect RCL changes to re-plan |
| `Memory.expansionState` | `expansionManager.ts` | `ExpansionState` enum |
| `Memory.expansionTarget` | `expansionManager.ts` | room name being claimed |
| `Memory.expansionRoomName` | `expansionManager.ts` | room name being bootstrapped |
| `Memory.statsLog` | `statsReporter.ts` | rolling `StatSnapshot[]`, max 500 entries |

## Per-Room Memory (`room.memory.*`)

| Key | Owner | Contents |
|-----|-------|----------|
| `energyHistory` | `economyManager.ts:38` | last 20 samples `{tick, avail, containerFillPct, sourceDepletedPct}` |
| `energyStatus` | `economyManager.ts:51` | `EnergyStatus` incl. `bottleneck` — recomputed every 5 ticks |

## Key Constants

| Constant | Value | File:Line |
|----------|-------|-----------|
| `SAMPLE_INTERVAL` | 5t | economyManager.ts:18 |
| `WINDOW_SIZE` | 20 samples (100t) | economyManager.ts:19 |
| `MAX_HARVESTERS_PER_SOURCE` | 4 | economyManager.ts:20 |
| `ECONOMY_CREEP_TARGET` | 5 | strategyManager.ts:3 |
| `RUSH_STRENGTH_THRESHOLD` | 10 | strategyManager.ts:4 |
| `RUSH_TIMEOUT` | 2000t | strategyManager.ts:6 |
| `SAFE_MODE_PREPARE_TICKS` | 2000t | strategyManager.ts:8 |
| `MIN_FIGHTERS_TO_MARCH` | 4 | combatManager.ts:4 |
| `MIN_HEALERS_TO_MARCH` | 1 | combatManager.ts:5 |
| `SAFE_MODE_RAMPART_THRESHOLD` | 5000 hits | combatManager.ts:10 |
| `SAFE_MODE_OVERWHELM_COUNT` | 5 hostiles | combatManager.ts:11 |
| `THREAT_CLEAR_TICKS` | 50t | defenseManager.ts:16 |
| `WARNING_MAX_AGE` | 100t | defenseManager.ts:17 |
| `MIN_COMBAT_ENERGY` | 400e | spawnManager.ts:6 |
| `WARRIORS_PER_PLATOON` | 3 | spawnManager.ts:7 |
| `PRE_SPAWN_TICKS` | 60t | spawnManager.ts:226 |
| `DOWNGRADE_EMERGENCY_THRESHOLD` | 4000t | spawnManager.ts:8 |
| `MAX_ROAD_SITES` | 10 | constructionManager.ts:1 |
| `MIN_RCL_TO_EXPAND` | 4 | expansionManager.ts:10 |
| `BOOTSTRAP_HAULERS/BUILDERS` | 2 each | expansionManager.ts:11-12 |
| `REPORT_INTERVAL` | 50t | statsReporter.ts:10 |
| `LOG_INTERVAL` | 200t | statsReporter.ts:11 |

## Spawn Priority Order (`spawnManager.ts:18`)
1. Expansion: claimer (CLAIMING) or bootstrap workers (BOOTSTRAPPING)
2. Emergency upgrader (controller downgrade < 4000t)
3. Harvester floor (count < 2, always spawns)
4. **Local defense boost** (room has ACTIVE threat): repairer×2, warrior×4, ranger×2, healer×1
5. Economy roles (if not CRITICAL): harvester, builder, hauler, upgrader, scout
6. Phase repairer (DEFEND phase)
7. Combat units (STABLE/SURPLUS energy): warrior → ranger → healer

## Defense Flow (`defenseManager.ts`)
```
detectActiveThreats(room) → hostile combat creeps in room → severity = ACTIVE
checkEarlyWarnings(room)  → neighbor intel < 100t old with enemyCreeps > 0 → severity = WARNING
dispatchAndRecall()       → ACTIVE threats: redirect RALLY-state units from safe rooms
                          → threat clears (50t stale): recall units, set targetRoomName = homeRoom
```
Units are only dispatched if:
- Their `homeRoom` is NOT itself under ACTIVE threat
- They are physically in their `homeRoom`
- `Memory.combatState === 'RALLY'` (not on active offense)

## Gotchas
- `constructionManager` skips re-planning if `roadsPlanned && lastRCL === rcl` — change `Memory.roadsPlanned = false` to force a re-plan.
- `spawnManager` counts creeps via `room.find(FIND_MY_CREEPS)` — bootstrap workers in remote rooms count against main room targets.
- `defenseManager.dispatchAndRecall` iterates all `Game.creeps` globally and is called once per owned room — it's idempotent (already-dispatched creeps are skipped).
- `tacticsManager` only fires on MARCH start; platoon orders persist in Memory until overwritten.
- `calcDynamicTargets` reads `room.memory.energyStatus` (written 5t ago) — there's a 1-sample lag on bottleneck response.
