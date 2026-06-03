'use strict';

// Per-tick memoisation of room.find() results.
// Call resetTickCache() at the top of the main loop to clear stale entries.
const cache = new Map();
function findCached(room, constant) {
    const key = `${room.name}-${constant}`;
    if (!cache.has(key)) {
        cache.set(key, room.find(constant));
    }
    return cache.get(key);
}
function resetTickCache() {
    cache.clear();
}

// Scans visible rooms for Score objects and maintains two caches:
//   Memory.scoreCache  — per-score entries with decay expiry (used by collectors)
//   Memory.scoreMap    — per-room aggregate (used by scouts/logistics)
// Scanning is throttled to every 10 ticks to stay within CPU budget.
function shouldScanThisTick() {
    return Game.time % 10 === 0;
}
function trackScores(room) {
    if (!Memory.scoreCache)
        Memory.scoreCache = {};
    if (!Memory.scoreMap)
        Memory.scoreMap = {};
    if (!Memory.knownRooms)
        Memory.knownRooms = [];
    if (!Memory.knownRooms.includes(room.name)) {
        Memory.knownRooms.push(room.name);
    }
    if (!shouldScanThisTick())
        return;
    if (typeof FIND_SCORES === 'undefined')
        return;
    // Purge expired cache entries
    for (const id in Memory.scoreCache) {
        if (Memory.scoreCache[id].expiresAt <= Game.time) {
            delete Memory.scoreCache[id];
        }
    }
    // Scan room for current scores
    const scores = room.find(FIND_SCORES);
    const totalScore = scores.reduce((sum, s) => sum + s.score, 0);
    for (const score of scores) {
        Memory.scoreCache[score.id] = {
            pos: { x: score.pos.x, y: score.pos.y, roomName: room.name },
            value: score.score,
            expiresAt: Game.time + score.ticksToDecay,
        };
    }
    if (totalScore > 0) {
        Memory.scoreMap[room.name] = { score: totalScore, tick: Game.time };
    }
    else if (Memory.scoreMap[room.name]) {
        delete Memory.scoreMap[room.name];
    }
}

// Season 10 body builder — returns cheapest body that fits the budget.
// Collector bodies use MOVE+TOUGH (no CARRY — Scores are collected by stepping on tile).
// Bodies are returned in Screeps-legal order: TOUGH first, then MOVE last.
function buildCollectorBody(energy) {
    // RC5+ tier: [TOUGH×10, ATTACK×2, MOVE×10] — 660e
    if (energy >= 660) {
        return [
            TOUGH, TOUGH, TOUGH, TOUGH, TOUGH,
            TOUGH, TOUGH, TOUGH, TOUGH, TOUGH,
            ATTACK, ATTACK,
            MOVE, MOVE, MOVE, MOVE, MOVE,
            MOVE, MOVE, MOVE, MOVE, MOVE,
        ];
    }
    // RC3-4 tier: [TOUGH×5, MOVE×5] — 300e
    if (energy >= 300) {
        return [TOUGH, TOUGH, TOUGH, TOUGH, TOUGH, MOVE, MOVE, MOVE, MOVE, MOVE];
    }
    // RC1-2 tier: [TOUGH, MOVE×3] — 160e
    if (energy >= 160) {
        return [TOUGH, MOVE, MOVE, MOVE];
    }
    return null;
}
function buildScoutBody(energy) {
    if (energy < 50)
        return null;
    return [MOVE];
}
function buildHunterBody(energy) {
    // [ATTACK×3, MOVE×3] — 390e, 30 DPS, fast enough to intercept collectors
    if (energy >= 390) {
        return [ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE];
    }
    return null;
}
function buildHaulerBody(energy) {
    // Road-optimized: 2 CARRY per 1 MOVE (halved fatigue on roads). Each unit = 150e, 100e capacity.
    if (energy >= 600)
        return [CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE];
    if (energy >= 450)
        return [CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE];
    if (energy >= 300)
        return [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE];
    if (energy >= 150)
        return [CARRY, CARRY, MOVE];
    return null;
}
function buildHarvesterBody(energy) {
    // Stationary — maximize WORK, minimal CARRY+MOVE (parks on source container).
    if (energy >= 500)
        return [WORK, WORK, WORK, WORK, CARRY, MOVE];
    if (energy >= 300)
        return [WORK, WORK, CARRY, MOVE];
    if (energy >= 200)
        return [WORK, CARRY, MOVE];
    return null;
}
function buildBuilderBody(energy) {
    // Builder needs CARRY-heavy body — withdraws from containers and makes long build trips.
    // More CARRY = fewer round-trips = more time building.
    if (energy >= 500)
        return [WORK, WORK, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE];
    if (energy >= 300)
        return [WORK, CARRY, CARRY, CARRY, MOVE];
    if (energy >= 200)
        return [WORK, CARRY, MOVE];
    return null;
}

