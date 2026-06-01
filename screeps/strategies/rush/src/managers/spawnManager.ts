import { RushPhase } from '../types';

const MIN_HARVESTERS = 2;
const WAVE_SIZE = 5; // attackers before launching

export function manageSpawns(room: Room): void {
    const spawns = room.find(FIND_MY_SPAWNS).filter(s => !s.spawning);
    if (spawns.length === 0) return;

    const spawn = spawns[0];
    const creeps = room.find(FIND_MY_CREEPS);
    const harvesters = creeps.filter(c => c.memory.role === 'harvester');
    const attackers = creeps.filter(c => c.memory.role === 'attacker');
    const phase: RushPhase = Memory.rushPhase ?? 'ECONOMY';

    if (phase === 'ECONOMY' || harvesters.length < MIN_HARVESTERS) {
        if (harvesters.length < MIN_HARVESTERS) {
            trySpawn(spawn, 'harvester', room.energyAvailable);
            return;
        }
        // Move to MUSTERING once we can spawn at least one wave's worth
        if (attackers.length === 0) {
            Memory.rushPhase = 'MUSTERING';
        }
    }

    if (Memory.rushPhase === 'MUSTERING' || Memory.rushPhase === 'ATTACK') {
        if (attackers.length < WAVE_SIZE) {
            trySpawn(spawn, 'attacker', room.energyAvailable);
        } else if (Memory.rushPhase === 'MUSTERING') {
            Memory.rushPhase = 'ATTACK';
            Memory.attackWaveTick = Game.time;
            console.log(`[rush] Wave ready at tick ${Game.time} — attacking!`);
        }
    }
}

function trySpawn(
    spawn: StructureSpawn,
    role: 'harvester' | 'attacker',
    energy: number,
): void {
    const body = role === 'attacker' ? selectAttackerBody(energy) : selectHarvesterBody(energy);
    if (!body) return;

    const name = `${role}_${Game.time}`;
    spawn.spawnCreep(body, name, { memory: { role, working: false } });
}

function selectAttackerBody(energy: number): BodyPartConstant[] | null {
    // Maximize ATTACK+MOVE, add TOUGH for cheap HP buffer
    const options: BodyPartConstant[][] = [
        [TOUGH, TOUGH, ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE, MOVE, MOVE], // 880
        [TOUGH, ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE, MOVE],              // 680
        [ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE],                           // 480
        [ATTACK, ATTACK, MOVE, MOVE],                                          // 260
        [ATTACK, MOVE],                                                        // 130
    ];
    for (const body of options) {
        if (energy >= body.reduce((s, p) => s + BODYPART_COST[p], 0)) return body;
    }
    return null;
}

function selectHarvesterBody(energy: number): BodyPartConstant[] | null {
    const options: BodyPartConstant[][] = [
        [WORK, CARRY, CARRY, MOVE, MOVE], // 350
        [WORK, CARRY, MOVE],              // 200
    ];
    for (const body of options) {
        if (energy >= body.reduce((s, p) => s + BODYPART_COST[p], 0)) return body;
    }
    return null;
}
