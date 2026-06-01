import { GamePhase } from '../types';

const ECONOMY_CREEP_TARGET    = 3;   // start scouting at 3 creeps, not 5
const RUSH_STRENGTH_THRESHOLD = 30;  // attack enemies up to this strength (was 10)
const OPPORTUNISTIC_THRESHOLD = 15;  // attack immediately without full ASSESS if this weak
const REASSESS_COOLDOWN       = 100; // ticks between re-assess attempts (was 500)
const RUSH_TIMEOUT            = 2000;
const SAFE_MODE_PREPARE_TICKS = 2000;

// How fresh intel must be to act on it for an attack
const MAX_ATTACK_INTEL_AGE    = 500;

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

    const phase: GamePhase = room.memory.phase ?? 'ECONOMY';
    if (!Memory.roomIntel) Memory.roomIntel = {};

    const myCreeps = room.find(FIND_MY_CREEPS).length;

    switch (phase) {
        case 'ECONOMY': {
            const cooldownDone = !room.memory.phaseTick || Game.time >= room.memory.phaseTick;
            if (!cooldownDone) break;

            // Opportunistic attack: if we can see a juicy weak target, skip ASSESS and RUSH now.
            // This is how we attack unprovoked — we don't wait to be threatened.
            if (myCreeps >= ECONOMY_CREEP_TARGET) {
                const weak = findBestTarget(room, OPPORTUNISTIC_THRESHOLD);
                if (weak) {
                    room.memory.phase         = 'RUSH';
                    room.memory.phaseTick     = Game.time;
                    room.memory.combatState   = 'RALLY';
                    room.memory.enemyRoomName = weak.name;
                    room.memory.enemyStrength = weak.strength;
                    console.log(`[${room.name}] → RUSH opportunistic (${weak.name} str=${weak.strength} val=${weak.value})`);
                    break;
                }
                // Otherwise transition to ASSESS to send scout
                room.memory.phase     = 'ASSESS';
                room.memory.phaseTick = Game.time;
                room.memory.scoutTick = undefined;
                console.log(`[${room.name}] → ASSESS at tick ${Game.time}`);
            }
            break;
        }

        case 'ASSESS':
            if (room.memory.scoutTick !== undefined) {
                const target = findBestTarget(room, RUSH_STRENGTH_THRESHOLD);
                if (target) {
                    room.memory.phase         = 'RUSH';
                    room.memory.phaseTick     = Game.time;
                    room.memory.enemyRoomName = target.name;
                    room.memory.enemyStrength = target.strength;
                    console.log(`[${room.name}] → RUSH (${target.name} str=${target.strength} val=${target.value})`);
                } else {
                    // No viable target found — check if any strong enemy needs defending against
                    const strong = findStrongestThreat(room);
                    if (strong) {
                        room.memory.phase         = 'DEFEND';
                        room.memory.phaseTick     = Game.time;
                        room.memory.enemyRoomName = strong.name;
                        room.memory.enemyStrength = strong.strength;
                        console.log(`[${room.name}] → DEFEND (${strong.name} str=${strong.strength})`);
                    } else {
                        room.memory.phase     = 'ECONOMY';
                        room.memory.phaseTick = Game.time + REASSESS_COOLDOWN;
                        console.log(`[${room.name}] → ECONOMY (no viable targets, reassess at ${room.memory.phaseTick})`);
                    }
                }
            }
            break;

        case 'RUSH': {
            const combatUnits = room.find(FIND_MY_CREEPS, {
                filter: c => (c.memory.role === 'warrior' || c.memory.role === 'ranger') &&
                    c.memory.homeRoom === room.name,
            }).length;

            const enemyIntel = room.memory.enemyRoomName ? Memory.roomIntel[room.memory.enemyRoomName] : undefined;
            const targetCleared = enemyIntel && enemyIntel.strength === 0 && Game.time - enemyIntel.scannedAt < 100;

            if (targetCleared) {
                console.log(`[${room.name}] RUSH succeeded — ${room.memory.enemyRoomName} cleared`);
                // Chain attack: immediately look for the next weak target instead of resting
                chainAttack(room);
                break;
            }
            if (combatUnits === 0 && myCreeps > 0) {
                console.log(`[${room.name}] RUSH failed — no combat units`);
                chainAttack(room);
                break;
            }
            if (myCreeps === 0) { resetToEconomy(room); break; }
            if (room.memory.phaseTick && Game.time - room.memory.phaseTick > RUSH_TIMEOUT) {
                console.log(`[${room.name}] RUSH timed out`);
                chainAttack(room);
            }
            break;
        }

        case 'DEFEND': {
            const enemies    = room.find(FIND_HOSTILE_CREEPS).length;
            const enemyIntel = room.memory.enemyRoomName ? Memory.roomIntel[room.memory.enemyRoomName] : undefined;
            const threatCleared = enemyIntel && enemyIntel.strength === 0 && Game.time - enemyIntel.scannedAt < 100;

            if (enemies === 0 && threatCleared) {
                console.log(`[${room.name}] DEFEND succeeded — counterattacking`);
                chainAttack(room); // don't rest after defending, look for counter-target
            } else if (myCreeps === 0) {
                resetToEconomy(room);
            }
            break;
        }
    }
}

