# roles/

One file per creep role. Each exports a single `run*(creep)` function called from `main.ts:55-76`.

## Role Quick Reference

| File | Export | Line | Body Budget | Phase |
|------|--------|------|-------------|-------|
| `harvester.ts` | `runHarvester` | 4 | WORK×6max, CARRY, MOVE | All |
| `hauler.ts` | `runHauler` | 5 | CARRY×2N, MOVE×N (150e/unit) | All |
| `upgrader.ts` | `runUpgrader` | 5 | WORK×2N, CARRY×N, MOVE×N (350e/unit) | All |
| `builder.ts` | `runBuilder` | 6 | WORK×N, CARRY×N, MOVE×N (200e/unit) | All |
| `repairer.ts` | `runRepairer` | 7 | WORK×N, CARRY×N, MOVE×N | DEFEND / ACTIVE threat |
| `scout.ts` | `runScout` | 9 | MOVE×5max | All (RCL ≥ 1) |
| `claimer.ts` | `runClaimer` | 4 | CLAIM, MOVE×N | Expansion |
| `scavenger.ts` | `runScavenger` | 11 | TOUGH×N, CARRY×N, MOVE×N (180e/unit) | All (once containers exist) |
| `courier.ts` | `runCourier` | 11 | CARRY×N, MOVE×N (100e/unit) | All (surplus→deficit rooms) |
| `warrior.ts` | `runWarrior` | 5 | TOUGH×N, ATTACK×N, HEAL×N, MOVE×2N (440e/unit) | RUSH/DEFEND/defense dispatch |
| `ranger.ts` | `runRanger` | 7 | TOUGH×N, RANGED_ATTACK×N, HEAL×N, MOVE×2N (510e/unit) | RUSH/DEFEND/defense dispatch |
| `healer.ts` | `runHealer` | 8 | TOUGH×N, HEAL×N, MOVE×2N (360e/unit) | RUSH/DEFEND/defense dispatch |

Body sizes come from `utils/bodyBuilder.ts:6` — `buildBody(role, budget)`.

## Energy Collection Priority

**harvester** (mobile mode only — stationary harvesters park on container):
`harvester.ts:104` → spawn < 80% full → extensions → towers → upgrade controller

**hauler** (`hauler.ts:20`):
hub link (≥400e) → fullest container (≥50e) → storage (≥1000e) → dropped (≥50e) → harvest

**builder** (`builder.ts:46`):
fullest container (≥50e) → storage (≥200e) → dropped (≥50e) → harvest (only if no containers exist)

**upgrader / repairer**: container → storage → harvest fallback

**scavenger** (`scavenger.ts:22`):
tombstones in own room (≥30e) → dropped in own room (≥30e) → travel to `scavengeRoom` → tombstones/dropped there → return home

**courier** (`courier.ts:24`):
collect: own room storage (≥500e) → containers (≥200e)
deliver: target room spawn/extensions → storage → containers

## Build/Repair Priority

**builder** `findBuildTarget` (`builder.ts:86`):
CONTAINER → ROAD → EXTENSION → TOWER → RAMPART → anything else
Falls back to: repair roads < 50% hits → upgrade controller

**repairer** `findRepairTarget` (`repairer.ts:28`):
Ramparts < 50,000 hits → walls < 10,000 hits → roads < 50% hits

## Scout Coverage (`scout.ts`)

Covers exits from **all** owned rooms (not just one):
- Unscanned rooms first
- Border rooms rescanned every `BORDER_STALE_TICKS = 100t` (`scout.ts:7`) for early warning
- All others at `STALE_TICKS = 500t` (`scout.ts:6`)
- Returns to first owned room when all rooms are fresh
- On each scan: writes `scoutTick` and `enemyRoomName/Strength` to **all** owned rooms' memory

`recordRoomIntel` (`scout.ts:34`) writes `Memory.roomIntel[roomName]` with:
`{ scannedAt, enemyCreeps, enemySpawns, enemyTowers, strength, hasController, controllerOwned, sourceCount }`

## Scavenger (`scavenger.ts`)

