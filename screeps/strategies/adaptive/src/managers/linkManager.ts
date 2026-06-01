// Manages StructureLink energy transfers.
// Pattern: source links (near each energy source) drain into a hub link (near spawn).
// Haulers then withdraw from the hub link, eliminating long hauler trips.
// 3% energy loss per transfer is acceptable — creep travel time is far more expensive.

export function manageLinkTransfers(room: Room): void {
    if ((room.controller?.level ?? 0) < 5) return;

    const links = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_LINK,
    }) as StructureLink[];

    if (links.length < 2) return;

    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return;

    // Hub = link closest to spawn; all others are source links
    const hub = links.reduce((a, b) =>
        a.pos.getRangeTo(spawn) <= b.pos.getRangeTo(spawn) ? a : b
    );
    const sourceLinks = links.filter(l => l.id !== hub.id);

    // Transfer when: source link is well-loaded AND hub has room
    const hubFree = hub.store.getFreeCapacity(RESOURCE_ENERGY) ?? 0;
    if (hubFree < 100) return; // hub is full enough

    for (const link of sourceLinks) {
        if (link.cooldown > 0) continue;
        if (link.store[RESOURCE_ENERGY] < 400) continue; // don't send half-loads
        link.transferEnergy(hub);
    }
}
