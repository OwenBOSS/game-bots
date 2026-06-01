'use strict';

// Stationary harvester: parks at an assigned source, harvests into the adjacent
// container. Falls back to mobile delivery if no container exists yet.
function runHarvester(creep) {
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
// ─── Stationary mode ─────────────────────────────────────────────────────────
function runStationary(creep, source, container) {
    // Move onto the container tile to mine directly into it
    if (!creep.pos.isEqualTo(container.pos)) {
        creep.moveTo(container.pos, { reusePath: 10, visualizePathStyle: undefined });
        return;
    }
    creep.harvest(source);
    if (creep.store.getFreeCapacity() === 0) {
        // Prefer a link over the container — links teleport energy instantly, no hauler trip needed
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
                creep.moveTo(target, { reusePath: 5 });
            }
        }
        else {
            // Nothing else needs energy — upgrade RC as a productive last resort.
            // This is intentional: surplus energy is better spent on RCL than wasted.
            const controller = creep.room.controller;
            if (controller && creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
                creep.moveTo(controller, { reusePath: 5 });
            }
        }
    }
    else {
        if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
            creep.moveTo(source, { reusePath: 5 });
        }
    }
}
// ─── Helpers ─────────────────────────────────────────────────────────────────
function getAssignedSource(creep) {
    var _a;
    if (creep.memory.sourceId) {
        return Game.getObjectById(creep.memory.sourceId);
    }
    // Assign to the least-contested source
    const sources = creep.room.find(FIND_SOURCES);
    const counts = new Map();
    for (const c of creep.room.find(FIND_MY_CREEPS)) {
        if (c.memory.role === 'harvester' && c.memory.sourceId) {
            counts.set(c.memory.sourceId, ((_a = counts.get(c.memory.sourceId)) !== null && _a !== void 0 ? _a : 0) + 1);
        }
    }
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

// Hauler: decouples harvesting from delivery.
// Collection priority: hub link > fullest container > storage > dropped > harvest
// Delivery priority: extensions > spawn > towers > storage
function runHauler(creep) {
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
    // 1. Hub links — energy teleported from sources, no travel needed
    const link = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_LINK &&
            s.store[RESOURCE_ENERGY] >= 400,
    });
    if (link) {
        if (creep.withdraw(link, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(link, { reusePath: 5 });
        }
        return;
    }
    // 2. Containers (filled by stationary harvesters)
    const containers = creep.room.find(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_CONTAINER &&
            s.store[RESOURCE_ENERGY] >= 50,
    });
    if (containers.length > 0) {
        const target = containers.reduce((a, b) => a.store[RESOURCE_ENERGY] >= b.store[RESOURCE_ENERGY] ? a : b);
        if (creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(target, { reusePath: 5 });
        }
        return;
    }
    // 3. Storage (surplus buffer)
    const storage = creep.room.storage;
    if (storage && storage.store[RESOURCE_ENERGY] >= 1000) {
        if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(storage, { reusePath: 5 });
        }
        return;
    }
    // 4. Dropped energy (tombstones, overflow)
    const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: r => r.resourceType === RESOURCE_ENERGY && r.amount >= 50,
    });
    if (dropped) {
        if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
            creep.moveTo(dropped, { reusePath: 3 });
        }
        return;
    }
    // 5. Direct harvest as last resort
    const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
        creep.moveTo(source, { reusePath: 5 });
    }
}
function deliver(creep) {
    const target = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: s => {
            if (s.structureType === STRUCTURE_EXTENSION) {
                return s.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
            if (s.structureType === STRUCTURE_SPAWN) {
                return s.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
            if (s.structureType === STRUCTURE_TOWER) {
                return s.store.getFreeCapacity(RESOURCE_ENERGY) > 200;
            }
            if (s.structureType === STRUCTURE_STORAGE) {
                return s.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
            return false;
        },
    });
    if (target) {
        if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(target, { reusePath: 5 });
        }
    }
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
                creep.moveTo(ctrl, { reusePath: 5 });
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
                creep.moveTo(terminal, { reusePath: 5 });
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
            creep.moveTo(controller, { reusePath: 5 });
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
    // Prefer container near controller (most efficient for upgrader)
    const container = controller.pos.findInRange(FIND_STRUCTURES, 3, {
        filter: s => s.structureType === STRUCTURE_CONTAINER &&
            s.store[RESOURCE_ENERGY] > 0,
    })[0];
    if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(container, { reusePath: 5 });
        }
        return;
    }
    const storage = creep.room.storage;
    if (storage && storage.store[RESOURCE_ENERGY] > 0) {
        if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(storage, { reusePath: 5 });
        }
        return;
    }
    const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
        creep.moveTo(source, { reusePath: 5 });
    }
}

// Builder works through construction sites in explicit priority order so the most
// impactful structures are finished first regardless of physical proximity.
//
// Priority: containers → extensions → towers → ramparts → roads → repair → upgrade
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
                creep.moveTo(site, { reusePath: 5 });
            }
            return;
        }
        // Repair roads below 50% before falling back to upgrading
        const damagedRoad = creep.pos.findClosestByPath(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_ROAD && s.hits < s.hitsMax * 0.5,
        });
        if (damagedRoad) {
            if (creep.repair(damagedRoad) === ERR_NOT_IN_RANGE) {
                creep.moveTo(damagedRoad, { reusePath: 5 });
            }
            return;
        }
        // Nothing left to build — upgrade the controller
        const controller = creep.room.controller;
        if (controller) {
            if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
                creep.moveTo(controller, { reusePath: 5 });
            }
        }
    }
    else {
        const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
        if (source) {
            if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
                creep.moveTo(source, { reusePath: 5 });
            }
        }
    }
}
// Returns the highest-priority construction site, ignoring distance.
// Roads are second — they're high value but capped at 10 pending sites at a time
// by the construction manager, so the builder won't spend forever on them.
function findBuildTarget(creep) {
    const PRIORITY = [
        STRUCTURE_CONTAINER, // efficiency gain on every tick once built
        STRUCTURE_ROAD, // mobility (capped at 10 sites, so builds fast)
        STRUCTURE_EXTENSION, // better spawn bodies (RCL 2+)
        STRUCTURE_TOWER, // passive defense (RCL 3+)
        STRUCTURE_RAMPART, // protect key structures (RCL 2+)
    ];
    for (const type of PRIORITY) {
        const site = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES, {
            filter: s => s.structureType === type,
        });
        if (site)
            return site;
    }
    // Catch-all for anything else (walls, etc.)
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
                creep.moveTo(target.pos, { reusePath: 3 });
            }
            if (creep.repair(target) === ERR_NOT_IN_RANGE) {
                creep.moveTo(target, { reusePath: 3 });
            }
        }
        else {
            // Nothing to repair — upgrade controller
            const ctrl = creep.room.controller;
            if (ctrl && creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
                creep.moveTo(ctrl, { reusePath: 5 });
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
            creep.moveTo(container, { reusePath: 5 });
        }
        return;
    }
    const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
        creep.moveTo(source, { reusePath: 5 });
    }
}

