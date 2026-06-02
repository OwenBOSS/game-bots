import { REGIME } from '../regime';
import { period } from '../utils/period';
import { computeTotalEnergy } from './economyManager';

const REPORT_INTERVAL  = 50;
const LOG_INTERVAL     = 200;
const LOG_MAX_ENTRIES  = 500;
const LAYOUT_INTERVAL  = 1000;

export function reportStats(room: Room): void {
    const snap = buildSnapshot(room);

    // Broadcast force-capture tick so all rooms capture on the same tick, not just the first
    if (Memory.captureLayout) { Memory.captureLayoutAt = Game.time; Memory.captureLayout = false; }
    if (Memory.captureLayoutAt === Game.time || period(LAYOUT_INTERVAL, `layout:${room.name}`)) captureRoomLayout(room);

    if (period(LOG_INTERVAL, 'stats:log')) {
        if (!Memory.statsLog) Memory.statsLog = [];
        Memory.statsLog.push(snap);
        if (Memory.statsLog.length > LOG_MAX_ENTRIES) {
            Memory.statsLog = Memory.statsLog.slice(-LOG_MAX_ENTRIES);
        }
    }

    if (!period(REPORT_INTERVAL, 'stats:report')) return;

    const ctrl = room.controller;
    const allCreeps = Object.values(Game.creeps);
    const roles: Record<string, number> = {};
    for (const c of allCreeps) roles[c.memory.role] = (roles[c.memory.role] ?? 0) + 1;

    const sc = (type: StructureConstant, neutral = false) => ({
        built:   room.find(FIND_STRUCTURES, { filter: s => s.structureType === type }).length,
        pending: neutral
            ? room.find(FIND_CONSTRUCTION_SITES,    { filter: s => s.structureType === type }).length
            : room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === type }).length,
    });

    const towers = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER }) as StructureTower[];
    const towerEnergy = towers.map(t => Math.floor(t.store[RESOURCE_ENERGY] / (t.store.getCapacity(RESOURCE_ENERGY) ?? 1) * 100));

    const ramparts = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_RAMPART }) as StructureRampart[];
    const rampartMin = ramparts.length > 0 ? Math.min(...ramparts.map(r => r.hits)) : null;

    const intel: Record<string, { str: number; age: number }> = {};
    for (const [r, data] of Object.entries(Memory.roomIntel ?? {})) {
        intel[r] = { str: data.strength, age: Game.time - data.scannedAt };
    }

    const full = {
        tick:    Game.time,
        phase:   room.memory.phase ?? 'ECONOMY',
        rcl:     ctrl?.level ?? 0,
        energy:  (() => { const { current, capacity } = computeTotalEnergy(room); return { avail: room.energyAvailable, cap: room.energyCapacityAvailable, totalAvail: current, totalCap: capacity, pct: Math.floor(room.energyAvailable / Math.max(room.energyCapacityAvailable, 1) * 100) }; })(),
        controller: ctrl ? { pct: Math.floor(ctrl.progress / Math.max(ctrl.progressTotal, 1) * 100), progress: ctrl.progress, total: ctrl.progressTotal } : null,
        creeps:  { total: allCreeps.length, ...roles },
        structures: {
            roads:      sc(STRUCTURE_ROAD,      true),
            containers: sc(STRUCTURE_CONTAINER, true),
            extensions: sc(STRUCTURE_EXTENSION),
            towers:     { ...sc(STRUCTURE_TOWER), energy_pct: towerEnergy },
            ramparts:   { ...sc(STRUCTURE_RAMPART), min_hits: rampartMin },
        },
        sites_total: room.find(FIND_CONSTRUCTION_SITES).length,
        economy: room.memory.energyStatus ?? null,
        combat:  {
            state:    room.memory.combatState ?? 'RALLY',
            warriors: roles['warrior'] ?? 0,
            rangers:  roles['ranger']  ?? 0,
            healers:  roles['healer']  ?? 0,
            target:   room.memory.enemyRoomName ?? null,
            tactics:  room.memory.platoonOrders ?? null,
        },
        intel,
        log_entries: Memory.statsLog?.length ?? 0,
    };

    console.log(`=== adaptive:stats:${room.name}:${Game.time} ===`);
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
        controller: room.controller ? { id: room.controller.id as string, x: room.controller.pos.x, y: room.controller.pos.y } : null,
        spawns:     room.find(FIND_MY_SPAWNS).map(s => ({ id: s.id as string, name: s.name, x: s.pos.x, y: s.pos.y })),
        extensions: room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_EXTENSION }).map(p),
        containers: room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_CONTAINER }).map(s => {
            const c = s as StructureContainer;
            return { x: s.pos.x, y: s.pos.y, energy: c.store[RESOURCE_ENERGY], capacity: c.store.getCapacity(RESOURCE_ENERGY) ?? 2000 };
        }),
        storage:    room.storage ? { x: room.storage.pos.x, y: room.storage.pos.y, energy: room.storage.store[RESOURCE_ENERGY], capacity: room.storage.store.getCapacity(RESOURCE_ENERGY) ?? 1000000 } : null,
        towers:     room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER }).map(s => ({ x: s.pos.x, y: s.pos.y, energy: (s as StructureTower).store[RESOURCE_ENERGY] })),
        ramparts:   room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_RAMPART }).map(p),
        roads:      room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_ROAD }).map(p),
        links:      room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_LINK }).map(p),
        sites:      room.find(FIND_CONSTRUCTION_SITES).map(s => ({ type: s.structureType, x: s.pos.x, y: s.pos.y, progress: s.progress, total: s.progressTotal })),
        ascii:      buildAsciiMap(room),
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
    for (const s of room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_ROAD }))         set(s.pos, 'r');
    for (const s of room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_CONTAINER }))    set(s.pos, 'c');
    for (const s of room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_EXTENSION })) set(s.pos, 'e');
    for (const s of room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_LINK }))      set(s.pos, 'L');
    for (const s of room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER }))     set(s.pos, 'T');
    if (room.storage) set(room.storage.pos, 'K');
    for (const s of room.find(FIND_CONSTRUCTION_SITES)) set(s.pos, '*');
    if (room.controller) set(room.controller.pos, 'C');
    for (const s of room.find(FIND_SOURCES))    set(s.pos, 'S');
    for (const s of room.find(FIND_MY_SPAWNS))  set(s.pos, 'O');
    return grid.map(row => row.join('')).join('\n');
}

