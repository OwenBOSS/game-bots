// Tracks energy flow and calculates dynamic spawn targets based on actual room state.
// Sampled every SAMPLE_INTERVAL ticks; keeps WINDOW_SIZE samples (= WINDOW_TICKS history).
//
// energyStatus.level drives spawn decisions:
//   SURPLUS  — energy growing, can spawn freely
//   STABLE   — balanced, spawn economy/infrastructure only
//   DEFICIT  — draining, hold combat spawns
//   CRITICAL — emergency, cull expensive creeps

const SAMPLE_INTERVAL = 5;   // sample every N ticks
const WINDOW_SIZE     = 20;  // samples kept (= WINDOW_SIZE × SAMPLE_INTERVAL ticks)
const MAX_HARVESTERS_PER_SOURCE = 4;

export type EnergyLevel = 'SURPLUS' | 'STABLE' | 'DEFICIT' | 'CRITICAL';

export interface EnergyStatus {
    netRate:  number;  // e/tick net (positive = growing)
    trend:    number;  // change in rate (positive = accelerating)
    pct:      number;  // current avail/cap %
    level:    EnergyLevel;
}

// ─── Sampling ─────────────────────────────────────────────────────────────────

export function trackEnergyFlow(room: Room): void {
    if (Game.time % SAMPLE_INTERVAL !== 0) return;

    if (!Memory.energyHistory) Memory.energyHistory = [];
    Memory.energyHistory.push({ tick: Game.time, avail: room.energyAvailable });
    if (Memory.energyHistory.length > WINDOW_SIZE) {
        Memory.energyHistory = Memory.energyHistory.slice(-WINDOW_SIZE);
    }

    Memory.energyStatus = computeStatus(room);
}

function computeStatus(room: Room): EnergyStatus {
    const h   = Memory.energyHistory ?? [];
    const cap = room.energyCapacityAvailable || 1;
    const pct = Math.round(room.energyAvailable / cap * 100);

    if (h.length < 4) {
        return { netRate: 0, trend: 0, pct, level: 'STABLE' };
    }

    const first = h[0];
    const last  = h[h.length - 1];
    const dt    = last.tick - first.tick;
    const netRate = dt > 0 ? (last.avail - first.avail) / dt : 0;

    // Trend: compare first-half rate vs second-half rate
    const mid    = h[Math.floor(h.length / 2)];
    const rate1  = (mid.avail  - first.avail) / Math.max(mid.tick  - first.tick, 1);
    const rate2  = (last.avail - mid.avail)   / Math.max(last.tick - mid.tick,   1);
    const trend  = rate2 - rate1;

    let level: EnergyLevel;
    if (pct < 20 && netRate < -0.5)      level = 'CRITICAL';
    else if (pct < 40 || netRate < -0.2) level = 'DEFICIT';
    else if (netRate > 0.3 || pct > 70)  level = 'SURPLUS';
    else                                  level = 'STABLE';

    return { netRate: Math.round(netRate * 100) / 100, trend: Math.round(trend * 100) / 100, pct, level };
}

// ─── Dynamic target calculation ───────────────────────────────────────────────

export interface DynamicTargets {
    harvester: number;
    hauler:    number;
    upgrader:  number;
    builder:   number;
    repairer:  number;
    scout:     number;
}

export function calcDynamicTargets(room: Room): DynamicTargets {
    const rcl      = room.controller?.level ?? 0;
    const sources  = room.find(FIND_SOURCES);
    const sites    = room.find(FIND_CONSTRUCTION_SITES).length;
    const containers = room.find(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_CONTAINER
    }).length;
    const hasControllerContainer = (room.controller?.pos.findInRange(FIND_STRUCTURES, 3, {
        filter: s => s.structureType === STRUCTURE_CONTAINER,
    }).length ?? 0) > 0;

    // Harvesters: up to MAX_HARVESTERS_PER_SOURCE per source, capped by walkable positions
    const harvester = sources.reduce((sum, src) => sum + Math.min(walkableAround(src), MAX_HARVESTERS_PER_SOURCE), 0);

    // Haulers: 1 per source container + 1 for controller container (if it exists)
    const sourceCntrs = sources.reduce((sum, src) =>
        sum + src.pos.findInRange(FIND_STRUCTURES, 1, { filter: s => s.structureType === STRUCTURE_CONTAINER }).length, 0);
    const hauler = sourceCntrs + (hasControllerContainer ? 1 : 0);

    // Builders: scale with pending construction sites
    const builder = sites === 0 ? 0
        : sites <= 5  ? 1
        : sites <= 15 ? 2
        : sites <= 30 ? 3
        : 4;

    // Upgrader: only once there's a controller container to supply it
    const upgrader = hasControllerContainer ? 1 : 0;

    // Repairer: only in DEFEND phase (handled by phase override in spawnManager)
    const repairer = 0;

    // Scout: 1 once RCL 1, so we always have intel
    const scout = rcl >= 1 ? 1 : 0;

    return { harvester, hauler, upgrader, builder, repairer, scout };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function walkableAround(source: Source): number {
    const terrain = source.room.getTerrain();
    let count = 0;
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const x = source.pos.x + dx;
            const y = source.pos.y + dy;
            if (x < 1 || x > 48 || y < 1 || y > 48) continue;
            if (terrain.get(x, y) !== TERRAIN_MASK_WALL) count++;
        }
    }
    return count;
}
