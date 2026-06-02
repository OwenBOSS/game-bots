# Screeps Bots

## Purpose
TypeScript bots for Screeps World (shard3) and Season 10 free event. One deployable strategy per subfolder; each compiles to a single `dist/main.js` bundled by rollup.

## Active Strategy
`strategies/adaptive/` — production bot. Per-room ECONOMY→ASSESS→RUSH/DEFEND phase machine, 12 creep roles, dynamic body scaling, bottleneck-aware economy, multi-room defense coordination, inter-room energy transfer, and per-room independent offense campaigns.

## Test-Driven Development

We use **Vitest** for unit testing. Tests live in `strategies/<name>/src/__tests__/`.

```bash
cd strategies/adaptive
npm test            # run all tests once
npm run test:watch  # watch mode
npm run test:coverage
```

**Write tests before or alongside new logic.** Key rules:
- Every new manager function and utility needs tests in `src/__tests__/`.
- Mock the Screeps API via `src/__tests__/setup.ts` (globals) and `src/__tests__/helpers.ts` (Room/Source/Container factories).
- Don't test Screeps engine behavior — test your own logic only.
- Test files must end in `.test.ts`.

Current test coverage:
- `bodyBuilder.ts` — all roles, budget scaling, caps, part ordering
- `economyManager.ts` — bottleneck detection, `calcDynamicTargets`, `trackEnergyFlow`
- `strategyManager.ts` — full FSM: ECONOMY/ASSESS/RUSH/DEFEND transitions, safe mode override

## Deploy Workflow
```bash
cd strategies/<name>
npm install
npm run deploy   # builds TypeScript → copies dist/main.js to AppData Screeps branch
```
Scripts land at: `C:\Users\owenb\AppData\Local\Screeps\scripts\screeps.com\<strategy-name>\`

## Strategy Branches
| Folder | Screeps Branch | Purpose |
|--------|---------------|---------|
| `adaptive` | adaptive | Production bot — see `adaptive/CLAUDE.md` |
| `economy-first` | economy-first | Economy baseline (no combat) |
| `rush` | rush | Aggressive early attack |
| `season10` | season10 | Score-collection (Season 10 event, starts June 3rd) |

## Key Design Decisions
- **Stationary harvesters** park on source containers; **haulers** do all energy delivery
- **Builders** collect from containers only — no source competition with harvesters
- **Economy bottleneck detection** — spawn targets adapt to HARVESTER_SHORTAGE / HAULER_SHORTAGE / SOURCE_MAXED each tick
- **Multi-room defense** — scouts patrol all owned room borders at 100t refresh; `defenseManager` dispatches idle combat units cross-room on ACTIVE threat
- **Per-room offense** — each owned room runs an independent ECONOMY/ASSESS/RUSH/DEFEND FSM stored in `room.memory`. Rooms A and B can simultaneously RUSH different targets.
- **Scavengers** — collect dropped energy and tombstones in own room; can be sent to enemy/neutral rooms via `creep.memory.scavengeRoom`
- **Couriers** — physically carry energy between rooms pre-RCL6; `transferManager` switches to terminal at RCL6+
- **bodyBuilder.ts** scales all creep bodies to available energy budget dynamically
- **Expansion** auto-triggers at RCL 4 + available GCL slot
- **Energy tracking is per-room** (`room.memory.energyStatus`) — safe for multi-room ownership

## In-Game Debugging
```js
// Live economy status for a room (run in Screeps console):
JSON.stringify(Game.rooms['W1N1'].memory.energyStatus)

// Per-room offense state:
JSON.stringify(Game.rooms['W1N1'].memory.phase)   // ECONOMY/ASSESS/RUSH/DEFEND
JSON.stringify(Game.rooms['W1N1'].memory.combatState)  // RALLY/MARCH/ENGAGE
Game.rooms['W1N1'].memory.enemyRoomName           // current attack target

// Active defense threats:
JSON.stringify(Memory.roomThreats)

// Rolling stats history (last ~500 snapshots):
JSON.stringify(Memory.statsLog)

// Specific field over time:
Memory.statsLog.map(s => [s.tick, s.rcl, s.energy.avail])

// Scout intel on adjacent rooms:
JSON.stringify(Memory.roomIntel)

// Send scavenger to loot an enemy room:
Game.creeps['scavenger_1234'].memory.scavengeRoom = 'W5N3'

// Check inter-room energy surplus:
Object.keys(Game.rooms).filter(r => Game.rooms[r].controller?.my)
  .map(r => [r, Game.rooms[r].memory.energySurplus])

// Season10: current score map (rooms with active scores):
JSON.stringify(Memory.scoreMap)
```

## References
- `strategies/adaptive/CLAUDE.md` — full manager execution order, Memory registry, symbol index
- `strategies/adaptive/src/managers/CLAUDE.md` — per-manager exports, constants, spawn priority
- `strategies/adaptive/src/roles/CLAUDE.md` — per-role behavior, constants, CreepMemory fields
- `strategies/season10/GAME_PLAN.md` — Season 10 strategy and day-of playbook
- `docs/getting-started.md` — Screeps concepts and API patterns
- `docs/screeps-world-api.md` — key API patterns and gotchas
- `experiments/` — logged test runs
- `AGENTS.md` — strategy review agent spec
