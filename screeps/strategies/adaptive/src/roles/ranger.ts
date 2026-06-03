// Ranged attacker: stays at 3-tile range, kites melee enemies, uses rangedMassAttack
// when multiple enemies cluster. Shares rally/march/engage state with warriors.

import { moveTo as smartMove } from '../utils/trafficManager';

const RETREAT_HP = 0.25;
const KITE_RANGE = 3; // ideal engagement distance

export function runRanger(creep: Creep): void {
    if (creep.hits < creep.hitsMax) {
        creep.heal(creep); // HEAL is a separate action, always fires
    }

    if (creep.hits < creep.hitsMax * RETREAT_HP) {
        retreat(creep);
        return;
    }

    const homeMemory  = creep.memory.homeRoom ? Game.rooms[creep.memory.homeRoom]?.memory : undefined;
    const combatState = homeMemory?.combatState ?? 'RALLY';

    if (combatState === 'RALLY' && creep.memory.defendingRoom) {
        defendRoom(creep);
        return;
    }

    switch (combatState) {
        case 'RALLY':
            rally(creep);
            break;
        case 'MARCH':
        case 'ENGAGE':
            executeMarch(creep);
            break;
    }
}

function defendRoom(creep: Creep): void {
    const target = creep.memory.defendingRoom!;
    if (creep.room.name !== target) { moveToRoom(creep, target); return; }
    engage(creep);
}

function engage(creep: Creep): void {
    const nearbyEnemies = creep.pos.findInRange(FIND_HOSTILE_CREEPS, KITE_RANGE);

    if (nearbyEnemies.length >= 3) {
        creep.rangedMassAttack();
        return;
    }

    // Quad-coordinated target takes priority
    const quadTarget = creep.memory.targetId
        ? Game.getObjectById(creep.memory.targetId as Id<Creep | AnyOwnedStructure>)
        : null;
    const target = (quadTarget as Creep | AnyOwnedStructure | null) ?? findTarget(creep);
    if (!target) {
        smartMove(creep,new RoomPosition(25, 25, creep.room.name), { reusePath: 10 });
        return;
    }

    const range = creep.pos.getRangeTo(target);

    if (range <= KITE_RANGE) {
        creep.rangedAttack(target as Creep);
    }

    if (range > KITE_RANGE) {
        // Close in
        smartMove(creep,target, { reusePath: 3 });
    } else if (range < 2) {
        // Kite away from melee enemies
        const dx = creep.pos.x - (target as Creep).pos.x;
        const dy = creep.pos.y - (target as Creep).pos.y;
        const kiteDir = getDirection(dx, dy);
        if (kiteDir) creep.move(kiteDir);
    }
}

function findTarget(creep: Creep): Creep | AnyOwnedStructure | null {
    // Rangers prioritize towers (high-value threat) then structures then creeps
    const tower = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER,
    }) as StructureTower | null;
    if (tower) return tower;

    const hostile = creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS);
    if (hostile) return hostile;

    return creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES) as AnyOwnedStructure | null;
}

function executeMarch(creep: Creep): void {
    const pid        = creep.memory.platoonId;
    const homeMemory = creep.memory.homeRoom ? Game.rooms[creep.memory.homeRoom]?.memory : undefined;
    const orders     = pid ? homeMemory?.platoonOrders?.[pid] as any : undefined;
    const targetRoom = creep.memory.targetRoomName;

    if (orders?.tactic === 'FEINT' && orders.feintEndTick && Game.time > orders.feintEndTick) {
        retreat(creep);
        return;
    }
    if (orders?.tactic === 'MAIN' && orders.engageTick && Game.time < orders.engageTick) {
        if (isHome(creep)) return;
        travelHome(creep);
        return;
    }

    const waypoint = orders?.waypointRoom as string | undefined;
    if (waypoint && creep.room.name !== waypoint && creep.room.name !== targetRoom) {
        moveToRoom(creep, waypoint);
        return;
    }
    if (targetRoom && creep.room.name !== targetRoom) {
        moveToRoom(creep, targetRoom);
        return;
    }

    // In the target room but group not fully assembled — hold at center.
    const currentState = homeMemory?.combatState ?? 'RALLY';
    if (currentState === 'MARCH') {
        smartMove(creep, new RoomPosition(25, 25, creep.room.name), { reusePath: 5 });
        return;
    }

    engage(creep);
}

function rally(creep: Creep): void {
    if (!isHome(creep)) { travelHome(creep); return; }
    if (yieldToEconomy(creep)) return;

    const spawn = creep.pos.findClosestByPath(FIND_MY_SPAWNS);
    if (!spawn) return;
    const target = stagingArea(creep.room, spawn);
    if (creep.pos.getRangeTo(target) > 1) {
        smartMove(creep,target, { reusePath: 5 });
    }
}

function retreat(creep: Creep): void {
    if (!isHome(creep)) { travelHome(creep); return; }
    const spawn = creep.pos.findClosestByPath(FIND_MY_SPAWNS);
    if (spawn) smartMove(creep,spawn, { reusePath: 3 });
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
        smartMove(creep,new RoomPosition(
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
        if (exit) smartMove(creep,exit, { reusePath: 3 });
    }
}

function getDirection(dx: number, dy: number): DirectionConstant | null {
    if (dx === 0 && dy === 0) return null;
    const angle = Math.atan2(dy, dx);
    // Map angle to Screeps direction (1=TOP, 2=TOP_RIGHT, etc.)
    const octant = Math.round(angle / (Math.PI / 4));
    const dirs: DirectionConstant[] = [RIGHT, BOTTOM_RIGHT, BOTTOM, BOTTOM_LEFT, LEFT, TOP_LEFT, TOP, TOP_RIGHT];
    return dirs[((octant % 8) + 8) % 8];
}
