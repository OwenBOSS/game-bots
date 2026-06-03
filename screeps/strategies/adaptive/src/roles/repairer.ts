// Raid-responder: keeps ramparts and walls above minimum HP during DEFEND phase.
// Withdraws energy from containers; falls back to harvesting.

import { moveTo } from '../utils/trafficManager';

const RAMPART_MIN_HITS = 50_000;
const WALL_MIN_HITS    = 10_000;

export function runRepairer(creep: Creep): void {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }

    if (creep.memory.working) {
        const target = findRepairTarget(creep);
        if (target) {
            // Move onto a rampart tile for protection if possible
            const safeStand = target.pos.findInRange(FIND_MY_STRUCTURES, 0, {
                filter: s => s.structureType === STRUCTURE_RAMPART,
            })[0];
            if (safeStand && !creep.pos.isEqualTo(target.pos)) {
                moveTo(creep,target.pos, { reusePath: 3 });
            }
            if (creep.repair(target) === ERR_NOT_IN_RANGE) {
                moveTo(creep,target, { reusePath: 3 });
            }
        } else {
            // Nothing to repair — upgrade controller
            const ctrl = creep.room.controller;
            if (ctrl && creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
                moveTo(creep,ctrl, { reusePath: 5 });
            }
        }
    } else {
        getEnergy(creep);
    }
}

function findRepairTarget(creep: Creep): Structure | null {
    // Ramparts first (most critical — they protect structures)
    const ramparts = creep.room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_RAMPART && s.hits < RAMPART_MIN_HITS,
    }) as StructureRampart[];

    if (ramparts.length > 0) {
        return ramparts.reduce((a, b) => a.hits < b.hits ? a : b);
    }

    // Walls next
    const walls = creep.room.find(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_WALL && s.hits < WALL_MIN_HITS,
    });
    if (walls.length > 0) {
        return walls.reduce((a, b) => a.hits < b.hits ? a : b) as Structure;
    }

    // Roads degraded below 50%
    return creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_ROAD && s.hits < s.hitsMax * 0.5,
    });
}

function getEnergy(creep: Creep): void {
    const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: s =>
            s.structureType === STRUCTURE_CONTAINER &&
            (s as StructureContainer).store[RESOURCE_ENERGY] > 0,
    }) as StructureContainer | null;

    if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep,container, { reusePath: 5 });
        }
        return;
    }

    const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
        moveTo(creep,source, { reusePath: 5 });
    }
}
