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
    const wasInMap = !!Memory.scoreMap[room.name];
    for (const score of scores) {
        Memory.scoreCache[score.id] = {
            pos: { x: score.pos.x, y: score.pos.y, roomName: room.name },
            value: score.score,
            expiresAt: Game.time + score.ticksToDecay,
        };
    }
    if (totalScore > 0) {
        Memory.scoreMap[room.name] = { score: totalScore, tick: Game.time };
        if (!wasInMap) {
            console.log(`[scoreTracker] New score room: ${room.name} (${scores.length} scores, total=${totalScore})`);
        }
    }
    else if (Memory.scoreMap[room.name]) {
        delete Memory.scoreMap[room.name];
        console.log(`[scoreTracker] Scores cleared from ${room.name}`);
    }
}

// Season 10 body builder — returns cheapest body that fits the budget.
// Collector bodies use MOVE+TOUGH (no CARRY — Scores are collected by stepping on tile).
// Bodies are returned in Screeps-legal order: TOUGH first, then MOVE last.
function buildCollectorBody(energy) {
    // Speed + carry — CARRY is required for pickup(); MOVE-heavy for fast cross-room travel.
    // 600e: CARRY×2, MOVE×6 — full-road speed, 100 carry
    if (energy >= 600)
        return [CARRY, CARRY, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE];
    // 350e: CARRY×1, MOVE×5 — fast, 50 carry
    if (energy >= 350)
        return [CARRY, MOVE, MOVE, MOVE, MOVE, MOVE];
    // 200e: CARRY×1, MOVE×3 — minimum viable collector
    if (energy >= 200)
        return [CARRY, MOVE, MOVE, MOVE];
    return null;
}
function buildScoutBody(energy) {
    if (energy >= 250)
        return [MOVE, MOVE, MOVE, MOVE, MOVE]; // 1500 tick lifespan
    if (energy >= 50)
        return [MOVE];
    return null;
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
function buildUpgraderBody(energy) {
    if (energy >= 400)
        return [WORK, WORK, CARRY, CARRY, MOVE, MOVE];
    if (energy >= 200)
        return [WORK, CARRY, MOVE];
    return null;
}
function buildDefenderBody(energy) {
    // Melee defender — TOUGH padding + ATTACK DPS + MOVE parity.
    // Parts ordered: TOUGH first, then ATTACK, then MOVE (Screeps requirement).
    if (energy >= 730)
        return [TOUGH, TOUGH, TOUGH, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE]; // 14 parts, 150 DPS
    if (energy >= 390)
        return [TOUGH, TOUGH, ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE]; // 8 parts, 90 DPS
    if (energy >= 260)
        return [ATTACK, ATTACK, MOVE, MOVE]; // minimum viable
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
// Priority: harvesters → scouts → builder → upgrader → haulers → collectors → hunters.
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
    const upgraders = creeps.filter((c) => c.memory.role === 'upgrader').length;
    const hunters = creeps.filter((c) => c.memory.role === 'hunter').length;
    const defenders = creeps.filter((c) => c.memory.role === 'defender').length;
    const level = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 1;
    const mem = room.memory;
    const e = room.energyAvailable;
    // 1. Always maintain minimum harvesters first
    if (harvesters < MIN_HARVESTERS) {
        const body = buildHarvesterBody(e);
        if (body) {
            trySpawn(spawn, 'harvester', body);
            return;
        }
    }
    // 1.5. Spawn defenders when armed hostiles are in the room — higher priority than economy
    {
        const armed = findCached(room, FIND_HOSTILE_CREEPS).filter((h) => h.body.some(p => p.type === ATTACK || p.type === RANGED_ATTACK || p.type === WORK));
        if (armed.length > 0 && defenders < 2) {
            const body = buildDefenderBody(e);
            if (body) {
                trySpawn(spawn, 'defender', body, { homeRoom: room.name });
                return;
            }
        }
    }
    // 2. Keep one builder when there are active construction sites (any RC)
    const hasSites = findCached(room, FIND_CONSTRUCTION_SITES).length > 0;
    if (builders < MAX_BUILDERS && hasSites) {
        const body = buildBuilderBody(e);
        if (body) {
            trySpawn(spawn, 'builder', body);
            return;
        }
    }
    // 3. Always keep one upgrader (controller progress = more spawn capacity)
    if (upgraders < 1) {
        const body = buildUpgraderBody(e);
        if (body) {
            trySpawn(spawn, 'upgrader', body);
            return;
        }
    }
    // 4. Haulers: 1 per source — picks up dropped energy even before containers exist
    const sourceCount = findCached(room, FIND_SOURCES).length;
    if (haulers < sourceCount) {
        const body = buildHaulerBody(e);
        if (body) {
            trySpawn(spawn, 'hauler', body);
            return;
        }
    }
    // 5. Scout — after production roles; [MOVE×5] lasts 1500 ticks so low churn
    if (scouts === 0) {
        const body = buildScoutBody(e);
        if (body) {
            trySpawn(spawn, 'scout', body);
            return;
        }
    }
    // 6. Collectors
    const quota = resolveCollectorQuota(room, level, mem);
    if (collectors < quota) {
        const body = buildCollectorBody(e);
        if (body) {
            trySpawn(spawn, 'collector', body, { homeRoom: room.name });
            return;
        }
    }
    // 7. Hunter if enemy collectors detected near Score rooms (RC3+)
    if (level >= 3 && hunters < 1 && enemiesNearScores()) {
        const body = buildHunterBody(e);
        if (body)
            trySpawn(spawn, 'hunter', body);
    }
}
function resolveCollectorQuota(room, level, mem) {
    if (mem.dynamicCollectorQuota)
        return getCollectorQuota(room);
    if (mem.collectorQuota !== undefined)
        return mem.collectorQuota;
    // Defaults by level — keep economy-first at low RC
    if (level >= 5)
        return 5;
    if (level >= 3)
        return 3;
    if (level >= 2)
        return 2;
    return 2; // RC1: two collectors while waiting for containers/builder
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
    const result = spawn.spawnCreep(body, name, { memory: { role, working: false, ...extraMem } });
    if (result === OK) {
        const cost = body.reduce((s, p) => s + BODYPART_COST[p], 0);
        console.log(`[season10] Spawning ${name} [${body.join(',')}] (${cost}e)`);
    }
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
    console.log(`[${room.name}] RC${level} reached at tick ${Game.time}`);
    switch (level) {
        case 1:
            room.memory.spawnScoutNext = true;
            console.log(`[${room.name}] RC1 — queuing scout`);
            break;
        case 2:
            if (!Memory.scoreCache)
                Memory.scoreCache = {};
            console.log(`[${room.name}] RC2 — score cache enabled`);
            break;
        case 3:
            room.memory.collectorQuota = 3;
            console.log(`[${room.name}] RC3 — collector quota → 3`);
            break;
        case 4:
            room.memory.dynamicCollectorQuota = true;
            console.log(`[${room.name}] RC4 — dynamic collector quota enabled`);
            break;
        case 8:
            room.memory.observerEnabled = true;
            const exits = Game.map.describeExits(room.name);
            if (exits) {
                const adjacent = Object.values(exits).filter((r) => !!r);
                Memory.observerTargets = [...new Set([...((_a = Memory.observerTargets) !== null && _a !== void 0 ? _a : []), ...adjacent])];
                console.log(`[${room.name}] RC8 — observer enabled, targets: ${adjacent.join(', ')}`);
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
    if (level < 1)
        return;
    placeSourceContainers(room); // containers available at RC1
    placeSpawnRamparts(room); // ramparts over spawn/towers — available from RC1, critical for survival
    if (level >= 2)
        placeExtensions(room); // gated behind container completion internally
    if (level >= 3)
        placeTowerSite(room);
    if (level >= 3)
        placeSourceRoads(room);
    if (level >= 4)
        placeStorageSite(room);
}
function placeSpawnRamparts(room) {
    // Place ramparts on spawn and any towers — structures under ramparts take no damage.
    // Ramparts decay at 300 hits/tick; tower manager keeps them above RAMPART_MIN_HITS.
    const targets = [
        ...findCached(room, FIND_MY_SPAWNS),
        ...findCached(room, FIND_MY_STRUCTURES).filter((s) => s.structureType === STRUCTURE_TOWER),
    ];
    for (const target of targets) {
        const { x, y } = target.pos;
        const hasRampart = room.lookForAt(LOOK_STRUCTURES, x, y).some((s) => s.structureType === STRUCTURE_RAMPART);
        if (hasRampart)
            continue;
        const hasSite = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y).some((s) => s.structureType === STRUCTURE_RAMPART);
        if (!hasSite)
            room.createConstructionSite(x, y, STRUCTURE_RAMPART);
    }
}
function placeSourceContainers(room) {
    const mem = room.memory;
    const sources = findCached(room, FIND_SOURCES);
    const allStructures = findCached(room, FIND_STRUCTURES);
    const existingContainers = allStructures.filter((s) => s.structureType === STRUCTURE_CONTAINER);
    const existingSites = findCached(room, FIND_CONSTRUCTION_SITES).filter((s) => s.structureType === STRUCTURE_CONTAINER);
    // If already fully covered, skip (re-validate every 201 ticks in case containers decayed)
    const allCovered = sources.every((source) => {
        const { x, y } = source.pos;
        return [...existingContainers, ...existingSites].some((s) => Math.abs(s.pos.x - x) <= CONTAINER_RANGE && Math.abs(s.pos.y - y) <= CONTAINER_RANGE);
    });
    if (allCovered && mem.containerSitesPlaced && Game.time % 201 !== 0)
        return;
    if (allCovered) {
        mem.containerSitesPlaced = true;
        return;
    }
    // Reset flag — we have uncovered sources
    mem.containerSitesPlaced = false;
    for (const source of sources) {
        const { x, y } = source.pos;
        const alreadyHas = [...existingContainers, ...existingSites].some((s) => Math.abs(s.pos.x - x) <= CONTAINER_RANGE && Math.abs(s.pos.y - y) <= CONTAINER_RANGE);
        if (alreadyHas)
            continue;
        // Try tiles adjacent to source, skip walls
        const candidates = [
            [x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y],
            [x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1], [x + 1, y + 1],
        ];
        for (const [cx, cy] of candidates) {
            if (cx < 1 || cx > 48 || cy < 1 || cy > 48)
                continue;
            if (room.lookForAt(LOOK_TERRAIN, cx, cy)[0] === 'wall')
                continue;
            if (room.lookForAt(LOOK_STRUCTURES, cx, cy).length > 0)
                continue;
            if (room.lookForAt(LOOK_CONSTRUCTION_SITES, cx, cy).length > 0)
                continue;
            if (room.createConstructionSite(cx, cy, STRUCTURE_CONTAINER) === OK) {
                console.log(`[season10] Container site placed near source in ${room.name}`);
                break;
            }
        }
    }
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
    // Honeycomb layout: place extensions on tiles that share spawn's (x+y) parity.
    // Opposite-parity tiles become roads, giving every extension road access.
    // Candidates are sorted by Chebyshev distance from spawn so we fill inward-out.
    const spawnParity = (spawn.pos.x + spawn.pos.y) % 2;
    const candidates = []; // [dist, x, y]
    for (let radius = 2; radius <= 9; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius)
                    continue; // ring only
                const x = spawn.pos.x + dx;
                const y = spawn.pos.y + dy;
                if (x < 2 || x > 47 || y < 2 || y > 47)
                    continue;
                if ((x + y) % 2 !== spawnParity)
                    continue; // honeycomb parity
                candidates.push([radius, x, y]);
            }
        }
    }
    for (const [, x, y] of candidates) {
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
    if (room.createConstructionSite(25, 23, STRUCTURE_TOWER) === OK) {
        mem.towerSitePlaced = true;
        console.log(`[season10] Tower site placed in ${room.name}`);
    }
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
    if (room.createConstructionSite(25, 25, STRUCTURE_STORAGE) === OK) {
        mem.storageSitePlaced = true;
        console.log(`[season10] Storage site placed in ${room.name}`);
    }
}

