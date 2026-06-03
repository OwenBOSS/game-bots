// Hunter role — [ATTACK×3, MOVE×3] — intercepts enemy collectors near Score rooms.
// Spawned only when hostiles are detected in rooms that have known Scores.
// Targets hostile creeps in rooms that appear in Memory.scoreCache.

export function runHunter(creep: Creep): void {
    const mem = creep.memory as any;

    // Validate target from previous tick
    if (mem.targetId) {
        const target = Game.getObjectById(mem.targetId as Id<any>);
        if (!target) {
            mem.targetId = null;
        } else {
            if (creep.attack(target as Creep) === ERR_NOT_IN_RANGE) {
                creep.moveTo((target as any).pos, { reusePath: 3 });
            }
            return;
        }
    }

    // Scan live room data for a new target
    mem.targetId = findBestTarget(creep);
    // Attack happens next tick once the id is persisted in memory
}

function findBestTarget(creep: Creep): string | null {
    // Score rooms are higher priority hunting grounds
    const hotRooms = new Set(
        Object.values(Memory.scoreCache ?? {}).map(e => e.pos.roomName)
    );

    let bestId: string | null = null;
    let bestPriority = -1;

    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        const hostiles = room.find(FIND_HOSTILE_CREEPS) as Creep[];
        for (const hostile of hostiles) {
            // Prioritise hostiles in rooms with active Scores
            const priority = hotRooms.has(roomName) ? 2 : 1;
            if (priority > bestPriority) {
                bestPriority = priority;
                bestId = hostile.id as unknown as string;
            }
        }
    }

    return bestId;
}
