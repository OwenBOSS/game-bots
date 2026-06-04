'use strict';

// Screeps direction offset tables — indices 1–8 match the direction constants
// TOP=1, TOP_RIGHT=2, RIGHT=3, BOTTOM_RIGHT=4, BOTTOM=5, BOTTOM_LEFT=6, LEFT=7, TOP_LEFT=8
const DIR_DX = [0, 0, 1, 1, 1, 0, -1, -1, -1];
const DIR_DY = [0, -1, -1, 0, 1, 1, 1, 0, -1];
// ─── Per-tick moved tracking ─────────────────────────────────────────────────
// Used by shoveBlocker to decide whether a creep already has a move committed.
let _movedTick = -1;
const _movedSet = new Set();
function markMoved(name) {
    if (Game.time !== _movedTick) {
        _movedTick = Game.time;
        _movedSet.clear();
    }
    _movedSet.add(name);
}
function hasMoved(name) {
    return Game.time === _movedTick && _movedSet.has(name);
}
// ─── Per-tick occupancy cache ─────────────────────────────────────────────────
// Built once per room per tick; re-used by every moveTo call in that room.
let _occupancyTick = -1;
const _occupancy = {};
function getOccupied(room) {
    if (Game.time !== _occupancyTick) {
        _occupancyTick = Game.time;
        for (const k in _occupancy)
            delete _occupancy[k];
    }
    if (!_occupancy[room.name]) {
        _occupancy[room.name] = room.find(FIND_MY_CREEPS).map(c => [c.pos.x, c.pos.y]);
    }
    return _occupancy[room.name];
}
/**
 * Drop-in replacement for creep.moveTo() with traffic management.
 *
 * Two improvements over vanilla moveTo:
 *
 *  1. Soft cost matrix — occupied tiles get +3 cost added to the default terrain
 *     cost. The pathfinder prefers routes around other creeps when alternatives
 *     exist, but still routes through them in tight corridors (cost 3 is not
 *     impassable). This spreads creeps naturally without wild routing, unlike
 *     ignoreCreeps:true (which ignores others entirely and causes convergence
 *     jams) or ignoreCreeps:false default (which treats occupied tiles as hard
 *     blocks and produces bizarre detours).
 *
 *  2. Cascade shove — if a truly idle friendly creep is blocking the direct path,
 *     shove it (and its blocker, one level deep) in the same direction so it
 *     yields before the engine resolves movement. "Truly idle" means it hasn't
 *     called moveTo this tick via this wrapper.
 */
function moveTo(creep, target, opts = {}) {
    var _a;
    markMoved(creep.name);
    const result = creep.moveTo(target, {
        reusePath: 2,
        costCallback: (roomName, matrix) => {
            const room = Game.rooms[roomName];
            if (!room)
                return matrix;
            for (const [x, y] of getOccupied(room)) {
                const cur = matrix.get(x, y);
                if (cur < 255)
                    matrix.set(x, y, Math.min(254, cur + 3));
            }
            return matrix;
        },
        ...opts,
    });
    const targetPos = 'pos' in target
        ? target.pos
        : target;
    const range = (_a = opts.range) !== null && _a !== void 0 ? _a : 1;
    if (creep.room.name === targetPos.roomName && creep.pos.getRangeTo(targetPos) > range) {
        shoveBlocker(creep, targetPos);
    }
    return result;
}
function shoveBlocker(creep, targetPos) {
    const dir = creep.pos.getDirectionTo(targetPos);
    shoveInDir(creep, dir, 2);
}
// Cascade shove up to `depth` creeps deep in direction `dir`.
// Recursing first (deepest blocker first) gives the chain a chance to clear.
function shoveInDir(from, dir, depth) {
    const nx = from.pos.x + DIR_DX[dir];
    const ny = from.pos.y + DIR_DY[dir];
    if (nx < 1 || nx > 48 || ny < 1 || ny > 48)
        return;
    const blocker = new RoomPosition(nx, ny, from.room.name)
        .lookFor(LOOK_CREEPS)
        .find(c => c.my && c.name !== from.name);
    if (!blocker || blocker.fatigue > 0)
        return;
    if (hasMoved(blocker.name))
        return;
    // Clear space for the blocker before shoving it (cascade)
    if (depth > 1)
        shoveInDir(blocker, dir, depth - 1);
    blocker.move(dir);
}

// Stationary harvester: parks at an assigned source, harvests into the adjacent
// container. Falls back to mobile delivery if no container exists yet.
//
// Remote mode (creep.memory.remoteRoom set): travels to the remote room and
// mines there. Energy drops into the remote container for remote haulers to collect.
function runHarvester(creep) {
    // Remote mode: mine in a reserved room — remote haulers carry energy home
    if (creep.memory.remoteRoom) {
        runRemote(creep);
        return;
    }
    // Bootstrap: travel to homeRoom if spawned by a different room (e.g. expansion seeding).
    if (creep.memory.homeRoom && creep.room.name !== creep.memory.homeRoom) {
        moveTo(creep, new RoomPosition(25, 25, creep.memory.homeRoom), { reusePath: 20, range: 23 });
        return;
    }
    const source = getAssignedSource(creep);
    if (!source)
        return;
    const container = findNearbyContainer(source);
    if (container) {
        runStationary(creep, source, container);
    }
    else {
        runMobile(creep, source);
    }
}
// ─── Remote mode ─────────────────────────────────────────────────────────────
function runRemote(creep) {
    const target = creep.memory.remoteRoom;
    if (creep.room.name !== target) {
        moveToRoom$7(creep, target);
        return;
    }
    // Assign a source in this room (same least-contested logic)
    const source = getAssignedSource(creep);
    if (!source)
        return;
    const container = findNearbyContainer(source);
    if (container) {
        // Park on container and mine into it — remote hauler will collect
        if (!creep.pos.isEqualTo(container.pos)) {
            moveTo(creep, container.pos, { reusePath: 10 });
            return;
        }
        creep.harvest(source);
        if (creep.store.getFreeCapacity() === 0) {
            creep.transfer(container, RESOURCE_ENERGY);
        }
    }
    else {
        // No container yet — mine and drop on ground (remote hauler picks up dropped)
        if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
            moveTo(creep, source, { reusePath: 5 });
        }
    }
}
// ─── Stationary mode ─────────────────────────────────────────────────────────
function runStationary(creep, source, container) {
    if (!creep.pos.isEqualTo(container.pos)) {
        moveTo(creep, container.pos, { reusePath: 10, visualizePathStyle: undefined });
        return;
    }
    creep.harvest(source);
    if (creep.store.getFreeCapacity() === 0) {
        const link = source.pos.findInRange(FIND_MY_STRUCTURES, 2, {
            filter: s => s.structureType === STRUCTURE_LINK &&
                s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        })[0];
        if (link) {
            creep.transfer(link, RESOURCE_ENERGY);
        }
        else {
            creep.transfer(container, RESOURCE_ENERGY);
        }
    }
}
// ─── Mobile mode (no container yet) ─────────────────────────────────────────
function runMobile(creep, source) {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }
    if (creep.memory.working) {
        const target = findDeliveryTarget(creep);
        if (target) {
            if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                moveTo(creep, target, { reusePath: 5 });
            }
        }
        else {
            const controller = creep.room.controller;
            if (controller && creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
                moveTo(creep, controller, { reusePath: 5 });
            }
        }
    }
    else {
        if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
            moveTo(creep, source, { reusePath: 5 });
        }
    }
}
// ─── Helpers ─────────────────────────────────────────────────────────────────
function getAssignedSource(creep) {
    var _a, _b;
    const sources = creep.room.find(FIND_SOURCES);
    if (sources.length === 0)
        return null;
    const counts = new Map();
    for (const c of creep.room.find(FIND_MY_CREEPS)) {
        if (c.memory.role === 'harvester' && c.memory.sourceId) {
            counts.set(c.memory.sourceId, ((_a = counts.get(c.memory.sourceId)) !== null && _a !== void 0 ? _a : 0) + 1);
        }
    }
    if (creep.memory.sourceId) {
        const currentLoad = (_b = counts.get(creep.memory.sourceId)) !== null && _b !== void 0 ? _b : 0;
        // Rebalance: if our source has 2+ more harvesters than another, switch
        const underloaded = sources.find(s => {
            var _a;
            return s.id !== creep.memory.sourceId &&
                ((_a = counts.get(s.id)) !== null && _a !== void 0 ? _a : 0) < currentLoad - 1;
        });
        if (underloaded) {
            creep.memory.sourceId = underloaded.id;
            return underloaded;
        }
        return Game.getObjectById(creep.memory.sourceId);
    }
    // First assignment: least-contested source
    const best = sources.reduce((a, b) => { var _a, _b; return ((_a = counts.get(a.id)) !== null && _a !== void 0 ? _a : 0) <= ((_b = counts.get(b.id)) !== null && _b !== void 0 ? _b : 0) ? a : b; });
    creep.memory.sourceId = best.id;
    return best;
}
function findNearbyContainer(source) {
    var _a;
    return (_a = source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: s => s.structureType === STRUCTURE_CONTAINER,
    })[0]) !== null && _a !== void 0 ? _a : null;
}
const SPAWN_FILL_THRESHOLD = 0.8;
function findDeliveryTarget(creep) {
    return creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: s => {
            var _a;
            if (s.structureType === STRUCTURE_EXTENSION) {
                return s.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
            if (s.structureType === STRUCTURE_SPAWN) {
                const sp = s;
                return sp.store[RESOURCE_ENERGY] < ((_a = sp.store.getCapacity(RESOURCE_ENERGY)) !== null && _a !== void 0 ? _a : 300) * SPAWN_FILL_THRESHOLD;
            }
            if (s.structureType === STRUCTURE_TOWER) {
                return s.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
            return false;
        },
    });
}
function moveToRoom$7(creep, roomName) {
    moveTo(creep, new RoomPosition(25, 25, roomName), { reusePath: 20, range: 23 });
}

// Hauler: decouples harvesting from delivery.
// Collection priority: hub link > fullest container > storage > dropped > harvest
// Delivery priority: extensions > spawn > towers > storage
//
// Remote mode (creep.memory.remoteRoom set): cross-room hauler that collects from
// a reserved room's containers and delivers to homeRoom's storage.
//
// CPU optimisation: target IDs are cached in creep.memory.targetId so
// findClosestByPath is only called when the cached target is gone or empty.
function runHauler(creep) {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }
    if (creep.memory.remoteRoom) {
        creep.memory.working ? deliverRemote(creep) : collectRemote(creep);
    }
    else {
        creep.memory.working ? deliver$1(creep) : collect$1(creep);
        // Eager transition: skip the idle tick when a phase just completed.
        // Without this, the working-state flip only fires at the top of the NEXT tick,
        // leaving the creep standing at spawn/container for one wasted tick — the primary
        // cause of spawn-area pile-ups when multiple haulers finish simultaneously.
        if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
            creep.memory.working = false;
            collect$1(creep);
        }
        else if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
            creep.memory.working = true;
            deliver$1(creep);
        }
    }
}
// ─── Remote mode ─────────────────────────────────────────────────────────────
function collectRemote(creep) {
    const remote = creep.memory.remoteRoom;
    if (creep.room.name !== remote) {
        moveToRoom$6(creep, remote);
        return;
    }
    // Tombstones first (about to vanish)
    const tomb = creep.pos.findClosestByPath(FIND_TOMBSTONES, {
        filter: t => t.store[RESOURCE_ENERGY] >= 50,
    });
    if (tomb) {
        if (creep.withdraw(tomb, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE)
            moveTo(creep, tomb, { reusePath: 3 });
        return;
    }
    // Containers (filled by remote miners)
    const container = getCachedContainer(creep, remote);
    if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, container, { reusePath: 5 });
        }
        return;
    }
    // Dropped energy
    const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: r => r.resourceType === RESOURCE_ENERGY && r.amount >= 50,
    });
    if (dropped) {
        if (creep.pickup(dropped) === ERR_NOT_IN_RANGE)
            moveTo(creep, dropped, { reusePath: 3 });
        return;
    }
    // Nothing to collect — go home rather than idle
    const home = creep.memory.homeRoom;
    if (home)
        moveToRoom$6(creep, home);
}
function deliverRemote(creep) {
    const home = creep.memory.homeRoom;
    if (!home)
        return;
    if (creep.room.name !== home) {
        moveToRoom$6(creep, home);
        return;
    }
    // Deposit into storage (remote energy goes straight to buffer)
    const storage = creep.room.storage;
    if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        if (creep.transfer(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, storage, { reusePath: 5 });
        }
        return;
    }
    // Fallback: fill spawn/extensions if storage is absent or full
    const spawn = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: (s) => (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });
    if (spawn) {
        if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE)
            moveTo(creep, spawn, { reusePath: 5 });
    }
}
// ─── Normal mode ──────────────────────────────────────────────────────────────
function collect$1(creep) {
    // 1. Hub links (near spawn) — skip controller-adjacent links; those serve upgraders.
    // Controller links are within range 3 of the controller; exclude them here so
    // haulers don't drain energy meant for stationary upgraders.
    const roomCtrl = creep.room.controller;
    const link = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: s => {
            if (s.structureType !== STRUCTURE_LINK)
                return false;
            if (s.store[RESOURCE_ENERGY] < 400)
                return false;
            if (roomCtrl && roomCtrl.pos.getRangeTo(s) <= 3)
                return false;
            return true;
        },
    });
    if (link) {
        if (creep.withdraw(link, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, link, { reusePath: 5 });
        }
        return;
    }
    // 2. Source containers only — skip controller container (upgraders drain that)
    const container = getCachedSourceContainer(creep);
    if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, container, { reusePath: 5 });
        }
        return;
    }
    // 3. Storage (surplus buffer)
    const storage = creep.room.storage;
    if (storage && storage.store[RESOURCE_ENERGY] >= 1000) {
        if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, storage, { reusePath: 5 });
        }
        return;
    }
    // 4. Dropped energy (tombstones, overflow)
    const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: r => r.resourceType === RESOURCE_ENERGY && r.amount >= 50,
    });
    if (dropped) {
        if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
            moveTo(creep, dropped, { reusePath: 3 });
        }
        return;
    }
    // 5. Direct harvest as last resort
    const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
        moveTo(creep, source, { reusePath: 5 });
    }
}
function deliver$1(creep) {
    // Use cached delivery target ID to avoid findClosestByPath every tick
    const cached = creep.memory.targetId
        ? Game.getObjectById(creep.memory.targetId)
        : null;
    let target = null;
    if (cached && needsEnergy(cached)) {
        target = cached;
    }
    else {
        creep.memory.targetId = undefined;
        target = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
            filter: s => needsEnergy(s),
        });
        if (target)
            creep.memory.targetId = target.id;
    }
    if (target) {
        if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, target, { reusePath: 5 });
        }
        return;
    }
    // Nothing needs energy — fill the hub container (non-source container near spawn)
    // so builders always have a local pickup point when storage doesn't exist yet.
    const hub = findHubContainer(creep.room);
    if (hub) {
        if (creep.transfer(hub, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, hub, { reusePath: 5 });
        }
        return;
    }
    // No hub container (e.g. it decayed) — move near spawn and drop so builders
    // and other roles can pick it up from the ground rather than haulers idling full.
    // Prefer tiles that already have a dropped pile so energy concentrates in one spot.
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (!spawn)
        return;
    const nearbyPile = spawn.pos.findInRange(FIND_DROPPED_RESOURCES, 3, {
        filter: r => r.resourceType === RESOURCE_ENERGY,
    }).sort((a, b) => b.amount - a.amount)[0];
    const dropTarget = nearbyPile ? nearbyPile.pos : spawn.pos;
    if (creep.pos.isEqualTo(dropTarget)) {
        creep.drop(RESOURCE_ENERGY);
    }
    else if (creep.pos.getRangeTo(dropTarget) > 0) {
        moveTo(creep, dropTarget, { reusePath: 5, range: 0 });
    }
}
function needsEnergy(s) {
    if (!s)
        return false;
    if (s.structureType === STRUCTURE_EXTENSION)
        return s.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
    if (s.structureType === STRUCTURE_SPAWN)
        return s.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
    if (s.structureType === STRUCTURE_TOWER)
        return s.store.getFreeCapacity(RESOURCE_ENERGY) > 200;
    if (s.structureType === STRUCTURE_STORAGE)
        return s.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
    return false;
}
// ─── Container cache ──────────────────────────────────────────────────────────
// Reuses cached container until it runs dry OR another source container has
// substantially more energy (3x threshold) — prevents all haulers from camping
// one container while another source overflows.
// Local collect: only containers adjacent to a source (range 1).
// Prevents haulers from draining the controller container that upgraders need.
function getCachedSourceContainer(creep) {
    var _a;
    const sources = creep.room.find(FIND_SOURCES);
    const candidates = [];
    for (const src of sources) {
        const near = src.pos.findInRange(FIND_STRUCTURES, 1, {
            filter: s => s.structureType === STRUCTURE_CONTAINER &&
                s.store[RESOURCE_ENERGY] >= 50,
        });
        candidates.push(...near);
    }
    if (candidates.length === 0) {
        creep.memory.targetId = undefined;
        return null;
    }
    const cached = creep.memory.targetId
        ? Game.getObjectById(creep.memory.targetId)
        : null;
    if (cached && cached.structureType === STRUCTURE_CONTAINER) {
        const c = cached;
        if (c.store[RESOURCE_ENERGY] >= 50 && candidates.some(x => x.id === c.id)) {
            // Invalidate if another container has 3x more energy — switch to the richer one
            const richer = candidates.find(x => x.id !== c.id && x.store[RESOURCE_ENERGY] > c.store[RESOURCE_ENERGY] * 3);
            if (!richer)
                return c;
        }
    }
    // Pick closest source container to this hauler's current position so
    // multiple haulers naturally distribute across sources rather than all
    // converging on whichever happened to be fullest at assignment time.
    const best = (_a = creep.pos.findClosestByPath(candidates)) !== null && _a !== void 0 ? _a : candidates[0];
    creep.memory.targetId = best.id;
    return best;
}
// Returns the non-source container closest to spawn — the hub buffer for builders.
function findHubContainer(room) {
    const sources = room.find(FIND_SOURCES);
    const containers = room.find(FIND_STRUCTURES, {
        filter: s => {
            if (s.structureType !== STRUCTURE_CONTAINER)
                return false;
            const c = s;
            if (c.store.getFreeCapacity(RESOURCE_ENERGY) <= 0)
                return false;
            return !sources.some(src => src.pos.isNearTo(c.pos));
        },
    });
    if (containers.length === 0)
        return null;
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn)
        return containers[0];
    return containers.reduce((best, c) => c.pos.getRangeTo(spawn) < best.pos.getRangeTo(spawn) ? c : best);
}
function getCachedContainer(creep, inRoom) {
    if (creep.room.name !== inRoom)
        return null;
    const cached = creep.memory.targetId
        ? Game.getObjectById(creep.memory.targetId)
        : null;
    if (cached && cached.structureType === STRUCTURE_CONTAINER &&
        cached.store[RESOURCE_ENERGY] >= 50) {
        return cached;
    }
    // Re-find: pick the fullest container
    const containers = creep.room.find(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_CONTAINER &&
            s.store[RESOURCE_ENERGY] >= 50,
    });
    if (containers.length === 0) {
        creep.memory.targetId = undefined;
        return null;
    }
    const best = containers.reduce((a, b) => a.store[RESOURCE_ENERGY] >= b.store[RESOURCE_ENERGY] ? a : b);
    creep.memory.targetId = best.id;
    return best;
}
function moveToRoom$6(creep, roomName) {
    // Move toward room center — native pathfinder handles cross-room routing.
    // reusePath:20 caches the serialized path across ticks; range:23 stops as
    // soon as we're inside the room (within 23 tiles of center on a 50×50 grid).
    moveTo(creep, new RoomPosition(25, 25, roomName), { reusePath: 20, range: 23 });
}

// Dedicated controller upgrader.
// Also handles safe mode recharge: if terminal has ghodium, pick it up and
// call generateSafeMode(controller) to add a safe mode charge (consumes 1000G).
function runUpgrader(creep) {
    var _a, _b;
    // Safe mode recharge: if we're holding ghodium, use it immediately
    const ghodiumHeld = creep.store.getUsedCapacity(RESOURCE_GHODIUM);
    if (ghodiumHeld >= 1000) {
        const ctrl = creep.room.controller;
        if (ctrl && !ctrl.safeModeAvailable) {
            if (creep.generateSafeMode(ctrl) === ERR_NOT_IN_RANGE) {
                moveTo(creep, ctrl, { reusePath: 5 });
            }
            return;
        }
    }
    // Pick up ghodium from terminal if safe mode is depleted and we don't have it yet
    const terminal = creep.room.terminal;
    if (terminal && !((_a = creep.room.controller) === null || _a === void 0 ? void 0 : _a.safeModeAvailable) && ghodiumHeld < 1000) {
        const available = (_b = terminal.store.getUsedCapacity(RESOURCE_GHODIUM)) !== null && _b !== void 0 ? _b : 0;
        if (available >= 1000 && creep.store.getFreeCapacity() >= 1000) {
            if (creep.withdraw(terminal, RESOURCE_GHODIUM, 1000) === ERR_NOT_IN_RANGE) {
                moveTo(creep, terminal, { reusePath: 5 });
            }
            return;
        }
    }
    // Normal upgrade cycle
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }
    if (creep.memory.working) {
        const controller = creep.room.controller;
        if (controller && creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
            moveTo(creep, controller, { reusePath: 5 });
        }
    }
    else {
        getEnergy$1(creep);
    }
}
function getEnergy$1(creep) {
    const controller = creep.room.controller;
    if (!controller)
        return;
    // Controller link (range 3): energy teleported from sources — no hauler trip.
    // This is the most efficient source at RCL5+ with the new link topology.
    const ctrlLink = controller.pos.findInRange(FIND_MY_STRUCTURES, 3, {
        filter: s => s.structureType === STRUCTURE_LINK &&
            s.store[RESOURCE_ENERGY] > 0,
    })[0];
    if (ctrlLink) {
        if (creep.withdraw(ctrlLink, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, ctrlLink, { reusePath: 5 });
        }
        return;
    }
    // Container near controller (fallback when link is empty or not yet built)
    const container = controller.pos.findInRange(FIND_STRUCTURES, 3, {
        filter: s => s.structureType === STRUCTURE_CONTAINER &&
            s.store[RESOURCE_ENERGY] > 0,
    })[0];
    if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, container, { reusePath: 5 });
        }
        return;
    }
    const storage = creep.room.storage;
    if (storage && storage.store[RESOURCE_ENERGY] > 0) {
        if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, storage, { reusePath: 5 });
        }
        return;
    }
    const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
        moveTo(creep, source, { reusePath: 5 });
    }
}

// Builder works through construction sites in explicit priority order so the most
// impactful structures are finished first regardless of physical proximity.
//
// Priority: storage → containers → extensions → towers → ramparts → roads → repair → upgrade
function runBuilder(creep) {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }
    if (creep.memory.working) {
        const site = findBuildTarget(creep);
        if (site) {
            if (creep.build(site) === ERR_NOT_IN_RANGE) {
                moveTo(creep, site, { reusePath: 5 });
            }
            return;
        }
        // Repair containers first — prevent hub container from decaying away
        const damagedContainer = creep.pos.findClosestByPath(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_CONTAINER && s.hits < s.hitsMax * 0.5,
        });
        if (damagedContainer) {
            if (creep.repair(damagedContainer) === ERR_NOT_IN_RANGE) {
                moveTo(creep, damagedContainer, { reusePath: 5 });
            }
            return;
        }
        // Repair roads below 50% before falling back to upgrading
        const damagedRoad = creep.pos.findClosestByPath(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_ROAD && s.hits < s.hitsMax * 0.5,
        });
        if (damagedRoad) {
            if (creep.repair(damagedRoad) === ERR_NOT_IN_RANGE) {
                moveTo(creep, damagedRoad, { reusePath: 5 });
            }
            return;
        }
        // Nothing left to build — upgrade the controller
        const controller = creep.room.controller;
        if (controller) {
            if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
                moveTo(creep, controller, { reusePath: 5 });
            }
        }
    }
    else {
        collectEnergy(creep);
        // Eager transition: if collection just filled us, immediately start moving
        // toward the build site instead of idling at the collection point for one tick.
        if (creep.store.getFreeCapacity() === 0) {
            creep.memory.working = true;
            const site = findBuildTarget(creep);
            if (site && creep.build(site) === ERR_NOT_IN_RANGE) {
                moveTo(creep, site, { reusePath: 5 });
            }
        }
    }
}
function collectEnergy(creep) {
    // Storage first — central buffer filled by haulers; keeps builders near spawn
    const storage = creep.room.storage;
    if (storage && storage.store[RESOURCE_ENERGY] >= 200) {
        if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, storage, { reusePath: 5 });
        }
        return;
    }
    // Pre-storage fallback: source containers (haulers haven't built up storage yet)
    const containers = creep.room.find(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_CONTAINER &&
            s.store[RESOURCE_ENERGY] >= 50,
    });
    if (containers.length > 0) {
        const target = containers.reduce((a, b) => a.store[RESOURCE_ENERGY] >= b.store[RESOURCE_ENERGY] ? a : b);
        if (creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, target, { reusePath: 5 });
        }
        return;
    }
    // Dropped energy (tombstones, overflow)
    const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: r => r.resourceType === RESOURCE_ENERGY && r.amount >= 50,
    });
    if (dropped) {
        if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
            moveTo(creep, dropped, { reusePath: 3 });
        }
        return;
    }
    // Bootstrap fallback: before the first container exists, harvest directly so
    // the builder can build those first containers and unblock the supply chain.
    const hasContainers = creep.room.find(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_CONTAINER,
    }).length > 0;
    if (!hasContainers) {
        const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
        if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
            moveTo(creep, source, { reusePath: 5 });
        }
    }
}
// Returns the highest-priority construction site.
// Source containers come first — every source needs its container before
// anything else, since the whole supply chain depends on them.
function findBuildTarget(creep) {
    var _a;
    // 1. Source containers — adjacent (range 1) to each source
    const sources = creep.room.find(FIND_SOURCES);
    const sourceContainerSites = [];
    for (const src of sources) {
        const sites = src.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
            filter: (s) => s.structureType === STRUCTURE_CONTAINER,
        });
        sourceContainerSites.push(...sites);
    }
    if (sourceContainerSites.length > 0) {
        return (_a = creep.pos.findClosestByPath(sourceContainerSites)) !== null && _a !== void 0 ? _a : sourceContainerSites[0];
    }
    // 2. Everything else in priority order
    const PRIORITY = [
        STRUCTURE_STORAGE,
        STRUCTURE_CONTAINER, // controller container and any remaining
        STRUCTURE_EXTENSION,
        STRUCTURE_TOWER,
        STRUCTURE_RAMPART,
        STRUCTURE_ROAD,
    ];
    for (const type of PRIORITY) {
        const site = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES, {
            filter: s => s.structureType === type,
        });
        if (site)
            return site;
    }
    return creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);
}

