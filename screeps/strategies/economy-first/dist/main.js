'use strict';

// Fills spawn, extensions, and towers with energy.
function runHarvester(creep) {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }
    if (creep.memory.working) {
        const target = findEnergyTarget(creep);
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
function findEnergyTarget(creep) {
    // Priority: extensions > spawn > towers
    return creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: s => (s.structureType === STRUCTURE_EXTENSION ||
            s.structureType === STRUCTURE_SPAWN ||
            s.structureType === STRUCTURE_TOWER) &&
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });
}

// Upgrades the room controller to increase RCL.
function runUpgrader(creep) {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }
    if (creep.memory.working) {
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

// Builds construction sites; falls back to upgrading controller when idle.
function runBuilder(creep) {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }
    if (creep.memory.working) {
        const site = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);
        if (site) {
            if (creep.build(site) === ERR_NOT_IN_RANGE) {
                creep.moveTo(site, { reusePath: 5 });
            }
        }
        else {
            // No construction sites — help upgrade
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

// Target creep counts by role. Scales with room energy capacity.
const BASE_TARGETS = { harvester: 4, upgrader: 2, builder: 2 };
function manageSpawns(room) {
    const spawns = room.find(FIND_MY_SPAWNS).filter(s => !s.spawning);
    if (spawns.length === 0)
        return;
    const spawn = spawns[0];
    const counts = countByRole(room);
    const hasSites = room.find(FIND_CONSTRUCTION_SITES).length > 0;
    // Determine what to spawn next
    let role = null;
    if (counts.harvester < BASE_TARGETS.harvester) {
        role = 'harvester';
    }
    else if (counts.upgrader < BASE_TARGETS.upgrader) {
        role = 'upgrader';
    }
    else if (hasSites && counts.builder < BASE_TARGETS.builder) {
        role = 'builder';
    }
    else if (counts.harvester < BASE_TARGETS.harvester + 2) {
        // Scale harvesters further if we have extra energy capacity
        role = 'harvester';
    }
    if (!role)
        return;
    const body = selectBody(role, room.energyAvailable);
    if (!body)
        return;
    const name = `${role}_${Game.time}`;
    const result = spawn.spawnCreep(body, name, {
        memory: { role, working: false },
    });
    if (result === OK) {
        console.log(`[economy-first] Spawning ${name} (${body.join(',')})`);
    }
}
function countByRole(room) {
    const counts = { harvester: 0, upgrader: 0, builder: 0 };
    for (const creep of room.find(FIND_MY_CREEPS)) {
        const role = creep.memory.role;
        if (role in counts)
            counts[role]++;
    }
    return counts;
}
// Returns the best body we can afford given available energy.
function selectBody(role, energy) {
    const bodies = {
        // Listed from most expensive to cheapest — pick first one we can afford
        harvester: [
            [WORK, WORK, CARRY, CARRY, MOVE, MOVE], // 500
            [WORK, CARRY, CARRY, MOVE, MOVE], // 350
            [WORK, CARRY, MOVE], // 200
        ],
        upgrader: [
            [WORK, WORK, WORK, CARRY, MOVE, MOVE], // 650
            [WORK, WORK, CARRY, MOVE], // 400
            [WORK, CARRY, MOVE], // 200
        ],
        builder: [
            [WORK, WORK, CARRY, CARRY, MOVE, MOVE], // 500
            [WORK, CARRY, CARRY, MOVE], // 300
            [WORK, CARRY, MOVE], // 200
        ],
    };
    for (const body of bodies[role]) {
        const cost = body.reduce((sum, part) => sum + BODYPART_COST[part], 0);
        if (energy >= cost)
            return body;
    }
    return null;
}

function loop() {
    var _a;
    // Purge memory of dead creeps
    for (const name in Memory.creeps) {
        if (!Game.creeps[name])
            delete Memory.creeps[name];
    }
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
            case 'upgrader':
                runUpgrader(creep);
                break;
            case 'builder':
                runBuilder(creep);
                break;
        }
    }
}

exports.loop = loop;
