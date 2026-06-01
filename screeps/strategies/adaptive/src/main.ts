import { runHarvester }       from './roles/harvester';
import { runHauler }          from './roles/hauler';
import { runUpgrader }        from './roles/upgrader';
import { runBuilder }         from './roles/builder';
import { runRepairer }        from './roles/repairer';
import { runScout }           from './roles/scout';
import { runClaimer }         from './roles/claimer';
import { runWarrior }         from './roles/warrior';
import { runRanger }          from './roles/ranger';
import { runHealer }          from './roles/healer';
import { updatePhase }        from './managers/strategyManager';
import { manageSpawns, pruneExcessCreeps } from './managers/spawnManager';
import { manageConstruction } from './managers/constructionManager';
import { manageCombat }       from './managers/combatManager';
import { manageExpansion }    from './managers/expansionManager';
import { trackEnergyFlow }   from './managers/economyManager';
import { manageLinkTransfers } from './managers/linkManager';
import { manageMarket }       from './managers/marketManager';
import { reportStats }        from './managers/statsReporter';

export function loop(): void {
    // Purge dead creep memory
    for (const name in Memory.creeps) {
        if (!Game.creeps[name]) delete Memory.creeps[name];
    }

    // Global memory defaults (initialize every tick so they're never undefined)
    if (!Memory.phase)     Memory.phase     = 'ECONOMY';
    if (!Memory.roomIntel) Memory.roomIntel = {};
    if (!Memory.statsLog)  Memory.statsLog  = [];

    // Per-room managers
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room.controller?.my) continue;

        trackEnergyFlow(room);
        updatePhase(room);
        manageConstruction(room);
        manageSpawns(room);
        pruneExcessCreeps(room);
        manageCombat(room);
        manageLinkTransfers(room);
        manageExpansion(room);
        manageMarket(room);
        reportStats(room);
    }

    // Run creep roles
    const enemyRoom = Memory.enemyRoomName;

    for (const name in Game.creeps) {
        const creep = Game.creeps[name];

        if ((creep.memory.role === 'warrior' || creep.memory.role === 'ranger' || creep.memory.role === 'healer') &&
            enemyRoom && !creep.memory.targetRoomName) {
            creep.memory.targetRoomName = enemyRoom;
        }

        switch (creep.memory.role) {
            case 'harvester': runHarvester(creep); break;
            case 'hauler':    runHauler(creep);    break;
            case 'upgrader':  runUpgrader(creep);  break;
            case 'builder':   runBuilder(creep);   break;
            case 'repairer':  runRepairer(creep);  break;
            case 'scout':     runScout(creep);     break;
            case 'claimer':   runClaimer(creep);   break;
            case 'warrior':   runWarrior(creep);   break;
            case 'ranger':    runRanger(creep);    break;
            case 'healer':    runHealer(creep);    break;
        }
    }
}
