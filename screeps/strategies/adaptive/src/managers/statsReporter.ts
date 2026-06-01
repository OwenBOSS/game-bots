const REPORT_INTERVAL = 50;
const LOG_INTERVAL    = 200;
const LOG_MAX_ENTRIES = 500;

export function reportStats(room: Room): void {
    const snap = buildSnapshot(room);

    if (Game.time % LOG_INTERVAL === 0) {
        if (!Memory.statsLog) Memory.statsLog = [];
        Memory.statsLog.push(snap);
        if (Memory.statsLog.length > LOG_MAX_ENTRIES) {
            Memory.statsLog = Memory.statsLog.slice(-LOG_MAX_ENTRIES);
        }
    }

    if (Game.time % REPORT_INTERVAL !== 0) return;

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
        energy:  { avail: room.energyAvailable, cap: room.energyCapacityAvailable, pct: Math.floor(room.energyAvailable / Math.max(room.energyCapacityAvailable, 1) * 100) },
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

function buildSnapshot(room: Room): StatSnapshot {
    const ctrl = room.controller;
    const allCreeps = Object.values(Game.creeps);
    const roles: Record<string, number> = {};
    for (const c of allCreeps) roles[c.memory.role] = (roles[c.memory.role] ?? 0) + 1;

    const count = (type: StructureConstant) =>
        room.find(FIND_STRUCTURES, { filter: s => s.structureType === type }).length;

    return {
        tick:    Game.time,
        phase:   room.memory.phase ?? 'ECONOMY',
        rcl:     ctrl?.level ?? 0,
        energy:  { avail: room.energyAvailable, cap: room.energyCapacityAvailable },
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
