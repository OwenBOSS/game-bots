// Target creep counts by role. Scales with room energy capacity.
const BASE_TARGETS = { harvester: 4, upgrader: 2, builder: 2 };

export function manageSpawns(room: Room): void {
    const spawns = room.find(FIND_MY_SPAWNS).filter(s => !s.spawning);
    if (spawns.length === 0) return;

    const spawn = spawns[0];
    const counts = countByRole(room);
    const hasSites = room.find(FIND_CONSTRUCTION_SITES).length > 0;

    // Determine what to spawn next
    let role: 'harvester' | 'upgrader' | 'builder' | null = null;

    if (counts.harvester < BASE_TARGETS.harvester) {
        role = 'harvester';
    } else if (counts.upgrader < BASE_TARGETS.upgrader) {
        role = 'upgrader';
    } else if (hasSites && counts.builder < BASE_TARGETS.builder) {
        role = 'builder';
    } else if (counts.harvester < BASE_TARGETS.harvester + 2) {
        // Scale harvesters further if we have extra energy capacity
        role = 'harvester';
    }

    if (!role) return;

    const body = selectBody(role, room.energyAvailable);
    if (!body) return;

    const name = `${role}_${Game.time}`;
    const result = spawn.spawnCreep(body, name, {
        memory: { role, working: false },
    });

    if (result === OK) {
        console.log(`[economy-first] Spawning ${name} (${body.join(',')})`);
    }
}

function countByRole(room: Room): Record<'harvester' | 'upgrader' | 'builder', number> {
    const counts = { harvester: 0, upgrader: 0, builder: 0 };
    for (const creep of room.find(FIND_MY_CREEPS)) {
        const role = creep.memory.role as keyof typeof counts;
        if (role in counts) counts[role]++;
    }
    return counts;
}

// Returns the best body we can afford given available energy.
function selectBody(role: 'harvester' | 'upgrader' | 'builder', energy: number): BodyPartConstant[] | null {
    const bodies: Record<typeof role, BodyPartConstant[][]> = {
        // Listed from most expensive to cheapest — pick first one we can afford
        harvester: [
            [WORK, WORK, CARRY, CARRY, MOVE, MOVE],   // 500
            [WORK, CARRY, CARRY, MOVE, MOVE],          // 350
            [WORK, CARRY, MOVE],                       // 200
        ],
        upgrader: [
            [WORK, WORK, WORK, CARRY, MOVE, MOVE],    // 650
            [WORK, WORK, CARRY, MOVE],                 // 400
            [WORK, CARRY, MOVE],                       // 200
        ],
        builder: [
            [WORK, WORK, CARRY, CARRY, MOVE, MOVE],   // 500
            [WORK, CARRY, CARRY, MOVE],                // 300
            [WORK, CARRY, MOVE],                       // 200
        ],
    };

    for (const body of bodies[role]) {
        const cost = body.reduce((sum, part) => sum + BODYPART_COST[part], 0);
        if (energy >= cost) return body;
    }
    return null;
}
