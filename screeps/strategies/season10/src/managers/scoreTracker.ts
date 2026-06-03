// Scans visible rooms for Score objects and maintains two caches:
//   Memory.scoreCache  — per-score entries with decay expiry (used by collectors)
//   Memory.scoreMap    — per-room aggregate (used by scouts/logistics)
// Scanning is throttled to every 10 ticks to stay within CPU budget.

function shouldScanThisTick(): boolean {
    return Game.time % 10 === 0;
}

export function trackScores(room: Room): void {
    if (!Memory.scoreCache) Memory.scoreCache = {};
    if (!Memory.scoreMap)   Memory.scoreMap   = {};
    if (!Memory.knownRooms) Memory.knownRooms  = [];

    if (!Memory.knownRooms.includes(room.name)) {
        Memory.knownRooms.push(room.name);
    }

    if (!shouldScanThisTick()) return;

    // Purge expired cache entries
    for (const id in Memory.scoreCache) {
        if (Memory.scoreCache[id].expiresAt <= Game.time) {
            delete Memory.scoreCache[id];
        }
    }

    // Scan room for current scores
    const scores = (room.find as Function)(FIND_SCORES) as Score[];
    const totalScore = scores.reduce((sum, s) => sum + s.score, 0);

    for (const score of scores) {
        Memory.scoreCache[score.id as unknown as string] = {
            pos: { x: score.pos.x, y: score.pos.y, roomName: room.name },
            value: score.score,
            expiresAt: Game.time + score.ticksToDecay,
        };
    }

    if (totalScore > 0) {
        Memory.scoreMap[room.name] = { score: totalScore, tick: Game.time };
    } else if (Memory.scoreMap[room.name]) {
        delete Memory.scoreMap[room.name];
    }
}
