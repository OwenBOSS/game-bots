// Builder — handles construction sites (containers, extensions, tower, storage).
// Withdraws from nearest energy source, then builds the closest construction site.
// Retires to harvester behavior once no sites remain.

export function runBuilder(creep: Creep): void {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }

    if (creep.memory.working) {
        const site = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);
        if (!site) {
            // Nothing to build — fill spawn as a fallback
            const spawn = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
                filter: (s): s is StructureSpawn =>
                    s.structureType === STRUCTURE_SPAWN &&
                    s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
            });
            if (spawn) {
                if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(spawn, { reusePath: 5 });
                }
            }
            return;
        }
        if (creep.build(site) === ERR_NOT_IN_RANGE) {
            creep.moveTo(site, { reusePath: 5 });
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
