import { CombatState } from '../types';
import { manageTactics } from './tacticsManager';
import { manageQuads } from './quadManager';

const MIN_FIGHTERS_TO_MARCH = 4;
const MIN_HEALERS_TO_MARCH  = 1;
const RAID_STRENGTH_MAX     = 15;  // raid without healer if enemy this weak
const REASSESS_INTERVAL     = 500;

const SAFE_MODE_RAMPART_THRESHOLD = 5_000;
const SAFE_MODE_OVERWHELM_COUNT   = 5;

// Decay limit from screeps-quorum/fortify.js: ramparts below this are treated as
// emergencies and repaired before any other structure.
const RAMPART_DECAY_LIMIT   = 30_000;
const FORTIFY_CACHE_TICKS   = 50;

// ─── Tower falloff tables (Quorum: src/programs/city/defense.js) ─────────────
// Pre-computed once per global reset; indexed by tile distance (0–49).
// Avoids repeated floating-point math in the hot tower-targeting path.
const TOWER_DMG_AT: number[] = [];
const TOWER_HEAL_AT: number[] = [];

function initTowerTables(): void {
    if (TOWER_DMG_AT.length > 0) return;
    for (let d = 0; d < 50; d++) {
        TOWER_DMG_AT[d]  = towerEffect(TOWER_POWER_ATTACK, d);
        TOWER_HEAL_AT[d] = towerEffect(TOWER_POWER_HEAL,   d);
    }
}

export function towerEffect(power: number, distance: number): number {
    if (distance <= TOWER_OPTIMAL_RANGE) return power;
    const d = Math.min(distance, TOWER_FALLOFF_RANGE);
    return Math.floor(
        power - power * TOWER_FALLOFF * (d - TOWER_OPTIMAL_RANGE) / (TOWER_FALLOFF_RANGE - TOWER_OPTIMAL_RANGE)
    );
}

// ─── Public entry ─────────────────────────────────────────────────────────────

export function manageCombat(room: Room): void {
    checkSafeMode(room);
    manageTowers(room);
    manageCombatState(room);
    manageTactics(room);
    manageQuads(room);
}

// ─── Safe mode ────────────────────────────────────────────────────────────────

function checkSafeMode(room: Room): void {
    const ctrl = room.controller;
    if (!ctrl || ctrl.safeMode || !ctrl.safeModeAvailable) return;

    const dangerousHostiles = room.find(FIND_HOSTILE_CREEPS).filter(c =>
        c.body.some(p => p.type === ATTACK || p.type === RANGED_ATTACK || p.type === WORK)
    );
    if (dangerousHostiles.length === 0) return;

    const ramparts = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_RAMPART,
    }) as StructureRampart[];
    const criticalRampart = ramparts.length > 0 &&
        Math.min(...ramparts.map(r => r.hits)) < SAFE_MODE_RAMPART_THRESHOLD;
    const overwhelmed = dangerousHostiles.length >= SAFE_MODE_OVERWHELM_COUNT;

    if (!criticalRampart && !overwhelmed) return;

    // Quorum safemode priority guard: if a higher-RCL owned room still has charges,
    // withhold ours — ghodium is scarce and more valuable rooms need protection first.
    const myRcl = ctrl.level ?? 0;
    const betterRoomHasCharges = Object.values(Game.rooms).some(r =>
        r.name !== room.name &&
        r.controller?.my &&
        (r.controller?.level ?? 0) > myRcl &&
        (r.controller?.safeModeAvailable ?? 0) > 0
    );
    if (betterRoomHasCharges) {
        console.log(`[${room.name}] Safemode withheld — higher-RCL room has charges`);
        return;
    }

    ctrl.activateSafeMode();
    console.log(`[${room.name}] SAFE MODE ACTIVATED (hostiles=${dangerousHostiles.length} criticalRampart=${criticalRampart})`);
}

// ─── Tower management ────────────────────────────────────────────────────────

