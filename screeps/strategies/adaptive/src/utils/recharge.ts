/**
 * Unified energy collection waterfall, ported from screeps-quorum/src/extends/creep/actions.js.
 *
 * Call at the top of any role that needs energy. Returns true while recharging
 * (caller should skip its work logic), false when ready to work.
 *
 * Waterfall priority (highest → lowest):
 *   1. Storage link near room.storage (>= 75% full)
 *   2. room.storage
 *   3. room.terminal
 *   4. Dropped energy (amount >= full carry capacity)
 *   5. Containers (energy >= full carry capacity)
 *   6. Harvest from source (only if creep has WORK parts)
 *
 * Hysteresis (from Quorum): switches to working at 75% full instead of 100%.
 * This reduces idle oscillation near the recharge threshold.
 */
export function recharge(creep: Creep): boolean {
    const capacity = creep.store.getCapacity();

    if (creep.store[RESOURCE_ENERGY] === 0) creep.memory.working = false;
    if (creep.store[RESOURCE_ENERGY] >= capacity * 0.75) creep.memory.working = true;

    if (creep.memory.working) return false;

    // 1. Storage link (charged link adjacent to storage — energy teleported from sources)
    const storage = creep.room.storage;
    if (storage?.pos) {
        const links = ((storage as any).pos.findInRange(FIND_MY_STRUCTURES, 2, {
            filter: (s: any) => s.structureType === STRUCTURE_LINK,
        }) as any[]).filter((s: any) => s.store[RESOURCE_ENERGY] >= capacity * 0.75);
        if (links.length > 0) {
            if (creep.withdraw(links[0], RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(links[0], { reusePath: 5 });
            }
            return true;
        }
    }

    // 2. Storage
    if (storage && (storage as any).store[RESOURCE_ENERGY] > 0) {
        if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(storage, { reusePath: 5 });
        }
        return true;
    }

    // 3. Terminal
    const terminal = creep.room.terminal;
    if (terminal && (terminal as any).store[RESOURCE_ENERGY] > 0) {
        if (creep.withdraw(terminal, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(terminal, { reusePath: 5 });
        }
        return true;
    }

    // 4. Dropped energy with sufficient amount (full-carry loads only — avoid micro-pickups)
    const dropped = creep.room.find(FIND_DROPPED_RESOURCES, {
        filter: (r: any) => r.resourceType === RESOURCE_ENERGY && r.amount >= capacity,
    });
    if (dropped.length > 0) {
        const target = dropped[0];
        if (creep.pickup(target) === ERR_NOT_IN_RANGE) creep.moveTo(target, { reusePath: 3 });
        return true;
    }

    // 5. Containers with a full load of energy
    const container = creep.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: (s: any) =>
            s.structureType === STRUCTURE_CONTAINER &&
            s.store[RESOURCE_ENERGY] >= capacity,
    }) as StructureContainer | null;
    if (container && (container as any).store[RESOURCE_ENERGY] >= capacity) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(container, { reusePath: 5 });
        }
        return true;
    }

    // 6. Harvest directly — last resort, only if creep has WORK parts
    if (creep.getActiveBodyparts(WORK) > 0) {
        const sources = creep.room.find(FIND_SOURCES_ACTIVE);
        if (sources.length > 0) {
            if (creep.harvest(sources[0]) === ERR_NOT_IN_RANGE) {
                creep.moveTo(sources[0], { reusePath: 5 });
            }
        }
    }

    return true; // still recharging, even if nothing available yet
}
