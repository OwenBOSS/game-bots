// Season 10: prioritize fast collectors (MOVE-heavy) over economy creeps.
// Ratio: 2 harvesters to keep energy flowing, rest are collectors.

const MIN_HARVESTERS = 2;
const MAX_COLLECTORS = 8;

export function manageSpawns(room: Room): void {
    const spawns = room.find(FIND_MY_SPAWNS).filter(s => !s.spawning);
    if (spawns.length === 0) return;

    const spawn = spawns[0];
    const creeps = room.find(FIND_MY_CREEPS);
    const harvesters = creeps.filter(c => c.memory.role === 'harvester').length;
    const collectors = creeps.filter(c => c.memory.role === 'collector').length;

    let role: 'harvester' | 'collector' | null = null;

    if (harvesters < MIN_HARVESTERS) {
        role = 'harvester';
    } else if (collectors < MAX_COLLECTORS) {
        role = 'collector';
    }

    if (!role) return;

    const body = role === 'collector'
        ? selectCollectorBody(room.energyAvailable)
        : selectHarvesterBody(room.energyAvailable);

    if (!body) return;

    const name = `${role}_${Game.time}`;
    spawn.spawnCreep(body, name, { memory: { role, working: false } });
}

// Collectors need max MOVE for speed across rooms.
// CARRY lets them hold score objects if pickup() is used.
function selectCollectorBody(energy: number): BodyPartConstant[] | null {
    const opts: BodyPartConstant[][] = [
        [CARRY, CARRY, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE], // 600 — fast with capacity
        [CARRY, MOVE, MOVE, MOVE, MOVE, MOVE],               // 400
        [CARRY, MOVE, MOVE, MOVE],                           // 250
        [CARRY, MOVE, MOVE],                                 // 150
    ];
    for (const b of opts) {
        if (energy >= b.reduce((s, p) => s + BODYPART_COST[p], 0)) return b;
    }
    return null;
}

function selectHarvesterBody(energy: number): BodyPartConstant[] | null {
    const opts: BodyPartConstant[][] = [
        [WORK, WORK, CARRY, MOVE, MOVE], // 450
        [WORK, CARRY, CARRY, MOVE, MOVE], // 350
        [WORK, CARRY, MOVE],              // 200
    ];
    for (const b of opts) {
        if (energy >= b.reduce((s, p) => s + BODYPART_COST[p], 0)) return b;
    }
    return null;
}
