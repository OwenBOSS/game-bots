// Dedicated controller upgrader.
// Also handles safe mode recharge: if terminal has ghodium, pick it up and
// call generateSafeMode(controller) to add a safe mode charge (consumes 1000G).

import { moveTo } from '../utils/trafficManager';

export function runUpgrader(creep: Creep): void {
    // Safe mode recharge: if we're holding ghodium, use it immediately
    const ghodiumHeld = creep.store.getUsedCapacity(RESOURCE_GHODIUM);
    if (ghodiumHeld >= 1000) {
        const ctrl = creep.room.controller;
        if (ctrl && !ctrl.safeModeAvailable) {
            if (creep.generateSafeMode(ctrl) === ERR_NOT_IN_RANGE) {
                moveTo(creep,ctrl, { reusePath: 5 });
            }
            return;
        }
    }

    // Pick up ghodium from terminal if safe mode is depleted and we don't have it yet
    const terminal = creep.room.terminal;
    if (terminal && !creep.room.controller?.safeModeAvailable && ghodiumHeld < 1000) {
        const available = terminal.store.getUsedCapacity(RESOURCE_GHODIUM) ?? 0;
        if (available >= 1000 && creep.store.getFreeCapacity() >= 1000) {
            if (creep.withdraw(terminal, RESOURCE_GHODIUM, 1000) === ERR_NOT_IN_RANGE) {
                moveTo(creep,terminal, { reusePath: 5 });
            }
            return;
        }
    }

    // Normal upgrade cycle
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }

    if (creep.memory.working) {
        const controller = creep.room.controller;
        if (controller && creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
            moveTo(creep,controller, { reusePath: 5 });
        }
    } else {
        getEnergy(creep);
    }
}

function getEnergy(creep: Creep): void {
    const controller = creep.room.controller;
    if (!controller) return;

    // Controller link (range 3): energy teleported from sources — no hauler trip.
    // This is the most efficient source at RCL5+ with the new link topology.
    const ctrlLink = controller.pos.findInRange(FIND_MY_STRUCTURES, 3, {
        filter: s =>
            s.structureType === STRUCTURE_LINK &&
            (s as StructureLink).store[RESOURCE_ENERGY] > 0,
    })[0] as StructureLink | undefined;
    if (ctrlLink) {
        if (creep.withdraw(ctrlLink, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep,ctrlLink, { reusePath: 5 });
        }
        return;
    }

    // Container near controller (fallback when link is empty or not yet built)
    const container = controller.pos.findInRange(FIND_STRUCTURES, 3, {
        filter: s =>
            s.structureType === STRUCTURE_CONTAINER &&
            (s as StructureContainer).store[RESOURCE_ENERGY] > 0,
    })[0] as StructureContainer | undefined;
    if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep,container, { reusePath: 5 });
        }
        return;
    }

    const storage = creep.room.storage;
    if (storage && storage.store[RESOURCE_ENERGY] > 0) {
        if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep,storage, { reusePath: 5 });
        }
        return;
    }

    const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
        moveTo(creep,source, { reusePath: 5 });
    }
}
