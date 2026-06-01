// Manages room expansion: find a target → send claimer → bootstrap new room.
//
// Requirements before expanding:
//   • Main room RCL ≥ 4  (stable economy with storage)
//   • GCL allows another room
//   • A suitable unowned room is in our intel

import { ExpansionState } from '../types';

const MIN_RCL_TO_EXPAND = 4;
const BOOTSTRAP_HAULERS  = 2;
const BOOTSTRAP_BUILDERS = 2;

export function manageExpansion(mainRoom: Room): void {
    const state: ExpansionState = Memory.expansionState ?? 'IDLE';
    const ownedCount = Object.values(Game.rooms).filter(r => r.controller?.my).length;
    const canExpand  = ownedCount < Game.gcl.level;

    switch (state) {
        case 'IDLE': {
            const rcl = mainRoom.controller?.level ?? 0;
            if (!canExpand || rcl < MIN_RCL_TO_EXPAND) break;

            const target = findExpansionTarget();
            if (target) {
                Memory.expansionTarget = target;
                Memory.expansionState  = 'CLAIMING';
                console.log(`[adaptive] Expansion -> CLAIMING ${target}`);
            }
            break;
        }

        case 'CLAIMING': {
            const target = Memory.expansionTarget;
            if (!target) { Memory.expansionState = 'IDLE'; break; }

            // Check if we've successfully claimed the room
            const targetRoom = Game.rooms[target];
            if (targetRoom?.controller?.my) {
                Memory.expansionState  = 'BOOTSTRAPPING';
                Memory.expansionRoomName = target;
                console.log(`[adaptive] Expansion -> BOOTSTRAPPING ${target}`);
            }
            // spawnManager handles spawning the claimer
            break;
        }

        case 'BOOTSTRAPPING': {
            const roomName = Memory.expansionRoomName;
            if (!roomName) { Memory.expansionState = 'IDLE'; break; }

            const newRoom = Game.rooms[roomName];
            if (!newRoom?.controller?.my) {
                // Lost the room — reset
                Memory.expansionState = 'IDLE';
                break;
            }

            if (newRoom.find(FIND_MY_SPAWNS).length > 0) {
                Memory.expansionState = 'ACTIVE';
                console.log(`[adaptive] Expansion -> ACTIVE ${roomName}`);
            }
            // spawnManager sends bootstrap workers from main room
            break;
        }

        case 'ACTIVE': {
            const roomName = Memory.expansionRoomName;
            if (!roomName || !Game.rooms[roomName]?.controller?.my) {
                Memory.expansionState    = 'IDLE';
                Memory.expansionTarget   = undefined;
                Memory.expansionRoomName = undefined;
                console.log('[adaptive] Expansion room lost — resetting');
            }
            break;
        }
    }
}

function findExpansionTarget(): string | null {
    const intel = Memory.roomIntel ?? {};
    const candidates = Object.entries(intel)
        .filter(([_, d]) => d.hasController && !d.controllerOwned && d.strength === 0)
        .sort((a, b) => (b[1].sourceCount ?? 0) - (a[1].sourceCount ?? 0)); // prefer 2-source rooms
    return candidates.length > 0 ? candidates[0][0] : null;
}

// How many bootstrap workers the main room should send to the new room
export function bootstrapTargets(): { hauler: number; builder: number } {
    if (Memory.expansionState !== 'BOOTSTRAPPING') return { hauler: 0, builder: 0 };
    const roomName = Memory.expansionRoomName;
    if (!roomName) return { hauler: 0, builder: 0 };

    const inNewRoom = Object.values(Game.creeps).filter(
        c => c.memory.targetRoomName === roomName
    );
    return {
        hauler:  Math.max(0, BOOTSTRAP_HAULERS  - inNewRoom.filter(c => c.memory.role === 'hauler').length),
        builder: Math.max(0, BOOTSTRAP_BUILDERS - inNewRoom.filter(c => c.memory.role === 'builder').length),
    };
}