function manageTowers(room: Room): void {
    const towers = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER,
    }) as StructureTower[];
    if (towers.length === 0) return;

    initTowerTables();

    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    if (hostiles.length > 0) {
        // Falloff-aware targeting: pick healer priority, then the target our
        // towers collectively deal the most damage to at their actual distances.
        const target = chooseTowerTarget(towers, hostiles);
        for (const tower of towers) {
            if (tower.store[RESOURCE_ENERGY] < TOWER_ENERGY_COST) continue;
            tower.attack(target);
        }
        return;
    }

    // No hostiles: heal the most-damaged friendly creep.
    // Quorum pattern: accumulate heal from successive towers and break early
    // once remaining damage is covered — prevents wasting energy on a creep
    // that's already fully covered by earlier towers in the list.
    const myCreeps = room.find(FIND_MY_CREEPS);
    const damaged = myCreeps.filter(c => c.hits < c.hitsMax);
    if (damaged.length > 0) {
        const target = damaged.reduce((a, b) => (a.hitsMax - a.hits) > (b.hitsMax - b.hits) ? a : b);
        let remaining = target.hitsMax - target.hits;
        for (const tower of towers) {
            if (remaining <= 0) break;
            if (tower.store[RESOURCE_ENERGY] < TOWER_ENERGY_COST) continue;
            const d = Math.min(tower.pos.getRangeTo(target), 49);
            remaining -= TOWER_HEAL_AT[d];
            tower.heal(target);
        }
        return;
    }

    // Priority 3 (strategy report §Military): repair highest-priority rampart.
    const fortifyTarget = getFortifyTarget(room);
    if (fortifyTarget) {
        for (const tower of towers) {
            if (tower.store[RESOURCE_ENERGY] < TOWER_ENERGY_COST) continue;
            tower.repair(fortifyTarget);
        }
        return;
    }

    // Priority 4: repair damaged roads (< 50% hits) when tower tanks are healthy.
    // Only when energy > 700 — keep reserves high in case hostiles appear next tick.
    const damagedRoad = room.find(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_ROAD && s.hits < s.hitsMax * 0.5,
    })[0] as StructureRoad | undefined;
    if (damagedRoad) {
        for (const tower of towers) {
            if (tower.store[RESOURCE_ENERGY] < 700) continue;
            tower.repair(damagedRoad);
        }
    }
}

// Healer priority — killing regeneration multiplies effective tower DPS.
// Within each pool, pick the target our towers collectively deal most damage to
// (falloff-weighted sum across all towers at their actual distances).
export function chooseTowerTarget(towers: StructureTower[], hostiles: Creep[]): Creep {
    const healers = hostiles.filter(c => c.body.some(p => p.type === HEAL && p.hits > 0));
    const pool = healers.length > 0 ? healers : hostiles;

    let best = pool[0];
    let bestDmg = -1;
    for (const hostile of pool) {
        let totalDmg = 0;
        for (const tower of towers) {
            const d = Math.min(tower.pos.getRangeTo(hostile), 49);
            totalDmg += TOWER_DMG_AT[d];
        }
        if (totalDmg > bestDmg) { bestDmg = totalDmg; best = hostile; }
    }
    return best;
}

// ─── Decay-first rampart repair (Quorum: src/programs/city/fortify.js) ───────
// Priority: decaying (< 30k hits) sorted ascending → then lowest hits overall.
// Result cached for 50 ticks to avoid O(n) find every tick.

export function getFortifyTarget(room: Room): StructureRampart | null {
    const cached = room.memory.fortifyTarget
        ? Game.getObjectById<StructureRampart>(room.memory.fortifyTarget)
        : null;
    if (cached && Game.time - (room.memory.fortifyTargetTick ?? 0) < FORTIFY_CACHE_TICKS) {
        return cached;
    }

    const ramparts = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_RAMPART,
    }) as StructureRampart[];
    if (ramparts.length === 0) return null;

    const decaying = ramparts.filter(r => r.hits <= RAMPART_DECAY_LIMIT);
    const target = decaying.length > 0
        ? decaying.reduce((a, b) => a.hits < b.hits ? a : b)
        : ramparts.reduce((a, b) => a.hits < b.hits ? a : b);

    room.memory.fortifyTarget     = target.id;
    room.memory.fortifyTargetTick = Game.time;
    return target;
}

// ─── Per-room combat state machine ───────────────────────────────────────────

