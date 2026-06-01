// Hauler: decouples harvesting from delivery.
// Collection priority: hub link > fullest container > storage > dropped > harvest
// Delivery priority: extensions > spawn > towers > storage

export function runHauler(creep: Creep): void {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }

    if (creep.memory.working) {
        deliver(creep);
    } else {
        collect(creep);
    }
}

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

    // 2. Containers (filled by stationary harvesters)
    const containers = creep.room.find(FIND_STRUCTURES, {
        filter: s =>
            s.structureType === STRUCTURE_CONTAINER &&
            (s as StructureContainer).store[RESOURCE_ENERGY] >= 50,
    }) as StructureContainer[];

    if (containers.length > 0) {
        const target = containers.reduce((a, b) =>
            a.store[RESOURCE_ENERGY] >= b.store[RESOURCE_ENERGY] ? a : b
        );
        if (creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(target, { reusePath: 5 });
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
    const target = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: s => {
            if (s.structureType === STRUCTURE_EXTENSION) {
                return (s as StructureExtension).store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
            if (s.structureType === STRUCTURE_SPAWN) {
                return (s as StructureSpawn).store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
            if (s.structureType === STRUCTURE_TOWER) {
                return (s as StructureTower).store.getFreeCapacity(RESOURCE_ENERGY) > 200;
            }
            if (s.structureType === STRUCTURE_STORAGE) {
                return (s as StructureStorage).store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
            return false;
        },
    });

    if (target) {
        if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(target, { reusePath: 5 });
        }
    }
}
