import { moveTo } from '../utils/trafficManager';

export function runUpgrader(creep: Creep): void {
    const mem = creep.memory as any;

    if (mem.working && creep.store[RESOURCE_ENERGY] === 0) mem.working = false;
    if (!mem.working && creep.store.getFreeCapacity() === 0) mem.working = true;

    if (mem.working) {
        const ctrl = creep.room.controller;
        if (!ctrl) return;
        if (creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
            moveTo(creep, ctrl, { reusePath: 10 });
        }
        return;
    }

    // Prefer container near a source (most energy-dense pickup)
    const container = creep.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: (s: AnyStructure) =>
            s.structureType === STRUCTURE_CONTAINER &&
            (s as StructureContainer).store[RESOURCE_ENERGY] > 0,
    }) as StructureContainer | null;
    if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, container, { reusePath: 5 });
        }
        return;
    }

    // No containers yet — pick up dropped energy (harvesters drop it at source)
    const allDropped = creep.room.find(FIND_DROPPED_RESOURCES, {
        filter: (r: Resource) => r.resourceType === RESOURCE_ENERGY && r.amount > 20,
    });
    const dropped = allDropped.length > 0
        ? allDropped.reduce((a: Resource, b: Resource) => a.amount >= b.amount ? a : b)
        : null;
    if (dropped) {
        if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) moveTo(creep, dropped, { reusePath: 5 });
        return;
    }

    // Nothing available — wait near sources
    const source = creep.pos.findClosestByRange(FIND_SOURCES);
    if (source) moveTo(creep, source, { reusePath: 20, range: 2 });
}
