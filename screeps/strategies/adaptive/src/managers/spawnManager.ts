import { GamePhase, CreepRole } from '../types';
import { buildBody } from '../utils/bodyBuilder';
import { bootstrapTargets } from './expansionManager';
import { calcDynamicTargets, EnergyLevel } from './economyManager';

const MIN_COMBAT_ENERGY     = 400;
const WARRIORS_PER_PLATOON  = 3;
const DOWNGRADE_EMERGENCY_THRESHOLD = 4000;

// Combat targets per phase — these OVERLAY the dynamic economy targets
const COMBAT_TARGETS: Record<GamePhase, { warrior: number; ranger: number; healer: number; repairer: number }> = {
    ECONOMY: { warrior: 0, ranger: 0, healer: 0, repairer: 0 },
    ASSESS:  { warrior: 0, ranger: 0, healer: 0, repairer: 0 },
    RUSH:    { warrior: 6, ranger: 2, healer: 2, repairer: 0 },
    DEFEND:  { warrior: 4, ranger: 2, healer: 2, repairer: 2 },
};

export function manageSpawns(room: Room): void {
    const spawns = room.find(FIND_MY_SPAWNS).filter(s => !s.spawning);
    if (spawns.length === 0) return;

    const spawn   = spawns[0];
    const phase   = Memory.phase ?? 'ECONOMY';
    const creeps  = room.find(FIND_MY_CREEPS);
    const counts  = countByRole(creeps);
    const status  = Memory.energyStatus ?? { netRate: 0, trend: 0, pct: 50, level: 'STABLE' as EnergyLevel };

    // Dynamic economy targets based on actual room state
    const eco = calcDynamicTargets(room);
    const combat = COMBAT_TARGETS[phase];

    // Safe mode: no combat units
    const inSafeMode = (room.controller?.safeMode ?? 0) > 0;

    // ── Expansion priority ────────────────────────────────────────────────────
    if (Memory.expansionState === 'CLAIMING' && counts.claimer === 0 && Memory.expansionTarget) {
        trySpawn(spawn, 'claimer', room.energyAvailable, { targetRoomName: Memory.expansionTarget });
        return;
    }
    if (Memory.expansionState === 'BOOTSTRAPPING') {
        const bt = bootstrapTargets();
        if (bt.builder > 0) { trySpawn(spawn, 'builder', room.energyAvailable, { targetRoomName: Memory.expansionRoomName }); return; }
        if (bt.hauler  > 0) { trySpawn(spawn, 'hauler',  room.energyAvailable, { targetRoomName: Memory.expansionRoomName }); return; }
    }

    // ── Emergency: controller downgrade prevention ────────────────────────────
    const ttd = room.controller?.ticksToDowngrade ?? Infinity;
    if (ttd < DOWNGRADE_EMERGENCY_THRESHOLD && counts.upgrader === 0) {
        trySpawn(spawn, 'upgrader', room.energyAvailable);
        console.log(`[adaptive] ⚠️ Emergency upgrader — downgrade in ${ttd} ticks`);
        return;
    }

    // ── Always maintain minimum harvesters (2) ────────────────────────────────
    if (counts.harvester < 2) {
        trySpawn(spawn, 'harvester', room.energyAvailable);
        return;
    }

    // ── Economy roles — respect energy level ─────────────────────────────────
    // In DEFICIT/CRITICAL don't spawn new haulers/upgraders (save energy for harvesters)
    const canSpawnEconomy = status.level !== 'CRITICAL';

    const ecoRoles: { role: CreepRole; target: number }[] = [
        { role: 'harvester', target: eco.harvester },
        { role: 'builder',   target: eco.builder   },
        { role: 'hauler',    target: eco.hauler     },
        { role: 'upgrader',  target: eco.upgrader   },
        { role: 'scout',     target: eco.scout      },
    ];

    if (canSpawnEconomy) {
        for (const { role, target } of ecoRoles) {
            if ((counts[role] ?? 0) < target) {
                trySpawn(spawn, role, room.energyAvailable);
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
    const phase    = Memory.phase ?? 'ECONOMY';
    const creeps   = room.find(FIND_MY_CREEPS);
    const counts   = countByRole(creeps);
    const phaseAge = Memory.phaseTick ? Game.time - Memory.phaseTick : 0;
    const status   = Memory.energyStatus;

    // Suicide combat units after sustained ECONOMY (they're RUSH leftovers)
    if (phase === 'ECONOMY' && phaseAge > 500) {
        for (const c of creeps) {
            if (c.memory.role === 'warrior' || c.memory.role === 'ranger' || c.memory.role === 'healer') {
                console.log(`[adaptive] Retiring ${c.memory.role} (ECONOMY for ${phaseAge} ticks)`);
                c.suicide();
            }
        }
    }

    // Emergency energy: suicide most-expensive non-essential creeps
    if (status?.level === 'CRITICAL') {
        const expensive = creeps
            .filter(c => c.memory.role === 'upgrader' || c.memory.role === 'scout')
            .sort((a, b) => (b.body.length) - (a.body.length));
        if (expensive.length > 0) {
            console.log(`[adaptive] CRITICAL energy — retiring ${expensive[0].memory.role}`);
            expensive[0].suicide();
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function trySpawn(
    spawn: StructureSpawn,
    role: CreepRole,
    energy: number,
    extraMemory: Partial<CreepMemory> = {},
): void {
    const body = buildBody(role, energy);
    if (!body) return;

    const name   = `${role}_${Game.time}`;
    const result = spawn.spawnCreep(body, name, {
        memory: { role, working: false, ...extraMemory } as CreepMemory,
    });
    if (result === OK) {
        const cost    = body.reduce((s, p) => s + BODYPART_COST[p], 0);
        const platoon = extraMemory.platoonId ? ` [${extraMemory.platoonId}]` : '';
        console.log(`[adaptive] Spawning ${name}${platoon} [${body.join(',')}] (${cost}e)`);
    }
}

// Creeps with fewer than PRE_SPAWN_TICKS remaining are excluded from the count.
// This triggers a replacement spawn BEFORE the old creep dies, so coverage
// is continuous with no gap. Threshold covers max spawn time + safety buffer.
const PRE_SPAWN_TICKS = 60; // body × 3 ticks per part + ~20 tick buffer

function countByRole(creeps: Creep[]): Record<CreepRole, number> {
    const c: Record<string, number> = {};
    for (const creep of creeps) {
        // Treat nearly-dead creeps as already gone for planning purposes
        if ((creep.ticksToLive ?? 1500) < PRE_SPAWN_TICKS) continue;
        c[creep.memory.role] = (c[creep.memory.role] ?? 0) + 1;
    }
    return c as Record<CreepRole, number>;
}
