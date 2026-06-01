'use strict';

// Harvests energy and delivers it to spawn, extensions, and towers.
// Falls back to upgrading the controller when nothing needs filling.
function runHarvester(creep) {
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
            // Nothing needs filling — upgrade the controller
            const controller = creep.room.controller;
            if (controller) {
                if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(controller, { reusePath: 5 });
                }
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
// Priority: extensions first (unlock better spawn bodies), then spawn, then towers.
function findDeliveryTarget(creep) {
    return creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: s => (s.structureType === STRUCTURE_EXTENSION ||
            s.structureType === STRUCTURE_SPAWN ||
            s.structureType === STRUCTURE_TOWER) &&
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });
}

// Builds construction sites, repairs damaged roads, upgrades controller as fallback.
function runBuilder(creep) {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }
    if (creep.memory.working) {
        // 1. Finish any construction site
        const site = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);
        if (site) {
            if (creep.build(site) === ERR_NOT_IN_RANGE) {
                creep.moveTo(site, { reusePath: 5 });
            }
            return;
        }
        // 2. Repair roads below 50% hits
        const damagedRoad = creep.pos.findClosestByPath(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_ROAD && s.hits < s.hitsMax * 0.5,
        });
        if (damagedRoad) {
            if (creep.repair(damagedRoad) === ERR_NOT_IN_RANGE) {
                creep.moveTo(damagedRoad, { reusePath: 5 });
            }
            return;
        }
        // 3. Nothing to build — help upgrade the controller
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

