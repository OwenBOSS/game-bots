// Season 10 spawn manager — RC-level aware, uses bodyBuilder for correct body selection.
// Priority: harvesters → scouts (RC1) → collectors (RC2+) → collectors above upgraders (RC5+).

import { buildCollectorBody, buildHarvesterBody, buildScoutBody } from '../utils/bodyBuilder';

const MIN_HARVESTERS = 2;

export function getCollectorQuota(room: Room): number {
    const storage = room.storage;
    if (!storage) return 2;
    const energy = storage.store[RESOURCE_ENERGY];
    if (energy >= 200000) return 8;
    if (energy >= 100000) return 5;
    if (energy >= 50000)  return 3;
    return 2;
}

export function manageSpawns(room: Room): void {
    const spawns = room.find(FIND_MY_SPAWNS).filter((s: StructureSpawn) => !s.spawning);
    if (spawns.length === 0) return;

    const spawn = spawns[0];
    const creeps = room.find(FIND_MY_CREEPS);
    const harvesters = creeps.filter((c: Creep) => c.memory.role === 'harvester').length;
    const collectors = creeps.filter((c: Creep) => c.memory.role === 'collector').length;
    const scouts     = creeps.filter((c: Creep) => c.memory.role === 'scout').length;

    const level = room.controller?.level ?? 1;
    const mem   = room.memory as RoomMemory;

    // 1. Always maintain minimum harvesters first
    if (harvesters < MIN_HARVESTERS) {
        trySpawn(spawn, 'harvester', buildHarvesterBody(room.energyAvailable));
        return;
    }

    // 2. RC1: spawn one scout immediately if flagged
    if (level === 1 && mem.spawnScoutNext && scouts === 0) {
        trySpawn(spawn, 'scout', buildScoutBody(room.energyAvailable));
        return;
    }

    // 3. Determine collector quota
    const quota = resolveCollectorQuota(room, level, mem);

    // 4. Spawn collector if under quota
    if (collectors < quota) {
        trySpawn(spawn, 'collector', buildCollectorBody(room.energyAvailable));
        return;
    }
}

function resolveCollectorQuota(room: Room, level: number, mem: RoomMemory): number {
    if (mem.dynamicCollectorQuota) return getCollectorQuota(room);
    if (mem.collectorQuota !== undefined) return mem.collectorQuota;
    // Defaults by level
    if (level >= 5) return 5;
    if (level >= 3) return 3;
    if (level >= 2) return 1;
    return 0; // RC1: no dedicated collector yet
}

function trySpawn(spawn: StructureSpawn, role: string, body: BodyPartConstant[] | null): void {
    if (!body) return;
    const name = `${role}_${Game.time}`;
    spawn.spawnCreep(body, name, { memory: { role, working: false } as CreepMemory });
}
