import { CombatState } from '../types';
import { manageTactics } from './tacticsManager';

const MIN_FIGHTERS_TO_MARCH = 4; // warriors + rangers before marching
const MIN_HEALERS_TO_MARCH  = 1; // at least one healer per group before marching
const REASSESS_INTERVAL     = 500;

// Safe mode triggers when hostiles are attacking AND defenses are critically low.
// activateSafeMode() uses one existing charge (no ghodium needed to activate, only to recharge).
const SAFE_MODE_RAMPART_THRESHOLD = 5_000;
const SAFE_MODE_OVERWHELM_COUNT   = 5;

export function manageCombat(room: Room): void {
    checkSafeMode(room);
    manageTowers(room);
    manageCombatState(room);
    manageTactics(); // assigns platoon orders when MARCH begins
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

    if (criticalRampart || overwhelmed) {
        ctrl.activateSafeMode();
        console.log(`[adaptive] ⚠️ SAFE MODE ACTIVATED (hostiles=${dangerousHostiles.length} criticalRampart=${criticalRampart})`);
    }
}

// ─── Tower management ────────────────────────────────────────────────────────
// Attack the enemy with the most ATTACK body parts (biggest threat) when under siege.
// When clear, repair the most-damaged owned structure.

function manageTowers(room: Room): void {
    const towers = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER,
    }) as StructureTower[];

    for (const tower of towers) {
        if (tower.store[RESOURCE_ENERGY] < 10) continue;

        const hostiles = room.find(FIND_HOSTILE_CREEPS);
        if (hostiles.length > 0) {
            // Target the most dangerous creep (most ATTACK/RANGED_ATTACK parts)
            const target = hostiles.reduce((a, b) => threatScore(b) > threatScore(a) ? b : a);
            tower.attack(target);
            continue;
        }

        // No enemies — repair most-damaged owned structure
        const damaged = room.find(FIND_MY_STRUCTURES, {
            filter: s => s.hits < s.hitsMax * 0.9,
        });
        if (damaged.length > 0) {
            const worst = damaged.reduce((a, b) => a.hits < b.hits ? a : b);
            tower.repair(worst);
        }
    }
}

function threatScore(creep: Creep): number {
    return creep.body.reduce((n, p) => {
        if (p.type === ATTACK)         return n + 3;
        if (p.type === RANGED_ATTACK)  return n + 2;
        if (p.type === WORK)           return n + 1; // can dismantle structures
        return n;
    }, 0);
}

// ─── Combat state machine ─────────────────────────────────────────────────────

function manageCombatState(room: Room): void {
    const allCombat = room.find(FIND_MY_CREEPS, {
        filter: c => c.memory.role === 'warrior' || c.memory.role === 'ranger' || c.memory.role === 'healer',
    });
    const fighters = allCombat.filter(c => c.memory.role === 'warrior' || c.memory.role === 'ranger');
    const healers  = allCombat.filter(c => c.memory.role === 'healer');

    const state: CombatState = Memory.combatState ?? 'RALLY';

    switch (state) {
        case 'RALLY':
            // Wait for enough fighters AND at least one healer before marching
            if (fighters.length >= MIN_FIGHTERS_TO_MARCH &&
                healers.length  >= MIN_HEALERS_TO_MARCH  &&
                Memory.enemyRoomName) {
                Memory.combatState = 'MARCH';
                Memory.rallyTick   = Game.time;
                assignTargetRoom(allCombat, Memory.enemyRoomName);
                console.log(`[adaptive] Combat → MARCH (${fighters.length} fighters + ${healers.length} healers → ${Memory.enemyRoomName})`);
            }
            break;

        case 'MARCH': {
            if (fighters.length === 0) { Memory.combatState = 'RALLY'; break; }
            const inEnemyRoom = fighters.filter(c => c.room.name === Memory.enemyRoomName);
            if (inEnemyRoom.length > 0) {
                Memory.combatState = 'ENGAGE';
                console.log('[adaptive] Combat → ENGAGE');
            }
            break;
        }

        case 'ENGAGE':
            if (fighters.length === 0) {
                Memory.combatState = 'RALLY';
                console.log('[adaptive] Combat → RALLY (all fighters lost)');
            }
            if (Memory.rallyTick && Game.time - Memory.rallyTick > REASSESS_INTERVAL) {
                Memory.scoutTick = undefined;
                Memory.rallyTick = Game.time;
            }
            break;
    }
}

function assignTargetRoom(units: Creep[], roomName: string): void {
    for (const u of units) u.memory.targetRoomName = roomName;
}