// Season 10 spawn manager — RC-level aware, uses bodyBuilder for correct body selection.
// Priority: harvesters → scouts (RC1) → builder (RC2+) → collectors → hunters (conditional).
const MIN_HARVESTERS = 2;
const MAX_BUILDERS = 1; // one builder until infrastructure is complete
function getCollectorQuota(room) {
    const storage = room.storage;
    if (!storage)
        return 2;
    const energy = storage.store[RESOURCE_ENERGY];
    if (energy >= 200000)
        return 8;
    if (energy >= 100000)
        return 5;
    if (energy >= 50000)
        return 3;
    return 2;
}
function manageSpawns(room) {
    var _a, _b;
    const allSpawns = findCached(room, FIND_MY_SPAWNS);
    const spawns = allSpawns.filter((s) => !s.spawning);
    if (spawns.length === 0)
        return;
    const spawn = spawns[0];
    const creeps = findCached(room, FIND_MY_CREEPS);
    const harvesters = creeps.filter((c) => c.memory.role === 'harvester').length;
    const collectors = creeps.filter((c) => c.memory.role === 'collector').length;
    const scouts = creeps.filter((c) => c.memory.role === 'scout').length;
    const haulers = creeps.filter((c) => c.memory.role === 'hauler').length;
    const builders = creeps.filter((c) => c.memory.role === 'builder').length;
    const hunters = creeps.filter((c) => c.memory.role === 'hunter').length;
    const level = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 1;
    const mem = room.memory;
    // 1. Always maintain minimum harvesters first
    if (harvesters < MIN_HARVESTERS) {
        trySpawn(spawn, 'harvester', buildHarvesterBody(room.energyAvailable));
        return;
    }
    // 2. RC1: spawn one scout immediately if flagged
    if (level === 1 && mem.spawnScoutNext && scouts === 0) {
        trySpawn(spawn, 'scout', buildScoutBody(room.energyAvailable));
        return;
    }
    // 3. RC2+: keep one builder when there are active construction sites
    const hasSites = findCached(room, FIND_CONSTRUCTION_SITES).length > 0;
    if (level >= 2 && builders < MAX_BUILDERS && hasSites) {
        trySpawn(spawn, 'builder', buildBuilderBody(room.energyAvailable));
        return;
    }
    // 4. Haulers: 1 per source, but only once containers exist
    const allStructures = findCached(room, FIND_STRUCTURES);
    const sourceCount = findCached(room, FIND_SOURCES).length;
    const hasContainers = allStructures.some((s) => s.structureType === STRUCTURE_CONTAINER);
    if (hasContainers && haulers < sourceCount) {
        trySpawn(spawn, 'hauler', buildHaulerBody(room.energyAvailable));
        return;
    }
    // 5. Determine collector quota
    const quota = resolveCollectorQuota(room, level, mem);
    // 6. Spawn collector if under quota — set homeRoom so idle collectors return correctly
    if (collectors < quota) {
        trySpawn(spawn, 'collector', buildCollectorBody(room.energyAvailable), { homeRoom: room.name });
        return;
    }
    // 7. Spawn hunter if enemy collectors detected near Score rooms (RC3+)
    if (level >= 3 && hunters < 1 && enemiesNearScores()) {
        trySpawn(spawn, 'hunter', buildHunterBody(room.energyAvailable));
    }
}
function resolveCollectorQuota(room, level, mem) {
    if (mem.dynamicCollectorQuota)
        return getCollectorQuota(room);
    if (mem.collectorQuota !== undefined)
        return mem.collectorQuota;
    // Defaults by level
    if (level >= 5)
        return 5;
    if (level >= 3)
        return 3;
    if (level >= 2)
        return 1;
    return 1; // RC1: spawn one collector immediately — scores are the entire point
}
function enemiesNearScores() {
    var _a;
    const cache = (_a = Memory.scoreCache) !== null && _a !== void 0 ? _a : {};
    const hotRooms = new Set(Object.values(cache).map(e => e.pos.roomName));
    for (const roomName of hotRooms) {
        const room = Game.rooms[roomName];
        if (room && room.find(FIND_HOSTILE_CREEPS).length > 0)
            return true;
    }
    return false;
}
function trySpawn(spawn, role, body, extraMem = {}) {
    if (!body)
        return;
    const name = `${role}_${Game.time}`;
    spawn.spawnCreep(body, name, { memory: { role, working: false, ...extraMem } });
}