// Scout: patrols adjacent rooms, records rich intel, and waits at home when
// all rooms are fresh. Clears targetRoomName when idle to prevent bouncing.
const STALE_TICKS = 500;
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
                creep.moveTo(exit, { reusePath: 3 });
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
    Memory.scoutTick = Game.time;
    if (enemySpawns > 0 || enemyCreeps > 0) {
        const currentStrength = Memory.enemyRoomName
            ? ((_c = (_b = Memory.roomIntel[Memory.enemyRoomName]) === null || _b === void 0 ? void 0 : _b.strength) !== null && _c !== void 0 ? _c : Infinity)
            : Infinity;
        if (strength < currentStrength) {
            Memory.enemyRoomName = room.name;
            Memory.enemyStrength = strength;
        }
    }
    console.log(`[adaptive] Scout intel: ${room.name} str=${strength} ctrl=${!!room.controller} owned=${!!((_d = room.controller) === null || _d === void 0 ? void 0 : _d.owner)} sources=${room.find(FIND_SOURCES).length}`);
}
function assignNextTarget(creep) {
    var _a, _b;
    const homeRoom = Object.values(Game.rooms).find(r => { var _a; return (_a = r.controller) === null || _a === void 0 ? void 0 : _a.my; });
    if (!homeRoom)
        return;
    const exits = Game.map.describeExits(homeRoom.name);
    if (!exits)
        return;
    const exitRooms = Object.values(exits).filter((r) => !!r);
    const intel = (_a = Memory.roomIntel) !== null && _a !== void 0 ? _a : {};
    const target = (_b = exitRooms.find(r => !intel[r])) !== null && _b !== void 0 ? _b : exitRooms.find(r => intel[r] && Game.time - intel[r].scannedAt > STALE_TICKS);
    if (target) {
        creep.memory.targetRoomName = target;
        creep.memory.scoutComplete = false;
    }
    else {
        // All rooms are fresh — clear target and wait at home to prevent bouncing
        creep.memory.targetRoomName = undefined;
        if (creep.room.name !== homeRoom.name) {
            const exitDir = creep.room.findExitTo(homeRoom.name);
            if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
                const exit = creep.pos.findClosestByRange(exitDir);
                if (exit)
                    creep.moveTo(exit, { reusePath: 5 });
            }
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
                creep.moveTo(exit, { reusePath: 3 });
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
            creep.moveTo(controller, { reusePath: 3 });
        }
        return;
    }
    if (creep.claimController(controller) === ERR_NOT_IN_RANGE) {
        creep.moveTo(controller, { reusePath: 3 });
    }
}

// Advanced combat unit replacing basic attacker.
// Has HEAL parts, retreat logic, and obeys the global RALLY/MARCH/ENGAGE state.
const RETREAT_THRESHOLD = 0.3; // retreat when HP falls below 30%
function runWarrior(creep) {
    var _a;
    // Always try to heal self if damaged (HEAL action is independent of movement)
    if (creep.hits < creep.hitsMax) {
        creep.heal(creep);
    }
    // Retreat when critically wounded — return home to recover
    if (creep.hits < creep.hitsMax * RETREAT_THRESHOLD) {
        retreatToSpawn(creep);
        return;
    }
    const combatState = (_a = Memory.combatState) !== null && _a !== void 0 ? _a : 'RALLY';
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
function executeMarch$1(creep) {
    var _a;
    const pid = creep.memory.platoonId;
    const orders = pid ? (_a = Memory.platoonOrders) === null || _a === void 0 ? void 0 : _a[pid] : undefined;
    const targetRoom = creep.memory.targetRoomName;
    // FEINT: after the feint window expires, fall back home
    if ((orders === null || orders === void 0 ? void 0 : orders.tactic) === 'FEINT' && orders.feintEndTick && Game.time > orders.feintEndTick) {
        retreatToSpawn(creep);
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
    }
    else {
        engageInRoom(creep);
    }
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
    const target = stagingArea$2(creep.room, spawn);
    if (creep.pos.getRangeTo(target) > 1) {
        creep.moveTo(target, { reusePath: 5 });
    }
}
function retreatToSpawn(creep) {
    if (!isHome$2(creep)) {
        travelHome$2(creep);
        return;
    }
    const spawn = creep.pos.findClosestByPath(FIND_MY_SPAWNS);
    if (spawn)
        creep.moveTo(spawn, { reusePath: 3 });
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
        creep.moveTo(new RoomPosition(tx, ty, creep.room.name), { reusePath: 3 });
    }
    return true;
}
// Find a rally point near spawn that's at least 3 tiles from sources/containers.
function stagingArea$2(room, spawn) {
    const sources = room.find(FIND_SOURCES);
    const containers = room.find(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_CONTAINER,
    });
    const terrain = room.getTerrain();
    for (let r = 3; r <= 10; r++) {
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
                return pos;
            }
        }
    }
    return spawn.pos; // fallback if room is very cramped
}
function isHome$2(creep) {
    var _a, _b;
    return !!((_b = (_a = Game.rooms[creep.room.name]) === null || _a === void 0 ? void 0 : _a.controller) === null || _b === void 0 ? void 0 : _b.my);
}
function travelHome$2(creep) {
    const homeRoom = Object.keys(Game.rooms).find(r => { var _a; return (_a = Game.rooms[r].controller) === null || _a === void 0 ? void 0 : _a.my; });
    if (!homeRoom)
        return;
    const exitDir = creep.room.findExitTo(homeRoom);
    if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
        const exit = creep.pos.findClosestByRange(exitDir);
        if (exit)
            creep.moveTo(exit, { reusePath: 3 });
    }
}
function engageInRoom(creep) {
    const target = findCombatTarget(creep);
    if (!target) {
        // Patrol center — there may be nothing left to attack
        creep.moveTo(new RoomPosition(25, 25, creep.room.name), { reusePath: 10 });
        return;
    }
    const range = creep.pos.getRangeTo(target);
    // Ranged attack if we have RANGED_ATTACK parts and are within 3 tiles
    const hasRanged = creep.body.some(p => p.type === RANGED_ATTACK);
    if (hasRanged && range <= 3) {
        creep.rangedAttack(target);
    }
    // Melee attack if adjacent
    if (range <= 1) {
        creep.attack(target);
    }
    else {
        creep.moveTo(target, { reusePath: 3 });
    }
}
function findCombatTarget(creep) {
    // Priority: towers (greatest threat) > spawn (disables economy) > other creeps > structures
    const tower = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER,
    });
    if (tower)
        return tower;
    const spawn = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_SPAWN,
    });
    if (spawn)
        return spawn;
    const hostileCreep = creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS);
    if (hostileCreep)
        return hostileCreep;
    return creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES);
}
function moveToRoom$2(creep, roomName) {
    const exitDir = creep.room.findExitTo(roomName);
    if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
        const exit = creep.pos.findClosestByRange(exitDir);
        if (exit)
            creep.moveTo(exit, { reusePath: 3 });
    }
}

