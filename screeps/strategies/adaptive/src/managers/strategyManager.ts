import { GamePhase } from '../types';

const ECONOMY_CREEP_TARGET    = 5;
const RUSH_STRENGTH_THRESHOLD = 10;
const REASSESS_COOLDOWN       = 500;
const RUSH_TIMEOUT            = 2000;
// When safe mode has this many ticks left, start building up combat for what comes after
const SAFE_MODE_PREPARE_TICKS = 2000;

export function updatePhase(room: Room): void {
    // ── Safe mode override ────────────────────────────────────────────────────
    // During safe mode enemies can't attack us. Use the window for pure economy.
    // When safe mode is nearly up, transition to ASSESS so we start scouting + building army.
    const safeMode = room.controller?.safeMode ?? 0;
    if (safeMode > 0) {
        if (Memory.phase !== 'ECONOMY') {
            Memory.phase = 'ECONOMY';
            console.log(`[adaptive] Safe mode active (${safeMode} ticks left) → forcing ECONOMY`);
        }
        if (safeMode < SAFE_MODE_PREPARE_TICKS && Memory.phase === 'ECONOMY') {
            Memory.phase     = 'ASSESS';
            Memory.scoutTick = undefined;
            console.log('[adaptive] Safe mode expiring soon → ASSESS (build for what comes next)');
        }
        return; // skip normal phase logic while safe mode is active
    }

    // ── Normal phase machine ─────────────────────────────────────────────────
    const phase: GamePhase = Memory.phase ?? 'ECONOMY';
    if (!Memory.roomIntel) Memory.roomIntel = {};

    const myCreeps = room.find(FIND_MY_CREEPS).length;

    switch (phase) {
        case 'ECONOMY': {
            const cooldownDone = !Memory.phaseTick || Game.time >= Memory.phaseTick;
            if (myCreeps >= ECONOMY_CREEP_TARGET && cooldownDone) {
                Memory.phase     = 'ASSESS';
                Memory.phaseTick = Game.time;
                Memory.scoutTick = undefined;
                console.log(`[adaptive] → ASSESS at tick ${Game.time}`);
            }
            break;
        }

        case 'ASSESS':
            if (Memory.scoutTick !== undefined) {
                if (Memory.enemyRoomName && Memory.enemyStrength !== undefined && Memory.enemyStrength > 0) {
                    Memory.phase     = Memory.enemyStrength <= RUSH_STRENGTH_THRESHOLD ? 'RUSH' : 'DEFEND';
                    Memory.phaseTick = Game.time;
                    console.log(`[adaptive] → ${Memory.phase} (enemy strength ${Memory.enemyStrength} in ${Memory.enemyRoomName})`);
                } else {
                    Memory.phase     = 'ECONOMY';
                    Memory.phaseTick = Game.time + REASSESS_COOLDOWN;
                    console.log(`[adaptive] → ECONOMY (no enemies, re-assess at tick ${Memory.phaseTick})`);
                }
            }
            break;

        case 'RUSH': {
            const combatUnits = room.find(FIND_MY_CREEPS, {
                filter: c => c.memory.role === 'warrior' || c.memory.role === 'ranger',
            }).length;

            const enemyIntel = Memory.enemyRoomName ? Memory.roomIntel[Memory.enemyRoomName] : undefined;
            if (enemyIntel && enemyIntel.strength === 0 && Game.time - enemyIntel.scannedAt < 100) {
                console.log(`[adaptive] → ECONOMY (RUSH succeeded — ${Memory.enemyRoomName} cleared)`);
                resetToEconomy();
                break;
            }

            if (combatUnits === 0 && myCreeps > 0) {
                console.log('[adaptive] → ECONOMY (RUSH failed — no combat units left)');
                resetToEconomy();
                break;
            }

            if (myCreeps === 0) { resetToEconomy(); break; }

            if (Memory.phaseTick && Game.time - Memory.phaseTick > RUSH_TIMEOUT) {
                console.log('[adaptive] → ECONOMY (RUSH timed out)');
                resetToEconomy();
            }
            break;
        }

        case 'DEFEND': {
            const enemies = room.find(FIND_HOSTILE_CREEPS).length;
            const enemyIntel = Memory.enemyRoomName ? Memory.roomIntel[Memory.enemyRoomName] : undefined;
            const threatCleared = enemyIntel && enemyIntel.strength === 0 && Game.time - enemyIntel.scannedAt < 100;

            if (enemies === 0 && threatCleared) {
                console.log('[adaptive] → ECONOMY (DEFEND succeeded)');
                resetToEconomy();
            } else if (myCreeps === 0) {
                resetToEconomy();
            }
            break;
        }
    }
}

function resetToEconomy(): void {
    Memory.phase          = 'ECONOMY';
    Memory.phaseTick      = undefined;
    Memory.combatState    = 'RALLY';
    Memory.roadsPlanned   = false;
    Memory.enemyRoomName  = undefined;
    Memory.enemyStrength  = undefined;
    Memory.scoutTick      = undefined;
}
