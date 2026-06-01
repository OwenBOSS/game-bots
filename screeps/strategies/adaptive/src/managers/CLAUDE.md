# managers/

## Purpose
Stateless tick-functions called once per owned room per loop tick. Each manager handles one concern. Execution order matters (see `main.ts`).

## Managers Reference

| File | Responsibility |
|------|---------------|
| `strategyManager.ts` | Phase transitions: ECONOMY↔ASSESS↔RUSH/DEFEND. Calls `resetToEconomy()` on timeout/success/wipe. |
| `constructionManager.ts` | Places road sites (drip-feed, MAX=10 pending), containers, extensions, towers, ramparts. Re-plans on RCL increase. Places spawn site for newly claimed rooms. |
| `spawnManager.ts` | Spawns creeps using per-phase `TARGETS` table + `bodyBuilder`. Claimer and bootstrap workers override normal priority. Combat units gated at `MIN_COMBAT_ENERGY=300`. |
| `combatManager.ts` | Towers: attack enemies → repair damaged structures. Combat state: RALLY→MARCH (≥4 units)→ENGAGE. Triggers re-scout via `Memory.scoutTick=undefined` every 500 ticks in ENGAGE. |
| `expansionManager.ts` | IDLE→CLAIMING→BOOTSTRAPPING→ACTIVE state machine. Triggers at RCL≥4 + GCL room slot. `bootstrapTargets()` tells spawnManager how many workers to send to new room. |
| `statsReporter.ts` | Logs full stats to console every 50 ticks. Writes compact `StatSnapshot` to `Memory.statsLog[]` every 200 ticks (rolling 500-entry window). |

## Memory Keys Owned
- `Memory.phase`, `Memory.phaseTick`, `Memory.scoutTick` — strategyManager
- `Memory.roadsPlanned`, `Memory.lastRCL` — constructionManager
- `Memory.combatState`, `Memory.rallyTick` — combatManager
- `Memory.expansionState`, `Memory.expansionTarget`, `Memory.expansionRoomName` — expansionManager
- `Memory.statsLog[]` — statsReporter

## Gotchas
- `constructionManager` calls `pruneExcessRoadSites` every 5 ticks — cheap, but skips re-planning if `roadsPlanned && lastRCL === rcl`.
- `spawnManager` only uses `room.find(FIND_MY_CREEPS)` — creeps in remote rooms (bootstrap workers) count against the main room's targets.