// Raid-responder: keeps ramparts and walls above minimum HP during DEFEND phase.
// Withdraws energy from containers; falls back to harvesting.
const RAMPART_MIN_HITS = 50000;
const WALL_MIN_HITS = 10000;
function runRepairer(creep) {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }
    if (creep.memory.working) {
        const target = findRepairTarget(creep);
        if (target) {
            // Move onto a rampart tile for protection if possible
            const safeStand = target.pos.findInRange(FIND_MY_STRUCTURES, 0, {
                filter: s => s.structureType === STRUCTURE_RAMPART,
            })[0];
            if (safeStand && !creep.pos.isEqualTo(target.pos)) {
                moveTo(creep, target.pos, { reusePath: 3 });
            }
            if (creep.repair(target) === ERR_NOT_IN_RANGE) {
                moveTo(creep, target, { reusePath: 3 });
            }
        }
        else {
            // Nothing to repair — upgrade controller
            const ctrl = creep.room.controller;
            if (ctrl && creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
                moveTo(creep, ctrl, { reusePath: 5 });
            }
        }
    }
    else {
        getEnergy(creep);
    }
}
function findRepairTarget(creep) {
    // Ramparts first (most critical — they protect structures)
    const ramparts = creep.room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_RAMPART && s.hits < RAMPART_MIN_HITS,
    });
    if (ramparts.length > 0) {
        return ramparts.reduce((a, b) => a.hits < b.hits ? a : b);
    }
    // Walls next
    const walls = creep.room.find(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_WALL && s.hits < WALL_MIN_HITS,
    });
    if (walls.length > 0) {
        return walls.reduce((a, b) => a.hits < b.hits ? a : b);
    }
    // Roads degraded below 50%
    return creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_ROAD && s.hits < s.hitsMax * 0.5,
    });
}
function getEnergy(creep) {
    const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_CONTAINER &&
            s.store[RESOURCE_ENERGY] > 0,
    });
    if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, container, { reusePath: 5 });
        }
        return;
    }
    const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
        moveTo(creep, source, { reusePath: 5 });
    }
}

// Scout: patrols every room adjacent to any owned room.
const BORDER_STALE_TICKS = 100; // frequent rescan near our borders for early warning
function runScout(creep) {
    const targetRoom = creep.memory.targetRoomName;
    if (!targetRoom) {
        assignNextTarget(creep);
        return;
    }
    if (creep.room.name !== targetRoom) {
        const exitDir = creep.room.findExitTo(targetRoom);
        if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
            const exit = creep.pos.findClosestByRange(exitDir);
            if (exit)
                moveTo(creep, exit, { reusePath: 3 });
        }
        return;
    }
    if (!creep.memory.scoutComplete) {
        recordRoomIntel(creep.room);
        creep.memory.scoutComplete = true;
    }
    assignNextTarget(creep);
}
function recordRoomIntel(room) {
    var _a, _b, _c, _d;
    if (!Memory.roomIntel)
        Memory.roomIntel = {};
    const enemyCreeps = room.find(FIND_HOSTILE_CREEPS).length;
    const enemySpawns = room.find(FIND_HOSTILE_STRUCTURES, { filter: s => s.structureType === STRUCTURE_SPAWN }).length;
    const enemyTowers = room.find(FIND_HOSTILE_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER }).length;
    const strength = enemyCreeps + enemySpawns * 5 + enemyTowers * 8;
    Memory.roomIntel[room.name] = {
        scannedAt: Game.time,
        enemyCreeps,
        enemySpawns,
        enemyTowers,
        strength,
        hasController: !!room.controller,
        controllerOwned: !!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.owner),
        sourceCount: room.find(FIND_SOURCES).length,
    };
    // Update every owned room's per-room scoutTick and enemyRoomName so each
    // room's strategy FSM can independently decide whether to RUSH or DEFEND.
    const ownedRooms = Object.values(Game.rooms).filter(r => { var _a; return (_a = r.controller) === null || _a === void 0 ? void 0 : _a.my; });
    for (const owned of ownedRooms) {
        owned.memory.scoutTick = Game.time;
        if (enemySpawns > 0 || enemyCreeps > 0) {
            const currentStrength = owned.memory.enemyRoomName
                ? ((_c = (_b = Memory.roomIntel[owned.memory.enemyRoomName]) === null || _b === void 0 ? void 0 : _b.strength) !== null && _c !== void 0 ? _c : Infinity)
                : Infinity;
            if (strength < currentStrength) {
                owned.memory.enemyRoomName = room.name;
                owned.memory.enemyStrength = strength;
            }
        }
    }
    console.log(`[scout] ${room.name} str=${strength} ctrl=${!!room.controller} owned=${!!((_d = room.controller) === null || _d === void 0 ? void 0 : _d.owner)} sources=${room.find(FIND_SOURCES).length}`);
}
function assignNextTarget(creep) {
    var _a;
    const ownedRooms = Object.values(Game.rooms).filter(r => { var _a; return (_a = r.controller) === null || _a === void 0 ? void 0 : _a.my; });
    if (ownedRooms.length === 0)
        return;
    // Collect all rooms adjacent to ANY owned room (excluding owned rooms themselves)
    const ownedNames = new Set(ownedRooms.map(r => r.name));
    const borderRooms = new Set();
    for (const room of ownedRooms) {
        const exits = Game.map.describeExits(room.name);
        if (!exits)
            continue;
        for (const neighbor of Object.values(exits)) {
            if (neighbor && !ownedNames.has(neighbor))
                borderRooms.add(neighbor);
        }
    }
    const intel = (_a = Memory.roomIntel) !== null && _a !== void 0 ? _a : {};
    const targets = Array.from(borderRooms);
    // Priority 1: rooms never scanned before
    const unscanned = targets.find(r => !intel[r]);
    if (unscanned) {
        creep.memory.targetRoomName = unscanned;
        creep.memory.scoutComplete = false;
        return;
    }
    // Priority 2: stale border rooms (early-warning rescan at 100 ticks)
    const staleBorder = targets.find(r => { var _a, _b; return Game.time - ((_b = (_a = intel[r]) === null || _a === void 0 ? void 0 : _a.scannedAt) !== null && _b !== void 0 ? _b : 0) > BORDER_STALE_TICKS; });
    if (staleBorder) {
        creep.memory.targetRoomName = staleBorder;
        creep.memory.scoutComplete = false;
        return;
    }
    // All rooms fresh — wait in the first owned room to avoid pointless travel
    creep.memory.targetRoomName = undefined;
    const homeRoom = ownedRooms[0];
    if (creep.room.name !== homeRoom.name) {
        const exitDir = creep.room.findExitTo(homeRoom.name);
        if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
            const exit = creep.pos.findClosestByRange(exitDir);
            if (exit)
                moveTo(creep, exit, { reusePath: 5 });
        }
    }
}

// Claims a neutral controller in the target room.
// Once claimed, suicide — expansionManager handles the rest.
function runClaimer(creep) {
    const targetRoom = creep.memory.targetRoomName;
    if (!targetRoom)
        return;
    if (creep.room.name !== targetRoom) {
        const exitDir = creep.room.findExitTo(targetRoom);
        if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
            const exit = creep.pos.findClosestByRange(exitDir);
            if (exit)
                moveTo(creep, exit, { reusePath: 3 });
        }
        return;
    }
    const controller = creep.room.controller;
    if (!controller)
        return;
    if (controller.my) {
        console.log(`[adaptive] Room ${targetRoom} claimed at tick ${Game.time}!`);
        Memory.expansionState = 'BOOTSTRAPPING';
        Memory.expansionRoomName = targetRoom;
        creep.suicide();
        return;
    }
    // If reserved by enemy, attack the reservation first
    if (controller.reservation && controller.reservation.username !== creep.owner.username) {
        if (creep.attackController(controller) === ERR_NOT_IN_RANGE) {
            moveTo(creep, controller, { reusePath: 3 });
        }
        return;
    }
    if (creep.claimController(controller) === ERR_NOT_IN_RANGE) {
        moveTo(creep, controller, { reusePath: 3 });
    }
}

// Reserver: keeps a neutral adjacent room's controller reserved so no one else can claim it.
// Reservation costs 1 CLAIM part and lasts up to 5000 ticks (refreshed each call).
// Reserved rooms cannot be claimed by other players — they remain neutral so we can
// harvest their sources without spending a GCL slot.
//
// creep.memory.targetRoomName — room whose controller to reserve
function runReserver(creep) {
    const target = creep.memory.targetRoomName;
    if (!target)
        return;
    if (creep.room.name !== target) {
        moveToRoom$5(creep, target);
        return;
    }
    const ctrl = creep.room.controller;
    if (!ctrl)
        return;
    // Already claimed by us — shouldn't happen but handle gracefully
    if (ctrl.my)
        return;
    // Reserving: each call with CLAIM+MOVE adds 600t to reservation (cap 5000t)
    const result = creep.reserveController(ctrl);
    if (result === ERR_NOT_IN_RANGE) {
        moveTo(creep, ctrl, { reusePath: 10 });
    }
}
function moveToRoom$5(creep, roomName) {
    const exitDir = creep.room.findExitTo(roomName);
    if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
        const exit = creep.pos.findClosestByRange(exitDir);
        if (exit)
            moveTo(creep, exit, { reusePath: 5 });
    }
}

// Scavenger: fast creep that collects dropped energy and tombstones.
// Works in own room first; if a scavengeRoom is set and own room is clear,
// crosses into that room to loot (safe-mode rooms included — can enter, just can't attack).
// Returns home and deposits into storage, containers, or spawns.
const MIN_LOOT_AMOUNT = 30; // ignore tiny piles not worth the trip
function runScavenger(creep) {
    // Auto-dispatch to enemy room while our fighters are engaged there so we can
    // collect energy dropped by killed harvesters/haulers.  Clear it once combat ends.
    const homeRoom = creep.memory.homeRoom ? Game.rooms[creep.memory.homeRoom] : undefined;
    const enemyRoom = homeRoom === null || homeRoom === void 0 ? void 0 : homeRoom.memory.enemyRoomName;
    const combatActive = (homeRoom === null || homeRoom === void 0 ? void 0 : homeRoom.memory.combatState) === 'ENGAGE' || (homeRoom === null || homeRoom === void 0 ? void 0 : homeRoom.memory.combatState) === 'MARCH';
    if (combatActive && enemyRoom && !creep.memory.scavengeRoom) {
        creep.memory.scavengeRoom = enemyRoom;
    }
    else if (!combatActive && creep.memory.scavengeRoom && creep.memory.scavengeRoom === enemyRoom) {
        creep.memory.scavengeRoom = undefined;
    }
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }
    if (creep.memory.working) {
        deposit(creep);
    }
    else {
        loot(creep);
    }
}
function loot(creep) {
    // 1. Tombstones in current room (highest priority — about to vanish)
    const tombstone = creep.pos.findClosestByPath(FIND_TOMBSTONES, {
        filter: t => t.store[RESOURCE_ENERGY] >= MIN_LOOT_AMOUNT,
    });
    if (tombstone) {
        if (creep.withdraw(tombstone, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, tombstone, { reusePath: 3 });
        }
        return;
    }
    // 2. Dropped energy in current room
    const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: r => r.resourceType === RESOURCE_ENERGY && r.amount >= MIN_LOOT_AMOUNT,
    });
    if (dropped) {
        if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
            moveTo(creep, dropped, { reusePath: 3 });
        }
        return;
    }
    // 3. Nothing in current room — if a scavenge target room is set, go there
    const scavengeRoom = creep.memory.scavengeRoom;
    if (scavengeRoom && creep.room.name !== scavengeRoom) {
        moveToRoom$4(creep, scavengeRoom);
        return;
    }
    // 4. In the scavenge room — pick up anything there too
    if (scavengeRoom && creep.room.name === scavengeRoom) {
        const remoteDropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
            filter: r => r.resourceType === RESOURCE_ENERGY && r.amount >= MIN_LOOT_AMOUNT,
        });
        if (remoteDropped) {
            if (creep.pickup(remoteDropped) === ERR_NOT_IN_RANGE) {
                moveTo(creep, remoteDropped, { reusePath: 3 });
            }
            return;
        }
        const remoteTombstone = creep.pos.findClosestByPath(FIND_TOMBSTONES, {
            filter: t => t.store[RESOURCE_ENERGY] >= MIN_LOOT_AMOUNT,
        });
        if (remoteTombstone) {
            if (creep.withdraw(remoteTombstone, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                moveTo(creep, remoteTombstone, { reusePath: 3 });
            }
            return;
        }
        // Remote room is clean — return home
        travelHome$3(creep);
        return;
    }
    // 5. Nothing to loot anywhere — idle near spawn
    if (!isHome$3(creep)) {
        travelHome$3(creep);
        return;
    }
    const spawn = creep.pos.findClosestByPath(FIND_MY_SPAWNS);
    if (spawn)
        moveTo(creep, spawn, { reusePath: 10 });
}
function deposit(creep) {
    if (!isHome$3(creep)) {
        travelHome$3(creep);
        return;
    }
    // Prefer storage (large buffer), then containers, then spawn/extensions
    const storage = creep.room.storage;
    if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        if (creep.transfer(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, storage, { reusePath: 5 });
        }
        return;
    }
    const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_CONTAINER &&
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });
    if (container) {
        if (creep.transfer(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, container, { reusePath: 5 });
        }
        return;
    }
    const fillTarget = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: (s) => (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });
    if (fillTarget) {
        if (creep.transfer(fillTarget, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, fillTarget, { reusePath: 5 });
        }
        return;
    }
    // No containers or structures to fill — drop near spawn, preferring tiles that
    // already have a pile so energy concentrates in one spot for builders to collect.
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (!spawn)
        return;
    const nearbyPile = spawn.pos.findInRange(FIND_DROPPED_RESOURCES, 3, {
        filter: r => r.resourceType === RESOURCE_ENERGY,
    }).sort((a, b) => b.amount - a.amount)[0];
    const dropTarget = nearbyPile ? nearbyPile.pos : spawn.pos;
    if (creep.pos.isEqualTo(dropTarget)) {
        creep.drop(RESOURCE_ENERGY);
    }
    else {
        moveTo(creep, dropTarget, { reusePath: 5, range: 0 });
    }
}
function isHome$3(creep) {
    var _a, _b;
    const home = creep.memory.homeRoom;
    if (home)
        return creep.room.name === home;
    return !!((_b = (_a = Game.rooms[creep.room.name]) === null || _a === void 0 ? void 0 : _a.controller) === null || _b === void 0 ? void 0 : _b.my);
}
function travelHome$3(creep) {
    var _a;
    const dest = (_a = creep.memory.homeRoom) !== null && _a !== void 0 ? _a : Object.keys(Game.rooms).find(r => { var _a, _b; return (_b = (_a = Game.rooms[r]) === null || _a === void 0 ? void 0 : _a.controller) === null || _b === void 0 ? void 0 : _b.my; });
    if (dest)
        moveToRoom$4(creep, dest);
}
function moveToRoom$4(creep, roomName) {
    const exitDir = creep.room.findExitTo(roomName);
    if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
        const exit = creep.pos.findClosestByRange(exitDir);
        if (exit)
            moveTo(creep, exit, { reusePath: 3 });
    }
}

// Courier: physically carries energy from a surplus room to a deficit room.
// Used before RCL 6 (no terminals). At RCL 6+, transferManager switches to
// terminal transfers and couriers are no longer spawned.
//
// creep.memory.homeRoom    — source room (where to withdraw energy)
// creep.memory.courierTarget — destination room (where to deposit energy)
function runCourier(creep) {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }
    if (creep.memory.working) {
        deliver(creep);
    }
    else {
        collect(creep);
    }
}
function collect(creep) {
    const homeRoom = creep.memory.homeRoom;
    if (!homeRoom)
        return;
    if (creep.room.name !== homeRoom) {
        moveToRoom$3(creep, homeRoom);
        return;
    }
    // Withdraw from storage first, then fullest container
    const storage = creep.room.storage;
    if (storage && storage.store[RESOURCE_ENERGY] >= 500) {
        if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, storage, { reusePath: 5 });
        }
        return;
    }
    const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_CONTAINER &&
            s.store[RESOURCE_ENERGY] >= 200,
    });
    if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, container, { reusePath: 5 });
        }
        return;
    }
    // Source room has no energy to spare — idle near storage
    if (storage)
        moveTo(creep, storage, { reusePath: 10 });
}
function deliver(creep) {
    const target = creep.memory.courierTarget;
    if (!target)
        return;
    if (creep.room.name !== target) {
        moveToRoom$3(creep, target);
        return;
    }
    // Deposit into spawn/extensions first (keep spawn capacity up), then storage/containers
    const spawnTarget = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: (s) => (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });
    if (spawnTarget) {
        if (creep.transfer(spawnTarget, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, spawnTarget, { reusePath: 5 });
        }
        return;
    }
    const destStorage = creep.room.storage;
    if (destStorage && destStorage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        if (creep.transfer(destStorage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, destStorage, { reusePath: 5 });
        }
        return;
    }
    const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_CONTAINER &&
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });
    if (container) {
        if (creep.transfer(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, container, { reusePath: 5 });
        }
    }
}
function moveToRoom$3(creep, roomName) {
    const exitDir = creep.room.findExitTo(roomName);
    if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
        const exit = creep.pos.findClosestByRange(exitDir);
        if (exit)
            moveTo(creep, exit, { reusePath: 3 });
    }
}

// Quad squad manager.
// Forms 4-creep attack groups (2 warriors + 2 rangers) for coordinated assault.
//
// Advantages over individual platoons:
//  - Focused fire drains one tower at a time (empty tower = neutralized)
//  - Mutual ranged-heal keeps the quad alive much longer
//  - Combined body parts survive damage that would kill any individual
//
// Quad states follow room.memory.combatState (RALLY/MARCH/ENGAGE).
// Each quad has a leader (isQuadLeader=true) who picks targets.
// Non-leaders move to stay within 2 tiles of the leader.
const FORM_UP_RANGE = 2; // non-leaders stay within this many tiles of leader
function manageQuads(room) {
    var _a, _b;
    if (((_a = room.memory.combatState) !== null && _a !== void 0 ? _a : 'RALLY') === 'RALLY') {
        formQuads(room);
    }
    // MARCH/ENGAGE: individual roles handle movement, quadManager handles targeting
    if (((_b = room.memory.combatState) !== null && _b !== void 0 ? _b : 'RALLY') !== 'RALLY') {
        coordinateQuadTargets(room);
    }
}
// ─── Formation ────────────────────────────────────────────────────────────────
// Groups unassigned fighters into quads when enough units are available.
function formQuads(room) {
    const fighters = room.find(FIND_MY_CREEPS, {
        filter: c => (c.memory.role === 'warrior' || c.memory.role === 'ranger') &&
            c.memory.homeRoom === room.name &&
            !c.memory.quadId,
    });
    const warriors = fighters.filter(c => c.memory.role === 'warrior');
    const rangers = fighters.filter(c => c.memory.role === 'ranger');
    // Form quads as long as we have 2 warriors + 2 rangers available
    let quadIndex = nextQuadIndex(room.name);
    while (warriors.length >= 2 && rangers.length >= 2) {
        const quadId = `quad_${room.name}_${quadIndex++}`;
        const members = [
            warriors.splice(0, 2),
            rangers.splice(0, 2),
        ].flat();
        members[0].memory.quadId = quadId;
        members[0].memory.isQuadLeader = true;
        for (const m of members.slice(1)) {
            m.memory.quadId = quadId;
            m.memory.isQuadLeader = false;
        }
    }
}
function nextQuadIndex(roomName) {
    var _a;
    let max = 0;
    for (const name in Game.creeps) {
        const qid = Game.creeps[name].memory.quadId;
        if (qid && qid.startsWith(`quad_${roomName}_`)) {
            const n = parseInt((_a = qid.split('_').pop()) !== null && _a !== void 0 ? _a : '0', 10);
            if (n >= max)
                max = n + 1;
        }
    }
    return max;
}
// ─── Coordinated targeting ───────────────────────────────────────────────────
// All members of a quad focus the same target — the tower with lowest energy first
// (drain it completely → neutralize it), then enemy creeps, then spawns.
function coordinateQuadTargets(room) {
    // Collect quad IDs for units homed in this room only (avoids cross-room conflicts).
    const quadIds = new Set();
    for (const name in Game.creeps) {
        const c = Game.creeps[name];
        if (c.memory.quadId && c.memory.homeRoom === room.name)
            quadIds.add(c.memory.quadId);
    }
    for (const quadId of quadIds) {
        const members = Object.values(Game.creeps).filter(c => c.memory.quadId === quadId);
        const leader = members.find(c => c.memory.isQuadLeader);
        if (!leader)
            continue;
        // Pick targets based on where the leader currently is — during ENGAGE the leader
        // is in the enemy room, not the home room, so we must not filter on room.name.
        const leaderRoom = Game.rooms[leader.room.name];
        if (!leaderRoom)
            continue;
        const target = pickQuadTarget(leaderRoom);
        if (!target)
            continue;
        // Share the target ID with all quad members so they all focus it
        for (const m of members) {
            m.memory.targetId = target.id;
        }
    }
}
// Target priority (room takeover focus):
//   towers → active combat threats → reserver → economy creeps → passive/fleeing combatants
//
// "Active threat" means the enemy has working combat parts AND is within its attack range
// of at least one of our units.  Enemies that are kiting/fleeing fall to the bottom so we
// stay focused on killing the reserver and economy creeps, which is what actually takes
// over the room.  Once there are no economy targets left, passive combatants are cleaned up.
function pickQuadTarget(room) {
    var _a;
    const towers = room.find(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER,
    });
    if (towers.length > 0) {
        return towers.reduce((a, b) => a.store[RESOURCE_ENERGY] < b.store[RESOURCE_ENERGY] ? a : b);
    }
    const creeps = room.find(FIND_HOSTILE_CREEPS);
    const ourUnits = room.find(FIND_MY_CREEPS);
    if (creeps.length > 0) {
        // 1. Active threats: enemy combat parts are in range of our units right now.
        //    Must deal with them immediately or we take avoidable damage.
        const activeThreats = creeps.filter(c => isEngaging$2(c, ourUnits));
        if (activeThreats.length > 0) {
            return activeThreats.reduce((a, b) => threatScore$1(b) > threatScore$1(a) ? b : a);
        }
        // 2. Reserver — removing their claim lets our reserver take the controller.
        const reserver = creeps.find(c => c.body.some(p => p.type === CLAIM));
        if (reserver)
            return reserver;
        // 3. Economy creeps (harvesters/haulers) — soft targets; loot drops on death.
        const economy = creeps.find(c => c.body.some(p => p.type === WORK || p.type === CARRY));
        if (economy)
            return economy;
        // 4. Passive/fleeing combat creeps — low priority while economy targets remain;
        //    once the room is clear of economy we mop these up too.
        return creeps.reduce((a, b) => threatScore$1(b) > threatScore$1(a) ? b : a);
    }
    const spawns = room.find(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_SPAWN,
    });
    if (spawns.length > 0)
        return spawns[0];
    return (_a = room.find(FIND_HOSTILE_STRUCTURES)[0]) !== null && _a !== void 0 ? _a : null;
}
// Returns true when an enemy has LIVE combat parts (ATTACK or RANGED_ATTACK) and is
// within their effective attack range of at least one of our units.
// HEAL parts are not included — healers don't directly damage our creeps.
function isEngaging$2(enemy, allies) {
    const meleeRange = enemy.body.some(p => p.type === ATTACK && p.hits > 0) ? 1 : 0;
    const rangedRange = enemy.body.some(p => p.type === RANGED_ATTACK && p.hits > 0) ? 3 : 0;
    const attackRange = Math.max(meleeRange, rangedRange);
    if (attackRange === 0)
        return false;
    return allies.some(ally => enemy.pos.getRangeTo(ally) <= attackRange);
}
// ─── Helpers ─────────────────────────────────────────────────────────────────
// Called by warrior/ranger roles: move non-leaders to stay near their leader.
function followQuadLeader(creep) {
    if (!creep.memory.quadId || creep.memory.isQuadLeader)
        return false;
    const leader = Object.values(Game.creeps).find(c => c.memory.quadId === creep.memory.quadId && c.memory.isQuadLeader);
    if (!leader || leader.room.name !== creep.room.name)
        return false;
    const range = creep.pos.getRangeTo(leader);
    if (range > FORM_UP_RANGE) {
        creep.moveTo(leader, { reusePath: 2 });
        return true; // consumed movement action
    }
    return false;
}
function threatScore$1(c) {
    return c.body.reduce((n, p) => {
        if (p.type === ATTACK)
            return n + 3;
        if (p.type === RANGED_ATTACK)
            return n + 2;
        if (p.type === HEAL)
            return n + 1;
        return n;
    }, 0);
}

