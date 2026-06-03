// Advanced combat unit.
// Has HEAL parts, retreat logic, and obeys per-room RALLY/MARCH/ENGAGE state.
// When assigned to a quad, uses quad-coordinated target ID (set by quadManager).

import { moveTo as smartMove } from '../utils/trafficManager';

const RETREAT_THRESHOLD = 0.3;

export function runWarrior(creep: Creep): void {
    // Always try to heal self if damaged (HEAL action is independent of movement)
    if (creep.hits < creep.hitsMax) {
        creep.heal(creep);
    }

    // Retreat when critically wounded — return home to recover
    if (creep.hits < creep.hitsMax * RETREAT_THRESHOLD) {
        retreatToHome(creep);
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
            rallyAtSpawn(creep);
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
    engageInRoom(creep);
}

function executeMarch(creep: Creep): void {
    const pid         = creep.memory.platoonId;
    const homeMemory  = creep.memory.homeRoom ? Game.rooms[creep.memory.homeRoom]?.memory : undefined;
    const orders      = pid ? homeMemory?.platoonOrders?.[pid] as any : undefined;
    const targetRoom  = creep.memory.targetRoomName;

    // FEINT: after the feint window expires, fall back home
    if (orders?.tactic === 'FEINT' && orders.feintEndTick && Game.time > orders.feintEndTick) {
        retreatToHome(creep);
        return;
    }

    // MAIN: hold at home until engageTick — let the feint platoon draw fire first
    if (orders?.tactic === 'MAIN' && orders.engageTick && Game.time < orders.engageTick) {
        if (isHome(creep)) return; // already home, just wait
        travelHome(creep);
        return;
    }

    // FLANK / MAIN after delay: travel through waypoint room first
    const waypoint = orders?.waypointRoom as string | undefined;
    if (waypoint && creep.room.name !== waypoint && creep.room.name !== targetRoom) {
        moveToRoom(creep, waypoint);
        return;
    }

    // Standard: move to target room then engage
    if (targetRoom && creep.room.name !== targetRoom) {
        moveToRoom(creep, targetRoom);
        return;
    }

    // We're in the target room. If state is still MARCH the group hasn't fully
    // assembled yet — hold at room center so we don't engage alone.
    const currentState = homeMemory?.combatState ?? 'RALLY';
    if (currentState === 'MARCH') {
        smartMove(creep, new RoomPosition(25, 25, creep.room.name), { reusePath: 5 });
        return;
    }

    engageInRoom(creep);
}

function rallyAtSpawn(creep: Creep): void {
    if (!isHome(creep)) { travelHome(creep); return; }
    if (yieldToEconomy(creep)) return; // don't block sources or containers

    const spawn = creep.pos.findClosestByPath(FIND_MY_SPAWNS);
    if (!spawn) return;

    const target = stagingSlot(creep.room, spawn, creep.name);
    if (creep.pos.getRangeTo(target) > 0) {
        smartMove(creep, target, { reusePath: 5 });
    }
}

function retreatToHome(creep: Creep): void {
    if (!isHome(creep)) { travelHome(creep); return; }
    const spawn = creep.pos.findClosestByPath(FIND_MY_SPAWNS);
    if (!spawn) return;
    const target = stagingSlot(creep.room, spawn, creep.name);
    if (creep.pos.getRangeTo(target) > 0) smartMove(creep, target, { reusePath: 3 });
}

// ─── Yield & staging ─────────────────────────────────────────────────────────

// Returns true if the creep was blocking an economic tile and moved away.
// Call this during RALLY so combat units never park on sources or containers.
function yieldToEconomy(creep: Creep): boolean {
    const adjacentSource = creep.pos.findInRange(FIND_SOURCES, 1).length > 0;
    const onContainer    = creep.pos.lookFor(LOOK_STRUCTURES)
        .some(s => s.structureType === STRUCTURE_CONTAINER);
    if (!adjacentSource && !onContainer) return false;

    // Move away from the nearest source
    const source = creep.pos.findClosestByRange(FIND_SOURCES);
    if (source) {
        const dx = Math.sign(creep.pos.x - source.pos.x) || 1;
        const dy = Math.sign(creep.pos.y - source.pos.y) || 1;
        const tx = Math.min(48, Math.max(1, creep.pos.x + dx * 3));
        const ty = Math.min(48, Math.max(1, creep.pos.y + dy * 3));
        smartMove(creep,new RoomPosition(tx, ty, creep.room.name), { reusePath: 3 });
    }
    return true;
}

// djb2-style hash: maps a creep name to a stable slot index 0..count-1.
// Different warriors get different slots → they spread across the staging ring.
function nameSlot(name: string, count: number): number {
    let h = 5381;
    for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) & 0xffff;
    return h % count;
}

// Collect all valid rally tiles in a ring around spawn (radius 4–8, away from
// sources/containers), then assign this warrior a unique tile by name hash.
// Minimum radius 4 (vs old 3) gives economy one extra tile of breathing room.
function stagingSlot(room: Room, spawn: StructureSpawn, creepName: string): RoomPosition {
    const sources    = room.find(FIND_SOURCES);
    const containers = room.find(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_CONTAINER,
    });
    const terrain = room.getTerrain();

    const candidates: RoomPosition[] = [];
    for (let r = 4; r <= 8; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                const x = spawn.pos.x + dx;
                const y = spawn.pos.y + dy;
                if (x < 1 || x > 48 || y < 1 || y > 48) continue;
                if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

                const pos = new RoomPosition(x, y, room.name);
                if (sources.some(s => pos.getRangeTo(s) < 3)) continue;
                if (containers.some(c => pos.getRangeTo(c) < 2)) continue;
                candidates.push(pos);
            }
        }
    }

    if (candidates.length === 0) return spawn.pos;
    return candidates[nameSlot(creepName, candidates.length)];
}

function isHome(creep: Creep): boolean {
    const home = creep.memory.homeRoom;
    if (home) return creep.room.name === home;
    return !!Game.rooms[creep.room.name]?.controller?.my; // fallback for legacy creeps
}

function travelHome(creep: Creep): void {
    const dest = creep.memory.homeRoom ??
        Object.keys(Game.rooms).find(r => Game.rooms[r]?.controller?.my);
    if (dest) moveToRoom(creep, dest);
}

function engageInRoom(creep: Creep): void {
    // Quad-coordinated target takes priority (set by quadManager)
    const quadTarget = creep.memory.targetId
        ? Game.getObjectById(creep.memory.targetId as Id<Creep | AnyOwnedStructure>)
        : null;
    const target = (quadTarget as Creep | AnyOwnedStructure | null) ?? findCombatTarget(creep);
    if (!target) {
        // Patrol center — there may be nothing left to attack
        smartMove(creep,new RoomPosition(25, 25, creep.room.name), { reusePath: 10 });
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
        smartMove(creep,target, { reusePath: 3 });
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
        if (exit) smartMove(creep,exit, { reusePath: 3 });
    }
}
