// Monte Carlo simulation harness.
// Runs N noisy simulations, extracts percentile bands, detects milestones,
// and compares 4 spawn strategies to produce build-order recommendations.

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

// ─── Build order definitions ─────────────────────────────────────────────────

export const BUILD_ORDERS = [
  { key: 'adaptive',    label: 'Adaptive (current)', description: 'Bottleneck-driven spawn logic — mirrors what the live bot does' },
  { key: 'upgradeRush', label: 'Upgrade Rush',       description: 'Base economy fast, then pour into upgraders for RCL3 speed' },
  { key: 'economyStack',label: 'Economy Stack',      description: 'Max harvesters and haulers before any upgraders — high stability' },
  { key: 'military',    label: 'Military Prep',      description: 'Build warriors alongside economy for an early aggression window' },
];

// ─── Main Monte Carlo runner ──────────────────────────────────────────────────

/**
 * Run Monte Carlo simulation from an initial game state snapshot.
 *
 * @param {object} initialState   - Last statsLog snapshot
 * @param {object} opts
 * @param {number}  opts.runs         - Number of simulation runs per strategy (default 200)
 * @param {number}  opts.ticksForward - Ticks to project (default 2000)
 * @param {number}  opts.stepSize     - Ticks per sim step (default 50)
 *
 * @returns {{
 *   baseTick, runs, ticksForward, stepSize, checkpoints,
 *   energy, ctrlPct, creepTotal, rcl,
 *   milestones, buildOrders, recommendations
 * }}
 */
