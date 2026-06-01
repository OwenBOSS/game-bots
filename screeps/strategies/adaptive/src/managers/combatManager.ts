import { CombatState } from '../types';
import { manageTactics } from './tacticsManager';

const MIN_FIGHTERS_TO_MARCH = 4;
const MIN_HEALERS_TO_MARCH  = 1;
const REASSESS_INTERVAL     = 500;

const SAFE_MODE_RAMPART_THRESHOLD = 5_000;
const SAFE_MODE_OVERWHELM_COUNT   = 5;

export function manageCombat(room: Room): void {
    checkSafeMode(room);
    manageTowers(room);
    manageCombatState(room);
    manageTactics(room);
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
        console.log(`[${room.name}] ⚠️ SAFE MODE ACTIVATED (hostiles=${dangerousHostiles.length} criticalRampart=${criticalRampart})`);
    }
}

// ─── Tower management ────────────────────────────────────────────────────────

function manageTowers(room: Room): void {
    const towers = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER,
    }) as StructureTower[];

    for (const tower of towers) {
        if (tower.store[RESOURCE_ENERGY] < 10) continue;

        const hostiles = room.find(FIND_HOSTILE_CREEPS);
        if (hostiles.length > 0) {
            const target = hostiles.reduce((a, b) => threatScore(b) > threatScore(a) ? b : a);
            tower.attack(target);
            continue;
        }

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
        if (p.type === WORK)           return n + 1;
        return n;
    }, 0);
}

// ─── Per-room combat state machine ───────────────────────────────────────────
// Only considers creeps whose homeRoom matches this room, so multiple rooms
// can run independent RALLY/MARCH/ENGAGE campaigns simultaneously.

function manageCombatState(room: Room): void {
    const allCombat = room.find(FIND_MY_CREEPS, {
        filter: c => (c.memory.role === 'warrior' || c.memory.role === 'ranger' || c.memory.role === 'healer') &&
            c.memory.homeRoom === room.name,
    });
    const fighters = allCombat.filter(c => c.memory.role === 'warrior' || c.memory.role === 'ranger');
    const healers  = allCombat.filter(c => c.memory.role === 'healer');

    const state: CombatState = room.memory.combatState ?? 'RALLY';
    const enemyRoom = room.memory.enemyRoomName;

    switch (state) {
        case 'RALLY':
            if (fighters.length >= MIN_FIGHTERS_TO_MARCH &&
                healers.length  >= MIN_HEALERS_TO_MARCH  &&
                enemyRoom) {
                room.memory.combatState = 'MARCH';
                room.memory.rallyTick   = Game.time;
                assignTargetRoom(allCombat, enemyRoom);
                console.log(`[${room.name}] Combat → MARCH (${fighters.length}f + ${healers.length}h → ${enemyRoom})`);
            }
            break;

        case 'MARCH': {
            if (fighters.length === 0) { room.memory.combatState = 'RALLY'; break; }
            const inEnemyRoom = fighters.filter(c => c.room.name === enemyRoom);
            if (inEnemyRoom.length > 0) {
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
            break;
    }
}

function assignTargetRoom(units: Creep[], roomName: string): void {
    for (const u of units) u.memory.targetRoomName = roomName;
}
