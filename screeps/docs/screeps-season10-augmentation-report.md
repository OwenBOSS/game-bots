# Screeps Season 10 — Strategy Augmentation

> This document augments `screeps_rc_strategy.md` with Season 10-specific mechanics and overrides. Read it as a diff on top of the base strategy — wherever this doc conflicts with the base strategy, **this document takes priority**.

---

## Part 1 — Season 10 Rule Changes & Their Implications

### What's Different From Standard Play

| Rule | Standard Game | Season 10 |
|------|---------------|-----------|
| Market | Available | **Disabled** |
| Terminal sends | Any player | **Own terminals only** |
| CPU | Varies by subscription | **Flat 100 CPU for everyone** |
| Win condition | None (sandbox) | **Most Score collected wins** |
| GCL/GPL start | Persists from account | **Everyone starts at GCL 1** |

### Critical Strategic Implications

**No market** means energy cannot be bought or sold. Every joule must be harvested. This makes remote mining even more important — you cannot buy your way out of an energy deficit. Labs and minerals are also deprioritized since you cannot sell outputs or buy inputs from other players.

**Terminals send to own rooms only** means terminals are still useful as inter-room energy pipelines between your own claimed rooms, but have no PvP trading value. Build them for logistics, not commerce.

**Flat 100 CPU for everyone** is the great equalizer. A highly optimized script at 100 CPU beats a sloppy one at 100 CPU hard. CPU efficiency is a first-class concern this season. Cache paths, cache CostMatrices, avoid redundant `find()` calls, and batch Memory writes.

**GCL 1 start** means everyone begins with the ability to claim exactly 1 room. You cannot claim a second room until GCL 2, which requires significant upgrade XP from your first room. This narrows the early game significantly — the first days are a race to GCL 2, not just RC2.

---

## Part 2 — The Score Object API

```typescript
// Season 10 constants (available globally)
const FIND_SCORES = 10031;        // use with room.find()
const LOOK_SCORE = 'score';       // use with room.lookForAt()
const SCORE_SPAWN_CHANCE = 0.01;  // 1% chance per interval
const SCORE_SPAWN_INTERVAL_TICKS = 250; // checked every 250 ticks
```

### Score Object Properties

| Property | Type | Description |
|----------|------|-------------|
| `score` | number | The point value of this Score item |
| `ticksToDecay` | number | Ticks remaining before it disappears |
| `pos` | RoomPosition | Location in the room |
| `id` | string | Unique ID (use with `Game.getObjectById`) |

### How to Find and Collect Scores

```typescript
// Find all Score items visible in a room
const scores = room.find(FIND_SCORES);
// scores is Score[]

// Look for a Score at a specific position
const atPos = room.lookForAt(LOOK_SCORE, x, y);
// atPos is Score[]

// Collect: simply move a creep onto the Score's position
// Collection is automatic on tile entry — no action call needed
creep.moveTo(score.pos);
```

### Spawn Rate Math

Score objects spawn with a `SCORE_SPAWN_CHANCE` of 1% per `SCORE_SPAWN_INTERVAL_TICKS` (every 250 ticks). This means roughly **1 Score every 25,000 ticks per eligible room on expectation**, but spawn is random so actual distribution is uneven. Scores can appear in any room — owned, reserved, or neutral. Your scanner creeps and observers must cover as much territory as possible.

### Score Decay

Score objects have `ticksToDecay` — they expire if not collected. Based on the screenshot showing the shield badges with value `10`, Scores have a visible numerical value that varies. **Prioritize higher-value Scores** if multiple are visible and your collector is equidistant.

---

## Part 3 — Overarching Season Strategy

### The Core Loop (Replacing Standard Win Condition)

In standard Screeps, you win by out-growing competitors. In Season 10, you win by **collecting more Score items than anyone else**. This reframes every decision:

> **Economy exists to fund collector creeps. Collector creeps exist to collect Score. Everything else is infrastructure.**

The three pillars are:

1. **Coverage** — Scores spawn in all rooms. The more rooms you can observe and reach, the more Score you collect.
2. **Speed** — Scores decay. Your collectors must be fast enough to reach them before they expire or another player grabs them.
3. **Throughput** — More collectors = more Score per interval. Spawn capacity is your ceiling.

### The Flat 100 CPU Constraint Changes the Calculus

In standard play, efficiency matters but you can brute-force with more CPU. Here, everyone has the same ceiling. The winners will be players whose code is lean enough that 100 CPU covers: room economy logic, all creep movement, Score detection across visible rooms, and path caching.

