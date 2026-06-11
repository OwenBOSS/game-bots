// Bootstrap creep: [MOVE, WORK, CARRY]
// Phase 1 of the fortified strategy. Parks next to a source, builds nearby
// extensions + ramparts, then mines and dumps in-place indefinitely.
export function runBootstrap(creep: Creep): void {
    const phase = (creep.memory.bootstrapPhase ?? 'seek') as BootstrapPhase;
    switch (phase) {
        case 'seek':  doSeek(creep);  break;
        case 'build': doBuild(creep); break;
        case 'mine':  doMine(creep);  break;
    }
}

function doSeek(creep: Creep): void {
    const source = creep.pos.findClosestByRange(FIND_SOURCES);
    if (!source) return;
    if (creep.pos.getRangeTo(source) <= 1) {
        creep.memory.bootstrapPhase = 'build';
        doBuild(creep);
        return;
    }
    creep.moveTo(source, { reusePath: 10 });
}

function doBuild(creep: Creep): void {
    const source = creep.pos.findClosestByRange(FIND_SOURCES);
    if (!source) return;

    if (creep.pos.getRangeTo(source) > 1) {
        creep.moveTo(source, { reusePath: 10 });
        return;
    }

    // Place up to 2 extension CSes adjacent to self (but ≥ range 2 from source)
    const nearExt = creep.pos.findInRange(FIND_MY_STRUCTURES, 1, {
        filter: (s: AnyStructure) => s.structureType === STRUCTURE_EXTENSION,
    });
    const extSites = creep.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
        filter: (s: ConstructionSite) => s.structureType === STRUCTURE_EXTENSION,
    });
    if (nearExt.length + extSites.length < 2) {
        const pos = findAdjacentBuildable(creep, source);
        if (pos) creep.room.createConstructionSite(pos.x, pos.y, STRUCTURE_EXTENSION);
    }

    // Place rampart CS on own tile if absent
    const selfRamparts = creep.room.find(FIND_MY_STRUCTURES, {
        filter: (s: AnyStructure) =>
            s.structureType === STRUCTURE_RAMPART &&
            s.pos.x === creep.pos.x && s.pos.y === creep.pos.y,
    });
    const selfRampartSites = creep.room.find(FIND_CONSTRUCTION_SITES, {
        filter: (s: ConstructionSite) =>
            s.structureType === STRUCTURE_RAMPART &&
            s.pos.x === creep.pos.x && s.pos.y === creep.pos.y,
    });
    if (selfRamparts.length + selfRampartSites.length === 0) {
        creep.room.createConstructionSite(creep.pos.x, creep.pos.y, STRUCTURE_RAMPART);
    }

    // Build the nearest CS (harvest first if empty)
    const sites = creep.pos.findInRange(FIND_CONSTRUCTION_SITES, 3);
    if (sites.length > 0) {
        const result = creep.build(sites[0]);
        if (result === ERR_NOT_ENOUGH_RESOURCES) {
            creep.harvest(source);
        } else if (result === ERR_NOT_IN_RANGE) {
            creep.moveTo(sites[0], { reusePath: 5 });
        }
        return;
    }

    // No CSes left — transition to mine if we have at least one extension nearby
    if (nearExt.length > 0) {
        creep.memory.bootstrapPhase = 'mine';
        doMine(creep);
    }
}

function doMine(creep: Creep): void {
    const source = creep.pos.findClosestByRange(FIND_SOURCES_ACTIVE);
    if (!source) return;

    // Creep should already be parked next to source; re-approach only if dislodged.
    if (creep.pos.getRangeTo(source) > 1) {
        creep.moveTo(source, { reusePath: 10 });
        return;
    }

    if (creep.store.getFreeCapacity() > 0) {
        creep.harvest(source);
        return;
    }

    // Dump into adjacent extension or spawn — no move required.
    const target = creep.pos.findInRange(FIND_MY_STRUCTURES, 1, {
        filter: (s: AnyStructure) =>
            (s.structureType === STRUCTURE_EXTENSION || s.structureType === STRUCTURE_SPAWN) &&
            (s as StructureExtension).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    })[0] as StructureExtension | StructureSpawn | undefined;

    if (target) {
        creep.transfer(target, RESOURCE_ENERGY);
    }
}

// Finds an adjacent tile that is buildable: not a wall, range ≥ 2 from source.
// Screeps forbids structures at range 1 from sources.
function findAdjacentBuildable(
    creep: Creep,
    source: Source,
): { x: number; y: number } | null {
    const terrain = creep.room.getTerrain();
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const x = creep.pos.x + dx;
            const y = creep.pos.y + dy;
            if (x < 1 || x > 48 || y < 1 || y > 48) continue;
            if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
            if (source.pos.getRangeTo(x, y) <= 1) continue;
            return { x, y };
        }
    }
    return null;
}
