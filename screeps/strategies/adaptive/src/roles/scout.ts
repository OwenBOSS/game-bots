// Scout: patrols adjacent rooms, records rich intel, and waits at home when
// all rooms are fresh. Clears targetRoomName when idle to prevent bouncing.

const STALE_TICKS = 500;

export function runScout(creep: Creep): void {
    const targetRoom = creep.memory.targetRoomName;

    if (!targetRoom) {
        assignNextTarget(creep);
        return;
    }

    if (creep.room.name !== targetRoom) {
        const exitDir = creep.room.findExitTo(targetRoom);
        if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
            const exit = creep.pos.findClosestByRange(exitDir);
            if (exit) creep.moveTo(exit, { reusePath: 3 });
        }
        return;
    }

    if (!creep.memory.scoutComplete) {
        recordRoomIntel(creep.room);
        creep.memory.scoutComplete = true;
    }

    assignNextTarget(creep);
}

function recordRoomIntel(room: Room): void {
    if (!Memory.roomIntel) Memory.roomIntel = {};

    const enemyCreeps  = room.find(FIND_HOSTILE_CREEPS).length;
    const enemySpawns  = room.find(FIND_HOSTILE_STRUCTURES, { filter: s => s.structureType === STRUCTURE_SPAWN }).length;
    const enemyTowers  = room.find(FIND_HOSTILE_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER }).length;
    const strength     = enemyCreeps + enemySpawns * 5 + enemyTowers * 8;

    Memory.roomIntel[room.name] = {
        scannedAt:      Game.time,
        enemyCreeps,
        enemySpawns,
        enemyTowers,
        strength,
        hasController:   !!room.controller,
        controllerOwned: !!(room.controller?.owner),
        sourceCount:     room.find(FIND_SOURCES).length,
    };

    Memory.scoutTick = Game.time;

    if (enemySpawns > 0 || enemyCreeps > 0) {
        const currentStrength = Memory.enemyRoomName
            ? (Memory.roomIntel[Memory.enemyRoomName]?.strength ?? Infinity)
            : Infinity;
        if (strength < currentStrength) {
            Memory.enemyRoomName  = room.name;
            Memory.enemyStrength  = strength;
        }
    }

    console.log(`[adaptive] Scout intel: ${room.name} str=${strength} ctrl=${!!room.controller} owned=${!!room.controller?.owner} sources=${room.find(FIND_SOURCES).length}`);
}

function assignNextTarget(creep: Creep): void {
    const homeRoom = Object.values(Game.rooms).find(r => r.controller?.my);
    if (!homeRoom) return;

    const exits = Game.map.describeExits(homeRoom.name);
    if (!exits) return;

    const exitRooms = Object.values(exits).filter((r): r is string => !!r);
    const intel     = Memory.roomIntel ?? {};

    const target =
        exitRooms.find(r => !intel[r]) ??
        exitRooms.find(r => intel[r] && Game.time - intel[r].scannedAt > STALE_TICKS);

    if (target) {
        creep.memory.targetRoomName = target;
        creep.memory.scoutComplete  = false;
    } else {
        // All rooms are fresh — clear target and wait at home to prevent bouncing
        creep.memory.targetRoomName = undefined;
        if (creep.room.name !== homeRoom.name) {
            const exitDir = creep.room.findExitTo(homeRoom.name);
            if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
                const exit = creep.pos.findClosestByRange(exitDir);
                if (exit) creep.moveTo(exit, { reusePath: 5 });
            }
        }
    }
}
