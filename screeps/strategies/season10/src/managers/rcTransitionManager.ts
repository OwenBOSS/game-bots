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
    console.log(`[${room.name}] RC${level} reached at tick ${Game.time}`);
    switch (level) {
        case 1:
            room.memory.spawnScoutNext = true;
            console.log(`[${room.name}] RC1 — queuing scout`);
            break;

        case 2:
            if (!Memory.scoreCache) Memory.scoreCache = {};
            console.log(`[${room.name}] RC2 — score cache enabled`);
            break;

        case 3:
            room.memory.collectorQuota = 3;
            console.log(`[${room.name}] RC3 — collector quota → 3`);
            break;

        case 4:
            room.memory.dynamicCollectorQuota = true;
            console.log(`[${room.name}] RC4 — dynamic collector quota enabled`);
            break;

        case 8:
            room.memory.observerEnabled = true;
            const exits = Game.map.describeExits(room.name);
            if (exits) {
                const adjacent = Object.values(exits).filter((r): r is string => !!r);
                Memory.observerTargets = [...new Set([...(Memory.observerTargets ?? []), ...adjacent])];
                console.log(`[${room.name}] RC8 — observer enabled, targets: ${adjacent.join(', ')}`);
            }
            break;
    }
}
