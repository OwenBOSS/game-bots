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
    if (level < 1) return;

    placeSourceContainers(room); // containers available at RC1
    placeSpawnRamparts(room);    // ramparts over spawn/towers — available from RC1, critical for survival
    if (level >= 2) placeExtensions(room);     // gated behind container completion internally
    if (level >= 3) placeTowerSite(room);
    if (level >= 3) placeSourceRoads(room);
    if (level >= 4) placeStorageSite(room);
}

function placeSpawnRamparts(room: Room): void {
    // Place ramparts on spawn and any towers — structures under ramparts take no damage.
    // Ramparts decay at 300 hits/tick; tower manager keeps them above RAMPART_MIN_HITS.
    const targets = [
        ...findCached<StructureSpawn>(room, FIND_MY_SPAWNS),
        ...findCached<AnyStructure>(room, FIND_MY_STRUCTURES).filter(
            (s: AnyStructure) => s.structureType === STRUCTURE_TOWER
        ),
    ];

    for (const target of targets) {
        const { x, y } = target.pos;
        const hasRampart = room.lookForAt(LOOK_STRUCTURES, x, y).some(
            (s: AnyStructure) => s.structureType === STRUCTURE_RAMPART
        );
        if (hasRampart) continue;
        const hasSite = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y).some(
            (s: ConstructionSite) => s.structureType === STRUCTURE_RAMPART
        );
        if (!hasSite) room.createConstructionSite(x, y, STRUCTURE_RAMPART);
    }
}

function placeSourceContainers(room: Room): void {
    const mem = room.memory as RoomMemory;
    const sources = findCached<Source>(room, FIND_SOURCES);
    const allStructures = findCached<AnyStructure>(room, FIND_STRUCTURES);
    const existingContainers = allStructures.filter(
        (s: AnyStructure) => s.structureType === STRUCTURE_CONTAINER
    );
    const existingSites = findCached<ConstructionSite>(room, FIND_CONSTRUCTION_SITES).filter(
        (s: ConstructionSite) => s.structureType === STRUCTURE_CONTAINER
    );

    // If already fully covered, skip (re-validate every 201 ticks in case containers decayed)
    const allCovered = sources.every((source: Source) => {
        const { x, y } = source.pos;
        return [...existingContainers, ...existingSites].some(
            (s: any) => Math.abs(s.pos.x - x) <= CONTAINER_RANGE && Math.abs(s.pos.y - y) <= CONTAINER_RANGE
        );
    });
    if (allCovered && mem.containerSitesPlaced && Game.time % 201 !== 0) return;
    if (allCovered) { mem.containerSitesPlaced = true; return; }

    // Reset flag — we have uncovered sources
    mem.containerSitesPlaced = false;

    for (const source of sources) {
        const { x, y } = source.pos;
        const alreadyHas = [...existingContainers, ...existingSites].some(
            (s: any) => Math.abs(s.pos.x - x) <= CONTAINER_RANGE && Math.abs(s.pos.y - y) <= CONTAINER_RANGE
        );
        if (alreadyHas) continue;

        // Try tiles adjacent to source, skip walls
        const candidates = [
            [x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y],
            [x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1], [x + 1, y + 1],
        ];
        for (const [cx, cy] of candidates) {
            if (cx < 1 || cx > 48 || cy < 1 || cy > 48) continue;
            if (room.lookForAt(LOOK_TERRAIN, cx, cy)[0] === 'wall') continue;
            if (room.lookForAt(LOOK_STRUCTURES, cx, cy).length > 0) continue;
            if (room.lookForAt(LOOK_CONSTRUCTION_SITES, cx, cy).length > 0) continue;
            if (room.createConstructionSite(cx, cy, STRUCTURE_CONTAINER) === OK) {
                console.log(`[season10] Container site placed near source in ${room.name}`);
                break;
            }
        }
    }
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

    // Honeycomb layout: place extensions on tiles that share spawn's (x+y) parity.
    // Opposite-parity tiles become roads, giving every extension road access.
    // Candidates are sorted by Chebyshev distance from spawn so we fill inward-out.
    const spawnParity = (spawn.pos.x + spawn.pos.y) % 2;
    const candidates: [number, number, number][] = []; // [dist, x, y]
    for (let radius = 2; radius <= 9; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue; // ring only
                const x = spawn.pos.x + dx;
                const y = spawn.pos.y + dy;
                if (x < 2 || x > 47 || y < 2 || y > 47) continue;
                if ((x + y) % 2 !== spawnParity) continue; // honeycomb parity
                candidates.push([radius, x, y]);
            }
        }
    }

    for (const [, x, y] of candidates) {
        if (room.lookForAt(LOOK_TERRAIN, x, y)[0] === 'wall') continue;
        if (room.lookForAt(LOOK_STRUCTURES, x, y).length > 0) continue;
        if (room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y).length > 0) continue;
        if (room.createConstructionSite(x, y, STRUCTURE_EXTENSION) === OK) return;
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

    if (room.createConstructionSite(25, 23, STRUCTURE_TOWER) === OK) {
        mem.towerSitePlaced = true;
        console.log(`[season10] Tower site placed in ${room.name}`);
    }
}

function placeStorageSite(room: Room): void {
    const mem = room.memory as RoomMemory;
    if (mem.storageSitePlaced) return;
    if (room.storage) { mem.storageSitePlaced = true; return; }

    const hasSite = findCached<ConstructionSite>(room, FIND_CONSTRUCTION_SITES).some(
        (s: ConstructionSite) => s.structureType === STRUCTURE_STORAGE
    );
    if (hasSite) return;

    if (room.createConstructionSite(25, 25, STRUCTURE_STORAGE) === OK) {
        mem.storageSitePlaced = true;
        console.log(`[season10] Storage site placed in ${room.name}`);
    }
}
