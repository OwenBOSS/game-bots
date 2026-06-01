# Screeps World API Reference Notes

Key patterns and gotchas from the [official docs](https://docs.screeps.com/api/).

## Return Codes

All creep actions return a code. Always check it:

```typescript
const result = creep.harvest(source);
if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(source);
} else if (result === OK) {
    // success
}
```

Common codes: `OK (0)`, `ERR_NOT_IN_RANGE (-9)`, `ERR_BUSY (-4)`, `ERR_NOT_ENOUGH_ENERGY (-6)`, `ERR_FULL (-8)`

## Memory System

Screeps provides a global `Memory` object that persists between ticks (stored as JSON):

```typescript
// Creep memory - auto-cleaned if you delete dead creep entries
creep.memory.role = 'harvester';
creep.memory.working = true;

// Room memory
room.memory.someFlag = true;

// Global memory
Memory.globalCounter = (Memory.globalCounter || 0) + 1;
```

Always clean up dead creep memory at the start of loop:
```typescript
for (const name in Memory.creeps) {
    if (!Game.creeps[name]) delete Memory.creeps[name];
}
```

## Finding Objects

```typescript
// All creeps in a room
room.find(FIND_MY_CREEPS)
room.find(FIND_HOSTILE_CREEPS)

// Sources
room.find(FIND_SOURCES)         // all sources
room.find(FIND_SOURCES_ACTIVE)  // sources with energy > 0

// Structures
room.find(FIND_MY_STRUCTURES)
room.find(FIND_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_TOWER
})

// Construction sites
room.find(FIND_CONSTRUCTION_SITES)
room.find(FIND_MY_CONSTRUCTION_SITES)

// With filter
room.find(FIND_MY_STRUCTURES, {
    filter: (s): s is StructureExtension =>
        s.structureType === STRUCTURE_EXTENSION &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
})
```

## Pathfinding

`moveTo()` uses built-in A* pathfinding with caching. It's convenient but expensive if called for many creeps:

```typescript
// Simple
creep.moveTo(target);

// With visualization (dev only — remove for prod)
creep.moveTo(target, { visualizePathStyle: { stroke: '#ffaa00' } });

// Reuse cached path for multiple ticks (saves CPU)
creep.moveTo(target, { reusePath: 5 });

// Manual pathfinding for performance
const path = PathFinder.search(creep.pos, { pos: target.pos, range: 1 });
creep.moveByPath(path.path);
```

## Spawning Creeps

```typescript
const canSpawn = spawn.spawnCreep(body, name, opts);

if (spawn.spawning) {
    // Currently spawning — cannot spawn another
}

// Check cost before spawning
const cost = body.reduce((sum, part) => sum + BODYPART_COST[part], 0);
if (room.energyAvailable >= cost) {
    spawn.spawnCreep([WORK, CARRY, MOVE], `creep_${Game.time}`);
}
```

## Structures

```typescript
// Spawn energy
spawn.store.getUsedCapacity(RESOURCE_ENERGY)
spawn.store.getFreeCapacity(RESOURCE_ENERGY)  // capacity - used

// Tower (attacks enemies in room automatically)
tower.attack(hostile);      // range 20, damage 150-600
tower.heal(myCreep);

// Controller
room.controller?.level       // RCL 0-8
room.controller?.progress    // current XP
room.controller?.progressTotal  // XP needed for next level
```

## Useful Patterns

### State Machine Pattern (recommended for roles)
```typescript
function runHarvester(creep: Creep): void {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }

    if (creep.memory.working) {
        // deliver energy
    } else {
        // harvest energy
    }
}
```

### Caching Expensive Finds
```typescript
// Cache room targets for 10 ticks to save CPU
if (!Memory.cache || Game.time % 10 === 0) {
    Memory.cache = room.find(FIND_MY_STRUCTURES).map(s => s.id);
}
```

### Unique Creep Names
```typescript
const name = `${role}_${Game.time}`;
```

## CPU Budget

- Each tick you get `Game.cpuLimit` CPU (usually 20ms for subscription, 10ms free)
- Check usage with `Game.cpu.getUsed()`
- Over-budget ticks are throttled

```typescript
export function loop(): void {
    // ... your code ...
    if (Game.cpu.getUsed() > Game.cpuLimit * 0.9) {
        console.log('CPU warning:', Game.cpu.getUsed());
    }
}
```
