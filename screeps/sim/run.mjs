#!/usr/bin/env node
// Standalone CLI: load history.json → run Monte Carlo sim → write sim-output.json
// Can also be imported as a module by fetch-stats.mjs for inline use.
//
// Usage:
//   node screeps/sim/run.mjs                     (uses data/history.json relative to this file)
//   node screeps/sim/run.mjs --runs 400           (more runs = wider confidence intervals)
//   node screeps/sim/run.mjs --ticks 4000         (project further forward)

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runMonteCarlo } from './monte-carlo.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runSim(opts = {}) {
  const {
    historyPath = join(__dirname, '..', 'dashboard', 'data', 'history.json'),
    outputPath  = join(__dirname, '..', 'dashboard', 'data', 'sim-output.json'),
    runs        = 200,
    ticksForward = 2000,
    stepSize    = 50,
    silent      = false,
  } = opts;

  if (!existsSync(historyPath)) {
    if (!silent) console.error(`No history.json found at ${historyPath} — run: just fetch-stats first`);
    return null;
  }

  let history;
  try { history = JSON.parse(readFileSync(historyPath, 'utf-8')); }
  catch (e) { if (!silent) console.error('Failed to parse history.json:', e.message); return null; }

  if (!history.length) { if (!silent) console.error('history.json is empty.'); return null; }

  const initialState = history.at(-1);
  if (!silent) {
    console.log(`Running Monte Carlo simulation from tick ${initialState.tick.toLocaleString()}`);
    console.log(`  ${runs} runs × 4 strategies × ${ticksForward} ticks (${ticksForward / stepSize} steps each)`);
  }

  const t0  = performance.now();
  const sim = runMonteCarlo(initialState, { runs, ticksForward, stepSize });
  const ms  = Math.round(performance.now() - t0);

  if (!silent) console.log(`  Completed in ${ms}ms`);

  writeFileSync(outputPath, JSON.stringify(sim, null, 2));
  if (!silent) console.log(`Sim output: ${outputPath}`);

  return sim;
}

// ─── CLI entry ───────────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get  = (flag, def) => {
    const i = args.indexOf(flag);
    return i >= 0 ? Number(args[i + 1]) : def;
  };

  const result = await runSim({
    runs:        get('--runs',  200),
    ticksForward: get('--ticks', 2000),
    stepSize:    get('--step',  50),
  });

  if (!result) process.exit(1);

  console.log('');
  console.log('=== SIM SUMMARY ===');
  console.log(`RCL3 probability (2000t):  ${Math.round(result.milestones.rcl3.probWithin2000t * 100)}%`);
  console.log(`Energy crisis rate:         ${Math.round(result.milestones.energyCrisisRate * 100)}% of ticks`);
  console.log(`Median ctrl% at t+2000:    ${result.ctrlPct.p50.at(-1)}%`);
  console.log('');
  console.log('Build order ranking:');
  result.buildOrders.forEach((b, i) => {
    console.log(`  ${i + 1}. ${b.label.padEnd(22)} score=${b.score}  RCL3=${Math.round(b.rcl3Prob * 100)}%  ctrl=${b.ctrlPctAt2000}%`);
  });
  console.log('');
  console.log('Top recommendations:');
  result.recommendations.slice(0, 3).forEach(r => {
    console.log(`  [${r.priority}] ${r.action ?? r.role ?? r.type}: ${r.reason}`);
  });
}
