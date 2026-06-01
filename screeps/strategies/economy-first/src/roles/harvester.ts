// Fills spawn, extensions, and towers with energy.
export function runHarvester(creep: Creep): void {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }

    if (creep.memory.working) {
        const target = findEnergyTarget(creep);
        if (target) {
            if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(target, { reusePath: 5 });
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

function findEnergyTarget(creep: Creep): AnyOwnedStructure | null {
    // Priority: extensions > spawn > towers
    return creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: s =>
            (s.structureType === STRUCTURE_EXTENSION ||
             s.structureType === STRUCTURE_SPAWN ||
             s.structureType === STRUCTURE_TOWER) &&
            (s as StructureSpawn).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });
}
