// Stationary harvester: parks at an assigned source, harvests into the adjacent
// container. Falls back to mobile delivery if no container exists yet.

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

// ─── Stationary mode ─────────────────────────────────────────────────────────

function runStationary(creep: Creep, source: Source, container: StructureContainer): void {
    // Move onto the container tile to mine directly into it
    if (!creep.pos.isEqualTo(container.pos)) {
        creep.moveTo(container.pos, { reusePath: 10, visualizePathStyle: undefined });
        return;
    }
    creep.harvest(source);
    if (creep.store.getFreeCapacity() === 0) {
        // Prefer a link over the container — links teleport energy instantly, no hauler trip needed
        const link = source.pos.findInRange(FIND_MY_STRUCTURES, 2, {
            filter: s =>
                s.structureType === STRUCTURE_LINK &&
                (s as StructureLink).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        })[0] as StructureLink | undefined;

        if (link) {
            creep.transfer(link, RESOURCE_ENERGY);
        } else {
            creep.transfer(container, RESOURCE_ENERGY);
        }
    }
}

// ─── Mobile mode (no container yet) ─────────────────────────────────────────

function runMobile(creep: Creep, source: Source): void {
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
            // Nothing else needs energy — upgrade RC as a productive last resort.
            // This is intentional: surplus energy is better spent on RCL than wasted.
            const controller = creep.room.controller;
            if (controller && creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
                creep.moveTo(controller, { reusePath: 5 });
            }
        }
    } else {
        if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
            creep.moveTo(source, { reusePath: 5 });
        }
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getAssignedSource(creep: Creep): Source | null {
    if (creep.memory.sourceId) {
        return Game.getObjectById(creep.memory.sourceId);
    }
    // Assign to the least-contested source
    const sources = creep.room.find(FIND_SOURCES);
    const counts = new Map<Id<Source>, number>();
    for (const c of creep.room.find(FIND_MY_CREEPS)) {
        if (c.memory.role === 'harvester' && c.memory.sourceId) {
            counts.set(c.memory.sourceId, (counts.get(c.memory.sourceId) ?? 0) + 1);
        }
    }
    const best = sources.reduce((a, b) =>
        (counts.get(a.id) ?? 0) <= (counts.get(b.id) ?? 0) ? a : b
    );
    creep.memory.sourceId = best.id;
    return best;
}

function findNearbyContainer(source: Source): StructureContainer | null {
    return source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: s => s.structureType === STRUCTURE_CONTAINER,
    })[0] as StructureContainer ?? null;
}

const SPAWN_FILL_THRESHOLD = 0.8;

function findDeliveryTarget(creep: Creep): AnyOwnedStructure | null {
    return creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: s => {
            if (s.structureType === STRUCTURE_EXTENSION) {
                return (s as StructureExtension).store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
            if (s.structureType === STRUCTURE_SPAWN) {
                const sp = s as StructureSpawn;
                return sp.store[RESOURCE_ENERGY] < (sp.store.getCapacity(RESOURCE_ENERGY) ?? 300) * SPAWN_FILL_THRESHOLD;
            }
            if (s.structureType === STRUCTURE_TOWER) {
                return (s as StructureTower).store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
            return false;
        },
    });
}