// Ranged attacker: stays at 3-tile range, kites melee enemies, uses rangedMassAttack
// when multiple enemies cluster. Shares rally/march/engage state with warriors.
const RETREAT_HP = 0.25;
const KITE_RANGE = 3; // ideal engagement distance
function runRanger(creep) {
    var _a;
    if (creep.hits < creep.hitsMax) {
        creep.heal(creep); // HEAL is a separate action, always fires
    }
    if (creep.hits < creep.hitsMax * RETREAT_HP) {
        retreat(creep);
        return;
    }
    const combatState = (_a = Memory.combatState) !== null && _a !== void 0 ? _a : 'RALLY';
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
function engage(creep) {
    const nearbyEnemies = creep.pos.findInRange(FIND_HOSTILE_CREEPS, KITE_RANGE);
    // Use mass attack when 3+ enemies are clustered (hits all in 3-tile AoE)
    if (nearbyEnemies.length >= 3) {
        creep.rangedMassAttack();
        return;
    }
    const target = findTarget(creep);
    if (!target) {
        creep.moveTo(new RoomPosition(25, 25, creep.room.name), { reusePath: 10 });
        return;
    }
    const range = creep.pos.getRangeTo(target);
    if (range <= KITE_RANGE) {
        creep.rangedAttack(target);
    }
    if (range > KITE_RANGE) {
        // Close in
        creep.moveTo(target, { reusePath: 3 });
    }
    else if (range < 2) {
        // Kite away from melee enemies
        const dx = creep.pos.x - target.pos.x;
        const dy = creep.pos.y - target.pos.y;
        const kiteDir = getDirection(dx, dy);
        if (kiteDir)
            creep.move(kiteDir);
    }
}
function findTarget(creep) {
    // Rangers prioritize towers (high-value threat) then structures then creeps
    const tower = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER,
    });
    if (tower)
        return tower;
    const hostile = creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS);
    if (hostile)
        return hostile;
    return creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES);
}
function executeMarch(creep) {
    var _a;
    const pid = creep.memory.platoonId;
    const orders = pid ? (_a = Memory.platoonOrders) === null || _a === void 0 ? void 0 : _a[pid] : undefined;
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
    }
    else {
        engage(creep);
    }
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
        creep.moveTo(target, { reusePath: 5 });
    }
}
function retreat(creep) {
    if (!isHome$1(creep)) {
        travelHome$1(creep);
        return;
    }
    const spawn = creep.pos.findClosestByPath(FIND_MY_SPAWNS);
    if (spawn)
        creep.moveTo(spawn, { reusePath: 3 });
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
        creep.moveTo(new RoomPosition(Math.min(48, Math.max(1, creep.pos.x + dx * 3)), Math.min(48, Math.max(1, creep.pos.y + dy * 3)), creep.room.name), { reusePath: 3 });
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
    return !!((_b = (_a = Game.rooms[creep.room.name]) === null || _a === void 0 ? void 0 : _a.controller) === null || _b === void 0 ? void 0 : _b.my);
}
function travelHome$1(creep) {
    const homeRoom = Object.keys(Game.rooms).find(r => { var _a; return (_a = Game.rooms[r].controller) === null || _a === void 0 ? void 0 : _a.my; });
    if (!homeRoom)
        return;
    const exitDir = creep.room.findExitTo(homeRoom);
    if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
        const exit = creep.pos.findClosestByRange(exitDir);
        if (exit)
            creep.moveTo(exit, { reusePath: 3 });
    }
}
function moveToRoom$1(creep, roomName) {
    const exitDir = creep.room.findExitTo(roomName);
    if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
        const exit = creep.pos.findClosestByRange(exitDir);
        if (exit)
            creep.moveTo(exit, { reusePath: 3 });
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
// All platoons share Memory.combatState so they march and engage in concert.
const HEAL_THRESHOLD = 0.85;
function runHealer(creep) {
    var _a, _b;
    // Self-heal always fires independently
    if (creep.hits < creep.hitsMax) {
        creep.heal(creep);
    }
    const combatState = (_a = Memory.combatState) !== null && _a !== void 0 ? _a : 'RALLY';
    if (combatState === 'RALLY') {
        rallyAtSpawn(creep);
        return;
    }
    // MARCH or ENGAGE — follow the platoon's assigned route
    const pid = creep.memory.platoonId;
    const orders = pid ? (_b = Memory.platoonOrders) === null || _b === void 0 ? void 0 : _b[pid] : undefined;
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
        creep.moveTo(new RoomPosition(25, 25, creep.room.name), { reusePath: 10 });
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
        creep.moveTo(healTarget, { reusePath: 2 });
    }
    else {
        creep.moveTo(healTarget, { reusePath: 2 });
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
        creep.moveTo(target, { reusePath: 5 });
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
        creep.moveTo(new RoomPosition(Math.min(48, Math.max(1, creep.pos.x + dx * 3)), Math.min(48, Math.max(1, creep.pos.y + dy * 3)), creep.room.name), { reusePath: 3 });
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
    return !!((_b = (_a = Game.rooms[creep.room.name]) === null || _a === void 0 ? void 0 : _a.controller) === null || _b === void 0 ? void 0 : _b.my);
}
function travelHome(creep) {
    const homeRoom = Object.keys(Game.rooms).find(r => { var _a; return (_a = Game.rooms[r].controller) === null || _a === void 0 ? void 0 : _a.my; });
    if (!homeRoom)
        return;
    const exitDir = creep.room.findExitTo(homeRoom);
    if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
        const exit = creep.pos.findClosestByRange(exitDir);
        if (exit)
            creep.moveTo(exit, { reusePath: 3 });
    }
}
function moveToRoom(creep, roomName) {
    const exitDir = creep.room.findExitTo(roomName);
    if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
        const exit = creep.pos.findClosestByRange(exitDir);
        if (exit)
            creep.moveTo(exit, { reusePath: 3 });
    }
}

