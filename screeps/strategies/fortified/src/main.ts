import { manageSpawns }       from './managers/spawnManager';
import { manageConstruction }  from './managers/constructionManager';
import { manageLinkTransfers } from './managers/linkManager';
import { runBootstrap }        from './roles/bootstrap';
import { runHarvester }        from './roles/harvester';
import { runHauler }           from './roles/hauler';
import { runUpgrader }         from './roles/upgrader';

export function loop(): void {
    for (const name in Memory.creeps) {
        if (!Game.creeps[name]) delete Memory.creeps[name];
    }

    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room.controller?.my) continue;
        manageConstruction(room);
        manageLinkTransfers(room);
        manageSpawns(room);
    }

    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        switch (creep.memory.role) {
            case 'bootstrap': runBootstrap(creep); break;
            case 'harvester': runHarvester(creep); break;
            case 'hauler':    runHauler(creep);    break;
            case 'upgrader':  runUpgrader(creep);  break;
        }
    }
}