**Practical CPU budget target:**
- Economy logic (harvesters, haulers, upgraders, builders): ~35 CPU
- Military / tower logic: ~10 CPU
- Score detection and collector tasking: ~20 CPU
- Pathfinding (amortized via caching): ~25 CPU
- Buffer: ~10 CPU

If you exceed budget, shed economy creeps before shedding collectors. Score is the win condition.

---

## Part 4 — New Creep Role: Collector

The Collector is the most important role in Season 10. It has one job: move to a Score item and step on it.

### Collector Body Design

Speed is paramount. A Collector needs enough MOVE parts to traverse any terrain at full speed, and TOUGH parts are cheap filler if you want to absorb hits while running through contested territory.

| Phase | Body | Cost | Speed (plain/swamp) |
|-------|------|------|---------------------|
| RC1–2 | `[MOVE, MOVE, MOVE, TOUGH]` | 160e | 1 tile/tick plain |
| RC3–4 | `[MOVE×5, TOUGH×5]` | 300e | 1 tile/tick all terrain |
| RC5+  | `[MOVE×10, TOUGH×10, ATTACK×2]` | 660e | 1 tile/tick + light combat |

**Key insight:** A pure-MOVE Collector is faster and cheaper than any other role. CARRY parts add no value — Scores are collected by stepping on them, not by carrying them. ATTACK parts are optional but useful for denying enemy collectors in contested rooms.

### Collector TypeScript Interface

```typescript
interface CollectorMemory extends CreepMemory {
  role: 'collector';
  targetScoreId: Id<Score> | null;
  homeRoom: string;
}

function runCollector(creep: Creep): void {
  const mem = creep.memory as CollectorMemory;

  // Validate existing target still exists and hasn't decayed
  if (mem.targetScoreId) {
    const target = Game.getObjectById(mem.targetScoreId);
    if (!target) {
      mem.targetScoreId = null; // expired or collected
    }
  }

  // Assign new target: find best Score across all visible rooms
  if (!mem.targetScoreId) {
    mem.targetScoreId = findBestScore(creep);
  }

  if (mem.targetScoreId) {
    const target = Game.getObjectById(mem.targetScoreId)!;
    creep.moveTo(target.pos, { reusePath: 20, visualizePathStyle: {} });
  } else {
    // No known Score: patrol toward home room or last known hotspot
    creep.moveTo(new RoomPosition(25, 25, mem.homeRoom), { reusePath: 50 });
  }
}

function findBestScore(creep: Creep): Id<Score> | null {
  let best: Score | null = null;
  let bestValue = -1;

  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    const scores = room.find(FIND_SCORES);
    for (const score of scores) {
      // Score value weighted by distance and decay urgency
      const dist = Game.map.getRoomLinearDistance(creep.room.name, roomName);
      const urgency = score.ticksToDecay < 500 ? 2 : 1;
      const value = (score.score * urgency) / (dist + 1);
      if (value > bestValue) {
        bestValue = value;
        best = score;
      }
    }
  }

  return best ? best.id : null;
}
```

> **Important:** `reusePath: 20` is essential for CPU budget. Recalculating paths every tick for many collectors will blow your 100 CPU limit. Cache aggressively.

---

## Part 5 — Score Detection: Scanning Strategy

Since Scores appear in any room, visibility is your biggest advantage. You need eyes in as many rooms as possible.

### Phase 1 (RC1–4): Scout Creeps

Before you have an Observer, use lightweight scout creeps to expand visibility.

```typescript
// Scout body: pure movement, visits rooms and reports back
// [MOVE] — 50e, lasts 1500 ticks, covers ~750 rooms in its lifetime
const SCOUT_BODY = [MOVE];
```

Scouts roam in a grid pattern, making adjacent rooms visible each tick. When a Scout enters a room, your main loop can read `room.find(FIND_SCORES)` because that room is now visible. Store known Score locations in Memory with their `ticksToDecay` so Collectors can be dispatched even after the Scout has moved on.

```typescript
// In main loop: scan all visible rooms for Scores, cache results
interface ScoreCache {
  [scoreId: string]: {
    pos: { x: number; y: number; roomName: string };
    value: number;
    expiresAt: number; // Game.time + ticksToDecay at time of scan
  };
}

function scanForScores(): void {
  if (!Memory.scoreCache) Memory.scoreCache = {};
  const cache = Memory.scoreCache as ScoreCache;

  // Purge expired entries
  for (const id in cache) {
    if (cache[id].expiresAt <= Game.time) delete cache[id];
  }

  // Update from visible rooms
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    const scores = room.find(FIND_SCORES);
    for (const score of scores) {
      cache[score.id] = {
        pos: { x: score.pos.x, y: score.pos.y, roomName },
        value: score.score,
        expiresAt: Game.time + score.ticksToDecay,
      };
    }
  }
}
```

