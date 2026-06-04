// Stationary harvester: parks on the container adjacent to its assigned source and mines
// continuously. Falls back to mobile delivery when no container exists yet.

import { moveTo } from '../utils/trafficManager';

export function runHarvester(creep: Creep): void {
    const source = getAssignedSource(creep);
    if (!source) return;

    const container = findNearbyContainer(source);
    if (container) {
        runStationary(creep, source, container);
        return;
    }

    const hasHauler = creep.room.find(FIND_MY_CREEPS).some(
        (c: Creep) => c.memory.role === 'hauler'
    );
    if (hasHauler) {
        // Hauler is active — stay at source and drop; hauler will collect
        runMobile(creep, source);
    } else {
        // No hauler yet — deliver manually so spawn/controller don't starve
        runMobileDeliver(creep, source);
    }
}

function runStationary(creep: Creep, source: Source, container: StructureContainer): void {
    if (!creep.pos.isEqualTo(container.pos)) {
        moveTo(creep, container.pos, { reusePath: 10 });
        return;
    }
    creep.harvest(source);
    if (creep.store.getFreeCapacity() === 0) {
        creep.transfer(container, RESOURCE_ENERGY);
    }
}

// No container, no hauler: deliver to spawn/controller manually until hauler spawns.
function runMobileDeliver(creep: Creep, source: Source): void {
    const mem = creep.memory as any;
    if (mem.working && creep.store[RESOURCE_ENERGY] === 0) mem.working = false;
    if (!mem.working && creep.store.getFreeCapacity() === 0) mem.working = true;

    if (mem.working) {
        const target = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
            filter: (s: AnyStructure) =>
                (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
                (s as StructureSpawn | StructureExtension).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        });
        if (target) {
            if (creep.transfer(target as any, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                moveTo(creep, target, { reusePath: 5 });
            }
            return;
        }
        const ctrl = creep.room.controller;
        if (ctrl && creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
            moveTo(creep, ctrl, { reusePath: 5 });
        }
        return;
    }

    if (creep.harvest(source) === ERR_NOT_IN_RANGE) moveTo(creep, source, { reusePath: 5 });
}

// No container, hauler present: stay at source and drop energy on the ground.
function runMobile(creep: Creep, source: Source): void {
    if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
        moveTo(creep, source, { reusePath: 10 });
    }
}

function getAssignedSource(creep: Creep): Source | null {
    const sources = creep.room.find(FIND_SOURCES);
    if (sources.length === 0) return null;

    // Count existing assignments, excluding this creep to get a fair comparison
    const counts = new Map<string, number>();
    for (const c of creep.room.find(FIND_MY_CREEPS)) {
        if (c.memory.role === 'harvester' && c.memory.sourceId && c.name !== creep.name) {
            counts.set(c.memory.sourceId, (counts.get(c.memory.sourceId) ?? 0) + 1);
        }
    }

    // Rebalance: if our source has 2+ more harvesters than the least-loaded one, re-assign
    if (creep.memory.sourceId) {
        const currentCount = counts.get(creep.memory.sourceId) ?? 0;
        const minCount = sources.reduce(
            (min, src) => Math.min(min, counts.get(src.id as string) ?? 0),
            Infinity
        );
        if (currentCount - minCount < 2) {
            return Game.getObjectById(creep.memory.sourceId as Id<Source>);
        }
        creep.memory.sourceId = undefined;
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
