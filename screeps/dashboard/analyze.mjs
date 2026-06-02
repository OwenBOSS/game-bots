#!/usr/bin/env node
// Fetches latest stats, groups by regime, computes performance metrics,
// and writes report.md + suggested-changes.md for manual review.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname      = dirname(fileURLToPath(import.meta.url));
const HISTORY        = join(__dirname, 'data', 'history.json');
const REPORT_OUT     = join(__dirname, 'report.md');
const PROMPT_OUT     = join(__dirname, 'prompt.md');
const SUGGESTED_OUT  = join(__dirname, 'suggested-changes.md');

// Always fetch fresh data before analyzing
console.log('Fetching latest stats...');
execFileSync(process.execPath, [join(__dirname, 'fetch-stats.mjs')], { stdio: 'inherit' });

if (!existsSync(HISTORY)) {
  console.error('No data yet — fetch-stats produced no history.json.');
  process.exit(1);
}

const history = JSON.parse(readFileSync(HISTORY, 'utf-8'));
if (!history.length) { console.error('history.json is empty.'); process.exit(1); }

// ─── Group by regime ────────────────────────────────────────────────────────
const regimeMap = new Map();
for (const snap of history) {
  const r = snap.regime ?? 'initial';
  if (!regimeMap.has(r)) regimeMap.set(r, []);
  regimeMap.get(r).push(snap);
}

// ─── Stats helpers ──────────────────────────────────────────────────────────
const mean = arr => arr.length ? arr.reduce((a,b)=>a+b,0) / arr.length : 0;
const std  = arr => { const m = mean(arr); return Math.sqrt(mean(arr.map(v=>(v-m)**2))); };
const pct  = (n, d) => d > 0 ? Math.round(n/d*100) : 0;
const round1 = n => Math.round(n * 10) / 10;

