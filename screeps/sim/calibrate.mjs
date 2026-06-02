// Prediction ledger + heuristic calibration.
//
// recordPrediction(simData)  — called right after a sim run; stores predictions for future resolution
// resolvePredictions(history) — called on every fetch; matches old predictions to actual snapshots
//                               and updates calibration multipliers via EMA
// loadCalibration()           — loaded by engine.mjs to bias sim parameters toward observed reality

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = join(__dirname, '..', 'dashboard', 'data');
const PRED_FILE = join(DATA_DIR, 'predictions.json');
const CAL_FILE  = join(DATA_DIR, 'calibration.json');

// EMA learning rate — 0.2 means each observation has 20% weight.
// Low enough to be robust to outliers; high enough to converge within ~20 fetches.
const ALPHA = 0.2;

// ─── Calibration I/O ─────────────────────────────────────────────────────────

export const DEFAULT_CALIBRATION = {
  incomeMultiplier:  1.0,   // scales energyIncome() — >1 = reality earns more than modeled
  haulerMultiplier:  1.0,   // scales haulerThroughput()
  upgradeMultiplier: 1.0,   // scales upgradeFlux() — >1 = reality upgrades faster
  buildMultiplier:   1.0,   // scales buildFlux()
  sampleCount:       0,
  lastUpdatedTick:   0,
  version:           0,
};

export function loadCalibration() {
  if (!existsSync(CAL_FILE)) return { ...DEFAULT_CALIBRATION };
  try { return { ...DEFAULT_CALIBRATION, ...JSON.parse(readFileSync(CAL_FILE, 'utf-8')) }; }
  catch { return { ...DEFAULT_CALIBRATION }; }
}

function saveCalibration(cal) {
  writeFileSync(CAL_FILE, JSON.stringify(cal, null, 2));
}

// ─── Prediction ledger I/O ───────────────────────────────────────────────────

function loadPredictions() {
  if (!existsSync(PRED_FILE)) return [];
  try { return JSON.parse(readFileSync(PRED_FILE, 'utf-8')); }
  catch { return []; }
}

function savePredictions(preds) {
  writeFileSync(PRED_FILE, JSON.stringify(preds, null, 2));
}

// ─── Record ──────────────────────────────────────────────────────────────────

// Store a new sim's predictions for later resolution.
// We track 4 checkpoints: 200t, 500t, 1000t, 2000t (or whatever the sim produced).
const TRACK_TICKS = [200, 500, 1000, 2000];

export function recordPrediction(simData) {
  const preds = loadPredictions();

  // Skip if we already have a prediction from within 2000 ticks of this one
  const recent = preds.find(p => Math.abs(p.madeAtTick - simData.baseTick) < 2000);
  if (recent) return;

  const checkpoints = TRACK_TICKS
    .map(rel => {
      const idx = simData.checkpoints.indexOf(rel);
      if (idx < 0) return null;
      return {
        relativeTick: rel,
        absoluteTick: simData.baseTick + rel,
        predicted: {
          energyP10:  simData.energy.p10[idx],
          energyP50:  simData.energy.p50[idx],
          energyP90:  simData.energy.p90[idx],
          ctrlPctP50: simData.ctrlPct.p50[idx],
          rclP50:     simData.rcl?.p50?.[idx] ?? null,
        },
        actual:   null,
        resolved: false,
        error:    null,  // filled on resolution
      };
    })
    .filter(Boolean);

  preds.push({
    id:            `pred-${simData.baseTick}`,
    madeAtTick:    simData.baseTick,
    checkpoints,
    fullyResolved: false,
  });

  // Keep last 100 predictions (enough for 100 fetches × ~200 tick gaps = ~20k ticks of history)
  savePredictions(preds.slice(-100));
}

// ─── Resolve ─────────────────────────────────────────────────────────────────