const ECONOMY_CREEP_TARGET = 5;
const RUSH_STRENGTH_THRESHOLD = 10;
const REASSESS_COOLDOWN = 500;
const RUSH_TIMEOUT = 2000;
// When safe mode has this many ticks left, start building up combat for what comes after
const SAFE_MODE_PREPARE_TICKS = 2000;
function updatePhase(room) {
    var _a, _b, _c;
    // ── Safe mode override ────────────────────────────────────────────────────
    // During safe mode enemies can't attack us. Use the window for pure economy.
    // When safe mode is nearly up, transition to ASSESS so we start scouting + building army.
    const safeMode = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.safeMode) !== null && _b !== void 0 ? _b : 0;
    if (safeMode > 0) {
        if (Memory.phase !== 'ECONOMY') {
            Memory.phase = 'ECONOMY';
            console.log(`[adaptive] Safe mode active (${safeMode} ticks left) → forcing ECONOMY`);
        }
        if (safeMode < SAFE_MODE_PREPARE_TICKS && Memory.phase === 'ECONOMY') {
            Memory.phase = 'ASSESS';
            Memory.scoutTick = undefined;
            console.log('[adaptive] Safe mode expiring soon → ASSESS (build for what comes next)');
        }
        return; // skip normal phase logic while safe mode is active
    }
    // ── Normal phase machine ─────────────────────────────────────────────────
    const phase = (_c = Memory.phase) !== null && _c !== void 0 ? _c : 'ECONOMY';
    if (!Memory.roomIntel)
        Memory.roomIntel = {};
    const myCreeps = room.find(FIND_MY_CREEPS).length;
    switch (phase) {
        case 'ECONOMY': {
            const cooldownDone = !Memory.phaseTick || Game.time >= Memory.phaseTick;
            if (myCreeps >= ECONOMY_CREEP_TARGET && cooldownDone) {
                Memory.phase = 'ASSESS';
                Memory.phaseTick = Game.time;
                Memory.scoutTick = undefined;
                console.log(`[adaptive] → ASSESS at tick ${Game.time}`);
            }
            break;
        }
        case 'ASSESS':
            if (Memory.scoutTick !== undefined) {
                if (Memory.enemyRoomName && Memory.enemyStrength !== undefined && Memory.enemyStrength > 0) {
                    Memory.phase = Memory.enemyStrength <= RUSH_STRENGTH_THRESHOLD ? 'RUSH' : 'DEFEND';
                    Memory.phaseTick = Game.time;
                    console.log(`[adaptive] → ${Memory.phase} (enemy strength ${Memory.enemyStrength} in ${Memory.enemyRoomName})`);
                }
                else {
                    Memory.phase = 'ECONOMY';
                    Memory.phaseTick = Game.time + REASSESS_COOLDOWN;
                    console.log(`[adaptive] → ECONOMY (no enemies, re-assess at tick ${Memory.phaseTick})`);
                }
            }
            break;
        case 'RUSH': {
            const combatUnits = room.find(FIND_MY_CREEPS, {
                filter: c => c.memory.role === 'warrior' || c.memory.role === 'ranger',
            }).length;
            const enemyIntel = Memory.enemyRoomName ? Memory.roomIntel[Memory.enemyRoomName] : undefined;
            if (enemyIntel && enemyIntel.strength === 0 && Game.time - enemyIntel.scannedAt < 100) {
                console.log(`[adaptive] → ECONOMY (RUSH succeeded — ${Memory.enemyRoomName} cleared)`);
                resetToEconomy();
                break;
            }
            if (combatUnits === 0 && myCreeps > 0) {
                console.log('[adaptive] → ECONOMY (RUSH failed — no combat units left)');
                resetToEconomy();
                break;
            }
            if (myCreeps === 0) {
                resetToEconomy();
                break;
            }
            if (Memory.phaseTick && Game.time - Memory.phaseTick > RUSH_TIMEOUT) {
                console.log('[adaptive] → ECONOMY (RUSH timed out)');
                resetToEconomy();
            }
            break;
        }
        case 'DEFEND': {
            const enemies = room.find(FIND_HOSTILE_CREEPS).length;
            const enemyIntel = Memory.enemyRoomName ? Memory.roomIntel[Memory.enemyRoomName] : undefined;
            const threatCleared = enemyIntel && enemyIntel.strength === 0 && Game.time - enemyIntel.scannedAt < 100;
            if (enemies === 0 && threatCleared) {
                console.log('[adaptive] → ECONOMY (DEFEND succeeded)');
                resetToEconomy();
            }
            else if (myCreeps === 0) {
                resetToEconomy();
            }
            break;
        }
    }
}
function resetToEconomy() {
    Memory.phase = 'ECONOMY';
    Memory.phaseTick = undefined;
    Memory.combatState = 'RALLY';
    Memory.roadsPlanned = false;
    Memory.enemyRoomName = undefined;
    Memory.enemyStrength = undefined;
    Memory.scoutTick = undefined;
}

