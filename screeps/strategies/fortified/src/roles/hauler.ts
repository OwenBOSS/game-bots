// Hauler: tows a stationary harvester to its source, then runs collect/deliver loop.
//
// TOW phase: both creeps must call move in the same tick. The hauler drives:
//   hauler.pull(harvester) + harvester.move(hauler) + hauler.moveTo(source)
// This works because Game.creeps gives access to any owned creep.
export function runHauler(creep: Creep): void {
    const phase = (creep.memory.haulerPhase ?? 'tow') as HaulerPhase;
    switch (phase) {
        case 'tow':     doTow(creep);     break;
        case 'collect': doCollect(creep); break;
        case 'deliver': doDeliver(creep); break;
    }
}

function doTow(creep: Creep): void {
    const towName = creep.memory.towTarget;
    if (!towName) {
        creep.memory.haulerPhase = 'collect';
        doCollect(creep);
        return;
    }

    const harvester = Game.creeps[towName];
    if (!harvester) {
        // Harvester is dead; become a regular hauler.
        creep.memory.towTarget = undefined;
        creep.memory.haulerPhase = 'collect';
        return;
    }

    // Already delivered — harvester confirmed at source.
    if (harvester.memory.atSource) {
        creep.memory.haulerPhase = 'collect';
        doCollect(creep);
        return;
    }

    const sourceId = harvester.memory.sourceId;
    if (!sourceId) return;
    const source = Game.getObjectById(sourceId as Id<Source>);
    if (!source) return;

    // Check if harvester has arrived.
    if (harvester.pos.getRangeTo(source) <= 1) {
        harvester.memory.atSource = true;
        creep.memory.haulerPhase = 'collect';
        doCollect(creep);
        return;
    }

    // Move hauler next to harvester before pulling.
    if (creep.pos.getRangeTo(harvester) > 1) {
        creep.moveTo(harvester, { reusePath: 5 });
        return;
    }

    // Execute tow: register pull, consent to be moved, advance toward source.
    creep.pull(harvester);
    harvester.move(creep);
    creep.moveTo(source, { reusePath: 5 });
}

function doCollect(creep: Creep): void {
    if (creep.store.getFreeCapacity() === 0) {
        creep.memory.haulerPhase = 'deliver';
        creep.memory.targetId = undefined;
        doDeliver(creep);
        return;
    }

    // Prefer dropped energy at sources.
    const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: (r: Resource) => r.resourceType === RESOURCE_ENERGY && r.amount >= 50,
    });
    if (dropped) {
        if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
            creep.moveTo(dropped, { reusePath: 5 });
        }
        return;
    }

    // Withdraw from any container with energy.
    const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (s: AnyStructure) =>
            s.structureType === STRUCTURE_CONTAINER &&
            (s as StructureContainer).store[RESOURCE_ENERGY] >= 100,
    }) as StructureContainer | null;
    if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(container, { reusePath: 5 });
        }
    }
}

function doDeliver(creep: Creep): void {
    if (creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.haulerPhase = 'collect';
        creep.memory.targetId = undefined;
        doCollect(creep);
        return;
    }

    const target = findDeliveryTarget(creep);
    if (!target) return;

    const result = creep.transfer(target as AnyOwnedStructure, RESOURCE_ENERGY);
    if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(target as AnyOwnedStructure, { reusePath: 5 });
    } else if (result === OK) {
        creep.memory.targetId = undefined;
    }
}

function findDeliveryTarget(creep: Creep): AnyStructure | null {
    return creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: (s: AnyOwnedStructure) => {
            if (
                s.structureType === STRUCTURE_EXTENSION ||
                s.structureType === STRUCTURE_SPAWN
            ) {
                return (s as StructureExtension).store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
            if (s.structureType === STRUCTURE_LINK) {
                // Fill source-adjacent links only (not the controller-side link).
                return (s as StructureLink).store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
            return false;
        },
    });
}
