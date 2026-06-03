// Monte Carlo simulation harness.
// Runs N noisy simulations, extracts percentile bands, detects milestones,
// and compares 8 build orders to produce build-order recommendations.

import { simulateOnce } from './engine.mjs';
import { scoreRun } from './heuristics.mjs';
import { loadCalibration } from './calibrate.mjs';

// ─── Math helpers ─────────────────────────────────────────────────────────────

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * sorted.length)));
  return sorted[idx];
}

function percentilesOf(values) {
  const s = [...values].sort((a, b) => a - b);
  return { p10: percentile(s, 0.10), p25: percentile(s, 0.25), p50: percentile(s, 0.50), p75: percentile(s, 0.75), p90: percentile(s, 0.90) };
}

// ─── Build order definitions ──────────────────────────────────────────────────
//
// spawnStrategy → passed to decideNextSpawn() in engine.mjs
// buildPriority → passed to resolveBuildTarget() in engine.mjs

export const BUILD_ORDERS = [
  // ── Existing spawn strategies ───────────────────────────────────────────────
  {
    key: 'adaptive',
    spawnStrategy: 'adaptive',
    buildPriority: 'extensions',
    label:       'Adaptive (current)',
    description: 'Bottleneck-driven spawn logic with extensions-first construction — mirrors the live bot',
  },
  {
    key: 'upgradeRush',
    spawnStrategy: 'upgradeRush',
    buildPriority: 'extensions',
    label:       'Upgrade Rush',
    description: 'Minimal economy, then flood upgraders for maximum RCL speed',
  },
  {
    key: 'economyStack',
    spawnStrategy: 'economyStack',
    buildPriority: 'extensions',
    label:       'Economy Stack',
    description: 'Max harvesters and haulers before any upgraders — high energy stability',
  },
  {
    key: 'military',
    spawnStrategy: 'military',
    buildPriority: 'extensions',
    label:       'Military Prep',
    description: 'Warriors alongside economy for an early aggression window',
  },
  // ── New build-order variants ────────────────────────────────────────────────
  {
    key: 'containersFirst',
    spawnStrategy: 'adaptive',
    buildPriority: 'containers',
    label:       'Containers First',
    description: 'Build source containers before extensions — unlocks 2× harvest efficiency sooner',
  },
  {
    key: 'roadsFirst',
    spawnStrategy: 'adaptive',
    buildPriority: 'roads',
    label:       'Roads First',
    description: 'Build 10 key roads before containers/extensions — halves hauler travel time early',
  },
  {
    key: 'remoteMiner',
    spawnStrategy: 'remoteMiner',
    buildPriority: 'roads',
    label:       'Remote Miner',
    description: 'Invest in adjacent-room mining for ~85% income boost after roads are established',
  },
  {
    key: 'towerDefense',
    spawnStrategy: 'towerDefense',
    buildPriority: 'towers',
    label:       'Tower Defense',
    description: 'Prioritize building a tower at RCL3 for defensive coverage; slight economy delay',
  },
];

// ─── Main Monte Carlo runner ──────────────────────────────────────────────────

/**
 * Run Monte Carlo simulation from an initial game state snapshot.
 *
 * @param {object} initialState   - Last statsLog snapshot
 * @param {object} opts
 * @param {number}  opts.runs         - Number of simulation runs for the main adaptive band (default 200)
 * @param {number}  opts.ticksForward - Ticks to project (default 260,000 = 24h)
 * @param {number}  opts.stepSize     - Ticks per sim step (default 500)
 */
