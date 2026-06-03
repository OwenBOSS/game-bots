// Scavenger: fast creep that collects dropped energy and tombstones.

import { moveTo } from '../utils/trafficManager';
// Works in own room first; if a scavengeRoom is set and own room is clear,
// crosses into that room to loot (safe-mode rooms included — can enter, just can't attack).
// Returns home and deposits into storage, containers, or spawns.

const MIN_LOOT_AMOUNT = 30; // ignore tiny piles not worth the trip

export function runScavenger(creep: Creep): void {
    // Auto-dispatch to enemy room while our fighters are engaged there so we can
    // collect energy dropped by killed harvesters/haulers.  Clear it once combat ends.
    const homeRoom = creep.memory.homeRoom ? Game.rooms[creep.memory.homeRoom] : undefined;
    const enemyRoom = homeRoom?.memory.enemyRoomName;
    const combatActive = homeRoom?.memory.combatState === 'ENGAGE' || homeRoom?.memory.combatState === 'MARCH';
    if (combatActive && enemyRoom && !creep.memory.scavengeRoom) {
        creep.memory.scavengeRoom = enemyRoom;
    } else if (!combatActive && creep.memory.scavengeRoom && creep.memory.scavengeRoom === enemyRoom) {
        creep.memory.scavengeRoom = undefined;
    }

    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }

    if (creep.memory.working) {
        deposit(creep);
    } else {
        loot(creep);
    }
}

function loot(creep: Creep): void {
    // 1. Tombstones in current room (highest priority — about to vanish)
    const tombstone = creep.pos.findClosestByPath(FIND_TOMBSTONES, {
        filter: t => t.store[RESOURCE_ENERGY] >= MIN_LOOT_AMOUNT,
    });
    if (tombstone) {
        if (creep.withdraw(tombstone, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep,tombstone, { reusePath: 3 });
        }
        return;
    }

    // 2. Dropped energy in current room
    const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: r => r.resourceType === RESOURCE_ENERGY && r.amount >= MIN_LOOT_AMOUNT,
    });
    if (dropped) {
        if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
            moveTo(creep,dropped, { reusePath: 3 });
        }
        return;
    }

    // 3. Nothing in current room — if a scavenge target room is set, go there
    const scavengeRoom = creep.memory.scavengeRoom;
    if (scavengeRoom && creep.room.name !== scavengeRoom) {
        moveToRoom(creep, scavengeRoom);
        return;
    }

    // 4. In the scavenge room — pick up anything there too
    if (scavengeRoom && creep.room.name === scavengeRoom) {
        const remoteDropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
            filter: r => r.resourceType === RESOURCE_ENERGY && r.amount >= MIN_LOOT_AMOUNT,
        });
        if (remoteDropped) {
            if (creep.pickup(remoteDropped) === ERR_NOT_IN_RANGE) {
                moveTo(creep,remoteDropped, { reusePath: 3 });
            }
            return;
        }
        const remoteTombstone = creep.pos.findClosestByPath(FIND_TOMBSTONES, {
            filter: t => t.store[RESOURCE_ENERGY] >= MIN_LOOT_AMOUNT,
        });
        if (remoteTombstone) {
            if (creep.withdraw(remoteTombstone, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                moveTo(creep,remoteTombstone, { reusePath: 3 });
            }
            return;
        }
        // Remote room is clean — return home
        travelHome(creep);
        return;
    }

    // 5. Nothing to loot anywhere — idle near spawn
    if (!isHome(creep)) { travelHome(creep); return; }
    const spawn = creep.pos.findClosestByPath(FIND_MY_SPAWNS);
    if (spawn) moveTo(creep,spawn, { reusePath: 10 });
}

function deposit(creep: Creep): void {
    if (!isHome(creep)) { travelHome(creep); return; }

    // Prefer storage (large buffer), then containers, then spawn/extensions
    const storage = creep.room.storage;
    if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        if (creep.transfer(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep,storage, { reusePath: 5 });
        }
        return;
    }

    const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_CONTAINER &&
            (s as StructureContainer).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    }) as StructureContainer | null;
    if (container) {
        if (creep.transfer(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep,container, { reusePath: 5 });
        }
        return;
    }

    const fillTarget = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: (s): s is StructureSpawn | StructureExtension =>
            (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });
    if (fillTarget) {
        if (creep.transfer(fillTarget, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep,fillTarget, { reusePath: 5 });
        }
    }
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
        if (exit) moveTo(creep,exit, { reusePath: 3 });
    }
}
