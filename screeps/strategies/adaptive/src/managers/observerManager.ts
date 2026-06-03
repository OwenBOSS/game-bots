// Observer manager (RC8+): rotates observer.observeRoom() through known rooms each
// tick to keep Memory.roomIntel fresh without spending scout creep CPU.
// Picks the least-recently-scanned room each tick, so intel ages evenly.
// Writes the same RoomIntel fields that scout.ts populates.

export function manageObserver(room: Room): void {
    if ((room.controller?.level ?? 0) < 8) return;

    const observer = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_OBSERVER,
    })[0] as StructureObserver | undefined;
    if (!observer) return;

    const known = Object.keys(Memory.roomIntel ?? {});
    if (known.length === 0) return;

    // Pick the room scanned least recently so all intel ages evenly
    const target = known.reduce((oldest, name) => {
        const a = Memory.roomIntel![oldest]?.scannedAt ?? 0;
        const b = Memory.roomIntel![name]?.scannedAt ?? 0;
        return b < a ? name : oldest;
    });

    if (observer.observeRoom(target) !== OK) return;

    // Room is visible this tick — update the intel record
    const r = Game.rooms[target];
    if (!r) return;

    const existing = Memory.roomIntel![target] ?? {} as RoomIntel;
    const hostileCreeps     = r.find(FIND_HOSTILE_CREEPS);
    const hostileStructures = r.find(FIND_HOSTILE_STRUCTURES);

    Memory.roomIntel![target] = {
        ...existing,
        scannedAt:       Game.time,
        hasController:   !!r.controller,
        controllerOwned: !!(r.controller?.owner?.username),
        sourceCount:     r.find(FIND_SOURCES).length,
        enemyCreeps:     hostileCreeps.length,
        enemySpawns:     hostileStructures.filter(s => s.structureType === STRUCTURE_SPAWN).length,
        enemyTowers:     hostileStructures.filter(s => s.structureType === STRUCTURE_TOWER).length,
        strength:        existing.strength ?? 0,
    };
}