// Fires once per RC level-up. Stores the new level in room.memory.rcLevel and
// applies Season 10-specific flags that other managers read each tick.
function checkRCTransition(room) {
    var _a;
    const level = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level;
    if (level === undefined)
        return;
    if (room.memory.rcLevel === level)
        return;
    room.memory.rcLevel = level;
    onRCLevelUp(room, level);
}
function onRCLevelUp(room, level) {
    var _a;
    switch (level) {
        case 1:
            room.memory.spawnScoutNext = true;
            break;
        case 2:
            if (!Memory.scoreCache)
                Memory.scoreCache = {};
            break;
        case 3:
            room.memory.collectorQuota = 3;
            break;
        case 4:
            room.memory.dynamicCollectorQuota = true;
            break;
        case 8:
            room.memory.observerEnabled = true;
            // Populate observer targets from adjacent rooms
            const exits = Game.map.describeExits(room.name);
            if (exits) {
                const adjacent = Object.values(exits).filter((r) => !!r);
                Memory.observerTargets = [...new Set([...((_a = Memory.observerTargets) !== null && _a !== void 0 ? _a : []), ...adjacent])];
            }
            break;
    }
}

// Construction manager — places structure sites when available.
// Build order prioritizes the energy chain:
//   RC2: containers first (energy chain), then extensions once all containers exist
//   RC3: tower, roads (spawn→sources, spawn→controller), more extensions
//   RC4: storage, more extensions
const CONTAINER_RANGE = 1;
const MAX_EXTENSIONS_BY_LEVEL = {
    2: 5, 3: 10, 4: 20, 5: 30, 6: 40, 7: 50, 8: 60,
};
function manageConstruction(room) {
    var _a, _b;
    const level = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0;
    if (level < 2)
        return;
    if (level >= 2)
        placeSourceContainers(room);
    if (level >= 2)
        placeExtensions(room); // gated behind container completion internally
    if (level >= 3)
        placeTowerSite(room);
    if (level >= 3)
        placeSourceRoads(room);
    if (level >= 4)
        placeStorageSite(room);
}
function placeSourceContainers(room) {
    const mem = room.memory;
    // Re-check every 201 ticks — containers can decay and need to be re-placed
    if (mem.containerSitesPlaced && Game.time % 201 !== 0)
        return;
    const sources = findCached(room, FIND_SOURCES);
    const allStructures = findCached(room, FIND_STRUCTURES);
    const existingContainers = allStructures.filter((s) => s.structureType === STRUCTURE_CONTAINER);
    const existingSites = findCached(room, FIND_CONSTRUCTION_SITES).filter((s) => s.structureType === STRUCTURE_CONTAINER);
    let placed = false;
    let allCovered = true;
    for (const source of sources) {
        const { x, y } = source.pos;
        const alreadyHas = [...existingContainers, ...existingSites].some((s) => Math.abs(s.pos.x - x) <= CONTAINER_RANGE && Math.abs(s.pos.y - y) <= CONTAINER_RANGE);
        if (alreadyHas)
            continue;
        allCovered = false;
        const result = room.createConstructionSite(x, Math.max(0, y - 1), STRUCTURE_CONTAINER);
        if (result === OK)
            placed = true;
    }
    if (placed || allCovered)
        mem.containerSitesPlaced = true;
}
function placeExtensions(room) {
    var _a, _b, _c;
    const level = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0;
    const maxExt = (_c = MAX_EXTENSIONS_BY_LEVEL[level]) !== null && _c !== void 0 ? _c : 0;
    if (maxExt === 0)
        return;
    // Gate on containers — extensions near spawn get built before far containers,
    // delaying the energy chain. Don't place until every source has a container.
    const sources = findCached(room, FIND_SOURCES);
    const allStructures = findCached(room, FIND_STRUCTURES);
    const containers = allStructures.filter((s) => s.structureType === STRUCTURE_CONTAINER);
    const allContainersCovered = sources.every((src) => containers.some((c) => Math.abs(c.pos.x - src.pos.x) <= CONTAINER_RANGE && Math.abs(c.pos.y - src.pos.y) <= CONTAINER_RANGE));
    if (!allContainersCovered)
        return;
    const existingCount = allStructures.filter((s) => s.structureType === STRUCTURE_EXTENSION).length;
    const siteCount = findCached(room, FIND_CONSTRUCTION_SITES).filter((s) => s.structureType === STRUCTURE_EXTENSION).length;
    if (existingCount + siteCount >= maxExt)
        return;
    const spawns = findCached(room, FIND_MY_SPAWNS);
    const spawn = spawns[0];
    if (!spawn)
        return;
    // Expand outward from spawn in rings to find a free non-wall tile
    for (let radius = 2; radius <= 8; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                if (Math.abs(dx) !== radius && Math.abs(dy) !== radius)
                    continue;
                const x = spawn.pos.x + dx;
                const y = spawn.pos.y + dy;
                if (x < 2 || x > 47 || y < 2 || y > 47)
                    continue;
                if (room.lookForAt(LOOK_TERRAIN, x, y)[0] === 'wall')
                    continue;
                if (room.lookForAt(LOOK_STRUCTURES, x, y).length > 0)
                    continue;
                if (room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y).length > 0)
                    continue;
                if (room.createConstructionSite(x, y, STRUCTURE_EXTENSION) === OK)
                    return;
            }
        }
    }
}
function placeSourceRoads(room) {
    const mem = room.memory;
    if (mem.roadSitesPlaced)
        return;
    const spawns = findCached(room, FIND_MY_SPAWNS);
    const spawn = spawns[0];
    if (!spawn)
        return;
    const sources = findCached(room, FIND_SOURCES);
    const ctrl = room.controller;
    const destinations = [
        ...sources.map((s) => s.pos),
        ...(ctrl ? [ctrl.pos] : []),
    ];
    for (const dest of destinations) {
        const path = room.findPath(spawn.pos, dest, { ignoreCreeps: true, swampCost: 2 });
        for (const step of path) {
            const hasRoad = room.lookForAt(LOOK_STRUCTURES, step.x, step.y).some((s) => s.structureType === STRUCTURE_ROAD);
            if (hasRoad)
                continue;
            const hasSite = room.lookForAt(LOOK_CONSTRUCTION_SITES, step.x, step.y).some((s) => s.structureType === STRUCTURE_ROAD);
            if (!hasSite)
                room.createConstructionSite(step.x, step.y, STRUCTURE_ROAD);
        }
    }
    mem.roadSitesPlaced = true;
}
function placeTowerSite(room) {
    const mem = room.memory;
    if (mem.towerSitePlaced)
        return;
    const myStructures = findCached(room, FIND_MY_STRUCTURES);
    if (myStructures.some((s) => s.structureType === STRUCTURE_TOWER)) {
        mem.towerSitePlaced = true;
        return;
    }
    const hasSite = findCached(room, FIND_CONSTRUCTION_SITES).some((s) => s.structureType === STRUCTURE_TOWER);
    if (hasSite)
        return;
    if (room.createConstructionSite(25, 23, STRUCTURE_TOWER) === OK)
        mem.towerSitePlaced = true;
}
function placeStorageSite(room) {
    const mem = room.memory;
    if (mem.storageSitePlaced)
        return;
    if (room.storage) {
        mem.storageSitePlaced = true;
        return;
    }
    const hasSite = findCached(room, FIND_CONSTRUCTION_SITES).some((s) => s.structureType === STRUCTURE_STORAGE);
    if (hasSite)
        return;
    if (room.createConstructionSite(25, 25, STRUCTURE_STORAGE) === OK)
        mem.storageSitePlaced = true;
}

