// Collector role — moves to Score objects and steps on them for automatic collection.
// Uses targetScoreId in memory for cross-room tracking via Game.getObjectById.

export function runCollector(creep: Creep): void {
    const mem = creep.memory as any;

    // Validate existing target: clear if expired or collected
    if (mem.targetScoreId) {
        const target = Game.getObjectById(mem.targetScoreId as Id<any>);
        if (!target) mem.targetScoreId = null;
    }

    // Assign new target
    if (!mem.targetScoreId) {
        mem.targetScoreId = findBestScore(creep);
    }

    if (mem.targetScoreId) {
        const target = Game.getObjectById(mem.targetScoreId as Id<any>) as any;
        if (target) {
            creep.moveTo(target.pos, { reusePath: 20 });
            return;
        }
        mem.targetScoreId = null;
    }

    // No known score: patrol toward home room
    const home = mem.homeRoom ?? creep.room.name;
    creep.moveTo(new RoomPosition(25, 25, home), { reusePath: 50 });
}

export function findBestScore(creep: Creep): string | null {
    let bestId: string | null = null;
    let bestValue = -1;

    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        const scores = (room.find as Function)(FIND_SCORES) as Score[];
        for (const score of scores) {
            const dist = Game.map.getRoomLinearDistance(creep.room.name, roomName);

            // Skip scores we cannot reach in time (travel estimate: dist * 2 ticks)
            if (dist * 2 > score.ticksToDecay * 0.8) continue;

            const urgency = score.ticksToDecay < 500 ? 2 : 1;
            const value   = (score.score * urgency) / (dist + 1);

            if (value > bestValue) {
                bestValue = value;
                bestId    = score.id as unknown as string;
            }
        }
    }

    return bestId;
}
