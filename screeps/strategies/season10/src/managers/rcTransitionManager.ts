// Fires once per RC level-up. Stores the new level in room.memory.rcLevel and
// applies Season 10-specific flags that other managers read each tick.

export function checkRCTransition(room: Room): void {
    const level = room.controller?.level;
    if (level === undefined) return;
    if (room.memory.rcLevel === level) return;

    room.memory.rcLevel = level;
    onRCLevelUp(room, level);
}

function onRCLevelUp(room: Room, level: number): void {
    switch (level) {
        case 1:
            room.memory.spawnScoutNext = true;
            break;

        case 2:
            if (!Memory.scoreCache) Memory.scoreCache = {};
            break;

        case 3:
            room.memory.collectorQuota = 3;
            break;

        case 4:
            room.memory.dynamicCollectorQuota = true;
            break;

        case 8:
            room.memory.observerEnabled = true;
            // Populate observer targets from adjacent rooms
            const exits = Game.map.describeExits(room.name);
            if (exits) {
                const adjacent = Object.values(exits).filter((r): r is string => !!r);
                Memory.observerTargets = [...new Set([...(Memory.observerTargets ?? []), ...adjacent])];
            }
            break;
    }
}