// Tower logic — runs every tick for each tower in an owned room.
// Priority (per RC strategy Part 5):
//   1. Attack any hostile creep
//   2. Heal any allied creep below 80% hits
//   3. Repair any rampart below 10,000 hits
//   4. Repair containers below 50% hits (prevents decay)
//   5. Repair any road below 50% hits (only if tower energy > 700)
const HEAL_THRESHOLD = 0.8;
const RAMPART_MIN_HITS = 10000;
const ROAD_ENERGY_MIN = 700;
function manageTowers(room) {
    const towers = findCached(room, FIND_MY_STRUCTURES).filter((s) => s.structureType === STRUCTURE_TOWER);
    if (towers.length === 0)
        return;
    const hostiles = findCached(room, FIND_HOSTILE_CREEPS);
    const allies = findCached(room, FIND_MY_CREEPS);
    const structs = findCached(room, FIND_STRUCTURES);
    for (const tower of towers) {
        // Priority 1: attack hostiles
        if (hostiles.length > 0) {
            tower.attack(hostiles[0]);
            continue;
        }
        // Priority 2: heal damaged allies
        const wounded = allies.find(c => c.hits / c.hitsMax < HEAL_THRESHOLD);
        if (wounded) {
            tower.heal(wounded);
            continue;
        }
        // Priority 3: repair low-hit ramparts
        const lowRampart = structs.find(s => s.structureType === STRUCTURE_RAMPART && s.hits < RAMPART_MIN_HITS);
        if (lowRampart) {
            tower.repair(lowRampart);
            continue;
        }
        // Priority 4: repair containers below 50% — they decay at 500 hits/tick without repair
        const lowContainer = structs.find(s => s.structureType === STRUCTURE_CONTAINER && s.hits < s.hitsMax * 0.5);
        if (lowContainer) {
            tower.repair(lowContainer);
            continue;
        }
        // Priority 5: repair degraded roads (only when energy plentiful)
        if (tower.store[RESOURCE_ENERGY] > ROAD_ENERGY_MIN) {
            const degradedRoad = structs.find(s => s.structureType === STRUCTURE_ROAD && s.hits / s.hitsMax < 0.5);
            if (degradedRoad) {
                tower.repair(degradedRoad);
            }
        }
    }
}

