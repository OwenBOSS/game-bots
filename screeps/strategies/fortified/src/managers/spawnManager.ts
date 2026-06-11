// Body tiers per role, ordered most-preferred first.
// Harvester has NO MOVE parts (stationary) and exactly ONE CARRY (tow requirement).
export const BOOTSTRAP_BODIES: BodyPartConstant[][] = [
    [MOVE, WORK, CARRY],
];

export const HARVESTER_BODIES: BodyPartConstant[][] = [
    [WORK, WORK, WORK, WORK, WORK, CARRY],  // 550e
    [WORK, WORK, WORK, CARRY],               // 350e
    [WORK, CARRY],                           // 150e
];

export const HAULER_BODIES: BodyPartConstant[][] = [
    [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE],  // 400e
    [CARRY, CARRY, MOVE, MOVE],                             // 200e
    [CARRY, MOVE],                                          // 100e
];

export const UPGRADER_BODIES: BodyPartConstant[][] = [
    [WORK, WORK, CARRY, MOVE],  // 350e
    [WORK, CARRY, MOVE],        // 200e
];

export function manageSpawns(room: Room): void {
    const spawns = room.find(FIND_MY_SPAWNS).filter((s: StructureSpawn) => !s.spawning);
    if (spawns.length === 0) return;

    const spawn = spawns[0];
    const rcl = room.controller?.level ?? 1;
    const allCreeps = Object.values(Game.creeps).filter(
        (c: Creep) => c.memory.homeRoom === room.name,
    );
    const counts = countByRole(allCreeps);

    // ── Phase 1 (RC1): bootstrap creeps + 1 upgrader to rush RC2 ──────────────
    if (rcl < 2) {
        if ((counts.bootstrap ?? 0) < 2) {
            trySpawn(spawn, 'bootstrap', room.energyAvailable, BOOTSTRAP_BODIES);
            return;
        }
        if ((counts.upgrader ?? 0) < 1) {
            trySpawn(spawn, 'upgrader', room.energyAvailable, UPGRADER_BODIES);
        }
        return;
    }

    // ── Phase 2+ (RC ≥ 2): stationary harvesters + paired haulers ─────────────

    // Always keep at least 1 bootstrap alive for construction tasks.
    if ((counts.bootstrap ?? 0) < 1) {
        trySpawn(spawn, 'bootstrap', room.energyAvailable, BOOTSTRAP_BODIES);
        return;
    }

    const sources = room.find(FIND_SOURCES);
    const targetHarvesters = sources.length;

    if ((counts.harvester ?? 0) < targetHarvesters) {
        // Assign the source with fewest harvesters.
        const sourceId = leastLoadedSource(sources, allCreeps);
        trySpawn(spawn, 'harvester', room.energyAvailable, HARVESTER_BODIES, { sourceId });
        return;
    }

    // One hauler per harvester.
    if ((counts.hauler ?? 0) < (counts.harvester ?? 0)) {
        const orphan = findHarvesterWithoutHauler(allCreeps);
        trySpawn(spawn, 'hauler', room.energyAvailable, HAULER_BODIES, {
            towTarget: orphan?.name,
        });
        return;
    }

    if ((counts.upgrader ?? 0) < 2) {
        trySpawn(spawn, 'upgrader', room.energyAvailable, UPGRADER_BODIES);
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function countByRole(creeps: Creep[]): Partial<Record<FortifiedRole, number>> {
    const counts: Partial<Record<FortifiedRole, number>> = {};
    for (const c of creeps) {
        const r = c.memory.role;
        counts[r] = (counts[r] ?? 0) + 1;
    }
    return counts;
}

function leastLoadedSource(sources: Source[], creeps: Creep[]): Id<Source> | undefined {
    const load = new Map<Id<Source>, number>(sources.map(s => [s.id, 0]));
    for (const c of creeps) {
        if (c.memory.role === 'harvester' && c.memory.sourceId) {
            load.set(c.memory.sourceId, (load.get(c.memory.sourceId) ?? 0) + 1);
        }
    }
    let best: Source | undefined;
    let bestLoad = Infinity;
    for (const s of sources) {
        const l = load.get(s.id) ?? 0;
        if (l < bestLoad) { bestLoad = l; best = s; }
    }
    return best?.id;
}

function findHarvesterWithoutHauler(creeps: Creep[]): Creep | undefined {
    const towTargets = new Set(
        creeps
            .filter(c => c.memory.role === 'hauler' && c.memory.towTarget)
            .map(c => c.memory.towTarget as string),
    );
    return creeps.find(
        c => c.memory.role === 'harvester' && !towTargets.has(c.name),
    );
}

function trySpawn(
    spawn: StructureSpawn,
    role: FortifiedRole,
    energy: number,
    bodies: BodyPartConstant[][],
    extraMemory: Partial<CreepMemory> = {},
): boolean {
    const body = selectBody(bodies, energy);
    if (!body) return false;
    const name = `${role}_${Game.time}`;
    const result = spawn.spawnCreep(body, name, {
        memory: { role, homeRoom: spawn.room.name, ...extraMemory } as CreepMemory,
    });
    return result === OK;
}

function selectBody(
    tiers: BodyPartConstant[][],
    energy: number,
): BodyPartConstant[] | null {
    for (const body of tiers) {
        const cost = body.reduce((s, p) => s + BODYPART_COST[p], 0);
        if (energy >= cost) return body;
    }
    return null;
}