// Scouts adjacent rooms and stores rich intel in Memory.roomIntel.
// Re-scouts rooms where intel is older than STALE_TICKS.
const STALE_TICKS = 500;
function runScout(creep) {
    const targetRoom = creep.memory.targetRoomName;
    if (!targetRoom) {
        assignNextTarget(creep);
        return;
    }
    // Travel to target room
    if (creep.room.name !== targetRoom) {
        const exitDir = creep.room.findExitTo(targetRoom);
        if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
            const exit = creep.pos.findClosestByRange(exitDir);
            if (exit)
                creep.moveTo(exit, { reusePath: 3 });
        }
        return;
    }
    // We're in the target room — scan and record intel
    if (!creep.memory.scoutComplete) {
        recordRoomIntel(creep.room);
        creep.memory.scoutComplete = true;
    }
    // Pick a new target or return home
    assignNextTarget(creep);
}
function recordRoomIntel(room) {
    var _a, _b;
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
    };
    // Update the global enemy target if this is the strongest hostile room we've seen
    if (enemySpawns > 0 || enemyCreeps > 0) {
        const currentEnemy = Memory.enemyRoomName;
        const currentStrength = currentEnemy ? ((_b = (_a = Memory.roomIntel[currentEnemy]) === null || _a === void 0 ? void 0 : _a.strength) !== null && _b !== void 0 ? _b : 0) : -1;
        if (!currentEnemy || strength < currentStrength) {
            // prefer the weakest enemy room as our target
            Memory.enemyRoomName = room.name;
            Memory.enemyStrength = strength;
            Memory.scoutTick = Game.time;
        }
    }
    console.log(`[adaptive] Scout intel: ${room.name} strength=${strength} (creeps=${enemyCreeps} spawns=${enemySpawns} towers=${enemyTowers})`);
}
// Find an adjacent room that hasn't been scouted yet or has stale intel.
function assignNextTarget(creep) {
    var _a, _b;
    const homeRoom = Object.values(Game.rooms).find(r => { var _a; return (_a = r.controller) === null || _a === void 0 ? void 0 : _a.my; });
    if (!homeRoom)
        return;
    const exits = Game.map.describeExits(homeRoom.name);
    if (!exits)
        return;
    const intel = (_a = Memory.roomIntel) !== null && _a !== void 0 ? _a : {};
    const exitRooms = Object.values(exits).filter(Boolean);
    // Prefer unvisited rooms, then rooms with stale intel
    const target = (_b = exitRooms.find(r => !intel[r])) !== null && _b !== void 0 ? _b : exitRooms.find(r => intel[r] && Game.time - intel[r].scannedAt > STALE_TICKS);
    if (target) {
        creep.memory.targetRoomName = target;
        creep.memory.scoutComplete = false;
    }
    else {
        // All rooms are fresh — return to home room and wait
        if (homeRoom && creep.room.name !== homeRoom.name) {
            const exitDir = creep.room.findExitTo(homeRoom.name);
            if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
                const exit = creep.pos.findClosestByRange(exitDir);
                if (exit)
                    creep.moveTo(exit, { reusePath: 5 });
            }
        }
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
            rallyAtSpawn(creep);
            break;
        case 'MARCH':
        case 'ENGAGE': {
            const targetRoom = creep.memory.targetRoomName;
            if (targetRoom && creep.room.name !== targetRoom) {
                moveToRoom(creep, targetRoom);
            }
            else {
                engageInRoom(creep);
            }
            break;
        }
    }
}
function rallyAtSpawn(creep) {
    const spawn = creep.pos.findClosestByPath(FIND_MY_SPAWNS);
    if (spawn && creep.pos.getRangeTo(spawn) > 4) {
        creep.moveTo(spawn, { reusePath: 5 });
    }
}
function retreatToSpawn(creep) {
    const spawn = creep.pos.findClosestByPath(FIND_MY_SPAWNS);
    if (spawn) {
        creep.moveTo(spawn, { reusePath: 3 });
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
function moveToRoom(creep, roomName) {
    const exitDir = creep.room.findExitTo(roomName);
    if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
        const exit = creep.pos.findClosestByRange(exitDir);
        if (exit)
            creep.moveTo(exit, { reusePath: 3 });
    }
}

const ECONOMY_CREEP_TARGET = 5; // transition to ASSESS once we have this many creeps
const RUSH_STRENGTH_THRESHOLD = 10; // below this: rush; above: defend
function updatePhase(room) {
    var _a;
    const phase = (_a = Memory.phase) !== null && _a !== void 0 ? _a : 'ECONOMY';
    if (!Memory.roomIntel)
        Memory.roomIntel = {};
    const myCreeps = room.find(FIND_MY_CREEPS).length;
    switch (phase) {
        case 'ECONOMY':
            if (myCreeps >= ECONOMY_CREEP_TARGET) {
                Memory.phase = 'ASSESS';
                Memory.phaseTick = Game.time;
                console.log(`[adaptive] -> ASSESS at tick ${Game.time}`);
            }
            break;
        case 'ASSESS':
            // Wait for scout to report back
            if (Memory.scoutTick !== undefined && Memory.enemyStrength !== undefined) {
                Memory.phase = Memory.enemyStrength <= RUSH_STRENGTH_THRESHOLD ? 'RUSH' : 'DEFEND';
                Memory.phaseTick = Game.time;
                console.log(`[adaptive] -> ${Memory.phase} (enemy strength ${Memory.enemyStrength})`);
            }
            break;
        case 'RUSH':
        case 'DEFEND':
            if (myCreeps === 0) {
                Memory.phase = 'ECONOMY';
                Memory.combatState = 'RALLY';
                Memory.roadsPlanned = false; // re-plan on rebuild
                console.log('[adaptive] -> ECONOMY (reset after loss)');
            }
            break;
    }
}

// Desired counts per phase
const TARGETS = {
    ECONOMY: { harvester: 4, builder: 1, scout: 0, warrior: 0 },
    ASSESS: { harvester: 4, builder: 1, scout: 1, warrior: 0 },
    RUSH: { harvester: 2, builder: 0, scout: 1, warrior: 6 },
    DEFEND: { harvester: 4, builder: 2, scout: 1, warrior: 4 },
};
function manageSpawns(room) {
    var _a;
    const spawns = room.find(FIND_MY_SPAWNS).filter(s => !s.spawning);
    if (spawns.length === 0)
        return;
    const spawn = spawns[0];
    const phase = (_a = Memory.phase) !== null && _a !== void 0 ? _a : 'ECONOMY';
    const targets = TARGETS[phase];
    const creeps = room.find(FIND_MY_CREEPS);
    const counts = {
        harvester: creeps.filter(c => c.memory.role === 'harvester').length,
        builder: creeps.filter(c => c.memory.role === 'builder').length,
        scout: creeps.filter(c => c.memory.role === 'scout').length,
        warrior: creeps.filter(c => c.memory.role === 'warrior').length,
    };
    // Harvesters are always top priority — nothing works without energy
    if (counts.harvester < targets.harvester) {
        trySpawn(spawn, 'harvester', room.energyAvailable);
        return;
    }
    // Then fill the rest in priority order
    if (counts.builder < targets.builder) {
        trySpawn(spawn, 'builder', room.energyAvailable);
    }
    else if (counts.scout < targets.scout) {
        trySpawn(spawn, 'scout', room.energyAvailable);
    }
    else if (counts.warrior < targets.warrior) {
        trySpawn(spawn, 'warrior', room.energyAvailable);
    }
}
function trySpawn(spawn, role, energy) {
    const body = selectBody(role, energy);
    if (!body)
        return;
    const name = `${role}_${Game.time}`;
    const result = spawn.spawnCreep(body, name, { memory: { role, working: false } });
    if (result === OK) {
        console.log(`[adaptive] Spawning ${name} (${body.join(',')})`);
    }
}
function selectBody(role, energy) {
    const bodies = {
        harvester: [
            [WORK, WORK, CARRY, CARRY, MOVE, MOVE], // 500
            [WORK, CARRY, CARRY, MOVE, MOVE], // 350
            [WORK, CARRY, MOVE], // 200
        ],
        builder: [
            [WORK, WORK, CARRY, CARRY, MOVE, MOVE], // 500
            [WORK, CARRY, CARRY, MOVE, MOVE], // 350
            [WORK, CARRY, MOVE], // 200
        ],
        scout: [
            [MOVE, MOVE, MOVE], // 150 — pure speed
            [MOVE, MOVE], // 100
            [MOVE], // 50
        ],
        warrior: [
            // Balanced: tough buffer + melee + heal + move
            [TOUGH, TOUGH, ATTACK, ATTACK, ATTACK, HEAL, MOVE, MOVE, MOVE, MOVE, MOVE], // 1010
            [TOUGH, ATTACK, ATTACK, ATTACK, HEAL, MOVE, MOVE, MOVE, MOVE], // 800
            [ATTACK, ATTACK, HEAL, MOVE, MOVE, MOVE], // 560
            [ATTACK, ATTACK, MOVE, MOVE, MOVE], // 310
            [ATTACK, MOVE], // 130
        ],
    };
    for (const body of bodies[role]) {
        const cost = body.reduce((sum, p) => sum + BODYPART_COST[p], 0);
        if (energy >= cost)
            return body;
    }
    return null;
}

// Places and re-evaluates construction sites whenever RCL increases.
// Order matters: containers unlock the energy flow that lets everything else scale.
function manageConstruction(room) {
    var _a, _b;
    const rcl = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0;
    if (Memory.roadsPlanned && Memory.lastRCL === rcl)
        return;
    Memory.roadsPlanned = true;
    Memory.lastRCL = rcl;
    placeContainers(room); // RCL 0  — highest ROI
    placeKeyRoads(room); // RCL 0  — harvester efficiency
    if (rcl >= 2)
        placeExtensions(room, rcl); // RCL 2+ — spawn capacity
    if (rcl >= 2)
        placeRamparts(room); // RCL 2+ — protect key structures
    if (rcl >= 3)
        placeTowers(room, rcl); // RCL 3+ — passive defense
    console.log(`[adaptive] Construction planned at RCL ${rcl}`);
}
// ─── Containers ──────────────────────────────────────────────────────────────
// One container adjacent to each source (harvesters park and dump in place),
// one near the controller (upgraders withdraw from it rather than walking to spawn).
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
        // Try each adjacent tile until one accepts the site
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0)
                    continue;
                if (room.createConstructionSite(pos.x + dx, pos.y + dy, STRUCTURE_CONTAINER) === OK) {
                    break;
                }
            }
        }
    }
}
// ─── Roads ───────────────────────────────────────────────────────────────────
function placeKeyRoads(room) {
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn)
        return;
    for (const source of room.find(FIND_SOURCES)) {
        placeRoad(room, spawn.pos, source.pos);
    }
    if (room.controller) {
        placeRoad(room, spawn.pos, room.controller.pos);
    }
}
function placeRoad(room, from, to) {
    const path = room.findPath(from, to, { ignoreCreeps: true, swampCost: 1, plainCost: 2 });
    for (const step of path) {
        room.createConstructionSite(step.x, step.y, STRUCTURE_ROAD);
    }
}
// ─── Extensions ──────────────────────────────────────────────────────────────
// Spiral outward from spawn. More extensions = larger spawn budget = better creeps.
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
                const x = spawn.pos.x + dx;
                const y = spawn.pos.y + dy;
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
// Place near spawn so they cover the base. One at RCL 3, scaling up with RCL.
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
    // Expand outward from spawn until we find a free tile
    for (let r = 2; r <= 8; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r)
                    continue;
                const x = spawn.pos.x + dx;
                const y = spawn.pos.y + dy;
                if (x < 2 || x > 47 || y < 2 || y > 47)
                    continue;
                if (room.createConstructionSite(x, y, STRUCTURE_TOWER) === OK)
                    return;
            }
        }
    }
}
// ─── Ramparts ────────────────────────────────────────────────────────────────
// Overlay ramparts on the spawn and any towers. Your creeps walk through owned
// ramparts freely; enemies must destroy them first (300k base hits).
function placeRamparts(room) {
    const toProtect = [
        ...room.find(FIND_MY_SPAWNS),
        ...room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER }),
    ];
    for (const s of toProtect) {
        const alreadyHas = s.pos.lookFor(LOOK_STRUCTURES).some(ls => ls.structureType === STRUCTURE_RAMPART) ||
            s.pos.lookFor(LOOK_CONSTRUCTION_SITES).some(cs => cs.structureType === STRUCTURE_RAMPART);
        if (!alreadyHas) {
            room.createConstructionSite(s.pos.x, s.pos.y, STRUCTURE_RAMPART);
        }
    }
}