// Tower logic — runs every tick for each tower in an owned room.
// Priority (per RC strategy Part 5):
//   0. Activate safe mode if under attack with no viable defense
//   1. Attack most dangerous hostile creep
//   2. Heal any allied creep below 80% hits
//   3. Repair any rampart below 100,000 hits
//   4. Repair containers below 50% hits (prevents decay)
//   5. Repair any road below 50% hits (only if tower energy > 700)
const HEAL_THRESHOLD = 0.8;
const RAMPART_MIN_HITS = 100000;
const ROAD_ENERGY_MIN = 700;
// Body parts that can deal damage or destroy structures
const DANGEROUS_PARTS = new Set([ATTACK, RANGED_ATTACK, WORK]);
function getDps(creep) {
    let dps = 0;
    for (const part of creep.body) {
        if (part.type === ATTACK)
            dps += 30;
        if (part.type === RANGED_ATTACK)
            dps += 10;
        if (part.type === WORK)
            dps += 2; // dismantling
    }
    return dps;
}
function tryActivateSafeMode(room, hostiles) {
    var _a;
    const ctrl = room.controller;
    if (!ctrl || !ctrl.my)
        return;
    if (ctrl.safeMode || ctrl.safeModeCooldown)
        return;
    if (((_a = ctrl.safeModeAvailable) !== null && _a !== void 0 ? _a : 0) <= 0)
        return;
    // Only trigger for hostiles that can actually destroy things
    const armed = hostiles.filter(h => h.body.some(p => DANGEROUS_PARTS.has(p.type)));
    if (armed.length === 0)
        return;
    const hasTower = findCached(room, FIND_MY_STRUCTURES)
        .some((s) => s.structureType === STRUCTURE_TOWER);
    // Trigger if: no tower yet, OR spawn is below half health
    let trigger = !hasTower;
    if (!trigger) {
        const spawn = findCached(room, FIND_MY_SPAWNS)[0];
        if (spawn && spawn.hits < spawn.hitsMax * 0.5)
            trigger = true;
    }
    if (trigger) {
        ctrl.activateSafeMode();
        console.log(`[season10] SAFE MODE activated in ${room.name} — ${armed.length} armed hostiles`);
    }
}
function manageTowers(room) {
    const towers = findCached(room, FIND_MY_STRUCTURES).filter((s) => s.structureType === STRUCTURE_TOWER);
    const hostiles = findCached(room, FIND_HOSTILE_CREEPS);
    const allies = findCached(room, FIND_MY_CREEPS);
    const structs = findCached(room, FIND_STRUCTURES);
    // Priority 0: safe mode check runs even when there are no towers
    if (hostiles.length > 0)
        tryActivateSafeMode(room, hostiles);
    if (towers.length === 0)
        return;
    // Pick the most dangerous target once, reused by all towers this tick
    const target = hostiles.length > 0
        ? hostiles.reduce((best, h) => getDps(h) > getDps(best) ? h : best)
        : null;
    for (const tower of towers) {
        // Priority 1: attack most dangerous hostile
        if (target) {
            tower.attack(target);
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

// Screeps direction offset tables — indices 1–8 match the direction constants
// TOP=1, TOP_RIGHT=2, RIGHT=3, BOTTOM_RIGHT=4, BOTTOM=5, BOTTOM_LEFT=6, LEFT=7, TOP_LEFT=8
const DIR_DX = [0, 0, 1, 1, 1, 0, -1, -1, -1];
const DIR_DY = [0, -1, -1, 0, 1, 1, 1, 0, -1];
// Track which creeps have already been issued a move command via moveTo this tick.
// shoveBlocker uses this to decide whether to shove a blocker:
//  - Not yet moved this tick → idle or will move after us → safe to shove (last move() wins)
//  - Already moved this tick → has a pending direction → skip shove; Screeps' native
//    swap mechanic handles two creeps moving into each other's tiles in the same tick.
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
/**
 * Drop-in replacement for creep.moveTo() with traffic management.
 *
 * Two improvements over vanilla moveTo:
 *  1. ignoreCreeps:true — pathfinder picks the geometrically shortest path
 *     instead of routing around creep clusters, which is the primary cause of
 *     spawn-area jams.
 *  2. Shove — if a friendly idle creep occupies the tile directly between us
 *     and our target, we push it in that same direction this tick so it yields
 *     the tile before the engine resolves movement.
 */
function moveTo(creep, target, opts = {}) {
    var _a;
    markMoved(creep.name);
    const result = creep.moveTo(target, {
        reusePath: 3,
        ignoreCreeps: true,
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
    const nx = creep.pos.x + DIR_DX[dir];
    const ny = creep.pos.y + DIR_DY[dir];
    if (nx < 1 || nx > 48 || ny < 1 || ny > 48)
        return;
    const blocker = new RoomPosition(nx, ny, creep.room.name)
        .lookFor(LOOK_CREEPS)
        .find(c => c.my && c.name !== creep.name);
    if (!blocker || blocker.fatigue > 0)
        return;
    // Skip creeps that have already issued a move command this tick via our moveTo wrapper.
    // Their direction is committed; shoving them would be overridden by their own move anyway,
    // and in a head-on corridor Screeps' native swap mechanic resolves it without help.
    // Creeps that haven't called moveTo yet (truly idle: just delivered, parked at container,
    // waiting at controller) haven't committed a direction and are safe to displace.
    if (hasMoved(blocker.name))
        return;
    blocker.move(dir);
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
        return;
    }
    const hasHauler = creep.room.find(FIND_MY_CREEPS).some((c) => c.memory.role === 'hauler');
    if (hasHauler) {
        // Hauler is active — stay at source and drop; hauler will collect
        runMobile(creep, source);
    }
    else {
        // No hauler yet — deliver manually so spawn/controller don't starve
        runMobileDeliver(creep, source);
    }
}
function runStationary(creep, source, container) {
    if (!creep.pos.isEqualTo(container.pos)) {
        moveTo(creep, container.pos, { reusePath: 10 });
        return;
    }
    creep.harvest(source);
    if (creep.store.getFreeCapacity() === 0) {
        creep.transfer(container, RESOURCE_ENERGY);
    }
}
// No container, no hauler: deliver to spawn/controller manually until hauler spawns.
function runMobileDeliver(creep, source) {
    const mem = creep.memory;
    if (mem.working && creep.store[RESOURCE_ENERGY] === 0)
        mem.working = false;
    if (!mem.working && creep.store.getFreeCapacity() === 0)
        mem.working = true;
    if (mem.working) {
        const target = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
            filter: (s) => (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
                s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        });
        if (target) {
            if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                moveTo(creep, target, { reusePath: 5 });
            }
            return;
        }
        const ctrl = creep.room.controller;
        if (ctrl && creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
            moveTo(creep, ctrl, { reusePath: 5 });
        }
        return;
    }
    if (creep.harvest(source) === ERR_NOT_IN_RANGE)
        moveTo(creep, source, { reusePath: 5 });
}
// No container, hauler present: stay at source and drop energy on the ground.
function runMobile(creep, source) {
    if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
        moveTo(creep, source, { reusePath: 10 });
    }
}
function getAssignedSource(creep) {
    var _a, _b;
    const sources = creep.room.find(FIND_SOURCES);
    if (sources.length === 0)
        return null;
    // Count existing assignments, excluding this creep to get a fair comparison
    const counts = new Map();
    for (const c of creep.room.find(FIND_MY_CREEPS)) {
        if (c.memory.role === 'harvester' && c.memory.sourceId && c.name !== creep.name) {
            counts.set(c.memory.sourceId, ((_a = counts.get(c.memory.sourceId)) !== null && _a !== void 0 ? _a : 0) + 1);
        }
    }
    // Rebalance: if our source has 2+ more harvesters than the least-loaded one, re-assign
    if (creep.memory.sourceId) {
        const currentCount = (_b = counts.get(creep.memory.sourceId)) !== null && _b !== void 0 ? _b : 0;
        const minCount = sources.reduce((min, src) => { var _a; return Math.min(min, (_a = counts.get(src.id)) !== null && _a !== void 0 ? _a : 0); }, Infinity);
        if (currentCount - minCount < 2) {
            return Game.getObjectById(creep.memory.sourceId);
        }
        creep.memory.sourceId = undefined;
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
    // Eager transition: skip the idle tick when a phase just completed.
    // Without this, the working-state flip only fires at the top of the NEXT tick,
    // leaving the creep standing at spawn/container for one wasted tick.
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
        collect(creep);
    }
    else if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
        deliver(creep);
    }
}
function collect(creep) {
    // Fullest source container first
    const container = getBestSourceContainer(creep.room);
    if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, container, { reusePath: 5 });
        }
        return;
    }
    // Dropped energy (overflow when containers are full)
    const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount >= 50,
    });
    if (dropped) {
        if (creep.pickup(dropped) === ERR_NOT_IN_RANGE)
            moveTo(creep, dropped, { reusePath: 3 });
        return;
    }
    // Nothing ready — wait near spawn rather than wandering
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn)
        moveTo(creep, spawn, { reusePath: 20, range: 3 });
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
            moveTo(creep, urgent, { reusePath: 5 });
        }
        return;
    }
    // Priority 2: upgrade controller — RC progression unlocks more spawning capacity
    const ctrl = creep.room.controller;
    if (ctrl) {
        if (creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE)
            moveTo(creep, ctrl, { reusePath: 5 });
        return;
    }
    // Priority 3: storage overflow
    const storage = creep.room.storage;
    if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        if (creep.transfer(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, storage, { reusePath: 5 });
        }
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
            // Try pickup() first; if out of range, move onto the tile
            const result = creep.pickup(live);
            if (result === ERR_NOT_IN_RANGE) {
                moveTo(creep, live.pos, { reusePath: 20, range: 0 });
            }
            else if (result === OK) {
                mem.targetScoreId = null; // collected — pick next target next tick
            }
            return;
        }
        // Non-visible room: navigate to cached position
        const cached = (_b = Memory.scoreCache) === null || _b === void 0 ? void 0 : _b[mem.targetScoreId];
        if (cached) {
            const pos = new RoomPosition(cached.pos.x, cached.pos.y, cached.pos.roomName);
            moveTo(creep, pos, { reusePath: 20 });
            return;
        }
        mem.targetScoreId = null;
    }
    // No cached score ID: move toward the highest-value room in scoreMap
    // so we get line-of-sight and the scoreTracker can populate the cache.
    if (Memory.scoreMap) {
        let bestRoom = null;
        let bestVal = 0;
        for (const roomName in Memory.scoreMap) {
            const entry = Memory.scoreMap[roomName];
            const dist = Game.map.getRoomLinearDistance(creep.room.name, roomName);
            const value = entry.score / (dist + 1);
            if (value > bestVal) {
                bestVal = value;
                bestRoom = roomName;
            }
        }
        if (bestRoom) {
            moveTo(creep, new RoomPosition(25, 25, bestRoom), { reusePath: 30 });
            return;
        }
    }
    // Truly nothing known: patrol toward home room
    const home = (_c = mem.homeRoom) !== null && _c !== void 0 ? _c : creep.room.name;
    moveTo(creep, new RoomPosition(25, 25, home), { reusePath: 50 });
}
function findBestScore(creep) {
    var _a, _b, _c, _d;
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
            const contested = ((_b = (_a = Memory.roomIntel) === null || _a === void 0 ? void 0 : _a[roomName]) === null || _b === void 0 ? void 0 : _b.hasHostiles) ? 2 : 1;
            const urgency = (score.ticksToDecay < 500 ? 2 : 1) * contested;
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
            const contested = ((_d = (_c = Memory.roomIntel) === null || _c === void 0 ? void 0 : _c[entry.pos.roomName]) === null || _d === void 0 ? void 0 : _d.hasHostiles) ? 2 : 1;
            const urgency = (ticksLeft < 500 ? 2 : 1) * contested;
            const value = (entry.value * urgency) / (dist + 1);
            if (value > bestValue) {
                bestValue = value;
                bestId = id;
            }
        }
    }
    return bestId;
}

