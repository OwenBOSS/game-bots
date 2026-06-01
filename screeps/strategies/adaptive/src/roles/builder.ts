// Builds construction sites, repairs damaged roads, upgrades controller as fallback.
export function runBuilder(creep: Creep): void {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }

    if (creep.memory.working) {
        // 1. Finish any construction site
        const site = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);
        if (site) {
            if (creep.build(site) === ERR_NOT_IN_RANGE) {
                creep.moveTo(site, { reusePath: 5 });
            }
            return;
        }

        // 2. Repair roads below 50% hits
        const damagedRoad = creep.pos.findClosestByPath(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_ROAD && s.hits < s.hitsMax * 0.5,
        });
        if (damagedRoad) {
            if (creep.repair(damagedRoad) === ERR_NOT_IN_RANGE) {
                creep.moveTo(damagedRoad, { reusePath: 5 });
            }
            return;
        }

        // 3. Nothing to build — help upgrade the controller
        const controller = creep.room.controller;
        if (controller) {
            if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
                creep.moveTo(controller, { reusePath: 5 });
            }
        }
    } else {
        const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
        if (source) {
            if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
                creep.moveTo(source, { reusePath: 5 });
            }
        }
    }
}
