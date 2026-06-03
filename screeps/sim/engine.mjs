// Single simulation run with optional per-run noise.
// Call simulateOnce() to step a game state forward N ticks using heuristic math.

import * as H from './heuristics.mjs';
import { loadCalibration } from './calibrate.mjs';

// ─── Noise ────────────────────────────────────────────────────────────────────

function randn(mu = 1, sigma = 0.12) {
  const u1 = Math.max(1e-10, Math.random());
  const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * Math.random());
  return Math.max(0.55, Math.min(1.45, mu + sigma * z));
}

function sampleNoise() {
  return {
    income:   randn(1, 0.12),  // ±12% energy harvest efficiency
    hauler:   randn(1, 0.15),  // ±15% hauler delivery efficiency
    lifespan: randn(1, 0.10),  // ±10% creep lifespan
    spawn:    randn(1, 0.05),  // ±5%  spawn speed
    upgrade:  randn(1, 0.08),  // ±8%  upgrade rate
    build:    randn(1, 0.20),  // ±20% build rate
  };
}

// ─── Build resolution ─────────────────────────────────────────────────────────

// Determine what structure builders should work on next given a priority mode.
function resolveBuildTarget(s, buildPriority) {
  const extensions  = s.structs.extensions  ?? 0;
  const containers  = s.structs.containers  ?? 0;
  const roads       = s.structs.roads       ?? 0;
  const towers      = s.structs.towers      ?? 0;
  const storage     = s.structs.storage     ?? 0;
  const maxExts     = H.extensionsAtRcl(s.rcl);
  const maxTowers   = s.rcl >= 3 ? 1 : 0;
  const storageAvail = s.rcl >= H.STORAGE_UNLOCK_RCL && !storage;

  switch (buildPriority) {
    case 'containers':
      if (containers < 2)       return 'containers';
      if (extensions < maxExts) return 'extensions';
      if (roads < 25)           return 'roads';
      if (towers < maxTowers)   return 'towers';
      if (storageAvail)         return 'storage';
      return null;

    case 'roads':
      if (roads < 10)           return 'roads';    // critical path roads first
      if (containers < 2)       return 'containers';
      if (extensions < maxExts) return 'extensions';
      if (roads < 25)           return 'roads';    // finish remaining roads
      if (towers < maxTowers)   return 'towers';
      if (storageAvail)         return 'storage';
      return null;

    case 'towers':
      if (towers < maxTowers)   return 'towers';
      if (extensions < maxExts) return 'extensions';
      if (containers < 2)       return 'containers';
      if (roads < 25)           return 'roads';
      if (storageAvail)         return 'storage';
      return null;

    default: // 'extensions'
      if (extensions < maxExts) return 'extensions';
      if (containers < 2)       return 'containers';
      if (roads < 25)           return 'roads';
      if (towers < maxTowers)   return 'towers';
      if (storageAvail)         return 'storage';
      return null;
  }
}

const BUILD_COSTS = {
  extensions: H.EXTENSION_COST,
  containers: H.CONTAINER_COST,
  roads:      H.ROAD_COST,
  towers:     H.TOWER_COST,
  storage:    H.STORAGE_COST,
};

// Apply buildPower toward the current build target, completing structures as progress accumulates.
// Per-target progress buckets prevent cross-target contamination when the target changes.
function processBuild(s, buildPower, buildTarget) {
  const cost = BUILD_COSTS[buildTarget];
  if (!cost) return;

  s._buildProgressByTarget ??= {};
  s._buildProgressByTarget[buildTarget] = (s._buildProgressByTarget[buildTarget] ?? 0) + buildPower;

  const maxExts   = H.extensionsAtRcl(s.rcl);
  const maxTowers = s.rcl >= 3 ? 1 : 0;

  while (s._buildProgressByTarget[buildTarget] >= cost) {
    s._buildProgressByTarget[buildTarget] -= cost;

    if (buildTarget === 'extensions' && (s.structs.extensions ?? 0) < maxExts) {
      s.structs.extensions++;
      s.energy.cap += 50;  // each extension adds 50 to spawn capacity

    } else if (buildTarget === 'containers' && s.structs.containers < 2) {
      s.structs.containers++;
      // containers are a separate energy pool in the two-channel model — don't add to spawn cap

    } else if (buildTarget === 'roads' && s.structs.roads < 25) {
      s.structs.roads++;

    } else if (buildTarget === 'towers' && s.structs.towers < maxTowers) {
      s.structs.towers++;

    } else if (buildTarget === 'storage' && !s.structs.storage) {
      s.structs.storage = 1;
      s.energy.cap += H.STORAGE_CAP_BONUS;

    } else {
      // Target saturated — drain remaining progress
      s._buildProgressByTarget[buildTarget] = 0;
      break;
    }
  }
}

