// Tracks energy flow and calculates dynamic spawn targets based on actual room state.
// Sampled every SAMPLE_INTERVAL ticks; keeps WINDOW_SIZE samples (= WINDOW_TICKS history).
//
// Each sample captures three dimensions:
//   avail            — spawn/extension energy (what the spawn system sees)
//   containerFillPct — how full containers are (buffer between harvest and delivery)
//   sourceDepletedPct— how often sources are at 0 (ceiling on extraction rate)
//
// From these, one bottleneck is identified per update cycle and stored in energyStatus.
// calcDynamicTargets reads that bottleneck to shift spawn targets toward the constraint.
//
// Theory-of-constraints priority:
//   SOURCE_MAXED        → extraction ceiling hit; expansion is the only fix
//   HARVESTER_SHORTAGE  → containers emptying; add harvesters until containers refill
//   HAULER_SHORTAGE     → containers filling up but spawn energy low; add haulers
//   BALANCED            → no constraint; use baseline targets

const SAMPLE_INTERVAL = 5;   // sample every N ticks
const WINDOW_SIZE     = 20;  // samples kept (= WINDOW_SIZE × SAMPLE_INTERVAL ticks)
const MAX_HARVESTERS_PER_SOURCE = 4;

export type EnergyLevel = 'SURPLUS' | 'STABLE' | 'DEFICIT' | 'CRITICAL';
export type Bottleneck  = 'HARVESTER_SHORTAGE' | 'HAULER_SHORTAGE' | 'SOURCE_MAXED' | 'BALANCED';

export interface EnergyStatus {
    netRate:    number;     // e/tick net (positive = growing)
    trend:      number;     // change in rate (positive = accelerating)
    pct:        number;     // current avail/cap %
    level:      EnergyLevel;
    bottleneck: Bottleneck;
}

// ─── Sampling ─────────────────────────────────────────────────────────────────

export function trackEnergyFlow(room: Room): void {
    if (Game.time % SAMPLE_INTERVAL !== 0) return;

    if (!room.memory.energyHistory) room.memory.energyHistory = [];
    room.memory.energyHistory.push({
        tick:              Game.time,
        avail:             room.energyAvailable,
        containerFillPct:  sampleContainerFillPct(room),
        sourceDepletedPct: sampleSourceDepletedPct(room),
    });
    if (room.memory.energyHistory.length > WINDOW_SIZE) {
        room.memory.energyHistory = room.memory.energyHistory.slice(-WINDOW_SIZE);
    }

    const status = computeStatus(room);
    status.bottleneck = detectBottleneck(status, room);
    room.memory.energyStatus = status;
}

function sampleContainerFillPct(room: Room): number {
    const containers = room.find(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_CONTAINER,
    }) as StructureContainer[];
    if (containers.length === 0) return 50; // neutral before containers are built
    const total = containers.reduce((s, c) => {
        const cap = c.store.getCapacity(RESOURCE_ENERGY);
        return s + (cap > 0 ? c.store[RESOURCE_ENERGY] / cap : 0);
    }, 0);
    return Math.round(total / containers.length * 100);
}

function sampleSourceDepletedPct(room: Room): number {
    const sources = room.find(FIND_SOURCES);
    if (sources.length === 0) return 0;
    const depleted = sources.filter(s => s.energy === 0).length;
    return Math.round(depleted / sources.length * 100);
}

function computeStatus(room: Room): EnergyStatus {
    const h   = room.memory.energyHistory ?? [];
    const cap = room.energyCapacityAvailable || 1;
    const pct = Math.round(room.energyAvailable / cap * 100);

    if (h.length < 4) {
        return { netRate: 0, trend: 0, pct, level: 'STABLE', bottleneck: 'BALANCED' };
    }

    const first = h[0];
    const last  = h[h.length - 1];
    const dt    = last.tick - first.tick;
    const netRate = dt > 0 ? (last.avail - first.avail) / dt : 0;

    const mid    = h[Math.floor(h.length / 2)];
    const rate1  = (mid.avail  - first.avail) / Math.max(mid.tick  - first.tick, 1);
    const rate2  = (last.avail - mid.avail)   / Math.max(last.tick - mid.tick,   1);
    const trend  = rate2 - rate1;

    let level: EnergyLevel;
    if (pct < 20 && netRate < -0.5)      level = 'CRITICAL';
    else if (pct < 40 || netRate < -0.2) level = 'DEFICIT';
    else if (netRate > 0.3 || pct > 70)  level = 'SURPLUS';
    else                                  level = 'STABLE';

    return {
        netRate:    Math.round(netRate * 100) / 100,
        trend:      Math.round(trend  * 100) / 100,
        pct,
        level,
        bottleneck: 'BALANCED', // overwritten by detectBottleneck after this returns
    };
}

