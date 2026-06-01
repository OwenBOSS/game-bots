# roles/

## Purpose
One file per creep role. Each exports a single `run*(creep)` function called from `main.ts`.

## Roles Reference

| File | Body Parts | Phase |
|------|-----------|-------|
| `harvester.ts` | WORK×N, CARRY, MOVE | All — stationary at source container; mobile fallback if no container |
| `hauler.ts` | CARRY×2N, MOVE×N | All — withdraws from containers, delivers to spawn/ext/storage |
| `upgrader.ts` | WORK×2N, CARRY×N, MOVE×N | ECONOMY/ASSESS/DEFEND — dedicated controller upgrader |
| `builder.ts` | WORK×N, CARRY×N, MOVE×N | All — builds by priority: container→road→extension→tower→rampart |
| `repairer.ts` | WORK×N, CARRY×N, MOVE×N | DEFEND — repairs most-damaged rampart during raids |
| `scout.ts` | MOVE×N | ASSESS+ — records `RoomIntel` per room, fixes bounce bug via targetRoomName clear |
| `claimer.ts` | CLAIM, MOVE×N | Expansion — signals `Memory.expansionState='BOOTSTRAPPING'` on success |
| `warrior.ts` | TOUGH×N, ATTACK×N, HEAL×N, MOVE×2N | RUSH/DEFEND — melee, self-heals, RALLY→MARCH→ENGAGE |
| `ranger.ts` | TOUGH×N, RANGED_ATTACK×N, HEAL×N, MOVE×2N | RUSH/DEFEND — ranged, kites melee, rangedMassAttack at 3+ targets |

## Patterns
- All roles use `creep.memory.working` boolean for harvest↔deliver state switching.
- Combat roles (`warrior`, `ranger`) read global `Memory.combatState` — they don't self-coordinate.
- Scouts clear `creep.memory.targetRoomName` when all adjacent rooms have fresh intel (<500 ticks old) to prevent bouncing.

## Gotchas
- `harvester` stationary mode requires a container within range 1 of the source. Without one it falls back to mobile delivery.
- `ranger` kite direction uses `Math.atan2` → `DirectionConstant` mapping; only kicks in when range < 2.
