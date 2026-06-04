import { GamePhase, CreepRole } from '../types';
import { buildBody } from '../utils/bodyBuilder';
import { bootstrapTargets } from './expansionManager';
import { calcDynamicTargets, EnergyLevel } from './economyManager';

const MIN_COMBAT_ENERGY     = 400;
const WARRIORS_PER_PLATOON  = 3;
const DOWNGRADE_EMERGENCY_THRESHOLD = 4000;
// RC2 has only a 10,000 tick downgrade window — the shortest of any level.
// Fire the emergency check earlier so we have more time to spawn a replacement.
const DOWNGRADE_EMERGENCY_RCL2 = 7000;
// Below this threshold, non-essential roles (upgrader, scout, builder) are skipped.
// Keeps spawn energy available for harvesters and haulers that maintain the economy.
const SPAWN_FLOOR = 200;

// Combat targets per phase — these OVERLAY the dynamic economy targets
const COMBAT_TARGETS: Record<GamePhase, { warrior: number; ranger: number; healer: number; repairer: number }> = {
    ECONOMY: { warrior: 0, ranger: 0, healer: 0, repairer: 0 },
    ASSESS:  { warrior: 4, ranger: 2, healer: 0, repairer: 0 },  // minimum for 1 full quad (2W+2R) during assessment
    RUSH:    { warrior: 8, ranger: 4, healer: 2, repairer: 0 },  // was warrior:6 ranger:2
    DEFEND:  { warrior: 4, ranger: 2, healer: 2, repairer: 2 },
};