// Advanced combat unit.
// Has HEAL parts, retreat logic, and obeys per-room RALLY/MARCH/ENGAGE state.
// When assigned to a quad, uses quad-coordinated target ID (set by quadManager).
const RETREAT_THRESHOLD = 0.3;
function runWarrior(creep) {
    var _a, _b;
    // Always try to heal self if damaged (HEAL action is independent of movement)
    if (creep.hits < creep.hitsMax) {
        creep.heal(creep);
    }
    // Retreat when critically wounded — return home to recover
    if (creep.hits < creep.hitsMax * RETREAT_THRESHOLD) {
        retreatToHome(creep);
        return;
    }
    const homeMemory = creep.memory.homeRoom ? (_a = Game.rooms[creep.memory.homeRoom]) === null || _a === void 0 ? void 0 : _a.memory : undefined;
    const combatState = (_b = homeMemory === null || homeMemory === void 0 ? void 0 : homeMemory.combatState) !== null && _b !== void 0 ? _b : 'RALLY';
    if (combatState === 'RALLY' && creep.memory.defendingRoom) {
        defendRoom$1(creep);
        return;
    }
    switch (combatState) {
        case 'RALLY':
            rallyAtSpawn$1(creep);
            break;
        case 'MARCH':
        case 'ENGAGE':
            executeMarch$1(creep);
            break;
    }
}
function defendRoom$1(creep) {
    const target = creep.memory.defendingRoom;
    if (creep.room.name !== target) {
        moveToRoom$2(creep, target);
        return;
    }
    engageInRoom(creep);
}
function executeMarch$1(creep) {
    var _a, _b, _c;
    const pid = creep.memory.platoonId;
    const homeMemory = creep.memory.homeRoom ? (_a = Game.rooms[creep.memory.homeRoom]) === null || _a === void 0 ? void 0 : _a.memory : undefined;
    const orders = pid ? (_b = homeMemory === null || homeMemory === void 0 ? void 0 : homeMemory.platoonOrders) === null || _b === void 0 ? void 0 : _b[pid] : undefined;
    const targetRoom = creep.memory.targetRoomName;
    // FEINT: after the feint window expires, fall back home
    if ((orders === null || orders === void 0 ? void 0 : orders.tactic) === 'FEINT' && orders.feintEndTick && Game.time > orders.feintEndTick) {
        retreatToHome(creep);
        return;
    }
    // MAIN: hold at home until engageTick — let the feint platoon draw fire first
    if ((orders === null || orders === void 0 ? void 0 : orders.tactic) === 'MAIN' && orders.engageTick && Game.time < orders.engageTick) {
        if (isHome$2(creep))
            return; // already home, just wait
        travelHome$2(creep);
        return;
    }
    // FLANK / MAIN after delay: travel through waypoint room first
    const waypoint = orders === null || orders === void 0 ? void 0 : orders.waypointRoom;
    if (waypoint && creep.room.name !== waypoint && creep.room.name !== targetRoom) {
        moveToRoom$2(creep, waypoint);
        return;
    }
    // Standard: move to target room then engage
    if (targetRoom && creep.room.name !== targetRoom) {
        moveToRoom$2(creep, targetRoom);
        return;
    }
    // We're in the target room. If state is still MARCH the group hasn't fully
    // assembled yet — hold at room center so we don't engage alone.
    const currentState = (_c = homeMemory === null || homeMemory === void 0 ? void 0 : homeMemory.combatState) !== null && _c !== void 0 ? _c : 'RALLY';
    if (currentState === 'MARCH') {
        moveTo(creep, new RoomPosition(25, 25, creep.room.name), { reusePath: 5 });
        return;
    }
    engageInRoom(creep);
}
function rallyAtSpawn$1(creep) {
    if (!isHome$2(creep)) {
        travelHome$2(creep);
        return;
    }
    if (yieldToEconomy$2(creep))
        return; // don't block sources or containers
    const spawn = creep.pos.findClosestByPath(FIND_MY_SPAWNS);
    if (!spawn)
        return;
    const target = stagingSlot(creep.room, spawn, creep.name);
    if (creep.pos.getRangeTo(target) > 0) {
        moveTo(creep, target, { reusePath: 5 });
    }
}
function retreatToHome(creep) {
    if (!isHome$2(creep)) {
        travelHome$2(creep);
        return;
    }
    const spawn = creep.pos.findClosestByPath(FIND_MY_SPAWNS);
    if (!spawn)
        return;
    const target = stagingSlot(creep.room, spawn, creep.name);
    if (creep.pos.getRangeTo(target) > 0)
        moveTo(creep, target, { reusePath: 3 });
}
// ─── Yield & staging ─────────────────────────────────────────────────────────
// Returns true if the creep was blocking an economic tile and moved away.
// Call this during RALLY so combat units never park on sources or containers.
function yieldToEconomy$2(creep) {
    const adjacentSource = creep.pos.findInRange(FIND_SOURCES, 1).length > 0;
    const onContainer = creep.pos.lookFor(LOOK_STRUCTURES)
        .some(s => s.structureType === STRUCTURE_CONTAINER);
    if (!adjacentSource && !onContainer)
        return false;
    // Move away from the nearest source
    const source = creep.pos.findClosestByRange(FIND_SOURCES);
    if (source) {
        const dx = Math.sign(creep.pos.x - source.pos.x) || 1;
        const dy = Math.sign(creep.pos.y - source.pos.y) || 1;
        const tx = Math.min(48, Math.max(1, creep.pos.x + dx * 3));
        const ty = Math.min(48, Math.max(1, creep.pos.y + dy * 3));
        moveTo(creep, new RoomPosition(tx, ty, creep.room.name), { reusePath: 3 });
    }
    return true;
}
// djb2-style hash: maps a creep name to a stable slot index 0..count-1.
// Different warriors get different slots → they spread across the staging ring.
function nameSlot(name, count) {
    let h = 5381;
    for (let i = 0; i < name.length; i++)
        h = ((h << 5) + h + name.charCodeAt(i)) & 0xffff;
    return h % count;
}
// Collect all valid rally tiles in a ring around spawn (radius 4–8, away from
// sources/containers), then assign this warrior a unique tile by name hash.
// Minimum radius 4 (vs old 3) gives economy one extra tile of breathing room.
function stagingSlot(room, spawn, creepName) {
    const sources = room.find(FIND_SOURCES);
    const containers = room.find(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_CONTAINER,
    });
    const terrain = room.getTerrain();
    const candidates = [];
    for (let r = 4; r <= 8; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r)
                    continue;
                const x = spawn.pos.x + dx;
                const y = spawn.pos.y + dy;
                if (x < 1 || x > 48 || y < 1 || y > 48)
                    continue;
                if (terrain.get(x, y) === TERRAIN_MASK_WALL)
                    continue;
                const pos = new RoomPosition(x, y, room.name);
                if (sources.some(s => pos.getRangeTo(s) < 3))
                    continue;
                if (containers.some(c => pos.getRangeTo(c) < 2))
                    continue;
                candidates.push(pos);
            }
        }
    }
    if (candidates.length === 0)
        return spawn.pos;
    return candidates[nameSlot(creepName, candidates.length)];
}
function isHome$2(creep) {
    var _a, _b;
    const home = creep.memory.homeRoom;
    if (home)
        return creep.room.name === home;
    return !!((_b = (_a = Game.rooms[creep.room.name]) === null || _a === void 0 ? void 0 : _a.controller) === null || _b === void 0 ? void 0 : _b.my); // fallback for legacy creeps
}
function travelHome$2(creep) {
    var _a;
    const dest = (_a = creep.memory.homeRoom) !== null && _a !== void 0 ? _a : Object.keys(Game.rooms).find(r => { var _a, _b; return (_b = (_a = Game.rooms[r]) === null || _a === void 0 ? void 0 : _a.controller) === null || _b === void 0 ? void 0 : _b.my; });
    if (dest)
        moveToRoom$2(creep, dest);
}
function engageInRoom(creep) {
    var _a;
    // Bait guard: if targetId is a stale hostile creep (e.g. orphaned from a dissolved quad)
    // that is no longer actively engaging us, discard it when priority targets remain.
    // This prevents warriors from chasing a kiting combat unit while the reserver/economy
    // creeps are alive and uncontested.  Quad members are unaffected — their targetId is
    // refreshed every tick by coordinateQuadTargets before this function runs.
    if (creep.memory.targetId) {
        const cached = Game.getObjectById(creep.memory.targetId);
        if (cached && 'body' in cached) {
            const ourUnits = creep.room.find(FIND_MY_CREEPS);
            if (!isEngaging$1(cached, ourUnits) && hasPriorityTargets$1(creep.room)) {
                creep.memory.targetId = undefined;
            }
        }
    }
    // Quad-coordinated target takes priority (set by quadManager, refreshed every tick)
    const quadTarget = creep.memory.targetId
        ? Game.getObjectById(creep.memory.targetId)
        : null;
    const target = (_a = quadTarget) !== null && _a !== void 0 ? _a : findCombatTarget(creep);
    if (!target) {
        // Patrol center — there may be nothing left to attack
        if (!followQuadLeader(creep))
            moveTo(creep, new RoomPosition(25, 25, creep.room.name), { reusePath: 10 });
        return;
    }
    const range = creep.pos.getRangeTo(target);
    // Ranged attack if we have RANGED_ATTACK parts and are within 3 tiles
    const hasRanged = creep.body.some(p => p.type === RANGED_ATTACK);
    if (hasRanged && range <= 3) {
        creep.rangedAttack(target);
    }
    // Melee attack if adjacent; otherwise move — quad non-leaders follow their
    // leader first so the formation stays tight, leaders move directly to target.
    if (range <= 1) {
        creep.attack(target);
    }
    else if (!followQuadLeader(creep)) {
        moveTo(creep, target, { reusePath: 3 });
    }
}
function findCombatTarget(creep) {
    // Mirrors pickQuadTarget priority — see quadManager.ts for the full rationale.
    // Independent (non-quad) warriors use findClosestByPath so multiple warriors
    // naturally spread across different economy targets rather than piling on one.
    const tower = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER,
    });
    if (tower)
        return tower;
    const allHostiles = creep.room.find(FIND_HOSTILE_CREEPS);
    const ourUnits = creep.room.find(FIND_MY_CREEPS);
    // 1. Active threats only — enemy combat parts within attack range of any of our units.
    const threat = creep.pos.findClosestByPath(allHostiles.filter(c => isEngaging$1(c, ourUnits)));
    if (threat)
        return threat;
    // 2. Reserver — kills their controller reservation.
    const reserver = creep.pos.findClosestByPath(allHostiles.filter(c => c.body.some(p => p.type === CLAIM)));
    if (reserver)
        return reserver;
    // 3. Economy creeps (harvesters/haulers) — findClosestByPath spreads warriors across targets.
    const economy = creep.pos.findClosestByPath(allHostiles.filter(c => c.body.some(p => p.type === WORK || p.type === CARRY)));
    if (economy)
        return economy;
    // 4. Passive/fleeing combatants — only once the room is clear of economy targets.
    if (allHostiles.length > 0)
        return creep.pos.findClosestByPath(allHostiles);
    const spawn = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_SPAWN,
    });
    if (spawn)
        return spawn;
    return creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES);
}
// True when the enemy has live ATTACK or RANGED_ATTACK parts within their effective
// attack range of at least one of our creeps — i.e. they are actively engaging us.
function isEngaging$1(enemy, allies) {
    const meleeRange = enemy.body.some(p => p.type === ATTACK && p.hits > 0) ? 1 : 0;
    const rangedRange = enemy.body.some(p => p.type === RANGED_ATTACK && p.hits > 0) ? 3 : 0;
    const attackRange = Math.max(meleeRange, rangedRange);
    if (attackRange === 0)
        return false;
    return allies.some(ally => enemy.pos.getRangeTo(ally) <= attackRange);
}
// True when the room still has reserver/economy creeps — used by the bait guard to
// decide whether ignoring a non-engaging combatant is the right call.
function hasPriorityTargets$1(room) {
    return room.find(FIND_HOSTILE_CREEPS).some(c => c.body.some(p => p.type === CLAIM || p.type === WORK || p.type === CARRY));
}
function moveToRoom$2(creep, roomName) {
    const exitDir = creep.room.findExitTo(roomName);
    if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
        const exit = creep.pos.findClosestByRange(exitDir);
        if (exit)
            moveTo(creep, exit, { reusePath: 3 });
    }
}

// Ranged attacker: stays at 3-tile range, kites melee enemies, uses rangedMassAttack
// when multiple enemies cluster. Shares rally/march/engage state with warriors.
const RETREAT_HP = 0.25;
const KITE_RANGE = 3; // ideal engagement distance
function runRanger(creep) {
    var _a, _b;
    if (creep.hits < creep.hitsMax) {
        creep.heal(creep); // HEAL is a separate action, always fires
    }
    if (creep.hits < creep.hitsMax * RETREAT_HP) {
        retreat(creep);
        return;
    }
    const homeMemory = creep.memory.homeRoom ? (_a = Game.rooms[creep.memory.homeRoom]) === null || _a === void 0 ? void 0 : _a.memory : undefined;
    const combatState = (_b = homeMemory === null || homeMemory === void 0 ? void 0 : homeMemory.combatState) !== null && _b !== void 0 ? _b : 'RALLY';
    if (combatState === 'RALLY' && creep.memory.defendingRoom) {
        defendRoom(creep);
        return;
    }
    switch (combatState) {
        case 'RALLY':
            rally(creep);
            break;
        case 'MARCH':
        case 'ENGAGE':
            executeMarch(creep);
            break;
    }
}
function defendRoom(creep) {
    const target = creep.memory.defendingRoom;
    if (creep.room.name !== target) {
        moveToRoom$1(creep, target);
        return;
    }
    engage(creep);
}
function engage(creep) {
    var _a;
    const nearbyEnemies = creep.pos.findInRange(FIND_HOSTILE_CREEPS, KITE_RANGE);
    if (nearbyEnemies.length >= 3) {
        creep.rangedMassAttack();
        return;
    }
    // Bait guard — mirrors warrior.ts engageInRoom; see there for full rationale.
    if (creep.memory.targetId) {
        const cached = Game.getObjectById(creep.memory.targetId);
        if (cached && 'body' in cached) {
            const ourUnits = creep.room.find(FIND_MY_CREEPS);
            if (!isEngaging(cached, ourUnits) && hasPriorityTargets(creep.room)) {
                creep.memory.targetId = undefined;
            }
        }
    }
    // Quad-coordinated target takes priority (refreshed every tick by coordinateQuadTargets)
    const quadTarget = creep.memory.targetId
        ? Game.getObjectById(creep.memory.targetId)
        : null;
    const target = (_a = quadTarget) !== null && _a !== void 0 ? _a : findTarget(creep);
    if (!target) {
        if (!followQuadLeader(creep))
            moveTo(creep, new RoomPosition(25, 25, creep.room.name), { reusePath: 10 });
        return;
    }
    const range = creep.pos.getRangeTo(target);
    if (range <= KITE_RANGE) {
        creep.rangedAttack(target);
    }
    if (range > KITE_RANGE) {
        // Close in — quad non-leaders follow their leader to keep formation tight
        if (!followQuadLeader(creep))
            moveTo(creep, target, { reusePath: 3 });
    }
    else if (range < 2) {
        // Too close for ranged — kite away (leaders and solo rangers only;
        // non-leaders defer to followQuadLeader which keeps them near the leader)
        if (creep.memory.isQuadLeader || !creep.memory.quadId) {
            const dx = creep.pos.x - target.pos.x;
            const dy = creep.pos.y - target.pos.y;
            const kiteDir = getDirection(dx, dy);
            if (kiteDir)
                creep.move(kiteDir);
        }
        else {
            followQuadLeader(creep);
        }
    }
}
function findTarget(creep) {
    // Same priority as warrior findCombatTarget — active threats → reserver → economy → fleeing.
    const tower = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER,
    });
    if (tower)
        return tower;
    const allHostiles = creep.room.find(FIND_HOSTILE_CREEPS);
    const ourUnits = creep.room.find(FIND_MY_CREEPS);
    const threat = creep.pos.findClosestByPath(allHostiles.filter(c => isEngaging(c, ourUnits)));
    if (threat)
        return threat;
    const reserver = creep.pos.findClosestByPath(allHostiles.filter(c => c.body.some(p => p.type === CLAIM)));
    if (reserver)
        return reserver;
    const economy = creep.pos.findClosestByPath(allHostiles.filter(c => c.body.some(p => p.type === WORK || p.type === CARRY)));
    if (economy)
        return economy;
    if (allHostiles.length > 0)
        return creep.pos.findClosestByPath(allHostiles);
    return creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES);
}
function isEngaging(enemy, allies) {
    const meleeRange = enemy.body.some(p => p.type === ATTACK && p.hits > 0) ? 1 : 0;
    const rangedRange = enemy.body.some(p => p.type === RANGED_ATTACK && p.hits > 0) ? 3 : 0;
    const attackRange = Math.max(meleeRange, rangedRange);
    if (attackRange === 0)
        return false;
    return allies.some(ally => enemy.pos.getRangeTo(ally) <= attackRange);
}
function hasPriorityTargets(room) {
    return room.find(FIND_HOSTILE_CREEPS).some(c => c.body.some(p => p.type === CLAIM || p.type === WORK || p.type === CARRY));
}
function executeMarch(creep) {
    var _a, _b, _c;
    const pid = creep.memory.platoonId;
    const homeMemory = creep.memory.homeRoom ? (_a = Game.rooms[creep.memory.homeRoom]) === null || _a === void 0 ? void 0 : _a.memory : undefined;
    const orders = pid ? (_b = homeMemory === null || homeMemory === void 0 ? void 0 : homeMemory.platoonOrders) === null || _b === void 0 ? void 0 : _b[pid] : undefined;
    const targetRoom = creep.memory.targetRoomName;
    if ((orders === null || orders === void 0 ? void 0 : orders.tactic) === 'FEINT' && orders.feintEndTick && Game.time > orders.feintEndTick) {
        retreat(creep);
        return;
    }
    if ((orders === null || orders === void 0 ? void 0 : orders.tactic) === 'MAIN' && orders.engageTick && Game.time < orders.engageTick) {
        if (isHome$1(creep))
            return;
        travelHome$1(creep);
        return;
    }
    const waypoint = orders === null || orders === void 0 ? void 0 : orders.waypointRoom;
    if (waypoint && creep.room.name !== waypoint && creep.room.name !== targetRoom) {
        moveToRoom$1(creep, waypoint);
        return;
    }
    if (targetRoom && creep.room.name !== targetRoom) {
        moveToRoom$1(creep, targetRoom);
        return;
    }
    // In the target room but group not fully assembled — hold at center.
    const currentState = (_c = homeMemory === null || homeMemory === void 0 ? void 0 : homeMemory.combatState) !== null && _c !== void 0 ? _c : 'RALLY';
    if (currentState === 'MARCH') {
        moveTo(creep, new RoomPosition(25, 25, creep.room.name), { reusePath: 5 });
        return;
    }
    engage(creep);
}
function rally(creep) {
    if (!isHome$1(creep)) {
        travelHome$1(creep);
        return;
    }
    if (yieldToEconomy$1(creep))
        return;
    const spawn = creep.pos.findClosestByPath(FIND_MY_SPAWNS);
    if (!spawn)
        return;
    const target = stagingArea$1(creep.room, spawn);
    if (creep.pos.getRangeTo(target) > 1) {
        moveTo(creep, target, { reusePath: 5 });
    }
}
function retreat(creep) {
    if (!isHome$1(creep)) {
        travelHome$1(creep);
        return;
    }
    const spawn = creep.pos.findClosestByPath(FIND_MY_SPAWNS);
    if (spawn)
        moveTo(creep, spawn, { reusePath: 3 });
}
function yieldToEconomy$1(creep) {
    const adjacentSource = creep.pos.findInRange(FIND_SOURCES, 1).length > 0;
    const onContainer = creep.pos.lookFor(LOOK_STRUCTURES)
        .some(s => s.structureType === STRUCTURE_CONTAINER);
    if (!adjacentSource && !onContainer)
        return false;
    const source = creep.pos.findClosestByRange(FIND_SOURCES);
    if (source) {
        const dx = Math.sign(creep.pos.x - source.pos.x) || 1;
        const dy = Math.sign(creep.pos.y - source.pos.y) || 1;
        moveTo(creep, new RoomPosition(Math.min(48, Math.max(1, creep.pos.x + dx * 3)), Math.min(48, Math.max(1, creep.pos.y + dy * 3)), creep.room.name), { reusePath: 3 });
    }
    return true;
}
function stagingArea$1(room, spawn) {
    const sources = room.find(FIND_SOURCES);
    const containers = room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_CONTAINER });
    const terrain = room.getTerrain();
    for (let r = 3; r <= 10; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r)
                    continue;
                const x = spawn.pos.x + dx, y = spawn.pos.y + dy;
                if (x < 1 || x > 48 || y < 1 || y > 48)
                    continue;
                if (terrain.get(x, y) === TERRAIN_MASK_WALL)
                    continue;
                const pos = new RoomPosition(x, y, room.name);
                if (sources.some(s => pos.getRangeTo(s) < 3))
                    continue;
                if (containers.some(c => pos.getRangeTo(c) < 2))
                    continue;
                return pos;
            }
        }
    }
    return spawn.pos;
}
function isHome$1(creep) {
    var _a, _b;
    const home = creep.memory.homeRoom;
    if (home)
        return creep.room.name === home;
    return !!((_b = (_a = Game.rooms[creep.room.name]) === null || _a === void 0 ? void 0 : _a.controller) === null || _b === void 0 ? void 0 : _b.my);
}
function travelHome$1(creep) {
    var _a;
    const dest = (_a = creep.memory.homeRoom) !== null && _a !== void 0 ? _a : Object.keys(Game.rooms).find(r => { var _a, _b; return (_b = (_a = Game.rooms[r]) === null || _a === void 0 ? void 0 : _a.controller) === null || _b === void 0 ? void 0 : _b.my; });
    if (dest)
        moveToRoom$1(creep, dest);
}
function moveToRoom$1(creep, roomName) {
    const exitDir = creep.room.findExitTo(roomName);
    if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
        const exit = creep.pos.findClosestByRange(exitDir);
        if (exit)
            moveTo(creep, exit, { reusePath: 3 });
    }
}
function getDirection(dx, dy) {
    if (dx === 0 && dy === 0)
        return null;
    const angle = Math.atan2(dy, dx);
    // Map angle to Screeps direction (1=TOP, 2=TOP_RIGHT, etc.)
    const octant = Math.round(angle / (Math.PI / 4));
    const dirs = [RIGHT, BOTTOM_RIGHT, BOTTOM, BOTTOM_LEFT, LEFT, TOP_LEFT, TOP, TOP_RIGHT];
    return dirs[((octant % 8) + 8) % 8];
}

