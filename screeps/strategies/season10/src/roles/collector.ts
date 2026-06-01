// Finds Score objects in the current room (or moves to a target room) and collects them.
// Season 10: Score objects are found via FIND_SCORES (10031).
// Collection: move to the Score object's position. The game may auto-collect on contact,
// or require pickup() — test both on the Season server.

export function runCollector(creep: Creep): void {
    // First look for scores in current room
    const localScores = (creep.room.find as Function)(FIND_SCORES) as ScoreObject[];

    if (localScores.length > 0) {
        // Target the highest-value score that is also closest (weighted)
        const target = bestScore(creep, localScores);
        collectScore(creep, target);
        return;
    }

    // No scores here — move to a known adjacent room that might have scores
    const nextRoom = pickNextRoom(creep);
    if (nextRoom) {
        moveToRoom(creep, nextRoom);
    } else {
        // Idle: stay near center of room, ready to react
        creep.moveTo(new RoomPosition(25, 25, creep.room.name), { reusePath: 10 });
    }
}

function collectScore(creep: Creep, target: ScoreObject): void {
    if (creep.pos.isEqualTo(target.pos)) {
        // Attempt pickup — if this API doesn't work on Season, try transfer or just being on tile
        const result = (creep as any).pickup(target);
        if (result !== OK && result !== ERR_INVALID_TARGET) {
            console.log(`[season10] pickup result: ${result}`);
        }
    } else {
        creep.moveTo(target.pos, { reusePath: 2 });
    }
}

// Value = score points / (distance + 1) — prioritize nearby high-value scores
function bestScore(creep: Creep, scores: ScoreObject[]): ScoreObject {
    return scores.reduce((best, s) => {
        const dist = creep.pos.getRangeTo(s.pos);
        const currentValue = best.score / (creep.pos.getRangeTo(best.pos) + 1);
        const candidateValue = s.score / (dist + 1);
        return candidateValue > currentValue ? s : best;
    });
}

function pickNextRoom(creep: Creep): string | null {
    const known = Memory.knownRooms ?? [];
    const exits = Game.map.describeExits(creep.room.name);
    if (!exits) return null;

    const exitRooms = Object.values(exits).filter((r): r is string => !!r);

    for (const roomName of exitRooms) {
        if (!known.includes(roomName)) {
            return roomName;
        }
    }

    // All adjacent explored — re-check the one with scores most recently
    const scoreMap = Memory.scoreMap ?? {};
    const candidates = Object.entries(scoreMap)
        .filter(([room]) => exitRooms.includes(room))
        .sort((a, b) => b[1].score - a[1].score);

    return candidates.length > 0 ? candidates[0][0] : null;
}

function moveToRoom(creep: Creep, roomName: string): void {
    const exitDir = creep.room.findExitTo(roomName);
    if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
        const exit = creep.pos.findClosestByRange(exitDir);
        if (exit) creep.moveTo(exit, { reusePath: 3 });
    }
}