export function manageSpawns(room: Room): void {
    const spawns = room.find(FIND_MY_SPAWNS).filter(s => !s.spawning);
    if (spawns.length === 0) return;

    const spawn   = spawns[0];
    const phase   = (room.memory.phase ?? 'ECONOMY') as GamePhase;
    const creeps  = room.find(FIND_MY_CREEPS);
    // Count all creeps homed to this room, including those scouting/mining/fighting in
    // other rooms — room.find only returns creeps physically present, so roaming creeps
    // (scouts, remote miners, defenders) would appear missing and trigger duplicate spawns.
    const allHomeCreeps = Object.values(Game.creeps).filter(c => c.memory.homeRoom === room.name);
    const counts  = countByRole(allHomeCreeps);
    const status  = room.memory.energyStatus ?? { netRate: 0, trend: 0, pct: 50, level: 'STABLE' as EnergyLevel, bottleneck: 'BALANCED' as const };

    // Dynamic economy targets based on actual room state
    const eco = calcDynamicTargets(room);
    const combat = COMBAT_TARGETS[phase];

    // Safe mode: no combat units
    const inSafeMode = (room.controller?.safeMode ?? 0) > 0;

    // ── Bootstrap: zero creeps → always spawn harvester first ────────────────
    // Guards against the emergency-upgrader check firing on a freshly claimed room
    // before any energy infrastructure exists.
    if (allHomeCreeps.length === 0) {
        trySpawn(spawn, 'harvester', room.energyAvailable);
        return;
    }

    // ── Expansion priority ────────────────────────────────────────────────────
    if (Memory.expansionState === 'CLAIMING' && counts.claimer === 0 && Memory.expansionTarget) {
        trySpawn(spawn, 'claimer', room.energyAvailable, { targetRoomName: Memory.expansionTarget });
        return;
    }
    if (Memory.expansionState === 'BOOTSTRAPPING') {
        const bt = bootstrapTargets();
        const expRoom = Memory.expansionRoomName;
        // Bootstrap workers are homed to the expansion room so the new room's spawn
        // manager counts them (prevents over-spawning) and harvesters use mobile mode
        // to deliver energy directly to the new room's spawn.
        if (bt.harvester > 0) { trySpawn(spawn, 'harvester', room.energyAvailable, { homeRoom: expRoom, targetRoomName: expRoom }); return; }
        if (bt.builder   > 0) { trySpawn(spawn, 'builder',   room.energyAvailable, { homeRoom: expRoom, targetRoomName: expRoom }); return; }
        if (bt.hauler    > 0) { trySpawn(spawn, 'hauler',    room.energyAvailable, { homeRoom: expRoom, targetRoomName: expRoom }); return; }
    }

    // ── Emergency: controller downgrade prevention ────────────────────────────
    const ttd = room.controller?.ticksToDowngrade ?? Infinity;
    const rcl = room.controller?.level ?? 0;
    const downgradeThreshold = rcl <= 2 ? DOWNGRADE_EMERGENCY_RCL2 : DOWNGRADE_EMERGENCY_THRESHOLD;
    if (ttd < downgradeThreshold && counts.upgrader === 0) {
        trySpawn(spawn, 'upgrader', room.energyAvailable);
        console.log(`[adaptive] ⚠️ Emergency upgrader — downgrade in ${ttd} ticks`);
        return;
    }

    // ── Always maintain minimum harvesters (2) ────────────────────────────────
    if (counts.harvester < 2) {
        trySpawn(spawn, 'harvester', room.energyAvailable);
        return;
    }

    // ── Local defense: room under active attack → spawn defenders before eco ─
    const localThreat = Memory.roomThreats?.[room.name]?.severity === 'ACTIVE';
    if (localThreat && !inSafeMode && room.energyAvailable >= MIN_COMBAT_ENERGY) {
        if ((counts.repairer ?? 0) < 2) { trySpawn(spawn, 'repairer', room.energyAvailable); return; }
        if ((counts.warrior  ?? 0) < 4) { trySpawn(spawn, 'warrior',  room.energyAvailable, { platoonId: assignWarriorPlatoon(creeps) }); return; }
        if ((counts.ranger   ?? 0) < 2) { trySpawn(spawn, 'ranger',   room.energyAvailable, { platoonId: assignWarriorPlatoon(creeps) }); return; }
        if ((counts.healer   ?? 0) < 1) {
            const pid = assignHealerPlatoon(creeps);
            if (pid) { trySpawn(spawn, 'healer', room.energyAvailable, { platoonId: pid }); return; }
        }
    }

    // ── Economy roles — respect energy level ─────────────────────────────────
    const canSpawnEconomy = status.level !== 'CRITICAL';

    // Roles marked minLevel:'STABLE' are skipped during DEFICIT to prevent the
    // spawn-then-prune death spiral (spawn 200e upgrader → CRITICAL → prune → repeat).
    // Roles marked needsFloor:true are skipped when energyAvailable < SPAWN_FLOOR (200e)
    // so energy sinks never drain the pool needed for essential harvester replacements.
    const LEVEL_ORDER: EnergyLevel[] = ['CRITICAL', 'DEFICIT', 'STABLE', 'SURPLUS'];
    const ecoRoles: { role: CreepRole; target: number; extra?: Partial<CreepMemory>; minLevel?: EnergyLevel; needsFloor?: boolean }[] = [
        { role: 'harvester', target: eco.harvester },
        { role: 'builder',   target: eco.builder,   needsFloor: true },
        { role: 'hauler',    target: eco.hauler     },
        { role: 'upgrader',  target: eco.upgrader,  minLevel: 'STABLE', needsFloor: true },
        { role: 'scout',     target: eco.scout,     minLevel: 'STABLE', needsFloor: true },
        { role: 'scavenger', target: eco.scavenger  },
    ];

    // Proportional hauler budget (Quorum: src/programs/city/mine.js).
    // Size hauler carry capacity to the actual source→storage travel distance rather
    // than always spending max available energy. Prevents over-built haulers in
    // high-RCL rooms and under-built haulers in large rooms.
    // Formula: carryNeeded = distance × 1.3 × 20 (energy generated per round trip)
    // Our 2C+1M unit carries 100e and costs 150e, so budget = ceil(carryNeeded/100) × 150.
    // Capped at room.energyAvailable so we never wait — we build the largest affordable
    // hauler up to the distance-optimal size.
    const haulerBudget = computeLocalHaulerBudget(room);

    if (canSpawnEconomy) {
        for (const { role, target, extra, minLevel, needsFloor } of ecoRoles) {
            if (minLevel && LEVEL_ORDER.indexOf(status.level) < LEVEL_ORDER.indexOf(minLevel)) continue;
            if (needsFloor && room.energyAvailable < SPAWN_FLOOR) continue;
            if ((counts[role] ?? 0) < target) {
                const budget = role === 'hauler' ? haulerBudget : room.energyAvailable;
                trySpawn(spawn, role, budget, extra);
                return;
            }
        }
    }

    // ── Remote mining: reservers + remote miners + remote haulers ─────────────
    if (canSpawnEconomy) {
        for (const [remoteName, rt] of Object.entries(room.memory.remoteRooms ?? {})) {
            // Skip rooms where hostile creeps were spotted recently — sending
            // miners/haulers there wastes spawn energy until it clears.
            const remoteIntel = Memory.roomIntel?.[remoteName];
            const threatened = remoteIntel && remoteIntel.enemyCreeps > 0 &&
                Game.time - remoteIntel.scannedAt < 300;
            if (threatened) continue;
            // Reserver: keep the room reserved (requires 650e — skip at RCL 2)
            const canAffordReserver = room.energyCapacityAvailable >= 650;
            const needsReserver = canAffordReserver && rt.reservedUntil < Game.time + 500;
            const hasReserver = allHomeCreeps.some(c =>
                c.memory.role === 'reserver' && c.memory.targetRoomName === remoteName &&
                (c.ticksToLive ?? 1500) >= PRE_SPAWN_TICKS
            );
            if (needsReserver && !hasReserver) {
                trySpawn(spawn, 'reserver', room.energyAvailable, { targetRoomName: remoteName });
                return;
            }

            // Remote miners (harvesters assigned to remoteRoom)
            const currentMiners = allHomeCreeps.filter(c =>
                c.memory.role === 'harvester' && c.memory.remoteRoom === remoteName &&
                (c.ticksToLive ?? 1500) >= PRE_SPAWN_TICKS
            ).length;
            if (currentMiners < rt.miners) {
                trySpawn(spawn, 'harvester', room.energyAvailable, { remoteRoom: remoteName });
                return;
            }

            // Remote haulers
            const currentHaulers = allHomeCreeps.filter(c =>
                c.memory.role === 'hauler' && c.memory.remoteRoom === remoteName &&
                (c.ticksToLive ?? 1500) >= PRE_SPAWN_TICKS
            ).length;
            if (currentHaulers < rt.haulers) {
                trySpawn(spawn, 'hauler', room.energyAvailable, { remoteRoom: remoteName });
                return;
            }
        }
    }

    // Courier: spawn when a deficit neighbor room needs energy and we have surplus
    if (canSpawnEconomy && (room.memory.energySurplus ?? 0) > 0) {
        const deficitRoom = findDeficitNeighbor(room);
        if (deficitRoom) {
            const existingCouriers = allHomeCreeps.filter(c =>
                c.memory.role === 'courier' && c.memory.courierTarget === deficitRoom &&
                (c.ticksToLive ?? 1500) >= PRE_SPAWN_TICKS
            ).length;
            if (existingCouriers < 2) {
                trySpawn(spawn, 'courier', room.energyAvailable, { courierTarget: deficitRoom });
                return;
            }
        }
    }

    // Repairer (phase-gated)
    if (canSpawnEconomy && (counts.repairer ?? 0) < (combat.repairer ?? 0)) {
        trySpawn(spawn, 'repairer', room.energyAvailable);
        return;
    }

    // ── Combat units: gated on energy surplus AND not in safe mode ────────────
    const canSpawnCombat = !inSafeMode && room.energyAvailable >= MIN_COMBAT_ENERGY &&
        (status.level === 'SURPLUS' || status.level === 'STABLE');

    if (canSpawnCombat) {
        if ((counts.warrior ?? 0) < combat.warrior) {
            const platoonId = assignWarriorPlatoon(creeps);
            trySpawn(spawn, 'warrior', room.energyAvailable, { platoonId });
            return;
        }
        if ((counts.ranger ?? 0) < combat.ranger) {
            const platoonId = assignWarriorPlatoon(creeps);
            trySpawn(spawn, 'ranger', room.energyAvailable, { platoonId });
            return;
        }
        if ((counts.healer ?? 0) < combat.healer) {
            const platoonId = assignHealerPlatoon(creeps);
            if (platoonId) trySpawn(spawn, 'healer', room.energyAvailable, { platoonId });
        }
    }
}

