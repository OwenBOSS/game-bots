import { GamePhase } from '../types';

const ECONOMY_CREEP_TARGET    = 5;
const RUSH_STRENGTH_THRESHOLD = 10;
const REASSESS_COOLDOWN       = 500;
const RUSH_TIMEOUT            = 2000;
const SAFE_MODE_PREPARE_TICKS = 2000;

export function updatePhase(room: Room): void {
    // ── Safe mode override ────────────────────────────────────────────────────
    const safeMode = room.controller?.safeMode ?? 0;
    if (safeMode > 0) {
        if (room.memory.phase !== 'ECONOMY') {
            room.memory.phase = 'ECONOMY';
            console.log(`[${room.name}] Safe mode active (${safeMode}t left) → forcing ECONOMY`);
        }
        if (safeMode < SAFE_MODE_PREPARE_TICKS && room.memory.phase === 'ECONOMY') {
            room.memory.phase     = 'ASSESS';
            room.memory.scoutTick = undefined;
            console.log(`[${room.name}] Safe mode expiring → ASSESS`);
        }
        return;
    }

    // ── Normal phase machine ─────────────────────────────────────────────────
    const phase: GamePhase = room.memory.phase ?? 'ECONOMY';
    if (!Memory.roomIntel) Memory.roomIntel = {};

    const myCreeps = room.find(FIND_MY_CREEPS).length;

    switch (phase) {
        case 'ECONOMY': {
            const cooldownDone = !room.memory.phaseTick || Game.time >= room.memory.phaseTick;
            if (myCreeps >= ECONOMY_CREEP_TARGET && cooldownDone) {
                room.memory.phase     = 'ASSESS';
                room.memory.phaseTick = Game.time;
                room.memory.scoutTick = undefined;
                console.log(`[${room.name}] → ASSESS at tick ${Game.time}`);
            }
            break;
        }

        case 'ASSESS':
            if (room.memory.scoutTick !== undefined) {
                const target   = room.memory.enemyRoomName;
                const strength = room.memory.enemyStrength;
                if (target && strength !== undefined && strength > 0) {
                    room.memory.phase     = strength <= RUSH_STRENGTH_THRESHOLD ? 'RUSH' : 'DEFEND';
                    room.memory.phaseTick = Game.time;
                    console.log(`[${room.name}] → ${room.memory.phase} (enemy strength ${strength} in ${target})`);
                } else {
                    room.memory.phase     = 'ECONOMY';
                    room.memory.phaseTick = Game.time + REASSESS_COOLDOWN;
                    console.log(`[${room.name}] → ECONOMY (no enemies, re-assess at tick ${room.memory.phaseTick})`);
                }
            }
            break;

        case 'RUSH': {
            const combatUnits = room.find(FIND_MY_CREEPS, {
                filter: c => (c.memory.role === 'warrior' || c.memory.role === 'ranger') &&
                    c.memory.homeRoom === room.name,
            }).length;

            const enemyIntel = room.memory.enemyRoomName ? Memory.roomIntel[room.memory.enemyRoomName] : undefined;
            if (enemyIntel && enemyIntel.strength === 0 && Game.time - enemyIntel.scannedAt < 100) {
                console.log(`[${room.name}] → ECONOMY (RUSH succeeded — ${room.memory.enemyRoomName} cleared)`);
                resetToEconomy(room);
                break;
            }
            if (combatUnits === 0 && myCreeps > 0) {
                console.log(`[${room.name}] → ECONOMY (RUSH failed — no combat units left)`);
                resetToEconomy(room);
                break;
            }
            if (myCreeps === 0) { resetToEconomy(room); break; }
            if (room.memory.phaseTick && Game.time - room.memory.phaseTick > RUSH_TIMEOUT) {
                console.log(`[${room.name}] → ECONOMY (RUSH timed out)`);
                resetToEconomy(room);
            }
            break;
        }

        case 'DEFEND': {
            const enemies     = room.find(FIND_HOSTILE_CREEPS).length;
            const enemyIntel  = room.memory.enemyRoomName ? Memory.roomIntel[room.memory.enemyRoomName] : undefined;
            const threatCleared = enemyIntel && enemyIntel.strength === 0 && Game.time - enemyIntel.scannedAt < 100;
            if (enemies === 0 && threatCleared) {
                console.log(`[${room.name}] → ECONOMY (DEFEND succeeded)`);
                resetToEconomy(room);
            } else if (myCreeps === 0) {
                resetToEconomy(room);
            }
            break;
        }
    }
}

function resetToEconomy(room: Room): void {
    room.memory.phase         = 'ECONOMY';
    room.memory.phaseTick     = undefined;
    room.memory.combatState   = 'RALLY';
    room.memory.enemyRoomName = undefined;
    room.memory.enemyStrength = undefined;
    room.memory.scoutTick     = undefined;
    Memory.roadsPlanned       = false;
}