// ─── Target selection ─────────────────────────────────────────────────────────
// "Best" = highest economic damage per unit of enemy strength.
// Priority: rooms with spawns (destroying spawn = cripples their economy),
//           low strength (cheap to kill), fresh intel.

interface AttackTarget { name: string; strength: number; value: number }

function findBestTarget(room: Room, maxStrength: number): AttackTarget | null {
    const intel       = Memory.roomIntel ?? {};
    const ownedNames  = new Set(Object.values(Game.rooms).filter(r => r.controller?.my).map(r => r.name));
    const reserved    = new Set(Object.keys(room.memory.remoteRooms ?? {}));

    let best: AttackTarget | null = null;

    for (const [name, data] of Object.entries(intel)) {
        if (ownedNames.has(name))  continue;  // don't attack ourselves
        if (reserved.has(name))    continue;  // don't attack rooms we're harvesting
        if (data.strength > maxStrength) continue;
        if (data.strength === 0)   continue;  // room is already empty
        if (Game.time - data.scannedAt > MAX_ATTACK_INTEL_AGE) continue; // stale

        // Economic attack value: spawn is worth most (destroys economy), towers add risk cost
        // Prefer player-owned rooms (enemy spawns) over invader rooms
        const value = (data.enemySpawns * 120)        // spawn = biggest economic target
            + (data.controllerOwned ? 50 : 0)         // player rooms are higher priority than NPC
            - (data.enemyTowers * 30)                  // towers = increased cost to attack
            - (data.strength * 2);                     // lower strength = easier target

        if (!best || value > best.value) {
            best = { name, strength: data.strength, value };
        }
    }

    return best;
}

function findStrongestThreat(room: Room): AttackTarget | null {
    const intel      = Memory.roomIntel ?? {};
    const ownedNames = new Set(Object.values(Game.rooms).filter(r => r.controller?.my).map(r => r.name));

    let worst: AttackTarget | null = null;
    for (const [name, data] of Object.entries(intel)) {
        if (ownedNames.has(name)) continue;
        if (data.strength === 0) continue;
        if (Game.time - data.scannedAt > MAX_ATTACK_INTEL_AGE) continue;
        if (!worst || data.strength > worst.strength) {
            worst = { name, strength: data.strength, value: -data.strength };
        }
    }
    return worst;
}

// ─── Chain attack ─────────────────────────────────────────────────────────────
// After clearing or abandoning a RUSH, immediately look for the next target
// rather than retreating to ECONOMY. This keeps continuous offensive pressure.

function chainAttack(room: Room): void {
    // Reset combat state to rally for next campaign
    room.memory.combatState   = 'RALLY';
    room.memory.enemyRoomName = undefined;
    room.memory.enemyStrength = undefined;
    room.memory.scoutTick     = undefined;

    const next = findBestTarget(room, RUSH_STRENGTH_THRESHOLD);
    if (next) {
        room.memory.phase         = 'RUSH';
        room.memory.phaseTick     = Game.time;
        room.memory.enemyRoomName = next.name;
        room.memory.enemyStrength = next.strength;
        console.log(`[${room.name}] → RUSH chaining (${next.name} str=${next.strength} val=${next.value})`);
    } else {
        // No current target — go to ASSESS to get fresh scout data
        room.memory.phase     = 'ASSESS';
        room.memory.phaseTick = Game.time;
        console.log(`[${room.name}] → ASSESS (no chain target available)`);
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