// Scout role — [MOVE] only. Expands visibility and records room intel (scores, hostiles).
// Priority: unexplored non-highway rooms → known score rooms → stalest known room.
function runScout(creep) {
    if (!Memory.knownRooms)
        Memory.knownRooms = [];
    if (!Memory.roomIntel)
        Memory.roomIntel = {};
    if (!Memory.knownRooms.includes(creep.room.name)) {
        Memory.knownRooms.push(creep.room.name);
    }
    recordRoomIntel(creep);
    // Collect scores in current room — try pickup() first, move onto tile if out of range
    if (typeof FIND_SCORES !== 'undefined') {
        const scores = creep.room.find(FIND_SCORES);
        if (scores.length > 0) {
            const closest = creep.pos.findClosestByRange(scores);
            if (closest) {
                const result = creep.pickup(closest);
                if (result === ERR_NOT_IN_RANGE) {
                    moveTo(creep, closest.pos, { reusePath: 5, range: 0 });
                }
                return;
            }
        }
    }
    const target = pickTarget(creep);
    if (!target)
        return;
    const exitDir = creep.room.findExitTo(target);
    if (exitDir === ERR_NO_PATH || exitDir === ERR_INVALID_ARGS)
        return;
    const exit = creep.pos.findClosestByRange(exitDir);
    if (exit)
        moveTo(creep, exit, { reusePath: 50 });
}
function recordRoomIntel(creep) {
    const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
    const scoreCount = typeof FIND_SCORES !== 'undefined'
        ? creep.room.find(FIND_SCORES).length
        : 0;
    Memory.roomIntel[creep.room.name] = {
        tick: Game.time,
        hasHostiles: hostiles.length > 0,
        scoreCount,
    };
}
function isHighway(roomName) {
    const m = roomName.match(/[EW](\d+)[NS](\d+)/);
    if (!m)
        return false;
    return parseInt(m[1]) % 10 === 0 || parseInt(m[2]) % 10 === 0;
}
function pickTarget(creep) {
    var _a, _b, _c;
    const exits = Game.map.describeExits(creep.room.name);
    if (!exits)
        return null;
    const candidates = Object.values(exits)
        .filter((r) => !!r)
        .filter(r => !isHighway(r));
    if (candidates.length === 0)
        return null;
    const known = (_a = Memory.knownRooms) !== null && _a !== void 0 ? _a : [];
    const scoreMap = (_b = Memory.scoreMap) !== null && _b !== void 0 ? _b : {};
    // Priority 1: unexplored non-highway rooms (discover new score sources)
    const unexplored = candidates.filter(r => !known.includes(r));
    if (unexplored.length > 0)
        return unexplored[0];
    // Priority 2: known rooms with active scores (keep them visible for collectors)
    const scoreRooms = candidates.filter(r => { var _a, _b; return ((_b = (_a = scoreMap[r]) === null || _a === void 0 ? void 0 : _a.score) !== null && _b !== void 0 ? _b : 0) > 0; });
    if (scoreRooms.length > 0) {
        return scoreRooms.sort((a, b) => { var _a, _b, _c, _d; return ((_b = (_a = scoreMap[b]) === null || _a === void 0 ? void 0 : _a.score) !== null && _b !== void 0 ? _b : 0) - ((_d = (_c = scoreMap[a]) === null || _c === void 0 ? void 0 : _c.score) !== null && _d !== void 0 ? _d : 0); })[0];
    }
    // Priority 3: stalest known room (maintain map freshness)
    return (_c = candidates.sort((a, b) => { var _a, _b, _c, _d; return ((_b = (_a = scoreMap[a]) === null || _a === void 0 ? void 0 : _a.tick) !== null && _b !== void 0 ? _b : 0) - ((_d = (_c = scoreMap[b]) === null || _c === void 0 ? void 0 : _c.tick) !== null && _d !== void 0 ? _d : 0); })[0]) !== null && _c !== void 0 ? _c : null;
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
                    moveTo(creep, damaged, { reusePath: 5 });
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
                    moveTo(creep, spawn, { reusePath: 5 });
                }
            }
            return;
        }
        if (creep.build(site) === ERR_NOT_IN_RANGE) {
            moveTo(creep, site, { reusePath: 5 });
        }
    }
    else {
        collectEnergy(creep);
        // Eager transition: if collection just filled us, immediately start moving
        // toward the build site instead of idling at the collection point for one tick.
        if (creep.store.getFreeCapacity() === 0) {
            creep.memory.working = true;
            const site = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);
            if (site && creep.build(site) === ERR_NOT_IN_RANGE) {
                moveTo(creep, site, { reusePath: 5 });
            }
        }
    }
}
function collectEnergy(creep) {
    // 1. Dropped energy — scan room directly (findClosestByPath filter is unreliable in-engine)
    const allDropped = creep.room.find(FIND_DROPPED_RESOURCES, {
        filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount >= 30,
    });
    const dropped = allDropped.length > 0
        ? allDropped.reduce((a, b) => a.amount >= b.amount ? a : b)
        : null;
    if (dropped) {
        if (creep.pickup(dropped) === ERR_NOT_IN_RANGE)
            moveTo(creep, dropped, { reusePath: 3 });
        return;
    }
    // 2. Container with energy
    const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER &&
            s.store[RESOURCE_ENERGY] >= 50,
    });
    if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, container, { reusePath: 5 });
        }
        return;
    }
    // 3. Harvest directly as last resort
    const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (source) {
        if (creep.harvest(source) === ERR_NOT_IN_RANGE)
            moveTo(creep, source, { reusePath: 5 });
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
                moveTo(creep, target.pos, { reusePath: 3 });
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

function runUpgrader(creep) {
    const mem = creep.memory;
    if (mem.working && creep.store[RESOURCE_ENERGY] === 0)
        mem.working = false;
    if (!mem.working && creep.store.getFreeCapacity() === 0)
        mem.working = true;
    if (mem.working) {
        const ctrl = creep.room.controller;
        if (!ctrl)
            return;
        if (creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
            moveTo(creep, ctrl, { reusePath: 10 });
        }
        return;
    }
    // Prefer container near a source (most energy-dense pickup)
    const container = creep.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER &&
            s.store[RESOURCE_ENERGY] > 0,
    });
    if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            moveTo(creep, container, { reusePath: 5 });
        }
        return;
    }
    // No containers yet — pick up dropped energy (harvesters drop it at source)
    const allDropped = creep.room.find(FIND_DROPPED_RESOURCES, {
        filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount > 20,
    });
    const dropped = allDropped.length > 0
        ? allDropped.reduce((a, b) => a.amount >= b.amount ? a : b)
        : null;
    if (dropped) {
        if (creep.pickup(dropped) === ERR_NOT_IN_RANGE)
            moveTo(creep, dropped, { reusePath: 5 });
        return;
    }
    // Nothing available — wait near sources
    const source = creep.pos.findClosestByRange(FIND_SOURCES);
    if (source)
        moveTo(creep, source, { reusePath: 20, range: 2 });
}

