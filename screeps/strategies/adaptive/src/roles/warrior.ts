// Advanced combat unit replacing basic attacker.
// Has HEAL parts, retreat logic, and obeys the global RALLY/MARCH/ENGAGE state.
const RETREAT_THRESHOLD = 0.3; // retreat when HP falls below 30%

export function runWarrior(creep: Creep): void {
    // Always try to heal self if damaged (HEAL action is independent of movement)
    if (creep.hits < creep.hitsMax) {
        creep.heal(creep);
    }

    // Retreat when critically wounded — return home to recover
    if (creep.hits < creep.hitsMax * RETREAT_THRESHOLD) {
        retreatToSpawn(creep);
        return;
    }

    const combatState = Memory.combatState ?? 'RALLY';

    switch (combatState) {
        case 'RALLY':
            rallyAtSpawn(creep);
            break;

        case 'MARCH':
        case 'ENGAGE': {
            const targetRoom = creep.memory.targetRoomName;
            if (targetRoom && creep.room.name !== targetRoom) {
                moveToRoom(creep, targetRoom);
            } else {
                engageInRoom(creep);
            }
            break;
        }
    }
}

function rallyAtSpawn(creep: Creep): void {
    const spawn = creep.pos.findClosestByPath(FIND_MY_SPAWNS);
    if (spawn && creep.pos.getRangeTo(spawn) > 4) {
        creep.moveTo(spawn, { reusePath: 5 });
    }
}

function retreatToSpawn(creep: Creep): void {
    const spawn = creep.pos.findClosestByPath(FIND_MY_SPAWNS);
    if (spawn) {
        creep.moveTo(spawn, { reusePath: 3 });
    }
}

function engageInRoom(creep: Creep): void {
    const target = findCombatTarget(creep);
    if (!target) {
        // Patrol center — there may be nothing left to attack
        creep.moveTo(new RoomPosition(25, 25, creep.room.name), { reusePath: 10 });
        return;
    }

    const range = creep.pos.getRangeTo(target);

    // Ranged attack if we have RANGED_ATTACK parts and are within 3 tiles
    const hasRanged = creep.body.some(p => p.type === RANGED_ATTACK);
    if (hasRanged && range <= 3) {
        creep.rangedAttack(target as Creep);
    }

    // Melee attack if adjacent
    if (range <= 1) {
        creep.attack(target as Creep);
    } else {
        creep.moveTo(target, { reusePath: 3 });
    }
}

function findCombatTarget(creep: Creep): Creep | AnyOwnedStructure | null {
    // Priority: towers (greatest threat) > spawn (disables economy) > other creeps > structures
    const tower = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER,
    }) as StructureTower | null;
    if (tower) return tower;

    const spawn = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_SPAWN,
    }) as StructureSpawn | null;
    if (spawn) return spawn;

    const hostileCreep = creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS);
    if (hostileCreep) return hostileCreep;

    return creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES) as AnyOwnedStructure | null;
}

function moveToRoom(creep: Creep, roomName: string): void {
    const exitDir = creep.room.findExitTo(roomName);
    if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
        const exit = creep.pos.findClosestByRange(exitDir);
        if (exit) creep.moveTo(exit, { reusePath: 3 });
    }
}