// ─── Spawn decision ───────────────────────────────────────────────────────────

function canAfford(role, avail) {
  const cost = H.ROLE_SPEC[role]?.cost ?? 200;
  return avail >= cost ? role : null;
}

// budget override: when called from the multi-spawn loop, use remaining spawnBudget
// (not s.energy.avail, which may be near 0 after earlier spawns in the same step)
export function decideNextSpawn(s, strategy, budget = null) {
  const avail        = budget ?? (s.energy?.avail ?? 0);
  const rcl          = s.rcl ?? 2;
  const bottleneck   = H.detectBottleneck(s);
  const harvesters   = s.creeps.harvester   ?? 0;
  const haulers      = s.creeps.hauler      ?? 0;
  const upgraders    = s.creeps.upgrader    ?? 0;
  const warriors     = s.creeps.warrior     ?? 0;
  const builders     = s.creeps.builder     ?? 0;
  const remoteMiners = s.creeps.remoteMiner ?? 0;
  const couriers     = s.creeps.courier     ?? 0;

  // RCL-aware creep caps — scale economy and upgrader ceilings as colony grows
  const maxHarvesters = rcl >= 4 ? 6  : rcl >= 3 ? 4  : 3;
  const maxHaulers    = rcl >= 4 ? 5  : rcl >= 3 ? 3  : 2;
  const maxUpgraders  = rcl >= 5 ? 15 : rcl >= 4 ? 10 : rcl >= 3 ? 8 : 5;

  if (strategy === 'upgradeRush') {
    if (harvesters < maxHarvesters - 1) return canAfford('harvester', avail);
    if (haulers    < maxHaulers - 1)    return canAfford('hauler',    avail);
    if (upgraders  < maxUpgraders)      return canAfford('upgrader',  avail);
    return null;  // all targets met; don't over-spawn
  }

  if (strategy === 'economyStack') {
    if (harvesters < maxHarvesters + 2) return canAfford('harvester', avail);
    if (haulers    < maxHaulers    + 1) return canAfford('hauler',    avail);
    if (upgraders  < maxUpgraders  - 2) return canAfford('upgrader',  avail);
    return null;  // all targets met; excess haulers crowd out upgrader replacement
  }

  if (strategy === 'military') {
    if (harvesters < maxHarvesters - 1) return canAfford('harvester', avail);
    if (haulers    < maxHaulers    - 1) return canAfford('hauler',    avail);
    if (warriors   < 4)                 return canAfford('warrior',   avail);
    if (upgraders  < maxUpgraders  - 3) return canAfford('upgrader',  avail);
    return null;
  }

  if (strategy === 'remoteMiner') {
    // Economy base first, then invest in remote mining infrastructure
    if (harvesters   < maxHarvesters)    return canAfford('harvester',   avail);
    if (haulers      < maxHaulers)       return canAfford('hauler',       avail);
    if (remoteMiners < 2)                return canAfford('remoteMiner', avail);
    if (couriers     < 2)                return canAfford('courier',     avail);
    if (upgraders    < maxUpgraders - 3) return canAfford('upgrader',    avail);
    return null;
  }

  if (strategy === 'towerDefense') {
    // Extra builders early to get a tower up at RCL3, then pivot to economy
    if (harvesters < maxHarvesters - 1)  return canAfford('harvester', avail);
    if (haulers    < maxHaulers    - 1)  return canAfford('hauler',    avail);
    if (builders   < 2 && rcl >= 2)     return canAfford('builder',   avail);
    if (upgraders  < maxUpgraders  - 2)  return canAfford('upgrader',  avail);
    return null;
  }

  // adaptive (default): bottleneck-driven priority list
  // Soft hauler cap — when haulers are adequate, pivot to upgraders rather than
  // continuing to stack haulers or re-spawning dead builders. Builder drain (5 e/tick
  // per WORK part) can fully consume income at low RCL; letting them naturally die
  // frees income for upgrading.
  if (bottleneck === 'BALANCED' && haulers >= Math.max(2, harvesters)) {
    return canAfford('upgrader', avail) ?? canAfford('hauler', avail);
  }

  const priority = {
    HARVESTER_SHORTAGE: ['harvester', 'hauler', 'upgrader', 'builder'],
    HAULER_SHORTAGE:    ['hauler', 'harvester', 'upgrader', 'builder'],
    SOURCE_MAXED:       ['upgrader', 'builder', 'hauler'],
    BALANCED:           ['hauler', 'harvester', 'upgrader', 'builder'],
  }[bottleneck] ?? ['harvester', 'hauler', 'upgrader'];

  for (const role of priority) {
    const r = canAfford(role, avail);
    if (r) return r;
  }
  return null;
}