export function runMonteCarlo(initialState, opts = {}) {
  const { runs = 200, ticksForward = 2000, stepSize = 50 } = opts;
  const steps = ticksForward / stepSize;
  const checkpoints = Array.from({ length: steps }, (_, i) => (i + 1) * stepSize);
  // Load calibration once and pass it to every simulateOnce call — avoids 200+ disk reads
  const calibration = loadCalibration();

  // Per-step accumulators: [stepIndex] = array of values across runs
  const energyByStep    = Array.from({ length: steps }, () => []);
  const ctrlPctByStep   = Array.from({ length: steps }, () => []);
  const creepTotByStep  = Array.from({ length: steps }, () => []);
  const rclByStep       = Array.from({ length: steps }, () => []);

  // Milestone accumulators (collected in the same loop, no extra runs needed)
  const rcl3Ticks  = [];
  const crisisRates = [];

  // Run the default (adaptive) strategy for projection bands + milestone data
  for (let r = 0; r < runs; r++) {
    const snaps = simulateOnce(initialState, ticksForward, { stepSize, strategy: 'adaptive', noisy: true, calibration });

    let rcl3Tick   = Infinity;
    let crisisCount = 0;
    snaps.forEach((s, i) => {
      energyByStep[i].push(s.energy.avail);
      ctrlPctByStep[i].push(s.ctrl.pct);
      creepTotByStep[i].push(Object.values(s.creeps).reduce((a, b) => a + b, 0));
      rclByStep[i].push(s.rcl);

      if (rcl3Tick === Infinity && s.rcl >= 3) rcl3Tick = s.elapsed;
      if (s.energy.avail < s.energy.cap * 0.10) crisisCount++;
    });
    rcl3Ticks.push(rcl3Tick);
    crisisRates.push(crisisCount / snaps.length);
  }

  // ── Percentile bands ────────────────────────────────────────────────────────

  function bandsFor(byStep) {
    return {
      p10: byStep.map(v => percentilesOf(v).p10),
      p25: byStep.map(v => percentilesOf(v).p25),
      p50: byStep.map(v => percentilesOf(v).p50),
      p75: byStep.map(v => percentilesOf(v).p75),
      p90: byStep.map(v => percentilesOf(v).p90),
    };
  }

  // ── Milestones ──────────────────────────────────────────────────────────────

  const rcl3Finite = rcl3Ticks.filter(t => t < Infinity);
  const rcl3Prob   = rcl3Finite.length / runs;
  const rcl3Percs  = rcl3Finite.length > 0 ? percentilesOf(rcl3Finite) : null;
  const avgCrisisRate = crisisRates.reduce((a, b) => a + b, 0) / crisisRates.length;

  // ── Build order comparison ──────────────────────────────────────────────────

  const buildOrderResults = BUILD_ORDERS.map(bo => {
    const COMP_RUNS = Math.ceil(runs / 4); // fewer runs for comparison (still meaningful)
    const scores      = [];
    const rcl3probs   = [];
    const ctrlAt2000  = [];
    const stabilityArr = [];

    for (let r = 0; r < COMP_RUNS; r++) {
      const snaps = simulateOnce(initialState, ticksForward, { stepSize, strategy: bo.key, noisy: true, calibration });
      scores.push(scoreRun(snaps));

      const last = snaps.at(-1);
      ctrlAt2000.push(last?.ctrl?.pct ?? 0);

      const hitRcl3 = snaps.some(s => s.rcl >= 3);
      rcl3probs.push(hitRcl3 ? 1 : 0);

      const stableSnaps = snaps.filter(s => s.energy.avail > s.energy.cap * 0.25).length;
      stabilityArr.push(stableSnaps / snaps.length);
    }

    const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;

    return {
      key:            bo.key,
      label:          bo.label,
      description:    bo.description,
      score:          Math.round(mean(scores) * 10) / 10,
      rcl3Prob:       Math.round(mean(rcl3probs) * 100) / 100,
      ctrlPctAt2000:  Math.round(mean(ctrlAt2000)),
      stabilityScore: Math.round(mean(stabilityArr) * 100) / 100,
    };
  });

  // Sort by composite score descending
  buildOrderResults.sort((a, b) => b.score - a.score);

  // ── Recommendations ─────────────────────────────────────────────────────────

  const recommendations = [];
  const latest = initialState;
  const bottleneck = latest.energy?.bottleneck ?? 'BALANCED';

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
      reason:   'HAULER_SHORTAGE — energy is being harvested but not delivered; add haulers to unlock income',
    });
  }

  // If upgrade rush beats adaptive by meaningful margin, recommend it
  const adaptiveResult    = buildOrderResults.find(b => b.key === 'adaptive');
  const upgradeRushResult = buildOrderResults.find(b => b.key === 'upgradeRush');
  if (upgradeRushResult && adaptiveResult && upgradeRushResult.ctrlPctAt2000 > adaptiveResult.ctrlPctAt2000 + 3) {
    recommendations.push({
      priority: 'MEDIUM',
      type:     'strategy',
      action:   'Shift spawn priority toward upgraders',
      reason:   `Upgrade Rush projects +${upgradeRushResult.ctrlPctAt2000 - adaptiveResult.ctrlPctAt2000}% controller progress at t+2000 vs current adaptive logic`,
    });
  }

  if (latest.rcl < 3 && rcl3Prob < 0.15) {
    recommendations.push({
      priority: 'MEDIUM',
      type:     'strategy',
      action:   'Increase upgrader count — RCL3 is far',
      reason:   `Only ${Math.round(rcl3Prob * 100)}% of simulations reach RCL3 within 2000 ticks at current trajectory`,
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

  if (!recommendations.length) {
    recommendations.push({
      priority: 'LOW',
      type:     'info',
      action:   'Colony is on a healthy trajectory',
      reason:   'No critical issues detected in simulation; continue current strategy',
    });
  }

  return {
    baseTick:     initialState.tick,
    runs,
    ticksForward,
    stepSize,
    checkpoints,

    energy:     bandsFor(energyByStep),
    ctrlPct:    bandsFor(ctrlPctByStep),
    creepTotal: bandsFor(creepTotByStep),
    rcl:        bandsFor(rclByStep),

    milestones: {
      rcl3: {
        probWithin2000t: Math.round(rcl3Prob * 100) / 100,
        ...(rcl3Percs ?? {}),
      },
      energyCrisisRate: Math.round(avgCrisisRate * 100) / 100,
    },

    buildOrders:     buildOrderResults,
    recommendations,
  };
}