// Dynamic body builder — scales creep bodies to the available energy budget.
// Part ordering follows Screeps convention: TOUGH first (absorbs damage), MOVE last (stays mobile longest).
function buildBody(role, budget) {
    switch (role) {
        case 'harvester': return harvesterBody(budget);
        case 'hauler': return haulerBody(budget);
        case 'upgrader': return upgraderBody(budget);
        case 'builder':
        case 'repairer': return workerBody(budget);
        case 'warrior': return warriorBody(budget);
        case 'ranger': return rangerBody(budget);
        case 'scout': return scoutBody(budget);
        case 'claimer': return claimerBody(budget);
        case 'healer': return healerBody(budget);
        default: return null;
    }
}
// ─── Economic roles ───────────────────────────────────────────────────────────
// Stationary harvester: maximize WORK (source saturation = 6 WORK = 12e/tick).
// Minimal CARRY + MOVE — it barely moves once assigned to a source.
function harvesterBody(budget) {
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
    return r(MOVE, Math.min(Math.floor(budget / 50), 5));
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
                Memory.expansionState = 'ACTIVE';
                console.log(`[adaptive] Expansion -> ACTIVE ${roomName}`);
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
// How many bootstrap workers the main room should send to the new room
function bootstrapTargets() {
    if (Memory.expansionState !== 'BOOTSTRAPPING')
        return { hauler: 0, builder: 0 };
    const roomName = Memory.expansionRoomName;
    if (!roomName)
        return { hauler: 0, builder: 0 };
    const inNewRoom = Object.values(Game.creeps).filter(c => c.memory.targetRoomName === roomName);
    return {
        hauler: Math.max(0, BOOTSTRAP_HAULERS - inNewRoom.filter(c => c.memory.role === 'hauler').length),
        builder: Math.max(0, BOOTSTRAP_BUILDERS - inNewRoom.filter(c => c.memory.role === 'builder').length),
    };
}

// Tracks energy flow and calculates dynamic spawn targets based on actual room state.
// Sampled every SAMPLE_INTERVAL ticks; keeps WINDOW_SIZE samples (= WINDOW_TICKS history).
//
// energyStatus.level drives spawn decisions:
//   SURPLUS  — energy growing, can spawn freely
//   STABLE   — balanced, spawn economy/infrastructure only
//   DEFICIT  — draining, hold combat spawns
//   CRITICAL — emergency, cull expensive creeps
const SAMPLE_INTERVAL = 5; // sample every N ticks
const WINDOW_SIZE = 20; // samples kept (= WINDOW_SIZE × SAMPLE_INTERVAL ticks)
const MAX_HARVESTERS_PER_SOURCE = 4;
// ─── Sampling ─────────────────────────────────────────────────────────────────
function trackEnergyFlow(room) {
    if (Game.time % SAMPLE_INTERVAL !== 0)
        return;
    if (!Memory.energyHistory)
        Memory.energyHistory = [];
    Memory.energyHistory.push({ tick: Game.time, avail: room.energyAvailable });
    if (Memory.energyHistory.length > WINDOW_SIZE) {
        Memory.energyHistory = Memory.energyHistory.slice(-WINDOW_SIZE);
    }
    Memory.energyStatus = computeStatus(room);
}
function computeStatus(room) {
    var _a;
    const h = (_a = Memory.energyHistory) !== null && _a !== void 0 ? _a : [];
    const cap = room.energyCapacityAvailable || 1;
    const pct = Math.round(room.energyAvailable / cap * 100);
    if (h.length < 4) {
        return { netRate: 0, trend: 0, pct, level: 'STABLE' };
    }
    const first = h[0];
    const last = h[h.length - 1];
    const dt = last.tick - first.tick;
    const netRate = dt > 0 ? (last.avail - first.avail) / dt : 0;
    // Trend: compare first-half rate vs second-half rate
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
    return { netRate: Math.round(netRate * 100) / 100, trend: Math.round(trend * 100) / 100, pct, level };
}
function calcDynamicTargets(room) {
    var _a, _b, _c, _d;
    const rcl = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0;
    const sources = room.find(FIND_SOURCES);
    const sites = room.find(FIND_CONSTRUCTION_SITES).length;
    room.find(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_CONTAINER
    }).length;
    const hasControllerContainer = ((_d = (_c = room.controller) === null || _c === void 0 ? void 0 : _c.pos.findInRange(FIND_STRUCTURES, 3, {
        filter: s => s.structureType === STRUCTURE_CONTAINER,
    }).length) !== null && _d !== void 0 ? _d : 0) > 0;
    // Harvesters: up to MAX_HARVESTERS_PER_SOURCE per source, capped by walkable positions
    const harvester = sources.reduce((sum, src) => sum + Math.min(walkableAround(src), MAX_HARVESTERS_PER_SOURCE), 0);
    // Haulers: 1 per source container + 1 for controller container (if it exists)
    const sourceCntrs = sources.reduce((sum, src) => sum + src.pos.findInRange(FIND_STRUCTURES, 1, { filter: s => s.structureType === STRUCTURE_CONTAINER }).length, 0);
    const hauler = sourceCntrs + (hasControllerContainer ? 1 : 0);
    // Builders: scale with pending construction sites
    const builder = sites === 0 ? 0
        : sites <= 5 ? 1
            : sites <= 15 ? 2
                : sites <= 30 ? 3
                    : 4;
    // Upgrader: only once there's a controller container to supply it
    const upgrader = hasControllerContainer ? 1 : 0;
    // Repairer: only in DEFEND phase (handled by phase override in spawnManager)
    const repairer = 0;
    // Scout: 1 once RCL 1, so we always have intel
    const scout = rcl >= 1 ? 1 : 0;
    return { harvester, hauler, upgrader, builder, repairer, scout };
}
// ─── Helpers ──────────────────────────────────────────────────────────────────
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
// Combat targets per phase — these OVERLAY the dynamic economy targets
const COMBAT_TARGETS = {
    ECONOMY: { warrior: 0, ranger: 0, healer: 0, repairer: 0 },
    ASSESS: { warrior: 0, ranger: 0, healer: 0, repairer: 0 },
    RUSH: { warrior: 6, ranger: 2, healer: 2, repairer: 0 },
    DEFEND: { warrior: 4, ranger: 2, healer: 2, repairer: 2 },
};
function manageSpawns(room) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    const spawns = room.find(FIND_MY_SPAWNS).filter(s => !s.spawning);
    if (spawns.length === 0)
        return;
    const spawn = spawns[0];
    const phase = (_a = Memory.phase) !== null && _a !== void 0 ? _a : 'ECONOMY';
    const creeps = room.find(FIND_MY_CREEPS);
    const counts = countByRole(creeps);
    const status = (_b = Memory.energyStatus) !== null && _b !== void 0 ? _b : { level: 'STABLE' };
    // Dynamic economy targets based on actual room state
    const eco = calcDynamicTargets(room);
    const combat = COMBAT_TARGETS[phase];
    // Safe mode: no combat units
    const inSafeMode = ((_d = (_c = room.controller) === null || _c === void 0 ? void 0 : _c.safeMode) !== null && _d !== void 0 ? _d : 0) > 0;
    // ── Expansion priority ────────────────────────────────────────────────────
    if (Memory.expansionState === 'CLAIMING' && counts.claimer === 0 && Memory.expansionTarget) {
        trySpawn(spawn, 'claimer', room.energyAvailable, { targetRoomName: Memory.expansionTarget });
        return;
    }
    if (Memory.expansionState === 'BOOTSTRAPPING') {
        const bt = bootstrapTargets();
        if (bt.builder > 0) {
            trySpawn(spawn, 'builder', room.energyAvailable, { targetRoomName: Memory.expansionRoomName });
            return;
        }
        if (bt.hauler > 0) {
            trySpawn(spawn, 'hauler', room.energyAvailable, { targetRoomName: Memory.expansionRoomName });
            return;
        }
    }
    // ── Emergency: controller downgrade prevention ────────────────────────────
    const ttd = (_f = (_e = room.controller) === null || _e === void 0 ? void 0 : _e.ticksToDowngrade) !== null && _f !== void 0 ? _f : Infinity;
    if (ttd < DOWNGRADE_EMERGENCY_THRESHOLD && counts.upgrader === 0) {
        trySpawn(spawn, 'upgrader', room.energyAvailable);
        console.log(`[adaptive] ⚠️ Emergency upgrader — downgrade in ${ttd} ticks`);
        return;
    }
    // ── Always maintain minimum harvesters (2) ────────────────────────────────
    if (counts.harvester < 2) {
        trySpawn(spawn, 'harvester', room.energyAvailable);
        return;
    }
    // ── Economy roles — respect energy level ─────────────────────────────────
    // In DEFICIT/CRITICAL don't spawn new haulers/upgraders (save energy for harvesters)
    const canSpawnEconomy = status.level !== 'CRITICAL';
    const ecoRoles = [
        { role: 'harvester', target: eco.harvester },
        { role: 'builder', target: eco.builder },
        { role: 'hauler', target: eco.hauler },
        { role: 'upgrader', target: eco.upgrader },
        { role: 'scout', target: eco.scout },
    ];
    if (canSpawnEconomy) {
        for (const { role, target } of ecoRoles) {
            if (((_g = counts[role]) !== null && _g !== void 0 ? _g : 0) < target) {
                trySpawn(spawn, role, room.energyAvailable);
                return;
            }
        }
    }
    // Repairer (phase-gated)
    if (canSpawnEconomy && ((_h = counts.repairer) !== null && _h !== void 0 ? _h : 0) < ((_j = combat.repairer) !== null && _j !== void 0 ? _j : 0)) {
        trySpawn(spawn, 'repairer', room.energyAvailable);
        return;
    }
    // ── Combat units: gated on energy surplus AND not in safe mode ────────────
    const canSpawnCombat = !inSafeMode && room.energyAvailable >= MIN_COMBAT_ENERGY &&
        (status.level === 'SURPLUS' || status.level === 'STABLE');
    if (canSpawnCombat) {
        if (((_k = counts.warrior) !== null && _k !== void 0 ? _k : 0) < combat.warrior) {
            const platoonId = assignWarriorPlatoon(creeps);
            trySpawn(spawn, 'warrior', room.energyAvailable, { platoonId });
            return;
        }
        if (((_l = counts.ranger) !== null && _l !== void 0 ? _l : 0) < combat.ranger) {
            const platoonId = assignWarriorPlatoon(creeps);
            trySpawn(spawn, 'ranger', room.energyAvailable, { platoonId });
            return;
        }
        if (((_m = counts.healer) !== null && _m !== void 0 ? _m : 0) < combat.healer) {
            const platoonId = assignHealerPlatoon(creeps);
            if (platoonId)
                trySpawn(spawn, 'healer', room.energyAvailable, { platoonId });
        }
    }
}
// ─── Prune excess creeps ──────────────────────────────────────────────────────
function pruneExcessCreeps(room) {
    var _a, _b;
    const phase = (_a = Memory.phase) !== null && _a !== void 0 ? _a : 'ECONOMY';
    const creeps = room.find(FIND_MY_CREEPS);
    const counts = countByRole(creeps);
    const phaseAge = Memory.phaseTick ? Game.time - Memory.phaseTick : 0;
    const status = Memory.energyStatus;
    // Suicide combat units after sustained ECONOMY (they're RUSH leftovers)
    if (phase === 'ECONOMY' && phaseAge > 500) {
        for (const c of creeps) {
            if (c.memory.role === 'warrior' || c.memory.role === 'ranger' || c.memory.role === 'healer') {
                console.log(`[adaptive] Retiring ${c.memory.role} (ECONOMY for ${phaseAge} ticks)`);
                c.suicide();
            }
        }
    }
    // Emergency energy: suicide most-expensive non-essential creeps
    if ((status === null || status === void 0 ? void 0 : status.level) === 'CRITICAL') {
        const expensive = creeps
            .filter(c => c.memory.role === 'upgrader' || c.memory.role === 'scout')
            .sort((a, b) => (b.body.length) - (a.body.length));
        if (expensive.length > 0) {
            console.log(`[adaptive] CRITICAL energy — retiring ${expensive[0].memory.role}`);
            expensive[0].suicide();
        }
    }
    // Cull any role more than 2× its dynamic target
    const eco = calcDynamicTargets(room);
    for (const role of Object.keys(eco)) {
        const target = eco[role];
        if (target === 0)
            continue;
        const count = (_b = counts[role]) !== null && _b !== void 0 ? _b : 0;
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
// ─── Helpers ─────────────────────────────────────────────────────────────────
function trySpawn(spawn, role, energy, extraMemory = {}) {
    const body = buildBody(role, energy);
    if (!body)
        return;
    const name = `${role}_${Game.time}`;
    const result = spawn.spawnCreep(body, name, {
        memory: { role, working: false, ...extraMemory },
    });
    if (result === OK) {
        const cost = body.reduce((s, p) => s + BODYPART_COST[p], 0);
        const platoon = extraMemory.platoonId ? ` [${extraMemory.platoonId}]` : '';
        console.log(`[adaptive] Spawning ${name}${platoon} [${body.join(',')}] (${cost}e)`);
    }
}
// Creeps with fewer than PRE_SPAWN_TICKS remaining are excluded from the count.
// This triggers a replacement spawn BEFORE the old creep dies, so coverage
// is continuous with no gap. Threshold covers max spawn time + safety buffer.
const PRE_SPAWN_TICKS = 60; // body × 3 ticks per part + ~20 tick buffer
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

const MAX_ROAD_SITES = 10;
function manageConstruction(room) {
    var _a, _b;
    const rcl = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0;
    // For newly claimed rooms with no spawn, place one first
    if (room.find(FIND_MY_SPAWNS).length === 0) {
        placeSpawnIfMissing(room);
        return;
    }
    if (Game.time % 5 === 0)
        pruneExcessRoadSites(room);
    maintainRoadQueue(room);
    if (Memory.roadsPlanned && Memory.lastRCL === rcl)
        return;
    Memory.roadsPlanned = true;
    Memory.lastRCL = rcl;
    placeContainers(room);
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
    let budget = MAX_ROAD_SITES - pending;
    for (const source of room.find(FIND_SOURCES)) {
        if (budget <= 0)
            break;
        budget -= placeRoadSection(room, spawn.pos, source.pos, budget);
    }
    if (budget > 0 && room.controller) {
        placeRoadSection(room, spawn.pos, room.controller.pos, budget);
    }
}
function placeRoadSection(room, from, to, limit) {
    const path = room.findPath(from, to, { ignoreCreeps: true, swampCost: 1, plainCost: 2, range: 1 });
    let placed = 0;
    for (const step of path) {
        if (placed >= limit)
            break;
        if (room.createConstructionSite(step.x, step.y, STRUCTURE_ROAD) === OK)
            placed++;
    }
    return placed;
}
// ─── Containers ──────────────────────────────────────────────────────────────
function placeContainers(room) {
    const targets = [
        ...room.find(FIND_SOURCES).map(s => s.pos),
        ...(room.controller ? [room.controller.pos] : []),
    ];
    for (const pos of targets) {
        const hasNearby = pos.findInRange(FIND_STRUCTURES, 1, { filter: s => s.structureType === STRUCTURE_CONTAINER }).length > 0 ||
            pos.findInRange(FIND_CONSTRUCTION_SITES, 1, { filter: s => s.structureType === STRUCTURE_CONTAINER }).length > 0;
        if (hasNearby)
            continue;
        let placed = false;
        for (let dx = -1; dx <= 1 && !placed; dx++) {
            for (let dy = -1; dy <= 1 && !placed; dy++) {
                if (dx === 0 && dy === 0)
                    continue;
                const result = room.createConstructionSite(pos.x + dx, pos.y + dy, STRUCTURE_CONTAINER);
                if (result === OK) {
                    placed = true;
                }
                else if (result !== ERR_INVALID_TARGET && result !== ERR_FULL) {
                    console.log(`[adaptive] Container placement err ${result} at (${pos.x + dx},${pos.y + dy})`);
                }
            }
        }
        if (!placed)
            console.log(`[adaptive] Could not place container near (${pos.x},${pos.y})`);
    }
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
// Hub link near spawn + one link per source.
// Source links → hub link via linkManager.ts (instant transfer, 3% loss).
// Haulers withdraw from hub link instead of walking to source containers.
function placeLinks(room, rcl) {
    var _a;
    const built = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_LINK }).length;
    const pending = room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === STRUCTURE_LINK }).length;
    const allowed = (_a = CONTROLLER_STRUCTURES[STRUCTURE_LINK][rcl]) !== null && _a !== void 0 ? _a : 0;
    let remaining = allowed - built - pending;
    if (remaining <= 0)
        return;
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn)
        return;
    // Hub link near spawn
    const spawnLinkNearby = spawn.pos.findInRange(FIND_MY_STRUCTURES, 4, { filter: s => s.structureType === STRUCTURE_LINK }).length > 0 ||
        spawn.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 4, { filter: s => s.structureType === STRUCTURE_LINK }).length > 0;
    if (!spawnLinkNearby && remaining > 0) {
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
    // Source links
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
const ESTIMATED_TRAVEL_TICKS = 40; // ticks to reach adjacent enemy room
const FEINT_DURATION_TICKS = 150; // how long the feint platoon attacks before retreating
const MAIN_DELAY_TICKS = 80; // main platoon waits this many ticks into the feint
function manageTactics() {
    if (Memory.combatState !== 'MARCH') {
        // Clear orders when not marching so they don't linger into the next RUSH
        if (Memory.combatState === 'RALLY') {
            Memory.platoonOrders = undefined;
            Memory.coordinatedAttackTick = undefined;
        }
        return;
    }
    if (!Memory.enemyRoomName)
        return;
    if (Memory.platoonOrders)
        return; // already planned this MARCH
    const platoons = getActivePlatoonIds();
    if (platoons.length === 0)
        return;
    const orders = planTactics(platoons, Memory.enemyRoomName);
    Memory.platoonOrders = Object.fromEntries(Object.entries(orders).map(([id, o]) => [id, o]));
    const tactics = Object.values(orders).map(o => o.tactic).join(', ');
    console.log(`[adaptive] Tactics assigned: [${tactics}] vs ${Memory.enemyRoomName}`);
}
// ─── Planning ─────────────────────────────────────────────────────────────────
function planTactics(platoons, enemyRoom) {
    var _a, _b;
    const intel = (_a = Memory.roomIntel) === null || _a === void 0 ? void 0 : _a[enemyRoom];
    const hasTowers = ((_b = intel === null || intel === void 0 ? void 0 : intel.enemyTowers) !== null && _b !== void 0 ? _b : 0) > 0;
    const flankRoom = findFlankRoom(enemyRoom);
    if (platoons.length === 1 || !flankRoom) {
        // Single platoon or no flank available — everyone direct
        return Object.fromEntries(platoons.map(id => [id, { tactic: 'DIRECT' }]));
    }
    if (platoons.length >= 2 && hasTowers) {
        // FEINT + MAIN: towers are a serious threat — use misdirection
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
            // Any additional platoons also go direct
            ...Object.fromEntries(platoons.slice(2).map(id => [id, { tactic: 'DIRECT' }])),
        };
    }
    // PINCER: multiple platoons, no towers — enter from different sides
    return {
        [platoons[0]]: { tactic: 'DIRECT' },
        [platoons[1]]: { tactic: 'FLANK', waypointRoom: flankRoom },
        ...Object.fromEntries(platoons.slice(2).map(id => [id, { tactic: 'DIRECT' }])),
    };
}
// Find a room adjacent to the enemy that we can use as a flanking approach.
// Exclude our own home room (that's the direct route).
function findFlankRoom(enemyRoom) {
    var _a, _b;
    const exits = Game.map.describeExits(enemyRoom);
    if (!exits)
        return null;
    const homeRoom = (_a = Object.keys(Game.rooms).find(r => { var _a; return (_a = Game.rooms[r].controller) === null || _a === void 0 ? void 0 : _a.my; })) !== null && _a !== void 0 ? _a : '';
    const candidates = Object.values(exits).filter(Boolean)
        .filter(r => r !== homeRoom && Game.map.getRoomStatus(r).status === 'normal');
    return (_b = candidates[0]) !== null && _b !== void 0 ? _b : null;
}
function getActivePlatoonIds() {
    const ids = new Set();
    for (const name in Game.creeps) {
        const pid = Game.creeps[name].memory.platoonId;
        const role = Game.creeps[name].memory.role;
        if (pid && (role === 'warrior' || role === 'ranger')) {
            ids.add(pid);
        }
    }
    return [...ids].sort(); // deterministic order
}

