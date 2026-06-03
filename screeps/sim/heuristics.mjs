#!/usr/bin/env node
// Heuristic functions for Screeps strategic simulation.
// Trade exact per-creep simulation for ~95%-accurate aggregate math over long horizons.

export const TICK_LIFESPAN        = 1500;   // average creep lifespan ticks
export const SPAWN_TICKS_PER_PART = 3;      // 3 ticks to spawn one body part
export const HARVEST_PER_WORK     = 2;      // energy/tick per WORK part (harvest)
export const UPGRADE_PER_WORK     = 1;      // XP/tick per WORK part (upgrade)
export const SOURCE_REGEN_RATE    = 10;     // energy/tick per source (3000 / 300-tick cycle)
export const CONTAINER_DISTANCE   = 10;     // approx tiles: source → container → spawn

// Build costs (energy to construct one unit)
export const EXTENSION_COST  = 3_000;
export const CONTAINER_COST  = 5_000;
export const ROAD_COST       = 300;
export const TOWER_COST      = 5_000;
export const STORAGE_COST    = 30_000;

// Storage unlocks at RCL4 and adds a large energy buffer to the colony
export const STORAGE_UNLOCK_RCL = 4;
export const STORAGE_CAP_BONUS  = 50_000;  // practical sim buffer (not the full 1M)

// Remote mining: adjacent-room source is ~50 tiles away
export const REMOTE_MINE_DISTANCE = 50;

// Controller XP needed to go from RCL N → N+1
export const RCL_THRESHOLDS = [0, 200, 45000, 135000, 405000, 1215000, 3645000, 10935000, Infinity];

// Extensions unlocked at each RCL (cumulative count)
const EXTENSIONS_BY_RCL = [0, 0, 5, 10, 20, 30, 40, 50, 60];

export function extensionsAtRcl(rcl) {
  return EXTENSIONS_BY_RCL[Math.min(rcl, 8)] ?? 0;
}

export function energyCapForRcl(rcl) {
  const base    = 300 + extensionsAtRcl(rcl) * 50;
  const storage = rcl >= STORAGE_UNLOCK_RCL ? STORAGE_CAP_BONUS : 0;
  return base + storage;
}

// Typical body composition per role
export const ROLE_SPEC = {
  harvester:   { parts: 5, workParts: 2,  cost: 300 },
  hauler:      { parts: 4, carryParts: 2, carryCapacity: 100, cost: 200 },
  upgrader:    { parts: 3, workParts: 1,  cost: 200 },
  builder:     { parts: 3, workParts: 1,  cost: 200 },
  warrior:     { parts: 5, attackParts: 2, cost: 260 },
  scout:       { parts: 1, cost: 50 },
  scavenger:   { parts: 3, carryParts: 2, cost: 150 },
  remoteMiner: { parts: 7, workParts: 6,  cost: 800 },   // heavy miner for adjacent rooms
  courier:     { parts: 9, carryParts: 8, carryCapacity: 400, cost: 550 },  // long-haul hauler
};

// ─── RCL-aware body scaling ───────────────────────────────────────────────────
// As extensions are built, the spawn can afford larger harvester bodies.
// This models the real bot's dynamic body scaling (bodyBuilder.ts).

// WORK parts a stationary harvester can have, constrained to fit in the spawn pool.
// Body: N×WORK + 1×MOVE + 1×CARRY = N*100 + 100 total cost ≤ spawnCap.
// spawnCap = 300 + (built extensions)×50 + storage bonus
export function harvesterWorkParts(spawnCap) {
  // Max WORK parts such that (wp * 100 + 100) ≤ spawnCap
  const maxWP = Math.floor((spawnCap - 100) / 100);
  return Math.max(1, Math.min(maxWP, 6));  // at least 1 WORK, at most 6 (source regen limit)
}

// Spawn cost for the largest harvester body that fits in the spawn pool.
export function harvesterCostForCap(spawnCap) {
  return harvesterWorkParts(spawnCap) * 100 + 100;
}

// ─── Movement ────────────────────────────────────────────────────────────────

export function moveTicks(distance, hasRoads = false) {
  return Math.ceil(distance * (hasRoads ? 0.5 : 1.0));
}

// ─── Energy flow ─────────────────────────────────────────────────────────────

// Gross energy harvested per tick. With containers, harvesters park and harvest continuously.
// NOTE: This uses fixed 2-WORK harvesters (RCL2 baseline). Body size scaling (bigger harvesters
// at higher RCL) is a known limitation — it requires tracking per-creep spawn history.
export function energyIncome(harvesterCount, sourceCount, hasContainers) {
  if (!hasContainers) {
    return harvesterCount * HARVEST_PER_WORK;
  }
  const perHarvesterOutput = HARVEST_PER_WORK * 2;  // 2 WORK parts per stationary harvester
  const activeHarvesters   = Math.min(harvesterCount, sourceCount);
  return Math.min(sourceCount * SOURCE_REGEN_RATE, activeHarvesters * perHarvesterOutput);
}

