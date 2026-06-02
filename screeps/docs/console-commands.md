# Console Commands — Data Extraction

Commands for the Screeps in-game console to inspect colony state or pull data for external analysis.

## Quick Snapshots

### Economy
```js
JSON.stringify(Game.rooms['W1N1'].memory.energyStatus)
// { netRate, trend, pct, level: 'STABLE', bottleneck: 'BALANCED' }
```
- `level`: `SURPLUS | STABLE | DEFICIT | CRITICAL`
- `bottleneck`: `HARVESTER_SHORTAGE | HAULER_SHORTAGE | SOURCE_MAXED | BALANCED`

### Phase & Combat State
```js
JSON.stringify(Game.rooms['W1N1'].memory.phase)        // ECONOMY / ASSESS / RUSH / DEFEND
JSON.stringify(Game.rooms['W1N1'].memory.combatState)  // RALLY / MARCH / ENGAGE
Game.rooms['W1N1'].memory.enemyRoomName                // current attack target (string or null)
```

### Active Threats
```js
JSON.stringify(Memory.roomThreats)
// { 'W1N1': { severity: 'ACTIVE', hostileCount: 3, tick: 12345 }, ... }
```

### Scout Intel
```js
JSON.stringify(Memory.roomIntel)
// { 'W2N1': { strength: 8, enemySpawns: 1, towers: 2, enemyCreeps: 5, sourceCount: 2, scannedAt: 12345 } }
```

### Inter-Room Energy Balance
```js
Object.keys(Game.rooms)
  .filter(r => Game.rooms[r].controller?.my)
  .map(r => [r, Game.rooms[r].memory.energySurplus])
```

## Historical Data

### Full Rolling History (bulk export)
```js
JSON.stringify(Memory.statsLog)
```
Returns `StatSnapshot[]` — up to 500 entries, one recorded every 200 ticks (~6.7 min at shard3 speed).
Paste the output into `screeps/dashboard/data/history.json` for offline analysis.

### Specific Fields Over Time
```js
// tick + energy available
Memory.statsLog.map(s => [s.tick, s.energy.avail])

// energy fill %
Memory.statsLog.map(s => [s.tick, Math.floor(s.energy.avail / s.energy.cap * 100)])

// RCL + controller progress %
Memory.statsLog.map(s => [s.tick, s.rcl, s.ctrl?.pct])

// creep roster over time
Memory.statsLog.map(s => [s.tick, s.creeps])

// phase + combat state history
Memory.statsLog.map(s => [s.tick, s.phase, s.combat.state])

// structure counts over time
Memory.statsLog.map(s => [s.tick, s.structs])
```

## Utility / Control Commands

```js
// Force construction manager to re-plan roads:
Memory.roadsPlanned = false

// Send a scavenger to loot an enemy room:
Game.creeps['scavenger_1234'].memory.scavengeRoom = 'W5N3'

// Season 10 — active score object locations:
JSON.stringify(Memory.scoreMap)
```

---

## Automatic Console Reports

`statsReporter.ts` emits two streams without any manual intervention:

| Interval | Output |
|----------|--------|
| Every 50 ticks | Full report logged to console: `=== adaptive:stats:W1N1:12345 ===` followed by JSON |
| Every 200 ticks | Compact `StatSnapshot` appended to `Memory.statsLog` (rolling, max 500 entries) |

The 50-tick console report includes extra fields not stored in `statsLog`: per-tower charge %, weakest rampart HP, full `EnergyStatus`, and adjacent room intel ages.

---

## StatSnapshot Schema

Written to `Memory.statsLog` by [`statsReporter.ts:73`](../strategies/adaptive/src/managers/statsReporter.ts#L73).

```typescript
interface StatSnapshot {
  tick:   number;
  phase:  'ECONOMY' | 'ASSESS' | 'RUSH' | 'DEFEND';
  rcl:    number;                                     // 0–8
  energy: { avail: number; cap: number };
  creeps: Record<string, number>;                     // e.g. { harvester: 3, hauler: 2 }
  ctrl:   { pct: number; progress: number; total: number } | null;
  structs: {
    roads: number; containers: number; extensions: number;
    towers: number; ramparts: number;
  };
  combat: {
    state:    'RALLY' | 'MARCH' | 'ENGAGE';
    warriors: number;
    rangers:  number;
    target:   string | null;
  };
}
```

The full per-50-tick console report additionally includes:
- `energy.pct` — fill percentage
- `structures.towers.energy_pct` — per-tower charge % array
- `structures.ramparts.min_hits` — weakest rampart HP
- `sites_total` — total pending construction sites
- `economy` — full `EnergyStatus` (level, bottleneck, netRate, trend)
- `intel` — `{ [room]: { str, age } }` for all scanned rooms
- `log_entries` — current length of `Memory.statsLog`
