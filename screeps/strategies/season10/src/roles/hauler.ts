// Hauler: collects energy from source containers and delivers to spawn/extensions/towers.
// Falls back to upgrading the controller when everything is full — this keeps RC progressing.

import { moveTo } from '../utils/trafficManager';

export function runHauler(creep: Creep): void {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) creep.memory.working = false;
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) creep.memory.working = true;

    creep.memory.working ? deliver(creep) : collect(creep);

    // Eager transition: skip the idle tick when a phase just completed.
    // Without this, the working-state flip only fires at the top of the NEXT tick,
    // leaving the creep standing at spawn/container for one wasted tick.
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
        collect(creep);
    } else if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
        deliver(creep);
    }
}

function collect(creep: Creep): void {
    // Fullest source container first
    const container = getBestSourceContainer(creep.room);
    if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, container, { reusePath: 5 });
        }
        return;
    }

    // Dropped energy (overflow when containers are full)
    const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: (r: Resource) => r.resourceType === RESOURCE_ENERGY && r.amount >= 50,
    });
    if (dropped) {
        if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) moveTo(creep, dropped, { reusePath: 3 });
        return;
    }

    // Nothing ready — wait near spawn rather than wandering
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn) moveTo(creep, spawn, { reusePath: 20, range: 3 });
}

function deliver(creep: Creep): void {
    // Priority 1: spawn, extensions, towers — keep combat and spawning capacity full
    const urgent = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: (s: AnyStructure): boolean => {
            if (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) {
                return (s as StructureSpawn | StructureExtension).store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
            if (s.structureType === STRUCTURE_TOWER) {
                return (s as StructureTower).store.getFreeCapacity(RESOURCE_ENERGY) > 200;
            }
            return false;
        },
    });
    if (urgent) {
        if (creep.transfer(urgent as any, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, urgent, { reusePath: 5 });
        }
        return;
    }

    // Priority 2: upgrade controller — RC progression unlocks more spawning capacity
    const ctrl = creep.room.controller;
    if (ctrl) {
        if (creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) moveTo(creep, ctrl, { reusePath: 5 });
        return;
    }

    // Priority 3: storage overflow
    const storage = creep.room.storage;
    if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        if (creep.transfer(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, storage, { reusePath: 5 });
        }
    }
}

function getBestSourceContainer(room: Room): StructureContainer | null {
    const sources = room.find(FIND_SOURCES);
    const candidates: StructureContainer[] = [];
    for (const src of sources) {
        const near = src.pos.findInRange(FIND_STRUCTURES, 1, {
            filter: (s: AnyStructure) =>
                s.structureType === STRUCTURE_CONTAINER &&
                (s as StructureContainer).store[RESOURCE_ENERGY] >= 50,
        }) as StructureContainer[];
        candidates.push(...near);
    }
    if (candidates.length === 0) return null;
    return candidates.reduce((a, b) =>
        a.store[RESOURCE_ENERGY] >= b.store[RESOURCE_ENERGY] ? a : b
    );
}
