// Builder — handles construction sites (containers, extensions, tower, storage).
// Collects from containers to avoid competing with harvesters at source tiles.
// Falls back to direct harvest only when no containers have energy yet.

import { moveTo } from '../utils/trafficManager';

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
            // No construction sites — repair degraded containers and roads before idling
            const damaged = creep.pos.findClosestByPath(FIND_STRUCTURES, {
                filter: (s: AnyStructure) => {
                    if (s.structureType === STRUCTURE_CONTAINER) return s.hits < s.hitsMax * 0.5;
                    if (s.structureType === STRUCTURE_ROAD) return s.hits < s.hitsMax * 0.4;
                    return false;
                },
            });
            if (damaged) {
                if (creep.repair(damaged as Structure) === ERR_NOT_IN_RANGE) {
                    moveTo(creep, damaged, { reusePath: 5 });
                }
                return;
            }
            // Nothing to repair either — fill spawn
            const spawn = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
                filter: (s): s is StructureSpawn =>
                    s.structureType === STRUCTURE_SPAWN &&
                    s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
            });
            if (spawn) {
                if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    moveTo(creep, spawn, { reusePath: 5 });
                }
            }
            return;
        }
        if (creep.build(site) === ERR_NOT_IN_RANGE) {
            moveTo(creep, site, { reusePath: 5 });
        }
    } else {
        collectEnergy(creep);
        // Eager transition: if collection just filled us, immediately start moving
        // toward the build site instead of idling at the collection point for one tick.
        if (creep.store.getFreeCapacity() === 0) {
            creep.memory.working = true;
            const site = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);
            if (site && creep.build(site) === ERR_NOT_IN_RANGE) {
                moveTo(creep, site, { reusePath: 5 });
            }
        }
    }
}

function collectEnergy(creep: Creep): void {
    // 1. Dropped energy — scan room directly (findClosestByPath filter is unreliable in-engine)
    const allDropped = creep.room.find(FIND_DROPPED_RESOURCES, {
        filter: (r: Resource) => r.resourceType === RESOURCE_ENERGY && r.amount >= 30,
    });
    const dropped = allDropped.length > 0
        ? allDropped.reduce((a: Resource, b: Resource) => a.amount >= b.amount ? a : b)
        : null;
    if (dropped) {
        if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) moveTo(creep, dropped, { reusePath: 3 });
        return;
    }

    // 2. Container with energy
    const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (s: AnyStructure) =>
            s.structureType === STRUCTURE_CONTAINER &&
            (s as StructureContainer).store[RESOURCE_ENERGY] >= 50,
    }) as StructureContainer | null;
    if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, container, { reusePath: 5 });
        }
        return;
    }

    // 3. Harvest directly as last resort
    const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (source) {
        if (creep.harvest(source) === ERR_NOT_IN_RANGE) moveTo(creep, source, { reusePath: 5 });
    }
}
