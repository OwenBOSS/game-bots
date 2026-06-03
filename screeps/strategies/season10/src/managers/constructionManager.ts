// Construction manager — places structure sites when available.
// Build order prioritizes the energy chain:
//   RC2: containers first (energy chain), then extensions once all containers exist
//   RC3: tower, roads (spawn→sources, spawn→controller), more extensions
//   RC4: storage, more extensions

import { findCached } from '../utils/tickCache';

const CONTAINER_RANGE = 1;

const MAX_EXTENSIONS_BY_LEVEL: Record<number, number> = {
    2: 5, 3: 10, 4: 20, 5: 30, 6: 40, 7: 50, 8: 60,
};

export function manageConstruction(room: Room): void {
    const level = room.controller?.level ?? 0;
    if (level < 2) return;

    if (level >= 2) placeSourceContainers(room);
    if (level >= 2) placeExtensions(room);     // gated behind container completion internally
    if (level >= 3) placeTowerSite(room);
    if (level >= 3) placeSourceRoads(room);
    if (level >= 4) placeStorageSite(room);
}

function placeSourceContainers(room: Room): void {
    const mem = room.memory as RoomMemory;
    // Re-check every 201 ticks — containers can decay and need to be re-placed
    if (mem.containerSitesPlaced && Game.time % 201 !== 0) return;

    const sources = findCached<Source>(room, FIND_SOURCES);
    const allStructures = findCached<AnyStructure>(room, FIND_STRUCTURES);
    const existingContainers = allStructures.filter(
        (s: AnyStructure) => s.structureType === STRUCTURE_CONTAINER
    );
    const existingSites = findCached<ConstructionSite>(room, FIND_CONSTRUCTION_SITES).filter(
        (s: ConstructionSite) => s.structureType === STRUCTURE_CONTAINER
    );

    let placed = false;
    let allCovered = true;
    for (const source of sources) {
        const { x, y } = source.pos;
        const alreadyHas = [...existingContainers, ...existingSites].some(
            (s: any) => Math.abs(s.pos.x - x) <= CONTAINER_RANGE && Math.abs(s.pos.y - y) <= CONTAINER_RANGE
        );
        if (alreadyHas) continue;

        allCovered = false;
        const result = room.createConstructionSite(x, Math.max(0, y - 1), STRUCTURE_CONTAINER);
        if (result === OK) placed = true;
    }

    if (placed || allCovered) mem.containerSitesPlaced = true;
}

function placeExtensions(room: Room): void {
    const level = room.controller?.level ?? 0;
    const maxExt = MAX_EXTENSIONS_BY_LEVEL[level] ?? 0;
    if (maxExt === 0) return;

    // Gate on containers — extensions near spawn get built before far containers,
    // delaying the energy chain. Don't place until every source has a container.
    const sources = findCached<Source>(room, FIND_SOURCES);
    const allStructures = findCached<AnyStructure>(room, FIND_STRUCTURES);
    const containers = allStructures.filter((s: AnyStructure) => s.structureType === STRUCTURE_CONTAINER);
    const allContainersCovered = sources.every((src: Source) =>
        containers.some((c: AnyStructure) =>
            Math.abs(c.pos.x - src.pos.x) <= CONTAINER_RANGE && Math.abs(c.pos.y - src.pos.y) <= CONTAINER_RANGE
        )
    );
    if (!allContainersCovered) return;

    const existingCount = allStructures.filter(
        (s: AnyStructure) => s.structureType === STRUCTURE_EXTENSION
    ).length;
    const siteCount = findCached<ConstructionSite>(room, FIND_CONSTRUCTION_SITES).filter(
        (s: ConstructionSite) => s.structureType === STRUCTURE_EXTENSION
    ).length;

    if (existingCount + siteCount >= maxExt) return;

    const spawns = findCached<StructureSpawn>(room, FIND_MY_SPAWNS);
    const spawn = spawns[0] as StructureSpawn | undefined;
    if (!spawn) return;

    // Expand outward from spawn in rings to find a free non-wall tile
    for (let radius = 2; radius <= 8; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
                const x = spawn.pos.x + dx;
                const y = spawn.pos.y + dy;
                if (x < 2 || x > 47 || y < 2 || y > 47) continue;
                if (room.lookForAt(LOOK_TERRAIN, x, y)[0] === 'wall') continue;
                if (room.lookForAt(LOOK_STRUCTURES, x, y).length > 0) continue;
                if (room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y).length > 0) continue;
                if (room.createConstructionSite(x, y, STRUCTURE_EXTENSION) === OK) return;
            }
        }
    }
}

function placeSourceRoads(room: Room): void {
    const mem = room.memory as RoomMemory;
    if (mem.roadSitesPlaced) return;

    const spawns = findCached<StructureSpawn>(room, FIND_MY_SPAWNS);
    const spawn = spawns[0] as StructureSpawn | undefined;
    if (!spawn) return;

    const sources = findCached<Source>(room, FIND_SOURCES);
    const ctrl = room.controller;
    const destinations: RoomPosition[] = [
        ...sources.map((s: Source) => s.pos),
        ...(ctrl ? [ctrl.pos] : []),
    ];

    for (const dest of destinations) {
        const path = room.findPath(spawn.pos, dest, { ignoreCreeps: true, swampCost: 2 });
        for (const step of path) {
            const hasRoad = room.lookForAt(LOOK_STRUCTURES, step.x, step.y).some(
                (s: AnyStructure) => s.structureType === STRUCTURE_ROAD
            );
            if (hasRoad) continue;
            const hasSite = room.lookForAt(LOOK_CONSTRUCTION_SITES, step.x, step.y).some(
                (s: ConstructionSite) => s.structureType === STRUCTURE_ROAD
            );
            if (!hasSite) room.createConstructionSite(step.x, step.y, STRUCTURE_ROAD);
        }
    }

    mem.roadSitesPlaced = true;
}

function placeTowerSite(room: Room): void {
    const mem = room.memory as RoomMemory;
    if (mem.towerSitePlaced) return;

    const myStructures = findCached<AnyStructure>(room, FIND_MY_STRUCTURES);
    if (myStructures.some((s: AnyStructure) => s.structureType === STRUCTURE_TOWER)) {
        mem.towerSitePlaced = true;
        return;
    }

    const hasSite = findCached<ConstructionSite>(room, FIND_CONSTRUCTION_SITES).some(
        (s: ConstructionSite) => s.structureType === STRUCTURE_TOWER
    );
    if (hasSite) return;

    if (room.createConstructionSite(25, 23, STRUCTURE_TOWER) === OK) mem.towerSitePlaced = true;
}

function placeStorageSite(room: Room): void {
    const mem = room.memory as RoomMemory;
    if (mem.storageSitePlaced) return;
    if (room.storage) { mem.storageSitePlaced = true; return; }

    const hasSite = findCached<ConstructionSite>(room, FIND_CONSTRUCTION_SITES).some(
        (s: ConstructionSite) => s.structureType === STRUCTURE_STORAGE
    );
    if (hasSite) return;

    if (room.createConstructionSite(25, 25, STRUCTURE_STORAGE) === OK) mem.storageSitePlaced = true;
}