function computeStats(snaps) {
  const avail   = snaps.map(s => s.energy?.avail ?? 0);
  const cap     = snaps.map(s => s.energy?.cap   ?? 300);
  const fillPct = avail.map((e,i) => pct(e, cap[i]));

  const allRoles = [...new Set(snaps.flatMap(s => Object.keys(s.creeps ?? {})))];
  const avgRole  = role => round1(mean(snaps.map(s => (s.creeps ?? {})[role] ?? 0)));

  const first = snaps[0], last = snaps.at(-1);
  const tickSpan  = (last?.tick ?? 0) - (first?.tick ?? 0);
  const pctDelta  = (last?.ctrl?.pct ?? 0) - (first?.ctrl?.pct ?? 0);
  const ticksPer1 = pctDelta > 0 ? Math.round(tickSpan / pctDelta) : null;

  const phaseCounts  = {}, combatCounts = {};
  for (const s of snaps) {
    phaseCounts[s.phase ?? 'ECONOMY'] = (phaseCounts[s.phase ?? 'ECONOMY'] ?? 0) + 1;
    const cs = s.combat?.state ?? 'RALLY';
    combatCounts[cs] = (combatCounts[cs] ?? 0) + 1;
  }
  const phasePct  = k => pct(phaseCounts[k]  ?? 0, snaps.length);
  const combatPct = k => pct(combatCounts[k] ?? 0, snaps.length);

  // Anomaly detection
  const anomalies = [];

  const warriorInEconomy = snaps.filter(s =>
    (s.phase ?? 'ECONOMY') === 'ECONOMY' && (s.creeps?.warrior ?? 0) > 0
  );
  if (warriorInEconomy.length > 0) {
    const excess = round1(mean(warriorInEconomy.map(s => s.creeps?.warrior ?? 0)));
    anomalies.push({
      severity: 'HIGH',
      title: 'Combat creeps alive during ECONOMY phase',
      detail: `${warriorInEconomy.length}/${snaps.length} snapshots have warriors (avg ${excess}) while in ECONOMY. They consume energy and body parts that should go to economy roles.`,
      file: 'spawnManager.ts → `pruneExcessCreeps`',
      fix: 'pruneExcessCreeps should cull warriors/rangers/healers aggressively when the room returns to ECONOMY and energy level is DEFICIT or CRITICAL.',
    });
  }

  const crisisSnaps = snaps.filter((s,i) => fillPct[i] < 5);
  if (crisisSnaps.length > 0) {
    anomalies.push({
      severity: 'HIGH',
      title: 'Repeated energy crises (<5% capacity)',
      detail: `${crisisSnaps.length} snapshots with near-zero energy. Average fill ${Math.round(mean(fillPct))}%, std dev ±${Math.round(std(fillPct))}%. High volatility points to hauler shortage.`,
      file: 'economyManager.ts → `calcDynamicTargets`',
      fix: 'Lower the HAULER_SHORTAGE trigger threshold or increase hauler target count when bottleneck is HAULER_SHORTAGE.',
    });
  }

  const recent = snaps.slice(-15);
  if (recent.length >= 10) {
    const recentDelta = (recent.at(-1)?.ctrl?.pct ?? 0) - (recent[0]?.ctrl?.pct ?? 0);
    if (recentDelta < 2 && pctDelta < 5) {
      anomalies.push({
        severity: 'MEDIUM',
        title: 'Controller progress stagnant',
        detail: `Progress: ${first?.ctrl?.pct ?? 0}% → ${last?.ctrl?.pct ?? 0}% over ${tickSpan.toLocaleString()} ticks. ${ticksPer1 ? `Rate: ${ticksPer1.toLocaleString()} ticks/1%.` : 'No measurable progress.'}`,
        file: 'economyManager.ts → `calcDynamicTargets` (upgrader target)',
        fix: 'Increase upgrader spawn target when energy level is STABLE or SURPLUS, even at low RCL.',
      });
    }
  }

  if (mean(fillPct) < 40 && Math.round(mean(avail.filter((_,i) => fillPct[i] > 60))) > 0) {
    anomalies.push({
      severity: 'MEDIUM',
      title: 'Energy volatile — containers may be full while spawn is starved',
      detail: `Avg energy fill ${Math.round(mean(fillPct))}% but spikes to full suggest haulers aren't running continuously.`,
      file: 'economyManager.ts → bottleneck thresholds',
      fix: 'Check HAULER_SHORTAGE detection: if containerFillPct > 70 AND spawn energy < 50%, that is hauler shortage — verify this condition fires correctly.',
    });
  }

  return {
    first, last, tickSpan,
    n: snaps.length,
    energy: {
      avgPct: Math.round(mean(fillPct)),
      avgAvail: Math.round(mean(avail)),
      avgCap: Math.round(mean(cap)),
      volatility: Math.round(std(avail)),
      crises: crisisSnaps.length,
      min: Math.min(...avail),
    },
    ctrl: {
      rclStart: first?.rcl ?? 0, rclEnd: last?.rcl ?? 0,
      pctStart: first?.ctrl?.pct ?? 0, pctEnd: last?.ctrl?.pct ?? 0,
      pctDelta, ticksPer1,
    },
    avgRoles: Object.fromEntries(allRoles.map(r => [r, avgRole(r)])),
    phase: {
      ECONOMY: phasePct('ECONOMY'), ASSESS: phasePct('ASSESS'),
      RUSH: phasePct('RUSH'), DEFEND: phasePct('DEFEND'),
    },
    combat: {
      RALLY: combatPct('RALLY'), MARCH: combatPct('MARCH'), ENGAGE: combatPct('ENGAGE'),
    },
    anomalies,
  };
}

// ─── Build analysis for every regime ───────────────────────────────────────
const analyses = [];
for (const [regime, snaps] of regimeMap) {
  analyses.push({ regime, ...computeStats(snaps) });
}
const latest = analyses.at(-1);