// Healer: attached to a platoon via creep.memory.platoonId.
// Follows platoon orders (same as warrior/ranger): respects FEINT timing,
// MAIN hold-and-wait, FLANK waypoints. Then heals the most wounded ally.
// Reads combat state from homeRoom.memory.combatState (per-room FSM).
const HEAL_THRESHOLD = 0.85;
function runHealer(creep) {
    var _a, _b, _c;
    // Self-heal always fires independently
    if (creep.hits < creep.hitsMax) {
        creep.heal(creep);
    }
    const homeMemory = creep.memory.homeRoom ? (_a = Game.rooms[creep.memory.homeRoom]) === null || _a === void 0 ? void 0 : _a.memory : undefined;
    const combatState = (_b = homeMemory === null || homeMemory === void 0 ? void 0 : homeMemory.combatState) !== null && _b !== void 0 ? _b : 'RALLY';
    if (combatState === 'RALLY') {
        if (creep.memory.defendingRoom) {
            const target = creep.memory.defendingRoom;
            if (creep.room.name !== target) {
                moveToRoom(creep, target);
                return;
            }
            healPlatoon(creep);
            return;
        }
        rallyAtSpawn(creep);
        return;
    }
    // MARCH or ENGAGE — follow the platoon's assigned route
    const pid = creep.memory.platoonId;
    const orders = pid ? (_c = homeMemory === null || homeMemory === void 0 ? void 0 : homeMemory.platoonOrders) === null || _c === void 0 ? void 0 : _c[pid] : undefined;
    const targetRoom = creep.memory.targetRoomName;
    // MAIN tactic: hold home until the feint platoon has drawn fire
    if ((orders === null || orders === void 0 ? void 0 : orders.tactic) === 'MAIN' && orders.engageTick && Game.time < orders.engageTick) {
        if (!isHome(creep)) {
            travelHome(creep);
        }
        return;
    }
    // Route through waypoint first (for FLANK / MAIN)
    const waypoint = orders === null || orders === void 0 ? void 0 : orders.waypointRoom;
    if (waypoint && creep.room.name !== waypoint && creep.room.name !== targetRoom) {
        moveToRoom(creep, waypoint);
        return;
    }
    // Travel to enemy room
    if (targetRoom && creep.room.name !== targetRoom) {
        moveToRoom(creep, targetRoom);
        return;
    }
    // In the target room — heal the platoon
    healPlatoon(creep);
}
function healPlatoon(creep) {
    const platoonId = creep.memory.platoonId;
    const allies = creep.room.find(FIND_MY_CREEPS, {
        filter: c => (c.memory.role === 'warrior' || c.memory.role === 'ranger') &&
            (!platoonId || c.memory.platoonId === platoonId),
    });
    // Fall back to any allied fighter if platoon is empty
    const targets = allies.length > 0
        ? allies
        : creep.room.find(FIND_MY_CREEPS, {
            filter: c => c.memory.role === 'warrior' || c.memory.role === 'ranger',
        });
    if (targets.length === 0) {
        moveTo(creep, new RoomPosition(25, 25, creep.room.name), { reusePath: 10 });
        return;
    }
    const wounded = targets.filter(c => c.hits < c.hitsMax * HEAL_THRESHOLD);
    const healTarget = wounded.length > 0
        ? wounded.reduce((a, b) => a.hits / a.hitsMax < b.hits / b.hitsMax ? a : b)
        : creep.pos.findClosestByRange(targets);
    const range = creep.pos.getRangeTo(healTarget);
    if (range <= 1) {
        creep.heal(healTarget);
    }
    else if (range <= 3) {
        creep.rangedHeal(healTarget);
        moveTo(creep, healTarget, { reusePath: 2 });
    }
    else {
        moveTo(creep, healTarget, { reusePath: 2 });
    }
}
function rallyAtSpawn(creep) {
    if (!isHome(creep)) {
        travelHome(creep);
        return;
    }
    if (yieldToEconomy(creep))
        return;
    const spawn = creep.pos.findClosestByPath(FIND_MY_SPAWNS);
    if (!spawn)
        return;
    const target = stagingArea(creep.room, spawn);
    if (creep.pos.getRangeTo(target) > 1) {
        moveTo(creep, target, { reusePath: 5 });
    }
}
function yieldToEconomy(creep) {
    const adjacentSource = creep.pos.findInRange(FIND_SOURCES, 1).length > 0;
    const onContainer = creep.pos.lookFor(LOOK_STRUCTURES)
        .some(s => s.structureType === STRUCTURE_CONTAINER);
    if (!adjacentSource && !onContainer)
        return false;
    const source = creep.pos.findClosestByRange(FIND_SOURCES);
    if (source) {
        const dx = Math.sign(creep.pos.x - source.pos.x) || 1;
        const dy = Math.sign(creep.pos.y - source.pos.y) || 1;
        moveTo(creep, new RoomPosition(Math.min(48, Math.max(1, creep.pos.x + dx * 3)), Math.min(48, Math.max(1, creep.pos.y + dy * 3)), creep.room.name), { reusePath: 3 });
    }
    return true;
}
function stagingArea(room, spawn) {
    const sources = room.find(FIND_SOURCES);
    const containers = room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_CONTAINER });
    const terrain = room.getTerrain();
    for (let r = 3; r <= 10; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r)
                    continue;
                const x = spawn.pos.x + dx, y = spawn.pos.y + dy;
                if (x < 1 || x > 48 || y < 1 || y > 48)
                    continue;
                if (terrain.get(x, y) === TERRAIN_MASK_WALL)
                    continue;
                const pos = new RoomPosition(x, y, room.name);
                if (sources.some(s => pos.getRangeTo(s) < 3))
                    continue;
                if (containers.some(c => pos.getRangeTo(c) < 2))
                    continue;
                return pos;
            }
        }
    }
    return spawn.pos;
}
function isHome(creep) {
    var _a, _b;
    const home = creep.memory.homeRoom;
    if (home)
        return creep.room.name === home;
    return !!((_b = (_a = Game.rooms[creep.room.name]) === null || _a === void 0 ? void 0 : _a.controller) === null || _b === void 0 ? void 0 : _b.my);
}
function travelHome(creep) {
    var _a;
    const dest = (_a = creep.memory.homeRoom) !== null && _a !== void 0 ? _a : Object.keys(Game.rooms).find(r => { var _a, _b; return (_b = (_a = Game.rooms[r]) === null || _a === void 0 ? void 0 : _a.controller) === null || _b === void 0 ? void 0 : _b.my; });
    if (dest)
        moveToRoom(creep, dest);
}
function moveToRoom(creep, roomName) {
    const exitDir = creep.room.findExitTo(roomName);
    if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
        const exit = creep.pos.findClosestByRange(exitDir);
        if (exit)
            moveTo(creep, exit, { reusePath: 3 });
    }
}

const ECONOMY_CREEP_TARGET = 3; // start scouting at 3 creeps, not 5
const RUSH_STRENGTH_THRESHOLD = 30; // attack enemies up to this strength (was 10)
const OPPORTUNISTIC_THRESHOLD = 15; // attack immediately without full ASSESS if this weak
const REASSESS_COOLDOWN = 100; // ticks between re-assess attempts (was 500)
const RUSH_TIMEOUT = 2000;
const SAFE_MODE_PREPARE_TICKS = 2000;
// How fresh intel must be to act on it for an attack
const MAX_ATTACK_INTEL_AGE = 500;
function updatePhase(room) {
    var _a, _b, _c;
    // ── Safe mode override ────────────────────────────────────────────────────
    const safeMode = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.safeMode) !== null && _b !== void 0 ? _b : 0;
    if (safeMode > 0) {
        if (room.memory.phase !== 'ECONOMY') {
            room.memory.phase = 'ECONOMY';
            console.log(`[${room.name}] Safe mode active (${safeMode}t left) → forcing ECONOMY`);
        }
        if (safeMode < SAFE_MODE_PREPARE_TICKS && room.memory.phase === 'ECONOMY') {
            room.memory.phase = 'ASSESS';
            room.memory.scoutTick = undefined;
            console.log(`[${room.name}] Safe mode expiring → ASSESS`);
        }
        return;
    }
    const phase = (_c = room.memory.phase) !== null && _c !== void 0 ? _c : 'ECONOMY';
    if (!Memory.roomIntel)
        Memory.roomIntel = {};
    const myCreeps = room.find(FIND_MY_CREEPS).length;
    switch (phase) {
        case 'ECONOMY': {
            const cooldownDone = !room.memory.phaseTick || Game.time >= room.memory.phaseTick;
            if (!cooldownDone)
                break;
            // Opportunistic attack: if we can see a juicy weak target, skip ASSESS and RUSH now.
            // This is how we attack unprovoked — we don't wait to be threatened.
            if (myCreeps >= ECONOMY_CREEP_TARGET) {
                const weak = findBestTarget(room, OPPORTUNISTIC_THRESHOLD);
                if (weak) {
                    room.memory.phase = 'RUSH';
                    room.memory.phaseTick = Game.time;
                    room.memory.combatState = 'RALLY';
                    room.memory.enemyRoomName = weak.name;
                    room.memory.enemyStrength = weak.strength;
                    console.log(`[${room.name}] → RUSH opportunistic (${weak.name} str=${weak.strength} val=${weak.value})`);
                    break;
                }
                // Otherwise transition to ASSESS to send scout
                room.memory.phase = 'ASSESS';
                room.memory.phaseTick = Game.time;
                room.memory.scoutTick = undefined;
                console.log(`[${room.name}] → ASSESS at tick ${Game.time}`);
            }
            break;
        }
        case 'ASSESS':
            if (room.memory.scoutTick !== undefined) {
                const target = findBestTarget(room, RUSH_STRENGTH_THRESHOLD);
                if (target) {
                    room.memory.phase = 'RUSH';
                    room.memory.phaseTick = Game.time;
                    room.memory.enemyRoomName = target.name;
                    room.memory.enemyStrength = target.strength;
                    console.log(`[${room.name}] → RUSH (${target.name} str=${target.strength} val=${target.value})`);
                }
                else {
                    // No viable target found — check if any strong enemy needs defending against
                    const strong = findStrongestThreat();
                    if (strong) {
                        room.memory.phase = 'DEFEND';
                        room.memory.phaseTick = Game.time;
                        room.memory.enemyRoomName = strong.name;
                        room.memory.enemyStrength = strong.strength;
                        console.log(`[${room.name}] → DEFEND (${strong.name} str=${strong.strength})`);
                    }
                    else {
                        room.memory.phase = 'ECONOMY';
                        room.memory.phaseTick = Game.time + REASSESS_COOLDOWN;
                        console.log(`[${room.name}] → ECONOMY (no viable targets, reassess at ${room.memory.phaseTick})`);
                    }
                }
            }
            break;
        case 'RUSH': {
            const combatUnits = room.find(FIND_MY_CREEPS, {
                filter: c => (c.memory.role === 'warrior' || c.memory.role === 'ranger') &&
                    c.memory.homeRoom === room.name,
            }).length;
            const enemyIntel = room.memory.enemyRoomName ? Memory.roomIntel[room.memory.enemyRoomName] : undefined;
            const targetCleared = enemyIntel && enemyIntel.strength === 0 && Game.time - enemyIntel.scannedAt < 100;
            if (targetCleared) {
                console.log(`[${room.name}] RUSH succeeded — ${room.memory.enemyRoomName} cleared`);
                // Chain attack: immediately look for the next weak target instead of resting
                chainAttack(room);
                break;
            }
            if (combatUnits === 0 && myCreeps > 0) {
                console.log(`[${room.name}] RUSH failed — no combat units`);
                chainAttack(room);
                break;
            }
            if (myCreeps === 0) {
                resetToEconomy(room);
                break;
            }
            if (room.memory.phaseTick && Game.time - room.memory.phaseTick > RUSH_TIMEOUT) {
                console.log(`[${room.name}] RUSH timed out`);
                chainAttack(room);
            }
            break;
        }
        case 'DEFEND': {
            const enemies = room.find(FIND_HOSTILE_CREEPS).length;
            const enemyIntel = room.memory.enemyRoomName ? Memory.roomIntel[room.memory.enemyRoomName] : undefined;
            const threatCleared = enemyIntel && enemyIntel.strength === 0 && Game.time - enemyIntel.scannedAt < 100;
            if (enemies === 0 && threatCleared) {
                console.log(`[${room.name}] DEFEND succeeded — counterattacking`);
                chainAttack(room); // don't rest after defending, look for counter-target
            }
            else if (myCreeps === 0) {
                resetToEconomy(room);
            }
            break;
        }
    }
}
function findBestTarget(room, maxStrength) {
    var _a, _b;
    const intel = (_a = Memory.roomIntel) !== null && _a !== void 0 ? _a : {};
    const ownedNames = new Set(Object.values(Game.rooms).filter(r => { var _a; return (_a = r.controller) === null || _a === void 0 ? void 0 : _a.my; }).map(r => r.name));
    const reserved = new Set(Object.keys((_b = room.memory.remoteRooms) !== null && _b !== void 0 ? _b : {}));
    let best = null;
    for (const [name, data] of Object.entries(intel)) {
        if (ownedNames.has(name))
            continue; // don't attack ourselves
        if (reserved.has(name))
            continue; // don't attack rooms we're harvesting
        if (data.strength > maxStrength)
            continue;
        if (data.strength === 0)
            continue; // room is already empty
        if (Game.time - data.scannedAt > MAX_ATTACK_INTEL_AGE)
            continue; // stale
        // Economic attack value: spawn is worth most (destroys economy), towers add risk cost
        // Prefer player-owned rooms (enemy spawns) over invader rooms
        const value = (data.enemySpawns * 120) // spawn = biggest economic target
            + (data.controllerOwned ? 50 : 0) // player rooms are higher priority than NPC
            - (data.enemyTowers * 30) // towers = increased cost to attack
            - (data.strength * 2); // lower strength = easier target
        if (!best || value > best.value) {
            best = { name, strength: data.strength, value };
        }
    }
    return best;
}
function findStrongestThreat(room) {
    var _a;
    const intel = (_a = Memory.roomIntel) !== null && _a !== void 0 ? _a : {};
    const ownedNames = new Set(Object.values(Game.rooms).filter(r => { var _a; return (_a = r.controller) === null || _a === void 0 ? void 0 : _a.my; }).map(r => r.name));
    let worst = null;
    for (const [name, data] of Object.entries(intel)) {
        if (ownedNames.has(name))
            continue;
        if (data.strength === 0)
            continue;
        if (Game.time - data.scannedAt > MAX_ATTACK_INTEL_AGE)
            continue;
        if (!worst || data.strength > worst.strength) {
            worst = { name, strength: data.strength, value: -data.strength };
        }
    }
    return worst;
}
// ─── Chain attack ─────────────────────────────────────────────────────────────
// After clearing or abandoning a RUSH, immediately look for the next target
// rather than retreating to ECONOMY. This keeps continuous offensive pressure.
function chainAttack(room) {
    // Reset combat state to rally for next campaign
    room.memory.combatState = 'RALLY';
    room.memory.enemyRoomName = undefined;
    room.memory.enemyStrength = undefined;
    room.memory.scoutTick = undefined;
    const next = findBestTarget(room, RUSH_STRENGTH_THRESHOLD);
    if (next) {
        room.memory.phase = 'RUSH';
        room.memory.phaseTick = Game.time;
        room.memory.enemyRoomName = next.name;
        room.memory.enemyStrength = next.strength;
        console.log(`[${room.name}] → RUSH chaining (${next.name} str=${next.strength} val=${next.value})`);
    }
    else {
        // No current target — go to ASSESS to get fresh scout data
        room.memory.phase = 'ASSESS';
        room.memory.phaseTick = Game.time;
        console.log(`[${room.name}] → ASSESS (no chain target available)`);
    }
}
function resetToEconomy(room) {
    room.memory.phase = 'ECONOMY';
    room.memory.phaseTick = undefined;
    room.memory.combatState = 'RALLY';
    room.memory.enemyRoomName = undefined;
    room.memory.enemyStrength = undefined;
    room.memory.scoutTick = undefined;
    room.memory.roadsPlanned = false;
}

// Dynamic body builder — scales creep bodies to the available energy budget.
// Part ordering follows Screeps convention: TOUGH first (absorbs damage), MOVE last (stays mobile longest).
function buildBody(role, budget, opts) {
    var _a;
    switch (role) {
        case 'harvester': return harvesterBody(budget, (_a = opts === null || opts === void 0 ? void 0 : opts.mobile) !== null && _a !== void 0 ? _a : false);
        case 'hauler': return haulerBody(budget);
        case 'upgrader': return upgraderBody(budget);
        case 'builder':
        case 'repairer': return workerBody(budget);
        case 'scavenger': return scavengerBody(budget);
        case 'courier': return courierBody(budget);
        case 'reserver': return reserverBody(budget);
        case 'warrior': return warriorBody(budget);
        case 'ranger': return rangerBody(budget);
        case 'scout': return scoutBody(budget);
        case 'claimer': return claimerBody(budget);
        case 'healer': return healerBody(budget);
        default: return null;
    }
}
// ─── Economic roles ───────────────────────────────────────────────────────────
// Harvester body: stationary by default (parks at source container, maximises WORK).
// Pass mobile:true when no containers exist (RC1 bootstrap or after containers are lost) —
// the harvester must walk to deliver, so it needs road-speed movement.
function harvesterBody(budget, mobile) {
    if (mobile) {
        // [W, C, M, M] = 250e: 1:1 non-MOVE:MOVE ratio → full road speed
        if (budget < 250)
            return null;
        return [WORK, CARRY, MOVE, MOVE];
    }
    if (budget < 200)
        return null;
    const w = Math.min(Math.floor((budget - 100) / 100), 6); // reserve 100 for CARRY+MOVE
    return [...r(WORK, w), CARRY, MOVE];
}
// Road-optimized hauler: 2 CARRY per 1 MOVE (roads halve movement cost).
// Each [CC,M] unit = 150e = 100e cargo capacity.
function haulerBody(budget) {
    if (budget < 150)
        return null;
    const units = Math.min(Math.floor(budget / 150), 10);
    return [...r(CARRY, units * 2), ...r(MOVE, units)];
}
// Dedicated upgrader: WORK-heavy with enough CARRY/MOVE to sustain near controller.
// Repeat unit [W,W,C,M] = 350e. Falls back to [W,C,M] if budget is tight.
function upgraderBody(budget) {
    if (budget < 200)
        return null;
    if (budget < 350)
        return [WORK, CARRY, MOVE];
    const units = Math.min(Math.floor(budget / 350), 10);
    return [...r(WORK, units * 2), ...r(CARRY, units), ...r(MOVE, units)];
}
// General worker (builder / repairer): balanced WORK, CARRY, MOVE.
// Repeat unit [W,C,M] = 200e.
function workerBody(budget) {
    if (budget < 200)
        return null;
    const units = Math.min(Math.floor(budget / 200), 8);
    return [...r(WORK, units), ...r(CARRY, units), ...r(MOVE, units)];
}
// Reserver: CLAIM + MOVE for fast travel to adjacent rooms.
// 1 CLAIM part: net 0/tick (reserves +1, decay -1 = holds flat).
// 2 CLAIM parts: net +1/tick (reserves +2, decay -1 = builds buffer). Use when affordable.
function reserverBody(budget) {
    if (budget < 650)
        return null;
    if (budget >= 1300) {
        // 2-CLAIM body: actively builds the reservation buffer instead of just holding it flat.
        const extraMoves = Math.min(Math.floor((budget - 1300) / 50), 4);
        return [CLAIM, CLAIM, ...r(MOVE, 2 + extraMoves)];
    }
    const extraMoves = Math.min(Math.floor((budget - 650) / 50), 4);
    return [CLAIM, ...r(MOVE, 1 + extraMoves)];
}
// Scavenger: fast looter — equal CARRY and MOVE for full-road speed plus TOUGH buffer.
// Repeat unit [T,C,M] = 180e. Cap at 8 units. Does not need WORK.
function scavengerBody(budget) {
    if (budget < 180)
        return null;
    const units = Math.min(Math.floor(budget / 180), 8);
    return [...r(TOUGH, units), ...r(CARRY, units), ...r(MOVE, units)];
}
// Courier: high-carry hauler for inter-room trips on plains (1:1 CARRY:MOVE).
// Repeat unit [C,M] = 100e. No TOUGH — trips through owned rooms only.
function courierBody(budget) {
    if (budget < 100)
        return null;
    const units = Math.min(Math.floor(budget / 100), 16);
    return [...r(CARRY, units), ...r(MOVE, units)];
}
// ─── Combat roles ─────────────────────────────────────────────────────────────
// Melee warrior: TOUGH buffer, ATTACK, HEAL (self-repair), MOVE.
// Repeat unit [T,A,H,M,M] = 440e.
function warriorBody(budget) {
    if (budget < 130)
        return null;
    if (budget < 260)
        return [ATTACK, MOVE];
    if (budget < 440)
        return [ATTACK, ATTACK, MOVE, MOVE];
    const units = Math.min(Math.floor(budget / 440), 8);
    return [...r(TOUGH, units), ...r(ATTACK, units), ...r(HEAL, units), ...r(MOVE, units * 2)];
}
// Ranged attacker: TOUGH buffer, RANGED_ATTACK, HEAL, MOVE.
// Repeat unit [T,RA,H,M,M] = 510e. Stays at range 3 and kites melee enemies.
function rangerBody(budget) {
    if (budget < 200)
        return null;
    if (budget < 400)
        return [RANGED_ATTACK, MOVE, MOVE]; // 250e basic
    if (budget < 510)
        return [RANGED_ATTACK, HEAL, MOVE, MOVE]; // 500e with self-heal
    const units = Math.min(Math.floor(budget / 510), 6);
    return [...r(TOUGH, units), ...r(RANGED_ATTACK, units), ...r(HEAL, units), ...r(MOVE, units * 2)];
}
// ─── Utility roles ────────────────────────────────────────────────────────────
function scoutBody(budget) {
    if (budget < 50)
        return null;
    // Pure-MOVE creeps have zero body weight → zero fatigue → full speed on all terrain.
    // Extra MOVE parts add cost with no benefit.
    return [MOVE];
}
// CLAIM is 600e. Extra MOVE for faster travel to the target room.
function claimerBody(budget) {
    if (budget < 650)
        return null;
    const extraMoves = Math.min(Math.floor((budget - 600) / 50), 4);
    return [CLAIM, ...r(MOVE, 1 + extraMoves)];
}
// Healer: pure support — TOUGH buffer, HEAL, MOVE. No attack parts.
// Repeat unit [T,H,M,M] = 360e. Stays behind warriors, heals the most wounded.
function healerBody(budget) {
    if (budget < 300)
        return null;
    if (budget < 360)
        return [HEAL, MOVE]; // 300e minimum
    const units = Math.min(Math.floor(budget / 360), 8);
    return [...r(TOUGH, units), ...r(HEAL, units), ...r(MOVE, units * 2)];
}
// ─── Helpers ──────────────────────────────────────────────────────────────────
function r(part, n) {
    return Array(n).fill(part);
}

// Manages room expansion: find a target → send claimer → bootstrap new room.
//
// Requirements before expanding:
//   • Main room RCL ≥ 4  (stable economy with storage)
//   • GCL allows another room
//   • A suitable unowned room is in our intel
const MIN_RCL_TO_EXPAND = 4;
const BOOTSTRAP_HARVESTERS = 2;
const BOOTSTRAP_HAULERS = 2;
const BOOTSTRAP_BUILDERS = 2;
function manageExpansion(mainRoom) {
    var _a, _b, _c, _d, _e, _f, _g;
    const state = (_a = Memory.expansionState) !== null && _a !== void 0 ? _a : 'IDLE';
    const ownedCount = Object.values(Game.rooms).filter(r => { var _a; return (_a = r.controller) === null || _a === void 0 ? void 0 : _a.my; }).length;
    const canExpand = ownedCount < Game.gcl.level;
    switch (state) {
        case 'IDLE': {
            const rcl = (_c = (_b = mainRoom.controller) === null || _b === void 0 ? void 0 : _b.level) !== null && _c !== void 0 ? _c : 0;
            if (!canExpand || rcl < MIN_RCL_TO_EXPAND)
                break;
            const target = findExpansionTarget();
            if (target) {
                Memory.expansionTarget = target;
                Memory.expansionState = 'CLAIMING';
                console.log(`[adaptive] Expansion -> CLAIMING ${target}`);
            }
            break;
        }
        case 'CLAIMING': {
            const target = Memory.expansionTarget;
            if (!target) {
                Memory.expansionState = 'IDLE';
                break;
            }
            // Check if we've successfully claimed the room
            const targetRoom = Game.rooms[target];
            if ((_d = targetRoom === null || targetRoom === void 0 ? void 0 : targetRoom.controller) === null || _d === void 0 ? void 0 : _d.my) {
                Memory.expansionState = 'BOOTSTRAPPING';
                Memory.expansionRoomName = target;
                console.log(`[adaptive] Expansion -> BOOTSTRAPPING ${target}`);
            }
            // spawnManager handles spawning the claimer
            break;
        }
        case 'BOOTSTRAPPING': {
            const roomName = Memory.expansionRoomName;
            if (!roomName) {
                Memory.expansionState = 'IDLE';
                break;
            }
            const newRoom = Game.rooms[roomName];
            if (!((_e = newRoom === null || newRoom === void 0 ? void 0 : newRoom.controller) === null || _e === void 0 ? void 0 : _e.my)) {
                // Lost the room — reset
                Memory.expansionState = 'IDLE';
                break;
            }
            if (newRoom.find(FIND_MY_SPAWNS).length > 0) {
                // Delay ACTIVE until the new room has at least one harvester homed to it.
                // Without this, rooms that already have a spawn skip BOOTSTRAPPING entirely,
                // leaving them with no harvesters and a spawn that can't afford to spawn one.
                const hasHomeHarvester = Object.values(Game.creeps).some(c => c.memory.homeRoom === roomName && c.memory.role === 'harvester');
                if (hasHomeHarvester) {
                    Memory.expansionState = 'ACTIVE';
                    console.log(`[adaptive] Expansion -> ACTIVE ${roomName}`);
                }
            }
            // spawnManager sends bootstrap workers from main room
            break;
        }
        case 'ACTIVE': {
            const roomName = Memory.expansionRoomName;
            if (!roomName || !((_g = (_f = Game.rooms[roomName]) === null || _f === void 0 ? void 0 : _f.controller) === null || _g === void 0 ? void 0 : _g.my)) {
                Memory.expansionState = 'IDLE';
                Memory.expansionTarget = undefined;
                Memory.expansionRoomName = undefined;
                console.log('[adaptive] Expansion room lost — resetting');
            }
            break;
        }
    }
}
function findExpansionTarget() {
    var _a;
    const intel = (_a = Memory.roomIntel) !== null && _a !== void 0 ? _a : {};
    const candidates = Object.entries(intel)
        .filter(([_, d]) => d.hasController && !d.controllerOwned && d.strength === 0)
        .sort((a, b) => { var _a, _b; return ((_a = b[1].sourceCount) !== null && _a !== void 0 ? _a : 0) - ((_b = a[1].sourceCount) !== null && _b !== void 0 ? _b : 0); }); // prefer 2-source rooms
    return candidates.length > 0 ? candidates[0][0] : null;
}
// How many bootstrap workers the main room should send to the new room.
// Harvesters are included so the new room's spawn gets filled before ACTIVE state.
function bootstrapTargets() {
    if (Memory.expansionState !== 'BOOTSTRAPPING')
        return { harvester: 0, hauler: 0, builder: 0 };
    const roomName = Memory.expansionRoomName;
    if (!roomName)
        return { harvester: 0, hauler: 0, builder: 0 };
    const inNewRoom = Object.values(Game.creeps).filter(c => c.memory.homeRoom === roomName);
    return {
        harvester: Math.max(0, BOOTSTRAP_HARVESTERS - inNewRoom.filter(c => c.memory.role === 'harvester').length),
        hauler: Math.max(0, BOOTSTRAP_HAULERS - inNewRoom.filter(c => c.memory.role === 'hauler').length),
        builder: Math.max(0, BOOTSTRAP_BUILDERS - inNewRoom.filter(c => c.memory.role === 'builder').length),
    };
}

const _lastRun = {};
/**
 * Returns true at most once per `interval` ticks for a given `key`.
 * Fires on the first call after a global reset regardless of tick alignment.
 * From screeps-quorum Process.period() — ported to a standalone module utility.
 */
function period(interval, key) {
    var _a;
    const last = (_a = _lastRun[key]) !== null && _a !== void 0 ? _a : 0;
    if (Game.time - last >= interval) {
        _lastRun[key] = Game.time;
        return true;
    }
    return false;
}

const DEFAULT_PID_CONFIG = {
    kp: 3.0,
    ki: 0.2,
    kd: 1.5,
    setpoint: 0.60, // target 60% of total energy capacity
    outputMin: 0,
    outputMax: 4,
    outputMid: 1, // baseline = 1 upgrader at steady state
    integralMax: 5.0,
};
/**
 * Compute one PID step.
 *
 * @param pv    Process variable — current total energy (spawn + containers + storage)
 * @param cap   Total energy capacity (same components as pv)
 * @param state Previous PID state (integral, lastError, lastTick)
 * @param config PID tuning parameters
 * @param tick  Current game tick
 * @returns { output, nextState }
 *
 * Error is normalized: (pv - setpoint*cap) / cap → dimensionless, cap-independent.
 * Positive error = energy above setpoint → increase sinks (more upgraders).
 * Negative error = energy below setpoint → decrease sinks (fewer upgraders).
 * Output is offsetted by outputMid so zero error → outputMid (baseline upgrader count).
 */
