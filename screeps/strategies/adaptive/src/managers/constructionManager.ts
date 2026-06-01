const MAX_ROAD_SITES = 10;

export function manageConstruction(room: Room): void {
    const rcl = room.controller?.level ?? 0;

    // For newly claimed rooms with no spawn, place one first
    if (room.find(FIND_MY_SPAWNS).length === 0) {
        placeSpawnIfMissing(room);
        return;
    }

    if (Game.time % 5 === 0) pruneExcessRoadSites(room);
    maintainRoadQueue(room);

    if (Memory.roadsPlanned && Memory.lastRCL === rcl) return;
    Memory.roadsPlanned = true;
    Memory.lastRCL = rcl;

    placeContainers(room);
    if (rcl >= 2) placeExtensions(room, rcl);
    if (rcl >= 2) placeRamparts(room);
    if (rcl >= 3) placeTowers(room, rcl);
    if (rcl >= 5) placeLinks(room, rcl);
    if (rcl >= 6) placeTerminal(room);

    console.log(`[adaptive] Construction planned at RCL ${rcl}`);
}

// ─── New room bootstrap ───────────────────────────────────────────────────────

function placeSpawnIfMissing(room: Room): void {
    if (room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_SPAWN }).length > 0) return;
    for (let r = 0; r <= 12; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                const x = 25 + dx, y = 25 + dy;
                if (x < 2 || x > 47 || y < 2 || y > 47) continue;
                if (room.createConstructionSite(x, y, STRUCTURE_SPAWN) === OK) {
                    console.log(`[adaptive] Spawn site placed in ${room.name} at (${x},${y})`);
                    return;
                }
            }
        }
    }
}

// ─── Road pruning & drip-feed ────────────────────────────────────────────────

function pruneExcessRoadSites(room: Room): void {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return;
    const roadSites = room.find(FIND_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_ROAD });
    if (roadSites.length <= MAX_ROAD_SITES) return;
    roadSites.sort((a, b) => a.pos.getRangeTo(spawn) - b.pos.getRangeTo(spawn));
    const toRemove = roadSites.slice(MAX_ROAD_SITES);
    for (const site of toRemove) site.remove();
    console.log(`[adaptive] Road sites pruned: kept ${MAX_ROAD_SITES}, removed ${toRemove.length}`);
}

function maintainRoadQueue(room: Room): void {
    const pending = room.find(FIND_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_ROAD }).length;
    if (pending >= MAX_ROAD_SITES) return;
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return;
    let budget = MAX_ROAD_SITES - pending;
    for (const source of room.find(FIND_SOURCES)) {
        if (budget <= 0) break;
        budget -= placeRoadSection(room, spawn.pos, source.pos, budget);
    }
    if (budget > 0 && room.controller) {
        placeRoadSection(room, spawn.pos, room.controller.pos, budget);
    }
}

function placeRoadSection(room: Room, from: RoomPosition, to: RoomPosition, limit: number): number {
    const path = room.findPath(from, to, { ignoreCreeps: true, swampCost: 1, plainCost: 2, range: 1 });
    let placed = 0;
    for (const step of path) {
        if (placed >= limit) break;
        if (room.createConstructionSite(step.x, step.y, STRUCTURE_ROAD) === OK) placed++;
    }
    return placed;
}

// ─── Containers ──────────────────────────────────────────────────────────────

function placeContainers(room: Room): void {
    const targets: RoomPosition[] = [
        ...room.find(FIND_SOURCES).map(s => s.pos),
        ...(room.controller ? [room.controller.pos] : []),
    ];
    for (const pos of targets) {
        const hasNearby =
            pos.findInRange(FIND_STRUCTURES, 1, { filter: s => s.structureType === STRUCTURE_CONTAINER }).length > 0 ||
            pos.findInRange(FIND_CONSTRUCTION_SITES, 1, { filter: s => s.structureType === STRUCTURE_CONTAINER }).length > 0;
        if (hasNearby) continue;
        let placed = false;
        for (let dx = -1; dx <= 1 && !placed; dx++) {
            for (let dy = -1; dy <= 1 && !placed; dy++) {
                if (dx === 0 && dy === 0) continue;
                const result = room.createConstructionSite(pos.x + dx, pos.y + dy, STRUCTURE_CONTAINER);
                if (result === OK) { placed = true; }
                else if (result !== ERR_INVALID_TARGET && result !== ERR_FULL) {
                    console.log(`[adaptive] Container placement err ${result} at (${pos.x + dx},${pos.y + dy})`);
                }
            }
        }
        if (!placed) console.log(`[adaptive] Could not place container near (${pos.x},${pos.y})`);
    }
}

// ─── Extensions ──────────────────────────────────────────────────────────────

