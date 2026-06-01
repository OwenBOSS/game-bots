// Courier: physically carries energy from a surplus room to a deficit room.
// Used before RCL 6 (no terminals). At RCL 6+, transferManager switches to
// terminal transfers and couriers are no longer spawned.
//
// creep.memory.homeRoom    — source room (where to withdraw energy)
// creep.memory.courierTarget — destination room (where to deposit energy)

export function runCourier(creep: Creep): void {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }

    if (creep.memory.working) {
        deliver(creep);
    } else {
        collect(creep);
    }
}

function collect(creep: Creep): void {
    const homeRoom = creep.memory.homeRoom;
    if (!homeRoom) return;

    if (creep.room.name !== homeRoom) {
        moveToRoom(creep, homeRoom);
        return;
    }

    // Withdraw from storage first, then fullest container
    const storage = creep.room.storage;
    if (storage && storage.store[RESOURCE_ENERGY] >= 500) {
        if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(storage, { reusePath: 5 });
        }
        return;
    }

    const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_CONTAINER &&
            (s as StructureContainer).store[RESOURCE_ENERGY] >= 200,
    }) as StructureContainer | null;
    if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(container, { reusePath: 5 });
        }
        return;
    }

    // Source room has no energy to spare — idle near storage
    if (storage) creep.moveTo(storage, { reusePath: 10 });
}

function deliver(creep: Creep): void {
    const target = creep.memory.courierTarget;
    if (!target) return;

    if (creep.room.name !== target) {
        moveToRoom(creep, target);
        return;
    }

    // Deposit into spawn/extensions first (keep spawn capacity up), then storage/containers
    const spawnTarget = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: (s): s is StructureSpawn | StructureExtension =>
            (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });
    if (spawnTarget) {
        if (creep.transfer(spawnTarget, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(spawnTarget, { reusePath: 5 });
        }
        return;
    }

    const destStorage = creep.room.storage;
    if (destStorage && destStorage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        if (creep.transfer(destStorage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(destStorage, { reusePath: 5 });
        }
        return;
    }

    const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_CONTAINER &&
            (s as StructureContainer).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    }) as StructureContainer | null;
    if (container) {
        if (creep.transfer(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(container, { reusePath: 5 });
        }
    }
}

function moveToRoom(creep: Creep, roomName: string): void {
    const exitDir = creep.room.findExitTo(roomName);
    if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
        const exit = creep.pos.findClosestByRange(exitDir);
        if (exit) creep.moveTo(exit, { reusePath: 3 });
    }
}
