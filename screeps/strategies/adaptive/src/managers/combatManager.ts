import { CombatState } from '../types';

// Minimum warriors before we march. Waiting for a group is much more effective
// than sending warriors one at a time — a solo warrior dies to a tower instantly.
const MIN_WARRIORS_TO_MARCH = 3;

// How often to clear scoutTick to trigger a re-scout of the enemy room (ticks)
const REASSESS_INTERVAL = 500;

export function manageCombat(room: Room): void {
    const warriors = room.find(FIND_MY_CREEPS, {
        filter: c => c.memory.role === 'warrior',
    });

    const state: CombatState = Memory.combatState ?? 'RALLY';

    switch (state) {
        case 'RALLY':
            if (warriors.length >= MIN_WARRIORS_TO_MARCH && Memory.enemyRoomName) {
                Memory.combatState = 'MARCH';
                Memory.rallyTick = Game.time;
                assignTargetRoom(warriors, Memory.enemyRoomName);
                console.log(`[adaptive] Combat -> MARCH (${warriors.length} warriors -> ${Memory.enemyRoomName})`);
            }
            break;

        case 'MARCH': {
            const inEnemyRoom = warriors.filter(w => w.room.name === Memory.enemyRoomName);
            if (inEnemyRoom.length > 0) {
                Memory.combatState = 'ENGAGE';
                console.log('[adaptive] Combat -> ENGAGE');
            }
            // If we somehow lost all warriors while marching, reset
            if (warriors.length === 0) {
                Memory.combatState = 'RALLY';
            }
            break;
        }

        case 'ENGAGE':
            if (warriors.length === 0) {
                Memory.combatState = 'RALLY';
                console.log('[adaptive] Combat -> RALLY (all warriors lost)');
            }
            // Periodically re-assess whether there's still something to fight
            if (Memory.rallyTick && Game.time - Memory.rallyTick > REASSESS_INTERVAL) {
                Memory.scoutTick = undefined; // trigger re-scout
                Memory.rallyTick = Game.time;
            }
            break;
    }
}

function assignTargetRoom(warriors: Creep[], roomName: string): void {
    for (const w of warriors) {
        w.memory.targetRoomName = roomName;
    }
}
