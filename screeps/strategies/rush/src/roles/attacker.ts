// Moves to enemy room and attacks spawn first, then other structures, then creeps.
export function runAttacker(creep: Creep): void {
    const targetRoom = creep.memory.targetRoomName;

    // Travel to enemy room if not already there
    if (targetRoom && creep.room.name !== targetRoom) {
        const exitDir = creep.room.findExitTo(targetRoom);
        if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
            const exit = creep.pos.findClosestByRange(exitDir);
            if (exit) creep.moveTo(exit, { reusePath: 3 });
        }
        return;
    }

    const target = findAttackTarget(creep);
    if (!target) {
        // No targets — move to center of room to patrol
        creep.moveTo(new RoomPosition(25, 25, creep.room.name), { reusePath: 10 });
        return;
    }

    if (creep.attack(target) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { reusePath: 3 });
    }
}

function findAttackTarget(creep: Creep): Creep | AnyOwnedStructure | null {
    // Priority 1: enemy spawn (disables their economy)
    const enemySpawn = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_SPAWN,
    }) as StructureSpawn | null;
    if (enemySpawn) return enemySpawn;

    // Priority 2: enemy towers
    const enemyTower = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER,
    }) as StructureTower | null;
    if (enemyTower) return enemyTower;

    // Priority 3: other owned structures
    const enemyStructure = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES) as AnyOwnedStructure | null;
    if (enemyStructure) return enemyStructure;

    // Priority 4: enemy creeps
    return creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS);
}
