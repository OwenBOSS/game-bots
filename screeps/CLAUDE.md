# Screeps Bots

## Purpose
TypeScript bots for Screeps World (shard3) and Season 10 free event. One deployable strategy per subfolder; each compiles to a single `dist/main.js` bundled by rollup.

## Active Strategy
`strategies/adaptive/` — production bot. ECONOMY→ASSESS→RUSH/DEFEND phase machine, 10 creep roles, dynamic body scaling, bottleneck-aware economy, and multi-room defense coordination.

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
| `season10` | season10 | Score-collection (Season events) |

## Key Design Decisions
- **Stationary harvesters** park on source containers; **haulers** do all energy delivery
- **Builders** collect from containers only — no source competition with harvesters
- **Economy bottleneck detection** — spawn targets adapt to HARVESTER_SHORTAGE / HAULER_SHORTAGE / SOURCE_MAXED each tick
- **Multi-room defense** — scouts patrol all owned room borders at 100t refresh; `defenseManager` dispatches idle combat units cross-room on ACTIVE threat
- **bodyBuilder.ts** scales all creep bodies to available energy budget dynamically
- **Expansion** auto-triggers at RCL 4 + available GCL slot
- **Energy tracking is per-room** (`room.memory.energyStatus`) — safe for multi-room ownership

## In-Game Debugging
```js
// Live economy status for a room (run in Screeps console):
JSON.stringify(Game.rooms['W1N1'].memory.energyStatus)

// Active defense threats:
JSON.stringify(Memory.roomThreats)

// Rolling stats history (last ~500 snapshots):
JSON.stringify(Memory.statsLog)

// Specific field over time:
Memory.statsLog.map(s => [s.tick, s.rcl, s.energy.avail])

// Scout intel on adjacent rooms:
JSON.stringify(Memory.roomIntel)
```

## References
- `strategies/adaptive/CLAUDE.md` — full manager execution order, Memory registry, symbol index
- `strategies/adaptive/src/managers/CLAUDE.md` — per-manager exports, constants, spawn priority
- `strategies/adaptive/src/roles/CLAUDE.md` — per-role behavior, constants, CreepMemory fields
- `docs/getting-started.md` — Screeps concepts and API patterns
- `docs/screeps-world-api.md` — key API patterns and gotchas
- `experiments/` — logged test runs
- `AGENTS.md` — strategy review agent spec
