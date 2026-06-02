// Hauler: decouples harvesting from delivery.
// Collection priority: hub link > fullest container > storage > dropped > harvest
// Delivery priority: extensions > spawn > towers > storage
//
// Remote mode (creep.memory.remoteRoom set): cross-room hauler that collects from
// a reserved room's containers and delivers to homeRoom's storage.
//
// CPU optimisation: target IDs are cached in creep.memory.targetId so
// findClosestByPath is only called when the cached target is gone or empty.

export function runHauler(creep: Creep): void {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }

    if (creep.memory.remoteRoom) {
        creep.memory.working ? deliverRemote(creep) : collectRemote(creep);
    } else {
        creep.memory.working ? deliver(creep) : collect(creep);
    }
}

// ─── Remote mode ─────────────────────────────────────────────────────────────

function collectRemote(creep: Creep): void {
    const remote = creep.memory.remoteRoom!;

    if (creep.room.name !== remote) {
        moveToRoom(creep, remote);
        return;
    }

    // Tombstones first (about to vanish)
    const tomb = creep.pos.findClosestByPath(FIND_TOMBSTONES, {
        filter: t => t.store[RESOURCE_ENERGY] >= 50,
    });
    if (tomb) {
        if (creep.withdraw(tomb, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(tomb, { reusePath: 3 });
        return;
    }

    // Containers (filled by remote miners)
    const container = getCachedContainer(creep, remote);
    if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(container, { reusePath: 5 });
        }
        return;
    }

    // Dropped energy
    const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: r => r.resourceType === RESOURCE_ENERGY && r.amount >= 50,
    });
    if (dropped) {
        if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) creep.moveTo(dropped, { reusePath: 3 });
        return;
    }

    // Nothing to collect — go home rather than idle
    const home = creep.memory.homeRoom;
    if (home) moveToRoom(creep, home);
}

function deliverRemote(creep: Creep): void {
    const home = creep.memory.homeRoom;
    if (!home) return;

    if (creep.room.name !== home) {
        moveToRoom(creep, home);
        return;
    }

    // Deposit into storage (remote energy goes straight to buffer)
    const storage = creep.room.storage;
    if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        if (creep.transfer(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(storage, { reusePath: 5 });
        }
        return;
    }

    // Fallback: fill spawn/extensions if storage is absent or full
    const spawn = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: (s): s is StructureSpawn | StructureExtension =>
            (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });
    if (spawn) {
        if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) creep.moveTo(spawn, { reusePath: 5 });
    }
}

// ─── Normal mode ──────────────────────────────────────────────────────────────

function collect(creep: Creep): void {
    // 1. Hub links — energy teleported from sources, no travel needed
    const link = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: s =>
            s.structureType === STRUCTURE_LINK &&
            (s as StructureLink).store[RESOURCE_ENERGY] >= 400,
    }) as StructureLink | null;
    if (link) {
        if (creep.withdraw(link, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(link, { reusePath: 5 });
        }
        return;
    }

    // 2. Source containers only — skip controller container (upgraders drain that)
    const container = getCachedSourceContainer(creep);
    if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(container, { reusePath: 5 });
        }
        return;
    }

    // 3. Storage (surplus buffer)
    const storage = creep.room.storage;
    if (storage && storage.store[RESOURCE_ENERGY] >= 1000) {
        if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(storage, { reusePath: 5 });
        }
        return;
    }

    // 4. Dropped energy (tombstones, overflow)
    const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: r => r.resourceType === RESOURCE_ENERGY && r.amount >= 50,
    });
    if (dropped) {
        if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
            creep.moveTo(dropped, { reusePath: 3 });
        }
        return;
    }

    // 5. Direct harvest as last resort
    const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
        creep.moveTo(source, { reusePath: 5 });
    }
}

