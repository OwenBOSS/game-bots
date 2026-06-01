'use strict';

// Keeps spawn/extensions full so we can keep spawning collectors.
function runHarvester(creep) {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }
    if (creep.memory.working) {
        const target = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
            filter: (s) => (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
                s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        });
        if (target) {
            if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(target, { reusePath: 5 });
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

// Finds Score objects in the current room (or moves to a target room) and collects them.
// Season 10: Score objects are found via FIND_SCORES (10031).
// Collection: move to the Score object's position. The game may auto-collect on contact,
// or require pickup() — test both on the Season server.
function runCollector(creep) {
    // First look for scores in current room
    const localScores = creep.room.find(FIND_SCORES);
    if (localScores.length > 0) {
        // Target the highest-value score that is also closest (weighted)
        const target = bestScore(creep, localScores);
        collectScore(creep, target);
        return;
    }
    // No scores here — move to a known adjacent room that might have scores
    const nextRoom = pickNextRoom(creep);
    if (nextRoom) {
        moveToRoom(creep, nextRoom);
    }
    else {
        // Idle: stay near center of room, ready to react
        creep.moveTo(new RoomPosition(25, 25, creep.room.name), { reusePath: 10 });
    }
}
function collectScore(creep, target) {
    if (creep.pos.isEqualTo(target.pos)) {
        // Attempt pickup — if this API doesn't work on Season, try transfer or just being on tile
        const result = creep.pickup(target);
        if (result !== OK && result !== ERR_INVALID_TARGET) {
            console.log(`[season10] pickup result: ${result}`);
        }
    }
    else {
        creep.moveTo(target.pos, { reusePath: 2 });
    }
}
// Value = score points / (distance + 1) — prioritize nearby high-value scores
function bestScore(creep, scores) {
    return scores.reduce((best, s) => {
        const dist = creep.pos.getRangeTo(s.pos);
        const currentValue = best.score / (creep.pos.getRangeTo(best.pos) + 1);
        const candidateValue = s.score / (dist + 1);
        return candidateValue > currentValue ? s : best;
    });
}
function pickNextRoom(creep) {
    var _a, _b;
    const known = (_a = Memory.knownRooms) !== null && _a !== void 0 ? _a : [];
    const exits = Game.map.describeExits(creep.room.name);
    if (!exits)
        return null;
    const exitRooms = Object.values(exits).filter((r) => !!r);
    for (const roomName of exitRooms) {
        if (!known.includes(roomName)) {
            return roomName;
        }
    }
    // All adjacent explored — re-check the one with scores most recently
    const scoreMap = (_b = Memory.scoreMap) !== null && _b !== void 0 ? _b : {};
    const candidates = Object.entries(scoreMap)
        .filter(([room]) => exitRooms.includes(room))
        .sort((a, b) => b[1].score - a[1].score);
    return candidates.length > 0 ? candidates[0][0] : null;
}
function moveToRoom(creep, roomName) {
    const exitDir = creep.room.findExitTo(roomName);
    if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
        const exit = creep.pos.findClosestByRange(exitDir);
        if (exit)
            creep.moveTo(exit, { reusePath: 3 });
    }
}

// Season 10: prioritize fast collectors (MOVE-heavy) over economy creeps.
// Ratio: 2 harvesters to keep energy flowing, rest are collectors.
const MIN_HARVESTERS = 2;
const MAX_COLLECTORS = 8;
function manageSpawns(room) {
    const spawns = room.find(FIND_MY_SPAWNS).filter(s => !s.spawning);
    if (spawns.length === 0)
        return;
    const spawn = spawns[0];
    const creeps = room.find(FIND_MY_CREEPS);
    const harvesters = creeps.filter(c => c.memory.role === 'harvester').length;
    const collectors = creeps.filter(c => c.memory.role === 'collector').length;
    let role = null;
    if (harvesters < MIN_HARVESTERS) {
        role = 'harvester';
    }
    else if (collectors < MAX_COLLECTORS) {
        role = 'collector';
    }
    if (!role)
        return;
    const body = role === 'collector'
        ? selectCollectorBody(room.energyAvailable)
        : selectHarvesterBody(room.energyAvailable);
    if (!body)
        return;
    const name = `${role}_${Game.time}`;
    spawn.spawnCreep(body, name, { memory: { role, working: false } });
}
// Collectors need max MOVE for speed across rooms.
// CARRY lets them hold score objects if pickup() is used.
function selectCollectorBody(energy) {
    const opts = [
        [CARRY, CARRY, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE], // 600 — fast with capacity
        [CARRY, MOVE, MOVE, MOVE, MOVE, MOVE], // 400
        [CARRY, MOVE, MOVE, MOVE], // 250
        [CARRY, MOVE, MOVE], // 150
    ];
    for (const b of opts) {
        if (energy >= b.reduce((s, p) => s + BODYPART_COST[p], 0))
            return b;
    }
    return null;
}
function selectHarvesterBody(energy) {
    const opts = [
        [WORK, WORK, CARRY, MOVE, MOVE], // 450
        [WORK, CARRY, CARRY, MOVE, MOVE], // 350
        [WORK, CARRY, MOVE], // 200
    ];
    for (const b of opts) {
        if (energy >= b.reduce((s, p) => s + BODYPART_COST[p], 0))
            return b;
    }
    return null;
}

// Scans the current room for Score objects and updates the shared memory map.
// This lets collectors in adjacent rooms know where scores have been seen recently.
function trackScores(room) {
    if (!Memory.scoreMap)
        Memory.scoreMap = {};
    if (!Memory.knownRooms)
        Memory.knownRooms = [];
    if (!Memory.knownRooms.includes(room.name)) {
        Memory.knownRooms.push(room.name);
    }
    const scores = room.find(FIND_SCORES);
    const totalScore = scores.reduce((sum, s) => sum + s.score, 0);
    if (totalScore > 0) {
        Memory.scoreMap[room.name] = { score: totalScore, tick: Game.time };
    }
    else if (Memory.scoreMap[room.name]) {
        // Clear stale entry once the room is empty
        delete Memory.scoreMap[room.name];
    }
}

function loop() {
    var _a;
    for (const name in Memory.creeps) {
        if (!Game.creeps[name])
            delete Memory.creeps[name];
    }
    if (!Memory.scoreMap)
        Memory.scoreMap = {};
    if (!Memory.knownRooms)
        Memory.knownRooms = [];
    // Update score map for every visible room each tick
    for (const roomName in Game.rooms) {
        trackScores(Game.rooms[roomName]);
    }
    // Spawn management for owned rooms
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        manageSpawns(room);
    }
    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        switch (creep.memory.role) {
            case 'harvester':
                runHarvester(creep);
                break;
            case 'collector':
                runCollector(creep);
                break;
        }
    }
    if (Game.time % 100 === 0) {
        const rooms = Object.keys(Memory.scoreMap).join(', ') || 'none';
        console.log(`[season10] tick=${Game.time} score rooms: ${rooms}`);
    }
}

exports.loop = loop;