// RC8 observer rotation — cycles through known rooms one room per tick.
// Score rooms come first so we keep fresh intel on high-value targets.
function runObserver(observer) {
    var _a;
    const targets = buildTargetList();
    if (targets.length === 0)
        return;
    const idx = (_a = Memory.observerIndex) !== null && _a !== void 0 ? _a : 0;
    observer.observeRoom(targets[idx % targets.length]);
    Memory.observerIndex = (idx + 1) % targets.length;
}
function buildTargetList() {
    var _a, _b, _c;
    // Score rooms first (need fresh intel to route collectors), then all other known rooms
    const scoreRooms = Object.keys((_a = Memory.scoreMap) !== null && _a !== void 0 ? _a : {});
    const staticTargets = (_b = Memory.observerTargets) !== null && _b !== void 0 ? _b : [];
    const knownNonScore = ((_c = Memory.knownRooms) !== null && _c !== void 0 ? _c : []).filter(r => !scoreRooms.includes(r));
    const all = [...new Set([...scoreRooms, ...staticTargets, ...knownNonScore])];
    // Exclude rooms that are currently visible — no need to observe what we can already see
    return all.filter(r => !(r in Game.rooms));
}

// Stationary harvester: parks on the container adjacent to its assigned source and mines
// continuously. Falls back to mobile delivery when no container exists yet.
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
function runStationary(creep, source, container) {
    if (!creep.pos.isEqualTo(container.pos)) {
        creep.moveTo(container.pos, { reusePath: 10 });
        return;
    }
    creep.harvest(source);
    if (creep.store.getFreeCapacity() === 0) {
        creep.transfer(container, RESOURCE_ENERGY);
    }
}
function runMobile(creep, source) {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0)
        creep.memory.working = false;
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0)
        creep.memory.working = true;
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
        else {
            // Spawn/extensions full — dump into controller to keep progressing
            const ctrl = creep.room.controller;
            if (ctrl && creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
                creep.moveTo(ctrl, { reusePath: 5 });
            }
        }
    }
    else {
        if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
            creep.moveTo(source, { reusePath: 5 });
        }
    }
}
function getAssignedSource(creep) {
    var _a;
    if (creep.memory.sourceId) {
        return Game.getObjectById(creep.memory.sourceId);
    }
    const sources = creep.room.find(FIND_SOURCES);
    if (sources.length === 0)
        return null;
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
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
    })[0]) !== null && _a !== void 0 ? _a : null;
}