// Match unresolved prediction checkpoints to actual history snapshots.
// When enough samples accumulate, update the calibration multipliers.
export function resolvePredictions(history, silent = false) {
  const preds  = loadPredictions();
  const cal    = loadCalibration();

  // Index history by tick for O(1) lookup
  const byTick = new Map(history.map(s => [s.tick, s]));

  const energyErrors  = [];  // (actual/predicted) ratios — >1 means we under-predicted
  const ctrlErrors    = [];

  let newlyResolved = 0;

  for (const pred of preds) {
    if (pred.fullyResolved) continue;

    for (const cp of pred.checkpoints) {
      if (cp.resolved) continue;

      const snap = findNearest(byTick, cp.absoluteTick, 150);
      if (!snap) continue;

      const actualEnergy  = snap.energy?.avail ?? null;
      const actualCtrlPct = snap.ctrl?.pct    ?? null;

      cp.actual   = { tick: snap.tick, energyAvail: actualEnergy, ctrlPct: actualCtrlPct };
      cp.resolved = true;
      newlyResolved++;

      // Compute ratio: actual / p50. Clamped to prevent runaway corrections.
      if (cp.predicted.energyP50 > 50 && actualEnergy != null) {
        const r = clamp(actualEnergy / cp.predicted.energyP50, 0.3, 3.0);
        cp.error = { energyRatio: r };
        energyErrors.push(r);
      }
      if (cp.predicted.ctrlPctP50 > 1 && actualCtrlPct != null) {
        const r = clamp(actualCtrlPct / cp.predicted.ctrlPctP50, 0.3, 3.0);
        if (!cp.error) cp.error = {};
        cp.error.ctrlRatio = r;
        ctrlErrors.push(r);
      }
    }

    pred.fullyResolved = pred.checkpoints.every(cp => cp.resolved);
  }

  savePredictions(preds);

  if (newlyResolved === 0) return { newlyResolved: 0, calibrationUpdated: false };

  // ── Update calibration via EMA ────────────────────────────────────────────
  let updated = false;

  if (energyErrors.length > 0) {
    const avg = mean(energyErrors);
    // Energy ratio > 1 → reality has more energy than predicted.
    // Ambiguous (income up OR drain down) — split the signal: apply to income & hauler equally.
    // The EMA dampens noise; over many samples, systematic bias is corrected.
    cal.incomeMultiplier  = clamp(ema(cal.incomeMultiplier,  avg, ALPHA), 0.35, 2.5);
    cal.haulerMultiplier  = clamp(ema(cal.haulerMultiplier,  avg, ALPHA), 0.35, 2.5);
    updated = true;
  }

  if (ctrlErrors.length > 0) {
    const avg = mean(ctrlErrors);
    cal.upgradeMultiplier = clamp(ema(cal.upgradeMultiplier, avg, ALPHA), 0.35, 2.5);
    updated = true;
  }

  if (updated) {
    cal.sampleCount    += energyErrors.length + ctrlErrors.length;
    cal.lastUpdatedTick = history.at(-1)?.tick ?? 0;
    cal.version++;
    saveCalibration(cal);

    if (!silent) {
      const bias = energyErrors.length ? ` (energy bias: ${pctStr(mean(energyErrors))}, ctrl bias: ${pctStr(mean(ctrlErrors))})` : '';
      console.log(`Calibration v${cal.version} — ${cal.sampleCount} samples resolved${bias}`);
      console.log(`  income×${cal.incomeMultiplier.toFixed(3)}  hauler×${cal.haulerMultiplier.toFixed(3)}  upgrade×${cal.upgradeMultiplier.toFixed(3)}`);
    }
  }

  return { newlyResolved, calibrationUpdated: updated };
}

// ─── Prediction accuracy report ───────────────────────────────────────────────

// Returns a human-readable accuracy summary for the dashboard.
// Called by fetch-stats.mjs and embedded in the HTML.
export function predictionAccuracyReport() {
  const preds = loadPredictions();
  const cal   = loadCalibration();

  const resolved = preds.flatMap(p => p.checkpoints.filter(cp => cp.resolved && cp.error));
  if (!resolved.length) return null;

  const energyRatios = resolved.filter(cp => cp.error?.energyRatio != null).map(cp => cp.error.energyRatio);
  const ctrlRatios   = resolved.filter(cp => cp.error?.ctrlRatio   != null).map(cp => cp.error.ctrlRatio);

  // RMSE of (ratio - 1) across resolutions, by relative tick bucket
  const byBucket = {};
  for (const cp of resolved) {
    const bucket = cp.relativeTick;
    if (!byBucket[bucket]) byBucket[bucket] = { energy: [], ctrl: [] };
    if (cp.error?.energyRatio != null) byBucket[bucket].energy.push(cp.error.energyRatio);
    if (cp.error?.ctrlRatio   != null) byBucket[bucket].ctrl.push(cp.error.ctrlRatio);
  }

  return {
    sampleCount:      resolved.length,
    calibrationVersion: cal.version,
    multipliers: {
      income:  cal.incomeMultiplier,
      hauler:  cal.haulerMultiplier,
      upgrade: cal.upgradeMultiplier,
    },
    overallEnergyBias:  energyRatios.length ? mean(energyRatios) : null,
    overallCtrlBias:    ctrlRatios.length   ? mean(ctrlRatios)   : null,
    byRelativeTick: Object.fromEntries(
      Object.entries(byBucket).map(([t, v]) => [t, {
        energyBias: v.energy.length ? mean(v.energy) : null,
        ctrlBias:   v.ctrl.length   ? mean(v.ctrl)   : null,
        n:          v.energy.length + v.ctrl.length,
      }])
    ),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ema(prev, obs, alpha) { return prev * (1 - alpha) + obs * alpha; }
function clamp(v, lo, hi)      { return Math.max(lo, Math.min(hi, v)); }
function mean(arr)             { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function pctStr(ratio)         { const p = Math.round((ratio - 1) * 100); return (p >= 0 ? '+' : '') + p + '%'; }

function findNearest(byTick, target, tolerance) {
  if (byTick.has(target)) return byTick.get(target);
  for (let d = 1; d <= tolerance; d++) {
    if (byTick.has(target + d)) return byTick.get(target + d);
    if (byTick.has(target - d)) return byTick.get(target - d);
  }
  return null;
}