function computePID(pv, cap, state, config, tick) {
    const setpointAbs = config.setpoint * cap;
    const error = (pv - setpointAbs) / Math.max(cap, 1); // normalized error
    const dt = Math.max(1, tick - state.lastTick);
    // Proportional
    const p = config.kp * error;
    // Integral with anti-windup clamp
    const rawIntegral = state.integral + error * dt;
    const integral = Math.max(-5, Math.min(config.integralMax, rawIntegral));
    const i = config.ki * integral;
    // Derivative (error rate of change per tick)
    const d = config.kd * (error - state.lastError) / dt;
    // Output = baseline + PID correction
    const raw = config.outputMid + p + i + d;
    const output = Math.max(config.outputMin, Math.min(config.outputMax, raw));
    return {
        output,
        nextState: { integral, lastError: error, lastTick: tick },
    };
}

// Tracks energy flow and calculates dynamic spawn targets based on actual room state.
// Sampled every SAMPLE_INTERVAL ticks; keeps WINDOW_SIZE samples (= WINDOW_TICKS history).
//
// Each sample captures three dimensions:
//   avail            — spawn/extension energy (what the spawn system sees)
//   containerFillPct — how full containers are (buffer between harvest and delivery)
//   sourceDepletedPct— how often sources are at 0 (ceiling on extraction rate)
//
// From these, one bottleneck is identified per update cycle and stored in energyStatus.
// calcDynamicTargets reads that bottleneck to shift spawn targets toward the constraint.
//
// Theory-of-constraints priority:
//   SOURCE_MAXED        → extraction ceiling hit; expansion is the only fix
//   HARVESTER_SHORTAGE  → containers emptying; add harvesters until containers refill
//   HAULER_SHORTAGE     → containers filling up but spawn energy low; add haulers
//   BALANCED            → no constraint; use baseline targets
const SAMPLE_INTERVAL = 5; // sample every N ticks
const WINDOW_SIZE = 20; // samples kept (= WINDOW_SIZE × SAMPLE_INTERVAL ticks)
const MAX_HAULERS_PER_SOURCE = 3; // hard cap: sources * MAX + 2
// ─── Total energy (PV for PID) ────────────────────────────────────────────────
function computeTotalEnergy(room) {
    var _a, _b, _c, _d;
    const containers = room.find(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_CONTAINER,
    });
    const containerCurrent = containers.reduce((s, c) => s + c.store[RESOURCE_ENERGY], 0);
    const containerCapacity = containers.reduce((s, c) => { var _a; return s + ((_a = c.store.getCapacity(RESOURCE_ENERGY)) !== null && _a !== void 0 ? _a : 0); }, 0);
    const storageCurrent = (_b = (_a = room.storage) === null || _a === void 0 ? void 0 : _a.store[RESOURCE_ENERGY]) !== null && _b !== void 0 ? _b : 0;
    const storageCapacity = (_d = (_c = room.storage) === null || _c === void 0 ? void 0 : _c.store.getCapacity(RESOURCE_ENERGY)) !== null && _d !== void 0 ? _d : 0;
    return {
        current: room.energyAvailable + containerCurrent + storageCurrent,
        capacity: room.energyCapacityAvailable + containerCapacity + storageCapacity,
    };
}
// ─── Sampling ─────────────────────────────────────────────────────────────────
function trackEnergyFlow(room) {
    var _a;
    if (!period(SAMPLE_INTERVAL, `economy:sample:${room.name}`))
        return;
    if (!room.memory.energyHistory)
        room.memory.energyHistory = [];
    room.memory.energyHistory.push({
        tick: Game.time,
        avail: room.energyAvailable,
        containerFillPct: sampleContainerFillPct(room),
        sourceDepletedPct: sampleSourceDepletedPct(room),
    });
    if (room.memory.energyHistory.length > WINDOW_SIZE) {
        room.memory.energyHistory = room.memory.energyHistory.slice(-WINDOW_SIZE);
    }
    const status = computeStatus(room);
    status.bottleneck = detectBottleneck(status, room);
    room.memory.energyStatus = status;
    // ── PID: drive sink demand (upgrader count) toward setpoint ───────────────
    const { current, capacity } = computeTotalEnergy(room);
    const prevPID = (_a = room.memory.pidState) !== null && _a !== void 0 ? _a : { integral: 0, lastError: 0, lastTick: Game.time - SAMPLE_INTERVAL };
    const { output, nextState } = computePID(current, capacity, prevPID, DEFAULT_PID_CONFIG, Game.time);
    room.memory.pidState = { ...nextState, output };
}
function sampleContainerFillPct(room) {
    const containers = room.find(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_CONTAINER,
    });
    if (containers.length === 0)
        return 50; // neutral before containers are built
    const total = containers.reduce((s, c) => {
        const cap = c.store.getCapacity(RESOURCE_ENERGY);
        return s + (cap > 0 ? c.store[RESOURCE_ENERGY] / cap : 0);
    }, 0);
    return Math.round(total / containers.length * 100);
}
function sampleSourceDepletedPct(room) {
    const sources = room.find(FIND_SOURCES);
    if (sources.length === 0)
        return 0;
    const depleted = sources.filter(s => s.energy === 0).length;
    return Math.round(depleted / sources.length * 100);
}
function computeStatus(room) {
    var _a;
    const h = (_a = room.memory.energyHistory) !== null && _a !== void 0 ? _a : [];
    const cap = room.energyCapacityAvailable || 1;
    const pct = Math.round(room.energyAvailable / cap * 100);
    if (h.length < 4) {
        return { netRate: 0, trend: 0, pct, level: 'STABLE', bottleneck: 'BALANCED' };
    }
    const first = h[0];
    const last = h[h.length - 1];
    const dt = last.tick - first.tick;
    const netRate = dt > 0 ? (last.avail - first.avail) / dt : 0;
    const mid = h[Math.floor(h.length / 2)];
    const rate1 = (mid.avail - first.avail) / Math.max(mid.tick - first.tick, 1);
    const rate2 = (last.avail - mid.avail) / Math.max(last.tick - mid.tick, 1);
    const trend = rate2 - rate1;
    let level;
    if (pct < 20 && netRate < -0.5)
        level = 'CRITICAL';
    else if (pct < 40 || netRate < -0.2)
        level = 'DEFICIT';
    else if (netRate > 0.3 || pct > 70)
        level = 'SURPLUS';
    else
        level = 'STABLE';
    return {
        netRate: Math.round(netRate * 100) / 100,
        trend: Math.round(trend * 100) / 100,
        pct,
        level,
        bottleneck: 'BALANCED', // overwritten by detectBottleneck after this returns
    };
}
// ─── Bottleneck detection ─────────────────────────────────────────────────────
function detectBottleneck(status, room) {
    var _a;
    const h = ((_a = room.memory.energyHistory) !== null && _a !== void 0 ? _a : []).slice(-8);
    if (h.length < 4)
        return 'BALANCED';
    const avgCont = avgField(h, 'containerFillPct', 50);
    const avgSrc = avgField(h, 'sourceDepletedPct', 0);
    // Sources at 0 more than 60% of samples → we've hit extraction ceiling
    if (avgSrc > 60)
        return 'SOURCE_MAXED';
    // Containers chronically low AND energy declining → not enough harvesters
    if (avgCont < 25 && (status.level === 'DEFICIT' || status.level === 'CRITICAL')) {
        return 'HARVESTER_SHORTAGE';
    }
    // Containers chronically backed up, spawn energy declining → haulers can't drain fast enough.
    // Require DEFICIT level AND negative rate to avoid false positives on transient post-spawn dips.
    if (avgCont > 60 && status.pct < 50 &&
        (status.level === 'DEFICIT' || status.level === 'CRITICAL') &&
        status.netRate < -0.3) {
        return 'HAULER_SHORTAGE';
    }
    return 'BALANCED';
}
function calcDynamicTargets(room) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    const rcl = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0;
    const sources = room.find(FIND_SOURCES);
    const sites = room.find(FIND_CONSTRUCTION_SITES).length;
    const containers = room.find(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_CONTAINER,
    }).length;
    const hasControllerContainer = ((_d = (_c = room.controller) === null || _c === void 0 ? void 0 : _c.pos.findInRange(FIND_STRUCTURES, 3, {
        filter: s => s.structureType === STRUCTURE_CONTAINER,
    }).length) !== null && _d !== void 0 ? _d : 0) > 0;
    // Allow upgraders to spawn even without a controller container if a link is adjacent —
    // at RCL5+ the controller link delivers energy directly so no container trip is needed.
    const hasControllerLink = ((_f = (_e = room.controller) === null || _e === void 0 ? void 0 : _e.pos.findInRange(FIND_STRUCTURES, 3, {
        filter: s => s.structureType === STRUCTURE_LINK,
    }).length) !== null && _f !== void 0 ? _f : 0) > 0;
    const upgraderHasLocalEnergy = hasControllerContainer || hasControllerLink;
    const bottleneck = (_h = (_g = room.memory.energyStatus) === null || _g === void 0 ? void 0 : _g.bottleneck) !== null && _h !== void 0 ? _h : 'BALANCED';
    const h = ((_j = room.memory.energyHistory) !== null && _j !== void 0 ? _j : []).slice(-8);
    const avgContainerFill = avgField(h, 'containerFillPct', 50);
    // ── Harvesters ────────────────────────────────────────────────────────────
    // RC1: no harvesters — upgrader role handles mining+upgrading directly.
    // Bootstrap (no source containers yet): small mobile harvesters act as
    // combined harvester+hauler — up to 3 per source so cheap bodies cover
    // the supply gap while containers are being built.
    // Production (source containers exist): 1 stationary harvester per source
    // parks on its container; a full body (up to 6 WORK) saturates the
    // 10e/tick source replenishment rate with no extra bodies needed.
    const hasSourceContainers = sources.some(src => src.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: s => s.structureType === STRUCTURE_CONTAINER,
    }).length > 0);
    const harvester = rcl <= 1 ? 0 : hasSourceContainers
        ? sources.length
        : sources.reduce((sum, src) => sum + Math.min(walkableAround(src), 3), 0);
    // ── Haulers ───────────────────────────────────────────────────────────────
    // Distance-based: haulers_needed = ceil(source_output × round_trip / hauler_carry)
    // Source output = 10e/tick; round trip = 2 × path_distance_to_storage (cached).
    // HAULER_SHORTAGE: add 1 extra hauler per source container to drain the backlog.
    const sourceCntrs = sources.reduce((sum, src) => sum + src.pos.findInRange(FIND_STRUCTURES, 1, { filter: s => s.structureType === STRUCTURE_CONTAINER }).length, 0);
    const haulerCarry = Math.max(100, Math.min(Math.floor(room.energyCapacityAvailable / 150), 10) * 100);
    let baseHaulers = 0;
    const storage = room.storage;
    for (const src of sources) {
        const hasCntr = src.pos.findInRange(FIND_STRUCTURES, 1, {
            filter: s => s.structureType === STRUCTURE_CONTAINER,
        }).length > 0;
        if (!hasCntr)
            continue;
        const dist = getSourceDistance(room, src, storage);
        const roundTrip = dist * 2;
        baseHaulers += Math.max(1, Math.ceil(10 * roundTrip / haulerCarry));
    }
    const haulerRaw = bottleneck === 'HAULER_SHORTAGE'
        ? baseHaulers + sourceCntrs
        : baseHaulers;
    // Hard cap: prevent over-spawning haulers that starve harvester replacements
    const hauler = Math.min(haulerRaw, sources.length * MAX_HAULERS_PER_SOURCE + 2);
    // ── Builders ──────────────────────────────────────────────────────────────
    // Gate builder count on container fill: spawning idle builders wastes capacity.
    // sourceCntrs === 0 is the right bootstrap signal — no source has a container yet,
    // so no supply chain exists. Allow 1 builder to build those first containers.
    // Once any source container exists, scale with sites but throttle if fill is low.
    let builder;
    if (sites === 0) {
        builder = 0;
    }
    else if (sourceCntrs === 0) {
        builder = 1; // bootstrap: at least 1 builder until the supply chain exists
    }
    else {
        const baseBuilders = sites <= 5 ? 1 : sites <= 15 ? 2 : sites <= 30 ? 3 : 4;
        // Containers below 25% → builders will idle; cap to 1 until supply recovers
        builder = avgContainerFill < 25 ? Math.max(1, Math.ceil(baseBuilders / 2)) : baseBuilders;
    }
    // ── Upgrader ──────────────────────────────────────────────────────────────
    // RC8: controller is maxed — no more leveling up. Spawn 1 maintenance upgrader
    // only when the downgrade timer is running low (< 50k of 200k ticks).
    // RC1: upgrade-only mode (200 XP to RC2, 20k TTD). Upgraders fall through
    // to FIND_SOURCES_ACTIVE in getEnergy() so they mine + upgrade without a
    // container — no harvester or hauler needed at this level.
    // RC2: 10k TTD is the shortest window of any level. Keep 1 upgrader alive
    // even before a controller container exists so the 3k-tick emergency buffer
    // never gets exercised.
    // All other levels: PID output drives count; high energy → more upgraders.
    let upgrader;
    if (rcl >= 8) {
        const ttd = (_l = (_k = room.controller) === null || _k === void 0 ? void 0 : _k.ticksToDowngrade) !== null && _l !== void 0 ? _l : 200000;
        upgrader = upgraderHasLocalEnergy && ttd < 50000 ? 1 : 0;
    }
    else if (rcl <= 1) {
        upgrader = 3;
    }
    else {
        const pidOutput = (_o = (_m = room.memory.pidState) === null || _m === void 0 ? void 0 : _m.output) !== null && _o !== void 0 ? _o : DEFAULT_PID_CONFIG.outputMid;
        upgrader = upgraderHasLocalEnergy
            ? Math.max(0, Math.min(4, Math.round(pidOutput)))
            : (rcl <= 2 ? 1 : 0);
    }
    const repairer = 0; // phase override in spawnManager handles DEFEND
    const scout = rcl >= 1 ? 1 : 0;
    // 1 scavenger once containers exist (supply chain is up, loot prevention matters)
    const scavenger = containers > 0 ? 1 : 0;
    return { harvester, hauler, upgrader, builder, repairer, scout, scavenger };
}
// ─── Helpers ──────────────────────────────────────────────────────────────────
function avgField(samples, field, fallback) {
    if (samples.length === 0)
        return fallback;
    return samples.reduce((s, x) => { var _a; return s + ((_a = x[field]) !== null && _a !== void 0 ? _a : fallback); }, 0) / samples.length;
}
// ─── Distance caching ─────────────────────────────────────────────────────────
// PathFinder is expensive; cache source→storage distances in room.memory so we
// only recalculate when storage appears/disappears or every 5000 ticks.
const DISTANCE_RECALC_INTERVAL = 5000;
function getSourceDistance(room, source, storage) {
    var _a, _b, _c, _d;
    if (!room.memory.sourceDistances)
        room.memory.sourceDistances = {};
    const key = source.id;
    const cached = room.memory.sourceDistances[key];
    const lastCalc = room.memory[`_distTick_${key}`];
    if (cached !== undefined && lastCalc && Game.time - lastCalc < DISTANCE_RECALC_INTERVAL) {
        return cached;
    }
    // Recalculate via PathFinder.
    // Prefer storage → spawn → controller as destination in that priority order.
    // Haulers deliver to spawn/extensions, not the controller; using controller
    // over-estimates distance and inflates hauler targets.
    const dest = (_c = (_a = storage === null || storage === void 0 ? void 0 : storage.pos) !== null && _a !== void 0 ? _a : (_b = room.find(FIND_MY_SPAWNS)[0]) === null || _b === void 0 ? void 0 : _b.pos) !== null && _c !== void 0 ? _c : (_d = room.controller) === null || _d === void 0 ? void 0 : _d.pos;
    let dist = 10; // fallback when no dest or path incomplete
    if (dest) {
        const result = PathFinder.search(source.pos, { pos: dest, range: 1 }, { plainCost: 1, swampCost: 2, maxOps: 2000 });
        if (!result.incomplete)
            dist = result.path.length;
    }
    room.memory.sourceDistances[key] = dist;
    room.memory[`_distTick_${key}`] = Game.time;
    return dist;
}
function walkableAround(source) {
    const terrain = source.room.getTerrain();
    let count = 0;
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0)
                continue;
            const x = source.pos.x + dx;
            const y = source.pos.y + dy;
            if (x < 1 || x > 48 || y < 1 || y > 48)
                continue;
            if (terrain.get(x, y) !== TERRAIN_MASK_WALL)
                count++;
        }
    }
    return count;
}