// ─── Prune excess creeps ──────────────────────────────────────────────────────

export function pruneExcessCreeps(room: Room): void {
    const phase    = room.memory.phase ?? 'ECONOMY';
    const creeps   = room.find(FIND_MY_CREEPS);
    const counts   = countByRole(creeps);
    const phaseAge = room.memory.phaseTick ? Game.time - room.memory.phaseTick : 0;
    const status   = room.memory.energyStatus;

    // Suicide combat units after sustained ECONOMY (they're RUSH leftovers)
    const energyLevel = status?.level ?? 'STABLE';
    const urgentCull  = phase === 'ECONOMY' && energyLevel !== 'SURPLUS';
    const timedCull   = phase === 'ECONOMY' && phaseAge > 500;
    if (urgentCull || timedCull) {
        for (const c of creeps) {
            if (c.memory.role === 'warrior' || c.memory.role === 'ranger' || c.memory.role === 'healer') {
                console.log(`[adaptive] Retiring ${c.memory.role} (ECONOMY for ${phaseAge} ticks)`);
                c.suicide();
            }
        }
    }

    // Emergency energy: suicide the largest upgrader only — but only when harvesters
    // are present to actually generate more energy. Without harvesters, killing the
    // upgrader doesn't help and causes a spawn-kill death spiral (200e upgrader spawns,
    // drains to CRITICAL, gets killed, repeat).
    if (status?.level === 'CRITICAL') {
        const harvesters = creeps.filter(c => c.memory.role === 'harvester');
        if (harvesters.length > 0) {
            const expensive = creeps
                .filter(c => c.memory.role === 'upgrader')
                .sort((a, b) => (b.body.length) - (a.body.length));
            if (expensive.length > 0) {
                console.log(`[adaptive] CRITICAL energy — retiring upgrader`);
                expensive[0].suicide();
            }
        }
    }

    // Cull any role more than 2× its dynamic target
    const eco = calcDynamicTargets(room);
    for (const role of Object.keys(eco) as Array<keyof typeof eco>) {
        const target = eco[role];
        if (target === 0) continue;
        const count  = counts[role as CreepRole] ?? 0;
        const excess = count - target * 2;
        if (excess <= 0) continue;

        const toCull = creeps
            .filter(c => c.memory.role === role)
            .sort((a, b) => (a.ticksToLive ?? 1500) - (b.ticksToLive ?? 1500))
            .slice(0, excess);
        for (const c of toCull) {
            console.log(`[adaptive] Culling excess ${role} (${count} > cap ${target * 2})`);
            c.suicide();
        }
    }
}

