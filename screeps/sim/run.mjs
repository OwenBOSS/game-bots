#!/usr/bin/env node
// Standalone CLI: load history.json → run Monte Carlo sim → write sim-output.json
// Can also be imported as a module by fetch-stats.mjs for inline use.
//
// Usage:
//   node screeps/sim/run.mjs                     (uses data/history.json relative to this file)
//   node screeps/sim/run.mjs --runs 400           (more runs = wider confidence intervals)
//   node screeps/sim/run.mjs --ticks 260000       (24h forecast; this is the default)
//   node screeps/sim/run.mjs --step 500           (ticks per sim step; default)

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runMonteCarlo, BUILD_ORDERS } from './monte-carlo.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runSim(opts = {}) {
  const {
    historyPath  = join(__dirname, '..', 'dashboard', 'data', 'history.json'),
    outputPath   = join(__dirname, '..', 'dashboard', 'data', 'sim-output.json'),
    runs         = 200,
    ticksForward = 260_000,
    stepSize     = 500,
    silent       = false,
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
    const horizonH = (ticksForward / 10800).toFixed(1);  // 3 ticks/sec × 3600 sec/hr
    const nSteps   = Math.ceil(ticksForward / stepSize);
    console.log(`Running Monte Carlo simulation from tick ${initialState.tick.toLocaleString()}`);
    console.log(`  ${runs} runs × ${BUILD_ORDERS.length} strategies × ${ticksForward.toLocaleString()} ticks (${horizonH}h, ${nSteps} steps each)`);
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
    runs:         get('--runs',  200),
    ticksForward: get('--ticks', 260_000),
    stepSize:     get('--step',  500),
  });

  if (!result) process.exit(1);

  const t = result.ticksForward.toLocaleString();
  const m = result.milestones;
  const pct    = v => `${Math.round((v ?? 0) * 100)}%`;
  const tkStr  = v => (v != null && isFinite(v)) ? `~${(v / 1000).toFixed(1)}k ticks` : 'n/a';

  console.log('');
  console.log(`=== SIM SUMMARY (${t} tick / 24h forecast) ===`);
  console.log(`RCL3 probability:         ${pct(m.rcl3.probWithinHorizon).padEnd(6)} (median ${tkStr(m.rcl3.p50)})`);
  console.log(`RCL4 probability:         ${pct(m.rcl4.probWithinHorizon).padEnd(6)} (median ${tkStr(m.rcl4.p50)})`);
  console.log(`RCL5 probability:         ${pct(m.rcl5.probWithinHorizon).padEnd(6)} (median ${tkStr(m.rcl5.p50)})`);
  console.log(`Remote room activation:   ${pct(m.remoteRoom.probWithinHorizon)}`);
  console.log(`Energy crisis rate:       ${pct(m.energyCrisisRate)} of ticks`);
  console.log(`Median ctrl% at horizon:  ${result.ctrlPct.p50.at(-1)}%`);
  console.log('');
  console.log(`Build order ranking (${BUILD_ORDERS.length} strategies):`);
  result.buildOrders.forEach((b, i) => {
    console.log(`  ${i + 1}. ${b.label.padEnd(22)} score=${b.score}  RCL4=${pct(b.rcl4Prob)}  ctrl=${b.ctrlPctAtEnd}%  stability=${b.stabilityScore}`);
  });
  console.log('');
  console.log('Top recommendations:');
  result.recommendations.slice(0, 3).forEach(r => {
    console.log(`  [${r.priority}] ${r.action ?? r.role ?? r.type}: ${r.reason}`);
  });
}