const MIN_COMBAT_ENERGY = 400;
const WARRIORS_PER_PLATOON = 3;
const DOWNGRADE_EMERGENCY_THRESHOLD = 4000;
// RC2 has only a 10,000 tick downgrade window — the shortest of any level.
// Fire the emergency check earlier so we have more time to spawn a replacement.
const DOWNGRADE_EMERGENCY_RCL2 = 7000;
// Below this threshold, non-essential roles (upgrader, scout, builder) are skipped.
// Keeps spawn energy available for harvesters and haulers that maintain the economy.
const SPAWN_FLOOR = 200;
// Combat targets per phase — these OVERLAY the dynamic economy targets
const COMBAT_TARGETS = {
    ECONOMY: { warrior: 0, ranger: 0, healer: 0, repairer: 0 },
    ASSESS: { warrior: 4, ranger: 2, healer: 0, repairer: 0 }, // minimum for 1 full quad (2W+2R) during assessment
    RUSH: { warrior: 8, ranger: 4, healer: 2, repairer: 0 }, // was warrior:6 ranger:2
    DEFEND: { warrior: 4, ranger: 2, healer: 2, repairer: 2 },
};
function manageSpawns(room) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y;
    const spawns = room.find(FIND_MY_SPAWNS).filter(s => !s.spawning);
    if (spawns.length === 0)
        return;
    const spawn = spawns[0];
    const phase = ((_a = room.memory.phase) !== null && _a !== void 0 ? _a : 'ECONOMY');
    const creeps = room.find(FIND_MY_CREEPS);
    // Count all creeps homed to this room, including those scouting/mining/fighting in
    // other rooms — room.find only returns creeps physically present, so roaming creeps
    // (scouts, remote miners, defenders) would appear missing and trigger duplicate spawns.
    const allHomeCreeps = Object.values(Game.creeps).filter(c => c.memory.homeRoom === room.name);
    const counts = countByRole(allHomeCreeps);
    const status = (_b = room.memory.energyStatus) !== null && _b !== void 0 ? _b : { level: 'STABLE'};
    // Dynamic economy targets based on actual room state
    const eco = calcDynamicTargets(room);
    const combat = COMBAT_TARGETS[phase];
    // Safe mode: no combat units
    const inSafeMode = ((_d = (_c = room.controller) === null || _c === void 0 ? void 0 : _c.safeMode) !== null && _d !== void 0 ? _d : 0) > 0;
    // ── Bootstrap: zero creeps → always spawn harvester first ────────────────
    // Guards against the emergency-upgrader check firing on a freshly claimed room
    // before any energy infrastructure exists.
    if (allHomeCreeps.length === 0) {
        trySpawn(spawn, 'harvester', room.energyAvailable);
        return;
    }
    // ── Expansion priority ────────────────────────────────────────────────────
    if (Memory.expansionState === 'CLAIMING' && counts.claimer === 0 && Memory.expansionTarget) {
        trySpawn(spawn, 'claimer', room.energyAvailable, { targetRoomName: Memory.expansionTarget });
        return;
    }
    if (Memory.expansionState === 'BOOTSTRAPPING') {
        const bt = bootstrapTargets();
        const expRoom = Memory.expansionRoomName;
        // Bootstrap workers are homed to the expansion room so the new room's spawn
        // manager counts them (prevents over-spawning) and harvesters use mobile mode
        // to deliver energy directly to the new room's spawn.
        if (bt.harvester > 0) {
            trySpawn(spawn, 'harvester', room.energyAvailable, { homeRoom: expRoom, targetRoomName: expRoom });
            return;
        }
        if (bt.builder > 0) {
            trySpawn(spawn, 'builder', room.energyAvailable, { homeRoom: expRoom, targetRoomName: expRoom });
            return;
        }
        if (bt.hauler > 0) {
            trySpawn(spawn, 'hauler', room.energyAvailable, { homeRoom: expRoom, targetRoomName: expRoom });
            return;
        }
    }
    // ── Emergency: controller downgrade prevention ────────────────────────────
    const ttd = (_f = (_e = room.controller) === null || _e === void 0 ? void 0 : _e.ticksToDowngrade) !== null && _f !== void 0 ? _f : Infinity;
    const rcl = (_h = (_g = room.controller) === null || _g === void 0 ? void 0 : _g.level) !== null && _h !== void 0 ? _h : 0;
    const downgradeThreshold = rcl <= 2 ? DOWNGRADE_EMERGENCY_RCL2 : DOWNGRADE_EMERGENCY_THRESHOLD;
    if (ttd < downgradeThreshold && counts.upgrader === 0) {
        trySpawn(spawn, 'upgrader', room.energyAvailable);
        console.log(`[adaptive] ⚠️ Emergency upgrader — downgrade in ${ttd} ticks`);
        return;
    }
    // ── Always maintain minimum harvesters (2) ────────────────────────────────
    if (counts.harvester < 2) {
        trySpawn(spawn, 'harvester', room.energyAvailable);
        return;
    }
    // ── Local defense: room under active attack → spawn defenders before eco ─
    const localThreat = ((_k = (_j = Memory.roomThreats) === null || _j === void 0 ? void 0 : _j[room.name]) === null || _k === void 0 ? void 0 : _k.severity) === 'ACTIVE';
    if (localThreat && !inSafeMode && room.energyAvailable >= MIN_COMBAT_ENERGY) {
        if (((_l = counts.repairer) !== null && _l !== void 0 ? _l : 0) < 2) {
            trySpawn(spawn, 'repairer', room.energyAvailable);
            return;
        }
        if (((_m = counts.warrior) !== null && _m !== void 0 ? _m : 0) < 4) {
            trySpawn(spawn, 'warrior', room.energyAvailable, { platoonId: assignWarriorPlatoon(creeps) });
            return;
        }
        if (((_o = counts.ranger) !== null && _o !== void 0 ? _o : 0) < 2) {
            trySpawn(spawn, 'ranger', room.energyAvailable, { platoonId: assignWarriorPlatoon(creeps) });
            return;
        }
        if (((_p = counts.healer) !== null && _p !== void 0 ? _p : 0) < 1) {
            const pid = assignHealerPlatoon(creeps);
            if (pid) {
                trySpawn(spawn, 'healer', room.energyAvailable, { platoonId: pid });
                return;
            }
        }
    }
    // ── Economy roles — respect energy level ─────────────────────────────────
    const canSpawnEconomy = status.level !== 'CRITICAL';
    // Roles marked minLevel:'STABLE' are skipped during DEFICIT to prevent the
    // spawn-then-prune death spiral (spawn 200e upgrader → CRITICAL → prune → repeat).
    // Roles marked needsFloor:true are skipped when energyAvailable < SPAWN_FLOOR (200e)
    // so energy sinks never drain the pool needed for essential harvester replacements.
    const LEVEL_ORDER = ['CRITICAL', 'DEFICIT', 'STABLE', 'SURPLUS'];
    const ecoRoles = [
        { role: 'harvester', target: eco.harvester },
        { role: 'builder', target: eco.builder, needsFloor: true },
        { role: 'hauler', target: eco.hauler },
        { role: 'upgrader', target: eco.upgrader, minLevel: 'STABLE', needsFloor: true },
        { role: 'scout', target: eco.scout, minLevel: 'STABLE', needsFloor: true },
        { role: 'scavenger', target: eco.scavenger },
    ];
    // Proportional hauler budget (Quorum: src/programs/city/mine.js).
    // Size hauler carry capacity to the actual source→storage travel distance rather
    // than always spending max available energy. Prevents over-built haulers in
    // high-RCL rooms and under-built haulers in large rooms.
    // Formula: carryNeeded = distance × 1.3 × 20 (energy generated per round trip)
    // Our 2C+1M unit carries 100e and costs 150e, so budget = ceil(carryNeeded/100) × 150.
    // Capped at room.energyAvailable so we never wait — we build the largest affordable
    // hauler up to the distance-optimal size.
    const haulerBudget = computeLocalHaulerBudget(room);
    if (canSpawnEconomy) {
        for (const { role, target, extra, minLevel, needsFloor } of ecoRoles) {
            if (minLevel && LEVEL_ORDER.indexOf(status.level) < LEVEL_ORDER.indexOf(minLevel))
                continue;
            if (needsFloor && room.energyAvailable < SPAWN_FLOOR)
                continue;
            if (((_q = counts[role]) !== null && _q !== void 0 ? _q : 0) < target) {
                const budget = role === 'hauler' ? haulerBudget : room.energyAvailable;
                trySpawn(spawn, role, budget, extra);
                return;
            }
        }
    }
    // ── Remote mining: reservers + remote miners + remote haulers ─────────────
    if (canSpawnEconomy) {
        for (const [remoteName, rt] of Object.entries((_r = room.memory.remoteRooms) !== null && _r !== void 0 ? _r : {})) {
            // Skip rooms where hostile creeps were spotted recently — sending
            // miners/haulers there wastes spawn energy until it clears.
            const remoteIntel = (_s = Memory.roomIntel) === null || _s === void 0 ? void 0 : _s[remoteName];
            const threatened = remoteIntel && remoteIntel.enemyCreeps > 0 &&
                Game.time - remoteIntel.scannedAt < 300;
            if (threatened)
                continue;
            // Reserver: keep the room reserved (requires 650e — skip at RCL 2)
            const canAffordReserver = room.energyCapacityAvailable >= 650;
            const needsReserver = canAffordReserver && rt.reservedUntil < Game.time + 500;
            const hasReserver = allHomeCreeps.some(c => {
                var _a;
                return c.memory.role === 'reserver' && c.memory.targetRoomName === remoteName &&
                    ((_a = c.ticksToLive) !== null && _a !== void 0 ? _a : 1500) >= PRE_SPAWN_TICKS;
            });
            if (needsReserver && !hasReserver) {
                trySpawn(spawn, 'reserver', room.energyAvailable, { targetRoomName: remoteName });
                return;
            }
            // Remote miners (harvesters assigned to remoteRoom)
            const currentMiners = allHomeCreeps.filter(c => {
                var _a;
                return c.memory.role === 'harvester' && c.memory.remoteRoom === remoteName &&
                    ((_a = c.ticksToLive) !== null && _a !== void 0 ? _a : 1500) >= PRE_SPAWN_TICKS;
            }).length;
            if (currentMiners < rt.miners) {
                trySpawn(spawn, 'harvester', room.energyAvailable, { remoteRoom: remoteName });
                return;
            }
            // Remote haulers
            const currentHaulers = allHomeCreeps.filter(c => {
                var _a;
                return c.memory.role === 'hauler' && c.memory.remoteRoom === remoteName &&
                    ((_a = c.ticksToLive) !== null && _a !== void 0 ? _a : 1500) >= PRE_SPAWN_TICKS;
            }).length;
            if (currentHaulers < rt.haulers) {
                trySpawn(spawn, 'hauler', room.energyAvailable, { remoteRoom: remoteName });
                return;
            }
        }
    }
    // Courier: spawn when a deficit neighbor room needs energy and we have surplus
    if (canSpawnEconomy && ((_t = room.memory.energySurplus) !== null && _t !== void 0 ? _t : 0) > 0) {
        const deficitRoom = findDeficitNeighbor(room);
        if (deficitRoom) {
            const existingCouriers = allHomeCreeps.filter(c => {
                var _a;
                return c.memory.role === 'courier' && c.memory.courierTarget === deficitRoom &&
                    ((_a = c.ticksToLive) !== null && _a !== void 0 ? _a : 1500) >= PRE_SPAWN_TICKS;
            }).length;
            if (existingCouriers < 2) {
                trySpawn(spawn, 'courier', room.energyAvailable, { courierTarget: deficitRoom });
                return;
            }
        }
    }
    // Repairer (phase-gated)
    if (canSpawnEconomy && ((_u = counts.repairer) !== null && _u !== void 0 ? _u : 0) < ((_v = combat.repairer) !== null && _v !== void 0 ? _v : 0)) {
        trySpawn(spawn, 'repairer', room.energyAvailable);
        return;
    }
    // ── Combat units: gated on energy surplus AND not in safe mode ────────────
    const canSpawnCombat = !inSafeMode && room.energyAvailable >= MIN_COMBAT_ENERGY &&
        (status.level === 'SURPLUS' || status.level === 'STABLE');
    if (canSpawnCombat) {
        if (((_w = counts.warrior) !== null && _w !== void 0 ? _w : 0) < combat.warrior) {
            const platoonId = assignWarriorPlatoon(creeps);
            trySpawn(spawn, 'warrior', room.energyAvailable, { platoonId });
            return;
        }
        if (((_x = counts.ranger) !== null && _x !== void 0 ? _x : 0) < combat.ranger) {
            const platoonId = assignWarriorPlatoon(creeps);
            trySpawn(spawn, 'ranger', room.energyAvailable, { platoonId });
            return;
        }
        if (((_y = counts.healer) !== null && _y !== void 0 ? _y : 0) < combat.healer) {
            const platoonId = assignHealerPlatoon(creeps);
            if (platoonId)
                trySpawn(spawn, 'healer', room.energyAvailable, { platoonId });
        }
    }
}
// ─── Prune excess creeps ──────────────────────────────────────────────────────
function pruneExcessCreeps(room) {
    var _a, _b, _c;
    const phase = (_a = room.memory.phase) !== null && _a !== void 0 ? _a : 'ECONOMY';
    const creeps = room.find(FIND_MY_CREEPS);
    const counts = countByRole(creeps);
    const phaseAge = room.memory.phaseTick ? Game.time - room.memory.phaseTick : 0;
    const status = room.memory.energyStatus;
    // Suicide combat units after sustained ECONOMY (they're RUSH leftovers)
    const energyLevel = (_b = status === null || status === void 0 ? void 0 : status.level) !== null && _b !== void 0 ? _b : 'STABLE';
    const urgentCull = phase === 'ECONOMY' && energyLevel !== 'SURPLUS';
    const timedCull = phase === 'ECONOMY' && phaseAge > 500;
    if (urgentCull || timedCull) {
        for (const c of creeps) {
            if (c.memory.role === 'warrior' || c.memory.role === 'ranger' || c.memory.role === 'healer') {
                console.log(`[adaptive] Retiring ${c.memory.role} (ECONOMY for ${phaseAge} ticks)`);
                c.suicide();
            }
        }
    }
    // Emergency energy: suicide the largest upgrader only — but only when harvesters
    // are present to actually generate more energy. Without harvesters, killing the
    // upgrader doesn't help and causes a spawn-kill death spiral (200e upgrader spawns,
    // drains to CRITICAL, gets killed, repeat).
    if ((status === null || status === void 0 ? void 0 : status.level) === 'CRITICAL') {
        const harvesters = creeps.filter(c => c.memory.role === 'harvester');
        if (harvesters.length > 0) {
            const expensive = creeps
                .filter(c => c.memory.role === 'upgrader')
                .sort((a, b) => (b.body.length) - (a.body.length));
            if (expensive.length > 0) {
                console.log(`[adaptive] CRITICAL energy — retiring upgrader`);
                expensive[0].suicide();
            }
        }
    }
    // Cull any role more than 2× its dynamic target
    const eco = calcDynamicTargets(room);
    for (const role of Object.keys(eco)) {
        const target = eco[role];
        if (target === 0)
            continue;
        const count = (_c = counts[role]) !== null && _c !== void 0 ? _c : 0;
        const excess = count - target * 2;
        if (excess <= 0)
            continue;
        const toCull = creeps
            .filter(c => c.memory.role === role)
            .sort((a, b) => { var _a, _b; return ((_a = a.ticksToLive) !== null && _a !== void 0 ? _a : 1500) - ((_b = b.ticksToLive) !== null && _b !== void 0 ? _b : 1500); })
            .slice(0, excess);
        for (const c of toCull) {
            console.log(`[adaptive] Culling excess ${role} (${count} > cap ${target * 2})`);
            c.suicide();
        }
    }
}
// ─── Platoon assignment ───────────────────────────────────────────────────────
function assignWarriorPlatoon(creeps) {
    const platoons = buildPlatoonMap(creeps);
    for (const [id, data] of Object.entries(platoons)) {
        if (data.fighters < WARRIORS_PER_PLATOON)
            return id;
    }
    return `platoon_${Object.keys(platoons).length}`;
}
function assignHealerPlatoon(creeps) {
    const platoons = buildPlatoonMap(creeps);
    for (const [id, data] of Object.entries(platoons)) {
        if (data.fighters >= 2 && !data.hasHealer)
            return id;
    }
    return undefined;
}
function buildPlatoonMap(creeps) {
    const map = {};
    for (const c of creeps) {
        const pid = c.memory.platoonId;
        if (!pid)
            continue;
        if (!map[pid])
            map[pid] = { fighters: 0, hasHealer: false };
        if (c.memory.role === 'warrior' || c.memory.role === 'ranger')
            map[pid].fighters++;
        if (c.memory.role === 'healer')
            map[pid].hasHealer = true;
    }
    return map;
}
// Returns the name of an adjacent owned room that needs energy, or null.
function findDeficitNeighbor(room) {
    var _a;
    const exits = Game.map.describeExits(room.name);
    if (!exits)
        return null;
    const neighbors = Object.values(exits).filter((r) => !!r);
    for (const neighbor of neighbors) {
        const nr = Game.rooms[neighbor];
        if (!((_a = nr === null || nr === void 0 ? void 0 : nr.controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        const nStorage = nr.storage;
        if (!nStorage)
            continue;
        if (nStorage.store[RESOURCE_ENERGY] < 10000)
            return neighbor;
    }
    return null;
}
// ─── Helpers ─────────────────────────────────────────────────────────────────
function trySpawn(spawn, role, energy, extraMemory = {}) {
    const hasContainers = spawn.room.find(FIND_STRUCTURES)
        .some(s => s.structureType === STRUCTURE_CONTAINER);
    const body = buildBody(role, energy, { mobile: role === 'harvester' && !hasContainers });
    if (!body)
        return;
    const name = `${role}_${Game.time}`;
    const result = spawn.spawnCreep(body, name, {
        memory: { role, working: false, homeRoom: spawn.room.name, ...extraMemory },
    });
    if (result === OK) {
        const cost = body.reduce((s, p) => s + BODYPART_COST[p], 0);
        const platoon = extraMemory.platoonId ? ` [${extraMemory.platoonId}]` : '';
        console.log(`[adaptive] Spawning ${name}${platoon} [${body.join(',')}] (${cost}e)`);
    }
}
// Creeps with fewer than PRE_SPAWN_TICKS remaining are excluded from the count.
// This triggers a replacement spawn BEFORE the old creep dies, so coverage
// is continuous with no gap. Largest bodies (hauler/upgrader ~33 parts) take
// ~100 ticks to spawn, so 100 covers the worst case with a small buffer.
const PRE_SPAWN_TICKS = 100;
function countByRole(creeps) {
    var _a, _b;
    const c = {};
    for (const creep of creeps) {
        // Treat nearly-dead creeps as already gone for planning purposes
        if (((_a = creep.ticksToLive) !== null && _a !== void 0 ? _a : 1500) < PRE_SPAWN_TICKS)
            continue;
        c[creep.memory.role] = ((_b = c[creep.memory.role]) !== null && _b !== void 0 ? _b : 0) + 1;
    }
    return c;
}
// Compute ideal hauler energy budget from average source→storage path distance.
// Ported from screeps-quorum/mine.js `mineSource` hauler section.
// Each 2C+1M unit (150e) carries 100e; we need enough carry for one full round trip.
// Capped at room.energyAvailable so we never block the spawn queue waiting for energy.
function computeLocalHaulerBudget(room) {
    const distances = room.memory.sourceDistances;
    if (!distances)
        return room.energyAvailable;
    const sources = room.find(FIND_SOURCES);
    if (sources.length === 0)
        return room.energyAvailable;
    let total = 0, count = 0;
    for (const src of sources) {
        const d = distances[src.id];
        if (d) {
            total += d;
            count++;
        }
    }
    if (count === 0)
        return room.energyAvailable;
    const avgDist = total / count;
    const multiplier = 1.3;
    const carryNeeded = avgDist * multiplier * 20; // energy capacity needed per trip
    const units = Math.max(1, Math.ceil(carryNeeded / 100)); // 100e carry per unit
    const ideal = Math.min(units * 150, room.energyCapacityAvailable);
    return Math.min(ideal, room.energyAvailable);
}

const MAX_ROAD_SITES = 10;
function manageConstruction(room) {
    var _a, _b;
    const rcl = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0;
    // For newly claimed rooms with no spawn, place one first
    if (room.find(FIND_MY_SPAWNS).length === 0) {
        placeSpawnIfMissing(room);
        return;
    }
    if (period(5, 'construction:prune'))
        pruneExcessRoadSites(room);
    maintainRoadQueue(room);
    // Containers and storage are checked periodically — they can be destroyed
    // mid-game and must be re-queued without waiting for an RCL change.
    // Keys are room-scoped so multi-room setups don't share the same timer.
    // Strategy report §RC1: no construction at RC1 — wasted effort. Containers
    // are placed starting at RC2 when the harvester/hauler split begins.
    if (rcl >= 2 && period(50, `construction:containers:${room.name}`))
        placeContainers(room);
    if (rcl >= 4 && period(50, `construction:storage:${room.name}`))
        placeStorage(room);
    // Per-room flags so multi-room setups don't fight over a single global value.
    // Each room independently detects its own RCL change and re-plans once.
    if (room.memory.roadsPlanned && room.memory.lastRCL === rcl)
        return;
    room.memory.roadsPlanned = true;
    room.memory.lastRCL = rcl;
    if (rcl >= 2)
        placeExtensions(room, rcl);
    if (rcl >= 2)
        placeRamparts(room);
    if (rcl >= 3)
        placeTowers(room, rcl);
    if (rcl >= 5)
        placeLinks(room, rcl);
    if (rcl >= 6)
        placeTerminal(room);
    if (rcl >= 6)
        placeExtractor(room);
    if (rcl >= 7)
        placeAdditionalSpawns(room, rcl);
    console.log(`[adaptive] Construction planned at RCL ${rcl}`);
}
// ─── New room bootstrap ───────────────────────────────────────────────────────
function placeSpawnIfMissing(room) {
    if (room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_SPAWN }).length > 0)
        return;
    for (let r = 0; r <= 12; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r)
                    continue;
                const x = 25 + dx, y = 25 + dy;
                if (x < 2 || x > 47 || y < 2 || y > 47)
                    continue;
                if (room.createConstructionSite(x, y, STRUCTURE_SPAWN) === OK) {
                    console.log(`[adaptive] Spawn site placed in ${room.name} at (${x},${y})`);
                    return;
                }
            }
        }
    }
}
// ─── Road pruning & drip-feed ────────────────────────────────────────────────
function pruneExcessRoadSites(room) {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn)
        return;
    const roadSites = room.find(FIND_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_ROAD });
    if (roadSites.length <= MAX_ROAD_SITES)
        return;
    roadSites.sort((a, b) => a.pos.getRangeTo(spawn) - b.pos.getRangeTo(spawn));
    const toRemove = roadSites.slice(MAX_ROAD_SITES);
    for (const site of toRemove)
        site.remove();
    console.log(`[adaptive] Road sites pruned: kept ${MAX_ROAD_SITES}, removed ${toRemove.length}`);
}
function maintainRoadQueue(room) {
    const pending = room.find(FIND_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_ROAD }).length;
    if (pending >= MAX_ROAD_SITES)
        return;
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn)
        return;
    // Collect candidate road positions from all paths (spawn → each source + controller), deduped
    const seen = new Set();
    const candidates = [];
    const targets = [
        ...room.find(FIND_SOURCES).map(s => s.pos),
        ...(room.controller ? [room.controller.pos] : []),
    ];
    for (const target of targets) {
        const path = room.findPath(spawn.pos, target, { ignoreCreeps: true, swampCost: 1, plainCost: 2, range: 1 });
        for (const step of path) {
            const key = `${step.x},${step.y}`;
            if (!seen.has(key)) {
                seen.add(key);
                candidates.push({ x: step.x, y: step.y });
            }
        }
    }
    // Set of already-placed road positions (built or pending). Seed with spawn so first path
    // tile is treated as "adjacent to existing road" and builds outward from spawn.
    const placed = new Set([`${spawn.pos.x},${spawn.pos.y}`]);
    for (const s of room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_ROAD })) {
        placed.add(`${s.pos.x},${s.pos.y}`);
    }
    for (const s of room.find(FIND_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_ROAD })) {
        placed.add(`${s.pos.x},${s.pos.y}`);
    }
    const unplaced = candidates.filter(c => !placed.has(`${c.x},${c.y}`));
    const isAdjacent = (pos) => {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0)
                    continue;
                if (placed.has(`${pos.x + dx},${pos.y + dy}`))
                    return true;
            }
        }
        return false;
    };
    // Adjacent tiles first so the road network grows connected; closest to spawn as tiebreak
    unplaced.sort((a, b) => {
        const aAdj = isAdjacent(a) ? 0 : 1;
        const bAdj = isAdjacent(b) ? 0 : 1;
        if (aAdj !== bAdj)
            return aAdj - bAdj;
        return spawn.pos.getRangeTo(a.x, a.y) - spawn.pos.getRangeTo(b.x, b.y);
    });
    let budget = MAX_ROAD_SITES - pending;
    for (const pos of unplaced) {
        if (budget <= 0)
            break;
        if (room.createConstructionSite(pos.x, pos.y, STRUCTURE_ROAD) === OK) {
            budget--;
            placed.add(`${pos.x},${pos.y}`); // update so next tile can see it as adjacent
        }
    }
}
// ─── Containers ──────────────────────────────────────────────────────────────
function placeContainers(room) {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    const targets = [
        ...room.find(FIND_SOURCES).map(s => s.pos),
        ...(room.controller ? [room.controller.pos] : []),
        ...(spawn ? [spawn.pos] : []), // hub container near spawn — pre-RCL4 buffer
    ];
    for (const pos of targets) {
        // Search range 2 so sources adjacent to spawn (or walls) still find a valid tile.
        const SEARCH_RANGE = 2;
        const hasNearby = pos.findInRange(FIND_STRUCTURES, SEARCH_RANGE, { filter: s => s.structureType === STRUCTURE_CONTAINER }).length > 0 ||
            pos.findInRange(FIND_CONSTRUCTION_SITES, SEARCH_RANGE, { filter: s => s.structureType === STRUCTURE_CONTAINER }).length > 0;
        if (hasNearby)
            continue;
        let placed = false;
        outer: for (let r = 1; r <= SEARCH_RANGE && !placed; r++) {
            for (let dx = -r; dx <= r && !placed; dx++) {
                for (let dy = -r; dy <= r && !placed; dy++) {
                    if (Math.abs(dx) !== r && Math.abs(dy) !== r)
                        continue; // ring only
                    const x = pos.x + dx, y = pos.y + dy;
                    if (x < 1 || x > 48 || y < 1 || y > 48)
                        continue;
                    const result = room.createConstructionSite(x, y, STRUCTURE_CONTAINER);
                    if (result === OK) {
                        placed = true;
                        break outer;
                    }
                }
            }
        }
        if (!placed)
            console.log(`[adaptive] Could not place container near (${pos.x},${pos.y})`);
    }
}
// ─── Storage (RCL 4+) ────────────────────────────────────────────────────────
function placeStorage(room) {
    if (room.storage)
        return;
    if (room.find(FIND_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_STORAGE }).length > 0)
        return;
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn)
        return;
    for (let r = 2; r <= 8; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r)
                    continue;
                const x = spawn.pos.x + dx, y = spawn.pos.y + dy;
                if (x < 2 || x > 47 || y < 2 || y > 47)
                    continue;
                if (room.createConstructionSite(x, y, STRUCTURE_STORAGE) === OK) {
                    console.log(`[adaptive] Storage site placed at (${x},${y})`);
                    return;
                }
            }
        }
    }
    console.log(`[adaptive] Could not place storage in ${room.name}`);
}
// ─── Extensions ──────────────────────────────────────────────────────────────
function placeExtensions(room, rcl) {
    var _a;
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn)
        return;
    const built = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_EXTENSION }).length;
    const pending = room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_EXTENSION }).length;
    const allowed = (_a = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][rcl]) !== null && _a !== void 0 ? _a : 0;
    const needed = allowed - built - pending;
    if (needed <= 0)
        return;
    let placed = 0;
    outer: for (let r = 2; r <= 6; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r)
                    continue;
                const x = spawn.pos.x + dx, y = spawn.pos.y + dy;
                if (x < 2 || x > 47 || y < 2 || y > 47)
                    continue;
                if (room.createConstructionSite(x, y, STRUCTURE_EXTENSION) === OK) {
                    if (++placed >= needed)
                        break outer;
                }
            }
        }
    }
}
// ─── Towers ──────────────────────────────────────────────────────────────────
function placeTowers(room, rcl) {
    var _a;
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn)
        return;
    const built = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER }).length;
    const pending = room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_TOWER }).length;
    const allowed = (_a = CONTROLLER_STRUCTURES[STRUCTURE_TOWER][rcl]) !== null && _a !== void 0 ? _a : 0;
    if (built + pending >= allowed)
        return;
    for (let r = 2; r <= 8; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r)
                    continue;
                const x = spawn.pos.x + dx, y = spawn.pos.y + dy;
                if (x < 2 || x > 47 || y < 2 || y > 47)
                    continue;
                if (room.createConstructionSite(x, y, STRUCTURE_TOWER) === OK)
                    return;
            }
        }
    }
}
// ─── Links (RCL 5+) ──────────────────────────────────────────────────────────
// Placement priority (strategy report §RC5):
//   1. Source links  — adjacent to each source; harvesters push energy in
//   2. Controller link — adjacent to controller; upgraders withdraw without traveling
//   3. Hub link near spawn — haulers withdraw here instead of walking to containers
//
// With only 2 links (RC5): source + controller → upgrader throughput is maximised.
// At 4 links (RC7): both controller + hub are present → all roles benefit.
function placeLinks(room, rcl) {
    var _a;
    const built = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_LINK }).length;
    const pending = room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_LINK }).length;
    const allowed = (_a = CONTROLLER_STRUCTURES[STRUCTURE_LINK][rcl]) !== null && _a !== void 0 ? _a : 0;
    let remaining = allowed - built - pending;
    if (remaining <= 0)
        return;
    // 1. Source links
    for (const source of room.find(FIND_SOURCES)) {
        if (remaining <= 0)
            break;
        const hasNearby = source.pos.findInRange(FIND_MY_STRUCTURES, 2, { filter: s => s.structureType === STRUCTURE_LINK }).length > 0 ||
            source.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 2, { filter: s => s.structureType === STRUCTURE_LINK }).length > 0;
        if (hasNearby)
            continue;
        let placed = false;
        for (let dx = -2; dx <= 2 && !placed; dx++) {
            for (let dy = -2; dy <= 2 && !placed; dy++) {
                if (dx === 0 && dy === 0)
                    continue;
                if (room.createConstructionSite(source.pos.x + dx, source.pos.y + dy, STRUCTURE_LINK) === OK) {
                    placed = true;
                    remaining--;
                }
            }
        }
    }
    if (remaining <= 0)
        return;
    // 2. Controller link — upgraders sit here and draw energy without making trips
    const ctrl = room.controller;
    if (ctrl) {
        const hasCtrlLink = ctrl.pos.findInRange(FIND_MY_STRUCTURES, 3, { filter: s => s.structureType === STRUCTURE_LINK }).length > 0 ||
            ctrl.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 3, { filter: s => s.structureType === STRUCTURE_LINK }).length > 0;
        if (!hasCtrlLink) {
            outer: for (let r = 1; r <= 3; r++) {
                for (let dx = -r; dx <= r; dx++) {
                    for (let dy = -r; dy <= r; dy++) {
                        if (Math.abs(dx) !== r && Math.abs(dy) !== r)
                            continue;
                        const x = ctrl.pos.x + dx, y = ctrl.pos.y + dy;
                        if (x < 2 || x > 47 || y < 2 || y > 47)
                            continue;
                        if (room.createConstructionSite(x, y, STRUCTURE_LINK) === OK) {
                            remaining--;
                            break outer;
                        }
                    }
                }
            }
        }
    }
    if (remaining <= 0)
        return;
    // 3. Hub link near spawn — allows haulers to withdraw locally (RC7+)
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (spawn) {
        const spawnLinkNearby = spawn.pos.findInRange(FIND_MY_STRUCTURES, 4, { filter: s => s.structureType === STRUCTURE_LINK }).length > 0 ||
            spawn.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 4, { filter: s => s.structureType === STRUCTURE_LINK }).length > 0;
        if (!spawnLinkNearby) {
            outer: for (let r = 2; r <= 5; r++) {
                for (let dx = -r; dx <= r; dx++) {
                    for (let dy = -r; dy <= r; dy++) {
                        if (Math.abs(dx) !== r && Math.abs(dy) !== r)
                            continue;
                        if (room.createConstructionSite(spawn.pos.x + dx, spawn.pos.y + dy, STRUCTURE_LINK) === OK) {
                            remaining--;
                            break outer;
                        }
                    }
                }
            }
        }
    }
}
// ─── Terminal (RCL 6+) ───────────────────────────────────────────────────────
function placeTerminal(room) {
    if (room.terminal)
        return;
    if (room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_TERMINAL }).length > 0)
        return;
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn)
        return;
    for (let r = 4; r <= 12; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r)
                    continue;
                const x = spawn.pos.x + dx, y = spawn.pos.y + dy;
                if (x < 2 || x > 47 || y < 2 || y > 47)
                    continue;
                if (room.createConstructionSite(x, y, STRUCTURE_TERMINAL) === OK)
                    return;
            }
        }
    }
}
// ─── Extractor (RCL 6+) ──────────────────────────────────────────────────────
function placeExtractor(room) {
    const mineral = room.find(FIND_MINERALS)[0];
    if (!mineral)
        return;
    const hasExtractor = mineral.pos.lookFor(LOOK_STRUCTURES).some(s => s.structureType === STRUCTURE_EXTRACTOR) ||
        mineral.pos.lookFor(LOOK_CONSTRUCTION_SITES).some(s => s.structureType === STRUCTURE_EXTRACTOR);
    if (!hasExtractor) {
        room.createConstructionSite(mineral.pos.x, mineral.pos.y, STRUCTURE_EXTRACTOR);
        console.log(`[adaptive] Extractor site placed at mineral (${mineral.pos.x},${mineral.pos.y})`);
    }
}
// ─── Additional spawns (RCL 7+) ──────────────────────────────────────────────
// Strategy report §RC7: "Build second spawn immediately — removes spawn bottleneck."
function placeAdditionalSpawns(room, rcl) {
    var _a;
    const built = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_SPAWN }).length;
    const pending = room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_SPAWN }).length;
    const allowed = (_a = CONTROLLER_STRUCTURES[STRUCTURE_SPAWN][rcl]) !== null && _a !== void 0 ? _a : 1;
    if (built + pending >= allowed)
        return;
    const ref = room.find(FIND_MY_SPAWNS)[0];
    if (!ref)
        return;
    for (let r = 2; r <= 8; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r)
                    continue;
                const x = ref.pos.x + dx, y = ref.pos.y + dy;
                if (x < 2 || x > 47 || y < 2 || y > 47)
                    continue;
                if (room.createConstructionSite(x, y, STRUCTURE_SPAWN) === OK) {
                    console.log(`[adaptive] Spawn ${built + pending + 1} site placed at (${x},${y})`);
                    return;
                }
            }
        }
    }
}
// ─── Ramparts ────────────────────────────────────────────────────────────────
function placeRamparts(room) {
    const toProtect = [
        ...room.find(FIND_MY_SPAWNS),
        ...room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER }),
    ];
    for (const s of toProtect) {
        const has = s.pos.lookFor(LOOK_STRUCTURES).some(ls => ls.structureType === STRUCTURE_RAMPART) ||
            s.pos.lookFor(LOOK_CONSTRUCTION_SITES).some(cs => cs.structureType === STRUCTURE_RAMPART);
        if (!has)
            room.createConstructionSite(s.pos.x, s.pos.y, STRUCTURE_RAMPART);
    }
}