### Phase 2 (RC8): Observer

At RC8, the Observer lets you call `observer.observeRoom(targetRoom)` once per tick to make any room within 10 rooms visible. Rotate through a priority list of rooms that historically produce Scores, or use a round-robin over your entire sector. This completely replaces scout creeps for your owned sector.

---

## Part 6 — RC-Level Priority Overrides for Season 10

The following overrides apply on top of the base strategy. The core RC rush is still correct — more RC = more spawn capacity = more collectors.

### RC1 — Same as Base, But Spawn a Scout Immediately

As soon as bootstrap upgrader-harvesters are running, spawn one `[MOVE]` scout. It costs 50e and begins expanding your visibility immediately. Scores at RC1 value are low-hanging fruit — a single collector running as a bootstrap harvester can double-task if a Score spawns in your room.

**Additional RC1 logic:**
```typescript
// In your RC1 creep loop: if creep is on a Score tile, it auto-collects.
// So even harvesters passing through Score tiles contribute.
// No special code needed — just don't block movement.
```

### RC2 — Launch First Dedicated Collector

At RC2 you have 550e capacity. Spawn your first dedicated Collector (`[MOVE, MOVE, MOVE, TOUGH]`, 160e) as soon as your economy is stable enough to sustain the spawn cost. This collector will rove adjacent rooms looking for Scores.

**Collector quota at RC2:** 1 (economy is still fragile)

**Override:** The base strategy says "spawn a reserver" at RC2 as the first priority after extensions. For Season 10, **the first dedicated Collector takes priority over the first Reserver.** Score is the win condition. Reserve rooms as soon as Collector count reaches 2.

### RC3 — Collector Scaling Begins

At RC3 (800e capacity, tower online), bump Collector quota to 3. Tower handles defense so your collectors can roam freely. Scale up Scout body as well.

**Collector body at RC3:** `[MOVE×5, TOUGH×5]` — 300e, moves at full speed on all terrain.

### RC4 — Storage + Dedicated Score Economy

Storage (RC4) changes how you fund Collectors. With a buffer of energy, you can spawn multiple Collectors in succession without energy starvation between spawns.

**Dynamic Collector quota based on storage:**
```typescript
function getCollectorQuota(room: Room): number {
  const storage = room.storage;
  if (!storage) return 2;
  const energy = storage.store[RESOURCE_ENERGY];
  if (energy > 200000) return 8;
  if (energy > 100000) return 5;
  if (energy > 50000)  return 3;
  return 2;
}
```

### RC5+ — Collector Becomes Primary Spawn Priority

Once you have Links handling controller energy delivery, upgraders become more passive. At RC5+:

**Spawn priority order:**
1. Harvesters (economy baseline — never skip)
2. Haulers (keep storage filling)
3. Collectors ← **moved up from RC4 onward**
4. Upgraders (only if storage > 50,000 energy)
5. Builders / defenders as needed

This is a departure from the base strategy, which treats upgraders as higher priority. In Season 10, Score is worth more than RCL speed once you're past RC5.

### RC8 — Observer-Driven Score Hunting

At RC8, activate the Observer rotation system. Maintain a list of `hotRooms` — rooms that have historically had Score spawns near them — and prioritize those in the rotation.

```typescript
// Observer rotation pattern
const observerTargets: string[] = [
  // Pre-populate with rooms adjacent to your territory
  // and rooms with high historical Score density
  'W5N5', 'W6N5', 'W5N6', /* ... */
];

let observerIndex = 0;

function runObserver(observer: StructureObserver): void {
  const target = observerTargets[observerIndex % observerTargets.length];
  observer.observeRoom(target);
  observerIndex++;
}
```

---

## Part 7 — Score Contest: PvP Implications

Scores appear in **all rooms**, including neutral and enemy-owned rooms. This creates natural conflict.

### Contested Score Rules

When another player's collector is racing toward the same Score:
- The player who **steps on the tile first** collects it — no interaction needed.
- An `[ATTACK]` creep can kill an enemy collector before it reaches the Score.
- An enemy collector inside ramparts cannot be reached by your attackers until they breach the rampart.

### Season 10 Military Adjustments

The base strategy's military integration still applies, but the **offensive priority shifts**: instead of raiding for economic attrition, your military focus is **Score denial** — killing enemy collectors near high-value Scores.