const MIN_FIGHTERS_TO_MARCH = 4; // warriors + rangers before marching
const MIN_HEALERS_TO_MARCH = 1; // at least one healer per group before marching
const REASSESS_INTERVAL = 500;
// Safe mode triggers when hostiles are attacking AND defenses are critically low.
// activateSafeMode() uses one existing charge (no ghodium needed to activate, only to recharge).
const SAFE_MODE_RAMPART_THRESHOLD = 5000;
const SAFE_MODE_OVERWHELM_COUNT = 5;
function manageCombat(room) {
    checkSafeMode(room);
    manageTowers(room);
    manageCombatState(room);
    manageTactics(); // assigns platoon orders when MARCH begins
}
// ─── Safe mode ────────────────────────────────────────────────────────────────
function checkSafeMode(room) {
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
    if (criticalRampart || overwhelmed) {
        ctrl.activateSafeMode();
        console.log(`[adaptive] ⚠️ SAFE MODE ACTIVATED (hostiles=${dangerousHostiles.length} criticalRampart=${criticalRampart})`);
    }
}
// ─── Tower management ────────────────────────────────────────────────────────
// Attack the enemy with the most ATTACK body parts (biggest threat) when under siege.
// When clear, repair the most-damaged owned structure.
function manageTowers(room) {
    const towers = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER,
    });
    for (const tower of towers) {
        if (tower.store[RESOURCE_ENERGY] < 10)
            continue;
        const hostiles = room.find(FIND_HOSTILE_CREEPS);
        if (hostiles.length > 0) {
            // Target the most dangerous creep (most ATTACK/RANGED_ATTACK parts)
            const target = hostiles.reduce((a, b) => threatScore(b) > threatScore(a) ? b : a);
            tower.attack(target);
            continue;
        }
        // No enemies — repair most-damaged owned structure
        const damaged = room.find(FIND_MY_STRUCTURES, {
            filter: s => s.hits < s.hitsMax * 0.9,
        });
        if (damaged.length > 0) {
            const worst = damaged.reduce((a, b) => a.hits < b.hits ? a : b);
            tower.repair(worst);
        }
    }
}
function threatScore(creep) {
    return creep.body.reduce((n, p) => {
        if (p.type === ATTACK)
            return n + 3;
        if (p.type === RANGED_ATTACK)
            return n + 2;
        if (p.type === WORK)
            return n + 1; // can dismantle structures
        return n;
    }, 0);
}
// ─── Combat state machine ─────────────────────────────────────────────────────
function manageCombatState(room) {
    var _a;
    const allCombat = room.find(FIND_MY_CREEPS, {
        filter: c => c.memory.role === 'warrior' || c.memory.role === 'ranger' || c.memory.role === 'healer',
    });
    const fighters = allCombat.filter(c => c.memory.role === 'warrior' || c.memory.role === 'ranger');
    const healers = allCombat.filter(c => c.memory.role === 'healer');
    const state = (_a = Memory.combatState) !== null && _a !== void 0 ? _a : 'RALLY';
    switch (state) {
        case 'RALLY':
            // Wait for enough fighters AND at least one healer before marching
            if (fighters.length >= MIN_FIGHTERS_TO_MARCH &&
                healers.length >= MIN_HEALERS_TO_MARCH &&
                Memory.enemyRoomName) {
                Memory.combatState = 'MARCH';
                Memory.rallyTick = Game.time;
                assignTargetRoom(allCombat, Memory.enemyRoomName);
                console.log(`[adaptive] Combat → MARCH (${fighters.length} fighters + ${healers.length} healers → ${Memory.enemyRoomName})`);
            }
            break;
        case 'MARCH': {
            if (fighters.length === 0) {
                Memory.combatState = 'RALLY';
                break;
            }
            const inEnemyRoom = fighters.filter(c => c.room.name === Memory.enemyRoomName);
            if (inEnemyRoom.length > 0) {
                Memory.combatState = 'ENGAGE';
                console.log('[adaptive] Combat → ENGAGE');
            }
            break;
        }
        case 'ENGAGE':
            if (fighters.length === 0) {
                Memory.combatState = 'RALLY';
                console.log('[adaptive] Combat → RALLY (all fighters lost)');
            }
            if (Memory.rallyTick && Game.time - Memory.rallyTick > REASSESS_INTERVAL) {
                Memory.scoutTick = undefined;
                Memory.rallyTick = Game.time;
            }
            break;
    }
}
function assignTargetRoom(units, roomName) {
    for (const u of units)
        u.memory.targetRoomName = roomName;
}