// Hauler: collects energy from source containers and delivers to spawn/extensions/towers.
// Falls back to upgrading the controller when everything is full — this keeps RC progressing.
function runHauler(creep) {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0)
        creep.memory.working = false;
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0)
        creep.memory.working = true;
    creep.memory.working ? deliver(creep) : collect(creep);
}
function collect(creep) {
    // Fullest source container first
    const container = getBestSourceContainer(creep.room);
    if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(container, { reusePath: 5 });
        }
        return;
    }
    // Dropped energy (overflow when containers are full)
    const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount >= 50,
    });
    if (dropped) {
        if (creep.pickup(dropped) === ERR_NOT_IN_RANGE)
            creep.moveTo(dropped, { reusePath: 3 });
        return;
    }
    // Nothing ready — wait near spawn rather than wandering
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn)
        creep.moveTo(spawn, { reusePath: 20, range: 3 });
}
function deliver(creep) {
    // Priority 1: spawn, extensions, towers — keep combat and spawning capacity full
    const urgent = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
        filter: (s) => {
            if (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) {
                return s.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
            if (s.structureType === STRUCTURE_TOWER) {
                return s.store.getFreeCapacity(RESOURCE_ENERGY) > 200;
            }
            return false;
        },
    });
    if (urgent) {
        if (creep.transfer(urgent, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(urgent, { reusePath: 5 });
        }
        return;
    }
    // Priority 2: storage — long-term energy buffer
    const storage = creep.room.storage;
    if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        if (creep.transfer(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(storage, { reusePath: 5 });
        }
        return;
    }
    // Priority 3: upgrade controller to keep RC progressing
    const ctrl = creep.room.controller;
    if (ctrl && creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
        creep.moveTo(ctrl, { reusePath: 5 });
    }
}
function getBestSourceContainer(room) {
    const sources = room.find(FIND_SOURCES);
    const candidates = [];
    for (const src of sources) {
        const near = src.pos.findInRange(FIND_STRUCTURES, 1, {
            filter: (s) => s.structureType === STRUCTURE_CONTAINER &&
                s.store[RESOURCE_ENERGY] >= 50,
        });
        candidates.push(...near);
    }
    if (candidates.length === 0)
        return null;
    return candidates.reduce((a, b) => a.store[RESOURCE_ENERGY] >= b.store[RESOURCE_ENERGY] ? a : b);
}

// Collector role — moves to Score objects and steps on them for automatic collection.
// Targets are tracked by ID. For non-visible rooms, falls back to the cached position
// from Memory.scoreCache so the creep can navigate cross-room without line-of-sight.
function runCollector(creep) {
    var _a, _b, _c;
    const mem = creep.memory;
    // Validate existing target: clear only when not visible AND cache entry is gone/expired
    if (mem.targetScoreId) {
        const live = Game.getObjectById(mem.targetScoreId);
        const cached = (_a = Memory.scoreCache) === null || _a === void 0 ? void 0 : _a[mem.targetScoreId];
        if (!live && (!cached || cached.expiresAt <= Game.time)) {
            mem.targetScoreId = null;
        }
    }
    // Assign new target
    if (!mem.targetScoreId) {
        mem.targetScoreId = findBestScore(creep);
    }
    if (mem.targetScoreId) {
        // Live object available (room is visible)
        const live = Game.getObjectById(mem.targetScoreId);
        if (live) {
            creep.moveTo(live.pos, { reusePath: 20 });
            return;
        }
        // Non-visible room: navigate to cached position
        const cached = (_b = Memory.scoreCache) === null || _b === void 0 ? void 0 : _b[mem.targetScoreId];
        if (cached) {
            const pos = new RoomPosition(cached.pos.x, cached.pos.y, cached.pos.roomName);
            creep.moveTo(pos, { reusePath: 20 });
            return;
        }
        mem.targetScoreId = null;
    }
    // No known score: patrol toward home room
    const home = (_c = mem.homeRoom) !== null && _c !== void 0 ? _c : creep.room.name;
    creep.moveTo(new RoomPosition(25, 25, home), { reusePath: 50 });
}
function findBestScore(creep) {
    if (typeof FIND_SCORES === 'undefined')
        return null;
    let bestId = null;
    let bestValue = -1;
    // Search currently visible rooms
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        const scores = room.find(FIND_SCORES);
        for (const score of scores) {
            const dist = Game.map.getRoomLinearDistance(creep.room.name, roomName);
            if (dist * 2 > score.ticksToDecay * 0.8)
                continue;
            const urgency = score.ticksToDecay < 500 ? 2 : 1;
            const value = (score.score * urgency) / (dist + 1);
            if (value > bestValue) {
                bestValue = value;
                bestId = score.id;
            }
        }
    }
    // Also search cached entries from non-visible rooms
    if (Memory.scoreCache) {
        for (const id in Memory.scoreCache) {
            const entry = Memory.scoreCache[id];
            if (entry.expiresAt <= Game.time)
                continue;
            if (entry.pos.roomName in Game.rooms)
                continue; // already scanned above
            const dist = Game.map.getRoomLinearDistance(creep.room.name, entry.pos.roomName);
            const ticksLeft = entry.expiresAt - Game.time;
            if (dist * 2 > ticksLeft * 0.8)
                continue;
            const urgency = ticksLeft < 500 ? 2 : 1;
            const value = (entry.value * urgency) / (dist + 1);
            if (value > bestValue) {
                bestValue = value;
                bestId = id;
            }
        }
    }
    return bestId;
}

