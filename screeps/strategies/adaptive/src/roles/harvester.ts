// Stationary harvester: parks at an assigned source, harvests into the adjacent
// container. Falls back to mobile delivery if no container exists yet.
//
// Remote mode (creep.memory.remoteRoom set): travels to the remote room and
// mines there. Energy drops into the remote container for remote haulers to collect.

import { moveTo } from '../utils/trafficManager';

export function runHarvester(creep: Creep): void {
    // Remote mode: mine in a reserved room — remote haulers carry energy home
    if (creep.memory.remoteRoom) {
        runRemote(creep);
        return;
    }

    // Bootstrap: travel to homeRoom if spawned by a different room (e.g. expansion seeding).
    if (creep.memory.homeRoom && creep.room.name !== creep.memory.homeRoom) {
        moveTo(creep, new RoomPosition(25, 25, creep.memory.homeRoom), { reusePath: 20, range: 23 });
        return;
    }

    const source = getAssignedSource(creep);
    if (!source) return;

    const container = findNearbyContainer(source);

    if (container) {
        runStationary(creep, source, container);
    } else {
        runMobile(creep, source);
    }
}

// ─── Remote mode ─────────────────────────────────────────────────────────────

function runRemote(creep: Creep): void {
    const target = creep.memory.remoteRoom!;

    if (creep.room.name !== target) {
        moveToRoom(creep, target);
        return;
    }

    // Assign a source in this room (same least-contested logic)
    const source = getAssignedSource(creep);
    if (!source) return;

    const container = findNearbyContainer(source);
    if (container) {
        // Park on container and mine into it — remote hauler will collect
        if (!creep.pos.isEqualTo(container.pos)) {
            moveTo(creep, container.pos, { reusePath: 10 });
            return;
        }
        creep.harvest(source);
        if (creep.store.getFreeCapacity() === 0) {
            creep.transfer(container, RESOURCE_ENERGY);
        }
    } else {
        // No container yet — mine and drop on ground (remote hauler picks up dropped)
        if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
            moveTo(creep, source, { reusePath: 5 });
        }
    }
}

// ─── Stationary mode ─────────────────────────────────────────────────────────

function runStationary(creep: Creep, source: Source, container: StructureContainer): void {
    if (!creep.pos.isEqualTo(container.pos)) {
        moveTo(creep, container.pos, { reusePath: 10, visualizePathStyle: undefined });
        return;
    }
    creep.harvest(source);
    if (creep.store.getFreeCapacity() === 0) {
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
                moveTo(creep, target, { reusePath: 5 });
            }
        } else {
            const controller = creep.room.controller;
            if (controller && creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
                moveTo(creep, controller, { reusePath: 5 });
            }
        }
    } else {
        if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
            moveTo(creep, source, { reusePath: 5 });
        }
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getAssignedSource(creep: Creep): Source | null {
    const sources = creep.room.find(FIND_SOURCES);
    if (sources.length === 0) return null;

    const counts = new Map<Id<Source>, number>();
    for (const c of creep.room.find(FIND_MY_CREEPS)) {
        if (c.memory.role === 'harvester' && c.memory.sourceId) {
            counts.set(c.memory.sourceId, (counts.get(c.memory.sourceId) ?? 0) + 1);
        }
    }

    if (creep.memory.sourceId) {
        const currentLoad = counts.get(creep.memory.sourceId) ?? 0;
        // Rebalance: if our source has 2+ more harvesters than another, switch
        const underloaded = sources.find(s =>
            s.id !== creep.memory.sourceId &&
            (counts.get(s.id) ?? 0) < currentLoad - 1
        );
        if (underloaded) {
            creep.memory.sourceId = underloaded.id;
            return underloaded;
        }
        return Game.getObjectById(creep.memory.sourceId);
    }

    // First assignment: least-contested source
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

function moveToRoom(creep: Creep, roomName: string): void {
    moveTo(creep, new RoomPosition(25, 25, roomName), { reusePath: 20, range: 23 });
}