// ─── Step ─────────────────────────────────────────────────────────────────────

function stepState(s, dt, noise, strategy, buildPriority) {
  const c          = s.creeps;
  const containers = s.structs.containers  ?? 0;
  const roads      = s.structs.roads       ?? 0;
  const hasRoads   = roads > 4;
  const remoteRooms = s.structs.remoteRooms ?? 0;

  // 1. Energy income
  // IMPORTANT: two separate income channels:
  //   workIncome  — harvesters fill containers; upgraders/builders draw DIRECTLY from
  //                 containers (no hauler needed). Rate = gross harvest rate.
  //   spawnIncome — haulers carry container energy to spawn/extensions. Rate = delivery,
  //                 bounded by what's left after upgraders/builders consumed.
  // Conflating these causes a death spiral: when haulers die, effective=0 and upgraders
  // starve even though containers are still being filled by harvesters.
  const gross       = H.energyIncome(c.harvester ?? 0, 2, containers > 0) * noise.income;
  const remoteGross = H.remoteIncome(c.remoteMiner ?? 0, remoteRooms, hasRoads) * noise.income;
  const delivery    = H.haulerThroughput(c.hauler ?? 0, H.CONTAINER_DISTANCE, hasRoads) * noise.hauler;
  const remoteDeliv = H.courierThroughput(c.courier ?? 0, hasRoads) * noise.hauler;

  // workGross: energy harvesters produce each tick (available for work regardless of haulers)
  const workGross    = gross + remoteGross;
  // totalDelivery: haulers can deliver at most this rate to spawn/extensions
  const totalDelivery = delivery + remoteDeliv;

  // 2. Spawn cycle — budget is stored avail only (energy update refills from spawnFlow each step).
  // Using stored avail prevents over-spawning that inflates drain beyond income.
  // canAfford() is passed the remaining budget so it never sees negative values.
  // At stepSize=500 an upgrader (9 ticks) can fire ~55× per step if budget allows.
  {
    let spawnBudget = s.energy.avail;  // stored spawn pool only

    let spawnTime = s._spawnCd ?? 0;
    while (spawnTime < dt) {
      const role = decideNextSpawn(s, strategy, spawnBudget);  // use remaining budget for canAfford checks
      if (!role) break;
      const cost = H.ROLE_SPEC[role].cost;
      if (spawnBudget < cost) break;
      spawnBudget -= cost;
      s.energy.avail -= cost;  // avail stays non-negative (spawnBudget <= avail by invariant)
      s.creeps[role] = (s.creeps[role] ?? 0) + 1;
      s._lastSpawn   = role;
      spawnTime     += H.spawnTicksForRole(role) * noise.spawn;
    }
    s._spawnCd = Math.max(0, spawnTime - dt);
  }

  // 3. Build target
  const buildTarget = resolveBuildTarget(s, buildPriority);
  const buildActive = buildTarget !== null;

  // 4. Two-channel energy drain
  // Upgraders/builders draw from containers (workGross), independent of haulers.
  // Haulers deliver the container surplus to spawn/extensions (avail).
  const rawUpgradeDrain = H.upgradeFlux(c.upgrader ?? 0);
  const rawBuildDrain   = buildActive ? H.buildFlux(c.builder ?? 0) : 0;

  // Work throughput: scale to available container flow
  const workSlot     = (containers > 0 ? workGross : 0) * dt;  // only if containers exist
  const upgradeScale = rawUpgradeDrain > 0 ? Math.min(1, (workSlot + s.energy.avail) / (rawUpgradeDrain * dt + 1)) : 1;
  const actualUpgrade = rawUpgradeDrain * upgradeScale;

  const forBuild     = Math.max(0, workSlot - actualUpgrade * dt);
  const buildScale   = rawBuildDrain > 0 ? Math.min(1, forBuild / (rawBuildDrain * dt + 1)) : 1;
  const actualBuild  = rawBuildDrain * buildScale;

  // Container surplus after work flows to spawn pool via haulers
  const containerSurplus = Math.max(0, workGross - actualUpgrade - actualBuild);
  // Without containers, haulers deliver directly (original model)
  // Harvester fallback: when haulers are absent but harvesters exist, a fraction of gross
  // can reach spawn directly (harvesters occasionally carry overflow, or energy trickles
  // through containers to spawn). Prevents a permanent death spiral when haulers die.
  const harvFallback = (c.hauler ?? 0) === 0 && (c.harvester ?? 0) > 0
    ? workGross * 0.25  // 25% of gross delivered without dedicated haulers
    : 0;
  const spawnFlow = containers > 0
    ? Math.min(containerSurplus, totalDelivery * 1.35) + harvFallback
    : Math.min(workGross, totalDelivery * 1.35);

  const netRate = spawnFlow;  // avail accumulates from hauler delivery to spawn
  s.energy.avail   = Math.max(0, Math.min(s.energy.cap, s.energy.avail + netRate * dt));
  s.energy.netRate = spawnFlow - actualUpgrade - actualBuild;  // net colony rate for display

  // 5. Creep aging — exponential survival formula, accurate for any step size dt
  //    Linear approximation (dt/lifespan) over-kills at large dt; Math.exp corrects this.
  const survivalRate = Math.exp(-dt / (H.TICK_LIFESPAN * noise.lifespan));
  for (const role of Object.keys(s.creeps)) {
    const n = s.creeps[role];
    if (n > 0) {
      const expected = n * survivalRate;
      const floor    = Math.floor(expected);
      s.creeps[role] = Math.random() < (expected - floor) ? floor + 1 : floor;
    }
  }

  // 6. Controller progress — scaled by upgrader's container-draw rate
  const xpGain = H.upgradeFlux(c.upgrader ?? 0) * upgradeScale * dt * noise.upgrade;
  s.ctrl.progress = Math.min(s.ctrl.total, s.ctrl.progress + xpGain);

  // 7. RCL transition — spawn cap doesn't change here; it changes as extensions get built
  if (s.ctrl.progress >= s.ctrl.total && s.rcl < 8) {
    s.rcl++;
    s.ctrl.progress = 0;
    s.ctrl.total    = H.RCL_THRESHOLDS[s.rcl] ?? s.ctrl.total;
    // Storage unlocks at RCL4 — add its cap bonus once
    if (s.rcl === H.STORAGE_UNLOCK_RCL && !s.structs.storage) {
      // Storage will be built by builders; cap added when construction completes
    }
  }
  s.ctrl.pct = s.ctrl.total > 0 ? Math.round(s.ctrl.progress / s.ctrl.total * 100) : 100;

  // 8. Structure construction (builders actively working, scaled by builder's energy allotment)
  if (buildActive && (c.builder ?? 0) > 0) {
    const buildPower = H.buildFlux(c.builder ?? 0) * buildScale * dt * noise.build;
    processBuild(s, buildPower, buildTarget);
  }

  // 8. Remote room activation — once roads exist and a remoteMiner is deployed, the room is live
  if (!(s.structs.remoteRooms) && (c.remoteMiner ?? 0) >= 1 && hasRoads) {
    s.structs.remoteRooms = 1;
  }

  // 9. Derived state
  s.energy.bottleneck = H.detectBottleneck(s);
  s.phase             = H.evaluatePhase(s, s.phase);

  return s;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Simulate a game state forward by ticksForward ticks.
 * Returns an array of snapshot objects, one per stepSize ticks.
 *
 * @param {object} initialState   - Game state matching statsLog snapshot format
 * @param {number} ticksForward   - How many ticks to project (default 260,000 = 24h)
 * @param {object} options
 * @param {number}  options.stepSize      - Ticks per simulation step (default 500)
 * @param {string}  options.strategy      - Spawn strategy: 'adaptive'|'upgradeRush'|'economyStack'|'military'|'remoteMiner'|'towerDefense'
 * @param {string}  options.buildPriority - Build order: 'extensions'|'containers'|'roads'|'towers'
 * @param {boolean} options.noisy         - Apply Monte Carlo noise (default false for deterministic run)
 * @param {object}  options.calibration   - Pre-loaded calibration; if omitted, loaded from disk
 */
export function simulateOnce(initialState, ticksForward = 260_000, options = {}) {
  const { stepSize = 500, strategy = 'adaptive', buildPriority = 'extensions', noisy = false, calibration } = options;
  const cal   = calibration ?? loadCalibration();
  const noise = noisy ? sampleNoise() : { income: 1, hauler: 1, lifespan: 1, spawn: 1, upgrade: 1, build: 1 };
  noise.income  *= cal.incomeMultiplier;
  noise.hauler  *= cal.haulerMultiplier;
  noise.upgrade *= cal.upgradeMultiplier;
  noise.build   *= cal.buildMultiplier;

  let s = JSON.parse(JSON.stringify(initialState));

  // Ensure all role keys exist
  for (const role of Object.keys(H.ROLE_SPEC)) {
    s.creeps[role] = s.creeps[role] ?? 0;
  }

  // Ensure all struct keys exist (may be absent in older history snapshots)
  s.structs              ??= {};
  s.structs.containers   = s.structs.containers   ?? 0;
  s.structs.roads        = s.structs.roads        ?? 0;
  s.structs.extensions   = s.structs.extensions   ?? 0;
  s.structs.towers       = s.structs.towers       ?? 0;
  s.structs.storage      = s.structs.storage      ?? 0;
  s.structs.remoteRooms  = s.structs.remoteRooms  ?? 0;

  // In the two-channel model, avail = spawn pool (spawn + extensions + storage only).
  // Containers are a separate energy store for upgraders/builders; they don't inflate avail cap.
  s.energy.cap = Math.max(
    s.energy.cap ?? 0,
    300 + s.structs.extensions * 50 + (s.structs.storage ? H.STORAGE_CAP_BONUS : 0),
  );

  s._spawnCd              = s._spawnCd ?? 0;
  s._buildProgressByTarget = {};
  s._lastSpawn             = null;

  const snapshots = [];
  for (let elapsed = stepSize; elapsed <= ticksForward; elapsed += stepSize) {
    s = stepState(s, stepSize, noise, strategy, buildPriority);
    snapshots.push({
      tick:    initialState.tick + elapsed,
      elapsed,
      rcl:     s.rcl,
      energy:  {
        avail:      Math.round(s.energy.avail),
        cap:        s.energy.cap,
        netRate:    Math.round(s.energy.netRate * 100) / 100,
        bottleneck: s.energy.bottleneck,
      },
      creeps:  { ...s.creeps },
      ctrl:    { pct: s.ctrl.pct, progress: Math.round(s.ctrl.progress), total: s.ctrl.total },
      structs: { ...s.structs },
      phase:   s.phase,
    });
  }

  return snapshots;
}
