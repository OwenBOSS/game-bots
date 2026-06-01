// Logs a compact structured snapshot every REPORT_INTERVAL ticks.
// Paste one block into chat for analysis.

const REPORT_INTERVAL = 50;

export function reportStats(room: Room): void {
    if (Game.time % REPORT_INTERVAL !== 0) return;

    const ctrl = room.controller;
    const creeps = room.find(FIND_MY_CREEPS);

    // Creep count by role
    const roles: Record<string, number> = {};
    for (const c of creeps) {
        roles[c.memory.role] = (roles[c.memory.role] ?? 0) + 1;
    }

    // Structure counts (built + pending).
    // Containers are neutral structures — their construction sites have my:false,
    // so we must use FIND_CONSTRUCTION_SITES (not FIND_MY_CONSTRUCTION_SITES) for them.
    const sc = (type: StructureConstant, neutral = false) => ({
        built:   room.find(FIND_STRUCTURES, { filter: s => s.structureType === type }).length,
        pending: neutral
            ? room.find(FIND_CONSTRUCTION_SITES,    { filter: s => s.structureType === type }).length
            : room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === type }).length,
    });

    // Tower energy levels
    const towers = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER }) as StructureTower[];
    const towerEnergy = towers.map(t => Math.floor(t.store[RESOURCE_ENERGY] / t.store.getCapacity(RESOURCE_ENERGY)! * 100));

    // Rampart min hits (tells you if your defenses are being eroded)
    const ramparts = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_RAMPART }) as StructureRampart[];
    const rampartMin = ramparts.length > 0 ? Math.min(...ramparts.map(r => r.hits)) : null;

    // Room intel summary
    const intel: Record<string, { str: number; age: number }> = {};
    for (const [r, data] of Object.entries(Memory.roomIntel ?? {})) {
        intel[r] = { str: data.strength, age: Game.time - data.scannedAt };
    }

    const stats = {
        tick:    Game.time,
        phase:   Memory.phase ?? 'ECONOMY',
        rcl:     ctrl?.level ?? 0,
        energy: {
            avail:    room.energyAvailable,
            cap:      room.energyCapacityAvailable,
            pct:      Math.floor(room.energyAvailable / Math.max(room.energyCapacityAvailable, 1) * 100),
        },
        controller: ctrl ? {
            pct:      Math.floor(ctrl.progress / Math.max(ctrl.progressTotal, 1) * 100),
            progress: ctrl.progress,
            total:    ctrl.progressTotal,
        } : null,
        creeps:  { total: creeps.length, ...roles },
        structures: {
            roads:      sc(STRUCTURE_ROAD,      true),
            containers: sc(STRUCTURE_CONTAINER, true),
            extensions: sc(STRUCTURE_EXTENSION),
            towers:     { ...sc(STRUCTURE_TOWER), energy_pct: towerEnergy },
            ramparts:   { ...sc(STRUCTURE_RAMPART), min_hits: rampartMin },
        },
        sites_total: room.find(FIND_CONSTRUCTION_SITES).length,
        combat: {
            state:    Memory.combatState ?? 'RALLY',
            warriors: roles['warrior'] ?? 0,
            target:   Memory.enemyRoomName ?? null,
        },
        intel,
    };

    console.log(`=== adaptive:stats:${Game.time} ===`);
    console.log(JSON.stringify(stats));
}
