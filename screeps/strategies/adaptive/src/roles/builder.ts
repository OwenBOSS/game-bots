// Builder works through construction sites in explicit priority order so the most
// impactful structures are finished first regardless of physical proximity.
//
// Priority: containers → extensions → towers → ramparts → roads → repair → upgrade

export function runBuilder(creep: Creep): void {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }

    if (creep.memory.working) {
        const site = findBuildTarget(creep);
        if (site) {
            if (creep.build(site) === ERR_NOT_IN_RANGE) {
                creep.moveTo(site, { reusePath: 5 });
            }
            return;
        }

        // Repair roads below 50% before falling back to upgrading
        const damagedRoad = creep.pos.findClosestByPath(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_ROAD && s.hits < s.hitsMax * 0.5,
        });
        if (damagedRoad) {
            if (creep.repair(damagedRoad) === ERR_NOT_IN_RANGE) {
                creep.moveTo(damagedRoad, { reusePath: 5 });
            }
            return;
        }

        // Nothing left to build — upgrade the controller
        const controller = creep.room.controller;
        if (controller) {
            if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
                creep.moveTo(controller, { reusePath: 5 });
            }
        }
    } else {
        collectEnergy(creep);
    }
}

function collectEnergy(creep: Creep): void {
    // Containers filled by stationary harvesters — pick the fullest one
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

    // Storage as secondary source
    const storage = creep.room.storage;
    if (storage && storage.store[RESOURCE_ENERGY] >= 200) {
        if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(storage, { reusePath: 5 });
        }
        return;
    }

    // Dropped energy (tombstones, overflow)
    const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: r => r.resourceType === RESOURCE_ENERGY && r.amount >= 50,
    });
    if (dropped) {
        if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
            creep.moveTo(dropped, { reusePath: 3 });
        }
    }
}

// Returns the highest-priority construction site, ignoring distance.
// Roads are second — they're high value but capped at 10 pending sites at a time
// by the construction manager, so the builder won't spend forever on them.
function findBuildTarget(creep: Creep): ConstructionSite | null {
    const PRIORITY: StructureConstant[] = [
        STRUCTURE_CONTAINER,   // efficiency gain on every tick once built
        STRUCTURE_ROAD,        // mobility (capped at 10 sites, so builds fast)
        STRUCTURE_EXTENSION,   // better spawn bodies (RCL 2+)
        STRUCTURE_TOWER,       // passive defense (RCL 3+)
        STRUCTURE_RAMPART,     // protect key structures (RCL 2+)
    ];

    for (const type of PRIORITY) {
        const site = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES, {
            filter: s => s.structureType === type,
        });
        if (site) return site;
    }

    // Catch-all for anything else (walls, etc.)
    return creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);
}
