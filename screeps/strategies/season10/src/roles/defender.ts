// Defender role — [TOUGH×N, ATTACK×N, MOVE×N] — guards the home room.
// Spawned when armed hostiles enter the home room. Idles near spawn when quiet.

import { moveTo } from '../utils/trafficManager';

export function runDefender(creep: Creep): void {
    const homeRoom = (creep.memory as any).homeRoom ?? creep.room.name;

    // Return home if pushed out
    if (creep.room.name !== homeRoom) {
        const pos = new RoomPosition(25, 25, homeRoom);
        moveTo(creep, pos, { range: 20 });
        return;
    }

    const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
    if (hostiles.length === 0) {
        // Idle near spawn — don't block roads
        const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
        if (spawn && creep.pos.getRangeTo(spawn) > 4) {
            moveTo(creep, spawn.pos, { range: 3 });
        }
        return;
    }

    // Prioritize attackers/dismantlers over scouts
    const armed = hostiles.filter(h => h.body.some(p => p.type === ATTACK || p.type === RANGED_ATTACK || p.type === WORK));
    const target = creep.pos.findClosestByPath(armed.length > 0 ? armed : hostiles);
    if (!target) return;

    if (creep.attack(target) === ERR_NOT_IN_RANGE) {
        moveTo(creep, target.pos, { reusePath: 2 });
    }
}
