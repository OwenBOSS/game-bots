export function runUpgrader(creep: Creep): void {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }

    if (creep.memory.working) {
        const ctrl = creep.room.controller;
        if (!ctrl) return;
        if (creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
            creep.moveTo(ctrl, { reusePath: 10 });
        }
        return;
    }

    // At RC5+, prefer the controller-adjacent link.
    const ctrlLink = findControllerLink(creep);
    if (ctrlLink) {
        if (creep.withdraw(ctrlLink, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(ctrlLink, { reusePath: 10 });
        }
        return;
    }

    // Fallback: nearest spawn or extension with surplus.
    const target = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: (s: AnyOwnedStructure) =>
            (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
            (s as StructureSpawn).store[RESOURCE_ENERGY] > 0,
    });
    if (target) {
        if (creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(target, { reusePath: 10 });
        }
    }
}

function findControllerLink(creep: Creep): StructureLink | null {
    const ctrl = creep.room.controller;
    if (!ctrl) return null;
    const links = ctrl.pos.findInRange(FIND_MY_STRUCTURES, 3, {
        filter: (s: AnyStructure) =>
            s.structureType === STRUCTURE_LINK &&
            (s as StructureLink).store[RESOURCE_ENERGY] > 0,
    }) as StructureLink[];
    return links[0] ?? null;
}
