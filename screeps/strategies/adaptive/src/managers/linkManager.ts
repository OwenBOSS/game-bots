// Manages StructureLink energy transfers.
//
// Topology (set by constructionManager at RCL5+):
//   RC5–6 (2–3 links): source link(s) + controller link
//   RC7+  (4+ links):  source link(s) + controller link + hub link near spawn
//
// Source links are identified by adjacency to a FIND_SOURCES (range 2).
// Everything else is a sink — controller link (range ≤3 of controller) for
// upgraders, hub link (closest to spawn, not controller) for haulers.
//
// Energy flows: source links → controller link (primary) and hub link (secondary).
// Both sinks receive energy proportional to their free capacity.

export function manageLinkTransfers(room: Room): void {
    if ((room.controller?.level ?? 0) < 5) return;

    const links = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_LINK,
    }) as StructureLink[];

    if (links.length < 2) return;

    const spawn   = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return;
    const ctrl    = room.controller;
    const sources = room.find(FIND_SOURCES);

    // Source links: adjacent to any source (range 2). These push energy in.
    const sourceLinks = links.filter(l =>
        sources.some(src => src.pos.getRangeTo(l) <= 2)
    );

    // Sink links: everything else (not adjacent to any source).
    const sinkLinks = links.filter(l =>
        !sources.some(src => src.pos.getRangeTo(l) <= 2)
    );

    if (sourceLinks.length === 0 || sinkLinks.length === 0) return;

    // Controller link: the sink closest to the controller (upgrader energy supply).
    const ctrlLink = ctrl
        ? sinkLinks.reduce((a, b) =>
            a.pos.getRangeTo(ctrl) <= b.pos.getRangeTo(ctrl) ? a : b)
        : sinkLinks[0];

    // Hub link: the remaining sink closest to spawn (hauler energy supply).
    const otherSinks = sinkLinks.filter(l => l.id !== ctrlLink.id);
    const hubLink = otherSinks.length > 0
        ? otherSinks.reduce((a, b) =>
            a.pos.getRangeTo(spawn) <= b.pos.getRangeTo(spawn) ? a : b)
        : null;

    const sinks = [ctrlLink, hubLink].filter(Boolean) as StructureLink[];

    for (const link of sourceLinks) {
        if (link.cooldown > 0) continue;
        if (link.store[RESOURCE_ENERGY] < 400) continue;

        // Send to the sink with the most free capacity — fills both evenly.
        const bestSink = sinks.reduce<StructureLink | null>((best, sink) => {
            const free = sink.store.getFreeCapacity(RESOURCE_ENERGY) ?? 0;
            if (free < 100) return best;
            if (!best) return sink;
            return free > (best.store.getFreeCapacity(RESOURCE_ENERGY) ?? 0) ? sink : best;
        }, null);

        if (bestSink) link.transferEnergy(bestSink);
    }
}
