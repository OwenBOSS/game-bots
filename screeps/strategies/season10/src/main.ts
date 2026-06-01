import { runHarvester } from './roles/harvester';
import { runCollector } from './roles/collector';
import { manageSpawns } from './managers/spawnManager';
import { trackScores } from './managers/scoreTracker';

export function loop(): void {
    for (const name in Memory.creeps) {
        if (!Game.creeps[name]) delete Memory.creeps[name];
    }

    if (!Memory.scoreMap) Memory.scoreMap = {};
    if (!Memory.knownRooms) Memory.knownRooms = [];

    // Update score map for every visible room each tick
    for (const roomName in Game.rooms) {
        trackScores(Game.rooms[roomName]);
    }

    // Spawn management for owned rooms
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room.controller?.my) continue;
        manageSpawns(room);
    }

    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        switch (creep.memory.role) {
            case 'harvester': runHarvester(creep); break;
            case 'collector': runCollector(creep); break;
        }
    }

    if (Game.time % 100 === 0) {
        const rooms = Object.keys(Memory.scoreMap).join(', ') || 'none';
        console.log(`[season10] tick=${Game.time} score rooms: ${rooms}`);
    }
}
