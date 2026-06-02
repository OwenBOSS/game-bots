// Builder works through construction sites in explicit priority order so the most
// impactful structures are finished first regardless of physical proximity.
//
// Priority: storage → containers → extensions → towers → ramparts → roads → repair → upgrade

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
    // Storage first — central buffer filled by haulers; keeps builders near spawn
    const storage = creep.room.storage;
    if (storage && storage.store[RESOURCE_ENERGY] >= 200) {
        if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(storage, { reusePath: 5 });
        }
        return;
    }

    // Pre-storage fallback: source containers (haulers haven't built up storage yet)
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

    // Dropped energy (tombstones, overflow)
    const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: r => r.resourceType === RESOURCE_ENERGY && r.amount >= 50,
    });
    if (dropped) {
        if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
            creep.moveTo(dropped, { reusePath: 3 });
        }
        return;
    }

    // Bootstrap fallback: before the first container exists, harvest directly so
    // the builder can build those first containers and unblock the supply chain.
    const hasContainers = creep.room.find(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_CONTAINER,
    }).length > 0;
    if (!hasContainers) {
        const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
        if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
            creep.moveTo(source, { reusePath: 5 });
        }
    }
}

// Returns the highest-priority construction site.
// Source containers come first — every source needs its container before
// anything else, since the whole supply chain depends on them.
function findBuildTarget(creep: Creep): ConstructionSite | null {
    // 1. Source containers — adjacent (range 1) to each source
    const sources = creep.room.find(FIND_SOURCES);
    const sourceContainerSites: ConstructionSite[] = [];
    for (const src of sources) {
        const sites = src.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
            filter: (s: ConstructionSite) => s.structureType === STRUCTURE_CONTAINER,
        }) as ConstructionSite[];
        sourceContainerSites.push(...sites);
    }
    if (sourceContainerSites.length > 0) {
        return creep.pos.findClosestByPath(sourceContainerSites) ?? sourceContainerSites[0];
    }

    // 2. Everything else in priority order
    const PRIORITY: StructureConstant[] = [
        STRUCTURE_STORAGE,
        STRUCTURE_CONTAINER,   // controller container and any remaining
        STRUCTURE_EXTENSION,
        STRUCTURE_TOWER,
        STRUCTURE_RAMPART,
        STRUCTURE_ROAD,
    ];
    for (const type of PRIORITY) {
        const site = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES, {
            filter: s => s.structureType === type,
        });
        if (site) return site;
    }

    return creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);
}