// Defender role — [TOUGH×N, ATTACK×N, MOVE×N] — guards the home room.
// Spawned when armed hostiles enter the home room. Idles near spawn when quiet.
function runDefender(creep) {
    var _a;
    const homeRoom = (_a = creep.memory.homeRoom) !== null && _a !== void 0 ? _a : creep.room.name;
    // Return home if pushed out
    if (creep.room.name !== homeRoom) {
        const pos = new RoomPosition(25, 25, homeRoom);
        moveTo(creep, pos, { range: 20 });
        return;
    }
    const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
    if (hostiles.length === 0) {
        // Idle near spawn — don't block roads
        const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
        if (spawn && creep.pos.getRangeTo(spawn) > 4) {
            moveTo(creep, spawn.pos, { range: 3 });
        }
        return;
    }
    // Prioritize attackers/dismantlers over scouts
    const armed = hostiles.filter(h => h.body.some(p => p.type === ATTACK || p.type === RANGED_ATTACK || p.type === WORK));
    const target = creep.pos.findClosestByPath(armed.length > 0 ? armed : hostiles);
    if (!target)
        return;
    if (creep.attack(target) === ERR_NOT_IN_RANGE) {
        moveTo(creep, target.pos, { reusePath: 2 });
    }
}

function loop() {
    var _a, _b, _c, _d, _e, _f, _g;
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
    if (!Memory.roomIntel)
        Memory.roomIntel = {};
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
            case 'upgrader':
                runUpgrader(creep);
                break;
            case 'defender':
                runDefender(creep);
                break;
        }
    }
    // 7. Stats dump every 50 ticks
    if (Game.time % 50 === 0) {
        for (const roomName in Game.rooms) {
            const room = Game.rooms[roomName];
            if (!((_b = room.controller) === null || _b === void 0 ? void 0 : _b.my))
                continue;
            const allCreeps = Object.values(Game.creeps).filter(c => c.room.name === roomName);
            const counts = {};
            for (const c of allCreeps) {
                counts[c.memory.role] = ((_c = counts[c.memory.role]) !== null && _c !== void 0 ? _c : 0) + 1;
            }
            const topScoreRooms = Object.entries((_d = Memory.scoreMap) !== null && _d !== void 0 ? _d : {})
                .sort((a, b) => b[1].score - a[1].score)
                .slice(0, 3)
                .map(([r, d]) => `${r}(${d.score})`);
            console.log(`=== season10:stats:${roomName}:${Game.time} ===`);
            console.log(JSON.stringify({
                tick: Game.time,
                rcl: (_e = room.controller) === null || _e === void 0 ? void 0 : _e.level,
                energy: { avail: room.energyAvailable, cap: room.energyCapacityAvailable },
                creeps: counts,
                totalCreeps: allCreeps.length,
                scoreRooms: Object.keys((_f = Memory.scoreMap) !== null && _f !== void 0 ? _f : {}).length,
                topScores: topScoreRooms,
                cachedScores: Object.keys((_g = Memory.scoreCache) !== null && _g !== void 0 ? _g : {}).length,
            }));
        }
    }
}

exports.loop = loop;
