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

    // All adjacent known — revisit the room with the oldest (or absent) scoreMap entry.
    // Rooms never seen in scoreMap get tick=0 and are prioritised for revisit.
    const scoreMap = Memory.scoreMap ?? {};
    return adjacent.sort((a, b) =>
        (scoreMap[a]?.tick ?? 0) - (scoreMap[b]?.tick ?? 0)
    )[0] ?? null;
}
