// Single simulation run with optional per-run noise.
// Call simulateOnce() to step a game state forward N ticks using heuristic math.

import * as H from './heuristics.mjs';
import { loadCalibration } from './calibrate.mjs';

// ─── Noise ────────────────────────────────────────────────────────────────────

// Box-Muller normal sample, clamped to prevent wild outliers
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

// ─── Spawn decision ───────────────────────────────────────────────────────────

function canAfford(role, avail) {
  const cost = H.ROLE_SPEC[role]?.cost ?? 200;
  return avail >= cost ? role : null;
}

export function decideNextSpawn(s, strategy) {
  const avail      = s.energy?.avail ?? 0;
  const bottleneck = H.detectBottleneck(s);
  const harvesters = s.creeps.harvester ?? 0;
  const haulers    = s.creeps.hauler ?? 0;
  const upgraders  = s.creeps.upgrader ?? 0;
  const warriors   = s.creeps.warrior ?? 0;

  if (strategy === 'upgradeRush') {
    if (harvesters < 3)  return canAfford('harvester', avail);
    if (haulers    < 2)  return canAfford('hauler',    avail);
    if (upgraders  < 5)  return canAfford('upgrader',  avail);
    // top-off economy after upgrader quota
    return canAfford(bottleneck === 'HARVESTER_SHORTAGE' ? 'harvester' : 'hauler', avail);
  }

  if (strategy === 'economyStack') {
    if (harvesters < 5) return canAfford('harvester', avail);
    if (haulers    < 4) return canAfford('hauler',    avail);
    return canAfford('upgrader', avail);
  }

  if (strategy === 'military') {
    if (harvesters < 3) return canAfford('harvester', avail);
    if (haulers    < 2) return canAfford('hauler',    avail);
    if (warriors   < 4) return canAfford('warrior',   avail);
    return canAfford(bottleneck === 'HARVESTER_SHORTAGE' ? 'harvester' : 'hauler', avail);
  }

  // adaptive (default): bottleneck-driven priority list
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

function stepState(s, dt, noise, strategy) {
  const c = s.creeps;
  const containers = s.structs.containers ?? 0;
  const roads      = s.structs.roads ?? 0;
  const hasRoads   = roads > 4;

  // 1. Energy income and delivery
  const gross    = H.energyIncome(c.harvester ?? 0, 2, containers > 0) * noise.income;
  const delivery = H.haulerThroughput(c.hauler ?? 0, H.CONTAINER_DISTANCE, hasRoads) * noise.hauler;
  // Containers buffer harvested energy; haulers must keep up
  const effective = containers > 0 ? Math.min(gross, delivery * 1.35) : gross;

  // Construction is active while extensions or roads are still needed
  const maxExtensions = H.extensionsAtRcl(s.rcl);
  const buildActive   = (s.structs.extensions ?? 0) < maxExtensions || roads < 25;
  const drain         = H.energyDrain(c.upgrader ?? 0, c.builder ?? 0, buildActive);

  const netRate = effective - drain;
  s.energy.avail   = Math.max(0, Math.min(s.energy.cap, s.energy.avail + netRate * dt));
  s.energy.netRate = netRate;

  // 2. Spawn cycle
  s._spawnCd = Math.max(0, (s._spawnCd ?? 0) - dt);
  if (s._spawnCd === 0) {
    const role = decideNextSpawn(s, strategy);
    if (role) {
      const cost = H.ROLE_SPEC[role].cost;
      if (s.energy.avail >= cost) {
        s.energy.avail -= cost;
        s.creeps[role] = (s.creeps[role] ?? 0) + 1;
        s._spawnCd = H.spawnTicksForRole(role) * noise.spawn;
        s._lastSpawn = role;
      }
    }
  }

  // 3. Creep aging (stochastic decay: E[deaths] = count × dt/lifespan)
  const deathProb = dt / (H.TICK_LIFESPAN * noise.lifespan);
  for (const role of Object.keys(s.creeps)) {
    const n = s.creeps[role];
    if (n > 0) {
      // Poisson approximation for small p: expected deaths = n * p
      const deaths = Math.min(n, Math.round(n * deathProb + (Math.random() < (n * deathProb % 1) ? 1 : 0) - 0.5));
      s.creeps[role] = Math.max(0, n - Math.max(0, deaths));
    }
  }

  // 4. Controller progress (upgrade)
  const xpGain = H.upgradeFlux(c.upgrader ?? 0) * dt * noise.upgrade;
  s.ctrl.progress = Math.min(s.ctrl.total, s.ctrl.progress + xpGain);

  // 5. RCL transition
  if (s.ctrl.progress >= s.ctrl.total && s.rcl < 8) {
    s.rcl++;
    s.ctrl.progress = 0;
    s.ctrl.total    = H.RCL_THRESHOLDS[s.rcl] ?? s.ctrl.total;
    const containerCap = (s.structs.containers ?? 0) * 2000;
    s.energy.cap    = H.energyCapForRcl(s.rcl) + containerCap;
  }
  s.ctrl.pct = s.ctrl.total > 0 ? Math.round(s.ctrl.progress / s.ctrl.total * 100) : 100;

  // 6. Structure progress (extensions built by builders over time)
  if (buildActive && (c.builder ?? 0) > 0) {
    const buildPower = H.buildFlux(c.builder ?? 0) * dt * noise.build;
    s._buildProgress = (s._buildProgress ?? 0) + buildPower;
    // Extensions cost 3000 energy each (as build hits)
    while (s._buildProgress >= 3000 && (s.structs.extensions ?? 0) < maxExtensions) {
      s._buildProgress -= 3000;
      s.structs.extensions = (s.structs.extensions ?? 0) + 1;
      const cCap = (s.structs.containers ?? 0) * 2000;
      s.energy.cap = Math.max(s.energy.cap, H.energyCapForRcl(s.rcl) + cCap);
    }
  }

  // 7. Derived state
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
 * @param {number} ticksForward   - How many ticks to project (default 2000)
 * @param {object} options
 * @param {number}  options.stepSize  - Ticks per simulation step (default 50)
 * @param {string}  options.strategy  - Spawn strategy: 'adaptive'|'upgradeRush'|'economyStack'|'military'
 * @param {boolean} options.noisy       - Apply Monte Carlo noise (default false for deterministic run)
 * @param {object}  options.calibration - Pre-loaded calibration; if omitted, loaded from disk
 */
export function simulateOnce(initialState, ticksForward = 2000, options = {}) {
  const { stepSize = 50, strategy = 'adaptive', noisy = false, calibration } = options;
  const cal   = calibration ?? loadCalibration();
  const noise = noisy ? sampleNoise() : { income: 1, hauler: 1, lifespan: 1, spawn: 1, upgrade: 1, build: 1 };
  // Apply calibration on top of random noise — shifts the mean toward observed reality
  noise.income  *= cal.incomeMultiplier;
  noise.hauler  *= cal.haulerMultiplier;
  noise.upgrade *= cal.upgradeMultiplier;
  noise.build   *= cal.buildMultiplier;

  // Deep-clone initial state and add internal tracking fields
  let s = JSON.parse(JSON.stringify(initialState));
  s._spawnCd       = s._spawnCd ?? 0;
  s._buildProgress = s._buildProgress ?? 0;
  s._lastSpawn     = null;

  // Ensure all role keys exist
  for (const role of Object.keys(H.ROLE_SPEC)) {
    s.creeps[role] = s.creeps[role] ?? 0;
  }

  const snapshots = [];
  for (let elapsed = stepSize; elapsed <= ticksForward; elapsed += stepSize) {
    s = stepState(s, stepSize, noise, strategy);
    snapshots.push({
      tick:    initialState.tick + elapsed,
      elapsed,
      rcl:     s.rcl,
      energy:  { avail: Math.round(s.energy.avail), cap: s.energy.cap, netRate: Math.round(s.energy.netRate * 100) / 100, bottleneck: s.energy.bottleneck },
      creeps:  { ...s.creeps },
      ctrl:    { pct: s.ctrl.pct, progress: Math.round(s.ctrl.progress), total: s.ctrl.total },
      structs: { ...s.structs },
      phase:   s.phase,
    });
  }

  return snapshots;
}