function placeExtensions(room: Room, rcl: number): void {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return;
    const built   = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_EXTENSION }).length;
    const pending = room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_EXTENSION }).length;
    const allowed = (CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION] as Record<number, number>)[rcl] ?? 0;
    const needed  = allowed - built - pending;
    if (needed <= 0) return;
    let placed = 0;
    outer:
    for (let r = 2; r <= 6; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                const x = spawn.pos.x + dx, y = spawn.pos.y + dy;
                if (x < 2 || x > 47 || y < 2 || y > 47) continue;
                if (room.createConstructionSite(x, y, STRUCTURE_EXTENSION) === OK) {
                    if (++placed >= needed) break outer;
                }
            }
        }
    }
}

// ─── Towers ──────────────────────────────────────────────────────────────────

function placeTowers(room: Room, rcl: number): void {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return;
    const built   = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER }).length;
    const pending = room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_TOWER }).length;
    const allowed = (CONTROLLER_STRUCTURES[STRUCTURE_TOWER] as Record<number, number>)[rcl] ?? 0;
    if (built + pending >= allowed) return;
    for (let r = 2; r <= 8; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                const x = spawn.pos.x + dx, y = spawn.pos.y + dy;
                if (x < 2 || x > 47 || y < 2 || y > 47) continue;
                if (room.createConstructionSite(x, y, STRUCTURE_TOWER) === OK) return;
            }
        }
    }
}

// ─── Links (RCL 5+) ──────────────────────────────────────────────────────────
// Hub link near spawn + one link per source.
// Source links → hub link via linkManager.ts (instant transfer, 3% loss).
// Haulers withdraw from hub link instead of walking to source containers.

function placeLinks(room: Room, rcl: number): void {
    const built   = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_LINK }).length;
    const pending = room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_LINK }).length;
    const allowed = (CONTROLLER_STRUCTURES[STRUCTURE_LINK] as Record<number, number>)[rcl] ?? 0;
    let remaining = allowed - built - pending;
    if (remaining <= 0) return;

    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return;

    // Hub link near spawn
    const spawnLinkNearby =
        spawn.pos.findInRange(FIND_MY_STRUCTURES, 4, { filter: s => s.structureType === STRUCTURE_LINK }).length > 0 ||
        spawn.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 4, { filter: s => s.structureType === STRUCTURE_LINK }).length > 0;

    if (!spawnLinkNearby && remaining > 0) {
        outer:
        for (let r = 2; r <= 5; r++) {
            for (let dx = -r; dx <= r; dx++) {
                for (let dy = -r; dy <= r; dy++) {
                    if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                    if (room.createConstructionSite(spawn.pos.x + dx, spawn.pos.y + dy, STRUCTURE_LINK) === OK) {
                        remaining--;
                        break outer;
                    }
                }
            }
        }
    }

    // Source links
    for (const source of room.find(FIND_SOURCES)) {
        if (remaining <= 0) break;
        const hasNearby =
            source.pos.findInRange(FIND_MY_STRUCTURES, 2, { filter: s => s.structureType === STRUCTURE_LINK }).length > 0 ||
            source.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 2, { filter: s => s.structureType === STRUCTURE_LINK }).length > 0;
        if (hasNearby) continue;

        let placed = false;
        for (let dx = -2; dx <= 2 && !placed; dx++) {
            for (let dy = -2; dy <= 2 && !placed; dy++) {
                if (dx === 0 && dy === 0) continue;
                if (room.createConstructionSite(source.pos.x + dx, source.pos.y + dy, STRUCTURE_LINK) === OK) {
                    placed = true;
                    remaining--;
                }
            }
        }
    }
}

// ─── Terminal (RCL 6+) ───────────────────────────────────────────────────────

function placeTerminal(room: Room): void {
    if (room.terminal) return;
    if (room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_TERMINAL }).length > 0) return;

    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return;

    for (let r = 4; r <= 12; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                const x = spawn.pos.x + dx, y = spawn.pos.y + dy;
                if (x < 2 || x > 47 || y < 2 || y > 47) continue;
                if (room.createConstructionSite(x, y, STRUCTURE_TERMINAL) === OK) return;
            }
        }
    }
}

// ─── Ramparts ────────────────────────────────────────────────────────────────

function placeRamparts(room: Room): void {
    const toProtect: Structure[] = [
        ...room.find(FIND_MY_SPAWNS),
        ...room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER }),
    ];
    for (const s of toProtect) {
        const has =
            s.pos.lookFor(LOOK_STRUCTURES).some(ls => ls.structureType === STRUCTURE_RAMPART) ||
            s.pos.lookFor(LOOK_CONSTRUCTION_SITES).some(cs => cs.structureType === STRUCTURE_RAMPART);
        if (!has) room.createConstructionSite(s.pos.x, s.pos.y, STRUCTURE_RAMPART);
    }
}