function deliver(creep: Creep): void {
    // Use cached delivery target ID to avoid findClosestByPath every tick
    const cached = creep.memory.targetId
        ? Game.getObjectById(creep.memory.targetId as Id<AnyStructure>)
        : null;

    let target: AnyStructure | null = null;

    if (cached && needsEnergy(cached)) {
        target = cached as AnyStructure;
    } else {
        creep.memory.targetId = undefined;
        target = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
            filter: s => needsEnergy(s),
        });
        if (target) creep.memory.targetId = target.id as string;
    }

    if (target) {
        if (creep.transfer(target as any, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(target, { reusePath: 5 });
        }
        return;
    }

    // Nothing needs energy — fill the hub container (non-source container near spawn)
    // so builders always have a local pickup point when storage doesn't exist yet.
    const hub = findHubContainer(creep.room);
    if (hub) {
        if (creep.transfer(hub, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(hub, { reusePath: 5 });
        }
    }
}

function needsEnergy(s: AnyStructure | null): boolean {
    if (!s) return false;
    if (s.structureType === STRUCTURE_EXTENSION) return (s as StructureExtension).store.getFreeCapacity(RESOURCE_ENERGY) > 0;
    if (s.structureType === STRUCTURE_SPAWN)     return (s as StructureSpawn).store.getFreeCapacity(RESOURCE_ENERGY) > 0;
    if (s.structureType === STRUCTURE_TOWER)     return (s as StructureTower).store.getFreeCapacity(RESOURCE_ENERGY) > 200;
    if (s.structureType === STRUCTURE_STORAGE)   return (s as StructureStorage).store.getFreeCapacity(RESOURCE_ENERGY) > 0;
    return false;
}

// ─── Container cache ──────────────────────────────────────────────────────────
// Reuses the same container until it runs dry, then re-picks the fullest.

// Local collect: only containers adjacent to a source (range 1).
// Prevents haulers from draining the controller container that upgraders need.
function getCachedSourceContainer(creep: Creep): StructureContainer | null {
    const cached = creep.memory.targetId
        ? Game.getObjectById(creep.memory.targetId as Id<StructureContainer>)
        : null;

    if (cached && (cached as StructureContainer).structureType === STRUCTURE_CONTAINER) {
        const c = cached as StructureContainer;
        if (c.store[RESOURCE_ENERGY] >= 50 && isAdjacentToSource(c, creep.room)) return c;
    }

    const sources = creep.room.find(FIND_SOURCES);
    const candidates: StructureContainer[] = [];
    for (const src of sources) {
        const near = src.pos.findInRange(FIND_STRUCTURES, 1, {
            filter: s => s.structureType === STRUCTURE_CONTAINER &&
                (s as StructureContainer).store[RESOURCE_ENERGY] >= 50,
        }) as StructureContainer[];
        candidates.push(...near);
    }

    if (candidates.length === 0) {
        creep.memory.targetId = undefined;
        return null;
    }

    const best = candidates.reduce((a, b) =>
        a.store[RESOURCE_ENERGY] >= b.store[RESOURCE_ENERGY] ? a : b
    );
    creep.memory.targetId = best.id as string;
    return best;
}

function isAdjacentToSource(container: StructureContainer, room: Room): boolean {
    return room.find(FIND_SOURCES).some(src => src.pos.isNearTo(container.pos));
}

// Returns the non-source container closest to spawn — the hub buffer for builders.
function findHubContainer(room: Room): StructureContainer | null {
    const sources = room.find(FIND_SOURCES);
    const containers = room.find(FIND_STRUCTURES, {
        filter: s => {
            if (s.structureType !== STRUCTURE_CONTAINER) return false;
            const c = s as StructureContainer;
            if (c.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) return false;
            return !sources.some(src => src.pos.isNearTo(c.pos));
        },
    }) as StructureContainer[];
    if (containers.length === 0) return null;
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return containers[0];
    return containers.reduce((best, c) =>
        c.pos.getRangeTo(spawn) < best.pos.getRangeTo(spawn) ? c : best
    );
}

function getCachedContainer(creep: Creep, inRoom: string): StructureContainer | null {
    if (creep.room.name !== inRoom) return null;

    const cached = creep.memory.targetId
        ? Game.getObjectById(creep.memory.targetId as Id<StructureContainer>)
        : null;

    if (cached && cached.structureType === STRUCTURE_CONTAINER &&
        (cached as StructureContainer).store[RESOURCE_ENERGY] >= 50) {
        return cached as StructureContainer;
    }

    // Re-find: pick the fullest container
    const containers = creep.room.find(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_CONTAINER &&
            (s as StructureContainer).store[RESOURCE_ENERGY] >= 50,
    }) as StructureContainer[];

    if (containers.length === 0) {
        creep.memory.targetId = undefined;
        return null;
    }

    const best = containers.reduce((a, b) =>
        a.store[RESOURCE_ENERGY] >= b.store[RESOURCE_ENERGY] ? a : b
    );
    creep.memory.targetId = best.id as string;
    return best;
}

function moveToRoom(creep: Creep, roomName: string): void {
    // Move toward room center — native pathfinder handles cross-room routing.
    // reusePath:20 caches the serialized path across ticks; range:23 stops as
    // soon as we're inside the room (within 23 tiles of center on a 50×50 grid).
    creep.moveTo(new RoomPosition(25, 25, roomName), { reusePath: 20, range: 23 });
}