// Minimum warriors before we march. Waiting for a group is much more effective
// than sending warriors one at a time — a solo warrior dies to a tower instantly.
const MIN_WARRIORS_TO_MARCH = 3;
// How often to clear scoutTick to trigger a re-scout of the enemy room (ticks)
const REASSESS_INTERVAL = 500;
function manageCombat(room) {
    var _a;
    const warriors = room.find(FIND_MY_CREEPS, {
        filter: c => c.memory.role === 'warrior',
    });
    const state = (_a = Memory.combatState) !== null && _a !== void 0 ? _a : 'RALLY';
    switch (state) {
        case 'RALLY':
            if (warriors.length >= MIN_WARRIORS_TO_MARCH && Memory.enemyRoomName) {
                Memory.combatState = 'MARCH';
                Memory.rallyTick = Game.time;
                assignTargetRoom(warriors, Memory.enemyRoomName);
                console.log(`[adaptive] Combat -> MARCH (${warriors.length} warriors -> ${Memory.enemyRoomName})`);
            }
            break;
        case 'MARCH': {
            const inEnemyRoom = warriors.filter(w => w.room.name === Memory.enemyRoomName);
            if (inEnemyRoom.length > 0) {
                Memory.combatState = 'ENGAGE';
                console.log('[adaptive] Combat -> ENGAGE');
            }
            // If we somehow lost all warriors while marching, reset
            if (warriors.length === 0) {
                Memory.combatState = 'RALLY';
            }
            break;
        }
        case 'ENGAGE':
            if (warriors.length === 0) {
                Memory.combatState = 'RALLY';
                console.log('[adaptive] Combat -> RALLY (all warriors lost)');
            }
            // Periodically re-assess whether there's still something to fight
            if (Memory.rallyTick && Game.time - Memory.rallyTick > REASSESS_INTERVAL) {
                Memory.scoutTick = undefined; // trigger re-scout
                Memory.rallyTick = Game.time;
            }
            break;
    }
}
function assignTargetRoom(warriors, roomName) {
    for (const w of warriors) {
        w.memory.targetRoomName = roomName;
    }
}