// Manages StructureLink energy transfers.
// Pattern: source links (near each energy source) drain into a hub link (near spawn).
// Haulers then withdraw from the hub link, eliminating long hauler trips.
// 3% energy loss per transfer is acceptable — creep travel time is far more expensive.
function manageLinkTransfers(room) {
    var _a, _b, _c;
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
    // Hub = link closest to spawn; all others are source links
    const hub = links.reduce((a, b) => a.pos.getRangeTo(spawn) <= b.pos.getRangeTo(spawn) ? a : b);
    const sourceLinks = links.filter(l => l.id !== hub.id);
    // Transfer when: source link is well-loaded AND hub has room
    const hubFree = (_c = hub.store.getFreeCapacity(RESOURCE_ENERGY)) !== null && _c !== void 0 ? _c : 0;
    if (hubFree < 100)
        return; // hub is full enough
    for (const link of sourceLinks) {
        if (link.cooldown > 0)
            continue;
        if (link.store[RESOURCE_ENERGY] < 400)
            continue; // don't send half-loads
        link.transferEnergy(hub);
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
    if (Game.time % CHECK_INTERVAL !== 0)
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

// Logs a compact snapshot every REPORT_INTERVAL ticks AND writes to a rolling
// in-memory log at LOG_INTERVAL ticks.
//
// To dump history from the Screeps console:
//   JSON.stringify(Memory.statsLog)
//
// To get a specific field across history:
//   Memory.statsLog.map(s => [s.tick, s.rcl, s.energy.avail])
const REPORT_INTERVAL = 50; // console print frequency
const LOG_INTERVAL = 200; // Memory.statsLog write frequency
const LOG_MAX_ENTRIES = 500; // rolling window (~100k ticks at LOG_INTERVAL=200)
function reportStats(room) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    const snap = buildSnapshot(room);
    // Write to rolling memory log (survives disconnect, readable any time)
    if (Game.time % LOG_INTERVAL === 0) {
        if (!Memory.statsLog)
            Memory.statsLog = [];
        Memory.statsLog.push(snap);
        if (Memory.statsLog.length > LOG_MAX_ENTRIES) {
            Memory.statsLog = Memory.statsLog.slice(-LOG_MAX_ENTRIES);
        }
    }
    // Print to console for live monitoring
    if (Game.time % REPORT_INTERVAL !== 0)
        return;
    const ctrl = room.controller;
    // Use Game.creeps (global) so warriors/scouts in remote rooms are counted
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
        phase: (_c = Memory.phase) !== null && _c !== void 0 ? _c : 'ECONOMY',
        rcl: (_d = ctrl === null || ctrl === void 0 ? void 0 : ctrl.level) !== null && _d !== void 0 ? _d : 0,
        energy: { avail: room.energyAvailable, cap: room.energyCapacityAvailable, pct: Math.floor(room.energyAvailable / Math.max(room.energyCapacityAvailable, 1) * 100) },
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
        economy: (_e = Memory.energyStatus) !== null && _e !== void 0 ? _e : null,
        combat: { state: (_f = Memory.combatState) !== null && _f !== void 0 ? _f : 'RALLY', warriors: (_g = roles['warrior']) !== null && _g !== void 0 ? _g : 0, rangers: (_h = roles['ranger']) !== null && _h !== void 0 ? _h : 0, healers: (_j = roles['healer']) !== null && _j !== void 0 ? _j : 0, target: (_k = Memory.enemyRoomName) !== null && _k !== void 0 ? _k : null, tactics: (_l = Memory.platoonOrders) !== null && _l !== void 0 ? _l : null },
        intel,
        log_entries: (_o = (_m = Memory.statsLog) === null || _m === void 0 ? void 0 : _m.length) !== null && _o !== void 0 ? _o : 0,
    };
    console.log(`=== adaptive:stats:${Game.time} ===`);
    console.log(JSON.stringify(full));
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
        phase: (_b = Memory.phase) !== null && _b !== void 0 ? _b : 'ECONOMY',
        rcl: (_c = ctrl === null || ctrl === void 0 ? void 0 : ctrl.level) !== null && _c !== void 0 ? _c : 0,
        energy: { avail: room.energyAvailable, cap: room.energyCapacityAvailable },
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
            state: (_d = Memory.combatState) !== null && _d !== void 0 ? _d : 'RALLY',
            warriors: (_e = roles['warrior']) !== null && _e !== void 0 ? _e : 0,
            rangers: (_f = roles['ranger']) !== null && _f !== void 0 ? _f : 0,
            target: (_g = Memory.enemyRoomName) !== null && _g !== void 0 ? _g : null,
        },
    };
}

function loop() {
    var _a;
    // Purge dead creep memory
    for (const name in Memory.creeps) {
        if (!Game.creeps[name])
            delete Memory.creeps[name];
    }
    // Global memory defaults (initialize every tick so they're never undefined)
    if (!Memory.phase)
        Memory.phase = 'ECONOMY';
    if (!Memory.roomIntel)
        Memory.roomIntel = {};
    if (!Memory.statsLog)
        Memory.statsLog = [];
    // Per-room managers
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        trackEnergyFlow(room);
        updatePhase(room);
        manageConstruction(room);
        manageSpawns(room);
        pruneExcessCreeps(room);
        manageCombat(room);
        manageLinkTransfers(room);
        manageExpansion(room);
        manageMarket(room);
        reportStats(room);
    }
    // Run creep roles
    const enemyRoom = Memory.enemyRoomName;
    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        if ((creep.memory.role === 'warrior' || creep.memory.role === 'ranger' || creep.memory.role === 'healer') &&
            enemyRoom && !creep.memory.targetRoomName) {
            creep.memory.targetRoomName = enemyRoom;
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
