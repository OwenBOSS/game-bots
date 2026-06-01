export function runAttacker(creep: Creep): void {
    const targetRoom = creep.memory.targetRoomName;

    if (targetRoom && creep.room.name !== targetRoom) {
        const exitDir = creep.room.findExitTo(targetRoom);
        if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
            const exit = creep.pos.findClosestByRange(exitDir);
            if (exit) creep.moveTo(exit, { reusePath: 3 });
        }
        return;
    }

    const target = findTarget(creep);
    if (!target) {
        creep.moveTo(new RoomPosition(25, 25, creep.room.name), { reusePath: 10 });
        return;
    }

    if (creep.attack(target) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { reusePath: 3 });
    }
}

function findTarget(creep: Creep): Creep | AnyOwnedStructure | null {
    const spawn = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_SPAWN,
    }) as StructureSpawn | null;
    if (spawn) return spawn;

    const tower = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER,
    }) as StructureTower | null;
    if (tower) return tower;

    const structure = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES) as AnyOwnedStructure | null;
    if (structure) return structure;

    return creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS);
}