// Plans multi-platoon approach tactics when combat transitions to MARCH.
// Called once per MARCH phase to assign each platoon a PlatoonOrder.
//
// PINCER  — platoon_0 direct, platoon_1 routes through a flank room.
//           Both engage simultaneously. Towers must split fire.
//
// FEINT+MAIN — platoon_0 rushes in to draw tower fire then retreats.
//              platoon_1 enters from a flank room 100 ticks later.
//              Best against heavily defended rooms.
//
// DIRECT  — all platoons take the shortest path. Used when only one platoon
//           is available or no viable flank room exists.
const ESTIMATED_TRAVEL_TICKS = 40;
const FEINT_DURATION_TICKS = 150;
const MAIN_DELAY_TICKS = 80;
// Called per room — plans tactics only for combat units homed in this room.
function manageTactics(room) {
    var _a;
    const state = (_a = room.memory.combatState) !== null && _a !== void 0 ? _a : 'RALLY';
    if (state !== 'MARCH') {
        if (state === 'RALLY') {
            room.memory.platoonOrders = undefined;
            room.memory.coordinatedAttackTick = undefined;
        }
        return;
    }
    if (!room.memory.enemyRoomName)
        return;
    if (room.memory.platoonOrders)
        return; // already planned this MARCH
    const platoons = getActivePlatoonIds(room.name);
    if (platoons.length === 0)
        return;
    const orders = planTactics(platoons, room.memory.enemyRoomName);
    room.memory.platoonOrders = Object.fromEntries(Object.entries(orders).map(([id, o]) => [id, o]));
    const tactics = Object.values(orders).map(o => o.tactic).join(', ');
    console.log(`[${room.name}] Tactics assigned: [${tactics}] vs ${room.memory.enemyRoomName}`);
}
// ─── Planning ─────────────────────────────────────────────────────────────────
function planTactics(platoons, enemyRoom) {
    var _a, _b;
    const intel = (_a = Memory.roomIntel) === null || _a === void 0 ? void 0 : _a[enemyRoom];
    const hasTowers = ((_b = intel === null || intel === void 0 ? void 0 : intel.enemyTowers) !== null && _b !== void 0 ? _b : 0) > 0;
    const flankRoom = findFlankRoom(enemyRoom);
    if (platoons.length === 1 || !flankRoom) {
        return Object.fromEntries(platoons.map(id => [id, { tactic: 'DIRECT' }]));
    }
    if (platoons.length >= 2 && hasTowers) {
        const feintId = platoons[0];
        const mainId = platoons[1];
        return {
            [feintId]: {
                tactic: 'FEINT',
                feintEndTick: Game.time + ESTIMATED_TRAVEL_TICKS + FEINT_DURATION_TICKS,
            },
            [mainId]: {
                tactic: 'MAIN',
                waypointRoom: flankRoom,
                engageTick: Game.time + ESTIMATED_TRAVEL_TICKS + MAIN_DELAY_TICKS,
            },
            ...Object.fromEntries(platoons.slice(2).map(id => [id, { tactic: 'DIRECT' }])),
        };
    }
    return {
        [platoons[0]]: { tactic: 'DIRECT' },
        [platoons[1]]: { tactic: 'FLANK', waypointRoom: flankRoom },
        ...Object.fromEntries(platoons.slice(2).map(id => [id, { tactic: 'DIRECT' }])),
    };
}
function findFlankRoom(enemyRoom) {
    var _a;
    const exits = Game.map.describeExits(enemyRoom);
    if (!exits)
        return null;
    const homeRooms = new Set(Object.keys(Game.rooms).filter(r => { var _a; return (_a = Game.rooms[r].controller) === null || _a === void 0 ? void 0 : _a.my; }));
    const candidates = Object.values(exits).filter(Boolean)
        .filter(r => !homeRooms.has(r) && Game.map.getRoomStatus(r).status === 'normal');
    return (_a = candidates[0]) !== null && _a !== void 0 ? _a : null;
}
// Only platoons whose fighters are homed in this room.
function getActivePlatoonIds(homeRoom) {
    const ids = new Set();
    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        const pid = creep.memory.platoonId;
        const role = creep.memory.role;
        if (pid && (role === 'warrior' || role === 'ranger') && creep.memory.homeRoom === homeRoom) {
            ids.add(pid);
        }
    }
    return [...ids].sort();
}

const MIN_FIGHTERS_TO_MARCH = 4;
const MIN_HEALERS_TO_MARCH = 1;
const RAID_STRENGTH_MAX = 15; // raid without healer if enemy this weak
const REASSESS_INTERVAL = 500;
const SAFE_MODE_RAMPART_THRESHOLD = 5000;
const SAFE_MODE_OVERWHELM_COUNT = 5;
// Decay limit from screeps-quorum/fortify.js: ramparts below this are treated as
// emergencies and repaired before any other structure.
const RAMPART_DECAY_LIMIT = 30000;
const FORTIFY_CACHE_TICKS = 50;
// ─── Tower falloff tables (Quorum: src/programs/city/defense.js) ─────────────
// Pre-computed once per global reset; indexed by tile distance (0–49).
// Avoids repeated floating-point math in the hot tower-targeting path.
const TOWER_DMG_AT = [];
const TOWER_HEAL_AT = [];
function initTowerTables() {
    if (TOWER_DMG_AT.length > 0)
        return;
    for (let d = 0; d < 50; d++) {
        TOWER_DMG_AT[d] = towerEffect(TOWER_POWER_ATTACK, d);
        TOWER_HEAL_AT[d] = towerEffect(TOWER_POWER_HEAL, d);
    }
}
function towerEffect(power, distance) {
    if (distance <= TOWER_OPTIMAL_RANGE)
        return power;
    const d = Math.min(distance, TOWER_FALLOFF_RANGE);
    return Math.floor(power - power * TOWER_FALLOFF * (d - TOWER_OPTIMAL_RANGE) / (TOWER_FALLOFF_RANGE - TOWER_OPTIMAL_RANGE));
}
// ─── Public entry ─────────────────────────────────────────────────────────────
function manageCombat(room) {
    checkSafeMode(room);
    manageTowers(room);
    manageCombatState(room);
    manageTactics(room);
    manageQuads(room);
}
// ─── Safe mode ────────────────────────────────────────────────────────────────
function checkSafeMode(room) {
    var _a;
    const ctrl = room.controller;
    if (!ctrl || ctrl.safeMode || !ctrl.safeModeAvailable)
        return;
    const dangerousHostiles = room.find(FIND_HOSTILE_CREEPS).filter(c => c.body.some(p => p.type === ATTACK || p.type === RANGED_ATTACK || p.type === WORK));
    if (dangerousHostiles.length === 0)
        return;
    const ramparts = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_RAMPART,
    });
    const criticalRampart = ramparts.length > 0 &&
        Math.min(...ramparts.map(r => r.hits)) < SAFE_MODE_RAMPART_THRESHOLD;
    const overwhelmed = dangerousHostiles.length >= SAFE_MODE_OVERWHELM_COUNT;
    if (!criticalRampart && !overwhelmed)
        return;
    // Quorum safemode priority guard: if a higher-RCL owned room still has charges,
    // withhold ours — ghodium is scarce and more valuable rooms need protection first.
    const myRcl = (_a = ctrl.level) !== null && _a !== void 0 ? _a : 0;
    const betterRoomHasCharges = Object.values(Game.rooms).some(r => {
        var _a, _b, _c, _d, _e;
        return r.name !== room.name &&
            ((_a = r.controller) === null || _a === void 0 ? void 0 : _a.my) &&
            ((_c = (_b = r.controller) === null || _b === void 0 ? void 0 : _b.level) !== null && _c !== void 0 ? _c : 0) > myRcl &&
            ((_e = (_d = r.controller) === null || _d === void 0 ? void 0 : _d.safeModeAvailable) !== null && _e !== void 0 ? _e : 0) > 0;
    });
    if (betterRoomHasCharges) {
        console.log(`[${room.name}] Safemode withheld — higher-RCL room has charges`);
        return;
    }
    ctrl.activateSafeMode();
    console.log(`[${room.name}] SAFE MODE ACTIVATED (hostiles=${dangerousHostiles.length} criticalRampart=${criticalRampart})`);
}
// ─── Tower management ────────────────────────────────────────────────────────
function manageTowers(room) {
    const towers = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER,
    });
    if (towers.length === 0)
        return;
    initTowerTables();
    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    if (hostiles.length > 0) {
        // Falloff-aware targeting: pick healer priority, then the target our
        // towers collectively deal the most damage to at their actual distances.
        const target = chooseTowerTarget(towers, hostiles);
        for (const tower of towers) {
            if (tower.store[RESOURCE_ENERGY] < TOWER_ENERGY_COST)
                continue;
            tower.attack(target);
        }
        return;
    }
    // No hostiles: heal the most-damaged friendly creep.
    // Quorum pattern: accumulate heal from successive towers and break early
    // once remaining damage is covered — prevents wasting energy on a creep
    // that's already fully covered by earlier towers in the list.
    const myCreeps = room.find(FIND_MY_CREEPS);
    const damaged = myCreeps.filter(c => c.hits < c.hitsMax);
    if (damaged.length > 0) {
        const target = damaged.reduce((a, b) => (a.hitsMax - a.hits) > (b.hitsMax - b.hits) ? a : b);
        let remaining = target.hitsMax - target.hits;
        for (const tower of towers) {
            if (remaining <= 0)
                break;
            if (tower.store[RESOURCE_ENERGY] < TOWER_ENERGY_COST)
                continue;
            const d = Math.min(tower.pos.getRangeTo(target), 49);
            remaining -= TOWER_HEAL_AT[d];
            tower.heal(target);
        }
        return;
    }
    // Priority 3 (strategy report §Military): repair highest-priority rampart.
    const fortifyTarget = getFortifyTarget(room);
    if (fortifyTarget) {
        for (const tower of towers) {
            if (tower.store[RESOURCE_ENERGY] < TOWER_ENERGY_COST)
                continue;
            tower.repair(fortifyTarget);
        }
        return;
    }
    // Priority 4: repair damaged roads (< 50% hits) when tower tanks are healthy.
    // Only when energy > 700 — keep reserves high in case hostiles appear next tick.
    const damagedRoad = room.find(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_ROAD && s.hits < s.hitsMax * 0.5,
    })[0];
    if (damagedRoad) {
        for (const tower of towers) {
            if (tower.store[RESOURCE_ENERGY] < 700)
                continue;
            tower.repair(damagedRoad);
        }
    }
}
// Healer priority — killing regeneration multiplies effective tower DPS.
// Within each pool, pick the target our towers collectively deal most damage to
// (falloff-weighted sum across all towers at their actual distances).
function chooseTowerTarget(towers, hostiles) {
    const healers = hostiles.filter(c => c.body.some(p => p.type === HEAL && p.hits > 0));
    const pool = healers.length > 0 ? healers : hostiles;
    let best = pool[0];
    let bestDmg = -1;
    for (const hostile of pool) {
        let totalDmg = 0;
        for (const tower of towers) {
            const d = Math.min(tower.pos.getRangeTo(hostile), 49);
            totalDmg += TOWER_DMG_AT[d];
        }
        if (totalDmg > bestDmg) {
            bestDmg = totalDmg;
            best = hostile;
        }
    }
    return best;
}
// ─── Decay-first rampart repair (Quorum: src/programs/city/fortify.js) ───────
// Priority: decaying (< 30k hits) sorted ascending → then lowest hits overall.
// Result cached for 50 ticks to avoid O(n) find every tick.
function getFortifyTarget(room) {
    var _a;
    const cached = room.memory.fortifyTarget
        ? Game.getObjectById(room.memory.fortifyTarget)
        : null;
    if (cached && Game.time - ((_a = room.memory.fortifyTargetTick) !== null && _a !== void 0 ? _a : 0) < FORTIFY_CACHE_TICKS) {
        return cached;
    }
    const ramparts = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_RAMPART,
    });
    if (ramparts.length === 0)
        return null;
    const decaying = ramparts.filter(r => r.hits <= RAMPART_DECAY_LIMIT);
    const target = decaying.length > 0
        ? decaying.reduce((a, b) => a.hits < b.hits ? a : b)
        : ramparts.reduce((a, b) => a.hits < b.hits ? a : b);
    room.memory.fortifyTarget = target.id;
    room.memory.fortifyTargetTick = Game.time;
    return target;
}
// ─── Per-room combat state machine ───────────────────────────────────────────
function manageCombatState(room) {
    var _a, _b;
    // Must use global creep registry — room.find() only sees creeps physically present in
    // the home room, so it returns 0 fighters the moment they march to the enemy room,
    // which would instantly reset combatState to RALLY and create an infinite bounce loop.
    const allCombat = Object.values(Game.creeps).filter(c => (c.memory.role === 'warrior' || c.memory.role === 'ranger' || c.memory.role === 'healer') &&
        c.memory.homeRoom === room.name);
    const fighters = allCombat.filter(c => c.memory.role === 'warrior' || c.memory.role === 'ranger');
    const healers = allCombat.filter(c => c.memory.role === 'healer');
    const state = (_a = room.memory.combatState) !== null && _a !== void 0 ? _a : 'RALLY';
    const enemyRoom = room.memory.enemyRoomName;
    switch (state) {
        case 'RALLY': {
            const isRaidTarget = ((_b = room.memory.enemyStrength) !== null && _b !== void 0 ? _b : 999) <= RAID_STRENGTH_MAX;
            const healerReady = healers.length >= MIN_HEALERS_TO_MARCH;
            if (fighters.length >= MIN_FIGHTERS_TO_MARCH && (healerReady || isRaidTarget) && enemyRoom) {
                room.memory.combatState = 'MARCH';
                room.memory.rallyTick = Game.time;
                assignTargetRoom(allCombat, enemyRoom);
                const mode = healerReady ? `${healers.length}h` : 'RAID';
                console.log(`[${room.name}] Combat → MARCH (${fighters.length}f ${mode} → ${enemyRoom})`);
            }
            break;
        }
        case 'MARCH': {
            if (fighters.length === 0) {
                room.memory.combatState = 'RALLY';
                break;
            }
            const inEnemyRoom = fighters.filter(c => c.room.name === enemyRoom);
            // Wait until ALL remaining fighters are in the enemy room so the group
            // enters together. "All" is capped at fighters.length so a death en route
            // doesn't permanently stall the march.
            if (inEnemyRoom.length > 0 && inEnemyRoom.length >= fighters.length) {
                room.memory.combatState = 'ENGAGE';
                console.log(`[${room.name}] Combat → ENGAGE`);
            }
            break;
        }
        case 'ENGAGE':
            if (fighters.length === 0) {
                room.memory.combatState = 'RALLY';
                console.log(`[${room.name}] Combat → RALLY (all fighters lost)`);
            }
            if (room.memory.rallyTick && Game.time - room.memory.rallyTick > REASSESS_INTERVAL) {
                room.memory.scoutTick = undefined;
                room.memory.rallyTick = Game.time;
            }
            // Refresh intel from the battlefield every tick while fighters have visibility.
            // remoteManager and spawnManager both gate on Memory.roomIntel[enemyRoom].enemyCreeps;
            // without this, they wait up to 300 ticks for the scout to rescan the cleared room
            // before spawning our reserver/miners/haulers.
            if (enemyRoom)
                refreshBattlefieldIntel(enemyRoom);
            break;
    }
}
// Write live intel from the enemy room while our fighters are there.
// Only runs when we actually have visibility (fighters are in the room → Game.rooms has it).
// Mirrors recordRoomIntel in scout.ts but does NOT update owned rooms' enemyRoomName —
// that stays as-is so the attack campaign continues until strategyManager clears it.
function refreshBattlefieldIntel(roomName) {
    var _a, _b;
    const target = Game.rooms[roomName];
    if (!target)
        return; // no visibility yet (fighters still travelling)
    const enemyCreeps = target.find(FIND_HOSTILE_CREEPS).length;
    const enemySpawns = target.find(FIND_HOSTILE_STRUCTURES, { filter: s => s.structureType === STRUCTURE_SPAWN }).length;
    const enemyTowers = target.find(FIND_HOSTILE_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER }).length;
    const strength = enemyCreeps + enemySpawns * 5 + enemyTowers * 8;
    if (!Memory.roomIntel)
        Memory.roomIntel = {};
    const prev = Memory.roomIntel[roomName];
    Memory.roomIntel[roomName] = {
        scannedAt: Game.time,
        enemyCreeps,
        enemySpawns,
        enemyTowers,
        strength,
        hasController: !!(target.controller),
        controllerOwned: !!((_a = target.controller) === null || _a === void 0 ? void 0 : _a.owner),
        sourceCount: (_b = prev === null || prev === void 0 ? void 0 : prev.sourceCount) !== null && _b !== void 0 ? _b : target.find(FIND_SOURCES).length,
    };
}
function assignTargetRoom(units, roomName) {
    for (const u of units)
        u.memory.targetRoomName = roomName;
}

// Multi-room defense coordinator.
//
// Runs once per owned room per tick. Maintains Memory.roomThreats:
//   WARNING  — scout intel shows enemy combat creeps in an adjacent room
//   ACTIVE   — dangerous hostiles are physically inside this room right now
//
// When a room goes ACTIVE, any combat units that are currently rallying in a
// safe room (combatState === 'RALLY', not yet on an offensive mission) are
// dispatched there via creep.memory.defendingRoom. They return home when the
// threat clears.
//
// This layer is orthogonal to the global RALLY/MARCH/ENGAGE offense machine.
// Offense campaigns continue uninterrupted; only idle (RALLY) units are
// redirected for defense.
const THREAT_CLEAR_TICKS = 50; // ticks without hostile sighting before clearing
const WARNING_MAX_AGE = 100; // scout intel must be this fresh to trigger WARNING
function manageDefense(room) {
    if (!Memory.roomThreats)
        Memory.roomThreats = {};
    detectActiveThreats(room);
    checkEarlyWarnings(room);
    dispatchAndRecall();
}
// ─── Threat detection ─────────────────────────────────────────────────────────
function detectActiveThreats(room) {
    var _a;
    const hostiles = room.find(FIND_HOSTILE_CREEPS, {
        filter: c => c.body.some(p => p.type === ATTACK || p.type === RANGED_ATTACK || p.type === WORK),
    });
    if (hostiles.length > 0) {
        const str = hostiles.reduce((s, c) => s + threatScore(c), 0);
        const prev = Memory.roomThreats[room.name];
        Memory.roomThreats[room.name] = {
            detectedAt: (_a = prev === null || prev === void 0 ? void 0 : prev.detectedAt) !== null && _a !== void 0 ? _a : Game.time,
            lastSeenAt: Game.time,
            hostileCount: hostiles.length,
            strength: str,
            severity: 'ACTIVE',
            fromRoom: prev === null || prev === void 0 ? void 0 : prev.fromRoom,
        };
        if (!prev || prev.severity !== 'ACTIVE') {
            console.log(`[defense] ⚠️ ACTIVE in ${room.name}: ${hostiles.length} hostiles str=${str}`);
        }
        return;
    }
    // No hostiles — age out ACTIVE threats
    const prev = Memory.roomThreats[room.name];
    if ((prev === null || prev === void 0 ? void 0 : prev.severity) === 'ACTIVE' && Game.time - prev.lastSeenAt > THREAT_CLEAR_TICKS) {
        delete Memory.roomThreats[room.name];
        console.log(`[defense] ✓ Threat cleared in ${room.name}`);
    }
}
// ─── Early warning ────────────────────────────────────────────────────────────
// Uses recent scout intel to warn before enemies enter our room.
function checkEarlyWarnings(room) {
    var _a, _b, _c, _d, _e;
    // Don't downgrade an ACTIVE threat to a WARNING
    if (((_a = Memory.roomThreats[room.name]) === null || _a === void 0 ? void 0 : _a.severity) === 'ACTIVE')
        return;
    const exits = Game.map.describeExits(room.name);
    if (!exits)
        return;
    const intel = (_b = Memory.roomIntel) !== null && _b !== void 0 ? _b : {};
    let bestNeighbor;
    let bestStrength = 0;
    for (const neighbor of Object.values(exits)) {
        if (!neighbor)
            continue;
        const data = intel[neighbor];
        if (!data)
            continue;
        if (Game.time - data.scannedAt > WARNING_MAX_AGE)
            continue; // stale intel
        if (data.enemyCreeps === 0)
            continue;
        if (data.strength > bestStrength) {
            bestStrength = data.strength;
            bestNeighbor = neighbor;
        }
    }
    if (bestNeighbor) {
        const prev = Memory.roomThreats[room.name];
        Memory.roomThreats[room.name] = {
            detectedAt: (_c = prev === null || prev === void 0 ? void 0 : prev.detectedAt) !== null && _c !== void 0 ? _c : Game.time,
            lastSeenAt: Game.time,
            hostileCount: (_e = (_d = intel[bestNeighbor]) === null || _d === void 0 ? void 0 : _d.enemyCreeps) !== null && _e !== void 0 ? _e : 0,
            strength: bestStrength,
            severity: 'WARNING',
            fromRoom: bestNeighbor,
        };
        if (!prev) {
            console.log(`[defense] ⚡ WARNING for ${room.name}: enemy movement in ${bestNeighbor} str=${bestStrength}`);
        }
        return;
    }
    // No warning found — age out stale WARNINGs
    const prev = Memory.roomThreats[room.name];
    if ((prev === null || prev === void 0 ? void 0 : prev.severity) === 'WARNING' && Game.time - prev.lastSeenAt > THREAT_CLEAR_TICKS) {
        delete Memory.roomThreats[room.name];
    }
}
// ─── Dispatch & recall ────────────────────────────────────────────────────────
// Iterates all creeps globally. Called multiple times per tick (once per owned room)
// but is idempotent — already-dispatched units are skipped.
function dispatchAndRecall() {
    var _a, _b, _c, _d, _e;
    const threats = (_a = Memory.roomThreats) !== null && _a !== void 0 ? _a : {};
    // Recall defenders whose threat has resolved
    for (const creep of Object.values(Game.creeps)) {
        const assigned = creep.memory.defendingRoom;
        if (!assigned)
            continue;
        if (((_b = threats[assigned]) === null || _b === void 0 ? void 0 : _b.severity) === 'ACTIVE')
            continue;
        // Threat gone — send home
        console.log(`[defense] Recalling ${creep.name} from ${assigned} → ${(_c = creep.memory.homeRoom) !== null && _c !== void 0 ? _c : 'unknown'}`);
        creep.memory.defendingRoom = undefined;
        creep.memory.targetRoomName = creep.memory.homeRoom;
    }
    // Dispatch idle units to active threats
    const activeThreats = Object.entries(threats).filter(([, t]) => t.severity === 'ACTIVE');
    if (activeThreats.length === 0)
        return;
    for (const [threatenedRoom] of activeThreats) {
        for (const creep of Object.values(Game.creeps)) {
            if (creep.memory.role !== 'warrior' &&
                creep.memory.role !== 'ranger' &&
                creep.memory.role !== 'healer')
                continue;
            if (creep.memory.defendingRoom)
                continue; // already on a mission
            if (!creep.memory.homeRoom)
                continue; // no homeRoom — legacy creep, skip
            // Only dispatch from rooms that are not themselves under active threat
            if (((_d = threats[creep.memory.homeRoom]) === null || _d === void 0 ? void 0 : _d.severity) === 'ACTIVE')
                continue;
            // Only dispatch units currently in their home room (they're in RALLY state)
            if (creep.room.name !== creep.memory.homeRoom)
                continue;
            // Don't pull from an active offense campaign in the creep's home room
            const homeState = creep.memory.homeRoom
                ? (_e = Game.rooms[creep.memory.homeRoom]) === null || _e === void 0 ? void 0 : _e.memory.combatState
                : undefined;
            if (homeState && homeState !== 'RALLY')
                continue;
            creep.memory.defendingRoom = threatenedRoom;
            creep.memory.targetRoomName = threatenedRoom;
            console.log(`[defense] Dispatching ${creep.name} (${creep.memory.role}) ${creep.memory.homeRoom} → ${threatenedRoom}`);
        }
    }
}
// ─── Helpers ─────────────────────────────────────────────────────────────────
function threatScore(creep) {
    return creep.body.reduce((n, p) => {
        if (p.type === ATTACK)
            return n + 3;
        if (p.type === RANGED_ATTACK)
            return n + 2;
        if (p.type === WORK)
            return n + 1;
        return n;
    }, 0);
}

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
function manageLinkTransfers(room) {
    var _a, _b;
    if (((_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0) < 5)
        return;
    const links = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_LINK,
    });
    if (links.length < 2)
        return;
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn)
        return;
    const ctrl = room.controller;
    const sources = room.find(FIND_SOURCES);
    // Source links: adjacent to any source (range 2). These push energy in.
    const sourceLinks = links.filter(l => sources.some(src => src.pos.getRangeTo(l) <= 2));
    // Sink links: everything else (not adjacent to any source).
    const sinkLinks = links.filter(l => !sources.some(src => src.pos.getRangeTo(l) <= 2));
    if (sourceLinks.length === 0 || sinkLinks.length === 0)
        return;
    // Controller link: the sink closest to the controller (upgrader energy supply).
    const ctrlLink = ctrl
        ? sinkLinks.reduce((a, b) => a.pos.getRangeTo(ctrl) <= b.pos.getRangeTo(ctrl) ? a : b)
        : sinkLinks[0];
    // Hub link: the remaining sink closest to spawn (hauler energy supply).
    const otherSinks = sinkLinks.filter(l => l.id !== ctrlLink.id);
    const hubLink = otherSinks.length > 0
        ? otherSinks.reduce((a, b) => a.pos.getRangeTo(spawn) <= b.pos.getRangeTo(spawn) ? a : b)
        : null;
    const sinks = [ctrlLink, hubLink].filter(Boolean);
    for (const link of sourceLinks) {
        if (link.cooldown > 0)
            continue;
        if (link.store[RESOURCE_ENERGY] < 400)
            continue;
        // Send to the sink with the most free capacity — fills both evenly.
        const bestSink = sinks.reduce((best, sink) => {
            var _a, _b;
            const free = (_a = sink.store.getFreeCapacity(RESOURCE_ENERGY)) !== null && _a !== void 0 ? _a : 0;
            if (free < 100)
                return best;
            if (!best)
                return sink;
            return free > ((_b = best.store.getFreeCapacity(RESOURCE_ENERGY)) !== null && _b !== void 0 ? _b : 0) ? sink : best;
        }, null);
        if (bestSink)
            link.transferEnergy(bestSink);
    }
}

