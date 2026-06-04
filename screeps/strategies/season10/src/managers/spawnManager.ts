// Season 10 spawn manager — RC-level aware, uses bodyBuilder for correct body selection.
// Priority: harvesters → scouts → builder → upgrader → haulers → collectors → hunters.

import { buildCollectorBody, buildHarvesterBody, buildHaulerBody, buildBuilderBody, buildScoutBody, buildHunterBody, buildUpgraderBody, buildDefenderBody } from '../utils/bodyBuilder';
import { findCached } from '../utils/tickCache';

const MIN_HARVESTERS = 2;
const MAX_BUILDERS = 1; // one builder until infrastructure is complete

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
    const allSpawns = findCached<StructureSpawn>(room, FIND_MY_SPAWNS);
    const spawns = allSpawns.filter((s: StructureSpawn) => !s.spawning);
    if (spawns.length === 0) return;

    const spawn = spawns[0];
    const creeps = findCached<Creep>(room, FIND_MY_CREEPS);
    const harvesters = creeps.filter((c: Creep) => c.memory.role === 'harvester').length;
    const collectors = creeps.filter((c: Creep) => c.memory.role === 'collector').length;
    const scouts     = creeps.filter((c: Creep) => c.memory.role === 'scout').length;
    const haulers    = creeps.filter((c: Creep) => c.memory.role === 'hauler').length;
    const builders   = creeps.filter((c: Creep) => c.memory.role === 'builder').length;
    const upgraders  = creeps.filter((c: Creep) => c.memory.role === 'upgrader').length;
    const hunters    = creeps.filter((c: Creep) => c.memory.role === 'hunter').length;
    const defenders  = creeps.filter((c: Creep) => c.memory.role === 'defender').length;

    const level = room.controller?.level ?? 1;
    const mem   = room.memory as RoomMemory;

    const e = room.energyAvailable;

    // 1. Always maintain minimum harvesters first
    if (harvesters < MIN_HARVESTERS) {
        const body = buildHarvesterBody(e); if (body) { trySpawn(spawn, 'harvester', body); return; }
    }

    // 1.5. Spawn defenders when armed hostiles are in the room — higher priority than economy
    {
        const armed = findCached<Creep>(room, FIND_HOSTILE_CREEPS).filter(
            (h: Creep) => h.body.some(p => p.type === ATTACK || p.type === RANGED_ATTACK || p.type === WORK)
        );
        if (armed.length > 0 && defenders < 2) {
            const body = buildDefenderBody(e);
            if (body) { trySpawn(spawn, 'defender', body, { homeRoom: room.name } as Partial<CreepMemory>); return; }
        }
    }

    // 2. Keep one builder when there are active construction sites (any RC)
    const hasSites = findCached<ConstructionSite>(room, FIND_CONSTRUCTION_SITES).length > 0;
    if (builders < MAX_BUILDERS && hasSites) {
        const body = buildBuilderBody(e); if (body) { trySpawn(spawn, 'builder', body); return; }
    }

    // 3. Always keep one upgrader (controller progress = more spawn capacity)
    if (upgraders < 1) {
        const body = buildUpgraderBody(e); if (body) { trySpawn(spawn, 'upgrader', body); return; }
    }

    // 4. Haulers: 1 per source — picks up dropped energy even before containers exist
    const sourceCount = findCached<Source>(room, FIND_SOURCES).length;
    if (haulers < sourceCount) {
        const body = buildHaulerBody(e); if (body) { trySpawn(spawn, 'hauler', body); return; }
    }

    // 5. Scout — after production roles; [MOVE×5] lasts 1500 ticks so low churn
    if (scouts === 0) {
        const body = buildScoutBody(e); if (body) { trySpawn(spawn, 'scout', body); return; }
    }

    // 6. Collectors
    const quota = resolveCollectorQuota(room, level, mem);
    if (collectors < quota) {
        const body = buildCollectorBody(e); if (body) { trySpawn(spawn, 'collector', body, { homeRoom: room.name }); return; }
    }

    // 7. Hunter if enemy collectors detected near Score rooms (RC3+)
    if (level >= 3 && hunters < 1 && enemiesNearScores()) {
        const body = buildHunterBody(e); if (body) trySpawn(spawn, 'hunter', body);
    }
}

function countHomeScores(room: Room): number {
    if (typeof FIND_SCORES === 'undefined') return 0;
    return (room.find as Function)(FIND_SCORES).length;
}

function resolveCollectorQuota(room: Room, level: number, mem: RoomMemory): number {
    if (mem.dynamicCollectorQuota) return getCollectorQuota(room);
    if (mem.collectorQuota !== undefined) return mem.collectorQuota;
    // Defaults by level — keep economy-first at low RC
    if (level >= 5) return 5;
    if (level >= 3) return 3;
    if (level >= 2) return 2;
    return 2; // RC1: two collectors while waiting for containers/builder
}

function enemiesNearScores(): boolean {
    const cache = Memory.scoreCache ?? {};
    const hotRooms = new Set(Object.values(cache).map(e => e.pos.roomName));
    for (const roomName of hotRooms) {
        const room = Game.rooms[roomName];
        if (room && room.find(FIND_HOSTILE_CREEPS).length > 0) return true;
    }
    return false;
}

function trySpawn(
    spawn: StructureSpawn,
    role: string,
    body: BodyPartConstant[] | null,
    extraMem: Partial<CreepMemory> = {}
): void {
    if (!body) return;
    const name = `${role}_${Game.time}`;
    const result = spawn.spawnCreep(body, name, { memory: { role, working: false, ...extraMem } as CreepMemory });
    if (result === OK) {
        const cost = body.reduce((s, p) => s + BODYPART_COST[p], 0);
        console.log(`[season10] Spawning ${name} [${body.join(',')}] (${cost}e)`);
    }
}