// ─── Render report.md ───────────────────────────────────────────────────────
function renderReport(analyses) {
  const lines = [];
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  lines.push(`# Colony Analysis Report — ${now}\n`);

  // Current state summary
  const cur = analyses.at(-1);
  lines.push(`## Current State (Regime \`${cur.regime}\`, tick ${cur.last?.tick?.toLocaleString()})\n`);
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| RCL | ${cur.last?.rcl ?? '?'} |`);
  lines.push(`| Energy | ${cur.last?.energy?.avail ?? '?'} / ${cur.last?.energy?.cap ?? '?'} (${cur.energy.avgPct}% avg) |`);
  lines.push(`| Controller | ${cur.last?.ctrl?.pct ?? '?'}% progress |`);
  lines.push(`| Phase | ${cur.last?.phase ?? '?'} |`);
  lines.push(`| Combat | ${cur.last?.combat?.state ?? '?'} |`);
  lines.push(`| Creeps | ${Object.values(cur.last?.creeps ?? {}).reduce((a,b)=>a+b,0)} total |`);
  lines.push(`| Snapshots | ${cur.n} (every 200 ticks) |`);
  lines.push('');

  // Per-regime breakdown
  lines.push('## Performance by Regime\n');
  for (const a of analyses) {
    lines.push(`### \`${a.regime}\` — ticks ${a.first?.tick?.toLocaleString()}–${a.last?.tick?.toLocaleString()} (${a.n} snapshots)\n`);

    lines.push('**Economy**');
    const energyGrade = a.energy.avgPct >= 60 ? 'OK' : a.energy.avgPct >= 30 ? 'POOR' : 'CRITICAL';
    lines.push(`- Avg energy: ${a.energy.avgAvail}/${a.energy.avgCap} (${a.energy.avgPct}%) — **${energyGrade}**`);
    lines.push(`- Volatility: ±${a.energy.volatility} energy — ${a.energy.volatility > 100 ? 'HIGH (hauler signature)' : 'normal'}`);
    lines.push(`- Energy crises (<5% cap): ${a.energy.crises} events`);
    lines.push('');

    lines.push('**Controller growth**');
    const rateStr = a.ctrl.ticksPer1 ? `${a.ctrl.ticksPer1.toLocaleString()} ticks/1%` : 'unmeasurable';
    lines.push(`- RCL ${a.ctrl.rclStart} → ${a.ctrl.rclEnd}, progress ${a.ctrl.pctStart}% → ${a.ctrl.pctEnd}%`);
    lines.push(`- Rate: ${rateStr}${a.ctrl.ticksPer1 && a.ctrl.ticksPer1 > 3000 ? ' — **SLOW**' : ''}`);
    lines.push('');

    lines.push('**Average creep roster**');
    const rosterStr = Object.entries(a.avgRoles)
      .sort(([,a],[,b]) => b - a)
      .map(([r,n]) => `${r}×${n}`)
      .join(', ');
    lines.push(`- ${rosterStr}`);
    lines.push('');

    lines.push('**Phase distribution**');
    lines.push(`- ECONOMY ${a.phase.ECONOMY}%  ASSESS ${a.phase.ASSESS}%  RUSH ${a.phase.RUSH}%  DEFEND ${a.phase.DEFEND}%`);
    lines.push(`- Combat: RALLY ${a.combat.RALLY}%  MARCH ${a.combat.MARCH}%  ENGAGE ${a.combat.ENGAGE}%`);
    lines.push('');

    if (a.anomalies.length > 0) {
      lines.push('**Anomalies detected**');
      for (const an of a.anomalies) {
        lines.push(`- [${an.severity}] **${an.title}**: ${an.detail}`);
      }
      lines.push('');
    }
  }

  // Cross-regime comparison if multiple
  if (analyses.length > 1) {
    lines.push('## Cross-Regime Comparison\n');
    lines.push('| Regime | Energy avg% | Controller rate | Crises | Creeps |');
    lines.push('|--------|-------------|-----------------|--------|--------|');
    for (const a of analyses) {
      const rate = a.ctrl.ticksPer1 ? `${a.ctrl.ticksPer1.toLocaleString()}t/1%` : 'n/a';
      const total = Object.values(a.avgRoles).reduce((s,v)=>s+v,0);
      lines.push(`| \`${a.regime}\` | ${a.energy.avgPct}% | ${rate} | ${a.energy.crises} | ${round1(total)} avg |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Render suggested-changes.md ────────────────────────────────────────────
function renderSuggestedChanges(analyses) {
  const cur = analyses.at(-1);
  const allAnomalies = analyses.flatMap(a => a.anomalies);
  const highPriority = allAnomalies.filter(a => a.severity === 'HIGH');
  const medPriority  = allAnomalies.filter(a => a.severity === 'MEDIUM');
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  const lines = [];
  lines.push(`# Suggested Changes — ${now}`);
  lines.push(`**Regime**: \`${cur.regime}\` | **Tick**: ${cur.last?.tick?.toLocaleString()} | **RCL**: ${cur.last?.rcl ?? '?'}`);
  lines.push('');
  lines.push('Apply each section manually. Changes are minimal and targeted — do not refactor surrounding code.');
  lines.push('');

  if (allAnomalies.length === 0) {
    lines.push('No anomalies detected. Colony appears healthy — no changes suggested.');
    return lines.join('\n');
  }

  let idx = 1;
  for (const an of [...highPriority, ...medPriority]) {
    lines.push(`---`);
    lines.push('');
    lines.push(`## ${idx++}. [${an.severity}] ${an.title}`);
    lines.push('');
    lines.push(`**File**: \`${an.file}\``);
    lines.push('');
    lines.push(`**Observed**: ${an.detail}`);
    lines.push('');
    lines.push(`**Change**: ${an.fix}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('*Generated by `screeps/dashboard/analyze.mjs`. Re-run `just analyze` after deploying fixes to measure improvement.*');

  return lines.join('\n');
}

// ─── Render prompt.md ───────────────────────────────────────────────────────
function renderPrompt(analyses) {
  const cur = analyses.at(-1);
  const allAnomalies = analyses.flatMap(a => a.anomalies);
  const highPriority = allAnomalies.filter(a => a.severity === 'HIGH');
  const medPriority  = allAnomalies.filter(a => a.severity === 'MEDIUM');

  const lines = [];
  lines.push(`You are improving a Screeps colony bot based on performance data.`);
  lines.push(`Bot source: \`screeps/strategies/adaptive/src/\``);
  lines.push(`Current regime: \`${cur.regime}\` (tick ${cur.last?.tick?.toLocaleString()})`);
  lines.push('');

  // Embed the full report
  lines.push('## Colony Analysis\n');
  lines.push(readFileSync(REPORT_OUT, 'utf-8'));

  lines.push('## Diagnosed Issues (Priority Order)\n');

  let idx = 1;
  for (const an of [...highPriority, ...medPriority]) {
    lines.push(`### ${idx++}. [${an.severity}] ${an.title}`);
    lines.push(`**File**: \`${an.file}\``);
    lines.push(`**Detail**: ${an.detail}`);
    lines.push(`**Suggested fix**: ${an.fix}`);
    lines.push('');
  }

  if (allAnomalies.length === 0) {
    lines.push('No significant anomalies detected in this regime. Colony appears healthy.');
    lines.push('Consider checking for sub-optimal but non-critical patterns manually.');
    lines.push('');
  }

  lines.push('## Task\n');
  lines.push(`1. Read each flagged source file to understand the current implementation`);
  lines.push(`2. Make **minimal, targeted fixes** for the diagnosed issues — no refactoring`);
  lines.push(`3. Create a git branch: \`perf/analysis-${cur.regime}\``);
  lines.push(`4. Commit with a clear message referencing the metric being improved`);
  lines.push(`5. Open a PR with:`);
  lines.push(`   - What changed and why (citing the specific metric)`);
  lines.push(`   - What improvement is expected (e.g. "should reduce energy crises by culling idle warriors")`);
  lines.push(`   - Which regime's data motivated the change`);
  lines.push('');
  lines.push('Do not fix issues that are not diagnosed above. Scope = diagnosed issues only.');

  return lines.join('\n');
}

// ─── Write outputs ──────────────────────────────────────────────────────────
const report = renderReport(analyses);
writeFileSync(REPORT_OUT, report);

// report.md must exist before renderPrompt reads it
const prompt = renderPrompt(analyses);
writeFileSync(PROMPT_OUT, prompt);

const suggested = renderSuggestedChanges(analyses);
writeFileSync(SUGGESTED_OUT, suggested);

console.log(`Report:            screeps/dashboard/report.md`);
console.log(`Suggested changes: screeps/dashboard/suggested-changes.md`);
console.log(`Prompt (manual):   screeps/dashboard/prompt.md`);
console.log('');

// Print summary to terminal
console.log('=== TOP ISSUES ===');
const allAnomalies = analyses.flatMap(a => a.anomalies);
if (allAnomalies.length === 0) {
  console.log('No anomalies detected.');
} else {
  for (const an of allAnomalies) {
    console.log(`[${an.severity}] ${an.title}`);
    console.log(`       → ${an.file}`);
  }
}
console.log('');
console.log('Review screeps/dashboard/suggested-changes.md and apply manually.');