// Scout role — [MOVE] only. Expands visibility by visiting unexplored adjacent rooms.
// Registers every room it enters in Memory.knownRooms for collectors to use.
function runScout(creep) {
    // Register current room
    if (!Memory.knownRooms)
        Memory.knownRooms = [];
    if (!Memory.knownRooms.includes(creep.room.name)) {
        Memory.knownRooms.push(creep.room.name);
    }
    const target = pickTarget(creep);
    if (!target)
        return;
    const exitDir = creep.room.findExitTo(target);
    if (exitDir === ERR_NO_PATH || exitDir === ERR_INVALID_ARGS)
        return;
    const exit = creep.pos.findClosestByRange(exitDir);
    if (exit)
        creep.moveTo(exit, { reusePath: 50 });
}
function pickTarget(creep) {
    var _a, _b, _c;
    const exits = Game.map.describeExits(creep.room.name);
    if (!exits)
        return null;
    const adjacent = Object.values(exits).filter((r) => !!r);
    const known = (_a = Memory.knownRooms) !== null && _a !== void 0 ? _a : [];
    // Prefer unexplored rooms
    const unexplored = adjacent.filter(r => !known.includes(r));
    if (unexplored.length > 0)
        return unexplored[0];
    // All adjacent known — revisit the room with the oldest (or absent) scoreMap entry.
    // Rooms never seen in scoreMap get tick=0 and are prioritised for revisit.
    const scoreMap = (_b = Memory.scoreMap) !== null && _b !== void 0 ? _b : {};
    return (_c = adjacent.sort((a, b) => { var _a, _b, _c, _d; return ((_b = (_a = scoreMap[a]) === null || _a === void 0 ? void 0 : _a.tick) !== null && _b !== void 0 ? _b : 0) - ((_d = (_c = scoreMap[b]) === null || _c === void 0 ? void 0 : _c.tick) !== null && _d !== void 0 ? _d : 0); })[0]) !== null && _c !== void 0 ? _c : null;
}

// Builder — handles construction sites (containers, extensions, tower, storage).
// Collects from containers to avoid competing with harvesters at source tiles.
// Falls back to direct harvest only when no containers have energy yet.
function runBuilder(creep) {
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }
    if (creep.memory.working) {
        const site = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);
        if (!site) {
            // No construction sites — repair degraded containers and roads before idling
            const damaged = creep.pos.findClosestByPath(FIND_STRUCTURES, {
                filter: (s) => {
                    if (s.structureType === STRUCTURE_CONTAINER)
                        return s.hits < s.hitsMax * 0.5;
                    if (s.structureType === STRUCTURE_ROAD)
                        return s.hits < s.hitsMax * 0.4;
                    return false;
                },
            });
            if (damaged) {
                if (creep.repair(damaged) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(damaged, { reusePath: 5 });
                }
                return;
            }
            // Nothing to repair either — fill spawn
            const spawn = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
                filter: (s) => s.structureType === STRUCTURE_SPAWN &&
                    s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
            });
            if (spawn) {
                if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(spawn, { reusePath: 5 });
                }
            }
            return;
        }
        if (creep.build(site) === ERR_NOT_IN_RANGE) {
            creep.moveTo(site, { reusePath: 5 });
        }
    }
    else {
        collectEnergy(creep);
    }
}
function collectEnergy(creep) {
    // Prefer withdrawing from a container — keeps source tiles free for harvesters
    const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER &&
            s.store[RESOURCE_ENERGY] >= 50,
    });
    if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(container, { reusePath: 5 });
        }
        return;
    }
    // No containers with energy yet — harvest directly as fallback
    const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (source) {
        if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
            creep.moveTo(source, { reusePath: 5 });
        }
    }
}

