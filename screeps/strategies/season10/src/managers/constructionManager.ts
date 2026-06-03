// Construction manager — places structure sites once per RC level-up.
// Uses memory flags to avoid re-placing on subsequent ticks.
// RC2: container next to each source
// RC3: one tower
// RC4: one storage

const CONTAINER_RANGE = 1; // place container this many tiles from source

export function manageConstruction(room: Room): void {
    const level = room.controller?.level ?? 0;
    if (level < 2) return;

    if (level >= 2) placeSourceContainers(room);
    if (level >= 3) placeTowerSite(room);
    if (level >= 4) placeStorageSite(room);
}

function placeSourceContainers(room: Room): void {
    const mem = room.memory as RoomMemory & { containerSitesPlaced?: boolean };
    if (mem.containerSitesPlaced) return;

    const sources = room.find(FIND_SOURCES);
    const existingContainers = room.find(FIND_STRUCTURES).filter(
        (s: AnyStructure) => s.structureType === STRUCTURE_CONTAINER
    );
    const existingSites = room.find(FIND_CONSTRUCTION_SITES).filter(
        (s: ConstructionSite) => s.structureType === STRUCTURE_CONTAINER
    );

    let placed = false;
    for (const source of sources as Source[]) {
        const { x, y } = source.pos;
        // Check if a container or site already exists adjacent
        const alreadyHas = [...existingContainers, ...existingSites].some(
            (s: any) => Math.abs(s.pos.x - x) <= CONTAINER_RANGE && Math.abs(s.pos.y - y) <= CONTAINER_RANGE
        );
        if (alreadyHas) continue;

        // Place container one tile above the source (simple heuristic)
        const result = room.createConstructionSite(x, Math.max(0, y - 1), STRUCTURE_CONTAINER);
        if (result === OK) placed = true;
    }

    if (placed) mem.containerSitesPlaced = true;
}

function placeTowerSite(room: Room): void {
    const mem = room.memory as RoomMemory & { towerSitePlaced?: boolean };
    if (mem.towerSitePlaced) return;

    const hasTower = room.find(FIND_MY_STRUCTURES).some(
        (s: AnyStructure) => s.structureType === STRUCTURE_TOWER
    );
    if (hasTower) { mem.towerSitePlaced = true; return; }

    const hasSite = room.find(FIND_CONSTRUCTION_SITES).some(
        (s: ConstructionSite) => s.structureType === STRUCTURE_TOWER
    );
    if (hasSite) return;

    // Place tower near room center
    const result = room.createConstructionSite(25, 23, STRUCTURE_TOWER);
    if (result === OK) mem.towerSitePlaced = true;
}

function placeStorageSite(room: Room): void {
    const mem = room.memory as RoomMemory & { storageSitePlaced?: boolean };
    if (mem.storageSitePlaced) return;
    if (room.storage) { mem.storageSitePlaced = true; return; }

    const hasSite = room.find(FIND_CONSTRUCTION_SITES).some(
        (s: ConstructionSite) => s.structureType === STRUCTURE_STORAGE
    );
    if (hasSite) return;

    const result = room.createConstructionSite(25, 25, STRUCTURE_STORAGE);
    if (result === OK) mem.storageSitePlaced = true;
}
