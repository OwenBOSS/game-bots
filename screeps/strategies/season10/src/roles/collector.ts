// Collector role — moves to Score objects and steps on them for automatic collection.
// Targets are tracked by ID. For non-visible rooms, falls back to the cached position
// from Memory.scoreCache so the creep can navigate cross-room without line-of-sight.

import { moveTo } from '../utils/trafficManager';

export function runCollector(creep: Creep): void {
    const mem = creep.memory as any;

    // Validate existing target: clear only when not visible AND cache entry is gone/expired
    if (mem.targetScoreId) {
        const live    = Game.getObjectById(mem.targetScoreId as Id<any>);
        const cached  = Memory.scoreCache?.[mem.targetScoreId];
        if (!live && (!cached || cached.expiresAt <= Game.time)) {
            mem.targetScoreId = null;
        }
    }

    // Assign new target
    if (!mem.targetScoreId) {
        mem.targetScoreId = findBestScore(creep);
    }

    if (mem.targetScoreId) {
        // Live object available (room is visible)
        const live = Game.getObjectById(mem.targetScoreId as Id<any>) as any;
        if (live) {
            moveTo(creep, live.pos, { reusePath: 20 });
            return;
        }
        // Non-visible room: navigate to cached position
        const cached = Memory.scoreCache?.[mem.targetScoreId];
        if (cached) {
            const pos = new RoomPosition(cached.pos.x, cached.pos.y, cached.pos.roomName);
            moveTo(creep, pos, { reusePath: 20 });
            return;
        }
        mem.targetScoreId = null;
    }

    // No known score: patrol toward home room
    const home = mem.homeRoom ?? creep.room.name;
    moveTo(creep, new RoomPosition(25, 25, home), { reusePath: 50 });
}

export function findBestScore(creep: Creep): string | null {
    if (typeof FIND_SCORES === 'undefined') return null;

    let bestId: string | null = null;
    let bestValue = -1;

    // Search currently visible rooms
    for (const roomName in Game.rooms) {
        const room   = Game.rooms[roomName];
        const scores = (room.find as Function)(FIND_SCORES) as Score[];
        for (const score of scores) {
            const dist = Game.map.getRoomLinearDistance(creep.room.name, roomName);
            if (dist * 2 > score.ticksToDecay * 0.8) continue;
            const urgency = score.ticksToDecay < 500 ? 2 : 1;
            const value   = (score.score * urgency) / (dist + 1);
            if (value > bestValue) { bestValue = value; bestId = score.id as unknown as string; }
        }
    }

    // Also search cached entries from non-visible rooms
    if (Memory.scoreCache) {
        for (const id in Memory.scoreCache) {
            const entry = Memory.scoreCache[id];
            if (entry.expiresAt <= Game.time) continue;
            if (entry.pos.roomName in Game.rooms) continue; // already scanned above
            const dist      = Game.map.getRoomLinearDistance(creep.room.name, entry.pos.roomName);
            const ticksLeft = entry.expiresAt - Game.time;
            if (dist * 2 > ticksLeft * 0.8) continue;
            const urgency = ticksLeft < 500 ? 2 : 1;
            const value   = (entry.value * urgency) / (dist + 1);
            if (value > bestValue) { bestValue = value; bestId = id; }
        }
    }

    return bestId;
}
