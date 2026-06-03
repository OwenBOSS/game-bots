// Stationary harvester: parks on the container adjacent to its assigned source and mines
// continuously. Falls back to mobile delivery when no container exists yet.

export function runHarvester(creep: Creep): void {
    const source = getAssignedSource(creep);
    if (!source) return;

    const container = findNearbyContainer(source);
    if (container) {
        runStationary(creep, source, container);
    } else {
        runMobile(creep, source);
    }
}

function runStationary(creep: Creep, source: Source, container: StructureContainer): void {
    if (!creep.pos.isEqualTo(container.pos)) {
        creep.moveTo(container.pos, { reusePath: 10 });
        return;
    }
    creep.harvest(source);
    if (creep.store.getFreeCapacity() === 0) {
        creep.transfer(container, RESOURCE_ENERGY);
    }
}

function runMobile(creep: Creep, source: Source): void {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) creep.memory.working = false;
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) creep.memory.working = true;

    if (creep.memory.working) {
        const target = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
            filter: (s): s is StructureSpawn | StructureExtension =>
                (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
                s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        });
        if (target) {
            if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(target, { reusePath: 5 });
            }
        } else {
            // Spawn/extensions full — dump into controller to keep progressing
            const ctrl = creep.room.controller;
            if (ctrl && creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
                creep.moveTo(ctrl, { reusePath: 5 });
            }
        }
    } else {
        if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
            creep.moveTo(source, { reusePath: 5 });
        }
    }
}

function getAssignedSource(creep: Creep): Source | null {
    if (creep.memory.sourceId) {
        return Game.getObjectById(creep.memory.sourceId as Id<Source>);
    }
    const sources = creep.room.find(FIND_SOURCES);
    if (sources.length === 0) return null;
    const counts = new Map<string, number>();
    for (const c of creep.room.find(FIND_MY_CREEPS)) {
        if (c.memory.role === 'harvester' && c.memory.sourceId) {
            counts.set(c.memory.sourceId, (counts.get(c.memory.sourceId) ?? 0) + 1);
        }
    }
    const best = sources.reduce((a, b) =>
        (counts.get(a.id as string) ?? 0) <= (counts.get(b.id as string) ?? 0) ? a : b
    );
    creep.memory.sourceId = best.id as string;
    return best;
}

function findNearbyContainer(source: Source): StructureContainer | null {
    return source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: (s: AnyStructure) => s.structureType === STRUCTURE_CONTAINER,
    })[0] as StructureContainer ?? null;
}
