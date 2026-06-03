// Keeps energy flowing. RC1: upgrade controller only (fastest path to RC2).
// RC2+: fill spawn/extensions so collectors can keep spawning.
export function runHarvester(creep: Creep): void {
    // State transitions
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }

    if (creep.memory.working) {
        const level = creep.room.controller?.level ?? 2;
        if (level === 1) {
            // RC1: dump directly into controller — fastest path to RC2
            if (creep.upgradeController(creep.room.controller!) === ERR_NOT_IN_RANGE) {
                creep.moveTo(creep.room.controller!, { reusePath: 5 });
            }
        } else {
            // RC2+: keep spawn and extensions topped up
            const target = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
                filter: (s): s is StructureSpawn | StructureExtension =>
                    (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
                    s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
            });
            if (target) {
                if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(target, { reusePath: 5 });
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
