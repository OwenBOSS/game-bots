import { getCollectorQuota } from './spawnManager';

const REPORT_INTERVAL  = 50;
const LOG_INTERVAL     = 200;
const LOG_MAX_ENTRIES  = 500;
const LAYOUT_INTERVAL  = 1000;

export function reportStats(room: Room): void {
    const snap = buildSnapshot(room);

    if (Game.time % LOG_INTERVAL === 0) {
        if (!Memory.statsLog) Memory.statsLog = [];
        Memory.statsLog.push(snap);
        if (Memory.statsLog.length > LOG_MAX_ENTRIES) {
            Memory.statsLog = Memory.statsLog.slice(-LOG_MAX_ENTRIES);
        }
    }

    if (Game.time % LAYOUT_INTERVAL === 0) captureRoomLayout(room);

    if (Game.time % REPORT_INTERVAL !== 0) return;

    const ctrl = room.controller;
    const allCreeps = Object.values(Game.creeps).filter(c => c.room.name === room.name);
    const roles: Record<string, number> = {};
    for (const c of allCreeps) roles[c.memory.role] = (roles[c.memory.role] ?? 0) + 1;

    const sc = (type: StructureConstant, neutral = false) => ({
        built:   room.find(FIND_STRUCTURES,           { filter: s => s.structureType === type }).length,
        pending: neutral
            ? room.find(FIND_CONSTRUCTION_SITES,    { filter: s => s.structureType === type }).length
            : room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === type }).length,
    });

    const towers = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER }) as StructureTower[];
    const towerPct = towers.map(t => Math.floor(t.store[RESOURCE_ENERGY] / (t.store.getCapacity(RESOURCE_ENERGY) ?? 1) * 100));

    const scoreMapEntries = Object.entries(Memory.scoreMap ?? {});
    const topScores = scoreMapEntries
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, 5)
        .map(([r, d]) => ({ room: r, score: d.score, age: Game.time - d.tick }));

    const totalCachedValue = Object.values(Memory.scoreCache ?? {}).reduce((sum, e) => sum + e.value, 0);
    const collectors = roles['collector'] ?? 0;
    const quota = getCollectorQuota(room);
    const mem = room.memory as RoomMemory;

    const intel = Object.entries(Memory.roomIntel ?? {}).map(([r, d]) => ({
        room: r, age: Game.time - d.tick, hostiles: d.hasHostiles, scores: d.scoreCount,
    }));

    const full = {
        tick:  Game.time,
        rcl:   ctrl?.level ?? 0,
        energy: {
            avail: room.energyAvailable,
            cap:   room.energyCapacityAvailable,
            pct:   Math.floor(room.energyAvailable / Math.max(room.energyCapacityAvailable, 1) * 100),
        },
        controller: ctrl ? {
            pct:      Math.floor(ctrl.progress / Math.max(ctrl.progressTotal, 1) * 100),
            progress: ctrl.progress,
            total:    ctrl.progressTotal,
        } : null,
        creeps:     { total: allCreeps.length, ...roles },
        structures: {
            roads:      sc(STRUCTURE_ROAD, true),
            containers: sc(STRUCTURE_CONTAINER, true),
            extensions: sc(STRUCTURE_EXTENSION),
            towers:     { ...sc(STRUCTURE_TOWER), energy_pct: towerPct },
        },
        sites_total: room.find(FIND_CONSTRUCTION_SITES).length,
        scores: {
            activeRooms: scoreMapEntries.length,
            cacheSize:   Object.keys(Memory.scoreCache ?? {}).length,
            totalValue:  totalCachedValue,
            topRooms:    topScores,
        },
        collectors: { count: collectors, quota },
        observer: {
            enabled:    mem.observerEnabled ?? false,
            knownRooms: Memory.knownRooms?.length ?? 0,
            queued:     Memory.observerTargets?.length ?? 0,
        },
        intel,
        log_entries: Memory.statsLog?.length ?? 0,
    };

    console.log(`=== season10:stats:${room.name}:${Game.time} ===`);
    console.log(JSON.stringify(full));
}