// Logs a compact structured snapshot every REPORT_INTERVAL ticks.
// Paste one block into chat for analysis.
const REPORT_INTERVAL = 50;
function reportStats(room) {
    var _a, _b, _c, _d, _e, _f, _g;
    if (Game.time % REPORT_INTERVAL !== 0)
        return;
    const ctrl = room.controller;
    const creeps = room.find(FIND_MY_CREEPS);
    // Creep count by role
    const roles = {};
    for (const c of creeps) {
        roles[c.memory.role] = ((_a = roles[c.memory.role]) !== null && _a !== void 0 ? _a : 0) + 1;
    }
    // Structure counts (built + pending)
    const sc = (type) => ({
        built: room.find(FIND_STRUCTURES, { filter: s => s.structureType === type }).length,
        pending: room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === type }).length,
    });
    // Tower energy levels
    const towers = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER });
    const towerEnergy = towers.map(t => Math.floor(t.store[RESOURCE_ENERGY] / t.store.getCapacity(RESOURCE_ENERGY) * 100));
    // Rampart min hits (tells you if your defenses are being eroded)
    const ramparts = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_RAMPART });
    const rampartMin = ramparts.length > 0 ? Math.min(...ramparts.map(r => r.hits)) : null;
    // Room intel summary
    const intel = {};
    for (const [r, data] of Object.entries((_b = Memory.roomIntel) !== null && _b !== void 0 ? _b : {})) {
        intel[r] = { str: data.strength, age: Game.time - data.scannedAt };
    }
    const stats = {
        tick: Game.time,
        phase: (_c = Memory.phase) !== null && _c !== void 0 ? _c : 'ECONOMY',
        rcl: (_d = ctrl === null || ctrl === void 0 ? void 0 : ctrl.level) !== null && _d !== void 0 ? _d : 0,
        energy: {
            avail: room.energyAvailable,
            cap: room.energyCapacityAvailable,
            pct: Math.floor(room.energyAvailable / Math.max(room.energyCapacityAvailable, 1) * 100),
        },
        controller: ctrl ? {
            pct: Math.floor(ctrl.progress / Math.max(ctrl.progressTotal, 1) * 100),
            progress: ctrl.progress,
            total: ctrl.progressTotal,
        } : null,
        creeps: Object.assign({ total: creeps.length }, roles),
        structures: {
            roads: sc(STRUCTURE_ROAD),
            containers: sc(STRUCTURE_CONTAINER),
            extensions: sc(STRUCTURE_EXTENSION),
            towers: Object.assign(Object.assign({}, sc(STRUCTURE_TOWER)), { energy_pct: towerEnergy }),
            ramparts: Object.assign(Object.assign({}, sc(STRUCTURE_RAMPART)), { min_hits: rampartMin }),
        },
        sites_total: room.find(FIND_MY_CONSTRUCTION_SITES).length,
        combat: {
            state: (_e = Memory.combatState) !== null && _e !== void 0 ? _e : 'RALLY',
            warriors: (_f = roles['warrior']) !== null && _f !== void 0 ? _f : 0,
            target: (_g = Memory.enemyRoomName) !== null && _g !== void 0 ? _g : null,
        },
        intel,
    };
    console.log(`=== adaptive:stats:${Game.time} ===`);
    console.log(JSON.stringify(stats));
}

function loop() {
    var _a;
    for (const name in Memory.creeps) {
        if (!Game.creeps[name])
            delete Memory.creeps[name];
    }
    if (!Memory.phase)
        Memory.phase = 'ECONOMY';
    if (!Memory.roomIntel)
        Memory.roomIntel = {};
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        updatePhase(room);
        manageConstruction(room);
        manageSpawns(room);
        manageCombat(room);
        reportStats(room);
    }
    const enemyRoom = Memory.enemyRoomName;
    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        switch (creep.memory.role) {
            case 'harvester':
                runHarvester(creep);
                break;
            case 'builder':
                runBuilder(creep);
                break;
            case 'scout':
                runScout(creep);
                break;
            case 'warrior':
                if (enemyRoom && !creep.memory.targetRoomName) {
                    creep.memory.targetRoomName = enemyRoom;
                }
                runWarrior(creep);
                break;
        }
    }
}

exports.loop = loop;
