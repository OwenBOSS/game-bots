// Places and re-evaluates construction sites whenever RCL increases.
// Order matters: containers unlock the energy flow that lets everything else scale.

export function manageConstruction(room: Room): void {
    const rcl = room.controller?.level ?? 0;

    if (Memory.roadsPlanned && Memory.lastRCL === rcl) return;

    Memory.roadsPlanned = true;
    Memory.lastRCL = rcl;

    placeContainers(room);          // RCL 0  — highest ROI
    placeKeyRoads(room);            // RCL 0  — harvester efficiency
    if (rcl >= 2) placeExtensions(room, rcl);   // RCL 2+ — spawn capacity
    if (rcl >= 2) placeRamparts(room);           // RCL 2+ — protect key structures
    if (rcl >= 3) placeTowers(room, rcl);        // RCL 3+ — passive defense

    console.log(`[adaptive] Construction planned at RCL ${rcl}`);
}

// ─── Containers ──────────────────────────────────────────────────────────────
// One container adjacent to each source (harvesters park and dump in place),
// one near the controller (upgraders withdraw from it rather than walking to spawn).

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

        // Try each adjacent tile until one accepts the site
        let placed = false;
        for (let dx = -1; dx <= 1 && !placed; dx++) {
            for (let dy = -1; dy <= 1 && !placed; dy++) {
                if (dx === 0 && dy === 0) continue;
                const result = room.createConstructionSite(pos.x + dx, pos.y + dy, STRUCTURE_CONTAINER);
                if (result === OK) {
                    placed = true;
                } else if (result !== ERR_INVALID_TARGET && result !== ERR_FULL) {
                    console.log(`[adaptive] Container placement failed at (${pos.x + dx},${pos.y + dy}): ${result}`);
                }
            }
        }
        if (!placed) {
            console.log(`[adaptive] Could not place container near (${pos.x},${pos.y})`);
        }
    }
}

// ─── Roads ───────────────────────────────────────────────────────────────────

function placeKeyRoads(room: Room): void {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return;

    for (const source of room.find(FIND_SOURCES)) {
        placeRoad(room, spawn.pos, source.pos);
    }
    if (room.controller) {
        placeRoad(room, spawn.pos, room.controller.pos);
    }
}

function placeRoad(room: Room, from: RoomPosition, to: RoomPosition): void {
    const path = room.findPath(from, to, { ignoreCreeps: true, swampCost: 1, plainCost: 2 });
    for (const step of path) {
        room.createConstructionSite(step.x, step.y, STRUCTURE_ROAD);
    }
}

// ─── Extensions ──────────────────────────────────────────────────────────────
// Spiral outward from spawn. More extensions = larger spawn budget = better creeps.

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
                const x = spawn.pos.x + dx;
                const y = spawn.pos.y + dy;
                if (x < 2 || x > 47 || y < 2 || y > 47) continue;
                if (room.createConstructionSite(x, y, STRUCTURE_EXTENSION) === OK) {
                    if (++placed >= needed) break outer;
                }
            }
        }
    }
}

// ─── Towers ──────────────────────────────────────────────────────────────────
// Place near spawn so they cover the base. One at RCL 3, scaling up with RCL.

function placeTowers(room: Room, rcl: number): void {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return;

    const built   = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER }).length;
    const pending = room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_TOWER }).length;
    const allowed = (CONTROLLER_STRUCTURES[STRUCTURE_TOWER] as Record<number, number>)[rcl] ?? 0;
    if (built + pending >= allowed) return;

    // Expand outward from spawn until we find a free tile
    for (let r = 2; r <= 8; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                const x = spawn.pos.x + dx;
                const y = spawn.pos.y + dy;
                if (x < 2 || x > 47 || y < 2 || y > 47) continue;
                if (room.createConstructionSite(x, y, STRUCTURE_TOWER) === OK) return;
            }
        }
    }
}

// ─── Ramparts ────────────────────────────────────────────────────────────────
// Overlay ramparts on the spawn and any towers. Your creeps walk through owned
// ramparts freely; enemies must destroy them first (300k base hits).

function placeRamparts(room: Room): void {
    const toProtect: Structure[] = [
        ...room.find(FIND_MY_SPAWNS),
        ...room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER }),
    ];

    for (const s of toProtect) {
        const alreadyHas =
            s.pos.lookFor(LOOK_STRUCTURES).some(ls => ls.structureType === STRUCTURE_RAMPART) ||
            s.pos.lookFor(LOOK_CONSTRUCTION_SITES).some(cs => cs.structureType === STRUCTURE_RAMPART);
        if (!alreadyHas) {
            room.createConstructionSite(s.pos.x, s.pos.y, STRUCTURE_RAMPART);
        }
    }
}
