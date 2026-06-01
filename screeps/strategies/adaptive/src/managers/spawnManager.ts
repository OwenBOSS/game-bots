import { GamePhase } from '../types';

// Desired counts per phase
// harvester target is the FINAL goal; builder spawns after MIN_HARVESTERS so it can
// start building containers and extensions without waiting for the full harvester pool.
const MIN_HARVESTERS_BEFORE_BUILDER = 2;

const TARGETS: Record<GamePhase, { harvester: number; builder: number; scout: number; warrior: number }> = {
    ECONOMY: { harvester: 5, builder: 1, scout: 0, warrior: 0 },
    ASSESS:  { harvester: 5, builder: 1, scout: 1, warrior: 0 },
    RUSH:    { harvester: 2, builder: 0, scout: 1, warrior: 6 },
    DEFEND:  { harvester: 4, builder: 2, scout: 1, warrior: 4 },
};

export function manageSpawns(room: Room): void {
    const spawns = room.find(FIND_MY_SPAWNS).filter(s => !s.spawning);
    if (spawns.length === 0) return;

    const spawn = spawns[0];
    const phase: GamePhase = Memory.phase ?? 'ECONOMY';
    const targets = TARGETS[phase];
    const creeps = room.find(FIND_MY_CREEPS);

    const counts = {
        harvester: creeps.filter(c => c.memory.role === 'harvester').length,
        builder:   creeps.filter(c => c.memory.role === 'builder').length,
        scout:     creeps.filter(c => c.memory.role === 'scout').length,
        warrior:   creeps.filter(c => c.memory.role === 'warrior').length,
    };

    // Always keep at least MIN_HARVESTERS_BEFORE_BUILDER running
    if (counts.harvester < MIN_HARVESTERS_BEFORE_BUILDER) {
        trySpawn(spawn, 'harvester', room.energyAvailable);
        return;
    }

    // Then fill the rest in priority order
    if (counts.builder < targets.builder) {
        trySpawn(spawn, 'builder', room.energyAvailable);
    } else if (counts.harvester < targets.harvester) {
        // Fill remaining harvesters after builder is queued
        trySpawn(spawn, 'harvester', room.energyAvailable);
    } else if (counts.scout < targets.scout) {
        trySpawn(spawn, 'scout', room.energyAvailable);
    } else if (counts.warrior < targets.warrior) {
        trySpawn(spawn, 'warrior', room.energyAvailable);
    }
}

function trySpawn(
    spawn: StructureSpawn,
    role: 'harvester' | 'builder' | 'scout' | 'warrior',
    energy: number,
): void {
    const body = selectBody(role, energy);
    if (!body) return;

    const name = `${role}_${Game.time}`;
    const result = spawn.spawnCreep(body, name, { memory: { role, working: false } });
    if (result === OK) {
        console.log(`[adaptive] Spawning ${name} (${body.join(',')})`);
    }
}

function selectBody(role: 'harvester' | 'builder' | 'scout' | 'warrior', energy: number): BodyPartConstant[] | null {
    const bodies: Record<typeof role, BodyPartConstant[][]> = {
        harvester: [
            [WORK, WORK, CARRY, CARRY, MOVE, MOVE], // 500
            [WORK, CARRY, CARRY, MOVE, MOVE],        // 350
            [WORK, CARRY, MOVE],                     // 200
        ],
        builder: [
            [WORK, WORK, CARRY, CARRY, MOVE, MOVE], // 500
            [WORK, CARRY, CARRY, MOVE, MOVE],        // 350
            [WORK, CARRY, MOVE],                     // 200
        ],
        scout: [
            [MOVE, MOVE, MOVE], // 150 — pure speed
            [MOVE, MOVE],       // 100
            [MOVE],             // 50
        ],
        warrior: [
            // Balanced: tough buffer + melee + heal + move
            [TOUGH, TOUGH, ATTACK, ATTACK, ATTACK, HEAL, MOVE, MOVE, MOVE, MOVE, MOVE], // 1010
            [TOUGH, ATTACK, ATTACK, ATTACK, HEAL, MOVE, MOVE, MOVE, MOVE],               // 800
            [ATTACK, ATTACK, HEAL, MOVE, MOVE, MOVE],                                    // 560
            [ATTACK, ATTACK, MOVE, MOVE, MOVE],                                           // 310
            [ATTACK, MOVE],                                                                // 130
        ],
    };

    for (const body of bodies[role]) {
        const cost = body.reduce((sum, p) => sum + BODYPART_COST[p], 0);
        if (energy >= cost) return body;
    }
    return null;
}
