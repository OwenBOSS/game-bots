// Harvests energy and delivers it to spawn, extensions, and towers.
// Falls back to upgrading the controller when nothing needs filling.
export function runHarvester(creep: Creep): void {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }

    if (creep.memory.working) {
        const target = findDeliveryTarget(creep);
        if (target) {
            if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(target, { reusePath: 5 });
            }
        } else {
            // Nothing needs filling — upgrade the controller
            const controller = creep.room.controller;
            if (controller) {
                if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(controller, { reusePath: 5 });
                }
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

// Priority: extensions first (unlock better spawn bodies), then spawn, then towers.
function findDeliveryTarget(creep: Creep): AnyOwnedStructure | null {
    return creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: s =>
            (s.structureType === STRUCTURE_EXTENSION ||
             s.structureType === STRUCTURE_SPAWN ||
             s.structureType === STRUCTURE_TOWER) &&
            (s as StructureSpawn).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });
}