- Collects tombstones + dropped energy in home room.
- If `creep.memory.scavengeRoom` is set and home room is clean, travels there (works even in safe-mode rooms — couriers can enter, just can't attack).
- Deposits into storage → containers → spawns.
- To assign a remote room: `Game.creeps['scavenger_1234'].memory.scavengeRoom = 'W5N3'`

## Courier (`courier.ts`)

- `homeRoom` = source room (where to load from storage/containers)
- `courierTarget` = destination room (where to deposit into spawn/ext/storage)
- Set automatically by spawnManager when a deficit neighbor is found.
- Pre-terminal energy path. At RCL 6+, transferManager uses terminal.send() and no new couriers are spawned.

## Combat Unit Behavior

All three combat roles share the same state structure:

```
combatState === 'RALLY'     (from homeRoom.memory.combatState)
  └─ creep.memory.defendingRoom set?  → travel to defending room, engage/heal
  └─ otherwise                        → rally at staging area near spawn

combatState === 'MARCH' / 'ENGAGE'   → follow platoon orders (DIRECT/FLANK/FEINT/MAIN)
```

**Per-room combat state:** each room has its own `room.memory.combatState`. Rooms A and B can simultaneously be in RUSH and ECONOMY respectively. Combat creeps read from `Game.rooms[creep.memory.homeRoom].memory.combatState`.

**Defense dispatch** (set by `defenseManager`):
- `creep.memory.defendingRoom` → room to travel to and fight in
- `creep.memory.homeRoom`      → where to return when threat clears
- Only fires during `RALLY`; MARCH/ENGAGE units stay on their offense mission

**Retreat thresholds:**
- `warrior.ts:3` — `RETREAT_THRESHOLD = 0.3` (30% HP)
- `ranger.ts:4`  — `RETREAT_HP = 0.25` (25% HP)
- Both retreat to `homeRoom` spawn, not just any owned room

**Ranger kiting** (`ranger.ts:5`): `KITE_RANGE = 3` tiles; uses `rangedMassAttack` at 3+ clustered enemies; kites when range < 2 using `Math.atan2` → DirectionConstant.

**Healer** (`healer.ts:49`): heals most-wounded platoon member; falls back to any fighter; uses `rangedHeal` at range ≤ 3.

## Harvester Modes (`harvester.ts`)

**Stationary** (container within range 1 of source):
- Parks on container tile (`harvester.ts:20`)
- Harvests → transfers to nearby link (if free capacity) → container
- Container: `FIND_STRUCTURES range 1` from source — checked in `findNearbyContainer` at `:93`

**Mobile** (no container yet):
- Harvest → deliver to spawn/ext/tower → upgrade controller as fallback
- Source assignment: least-contested source, stored in `creep.memory.sourceId`

## Key Constants Per Role

| Constant | Value | File:Line |
|----------|-------|-----------|
| `SPAWN_FILL_THRESHOLD` | 0.8 (80%) | harvester.ts:100 |
| `STALE_TICKS` | 500t | scout.ts:6 |
| `BORDER_STALE_TICKS` | 100t | scout.ts:7 |
| `MIN_LOOT_AMOUNT` | 30e | scavenger.ts:6 |
| `RETREAT_THRESHOLD` | 0.3 (30% HP) | warrior.ts:3 |
| `RETREAT_HP` | 0.25 (25% HP) | ranger.ts:4 |
| `KITE_RANGE` | 3 tiles | ranger.ts:5 |
| `HEAL_THRESHOLD` | 0.85 (85% HP) | healer.ts:6 |
| `RAMPART_MIN_HITS` | 50,000 | repairer.ts:4 |
| `WALL_MIN_HITS` | 10,000 | repairer.ts:5 |

## CreepMemory Fields Per Role

| Field | Roles that use it | Notes |
|-------|------------------|-------|
| `working` | harvester, hauler, upgrader, builder, repairer, scavenger, courier | harvest↔deliver toggle |
| `sourceId` | harvester | `Id<Source>` — assigned source |
| `targetRoomName` | scout, warrior, ranger, healer, claimer | current destination room |
| `scoutComplete` | scout | prevents re-recording intel on same tick |
| `homeRoom` | warrior, ranger, healer, scavenger, courier | spawning room — retreat & dispatch recall |
| `defendingRoom` | warrior, ranger, healer | set by defenseManager; cleared on recall |
| `platoonId` | warrior, ranger, healer | platoon grouping for tactics + healing |
| `scavengeRoom` | scavenger | optional remote room to loot after own room is clear |
| `courierTarget` | courier | destination room to deliver energy to |

## Gotchas
- `harvester` stationary mode: `findNearbyContainer` searches `range 1` from the *source*, not the creep. Harvesters must be on the container tile to mine directly into it.
- `builder` collects from containers only once containers exist. Pre-container, it harvests directly (bootstrap). After first source container appears, direct harvesting stops.
- `scout` covers ALL owned rooms' exits — with 4 owned rooms this covers all 4 defensive perimeters at 100-tick refresh.
- `warrior`/`ranger`/`healer` `isHome()` uses `creep.memory.homeRoom` if set; falls back to "any owned room" for legacy creeps without `homeRoom`.
- Combat roles check `defendingRoom` only when `combatState === 'RALLY'`. If the bot is in MARCH/ENGAGE (active offense), those units stay on mission — defense must rely on locally spawned units.
- Scavenger does NOT withdraw from containers (that competes with builders/upgraders). It only touches tombstones and dropped resources.
- Courier bodies have no TOUGH — they only travel through owned rooms. If a courier route crosses hostile territory, assign a warrior escort instead.
