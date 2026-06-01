import { runHarvester } from './roles/harvester';
import { runUpgrader } from './roles/upgrader';
import { runBuilder } from './roles/builder';
import { manageSpawns } from './managers/spawnManager';

export function loop(): void {
    // Purge memory of dead creeps
    for (const name in Memory.creeps) {
        if (!Game.creeps[name]) delete Memory.creeps[name];
    }

    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room.controller?.my) continue;
        manageSpawns(room);
    }

    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        switch (creep.memory.role) {
            case 'harvester': runHarvester(creep); break;
            case 'upgrader':  runUpgrader(creep);  break;
            case 'builder':   runBuilder(creep);   break;
        }
    }
}
