import { runHarvester } from './roles/harvester';
import { runAttacker } from './roles/attacker';
import { manageSpawns } from './managers/spawnManager';

export function loop(): void {
    for (const name in Memory.creeps) {
        if (!Game.creeps[name]) delete Memory.creeps[name];
    }

    if (!Memory.rushPhase) Memory.rushPhase = 'ECONOMY';

    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room.controller?.my) continue;
        manageSpawns(room);

        // Find enemy room on first tick — look at room exits
        if (!Memory.enemySpawnId) {
            findEnemyRoom(room);
        }
    }

    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        switch (creep.memory.role) {
            case 'harvester': runHarvester(creep); break;
            case 'attacker':  runAttacker(creep);  break;
        }
    }
}

// Scan adjacent rooms for enemy spawns and cache the target room name.
function findEnemyRoom(room: Room): void {
    const exits = Game.map.describeExits(room.name);
    for (const dir in exits) {
        const roomName = exits[dir as ExitKey];
        if (!roomName) continue;
        const roomInfo = Game.map.getRoomStatus(roomName);
        if (roomInfo.status === 'normal') {
            // Assign attack target to all future attackers
            const attackers = room.find(FIND_MY_CREEPS, {
                filter: c => c.memory.role === 'attacker',
            });
            for (const attacker of attackers) {
                attacker.memory.targetRoomName = roomName;
            }
            Memory.rushPhase = Memory.rushPhase === 'ECONOMY' ? 'ECONOMY' : Memory.rushPhase;
            break;
        }
    }
}