**Collector-hunter body:**
```typescript
// RC3+: fast attacker designed to intercept enemy collectors
// [ATTACK×3, MOVE×3] — 390e, 30 DPS, fast enough to catch most collectors
const HUNTER_BODY = [ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE];
```

**When to spawn hunters:** Only when you detect enemy creeps in rooms where a Score is known to be present (`Memory.scoreCache` has entries in rooms where `room.find(FIND_HOSTILE_CREEPS).length > 0`).

### Defending Your Collectors

Your own collectors are legitimate military targets. They are unarmed (`[MOVE, TOUGH]`) and cannot fight back. Protect them in two ways:

1. **Route through your own territory** when possible — towers and ramparts protect them in transit.
2. **Escort** high-value Scores with a hunter that trails the collector into hostile rooms.

---

## Part 8 — CPU Budget: TypeScript Implementation Notes

With 100 CPU hard cap, CPU hygiene is non-negotiable. These patterns apply throughout your TypeScript codebase.

### Path Caching (Essential)

```typescript
// Never call moveTo without reusePath in Season 10
creep.moveTo(target, { reusePath: 20 }); // standard
creep.moveTo(target, { reusePath: 50 }); // for long-distance scouts
```

### Lazy Room Scanning

```typescript
// Only scan for Scores every N ticks, not every tick
function shouldScanThisTick(): boolean {
  return Game.time % 10 === 0; // scan 10% of ticks
}
```

### Avoid Redundant find() Calls

```typescript
// Cache find results per tick using a module-level map
const tickCache = new Map<string, RoomObject[]>();

function findCached<T extends RoomObject>(
  room: Room,
  constant: FindConstant
): T[] {
  const key = `${room.name}-${constant}`;
  if (!tickCache.has(key)) {
    tickCache.set(key, room.find(constant));
  }
  return tickCache.get(key) as T[];
}

// Reset at top of main loop each tick
export function resetTickCache(): void {
  tickCache.clear();
}
```

### TypeScript Score Type Declaration

The Season 10 `Score` type isn't in standard Screeps TypeScript definitions. Declare it yourself:

```typescript
// types/season10.d.ts
declare const FIND_SCORES: 10031;
declare const LOOK_SCORE: 'score';
declare const SCORE_SPAWN_CHANCE: 0.01;
declare const SCORE_SPAWN_INTERVAL_TICKS: 250;

interface Score {
  readonly id: Id<Score>;
  readonly pos: RoomPosition;
  readonly room: Room;
  readonly score: number;
  readonly ticksToDecay: number;
  readonly effects: RoomObjectEffect[];
}

interface Room {
  find(type: 10031): Score[];
  lookForAt(type: 'score', x: number, y: number): Score[];
  lookForAt(type: 'score', pos: RoomPosition): Score[];
}
```

---

## Part 9 — Season 10 Transition Handler Additions

Add these cases to the `onRCLevelUp` handler from the base strategy:

| RC Level | Season 10 Additional Actions |
|----------|------------------------------|
| RC1      | Spawn 1 Scout `[MOVE]` immediately after first harvester. |
| RC2      | Spawn 1 Collector before Reserver. Initialize `Memory.scoreCache = {}`. |
| RC3      | Bump Collector quota to 3. Enable Score cache scanning every 10 ticks. |
| RC4      | Enable dynamic Collector quota based on storage level. |
| RC5      | Promote Collectors above Upgraders in spawn priority. |
| RC8      | Enable Observer rotation. Expand `observerTargets` to cover full sector. |

---

## Part 10 — Key Deviations from Standard Strategy Summary

| Topic | Standard Strategy | Season 10 Override |
|-------|------------------|--------------------|
| Win condition | RC8 + economic dominance | Score collection |
| Primary spawn priority (RC5+) | Upgraders | Collectors |
| Terminal use | Market trading | Inter-room logistics only |
| Labs / minerals | Active pipeline | Deprioritize — no market |
| Military objective | Economic attrition / raiding | Score denial / collector escort |
| Reserver priority | First priority at RC2 | Second priority after first Collector |
| CPU approach | Flexible | Hard 100 CPU ceiling — cache everything |

---

*Score API sourced from `docs-season.screeps.com/api/#Score`. Season 10 constants: `FIND_SCORES = 10031`, `SCORE_SPAWN_CHANCE = 0.01`, `SCORE_SPAWN_INTERVAL_TICKS = 250`. Score objects are collected by moving a creep onto their tile — no action call required.*