function buildSnapshot(room: Room): StatSnapshot {
    const ctrl = room.controller;
    const allCreeps = Object.values(Game.creeps);
    const roles: Record<string, number> = {};
    for (const c of allCreeps) roles[c.memory.role] = (roles[c.memory.role] ?? 0) + 1;

    const count = (type: StructureConstant) =>
        room.find(FIND_STRUCTURES, { filter: s => s.structureType === type }).length;

    return {
        tick:    Game.time,
        regime:  REGIME,
        phase:   room.memory.phase ?? 'ECONOMY',
        rcl:     ctrl?.level ?? 0,
        energy:  (() => { const { current, capacity } = computeTotalEnergy(room); return { avail: room.energyAvailable, cap: room.energyCapacityAvailable, totalAvail: current, totalCap: capacity, netRate: room.memory.energyStatus?.netRate ?? null, bottleneck: room.memory.energyStatus?.bottleneck ?? null }; })(),
        creeps:  roles,
        ctrl:    ctrl ? { pct: Math.floor(ctrl.progress / Math.max(ctrl.progressTotal, 1) * 100), progress: ctrl.progress, total: ctrl.progressTotal } : null,
        structs: {
            roads:      count(STRUCTURE_ROAD),
            containers: count(STRUCTURE_CONTAINER),
            extensions: count(STRUCTURE_EXTENSION),
            towers:     count(STRUCTURE_TOWER),
            ramparts:   count(STRUCTURE_RAMPART),
        },
        combat:  {
            state:    room.memory.combatState ?? 'RALLY',
            warriors: roles['warrior'] ?? 0,
            rangers:  roles['ranger']  ?? 0,
            target:   room.memory.enemyRoomName ?? null,
        },
    };
}
