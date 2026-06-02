import { runHarvester }       from './roles/harvester';
import { runHauler }          from './roles/hauler';
import { runUpgrader }        from './roles/upgrader';
import { runBuilder }         from './roles/builder';
import { runRepairer }        from './roles/repairer';
import { runScout }           from './roles/scout';
import { runClaimer }         from './roles/claimer';
import { runReserver }        from './roles/reserver';
import { runScavenger }       from './roles/scavenger';
import { runCourier }         from './roles/courier';
import { runWarrior }         from './roles/warrior';
import { runRanger }          from './roles/ranger';
import { runHealer }          from './roles/healer';
import { updatePhase }        from './managers/strategyManager';
import { manageSpawns, pruneExcessCreeps } from './managers/spawnManager';
import { manageConstruction } from './managers/constructionManager';
import { manageCombat }       from './managers/combatManager';
import { manageExpansion }    from './managers/expansionManager';
import { trackEnergyFlow }   from './managers/economyManager';
import { manageDefense }     from './managers/defenseManager';
import { manageLinkTransfers } from './managers/linkManager';
import { manageMarket }       from './managers/marketManager';
import { manageTransfers }    from './managers/transferManager';
import { manageRemote }       from './managers/remoteManager';
import { reportStats }        from './managers/statsReporter';

export function loop(): void {
    // Purge dead creep memory
    for (const name in Memory.creeps) {
        if (!Game.creeps[name]) delete Memory.creeps[name];
    }

    // Global memory defaults
    if (!Memory.roomIntel) Memory.roomIntel = {};
    if (!Memory.statsLog)  Memory.statsLog  = [];

    // CPU bucket tiers — skip expensive optional managers when the bucket is low
    // to protect essential operations (spawn, defense, creep roles).
    // Sigmoid-style: < 1000 = critical, < 2000 = constrained, >= 2000 = normal.
    const cpuBucket = Game.cpu.bucket;
    const cpuConstrained = cpuBucket < 2000;
    const cpuCritical    = cpuBucket < 1000;

    // Per-room managers
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room.controller?.my) continue;

        trackEnergyFlow(room);
        manageDefense(room);
        updatePhase(room);
        manageConstruction(room);
        manageSpawns(room);
        pruneExcessCreeps(room);
        manageCombat(room);
        manageLinkTransfers(room);
        manageExpansion(room);
        if (!cpuConstrained) manageMarket(room);
        if (!cpuCritical)    manageTransfers(room);
        if (!cpuCritical)    manageRemote(room);
        reportStats(room);
    }

    // Run creep roles
    for (const name in Game.creeps) {
        const creep = Game.creeps[name];

        // For combat roles: seed targetRoomName from their home room's campaign target
        if (creep.memory.role === 'warrior' || creep.memory.role === 'ranger' || creep.memory.role === 'healer') {
            const homeRoomName = creep.memory.homeRoom;
            const enemyRoom = homeRoomName ? Game.rooms[homeRoomName]?.memory.enemyRoomName : undefined;
            if (enemyRoom && !creep.memory.targetRoomName) {
                creep.memory.targetRoomName = enemyRoom;
            }
        }

        switch (creep.memory.role) {
            case 'harvester':  runHarvester(creep);  break;
            case 'hauler':     runHauler(creep);     break;
            case 'upgrader':   runUpgrader(creep);   break;
            case 'builder':    runBuilder(creep);    break;
            case 'repairer':   runRepairer(creep);   break;
            case 'scout':      runScout(creep);      break;
            case 'claimer':    runClaimer(creep);    break;
            case 'reserver':   runReserver(creep);   break;
            case 'scavenger':  runScavenger(creep);  break;
            case 'courier':    runCourier(creep);    break;
            case 'warrior':    runWarrior(creep);    break;
            case 'ranger':     runRanger(creep);     break;
            case 'healer':     runHealer(creep);     break;
        }
    }
}
