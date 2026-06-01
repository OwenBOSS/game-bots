import { runHarvester }       from './roles/harvester';
import { runBuilder }         from './roles/builder';
import { runScout }           from './roles/scout';
import { runWarrior }         from './roles/warrior';
import { updatePhase }        from './managers/strategyManager';
import { manageSpawns }       from './managers/spawnManager';
import { manageConstruction } from './managers/constructionManager';
import { manageCombat }       from './managers/combatManager';
import { reportStats }        from './managers/statsReporter';

export function loop(): void {
    for (const name in Memory.creeps) {
        if (!Game.creeps[name]) delete Memory.creeps[name];
    }

    if (!Memory.phase)     Memory.phase     = 'ECONOMY';
    if (!Memory.roomIntel) Memory.roomIntel = {};

    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room.controller?.my) continue;

        updatePhase(room);
        manageConstruction(room);
        manageSpawns(room);
        manageCombat(room);
        reportStats(room);
    }

    const enemyRoom = Memory.enemyRoomName;

    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        switch (creep.memory.role) {
            case 'harvester':
                runHarvester(creep);
                break;
            case 'builder':
                runBuilder(creep);
                break;
            case 'scout':
                runScout(creep);
                break;
            case 'warrior':
                if (enemyRoom && !creep.memory.targetRoomName) {
                    creep.memory.targetRoomName = enemyRoom;
                }
                runWarrior(creep);
                break;
        }
    }
}