export function runMonteCarlo(initialState, opts = {}) {
  const { runs = 200, ticksForward = 260_000, stepSize = 500 } = opts;
  const steps       = Math.ceil(ticksForward / stepSize);
  const checkpoints = Array.from({ length: steps }, (_, i) => (i + 1) * stepSize);
  const calibration = loadCalibration();

  // Per-step accumulators: [stepIndex] = values across runs
  const energyByStep   = Array.from({ length: steps }, () => []);
  const ctrlPctByStep  = Array.from({ length: steps }, () => []);
  const creepTotByStep = Array.from({ length: steps }, () => []);
  const rclByStep      = Array.from({ length: steps }, () => []);

  // Milestone accumulators (first tick each milestone is reached, Infinity if never)
  const rcl3Ticks   = [];
  const rcl4Ticks   = [];
  const rcl5Ticks   = [];
  const remoteTicks = [];
  const crisisRates = [];

  // Main band: adaptive strategy with 200 full runs
  for (let r = 0; r < runs; r++) {
    const snaps = simulateOnce(initialState, ticksForward, {
      stepSize, strategy: 'adaptive', buildPriority: 'extensions', noisy: true, calibration,
    });

    let rcl3Tick = Infinity, rcl4Tick = Infinity, rcl5Tick = Infinity, remoteTick = Infinity;
    let crisisCount = 0;

    snaps.forEach((s, i) => {
      energyByStep[i].push(s.energy.avail);
      ctrlPctByStep[i].push(s.ctrl.pct);
      creepTotByStep[i].push(Object.values(s.creeps).reduce((a, b) => a + b, 0));
      rclByStep[i].push(s.rcl);

      if (rcl3Tick   === Infinity && s.rcl >= 3)                      rcl3Tick   = s.elapsed;
      if (rcl4Tick   === Infinity && s.rcl >= 4)                      rcl4Tick   = s.elapsed;
      if (rcl5Tick   === Infinity && s.rcl >= 5)                      rcl5Tick   = s.elapsed;
      if (remoteTick === Infinity && (s.structs?.remoteRooms ?? 0) >= 1) remoteTick = s.elapsed;
      if (s.energy.avail < s.energy.cap * 0.10) crisisCount++;
    });

    rcl3Ticks.push(rcl3Tick);
    rcl4Ticks.push(rcl4Tick);
    rcl5Ticks.push(rcl5Tick);
    remoteTicks.push(remoteTick);
    crisisRates.push(crisisCount / snaps.length);
  }

  // ── Percentile bands ─────────────────────────────────────────────────────────

  function bandsFor(byStep) {
    return {
      p10: byStep.map(v => percentilesOf(v).p10),
      p25: byStep.map(v => percentilesOf(v).p25),
      p50: byStep.map(v => percentilesOf(v).p50),
      p75: byStep.map(v => percentilesOf(v).p75),
      p90: byStep.map(v => percentilesOf(v).p90),
    };
  }

  // ── Milestones ────────────────────────────────────────────────────────────────

  function milestoneStats(ticks) {
    const finite = ticks.filter(t => t < Infinity);
    return {
      probWithinHorizon: Math.round(finite.length / runs * 100) / 100,
      ...(finite.length > 0 ? percentilesOf(finite) : {}),
    };
  }

  const avgCrisisRate = crisisRates.reduce((a, b) => a + b, 0) / crisisRates.length;

  // ── Build order comparison ────────────────────────────────────────────────────

  const COMP_RUNS = Math.ceil(runs / 4);

  const buildOrderResults = BUILD_ORDERS.map(bo => {
    const scores       = [];
    const rcl4probs    = [];
    const ctrlAtEnd    = [];
    const stabilityArr = [];

    for (let r = 0; r < COMP_RUNS; r++) {
      const snaps = simulateOnce(initialState, ticksForward, {
        stepSize,
        strategy:      bo.spawnStrategy ?? bo.key,
        buildPriority: bo.buildPriority ?? 'extensions',
        noisy:         true,
        calibration,
      });

      scores.push(scoreRun(snaps));

      const last = snaps.at(-1);
      ctrlAtEnd.push(last?.ctrl?.pct ?? 0);
      rcl4probs.push(snaps.some(s => s.rcl >= 4) ? 1 : 0);

      const stableSnaps = snaps.filter(s => s.energy.avail > s.energy.cap * 0.25).length;
      stabilityArr.push(stableSnaps / snaps.length);
    }

    const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;

    return {
      key:            bo.key,
      label:          bo.label,
      description:    bo.description,
      score:          Math.round(mean(scores) * 10) / 10,
      rcl4Prob:       Math.round(mean(rcl4probs) * 100) / 100,
      ctrlPctAtEnd:   Math.round(mean(ctrlAtEnd)),
      stabilityScore: Math.round(mean(stabilityArr) * 100) / 100,
    };
  });

  buildOrderResults.sort((a, b) => b.score - a.score);

  // ── Recommendations ───────────────────────────────────────────────────────────

  const recommendations = [];
  const bottleneck = initialState.energy?.bottleneck ?? 'BALANCED';

  if (bottleneck === 'HARVESTER_SHORTAGE') {
    recommendations.push({
      priority: 'HIGH',
      type:     'spawn',
      role:     'harvester',
      reason:   'HARVESTER_SHORTAGE — income below 5 e/tick; extra harvesters directly increase RCL rate',
    });
  } else if (bottleneck === 'HAULER_SHORTAGE') {
    recommendations.push({
      priority: 'HIGH',
      type:     'spawn',
      role:     'hauler',
      reason:   'HAULER_SHORTAGE — energy is harvested but not delivered; add haulers to unlock income',
    });
  }

  const adaptiveResult    = buildOrderResults.find(b => b.key === 'adaptive');
  const upgradeRushResult = buildOrderResults.find(b => b.key === 'upgradeRush');
  if (upgradeRushResult && adaptiveResult && upgradeRushResult.ctrlPctAtEnd > adaptiveResult.ctrlPctAtEnd + 3) {
    recommendations.push({
      priority: 'MEDIUM',
      type:     'strategy',
      action:   'Shift spawn priority toward upgraders',
      reason:   `Upgrade Rush projects +${upgradeRushResult.ctrlPctAtEnd - adaptiveResult.ctrlPctAtEnd}% controller progress at 24h horizon vs current adaptive logic`,
    });
  }

  const remoteMinerResult = buildOrderResults.find(b => b.key === 'remoteMiner');
  if (remoteMinerResult && adaptiveResult && remoteMinerResult.score > adaptiveResult.score + 5) {
    recommendations.push({
      priority: 'MEDIUM',
      type:     'strategy',
      action:   'Consider remote mining expansion',
      reason:   `Remote Miner scores +${(remoteMinerResult.score - adaptiveResult.score).toFixed(1)} vs Adaptive — adjacent room income could significantly accelerate RCL4`,
    });
  }

  const rcl4Stats = milestoneStats(rcl4Ticks);
  if (initialState.rcl < 4 && rcl4Stats.probWithinHorizon < 0.30) {
    recommendations.push({
      priority: 'MEDIUM',
      type:     'strategy',
      action:   'RCL4 at risk — review upgrader count',
      reason:   `Only ${Math.round(rcl4Stats.probWithinHorizon * 100)}% of simulations reach RCL4 in the 24h window`,
    });
  }

  if (avgCrisisRate > 0.15) {
    recommendations.push({
      priority: 'MEDIUM',
      type:     'economy',
      action:   'Stabilize energy flow before expanding',
      reason:   `${Math.round(avgCrisisRate * 100)}% of projected ticks have energy <10% — volatility wastes spawn capacity`,
    });
  }

  const topBuild = buildOrderResults[0];
  if (topBuild && topBuild.key !== 'adaptive' && topBuild.score > (adaptiveResult?.score ?? 0) + 8) {
    recommendations.push({
      priority: 'LOW',
      type:     'strategy',
      action:   `Try "${topBuild.label}" build order`,
      reason:   `Ranked #1 with score ${topBuild.score} — ${topBuild.description}`,
    });
  }

  if (!recommendations.length) {
    recommendations.push({
      priority: 'LOW',
      type:     'info',
      action:   'Colony is on a healthy trajectory',
      reason:   'No critical issues detected; continue current strategy',
    });
  }

  return {
    baseTick:    initialState.tick,
    runs,
    ticksForward,
    stepSize,
    checkpoints,

    energy:     bandsFor(energyByStep),
    ctrlPct:    bandsFor(ctrlPctByStep),
    creepTotal: bandsFor(creepTotByStep),
    rcl:        bandsFor(rclByStep),

    milestones: {
      rcl3:             milestoneStats(rcl3Ticks),
      rcl4:             milestoneStats(rcl4Ticks),
      rcl5:             milestoneStats(rcl5Ticks),
      remoteRoom:       milestoneStats(remoteTicks),
      energyCrisisRate: Math.round(avgCrisisRate * 100) / 100,
    },

    buildOrders:     buildOrderResults,
    recommendations,
  };
}
