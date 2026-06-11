// Handles strategic structure placement. At RC5 this queues links adjacent to
// each source and adjacent to the controller.
export function manageConstruction(room: Room): void {
    const rcl = room.controller?.level ?? 0;
    if (rcl >= 5) placeLinks(room);
}

function placeLinks(room: Room): void {
    const controller = room.controller;
    if (!controller) return;

    // Source links — one per source, adjacent (range ≤ 2).
    for (const source of room.find(FIND_SOURCES)) {
        const hasLink = source.pos.findInRange(FIND_MY_STRUCTURES, 2, {
            filter: (s: AnyStructure) => s.structureType === STRUCTURE_LINK,
        }).length > 0;
        const hasSite = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 2, {
            filter: (s: ConstructionSite) => s.structureType === STRUCTURE_LINK,
        }).length > 0;
        if (!hasLink && !hasSite) {
            const pos = findBuildableNear(source.pos, room, 2);
            if (pos) room.createConstructionSite(pos.x, pos.y, STRUCTURE_LINK);
        }
    }

    // Controller link — one adjacent (range ≤ 3).
    const hasCtrlLink = controller.pos.findInRange(FIND_MY_STRUCTURES, 3, {
        filter: (s: AnyStructure) => s.structureType === STRUCTURE_LINK,
    }).length > 0;
    const hasCtrlSite = controller.pos.findInRange(FIND_CONSTRUCTION_SITES, 3, {
        filter: (s: ConstructionSite) => s.structureType === STRUCTURE_LINK,
    }).length > 0;
    if (!hasCtrlLink && !hasCtrlSite) {
        const pos = findBuildableNear(controller.pos, room, 1);
        if (pos) room.createConstructionSite(pos.x, pos.y, STRUCTURE_LINK);
    }
}

function findBuildableNear(
    center: RoomPosition,
    room: Room,
    searchRange: number,
): { x: number; y: number } | null {
    const terrain = room.getTerrain();
    for (let dx = -searchRange; dx <= searchRange; dx++) {
        for (let dy = -searchRange; dy <= searchRange; dy++) {
            const x = center.x + dx;
            const y = center.y + dy;
            if (x < 1 || x > 48 || y < 1 || y > 48) continue;
            if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
            return { x, y };
        }
    }
    return null;
}