function captureRoomLayout(room: Room): void {
    if (!Memory.roomLayout) Memory.roomLayout = {};
    const p = (s: { pos: RoomPosition }) => ({ x: s.pos.x, y: s.pos.y });

    Memory.roomLayout[room.name] = {
        tick:       Game.time,
        room:       room.name,
        rcl:        room.controller?.level ?? 0,
        sources:    room.find(FIND_SOURCES).map(s => ({ id: s.id as string, x: s.pos.x, y: s.pos.y })),
        controller: room.controller
            ? { id: room.controller.id as string, x: room.controller.pos.x, y: room.controller.pos.y }
            : null,
        spawns:     room.find(FIND_MY_SPAWNS).map(s => ({ id: s.id as string, name: s.name, x: s.pos.x, y: s.pos.y })),
        extensions: room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_EXTENSION }).map(p),
        containers: room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_CONTAINER }).map(s => {
            const c = s as StructureContainer;
            return { x: s.pos.x, y: s.pos.y, energy: c.store[RESOURCE_ENERGY], capacity: c.store.getCapacity(RESOURCE_ENERGY) ?? 2000 };
        }),
        storage: room.storage ? {
            x: room.storage.pos.x, y: room.storage.pos.y,
            energy:   room.storage.store[RESOURCE_ENERGY],
            capacity: room.storage.store.getCapacity(RESOURCE_ENERGY) ?? 1000000,
        } : null,
        towers:  room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER }).map(s => ({
            x: s.pos.x, y: s.pos.y, energy: (s as StructureTower).store[RESOURCE_ENERGY],
        })),
        roads:   room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_ROAD }).map(p),
        sites:   room.find(FIND_CONSTRUCTION_SITES).map(s => ({
            type: s.structureType, x: s.pos.x, y: s.pos.y, progress: s.progress, total: s.progressTotal,
        })),
        ascii:   buildAsciiMap(room),
    };
}

function buildAsciiMap(room: Room): string {
    const terrain = room.getTerrain();
    const grid: string[][] = [];
    for (let y = 0; y < 50; y++) {
        const row: string[] = [];
        for (let x = 0; x < 50; x++) {
            const t = terrain.get(x, y);
            row.push(t === TERRAIN_MASK_WALL ? '#' : t === TERRAIN_MASK_SWAMP ? '~' : '.');
        }
        grid.push(row);
    }
    const set = (pos: RoomPosition, ch: string) => { grid[pos.y][pos.x] = ch; };
    for (const s of room.find(FIND_STRUCTURES,    { filter: s => s.structureType === STRUCTURE_ROAD }))      set(s.pos, 'r');
    for (const s of room.find(FIND_STRUCTURES,    { filter: s => s.structureType === STRUCTURE_CONTAINER })) set(s.pos, 'c');
    for (const s of room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_EXTENSION })) set(s.pos, 'e');
    for (const s of room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER }))     set(s.pos, 'T');
    if (room.storage)    set(room.storage.pos,    'K');
    for (const s of room.find(FIND_CONSTRUCTION_SITES)) set(s.pos, '*');
    if (room.controller) set(room.controller.pos, 'C');
    for (const s of room.find(FIND_SOURCES))   set(s.pos, 'S');
    for (const s of room.find(FIND_MY_SPAWNS)) set(s.pos, 'O');
    return grid.map(row => row.join('')).join('\n');
}

function buildSnapshot(room: Room): StatSnapshot {
    const ctrl = room.controller;
    const allCreeps = Object.values(Game.creeps).filter(c => c.room.name === room.name);
    const roles: Record<string, number> = {};
    for (const c of allCreeps) roles[c.memory.role] = (roles[c.memory.role] ?? 0) + 1;

    const count = (type: StructureConstant) =>
        room.find(FIND_STRUCTURES, { filter: s => s.structureType === type }).length;

    const topScores = Object.entries(Memory.scoreMap ?? {})
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, 3)
        .map(([r, d]) => ({ room: r, score: d.score }));

    return {
        tick:  Game.time,
        rcl:   ctrl?.level ?? 0,
        energy: {
            avail: room.energyAvailable,
            cap:   room.energyCapacityAvailable,
            pct:   Math.floor(room.energyAvailable / Math.max(room.energyCapacityAvailable, 1) * 100),
        },
        creeps: roles,
        structs: {
            roads:      count(STRUCTURE_ROAD),
            containers: count(STRUCTURE_CONTAINER),
            extensions: count(STRUCTURE_EXTENSION),
            towers:     count(STRUCTURE_TOWER),
        },
        scores: {
            activeRooms: Object.keys(Memory.scoreMap ?? {}).length,
            cacheSize:   Object.keys(Memory.scoreCache ?? {}).length,
            topRooms:    topScores,
        },
        collectors: {
            count: roles['collector'] ?? 0,
            quota: getCollectorQuota(room),
        },
    };
}
