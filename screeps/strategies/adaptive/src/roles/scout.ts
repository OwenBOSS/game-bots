// Scout: patrols every room adjacent to any owned room.

import { moveTo } from '../utils/trafficManager';
// Rooms bordering owned territory are rescanned every BORDER_STALE_TICKS (100)
// for early-warning purposes. Other room types use the standard STALE_TICKS (500).
// Clears targetRoomName when all rooms are fresh to prevent idle bouncing.

const STALE_TICKS        = 500;
const BORDER_STALE_TICKS = 100; // frequent rescan near our borders for early warning

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
            if (exit) moveTo(creep,exit, { reusePath: 3 });
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

    // Update every owned room's per-room scoutTick and enemyRoomName so each
    // room's strategy FSM can independently decide whether to RUSH or DEFEND.
    const ownedRooms = Object.values(Game.rooms).filter(r => r.controller?.my);
    for (const owned of ownedRooms) {
        owned.memory.scoutTick = Game.time;
        if (enemySpawns > 0 || enemyCreeps > 0) {
            const currentStrength = owned.memory.enemyRoomName
                ? (Memory.roomIntel[owned.memory.enemyRoomName]?.strength ?? Infinity)
                : Infinity;
            if (strength < currentStrength) {
                owned.memory.enemyRoomName = room.name;
                owned.memory.enemyStrength = strength;
            }
        }
    }

    console.log(`[scout] ${room.name} str=${strength} ctrl=${!!room.controller} owned=${!!room.controller?.owner} sources=${room.find(FIND_SOURCES).length}`);
}

function assignNextTarget(creep: Creep): void {
    const ownedRooms = Object.values(Game.rooms).filter(r => r.controller?.my);
    if (ownedRooms.length === 0) return;

    // Collect all rooms adjacent to ANY owned room (excluding owned rooms themselves)
    const ownedNames = new Set(ownedRooms.map(r => r.name));
    const borderRooms = new Set<string>();
    for (const room of ownedRooms) {
        const exits = Game.map.describeExits(room.name);
        if (!exits) continue;
        for (const neighbor of Object.values(exits)) {
            if (neighbor && !ownedNames.has(neighbor)) borderRooms.add(neighbor);
        }
    }

    const intel   = Memory.roomIntel ?? {};
    const targets = Array.from(borderRooms);

    // Priority 1: rooms never scanned before
    const unscanned = targets.find(r => !intel[r]);
    if (unscanned) {
        creep.memory.targetRoomName = unscanned;
        creep.memory.scoutComplete  = false;
        return;
    }

    // Priority 2: stale border rooms (early-warning rescan at 100 ticks)
    const staleBorder = targets.find(r => Game.time - (intel[r]?.scannedAt ?? 0) > BORDER_STALE_TICKS);
    if (staleBorder) {
        creep.memory.targetRoomName = staleBorder;
        creep.memory.scoutComplete  = false;
        return;
    }

    // All rooms fresh — wait in the first owned room to avoid pointless travel
    creep.memory.targetRoomName = undefined;
    const homeRoom = ownedRooms[0];
    if (creep.room.name !== homeRoom.name) {
        const exitDir = creep.room.findExitTo(homeRoom.name);
        if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
            const exit = creep.pos.findClosestByRange(exitDir);
            if (exit) moveTo(creep,exit, { reusePath: 5 });
        }
    }
}