// Hunter role — [ATTACK×3, MOVE×3] — intercepts enemy collectors near Score rooms.
// Spawned only when hostiles are detected in rooms that have known Scores.
// Targets hostile creeps in rooms that appear in Memory.scoreCache.
function runHunter(creep) {
    const mem = creep.memory;
    // Validate target from previous tick
    if (mem.targetId) {
        const target = Game.getObjectById(mem.targetId);
        if (!target) {
            mem.targetId = null;
        }
        else {
            if (creep.attack(target) === ERR_NOT_IN_RANGE) {
                creep.moveTo(target.pos, { reusePath: 3 });
            }
            return;
        }
    }
    // Scan live room data for a new target
    mem.targetId = findBestTarget();
    // Attack happens next tick once the id is persisted in memory
}
function findBestTarget(creep) {
    var _a;
    // Score rooms are higher priority hunting grounds
    const hotRooms = new Set(Object.values((_a = Memory.scoreCache) !== null && _a !== void 0 ? _a : {}).map(e => e.pos.roomName));
    let bestId = null;
    let bestPriority = -1;
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        const hostiles = room.find(FIND_HOSTILE_CREEPS);
        for (const hostile of hostiles) {
            // Prioritise hostiles in rooms with active Scores
            const priority = hotRooms.has(roomName) ? 2 : 1;
            if (priority > bestPriority) {
                bestPriority = priority;
                bestId = hostile.id;
            }
        }
    }
    return bestId;
}

function loop() {
    var _a;
    // 1. Reset per-tick find() cache (CPU budget: avoids duplicate room.find calls)
    resetTickCache();
    // 2. Clean up dead creeps from memory
    for (const name in Memory.creeps) {
        if (!Game.creeps[name])
            delete Memory.creeps[name];
    }
    // 3. Initialize Memory
    if (!Memory.scoreMap)
        Memory.scoreMap = {};
    if (!Memory.scoreCache)
        Memory.scoreCache = {};
    if (!Memory.knownRooms)
        Memory.knownRooms = [];
    if (!Memory.observerTargets)
        Memory.observerTargets = [];
    if (Memory.observerIndex === undefined)
        Memory.observerIndex = 0;
    // 4. Track scores in all visible rooms (throttled to every 10 ticks inside trackScores)
    for (const roomName in Game.rooms) {
        trackScores(Game.rooms[roomName]);
    }
    // 5. Per-owned-room managers
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        checkRCTransition(room);
        manageConstruction(room);
        manageTowers(room);
        manageSpawns(room);
        // RC8: run observer rotation once per tick
        if (room.memory.observerEnabled) {
            const observers = room.find(FIND_MY_STRUCTURES).filter((s) => s.structureType === STRUCTURE_OBSERVER);
            if (observers.length > 0)
                runObserver(observers[0]);
        }
    }
    // 6. Run creep roles
    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        switch (creep.memory.role) {
            case 'harvester':
                runHarvester(creep);
                break;
            case 'hauler':
                runHauler(creep);
                break;
            case 'collector':
                runCollector(creep);
                break;
            case 'scout':
                runScout(creep);
                break;
            case 'builder':
                runBuilder(creep);
                break;
            case 'hunter':
                runHunter(creep);
                break;
        }
    }
    // 7. Debug log every 100 ticks
    if (Game.time % 100 === 0) {
        const scoreRooms = Object.keys(Memory.scoreMap).join(', ') || 'none';
        const cacheSize = Object.keys(Memory.scoreCache).length;
        console.log(`[season10] tick=${Game.time} score rooms: ${scoreRooms} cached: ${cacheSize}`);
    }
}

exports.loop = loop;
