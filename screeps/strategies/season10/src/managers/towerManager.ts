// Tower logic — runs every tick for each tower in an owned room.
// Priority (per RC strategy Part 5):
//   0. Activate safe mode if under attack with no viable defense
//   1. Attack most dangerous hostile creep
//   2. Heal any allied creep below 80% hits
//   3. Repair any rampart below 100,000 hits
//   4. Repair containers below 50% hits (prevents decay)
//   5. Repair any road below 50% hits (only if tower energy > 700)

import { findCached } from '../utils/tickCache';

const HEAL_THRESHOLD    = 0.8;
const RAMPART_MIN_HITS  = 100_000;
const ROAD_ENERGY_MIN   = 700;

// Body parts that can deal damage or destroy structures
const DANGEROUS_PARTS = new Set<BodyPartConstant>([ATTACK, RANGED_ATTACK, WORK]);

function getDps(creep: Creep): number {
    let dps = 0;
    for (const part of creep.body) {
        if (part.type === ATTACK)        dps += 30;
        if (part.type === RANGED_ATTACK) dps += 10;
        if (part.type === WORK)          dps += 2; // dismantling
    }
    return dps;
}

function tryActivateSafeMode(room: Room, hostiles: Creep[]): void {
    const ctrl = room.controller;
    if (!ctrl || !ctrl.my) return;
    if (ctrl.safeMode || ctrl.safeModeCooldown) return;
    if ((ctrl.safeModeAvailable ?? 0) <= 0) return;

    // Only trigger for hostiles that can actually destroy things
    const armed = hostiles.filter(h => h.body.some(p => DANGEROUS_PARTS.has(p.type)));
    if (armed.length === 0) return;

    const hasTower = findCached<AnyStructure>(room, FIND_MY_STRUCTURES)
        .some((s: AnyStructure) => s.structureType === STRUCTURE_TOWER);

    // Trigger if: no tower yet, OR spawn is below half health
    let trigger = !hasTower;
    if (!trigger) {
        const spawn = findCached<StructureSpawn>(room, FIND_MY_SPAWNS)[0];
        if (spawn && spawn.hits < spawn.hitsMax * 0.5) trigger = true;
    }

    if (trigger) {
        ctrl.activateSafeMode();
        console.log(`[season10] SAFE MODE activated in ${room.name} — ${armed.length} armed hostiles`);
    }
}

export function manageTowers(room: Room): void {
    const towers = findCached<AnyStructure>(room, FIND_MY_STRUCTURES).filter(
        (s: AnyStructure) => s.structureType === STRUCTURE_TOWER
    ) as StructureTower[];

    const hostiles = findCached<Creep>(room, FIND_HOSTILE_CREEPS);
    const allies   = findCached<Creep>(room, FIND_MY_CREEPS);
    const structs  = findCached<AnyStructure>(room, FIND_STRUCTURES);

    // Priority 0: safe mode check runs even when there are no towers
    if (hostiles.length > 0) tryActivateSafeMode(room, hostiles);

    if (towers.length === 0) return;

    // Pick the most dangerous target once, reused by all towers this tick
    const target = hostiles.length > 0
        ? hostiles.reduce((best, h) => getDps(h) > getDps(best) ? h : best)
        : null;

    for (const tower of towers) {
        // Priority 1: attack most dangerous hostile
        if (target) {
            tower.attack(target as Creep);
            continue;
        }

        // Priority 2: heal damaged allies
        const wounded = allies.find(c => c.hits / c.hitsMax < HEAL_THRESHOLD);
        if (wounded) {
            tower.heal(wounded);
            continue;
        }

        // Priority 3: repair low-hit ramparts
        const lowRampart = structs.find(
            s => s.structureType === STRUCTURE_RAMPART && s.hits < RAMPART_MIN_HITS
        );
        if (lowRampart) {
            tower.repair(lowRampart);
            continue;
        }

        // Priority 4: repair containers below 50% — they decay at 500 hits/tick without repair
        const lowContainer = structs.find(
            s => s.structureType === STRUCTURE_CONTAINER && s.hits < s.hitsMax * 0.5
        );
        if (lowContainer) {
            tower.repair(lowContainer);
            continue;
        }

        // Priority 5: repair degraded roads (only when energy plentiful)
        if (tower.store[RESOURCE_ENERGY] > ROAD_ENERGY_MIN) {
            const degradedRoad = structs.find(
                s => s.structureType === STRUCTURE_ROAD && s.hits / s.hitsMax < 0.5
            );
            if (degradedRoad) {
                tower.repair(degradedRoad);
            }
        }
    }
}
