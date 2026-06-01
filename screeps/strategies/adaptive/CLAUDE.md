# Adaptive Strategy

## Purpose
Production Screeps bot. Phase-driven strategy that scouts adjacent rooms, builds economy, then chooses RUSH or DEFEND based on enemy strength. Self-resets after combat and re-enters economy phase to scale.

## Phase Machine
```
ECONOMY (build up) → ASSESS (scout) → RUSH (weak enemy) or DEFEND (strong enemy)
                                    ↓ on clear/timeout/wipe
                               ECONOMY (reset)
```
Thresholds: `ECONOMY_CREEP_TARGET=5`, `RUSH_STRENGTH_THRESHOLD=10`, `RUSH_TIMEOUT=2000 ticks`.

## Build & Deploy
```bash
npm install
npm run build    # rollup compiles src/ → dist/main.js
npm run deploy   # build + copy to Screeps AppData branch "adaptive"
```

## Source Layout
```
src/
  main.ts              loop() entry point
  types.d.ts           CreepRole, GamePhase, StatSnapshot, Memory extensions
  utils/bodyBuilder.ts Dynamic body scaling for all 9 roles
  roles/               9 creep role implementations
  managers/            8 managers called each tick from main.ts
```

## Manager Execution Order (each owned room, each tick)
1. `updatePhase` — phase transitions
2. `manageConstruction` — place/prune construction sites
3. `manageSpawns` — spawn creeps by role target
4. `manageCombat` — towers + RALLY/MARCH/ENGAGE state
5. `manageExpansion` — room claiming state machine
6. `reportStats` — console log + Memory.statsLog rolling history

## Gotchas
- `FIND_MY_CONSTRUCTION_SITES` misses containers (neutral `my:false`). Use `FIND_CONSTRUCTION_SITES` for containers.
- Stationary harvester mode only activates when a container exists adjacent to the source.
- `bodyBuilder.ts` caps body sizes: harvesters max 6 WORK, upgraders max 10 units.
- Construction manager re-plans only on RCL increase (`Memory.roadsPlanned` flag).