// Energy delivered to spawn/storage by haulers per tick
export function haulerThroughput(haulerCount, containerDistance, hasRoads) {
  const carry     = ROLE_SPEC.hauler.carryCapacity;
  const roundTrip = 2 * moveTicks(containerDistance, hasRoads);
  return (haulerCount * carry) / roundTrip;
}

// Remote mining income from adjacent rooms (6 WORK parts, reduced efficiency for distance)
export function remoteIncome(remoteMinerCount, remoteRooms, hasRoads) {
  if (!remoteMinerCount || !remoteRooms) return 0;
  const activeMiners = Math.min(remoteMinerCount, remoteRooms * 2);
  const perMiner     = HARVEST_PER_WORK * 6 * 0.85;  // 85% efficiency (pathing loss)
  return activeMiners * perMiner;
}

// Courier delivery from remote rooms per tick
export function courierThroughput(courierCount, hasRoads) {
  const carry     = ROLE_SPEC.courier.carryCapacity;
  const roundTrip = 2 * moveTicks(REMOTE_MINE_DISTANCE, hasRoads);
  return (courierCount * carry) / roundTrip;
}

// Energy consumed per tick by upgraders and builders
export function energyDrain(upgraderCount, builderCount, buildActive) {
  const upgradeCost = upgraderCount * UPGRADE_PER_WORK;
  const buildCost   = buildActive ? builderCount * 5 : 0;
  return upgradeCost + buildCost;
}

// ─── Spawn ───────────────────────────────────────────────────────────────────

export function spawnTicksForRole(role) {
  return (ROLE_SPEC[role]?.parts ?? 3) * SPAWN_TICKS_PER_PART;
}

// ─── Combat ──────────────────────────────────────────────────────────────────

export function attackDPS(warriorCount) {
  return warriorCount * 60; // 2 ATTACK parts × 30 dmg = 60 per warrior
}

export function siegeViability(warriors, defenderHp = 20000) {
  const dps = attackDPS(warriors);
  return { viable: dps > 80, ttk: dps > 0 ? Math.ceil(defenderHp / dps) : Infinity };
}

// ─── State assessment ────────────────────────────────────────────────────────

export function detectBottleneck(s) {
  const containers = s.structs?.containers ?? 0;
  const roads      = s.structs?.roads ?? 0;
  const income     = energyIncome(s.creeps?.harvester ?? 0, 2, containers > 0);
  const throughput = haulerThroughput(s.creeps?.hauler ?? 0, CONTAINER_DISTANCE, roads > 4);
  if (income < 5)                      return 'HARVESTER_SHORTAGE';
  if (throughput < income * 0.7)       return 'HAULER_SHORTAGE';
  if (income >= SOURCE_REGEN_RATE * 2) return 'SOURCE_MAXED';
  return 'BALANCED';
}

export function evaluatePhase(s, currentPhase) {
  const warriors  = s.creeps?.warrior ?? 0;
  const fillRatio = (s.energy?.avail ?? 0) / (s.energy?.cap ?? 300);
  if (currentPhase === 'ECONOMY' && warriors >= 3 && fillRatio > 0.65) return 'ASSESS';
  if (currentPhase === 'ASSESS'  && warriors >= 5)                      return 'RUSH';
  if (currentPhase === 'ASSESS'  && fillRatio < 0.12)                   return 'ECONOMY';
  if (currentPhase === 'RUSH'    && warriors <= 1)                       return 'DEFEND';
  if (currentPhase === 'DEFEND'  && warriors >= 3)                       return 'ASSESS';
  return currentPhase;
}

export function upgradeFlux(upgraderCount) {
  return upgraderCount * UPGRADE_PER_WORK;
}

export function buildFlux(builderCount) {
  return builderCount * 5;
}

// Composite score for a finished simulation run (used for build-order ranking).
// Quadratic RCL reward makes high-RCL runs clearly preferred in long-horizon comparisons.
export function scoreRun(snapshots) {
  if (!snapshots.length) return 0;
  const last = snapshots.at(-1);

  const rclScore = Math.pow(Math.max(0, last.rcl - 2), 1.5) * 25 + (last.ctrl?.pct ?? 0) * 0.3;

  const stableCount    = snapshots.filter(s => (s.energy?.avail ?? 0) > (s.energy?.cap ?? 300) * 0.25).length;
  const stabilityScore = (stableCount / snapshots.length) * 20;

  const creeps     = last.creeps ?? {};
  const rosterScore = Math.min(15, Object.values(creeps).reduce((a, b) => a + b, 0) * 0.3);

  const remoteScore = Math.min(10, (last.structs?.remoteRooms ?? 0) * 5);

  return rclScore + stabilityScore + rosterScore + remoteScore;
}
