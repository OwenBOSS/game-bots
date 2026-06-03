// Scout role — [MOVE] only. Expands visibility by visiting unexplored adjacent rooms.
// Registers every room it enters in Memory.knownRooms for collectors to use.

export function runScout(creep: Creep): void {
    // Register current room
    if (!Memory.knownRooms) Memory.knownRooms = [];
    if (!Memory.knownRooms.includes(creep.room.name)) {
        Memory.knownRooms.push(creep.room.name);
    }

    const target = pickTarget(creep);
    if (!target) return;

    const exitDir = creep.room.findExitTo(target);
    if (exitDir === ERR_NO_PATH || exitDir === ERR_INVALID_ARGS) return;

    const exit = creep.pos.findClosestByRange(exitDir as ExitConstant);
    if (exit) creep.moveTo(exit, { reusePath: 50 });
}

function pickTarget(creep: Creep): string | null {
    const exits = Game.map.describeExits(creep.room.name);
    if (!exits) return null;

    const adjacent = Object.values(exits).filter((r): r is string => !!r);
    const known = Memory.knownRooms ?? [];

    // Prefer unexplored rooms
    const unexplored = adjacent.filter(r => !known.includes(r));
    if (unexplored.length > 0) return unexplored[0];

    // All adjacent known — revisit the one with the oldest scoreMap scan
    const scoreMap = Memory.scoreMap ?? {};
    const withData = adjacent
        .filter(r => scoreMap[r] !== undefined)
        .sort((a, b) => (scoreMap[a]?.tick ?? 0) - (scoreMap[b]?.tick ?? 0));

    if (withData.length > 0) return withData[0];

    // Fallback: just pick first adjacent
    return adjacent[0] ?? null;
}
