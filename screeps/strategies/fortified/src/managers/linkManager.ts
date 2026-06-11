// Each tick: drain source-adjacent links into the controller-adjacent link.
// Upgraders withdraw from the controller link directly (see upgrader role).
export function manageLinkTransfers(room: Room): void {
    const links = room.find(FIND_MY_STRUCTURES, {
        filter: (s: AnyStructure) => s.structureType === STRUCTURE_LINK,
    }) as StructureLink[];

    if (links.length < 2) return;

    const controller = room.controller;
    if (!controller) return;

    const sources = room.find(FIND_SOURCES);

    const sourceLinks = links.filter(l =>
        sources.some(s => l.pos.getRangeTo(s) <= 2),
    );
    const controllerLinks = links.filter(l => l.pos.getRangeTo(controller) <= 3);

    for (const src of sourceLinks) {
        if (src.store[RESOURCE_ENERGY] === 0) continue;
        if (src.cooldown > 0) continue;

        const dest = controllerLinks.find(
            l => l.id !== src.id && l.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        );
        if (dest) src.transferEnergy(dest);
    }
}