// ─── Bottleneck detection ─────────────────────────────────────────────────────

function detectBottleneck(status: EnergyStatus, room: Room): Bottleneck {
    const h = (room.memory.energyHistory ?? []).slice(-8);
    if (h.length < 4) return 'BALANCED';

    const avgCont = avgField(h, 'containerFillPct',  50);
    const avgSrc  = avgField(h, 'sourceDepletedPct',  0);

    // Sources at 0 more than 60% of samples → we've hit extraction ceiling
    if (avgSrc > 60) return 'SOURCE_MAXED';

    // Containers chronically low AND energy declining → not enough harvesters
    if (avgCont < 25 && (status.level === 'DEFICIT' || status.level === 'CRITICAL')) {
        return 'HARVESTER_SHORTAGE';
    }

    // Containers backing up but spawn energy low → haulers can't drain fast enough
    if (avgCont > 70 && status.pct < 50) return 'HAULER_SHORTAGE';

    return 'BALANCED';
}

// ─── Dynamic target calculation ───────────────────────────────────────────────

export interface DynamicTargets {
    harvester: number;
    hauler:    number;
    upgrader:  number;
    builder:   number;
    repairer:  number;
    scout:     number;
    scavenger: number;
}

export function calcDynamicTargets(room: Room): DynamicTargets {
    const rcl      = room.controller?.level ?? 0;
    const sources  = room.find(FIND_SOURCES);
    const sites    = room.find(FIND_CONSTRUCTION_SITES).length;
    const containers = room.find(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_CONTAINER,
    }).length;
    const hasControllerContainer = (room.controller?.pos.findInRange(FIND_STRUCTURES, 3, {
        filter: s => s.structureType === STRUCTURE_CONTAINER,
    }).length ?? 0) > 0;

    const bottleneck       = room.memory.energyStatus?.bottleneck ?? 'BALANCED';
    const h                = (room.memory.energyHistory ?? []).slice(-8);
    const avgContainerFill = avgField(h, 'containerFillPct', 50);

    // ── Harvesters ────────────────────────────────────────────────────────────
    // SOURCE_MAXED: sources can't keep up → 1 per source keeps steady state
    // Default: max positions (up to 4) per source — more bodies = more WORK throughput
    const harvester = bottleneck === 'SOURCE_MAXED'
        ? sources.length
        : sources.reduce((sum, src) => sum + Math.min(walkableAround(src), MAX_HARVESTERS_PER_SOURCE), 0);

    // ── Haulers ───────────────────────────────────────────────────────────────
    // HAULER_SHORTAGE: double source haulers to drain the backlog
    const sourceCntrs = sources.reduce((sum, src) =>
        sum + src.pos.findInRange(FIND_STRUCTURES, 1, { filter: s => s.structureType === STRUCTURE_CONTAINER }).length, 0);
    const baseHaulers = sourceCntrs + (hasControllerContainer ? 1 : 0);
    const hauler = bottleneck === 'HAULER_SHORTAGE'
        ? baseHaulers + sourceCntrs  // +1 hauler per backed-up source container
        : baseHaulers;

    // ── Builders ──────────────────────────────────────────────────────────────
    // Gate builder count on container fill: spawning idle builders wastes capacity.
    // sourceCntrs === 0 is the right bootstrap signal — no source has a container yet,
    // so no supply chain exists. Allow 1 builder to build those first containers.
    // Once any source container exists, scale with sites but throttle if fill is low.
    let builder: number;
    if (sites === 0) {
        builder = 0;
    } else if (sourceCntrs === 0) {
        builder = 1; // bootstrap: at least 1 builder until the supply chain exists
    } else {
        const baseBuilders = sites <= 5 ? 1 : sites <= 15 ? 2 : sites <= 30 ? 3 : 4;
        // Containers below 25% → builders will idle; cap to 1 until supply recovers
        builder = avgContainerFill < 25 ? Math.max(1, Math.ceil(baseBuilders / 2)) : baseBuilders;
    }

    // ── Upgrader ──────────────────────────────────────────────────────────────
    const upgrader = hasControllerContainer ? 1 : 0;

    const repairer  = 0; // phase override in spawnManager handles DEFEND
    const scout     = rcl >= 1 ? 1 : 0;
    // 1 scavenger once containers exist (supply chain is up, loot prevention matters)
    const scavenger = containers > 0 ? 1 : 0;

    return { harvester, hauler, upgrader, builder, repairer, scout, scavenger };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avgField(
    samples: Array<Record<string, number | undefined>>,
    field: string,
    fallback: number,
): number {
    if (samples.length === 0) return fallback;
    return samples.reduce((s, x) => s + (x[field] ?? fallback), 0) / samples.length;
}

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
