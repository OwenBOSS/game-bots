// Scouts adjacent rooms and stores rich intel in Memory.roomIntel.
// Re-scouts rooms where intel is older than STALE_TICKS.
const STALE_TICKS = 500;

export function runScout(creep: Creep): void {
    const targetRoom = creep.memory.targetRoomName;
    if (!targetRoom) {
        assignNextTarget(creep);
        return;
    }

    // Travel to target room
    if (creep.room.name !== targetRoom) {
        const exitDir = creep.room.findExitTo(targetRoom);
        if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
            const exit = creep.pos.findClosestByRange(exitDir);
            if (exit) creep.moveTo(exit, { reusePath: 3 });
        }
        return;
    }

    // We're in the target room — scan and record intel
    if (!creep.memory.scoutComplete) {
        recordRoomIntel(creep.room);
        creep.memory.scoutComplete = true;
    }

    // Pick a new target or return home
    assignNextTarget(creep);
}

function recordRoomIntel(room: Room): void {
    if (!Memory.roomIntel) Memory.roomIntel = {};

    const enemyCreeps  = room.find(FIND_HOSTILE_CREEPS).length;
    const enemySpawns  = room.find(FIND_HOSTILE_STRUCTURES, { filter: s => s.structureType === STRUCTURE_SPAWN }).length;
    const enemyTowers  = room.find(FIND_HOSTILE_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER }).length;
    const strength     = enemyCreeps + enemySpawns * 5 + enemyTowers * 8;

    Memory.roomIntel[room.name] = {
        scannedAt: Game.time,
        enemyCreeps,
        enemySpawns,
        enemyTowers,
        strength,
    };

    // Update the global enemy target if this is the strongest hostile room we've seen
    if (enemySpawns > 0 || enemyCreeps > 0) {
        const currentEnemy = Memory.enemyRoomName;
        const currentStrength = currentEnemy ? (Memory.roomIntel[currentEnemy]?.strength ?? 0) : -1;
        if (!currentEnemy || strength < currentStrength) {
            // prefer the weakest enemy room as our target
            Memory.enemyRoomName = room.name;
            Memory.enemyStrength = strength;
            Memory.scoutTick = Game.time;
        }
    }

    console.log(`[adaptive] Scout intel: ${room.name} strength=${strength} (creeps=${enemyCreeps} spawns=${enemySpawns} towers=${enemyTowers})`);
}

// Find an adjacent room that hasn't been scouted yet or has stale intel.
function assignNextTarget(creep: Creep): void {
    const homeRoom = Object.values(Game.rooms).find(r => r.controller?.my);
    if (!homeRoom) return;

    const exits = Game.map.describeExits(homeRoom.name);
    if (!exits) return;

    const intel = Memory.roomIntel ?? {};
    const exitRooms = (Object.values(exits).filter(Boolean) as string[]);

    // Prefer unvisited rooms, then rooms with stale intel
    const target =
        exitRooms.find(r => !intel[r]) ??
        exitRooms.find(r => intel[r] && Game.time - intel[r].scannedAt > STALE_TICKS);

    if (target) {
        creep.memory.targetRoomName = target;
        creep.memory.scoutComplete = false;
    } else {
        // All rooms are fresh — return to home room and wait
        if (homeRoom && creep.room.name !== homeRoom.name) {
            const exitDir = creep.room.findExitTo(homeRoom.name);
            if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
                const exit = creep.pos.findClosestByRange(exitDir);
                if (exit) creep.moveTo(exit, { reusePath: 5 });
            }
        }
    }
}
