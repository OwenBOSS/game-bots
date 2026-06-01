// Healer: attached to a platoon via creep.memory.platoonId.
// Follows platoon orders (same as warrior/ranger): respects FEINT timing,
// MAIN hold-and-wait, FLANK waypoints. Then heals the most wounded ally.
// Reads combat state from homeRoom.memory.combatState (per-room FSM).

const HEAL_THRESHOLD = 0.85;

export function runHealer(creep: Creep): void {
    // Self-heal always fires independently
    if (creep.hits < creep.hitsMax) {
        creep.heal(creep);
    }

    const homeMemory  = creep.memory.homeRoom ? Game.rooms[creep.memory.homeRoom]?.memory : undefined;
    const combatState = homeMemory?.combatState ?? 'RALLY';

    if (combatState === 'RALLY') {
        if (creep.memory.defendingRoom) {
            const target = creep.memory.defendingRoom;
            if (creep.room.name !== target) { moveToRoom(creep, target); return; }
            healPlatoon(creep);
            return;
        }
        rallyAtSpawn(creep);
        return;
    }

    // MARCH or ENGAGE — follow the platoon's assigned route
    const pid        = creep.memory.platoonId;
    const orders     = pid ? homeMemory?.platoonOrders?.[pid] as any : undefined;
    const targetRoom = creep.memory.targetRoomName;

    // MAIN tactic: hold home until the feint platoon has drawn fire
    if (orders?.tactic === 'MAIN' && orders.engageTick && Game.time < orders.engageTick) {
        if (!isHome(creep)) { travelHome(creep); }
        return;
    }

    // Route through waypoint first (for FLANK / MAIN)
    const waypoint = orders?.waypointRoom as string | undefined;
    if (waypoint && creep.room.name !== waypoint && creep.room.name !== targetRoom) {
        moveToRoom(creep, waypoint);
        return;
    }

    // Travel to enemy room
    if (targetRoom && creep.room.name !== targetRoom) {
        moveToRoom(creep, targetRoom);
        return;
    }

    // In the target room — heal the platoon
    healPlatoon(creep);
}

function healPlatoon(creep: Creep): void {
    const platoonId = creep.memory.platoonId;

    const allies = creep.room.find(FIND_MY_CREEPS, {
        filter: c =>
            (c.memory.role === 'warrior' || c.memory.role === 'ranger') &&
            (!platoonId || c.memory.platoonId === platoonId),
    });

    // Fall back to any allied fighter if platoon is empty
    const targets = allies.length > 0
        ? allies
        : creep.room.find(FIND_MY_CREEPS, {
            filter: c => c.memory.role === 'warrior' || c.memory.role === 'ranger',
        });

    if (targets.length === 0) {
        creep.moveTo(new RoomPosition(25, 25, creep.room.name), { reusePath: 10 });
        return;
    }

    const wounded = targets.filter(c => c.hits < c.hitsMax * HEAL_THRESHOLD);
    const healTarget = wounded.length > 0
        ? wounded.reduce((a, b) => a.hits / a.hitsMax < b.hits / b.hitsMax ? a : b)
        : creep.pos.findClosestByRange(targets)!;

    const range = creep.pos.getRangeTo(healTarget);
    if (range <= 1) {
        creep.heal(healTarget);
    } else if (range <= 3) {
        creep.rangedHeal(healTarget);
        creep.moveTo(healTarget, { reusePath: 2 });
    } else {
        creep.moveTo(healTarget, { reusePath: 2 });
    }
}

function rallyAtSpawn(creep: Creep): void {
    if (!isHome(creep)) { travelHome(creep); return; }
    if (yieldToEconomy(creep)) return;

    const spawn = creep.pos.findClosestByPath(FIND_MY_SPAWNS);
    if (!spawn) return;
    const target = stagingArea(creep.room, spawn);
    if (creep.pos.getRangeTo(target) > 1) {
        creep.moveTo(target, { reusePath: 5 });
    }
}

function yieldToEconomy(creep: Creep): boolean {
    const adjacentSource = creep.pos.findInRange(FIND_SOURCES, 1).length > 0;
    const onContainer    = creep.pos.lookFor(LOOK_STRUCTURES)
        .some(s => s.structureType === STRUCTURE_CONTAINER);
    if (!adjacentSource && !onContainer) return false;
    const source = creep.pos.findClosestByRange(FIND_SOURCES);
    if (source) {
        const dx = Math.sign(creep.pos.x - source.pos.x) || 1;
        const dy = Math.sign(creep.pos.y - source.pos.y) || 1;
        creep.moveTo(new RoomPosition(
            Math.min(48, Math.max(1, creep.pos.x + dx * 3)),
            Math.min(48, Math.max(1, creep.pos.y + dy * 3)),
            creep.room.name,
        ), { reusePath: 3 });
    }
    return true;
}

function stagingArea(room: Room, spawn: StructureSpawn): RoomPosition {
    const sources    = room.find(FIND_SOURCES);
    const containers = room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_CONTAINER });
    const terrain    = room.getTerrain();
    for (let r = 3; r <= 10; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                const x = spawn.pos.x + dx, y = spawn.pos.y + dy;
                if (x < 1 || x > 48 || y < 1 || y > 48) continue;
                if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
                const pos = new RoomPosition(x, y, room.name);
                if (sources.some(s => pos.getRangeTo(s) < 3)) continue;
                if (containers.some(c => pos.getRangeTo(c) < 2)) continue;
                return pos;
            }
        }
    }
    return spawn.pos;
}

function isHome(creep: Creep): boolean {
    const home = creep.memory.homeRoom;
    if (home) return creep.room.name === home;
    return !!Game.rooms[creep.room.name]?.controller?.my;
}

function travelHome(creep: Creep): void {
    const dest = creep.memory.homeRoom ??
        Object.keys(Game.rooms).find(r => Game.rooms[r]?.controller?.my);
    if (dest) moveToRoom(creep, dest);
}

function moveToRoom(creep: Creep, roomName: string): void {
    const exitDir = creep.room.findExitTo(roomName);
    if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
        const exit = creep.pos.findClosestByRange(exitDir);
        if (exit) creep.moveTo(exit, { reusePath: 3 });
    }
}