// ─── Platoon assignment ───────────────────────────────────────────────────────

function assignWarriorPlatoon(creeps: Creep[]): string {
    const platoons = buildPlatoonMap(creeps);
    for (const [id, data] of Object.entries(platoons)) {
        if (data.fighters < WARRIORS_PER_PLATOON) return id;
    }
    return `platoon_${Object.keys(platoons).length}`;
}

function assignHealerPlatoon(creeps: Creep[]): string | undefined {
    const platoons = buildPlatoonMap(creeps);
    for (const [id, data] of Object.entries(platoons)) {
        if (data.fighters >= 2 && !data.hasHealer) return id;
    }
    return undefined;
}

function buildPlatoonMap(creeps: Creep[]): Record<string, { fighters: number; hasHealer: boolean }> {
    const map: Record<string, { fighters: number; hasHealer: boolean }> = {};
    for (const c of creeps) {
        const pid = c.memory.platoonId;
        if (!pid) continue;
        if (!map[pid]) map[pid] = { fighters: 0, hasHealer: false };
        if (c.memory.role === 'warrior' || c.memory.role === 'ranger') map[pid].fighters++;
        if (c.memory.role === 'healer') map[pid].hasHealer = true;
    }
    return map;
}

// Returns the name of an adjacent owned room that needs energy, or null.
function findDeficitNeighbor(room: Room): string | null {
    const exits = Game.map.describeExits(room.name);
    if (!exits) return null;
    const neighbors = Object.values(exits).filter((r): r is string => !!r);

    for (const neighbor of neighbors) {
        const nr = Game.rooms[neighbor];
        if (!nr?.controller?.my) continue;
        const nStorage = nr.storage;
        if (!nStorage) continue;
        if (nStorage.store[RESOURCE_ENERGY] < 10_000) return neighbor;
    }
    return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function trySpawn(
    spawn: StructureSpawn,
    role: CreepRole,
    energy: number,
    extraMemory: Partial<CreepMemory> = {},
): void {
    const hasContainers = spawn.room.find(FIND_STRUCTURES)
        .some(s => s.structureType === STRUCTURE_CONTAINER);
    const body = buildBody(role, energy, { mobile: role === 'harvester' && !hasContainers });
    if (!body) return;

    const name   = `${role}_${Game.time}`;
    const result = spawn.spawnCreep(body, name, {
        memory: { role, working: false, homeRoom: spawn.room.name, ...extraMemory } as CreepMemory,
    });
    if (result === OK) {
        const cost    = body.reduce((s, p) => s + BODYPART_COST[p], 0);
        const platoon = extraMemory.platoonId ? ` [${extraMemory.platoonId}]` : '';
        console.log(`[adaptive] Spawning ${name}${platoon} [${body.join(',')}] (${cost}e)`);
    }
}

// Creeps with fewer than PRE_SPAWN_TICKS remaining are excluded from the count.
// This triggers a replacement spawn BEFORE the old creep dies, so coverage
// is continuous with no gap. Largest bodies (hauler/upgrader ~33 parts) take
// ~100 ticks to spawn, so 100 covers the worst case with a small buffer.
const PRE_SPAWN_TICKS = 100;

function countByRole(creeps: Creep[]): Record<CreepRole, number> {
    const c: Record<string, number> = {};
    for (const creep of creeps) {
        // Treat nearly-dead creeps as already gone for planning purposes
        if ((creep.ticksToLive ?? 1500) < PRE_SPAWN_TICKS) continue;
        c[creep.memory.role] = (c[creep.memory.role] ?? 0) + 1;
    }
    return c as Record<CreepRole, number>;
}

// Compute ideal hauler energy budget from average source→storage path distance.
// Ported from screeps-quorum/mine.js `mineSource` hauler section.
// Each 2C+1M unit (150e) carries 100e; we need enough carry for one full round trip.
// Capped at room.energyAvailable so we never block the spawn queue waiting for energy.
export function computeLocalHaulerBudget(room: Room): number {
    const distances = room.memory.sourceDistances;
    if (!distances) return room.energyAvailable;

    const sources = room.find(FIND_SOURCES);
    if (sources.length === 0) return room.energyAvailable;

    let total = 0, count = 0;
    for (const src of sources) {
        const d = distances[src.id as string];
        if (d) { total += d; count++; }
    }
    if (count === 0) return room.energyAvailable;

    const avgDist     = total / count;
    const multiplier  = 1.3;
    const carryNeeded = avgDist * multiplier * 20; // energy capacity needed per trip
    const units       = Math.max(1, Math.ceil(carryNeeded / 100)); // 100e carry per unit
    const ideal       = Math.min(units * 150, room.energyCapacityAvailable);
    return Math.min(ideal, room.energyAvailable);
}
