'use strict';

// Minimal harvester: fills spawn only, so we can keep spawning attackers.
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

// Moves to enemy room and attacks spawn first, then other structures, then creeps.
function runAttacker(creep) {
    const targetRoom = creep.memory.targetRoomName;
    // Travel to enemy room if not already there
    if (targetRoom && creep.room.name !== targetRoom) {
        const exitDir = creep.room.findExitTo(targetRoom);
        if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
            const exit = creep.pos.findClosestByRange(exitDir);
            if (exit)
                creep.moveTo(exit, { reusePath: 3 });
        }
        return;
    }
    const target = findAttackTarget(creep);
    if (!target) {
        // No targets — move to center of room to patrol
        creep.moveTo(new RoomPosition(25, 25, creep.room.name), { reusePath: 10 });
        return;
    }
    if (creep.attack(target) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { reusePath: 3 });
    }
}
function findAttackTarget(creep) {
    // Priority 1: enemy spawn (disables their economy)
    const enemySpawn = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_SPAWN,
    });
    if (enemySpawn)
        return enemySpawn;
    // Priority 2: enemy towers
    const enemyTower = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER,
    });
    if (enemyTower)
        return enemyTower;
    // Priority 3: other owned structures
    const enemyStructure = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES);
    if (enemyStructure)
        return enemyStructure;
    // Priority 4: enemy creeps
    return creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS);
}

const MIN_HARVESTERS = 2;
const WAVE_SIZE = 5; // attackers before launching
function manageSpawns(room) {
    var _a;
    const spawns = room.find(FIND_MY_SPAWNS).filter(s => !s.spawning);
    if (spawns.length === 0)
        return;
    const spawn = spawns[0];
    const creeps = room.find(FIND_MY_CREEPS);
    const harvesters = creeps.filter(c => c.memory.role === 'harvester');
    const attackers = creeps.filter(c => c.memory.role === 'attacker');
    const phase = (_a = Memory.rushPhase) !== null && _a !== void 0 ? _a : 'ECONOMY';
    if (phase === 'ECONOMY' || harvesters.length < MIN_HARVESTERS) {
        if (harvesters.length < MIN_HARVESTERS) {
            trySpawn(spawn, 'harvester', room.energyAvailable);
            return;
        }
        // Move to MUSTERING once we can spawn at least one wave's worth
        if (attackers.length === 0) {
            Memory.rushPhase = 'MUSTERING';
        }
    }
    if (Memory.rushPhase === 'MUSTERING' || Memory.rushPhase === 'ATTACK') {
        if (attackers.length < WAVE_SIZE) {
            trySpawn(spawn, 'attacker', room.energyAvailable);
        }
        else if (Memory.rushPhase === 'MUSTERING') {
            Memory.rushPhase = 'ATTACK';
            Memory.attackWaveTick = Game.time;
            console.log(`[rush] Wave ready at tick ${Game.time} — attacking!`);
        }
    }
}
function trySpawn(spawn, role, energy) {
    const body = role === 'attacker' ? selectAttackerBody(energy) : selectHarvesterBody(energy);
    if (!body)
        return;
    const name = `${role}_${Game.time}`;
    spawn.spawnCreep(body, name, { memory: { role, working: false } });
}
function selectAttackerBody(energy) {
    // Maximize ATTACK+MOVE, add TOUGH for cheap HP buffer
    const options = [
        [TOUGH, TOUGH, ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE, MOVE, MOVE], // 880
        [TOUGH, ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE, MOVE], // 680
        [ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE], // 480
        [ATTACK, ATTACK, MOVE, MOVE], // 260
        [ATTACK, MOVE], // 130
    ];
    for (const body of options) {
        if (energy >= body.reduce((s, p) => s + BODYPART_COST[p], 0))
            return body;
    }
    return null;
}
function selectHarvesterBody(energy) {
    const options = [
        [WORK, CARRY, CARRY, MOVE, MOVE], // 350
        [WORK, CARRY, MOVE], // 200
    ];
    for (const body of options) {
        if (energy >= body.reduce((s, p) => s + BODYPART_COST[p], 0))
            return body;
    }
    return null;
}

function loop() {
    var _a;
    for (const name in Memory.creeps) {
        if (!Game.creeps[name])
            delete Memory.creeps[name];
    }
    if (!Memory.rushPhase)
        Memory.rushPhase = 'ECONOMY';
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        manageSpawns(room);
        // Find enemy room on first tick — look at room exits
        if (!Memory.enemySpawnId) {
            findEnemyRoom(room);
        }
    }
    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        switch (creep.memory.role) {
            case 'harvester':
                runHarvester(creep);
                break;
            case 'attacker':
                runAttacker(creep);
                break;
        }
    }
}
// Scan adjacent rooms for enemy spawns and cache the target room name.
function findEnemyRoom(room) {
    const exits = Game.map.describeExits(room.name);
    for (const dir in exits) {
        const roomName = exits[dir];
        if (!roomName)
            continue;
        const roomInfo = Game.map.getRoomStatus(roomName);
        if (roomInfo.status === 'normal') {
            // Assign attack target to all future attackers
            const attackers = room.find(FIND_MY_CREEPS, {
                filter: c => c.memory.role === 'attacker',
            });
            for (const attacker of attackers) {
                attacker.memory.targetRoomName = roomName;
            }
            Memory.rushPhase = Memory.rushPhase === 'ECONOMY' ? 'ECONOMY' : Memory.rushPhase;
            break;
        }
    }
}

exports.loop = loop;