// Manages terminal trades.
// Primary use: buy ghodium when safe mode charges are depleted.
// Ghodium (1000G) is consumed by a creep using generateSafeMode(controller) to
// add one safe mode charge. The upgrader handles the generation step.
const GHODIUM_TARGET = 1000; // enough for one safe mode recharge
const CHECK_INTERVAL = 200; // only scan market every 200 ticks (rate limit + CPU)
const MIN_CREDITS = 500; // don't buy if broke
function manageMarket(room) {
    var _a, _b, _c, _d, _e;
    if (!room.terminal)
        return;
    if (room.terminal.cooldown > 0)
        return;
    if (!period(CHECK_INTERVAL, 'market:check'))
        return;
    const ctrl = room.controller;
    if (!ctrl)
        return;
    // Check ghodium need: safe mode charges depleted and we don't have enough ghodium yet
    const ghodiumHeld = (_a = room.terminal.store.getUsedCapacity(RESOURCE_GHODIUM)) !== null && _a !== void 0 ? _a : 0;
    if (ctrl.safeModeAvailable > 0 || ghodiumHeld >= GHODIUM_TARGET)
        return;
    if (Game.market.credits < MIN_CREDITS) {
        console.log('[adaptive] Market: low credits, skipping ghodium purchase');
        return;
    }
    const orders = Game.market.getAllOrders({
        type: ORDER_SELL,
        resourceType: RESOURCE_GHODIUM,
    });
    if (orders.length === 0)
        return;
    // Pick cheapest order with enough stock
    const viable = orders
        .filter(o => { var _a; return ((_a = o.amount) !== null && _a !== void 0 ? _a : 0) >= 100; })
        .sort((a, b) => { var _a, _b; return ((_a = a.price) !== null && _a !== void 0 ? _a : 0) - ((_b = b.price) !== null && _b !== void 0 ? _b : 0); });
    if (viable.length === 0)
        return;
    const best = viable[0];
    const need = GHODIUM_TARGET - ghodiumHeld;
    const afford = Math.floor(Game.market.credits / ((_b = best.price) !== null && _b !== void 0 ? _b : 1));
    const amount = Math.min(need, (_c = best.amount) !== null && _c !== void 0 ? _c : 0, afford, 1000);
    if (amount <= 0)
        return;
    const result = Game.market.deal(best.id, amount, room.name);
    if (result === OK) {
        console.log(`[adaptive] Market: ordered ${amount}G @ ${(_d = best.price) === null || _d === void 0 ? void 0 : _d.toFixed(2)} each (total ${(amount * ((_e = best.price) !== null && _e !== void 0 ? _e : 0)).toFixed(0)} credits)`);
    }
}

// Inter-room energy balancing.
// Identifies rooms with surplus energy and rooms in deficit, then spawns couriers
// to physically carry energy until RCL 6+ terminals are available.
//
// Each tick this runs per room and writes room.memory.energySurplus.
// Spawning couriers is handled by spawnManager reading that value.
const SURPLUS_THRESHOLD = 100000; // storage energy above this = surplus
const DEFICIT_THRESHOLD = 10000; // storage energy below this = deficit
const TERMINAL_RCL = 6; // at this RCL, use terminal transfers instead
function manageTransfers(room) {
    if (!room.controller)
        return;
    const rcl = room.controller.level;
    const storage = room.storage;
    // Compute and publish this room's surplus for spawnManager to read
    if (storage) {
        const energy = storage.store[RESOURCE_ENERGY];
        room.memory.energySurplus = energy > SURPLUS_THRESHOLD ? energy - SURPLUS_THRESHOLD : 0;
    }
    else {
        room.memory.energySurplus = 0;
    }
    // At RCL 6+, terminals handle inter-room transfers — use them if both rooms have terminals
    if (rcl >= TERMINAL_RCL) {
        manageTerminalTransfers(room);
    }
}
function manageTerminalTransfers(room) {
    const terminal = room.terminal;
    if (!terminal || terminal.cooldown > 0)
        return;
    if (terminal.store[RESOURCE_ENERGY] < 1000)
        return;
    // Find another owned room with low energy that has a terminal
    const deficitRoom = Object.values(Game.rooms).find(r => {
        var _a;
        return r.name !== room.name &&
            ((_a = r.controller) === null || _a === void 0 ? void 0 : _a.my) &&
            r.controller.level >= TERMINAL_RCL &&
            r.terminal &&
            r.storage &&
            r.storage.store[RESOURCE_ENERGY] < DEFICIT_THRESHOLD;
    });
    if (!deficitRoom || !deficitRoom.terminal)
        return;
    // Send 5000 energy — leave some for the terminal itself
    const sendAmount = Math.min(5000, terminal.store[RESOURCE_ENERGY] - 500);
    if (sendAmount <= 0)
        return;
    const result = terminal.send(RESOURCE_ENERGY, sendAmount, deficitRoom.name);
    if (result === OK) {
        console.log(`[${room.name}] Terminal → ${deficitRoom.name}: ${sendAmount}e`);
    }
}

// Remote mining manager.
// Identifies adjacent rooms suitable for reservation + harvesting, computes how many
// remote miners and haulers are needed (distance-based), and publishes spawn targets
// to room.memory.remoteRooms for spawnManager to act on.
//
// Remote rooms are processed in priority order: closest (linear distance = 1) first,
// then rooms with more sources.
const MAX_REMOTE_ROOMS = 3; // cap: CPU scales with remote rooms
const MIN_MINER_RCL = 2; // RCL 2 has containers + haulers — remote mining helps economy
function manageRemote(room) {
    var _a, _b;
    if (((_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0) < MIN_MINER_RCL)
        return;
    if (!room.memory.remoteRooms)
        room.memory.remoteRooms = {};
    // Find candidate rooms: adjacent, neutral, not already owned
    const candidates = findCandidateRooms(room);
    // Trim to top MAX_REMOTE_ROOMS by source count desc
    const chosen = candidates.slice(0, MAX_REMOTE_ROOMS);
    // Remove stale entries (rooms we no longer want to harvest)
    const chosenNames = new Set(chosen.map(r => r.name));
    for (const name of Object.keys(room.memory.remoteRooms)) {
        if (!chosenNames.has(name))
            delete room.memory.remoteRooms[name];
    }
    // Update spawn targets for each chosen room
    for (const remote of chosen) {
        const distanceTiles = estimateRoundTripTiles(room.name, remote.name);
        const haulerCarry = bestHaulerCarry(room.energyCapacityAvailable);
        // Each source produces ~10e/tick; miners * round-trip determines hauler count
        const haulersNeeded = Math.ceil(10 * distanceTiles * remote.sources / haulerCarry);
        room.memory.remoteRooms[remote.name] = {
            sources: remote.sources,
            miners: remote.sources, // 1 big miner per source
            haulers: Math.max(1, haulersNeeded),
            reservedUntil: remote.reservedUntil,
        };
    }
}
function findCandidateRooms(home) {
    var _a, _b, _c, _d, _e, _f, _g;
    const exits = Game.map.describeExits(home.name);
    if (!exits)
        return [];
    const ownedNames = new Set(Object.values(Game.rooms)
        .filter(r => { var _a; return (_a = r.controller) === null || _a === void 0 ? void 0 : _a.my; })
        .map(r => r.name));
    const candidates = [];
    for (const roomName of Object.values(exits).filter((n) => !!n)) {
        if (ownedNames.has(roomName))
            continue;
        if (Game.map.getRoomStatus(roomName).status !== 'normal')
            continue;
        const intel = (_a = Memory.roomIntel) === null || _a === void 0 ? void 0 : _a[roomName];
        // Skip if last scan showed an enemy owner (don't try to harvest occupied rooms)
        if (intel === null || intel === void 0 ? void 0 : intel.controllerOwned)
            continue;
        // Skip if hostile combat creeps spotted recently (< 200t ago)
        if (intel && intel.enemyCreeps > 0 && Game.time - intel.scannedAt < 200)
            continue;
        const ctrl = (_b = Game.rooms[roomName]) === null || _b === void 0 ? void 0 : _b.controller;
        const reservedUntil = (_d = (_c = ctrl === null || ctrl === void 0 ? void 0 : ctrl.reservation) === null || _c === void 0 ? void 0 : _c.ticksToEnd) !== null && _d !== void 0 ? _d : 0;
        const sources = (_e = intel === null || intel === void 0 ? void 0 : intel.sourceCount) !== null && _e !== void 0 ? _e : ((_g = (_f = Game.rooms[roomName]) === null || _f === void 0 ? void 0 : _f.find(FIND_SOURCES).length) !== null && _g !== void 0 ? _g : 1);
        candidates.push({ name: roomName, sources, reservedUntil });
    }
    // Prefer rooms with more sources, then alphabetical for stability
    return candidates.sort((a, b) => b.sources - a.sources || a.name.localeCompare(b.name));
}
// ─── Distance-based hauler math ───────────────────────────────────────────────
// Approximate round-trip tile count for a cross-room trip.
// Adjacent room (linear distance = 1) ≈ 110 tiles round trip on roads.
function estimateRoundTripTiles(home, remote) {
    const dist = Game.map.getRoomLinearDistance(home, remote);
    return (dist * 50 + 5) * 2; // 50 tiles/room + 5 for exits, doubled for return
}
// How much energy the best-available hauler body can carry given the room's cap.
// Mirrors the haulerBody() logic in bodyBuilder.ts: [CC,M] units at 150e each.
function bestHaulerCarry(energyCap) {
    const units = Math.min(Math.floor(energyCap / 150), 10);
    return units * 100; // each CC unit = 100e capacity
}

// Observer manager (RC8+): rotates observer.observeRoom() through known rooms each
// tick to keep Memory.roomIntel fresh without spending scout creep CPU.
// Picks the least-recently-scanned room each tick, so intel ages evenly.
// Writes the same RoomIntel fields that scout.ts populates.
function manageObserver(room) {
    var _a, _b, _c, _d, _e, _f, _g;
    if (((_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0) < 8)
        return;
    const observer = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_OBSERVER,
    })[0];
    if (!observer)
        return;
    const known = Object.keys((_c = Memory.roomIntel) !== null && _c !== void 0 ? _c : {});
    if (known.length === 0)
        return;
    // Pick the room scanned least recently so all intel ages evenly
    const target = known.reduce((oldest, name) => {
        var _a, _b, _c, _d;
        const a = (_b = (_a = Memory.roomIntel[oldest]) === null || _a === void 0 ? void 0 : _a.scannedAt) !== null && _b !== void 0 ? _b : 0;
        const b = (_d = (_c = Memory.roomIntel[name]) === null || _c === void 0 ? void 0 : _c.scannedAt) !== null && _d !== void 0 ? _d : 0;
        return b < a ? name : oldest;
    });
    if (observer.observeRoom(target) !== OK)
        return;
    // Room is visible this tick — update the intel record
    const r = Game.rooms[target];
    if (!r)
        return;
    const existing = (_d = Memory.roomIntel[target]) !== null && _d !== void 0 ? _d : {};
    const hostileCreeps = r.find(FIND_HOSTILE_CREEPS);
    const hostileStructures = r.find(FIND_HOSTILE_STRUCTURES);
    Memory.roomIntel[target] = {
        ...existing,
        scannedAt: Game.time,
        hasController: !!r.controller,
        controllerOwned: !!((_f = (_e = r.controller) === null || _e === void 0 ? void 0 : _e.owner) === null || _f === void 0 ? void 0 : _f.username),
        sourceCount: r.find(FIND_SOURCES).length,
        enemyCreeps: hostileCreeps.length,
        enemySpawns: hostileStructures.filter(s => s.structureType === STRUCTURE_SPAWN).length,
        enemyTowers: hostileStructures.filter(s => s.structureType === STRUCTURE_TOWER).length,
        strength: (_g = existing.strength) !== null && _g !== void 0 ? _g : 0,
    };
}

// Updated automatically by `just deploy` — do not edit manually
const REGIME = '2026-06-04-4a2d67a';

const REPORT_INTERVAL = 50;
const LOG_INTERVAL = 200;
const LOG_MAX_ENTRIES = 500;
const LAYOUT_INTERVAL = 1000;
function reportStats(room) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    const snap = buildSnapshot(room);
    // Broadcast force-capture tick so all rooms capture on the same tick, not just the first
    if (Memory.captureLayout) {
        Memory.captureLayoutAt = Game.time;
        Memory.captureLayout = false;
    }
    if (Memory.captureLayoutAt === Game.time || period(LAYOUT_INTERVAL, `layout:${room.name}`))
        captureRoomLayout(room);
    if (period(LOG_INTERVAL, 'stats:log')) {
        if (!Memory.statsLog)
            Memory.statsLog = [];
        Memory.statsLog.push(snap);
        if (Memory.statsLog.length > LOG_MAX_ENTRIES) {
            Memory.statsLog = Memory.statsLog.slice(-LOG_MAX_ENTRIES);
        }
    }
    if (!period(REPORT_INTERVAL, 'stats:report'))
        return;
    const ctrl = room.controller;
    const allCreeps = Object.values(Game.creeps);
    const roles = {};
    for (const c of allCreeps)
        roles[c.memory.role] = ((_a = roles[c.memory.role]) !== null && _a !== void 0 ? _a : 0) + 1;
    const sc = (type, neutral = false) => ({
        built: room.find(FIND_STRUCTURES, { filter: s => s.structureType === type }).length,
        pending: neutral
            ? room.find(FIND_CONSTRUCTION_SITES, { filter: s => s.structureType === type }).length
            : room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === type }).length,
    });
    const towers = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER });
    const towerEnergy = towers.map(t => { var _a; return Math.floor(t.store[RESOURCE_ENERGY] / ((_a = t.store.getCapacity(RESOURCE_ENERGY)) !== null && _a !== void 0 ? _a : 1) * 100); });
    const ramparts = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_RAMPART });
    const rampartMin = ramparts.length > 0 ? Math.min(...ramparts.map(r => r.hits)) : null;
    const intel = {};
    for (const [r, data] of Object.entries((_b = Memory.roomIntel) !== null && _b !== void 0 ? _b : {})) {
        intel[r] = { str: data.strength, age: Game.time - data.scannedAt };
    }
    const full = {
        tick: Game.time,
        phase: (_c = room.memory.phase) !== null && _c !== void 0 ? _c : 'ECONOMY',
        rcl: (_d = ctrl === null || ctrl === void 0 ? void 0 : ctrl.level) !== null && _d !== void 0 ? _d : 0,
        energy: (() => { const { current, capacity } = computeTotalEnergy(room); return { avail: room.energyAvailable, cap: room.energyCapacityAvailable, totalAvail: current, totalCap: capacity, pct: Math.floor(room.energyAvailable / Math.max(room.energyCapacityAvailable, 1) * 100) }; })(),
        controller: ctrl ? { pct: Math.floor(ctrl.progress / Math.max(ctrl.progressTotal, 1) * 100), progress: ctrl.progress, total: ctrl.progressTotal } : null,
        creeps: { total: allCreeps.length, ...roles },
        structures: {
            roads: sc(STRUCTURE_ROAD, true),
            containers: sc(STRUCTURE_CONTAINER, true),
            extensions: sc(STRUCTURE_EXTENSION),
            towers: { ...sc(STRUCTURE_TOWER), energy_pct: towerEnergy },
            ramparts: { ...sc(STRUCTURE_RAMPART), min_hits: rampartMin },
        },
        sites_total: room.find(FIND_CONSTRUCTION_SITES).length,
        economy: (_e = room.memory.energyStatus) !== null && _e !== void 0 ? _e : null,
        combat: {
            state: (_f = room.memory.combatState) !== null && _f !== void 0 ? _f : 'RALLY',
            warriors: (_g = roles['warrior']) !== null && _g !== void 0 ? _g : 0,
            rangers: (_h = roles['ranger']) !== null && _h !== void 0 ? _h : 0,
            healers: (_j = roles['healer']) !== null && _j !== void 0 ? _j : 0,
            target: (_k = room.memory.enemyRoomName) !== null && _k !== void 0 ? _k : null,
            tactics: (_l = room.memory.platoonOrders) !== null && _l !== void 0 ? _l : null,
        },
        intel,
        log_entries: (_o = (_m = Memory.statsLog) === null || _m === void 0 ? void 0 : _m.length) !== null && _o !== void 0 ? _o : 0,
    };
    console.log(`=== adaptive:stats:${room.name}:${Game.time} ===`);
    console.log(JSON.stringify(full));
}
function captureRoomLayout(room) {
    var _a, _b, _c;
    if (!Memory.roomLayout)
        Memory.roomLayout = {};
    const p = (s) => ({ x: s.pos.x, y: s.pos.y });
    Memory.roomLayout[room.name] = {
        tick: Game.time,
        room: room.name,
        rcl: (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0,
        sources: room.find(FIND_SOURCES).map(s => ({ id: s.id, x: s.pos.x, y: s.pos.y })),
        controller: room.controller ? { id: room.controller.id, x: room.controller.pos.x, y: room.controller.pos.y } : null,
        spawns: room.find(FIND_MY_SPAWNS).map(s => ({ id: s.id, name: s.name, x: s.pos.x, y: s.pos.y })),
        extensions: room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_EXTENSION }).map(p),
        containers: room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_CONTAINER }).map(s => {
            var _a;
            const c = s;
            return { x: s.pos.x, y: s.pos.y, energy: c.store[RESOURCE_ENERGY], capacity: (_a = c.store.getCapacity(RESOURCE_ENERGY)) !== null && _a !== void 0 ? _a : 2000 };
        }),
        storage: room.storage ? { x: room.storage.pos.x, y: room.storage.pos.y, energy: room.storage.store[RESOURCE_ENERGY], capacity: (_c = room.storage.store.getCapacity(RESOURCE_ENERGY)) !== null && _c !== void 0 ? _c : 1000000 } : null,
        towers: room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER }).map(s => ({ x: s.pos.x, y: s.pos.y, energy: s.store[RESOURCE_ENERGY] })),
        ramparts: room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_RAMPART }).map(p),
        roads: room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_ROAD }).map(p),
        links: room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_LINK }).map(p),
        sites: room.find(FIND_CONSTRUCTION_SITES).map(s => ({ type: s.structureType, x: s.pos.x, y: s.pos.y, progress: s.progress, total: s.progressTotal })),
        ascii: buildAsciiMap(room),
    };
}
function buildAsciiMap(room) {
    const terrain = room.getTerrain();
    const grid = [];
    for (let y = 0; y < 50; y++) {
        const row = [];
        for (let x = 0; x < 50; x++) {
            const t = terrain.get(x, y);
            row.push(t === TERRAIN_MASK_WALL ? '#' : t === TERRAIN_MASK_SWAMP ? '~' : '.');
        }
        grid.push(row);
    }
    const set = (pos, ch) => { grid[pos.y][pos.x] = ch; };
    for (const s of room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_ROAD }))
        set(s.pos, 'r');
    for (const s of room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_CONTAINER }))
        set(s.pos, 'c');
    for (const s of room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_EXTENSION }))
        set(s.pos, 'e');
    for (const s of room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_LINK }))
        set(s.pos, 'L');
    for (const s of room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER }))
        set(s.pos, 'T');
    if (room.storage)
        set(room.storage.pos, 'K');
    for (const s of room.find(FIND_CONSTRUCTION_SITES))
        set(s.pos, '*');
    if (room.controller)
        set(room.controller.pos, 'C');
    for (const s of room.find(FIND_SOURCES))
        set(s.pos, 'S');
    for (const s of room.find(FIND_MY_SPAWNS))
        set(s.pos, 'O');
    return grid.map(row => row.join('')).join('\n');
}
function buildSnapshot(room) {
    var _a, _b, _c, _d, _e, _f, _g;
    const ctrl = room.controller;
    const allCreeps = Object.values(Game.creeps);
    const roles = {};
    for (const c of allCreeps)
        roles[c.memory.role] = ((_a = roles[c.memory.role]) !== null && _a !== void 0 ? _a : 0) + 1;
    const count = (type) => room.find(FIND_STRUCTURES, { filter: s => s.structureType === type }).length;
    return {
        tick: Game.time,
        regime: REGIME,
        phase: (_b = room.memory.phase) !== null && _b !== void 0 ? _b : 'ECONOMY',
        rcl: (_c = ctrl === null || ctrl === void 0 ? void 0 : ctrl.level) !== null && _c !== void 0 ? _c : 0,
        energy: (() => { var _a, _b, _c, _d; const { current, capacity } = computeTotalEnergy(room); return { avail: room.energyAvailable, cap: room.energyCapacityAvailable, totalAvail: current, totalCap: capacity, netRate: (_b = (_a = room.memory.energyStatus) === null || _a === void 0 ? void 0 : _a.netRate) !== null && _b !== void 0 ? _b : null, bottleneck: (_d = (_c = room.memory.energyStatus) === null || _c === void 0 ? void 0 : _c.bottleneck) !== null && _d !== void 0 ? _d : null }; })(),
        creeps: roles,
        ctrl: ctrl ? { pct: Math.floor(ctrl.progress / Math.max(ctrl.progressTotal, 1) * 100), progress: ctrl.progress, total: ctrl.progressTotal } : null,
        structs: {
            roads: count(STRUCTURE_ROAD),
            containers: count(STRUCTURE_CONTAINER),
            extensions: count(STRUCTURE_EXTENSION),
            towers: count(STRUCTURE_TOWER),
            ramparts: count(STRUCTURE_RAMPART),
        },
        combat: {
            state: (_d = room.memory.combatState) !== null && _d !== void 0 ? _d : 'RALLY',
            warriors: (_e = roles['warrior']) !== null && _e !== void 0 ? _e : 0,
            rangers: (_f = roles['ranger']) !== null && _f !== void 0 ? _f : 0,
            target: (_g = room.memory.enemyRoomName) !== null && _g !== void 0 ? _g : null,
        },
    };
}

function loop() {
    var _a, _b;
    // Purge dead creep memory
    for (const name in Memory.creeps) {
        if (!Game.creeps[name])
            delete Memory.creeps[name];
    }
    // Global memory defaults
    if (!Memory.roomIntel)
        Memory.roomIntel = {};
    if (!Memory.statsLog)
        Memory.statsLog = [];
    // CPU bucket tiers — skip expensive optional managers when the bucket is low
    // to protect essential operations (spawn, defense, creep roles).
    // Sigmoid-style: < 1000 = critical, < 2000 = constrained, >= 2000 = normal.
    const cpuBucket = Game.cpu.bucket;
    const cpuConstrained = cpuBucket < 2000;
    const cpuCritical = cpuBucket < 1000;
    // Per-room managers
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        trackEnergyFlow(room);
        manageDefense(room);
        updatePhase(room);
        manageConstruction(room);
        manageSpawns(room);
        pruneExcessCreeps(room);
        manageCombat(room);
        manageLinkTransfers(room);
        manageExpansion(room);
        if (!cpuConstrained)
            manageMarket(room);
        if (!cpuCritical)
            manageTransfers(room);
        if (!cpuCritical)
            manageRemote(room);
        if (!cpuCritical)
            manageObserver(room);
        reportStats(room);
    }
    // Run creep roles
    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        // For combat roles: seed targetRoomName from their home room's campaign target
        if (creep.memory.role === 'warrior' || creep.memory.role === 'ranger' || creep.memory.role === 'healer') {
            const homeRoomName = creep.memory.homeRoom;
            const enemyRoom = homeRoomName ? (_b = Game.rooms[homeRoomName]) === null || _b === void 0 ? void 0 : _b.memory.enemyRoomName : undefined;
            if (enemyRoom && !creep.memory.targetRoomName) {
                creep.memory.targetRoomName = enemyRoom;
            }
        }
        switch (creep.memory.role) {
            case 'harvester':
                runHarvester(creep);
                break;
            case 'hauler':
                runHauler(creep);
                break;
            case 'upgrader':
                runUpgrader(creep);
                break;
            case 'builder':
                runBuilder(creep);
                break;
            case 'repairer':
                runRepairer(creep);
                break;
            case 'scout':
                runScout(creep);
                break;
            case 'claimer':
                runClaimer(creep);
                break;
            case 'reserver':
                runReserver(creep);
                break;
            case 'scavenger':
                runScavenger(creep);
                break;
            case 'courier':
                runCourier(creep);
                break;
            case 'warrior':
                runWarrior(creep);
                break;
            case 'ranger':
                runRanger(creep);
                break;
            case 'healer':
                runHealer(creep);
                break;
        }
    }
}

exports.loop = loop;