function manageCombatState(room: Room): void {
    // Must use global creep registry — room.find() only sees creeps physically present in
    // the home room, so it returns 0 fighters the moment they march to the enemy room,
    // which would instantly reset combatState to RALLY and create an infinite bounce loop.
    const allCombat = Object.values(Game.creeps).filter(c =>
        (c.memory.role === 'warrior' || c.memory.role === 'ranger' || c.memory.role === 'healer') &&
        c.memory.homeRoom === room.name,
    );
    const fighters = allCombat.filter(c => c.memory.role === 'warrior' || c.memory.role === 'ranger');
    const healers  = allCombat.filter(c => c.memory.role === 'healer');

    const state: CombatState = room.memory.combatState ?? 'RALLY';
    const enemyRoom = room.memory.enemyRoomName;

    switch (state) {
        case 'RALLY': {
            const isRaidTarget = (room.memory.enemyStrength ?? 999) <= RAID_STRENGTH_MAX;
            const healerReady  = healers.length >= MIN_HEALERS_TO_MARCH;
            if (fighters.length >= MIN_FIGHTERS_TO_MARCH && (healerReady || isRaidTarget) && enemyRoom) {
                room.memory.combatState = 'MARCH';
                room.memory.rallyTick   = Game.time;
                assignTargetRoom(allCombat, enemyRoom);
                const mode = healerReady ? `${healers.length}h` : 'RAID';
                console.log(`[${room.name}] Combat → MARCH (${fighters.length}f ${mode} → ${enemyRoom})`);
            }
            break;
        }

        case 'MARCH': {
            if (fighters.length === 0) { room.memory.combatState = 'RALLY'; break; }
            const inEnemyRoom = fighters.filter(c => c.room.name === enemyRoom);
            // Wait until ALL remaining fighters are in the enemy room so the group
            // enters together. "All" is capped at fighters.length so a death en route
            // doesn't permanently stall the march.
            if (inEnemyRoom.length > 0 && inEnemyRoom.length >= fighters.length) {
                room.memory.combatState = 'ENGAGE';
                console.log(`[${room.name}] Combat → ENGAGE`);
            }
            break;
        }

        case 'ENGAGE':
            if (fighters.length === 0) {
                room.memory.combatState = 'RALLY';
                console.log(`[${room.name}] Combat → RALLY (all fighters lost)`);
            }
            if (room.memory.rallyTick && Game.time - room.memory.rallyTick > REASSESS_INTERVAL) {
                room.memory.scoutTick = undefined;
                room.memory.rallyTick = Game.time;
            }
            // Refresh intel from the battlefield every tick while fighters have visibility.
            // remoteManager and spawnManager both gate on Memory.roomIntel[enemyRoom].enemyCreeps;
            // without this, they wait up to 300 ticks for the scout to rescan the cleared room
            // before spawning our reserver/miners/haulers.
            if (enemyRoom) refreshBattlefieldIntel(enemyRoom);
            break;
    }
}

// Write live intel from the enemy room while our fighters are there.
// Only runs when we actually have visibility (fighters are in the room → Game.rooms has it).
// Mirrors recordRoomIntel in scout.ts but does NOT update owned rooms' enemyRoomName —
// that stays as-is so the attack campaign continues until strategyManager clears it.
function refreshBattlefieldIntel(roomName: string): void {
    const target = Game.rooms[roomName];
    if (!target) return; // no visibility yet (fighters still travelling)

    const enemyCreeps  = target.find(FIND_HOSTILE_CREEPS).length;
    const enemySpawns  = target.find(FIND_HOSTILE_STRUCTURES, { filter: s => s.structureType === STRUCTURE_SPAWN }).length;
    const enemyTowers  = target.find(FIND_HOSTILE_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER }).length;
    const strength     = enemyCreeps + enemySpawns * 5 + enemyTowers * 8;

    if (!Memory.roomIntel) Memory.roomIntel = {};
    const prev = Memory.roomIntel[roomName];
    Memory.roomIntel[roomName] = {
        scannedAt:       Game.time,
        enemyCreeps,
        enemySpawns,
        enemyTowers,
        strength,
        hasController:   !!(target.controller),
        controllerOwned: !!(target.controller?.owner),
        sourceCount:     prev?.sourceCount ?? target.find(FIND_SOURCES).length,
    };
}

function assignTargetRoom(units: Creep[], roomName: string): void {
    for (const u of units) u.memory.targetRoomName = roomName;
}
