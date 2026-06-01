import { GamePhase } from '../types';

const ECONOMY_CREEP_TARGET = 5;   // transition to ASSESS once we have this many creeps
const RUSH_STRENGTH_THRESHOLD = 10; // below this: rush; above: defend

export function updatePhase(room: Room): void {
    const phase: GamePhase = Memory.phase ?? 'ECONOMY';
    if (!Memory.roomIntel) Memory.roomIntel = {};

    const myCreeps = room.find(FIND_MY_CREEPS).length;

    switch (phase) {
        case 'ECONOMY':
            if (myCreeps >= ECONOMY_CREEP_TARGET) {
                Memory.phase = 'ASSESS';
                Memory.phaseTick = Game.time;
                console.log(`[adaptive] -> ASSESS at tick ${Game.time}`);
            }
            break;

        case 'ASSESS':
            // Wait for scout to report back
            if (Memory.scoutTick !== undefined && Memory.enemyStrength !== undefined) {
                Memory.phase = Memory.enemyStrength <= RUSH_STRENGTH_THRESHOLD ? 'RUSH' : 'DEFEND';
                Memory.phaseTick = Game.time;
                console.log(`[adaptive] -> ${Memory.phase} (enemy strength ${Memory.enemyStrength})`);
            }
            break;

        case 'RUSH':
        case 'DEFEND':
            if (myCreeps === 0) {
                Memory.phase = 'ECONOMY';
                Memory.combatState = 'RALLY';
                Memory.roadsPlanned = false; // re-plan on rebuild
                console.log('[adaptive] -> ECONOMY (reset after loss)');
            }
            break;
    }
}
