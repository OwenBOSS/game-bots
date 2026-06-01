# Getting Started with Screeps World

## What is Screeps?

Screeps World is a persistent MMO where you write JavaScript/TypeScript to control units called **creeps**.
Your code runs 24/7 on Screeps servers. Every ~0.5 seconds, the game advances one **tick** and runs your `loop()` function.

## Core Concepts

### Rooms
- The world is divided into rooms (e.g., `W1N1`, `E3S5`)
- You start with one room and can expand by claiming others
- Your spawn structure is in your home room

### Creeps
- Units you spawn from your `StructureSpawn`
- Built from **body parts** you specify at spawn time
- Body parts determine what the creep can do
- Creeps die after ~1500 ticks (TTL) unless boosted

### Energy Economy
- **Sources** generate energy (2000 capacity, refills every 300 ticks)
- Creeps harvest energy → deposit to spawn/extensions → spawn bigger creeps
- More energy infrastructure = better creeps = more power

### Room Control Level (RCL)
- Starts at 0, max is 8
- Upgrading your **Controller** increases RCL
- Higher RCL unlocks more structures (towers, storage, terminals, etc.)

## Key Body Parts

| Part | Cost | Action |
|------|------|--------|
| `MOVE` | 50 | Required for movement (1 MOVE per 2 other parts to move at full speed) |
| `WORK` | 100 | Harvest (2e/tick), upgrade controller (1e/tick), build (5e/tick) |
| `CARRY` | 50 | Hold up to 50 energy |
| `ATTACK` | 80 | Melee attack (30 damage/tick) |
| `RANGED_ATTACK` | 150 | Ranged attack up to 3 tiles |
| `HEAL` | 250 | Heal self or adjacent creep |
| `TOUGH` | 10 | Absorbs damage; cheap HP |

A `[WORK, CARRY, MOVE]` creep costs 200 energy and can harvest + carry + move at full speed.

## The Game Loop

Your `src/main.ts` exports a `loop()` function that runs every tick:

```typescript
export function loop(): void {
    // Clean up dead creep memory first (always do this)
    for (const name in Memory.creeps) {
        if (!Game.creeps[name]) delete Memory.creeps[name];
    }

    // Your bot logic here
}
```

## Important APIs

```typescript
// Find your creeps
const myCreeps = Object.values(Game.creeps);

// Find sources in current room
const sources = room.find(FIND_SOURCES_ACTIVE);

// Move to a target (with built-in pathfinding)
creep.moveTo(target);

// Harvest a source
creep.harvest(source);   // returns OK or error code

// Transfer energy to a structure
creep.transfer(spawn, RESOURCE_ENERGY);

// Upgrade the controller
creep.upgradeController(room.controller!);

// Check energy in store
creep.store.getUsedCapacity(RESOURCE_ENERGY)
creep.store.getFreeCapacity()

// Spawn a creep
spawn.spawnCreep([WORK, CARRY, MOVE], 'MyCreep1', { memory: { role: 'harvester', working: false } });
```

## Next Steps

1. Read [screeps-world-api.md](screeps-world-api.md) for API patterns
2. Start with the `economy-first` strategy — it's the most educational
3. Deploy to the Screeps Simulation first (free, no account needed)
4. Log your experiments in [../experiments/README.md](../experiments/README.md)
