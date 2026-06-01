// Logs a compact snapshot every REPORT_INTERVAL ticks AND writes to a rolling
// in-memory log at LOG_INTERVAL ticks.
//
// To dump history from the Screeps console:
//   JSON.stringify(Memory.statsLog)
//
// To get a specific field across history:
//   Memory.statsLog.map(s => [s.tick, s.rcl, s.energy.avail])

const REPORT_INTERVAL = 50;   // console print frequency
const LOG_INTERVAL    = 200;  // Memory.statsLog write frequency
const LOG_MAX_ENTRIES = 500;  // rolling window (~100k ticks at LOG_INTERVAL=200)

export function reportStats(room: Room): void {
    const snap = buildSnapshot(room);

    // Write to rolling memory log (survives disconnect, readable any time)
    if (Game.time % LOG_INTERVAL === 0) {
        if (!Memory.statsLog) Memory.statsLog = [];
        Memory.statsLog.push(snap);
        if (Memory.statsLog.length > LOG_MAX_ENTRIES) {
            Memory.statsLog = Memory.statsLog.slice(-LOG_MAX_ENTRIES);
        }
    }

    // Print to console for live monitoring
    if (Game.time % REPORT_INTERVAL !== 0) return;

    const ctrl = room.controller;
    // Use Game.creeps (global) so warriors/scouts in remote rooms are counted
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
        phase:   Memory.phase ?? 'ECONOMY',
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
        economy: Memory.energyStatus ?? null,
        combat: { state: Memory.combatState ?? 'RALLY', warriors: roles['warrior'] ?? 0, rangers: roles['ranger'] ?? 0, healers: roles['healer'] ?? 0, target: Memory.enemyRoomName ?? null, tactics: Memory.platoonOrders ?? null },
        intel,
        log_entries: Memory.statsLog?.length ?? 0,
    };

    console.log(`=== adaptive:stats:${Game.time} ===`);
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
        phase:   Memory.phase ?? 'ECONOMY',
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
            state:    Memory.combatState ?? 'RALLY',
            warriors: roles['warrior'] ?? 0,
            rangers:  roles['ranger']  ?? 0,
            target:   Memory.enemyRoomName ?? null,
        },
    };
}
