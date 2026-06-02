#!/usr/bin/env node
// Pulls Memory.statsLog from the Screeps API, appends to history.json, runs Monte Carlo sim,
// and regenerates index.html with historical charts + simulation projection visuals.
//
// Requires: $env:SCREEPS_TOKEN = "your-api-token"
//   Get your token at: https://screeps.com/a/#!/account/auth-tokens
//   Or create screeps/.env with SCREEPS_TOKEN=... (just will load it automatically)

import { gunzipSync } from 'zlib';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runSim } from '../sim/run.mjs';
import { recordPrediction, resolvePredictions, predictionAccuracyReport } from '../sim/calibrate.mjs';
import { uploadSimOutput } from '../sim/upload.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR   = join(__dirname, 'data');
const HISTORY    = join(DATA_DIR, 'history.json');
const DASHBOARD  = join(__dirname, 'index.html');
const TOKEN      = process.env.SCREEPS_TOKEN;
const SHARD      = process.env.SCREEPS_SHARD ?? 'shard3';

if (!TOKEN) {
  console.error('SCREEPS_TOKEN is not set.');
  console.error('  Get your token: https://screeps.com/a/#!/account/auth-tokens');
  console.error('  PowerShell:     $env:SCREEPS_TOKEN = "your-token"');
  console.error('  Or add it to:   screeps/.env  (will be gitignored)');
  process.exit(1);
}

async function fetchMemoryPath(path) {
  const url = `https://screeps.com/api/user/memory?path=${encodeURIComponent(path)}&shard=${SHARD}`;
  const res = await fetch(url, { headers: { 'X-Token': TOKEN } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
  const body = await res.json();
  if (!body.ok) throw new Error(`API returned error: ${JSON.stringify(body)}`);
  const { data } = body;
  if (typeof data === 'string' && data.startsWith('gz:')) {
    return JSON.parse(gunzipSync(Buffer.from(data.slice(3), 'base64')).toString('utf-8'));
  }
  return data;
}

// ── Load existing history ───────────────────────────────────────────────────
mkdirSync(DATA_DIR, { recursive: true });
let history = [];
if (existsSync(HISTORY)) {
  try { history = JSON.parse(readFileSync(HISTORY, 'utf-8')); } catch {}
}

// ── Fetch & merge ───────────────────────────────────────────────────────────
console.log(`Fetching Memory.statsLog from ${SHARD}...`);
let statsLog;
try { statsLog = await fetchMemoryPath('statsLog'); }
catch (err) { console.error('Fetch failed:', err.message); process.exit(1); }

if (!Array.isArray(statsLog)) {
  console.error('Memory.statsLog is not an array. Is the bot running?', statsLog);
  process.exit(1);
}

const seen  = new Set(history.map(s => s.tick));
const fresh = statsLog.filter(s => !seen.has(s.tick));
history = [...history, ...fresh].sort((a, b) => a.tick - b.tick);

writeFileSync(HISTORY, JSON.stringify(history, null, 2));
console.log(`+${fresh.length} new snapshots — total: ${history.length}`);

// ── Run Monte Carlo simulation ──────────────────────────────────────────────
console.log('Running Monte Carlo simulation (200 runs × 4 strategies)...');
let simData = null;
try {
  simData = await runSim({ historyPath: HISTORY, silent: true });
  if (simData) console.log(`Simulation complete — RCL3 probability: ${Math.round(simData.milestones.rcl3.probWithin2000t * 100)}%`);
} catch (e) {
  console.warn('Simulation failed (historical dashboard only):', e.message);
}

// ── Resolve past predictions against new history ────────────────────────────
const { newlyResolved } = resolvePredictions(history);
if (newlyResolved > 0) console.log(`Resolved ${newlyResolved} prediction checkpoints`);

// ── Record this sim's predictions for future resolution ─────────────────────
if (simData) recordPrediction(simData);

// ── Upload sim output to live Screeps Memory ────────────────────────────────
await uploadSimOutput(simData, { token: TOKEN, shard: SHARD });

// ── Regenerate dashboard ────────────────────────────────────────────────────
const accuracy = predictionAccuracyReport();
writeFileSync(DASHBOARD, buildDashboard(history, simData, accuracy));
console.log(`Dashboard: open screeps/dashboard/index.html in your browser`);

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard HTML generator — data embedded in-page, no server required
// ═══════════════════════════════════════════════════════════════════════════

function buildDashboard(snapshots, simData = null, accuracy = null) {
  const latest   = snapshots.at(-1) ?? {};
  const firstTick = snapshots[0]?.tick ?? 0;
  const lastTick  = snapshots.at(-1)?.tick ?? 0;

  const allRoles = [...new Set(snapshots.flatMap(s => Object.keys(s.creeps ?? {})))];

  const ROLE_COLORS = {
    harvester: '#4caf50', hauler: '#2196f3', upgrader: '#9c27b0',
    builder: '#ff9800', repairer: '#795548', scout: '#00bcd4',
    warrior: '#f44336', ranger: '#ff5722', healer: '#e91e63',
    scavenger: '#607d8b', courier: '#009688', claimer: '#673ab7',
  };

  const totalCreeps = Object.values(latest.creeps ?? {}).reduce((a, b) => a + b, 0);
  const kpis = [
    { val: latest.rcl ?? '?',                           lbl: 'RCL' },
    { val: (latest.energy?.avail ?? 0).toLocaleString(), lbl: 'Energy' },
    { val: (latest.ctrl?.pct ?? 0) + '%',               lbl: 'Ctrl %' },
    { val: totalCreeps,                                  lbl: 'Creeps' },
    { val: latest.phase ?? '?',                         lbl: 'Phase' },
    { val: latest.combat?.state ?? '?',                 lbl: 'Combat' },
    { val: latest.energy?.bottleneck ?? '?',            lbl: 'Bottleneck' },
    { val: (latest.regime ?? 'initial').replace(/^\d{4}-\d{2}-\d{2}-/, ''), lbl: 'Regime' },
    { val: snapshots.length,                             lbl: 'Snapshots' },
  ];

  const kpiHtml = kpis.map(k =>
    `<div class="kpi"><div class="val">${k.val}</div><div class="lbl">${k.lbl}</div></div>`
  ).join('');

  const dataJson   = JSON.stringify(snapshots);
  const roleColors = JSON.stringify(ROLE_COLORS);
  const roleList   = JSON.stringify(allRoles);
  const simJson    = JSON.stringify(simData);
  const accuracyJson = JSON.stringify(accuracy);

  // ── Simulation section HTML ─────────────────────────────────────────────
  const simRunInfo = simData
    ? `Monte Carlo · ${simData.runs} runs × 4 strategies · +${simData.ticksForward.toLocaleString()} ticks from tick ${simData.baseTick.toLocaleString()}`
    : 'Not available — run: just fetch-stats';

  const rcl3Pct   = simData ? Math.round(simData.milestones.rcl3.probWithin2000t * 100) : null;
  const crisisPct = simData ? Math.round(simData.milestones.energyCrisisRate * 100) : null;

  const gaugeColor = (pct, goodIsHigh) => {
    if (goodIsHigh) return pct > 40 ? '#4caf50' : pct > 15 ? '#ff9800' : '#f44336';
    return pct < 10 ? '#4caf50' : pct < 25 ? '#ff9800' : '#f44336';
  };

  const gauge = (label, pct, goodIsHigh) => {
    const color = gaugeColor(pct, goodIsHigh);
    const barPct = Math.max(2, Math.min(100, pct));
    return `<div class="gauge-card">
      <div class="gauge-pct" style="color:${color}">${pct}%</div>
      <div class="gauge-label">${label}</div>
      <div class="gauge-bar"><div class="gauge-fill" style="width:${barPct}%;background:${color}"></div></div>
    </div>`;
  };

  const milestonesHtml = simData
    ? `<div style="display:flex;gap:12px;flex-wrap:wrap">
        ${gauge('P(RCL3 in 2000t)', rcl3Pct, true)}
        ${gauge('Energy Crisis Rate', crisisPct, false)}
      </div>`
    : '<p style="color:#8b949e;font-size:.8em">Run fetch-stats to generate</p>';

  const recsHtml = simData
    ? simData.recommendations.map(r => {
        const colors = { HIGH: '#f44336', MEDIUM: '#ff9800', LOW: '#4caf50', INFO: '#58a6ff' };
        const c = colors[r.priority] ?? '#8b949e';
        return `<div class="rec-item" style="border-left-color:${c}">
          <div class="rec-title" style="color:${c}">[${r.priority}] ${r.action ?? r.role ?? r.type}</div>
          <div class="rec-reason">${r.reason}</div>
        </div>`;
      }).join('')
    : '<p style="color:#8b949e;font-size:.8em">Run fetch-stats to generate</p>';

  // ── Template helpers for calibration card ────────────────────────────────
  const biasColor = ratio => {
    if (ratio == null) return '#8b949e';
    const pct = Math.abs((ratio - 1) * 100);
    return pct < 5 ? '#4caf50' : pct < 20 ? '#ff9800' : '#f44336';
  };
  const biasLabel = ratio => {
    if (ratio == null) return '—';
    const pct = Math.round((ratio - 1) * 100);
    return (pct >= 0 ? '▲+' : '▼') + Math.abs(pct) + '%';
  };
  const mulColor = m => Math.abs(m - 1) < 0.05 ? '#4caf50' : Math.abs(m - 1) < 0.20 ? '#ff9800' : '#f44336';
  const mulDesc  = (m, noun) => {
    const pct = Math.round((m - 1) * 100);
    if (Math.abs(pct) < 3) return `${noun} matches model`;
    return pct > 0 ? `reality ${pct}% faster ${noun}` : `reality ${Math.abs(pct)}% slower ${noun}`;
  };

  // ── Calibration accuracy card ────────────────────────────────────────────
  const calCard = accuracy ? (() => {
    const biasRow = (label, ratio) => {
      if (ratio == null) return '';
      const pct = Math.round((ratio - 1) * 100);
      const color = Math.abs(pct) < 5 ? '#4caf50' : Math.abs(pct) < 20 ? '#ff9800' : '#f44336';
      const dir = pct >= 0 ? '▲' : '▼';
      return `<tr><td>${label}</td><td style="color:${color}">${dir}${Math.abs(pct)}% bias</td></tr>`;
    };
    const rows = Object.entries(accuracy.byRelativeTick)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([t, v]) => `<tr><td>t+${Number(t).toLocaleString()}</td>` +
        `<td style="color:${biasColor(v.energyBias)}">${biasLabel(v.energyBias)}</td>` +
        `<td style="color:${biasColor(v.ctrlBias)}">${biasLabel(v.ctrlBias)}</td>` +
        `<td style="color:#8b949e">${v.n}</td></tr>`).join('');
    return `<div class="card" style="grid-column:1/-1"><h2>Prediction Accuracy · Calibration v${accuracy.calibrationVersion} · ${accuracy.sampleCount} samples</h2>
      <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start">
        <div>
          <p style="font-size:.72em;color:#8b949e;margin-bottom:8px">Learned multipliers applied to sim heuristics</p>
          <table class="rtable" style="min-width:240px">
            <thead><tr><th>Parameter</th><th>Multiplier</th><th>Effect</th></tr></thead>
            <tbody>
              <tr><td>Income</td><td style="color:${mulColor(accuracy.multipliers.income)}">${accuracy.multipliers.income.toFixed(3)}×</td><td style="color:#8b949e">${mulDesc(accuracy.multipliers.income, 'harvest rate')}</td></tr>
              <tr><td>Hauler</td><td style="color:${mulColor(accuracy.multipliers.hauler)}">${accuracy.multipliers.hauler.toFixed(3)}×</td><td style="color:#8b949e">${mulDesc(accuracy.multipliers.hauler, 'delivery rate')}</td></tr>
              <tr><td>Upgrade</td><td style="color:${mulColor(accuracy.multipliers.upgrade)}">${accuracy.multipliers.upgrade.toFixed(3)}×</td><td style="color:#8b949e">${mulDesc(accuracy.multipliers.upgrade, 'XP rate')}</td></tr>
            </tbody>
          </table>
        </div>
        <div>
          <p style="font-size:.72em;color:#8b949e;margin-bottom:8px">Prediction bias by forecast horizon (actual ÷ predicted p50)</p>
          <table class="rtable" style="min-width:300px">
            <thead><tr><th>Horizon</th><th>Energy bias</th><th>Ctrl % bias</th><th>n</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
  })() : '';

  const simCards = simData ? `
  <div class="card"><h2>Energy Forecast</h2><canvas id="cSimEnergy"></canvas></div>
  <div class="card"><h2>Controller Progress Forecast</h2><canvas id="cSimCtrl"></canvas></div>
  <div class="card"><h2>Milestone Probabilities</h2>${milestonesHtml}</div>
  <div class="card"><h2>Strategic Recommendations</h2>${recsHtml}</div>
  <div class="card" style="grid-column:1/-1"><h2>Build Order Comparison</h2>
    <p style="font-size:.72em;color:#8b949e;margin-bottom:10px">Comparing 4 spawn strategies across ${simData.runs / 4} Monte Carlo runs each. Higher bars are better for Ctrl% and Stability; RCL3 probability shows how likely each strategy reaches RCL3 within ${simData.ticksForward.toLocaleString()} ticks.</p>
    <canvas id="cBuildOrders" style="max-height:200px"></canvas>
    <div id="boDescriptions" style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px"></div>
  </div>` : `<div class="card" style="grid-column:1/-1"><p class="empty">Simulation unavailable — run: just fetch-stats</p></div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Screeps Colony Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Courier New',monospace;background:#0d1117;color:#c9d1d9;padding:20px}
h1{color:#58a6ff;font-size:1.3em;margin-bottom:3px}
.meta{color:#8b949e;font-size:.78em;margin-bottom:14px}
.kpis{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px}
.kpi{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:9px 14px;min-width:95px}
.kpi .val{font-size:1.4em;font-weight:bold;color:#58a6ff}
.kpi .lbl{font-size:.7em;color:#8b949e;margin-top:2px;text-transform:uppercase}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px}
.card h2{font-size:.75em;color:#8b949e;margin-bottom:10px;text-transform:uppercase;letter-spacing:.06em}
canvas{width:100%!important;max-height:230px}
.empty{color:#f85149;margin-top:20px}
.rtable{width:100%;border-collapse:collapse;font-size:.78em}
.rtable th,.rtable td{padding:5px 8px;text-align:left;border-bottom:1px solid #21262d}
.rtable th{color:#8b949e;font-weight:normal;text-transform:uppercase;letter-spacing:.06em}
.rtable td{color:#c9d1d9}
.rtable tr:last-child td{border-bottom:none}
.rtable .cur{color:#58a6ff;font-weight:bold}
.section-header{grid-column:1/-1;border-top:1px solid #30363d;padding-top:18px;margin-top:10px}
.gauge-card{background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:12px 18px;min-width:130px;flex:1}
.gauge-pct{font-size:2em;font-weight:bold}
.gauge-label{font-size:.68em;color:#8b949e;text-transform:uppercase;margin:4px 0 8px}
.gauge-bar{height:5px;background:#21262d;border-radius:3px;overflow:hidden}
.gauge-fill{height:100%;border-radius:3px;transition:width .3s}
.rec-item{border-left:3px solid #30363d;padding:6px 10px;margin:6px 0;background:#0d1117;border-radius:0 4px 4px 0}
.rec-title{font-size:.75em;font-weight:bold}
.rec-reason{font-size:.70em;color:#8b949e;margin-top:3px}
.bo-desc{background:#0d1117;border:1px solid #21262d;border-radius:6px;padding:8px 12px;font-size:.70em;flex:1;min-width:160px}
.bo-desc strong{color:#c9d1d9;display:block;margin-bottom:3px}
.bo-desc span{color:#8b949e}
@media(max-width:680px){.grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<h1>Screeps Colony Dashboard</h1>
<div class="meta">Ticks ${firstTick.toLocaleString()}&ndash;${lastTick.toLocaleString()} &middot; ${snapshots.length} snapshots (every 200 ticks) &middot; last tick ${lastTick.toLocaleString()}</div>
<div class="kpis">${kpiHtml}</div>
<div class="grid">
  <div class="card"><h2>Energy Available</h2><canvas id="cEnergy"></canvas></div>
  <div class="card"><h2>Net Energy Rate</h2><canvas id="cRate"></canvas></div>
  <div class="card"><h2>Controller Progress</h2><canvas id="cCtrl"></canvas></div>
  <div class="card"><h2>Creep Roster</h2><canvas id="cCreeps"></canvas></div>
  <div class="card"><h2>Structures Built</h2><canvas id="cStructs"></canvas></div>
  <div class="card"><h2>Phase &amp; Combat State</h2><canvas id="cPhase"></canvas></div>
  <div class="card"><h2>Economy Bottleneck</h2><canvas id="cBottleneck"></canvas></div>
  <div class="card" style="grid-column:1/-1"><h2>Regime History</h2><div id="regimeHistory"></div></div>
  ${calCard}

  <!-- ── Simulation Projection ─────────────────────────────────────── -->
  <div class="section-header">
    <h1>Simulation Projection <span style="font-size:.6em;color:#8b949e">${simRunInfo}</span></h1>
    <p class="meta">Fan bands show p10/p25/p75/p90 percentile range across Monte Carlo runs. Wider bands = higher uncertainty = higher strategic risk.</p>
  </div>
  ${simCards}
</div>

<script>
const H = ${dataJson};
const ROLE_COLORS = ${roleColors};
const ALL_ROLES   = ${roleList};
const SIM         = ${simJson};
const ACCURACY    = ${accuracyJson};

if (!H.length) {
  document.body.insertAdjacentHTML('beforeend','<p class="empty">No data yet — run: just fetch-stats</p>');
}

const ticks = H.map(s => s.tick);

const AXIS_DEFAULTS = {
  ticks: { color: '#8b949e' },
  grid:  { color: '#21262d' },
};
const LEGEND = { labels: { color: '#8b949e', font: { size: 11 }, boxWidth: 12 } };
const BASE_OPTS = {
  animation: false,
  responsive: true,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: LEGEND },
  scales: {
    x: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, maxTicksLimit: 8 } },
    y: { ...AXIS_DEFAULTS },
  },
};

// ── Energy ──────────────────────────────────────────────────────────────────
new Chart(document.getElementById('cEnergy'), {
  type: 'line',
  data: {
    labels: ticks,
    datasets: [
      { label: 'Available', data: H.map(s => s.energy?.avail ?? 0),
        borderColor: '#58a6ff', backgroundColor: 'rgba(88,166,255,.15)',
        fill: true, pointRadius: 0, tension: .3 },
      { label: 'Capacity', data: H.map(s => s.energy?.cap ?? 0),
        borderColor: '#30363d', borderDash: [4, 4], pointRadius: 0, tension: .3 },
    ]
  },
  options: { ...BASE_OPTS, scales: {
    x: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, maxTicksLimit: 8 } },
    y: { ...AXIS_DEFAULTS, ticks: { color: '#8b949e', callback: v => v.toLocaleString() } },
  }},
});

// ── Controller (dual axis: RCL left, progress % right) ─────────────────────
new Chart(document.getElementById('cCtrl'), {
  type: 'line',
  data: {
    labels: ticks,
    datasets: [
      { label: 'RCL', data: H.map(s => s.rcl ?? 0),
        borderColor: '#f78166', yAxisID: 'yRcl', pointRadius: 0, stepped: 'before', borderWidth: 2 },
      { label: 'Progress %', data: H.map(s => s.ctrl?.pct ?? null),
        borderColor: '#58a6ff', backgroundColor: 'rgba(88,166,255,.12)',
        fill: true, yAxisID: 'yPct', pointRadius: 0, tension: .3 },
    ]
  },
  options: { ...BASE_OPTS, scales: {
    x: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, maxTicksLimit: 8 } },
    yRcl: { ...AXIS_DEFAULTS, position: 'left', min: 0, max: 8,
      ticks: { color: '#f78166', stepSize: 1 },
      title: { display: true, text: 'RCL', color: '#8b949e', font: { size: 10 } } },
    yPct: { ...AXIS_DEFAULTS, position: 'right', min: 0, max: 100,
      ticks: { color: '#58a6ff', callback: v => v + '%' },
      grid: { drawOnChartArea: false },
      title: { display: true, text: 'Progress %', color: '#8b949e', font: { size: 10 } } },
  }},
});

// ── Creep roster (stacked area) ─────────────────────────────────────────────
new Chart(document.getElementById('cCreeps'), {
  type: 'line',
  data: {
    labels: ticks,
    datasets: ALL_ROLES.map(role => ({
      label: role,
      data: H.map(s => (s.creeps ?? {})[role] ?? 0),
      borderColor: ROLE_COLORS[role] ?? '#8b949e',
      backgroundColor: (ROLE_COLORS[role] ?? '#8b949e') + '55',
      fill: true, pointRadius: 0, tension: .2,
    })),
  },
  options: { ...BASE_OPTS, scales: {
    x: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, maxTicksLimit: 8 }, stacked: true },
    y: { ...AXIS_DEFAULTS, stacked: true, ticks: { color: '#8b949e', stepSize: 1 } },
  }},
});

// ── Net energy rate ─────────────────────────────────────────────────────────
const rates = H.map((s, i) => {
  if (s.energy?.netRate != null) return s.energy.netRate;
  if (i === 0) return null;
  const prev = H[i - 1], dt = s.tick - prev.tick;
  return dt > 0 ? (s.energy.avail - prev.energy.avail) / dt : null;
});
new Chart(document.getElementById('cRate'), {
  type: 'line',
  data: {
    labels: ticks,
    datasets: [{
      label: 'e/tick',
      data: rates,
      segment: {
        borderColor: ctx => ctx.p0.parsed.y >= 0 ? '#4caf50' : '#f44336',
        backgroundColor: ctx => ctx.p0.parsed.y >= 0 ? 'rgba(76,175,80,.15)' : 'rgba(244,67,54,.15)',
      },
      fill: 'origin', pointRadius: 0, tension: .3,
    }],
  },
  options: { ...BASE_OPTS, scales: {
    x: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, maxTicksLimit: 8 } },
    y: { ...AXIS_DEFAULTS, ticks: { color: '#8b949e', callback: v => v.toFixed(2) },
      title: { display: true, text: 'e/tick', color: '#8b949e', font: { size: 10 } } },
  }},
});

// ── Structures built ────────────────────────────────────────────────────────
const STRUCT_COLORS = {
  extensions: '#2196f3', containers: '#4caf50', towers: '#f44336',
  ramparts: '#795548', roads: '#607d8b',
};
new Chart(document.getElementById('cStructs'), {
  type: 'line',
  data: {
    labels: ticks,
    datasets: Object.entries(STRUCT_COLORS).map(([key, color]) => ({
      label: key,
      data: H.map(s => s.structs?.[key] ?? 0),
      borderColor: color, pointRadius: 0, tension: .3,
    })),
  },
  options: { ...BASE_OPTS, scales: {
    x: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, maxTicksLimit: 8 } },
    y: { ...AXIS_DEFAULTS, min: 0, ticks: { color: '#8b949e', stepSize: 1 } },
  }},
});

// ── Economy bottleneck ──────────────────────────────────────────────────────
const BOTTLENECK_ENC = { BALANCED: 0, HARVESTER_SHORTAGE: 1, HAULER_SHORTAGE: 2, SOURCE_MAXED: 3 };
const BOTTLENECK_COLORS = ['#4caf50', '#ff9800', '#2196f3', '#f44336'];
const BOTTLENECK_LABELS = ['BALANCED', 'HARVESTER_SHORTAGE', 'HAULER_SHORTAGE', 'SOURCE_MAXED'];
new Chart(document.getElementById('cBottleneck'), {
  type: 'line',
  data: {
    labels: ticks,
    datasets: [{
      label: 'Bottleneck',
      data: H.map(s => s.energy?.bottleneck != null ? (BOTTLENECK_ENC[s.energy.bottleneck] ?? null) : null),
      segment: { borderColor: ctx => BOTTLENECK_COLORS[ctx.p0.parsed.y] ?? '#8b949e' },
      borderWidth: 2, pointRadius: 0, stepped: 'before',
    }],
  },
  options: { ...BASE_OPTS, scales: {
    x: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, maxTicksLimit: 8 } },
    y: { ...AXIS_DEFAULTS, min: -0.3, max: 3.3,
      ticks: { color: '#8b949e', callback: v => BOTTLENECK_LABELS[v] ?? '' } },
  }},
});

// ── Regime history table ────────────────────────────────────────────────────
{
  const segs = [];
  for (const s of H) {
    const r = s.regime ?? 'initial';
    const last = segs.at(-1);
    if (!last || r !== last.name) segs.push({ name: r, start: s.tick, end: s.tick, snaps: 1 });
    else { last.end = s.tick; last.snaps++; }
  }
  const rows = segs.map(function(seg, i) {
    const isCur = i === segs.length - 1;
    const dur   = seg.end - seg.start;
    const label = seg.name === 'initial' ? 'initial' : seg.name;
    const short = seg.name.replace(/^\d{4}-\d{2}-\d{2}-/, '');
    return '<tr>' +
      '<td class="' + (isCur ? 'cur' : '') + '" title="' + label + '">' + (isCur ? '&#9654; ' : '') + short + '</td>' +
      '<td>' + seg.start.toLocaleString() + '</td>' +
      '<td>' + (isCur ? '<em>ongoing</em>' : seg.end.toLocaleString()) + '</td>' +
      '<td>' + dur.toLocaleString() + ' ticks</td>' +
      '<td>' + seg.snaps + '</td>' +
      '</tr>';
  }).reverse().join('');
  document.getElementById('regimeHistory').innerHTML =
    '<table class="rtable"><thead><tr>' +
    '<th>Regime</th><th>Start tick</th><th>End tick</th><th>Duration</th><th>Snaps</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
}

// ── Phase & combat state (encoded as numeric bands) ─────────────────────────
const PHASE_ENC  = { ECONOMY: 0, ASSESS: 1, RUSH: 2, DEFEND: 3 };
const COMBAT_ENC = { RALLY: 0, MARCH: 1, ENGAGE: 2 };
new Chart(document.getElementById('cPhase'), {
  type: 'line',
  data: {
    labels: ticks,
    datasets: [
      { label: 'Phase', data: H.map(s => PHASE_ENC[s.phase] ?? 0),
        borderColor: '#58a6ff', yAxisID: 'yPhase', pointRadius: 0, stepped: 'before', borderWidth: 2 },
      { label: 'Combat', data: H.map(s => COMBAT_ENC[s.combat?.state] ?? 0),
        borderColor: '#f78166', yAxisID: 'yCombat', pointRadius: 0, stepped: 'before', borderWidth: 2 },
    ]
  },
  options: { ...BASE_OPTS, scales: {
    x: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, maxTicksLimit: 8 } },
    yPhase: { ...AXIS_DEFAULTS, position: 'left', min: -0.3, max: 3.3,
      ticks: { color: '#8b949e', callback: v => ['ECONOMY','ASSESS','RUSH','DEFEND'][v] ?? '' } },
    yCombat: { ...AXIS_DEFAULTS, position: 'right', min: -0.3, max: 2.3,
      ticks: { color: '#f78166', callback: v => ['RALLY','MARCH','ENGAGE'][v] ?? '' },
      grid: { drawOnChartArea: false } },
  }},
});

// ════════════════════════════════════════════════════════════════════════════
// SIMULATION PROJECTION CHARTS
// ════════════════════════════════════════════════════════════════════════════

if (SIM) {
  const relTicks = SIM.checkpoints;

  // ── Fan chart helper ───────────────────────────────────────────────────────
  // Renders a 2-band (p10/p90 outer, p25/p75 inner) fan chart with a p50 median line.
  // Dataset fill indices: p90 fills→index 0 (p10), p75 fills→index 2 (p25).
  function makeFanChart(canvasId, bands, yTickFmt) {
    new Chart(document.getElementById(canvasId), {
      type: 'line',
      data: {
        labels: relTicks,
        datasets: [
          // index 0 — p10 lower bound (transparent, base for outer fill)
          { label: 'p10', data: bands.p10, borderColor: 'transparent', fill: false, pointRadius: 0 },
          // index 1 — p90 outer upper: fills to index 0 (p10)
          { label: 'p90', data: bands.p90, borderColor: 'transparent',
            backgroundColor: 'rgba(88,166,255,0.10)', fill: 0, pointRadius: 0 },
          // index 2 — p25 inner lower (transparent, base for inner fill)
          { label: 'p25', data: bands.p25, borderColor: 'transparent', fill: false, pointRadius: 0 },
          // index 3 — p75 inner upper: fills to index 2 (p25) — darker inner band
          { label: 'p75', data: bands.p75, borderColor: 'transparent',
            backgroundColor: 'rgba(88,166,255,0.16)', fill: 2, pointRadius: 0 },
          // index 4 — p50 median line (visible)
          { label: 'Median (p50)', data: bands.p50, borderColor: '#58a6ff', borderWidth: 2,
            borderDash: [6, 3], fill: false, pointRadius: 0, tension: 0.3 },
        ],
      },
      options: {
        animation: false,
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            labels: { color: '#8b949e', font: { size: 11 }, boxWidth: 12,
              filter: item => ['Median (p50)'].includes(item.text) },
          },
          tooltip: {
            callbacks: {
              title: ctx => '+' + relTicks[ctx[0].dataIndex].toLocaleString() + ' ticks',
              label: ctx => {
                const labels = { 'p10': 'Worst 10%', 'p25': 'Lower 25%', 'p75': 'Upper 75%', 'p90': 'Best 90%', 'Median (p50)': 'Median' };
                return (labels[ctx.dataset.label] ?? ctx.dataset.label) + ': ' + (yTickFmt ? yTickFmt(ctx.parsed.y) : ctx.parsed.y);
              },
            },
          },
        },
        scales: {
          x: { ticks: { color: '#8b949e', maxTicksLimit: 8, callback: (_v, i) => '+' + relTicks[i] + 't' }, grid: { color: '#21262d' } },
          y: { ticks: { color: '#8b949e', callback: yTickFmt ?? (v => v) }, grid: { color: '#21262d' }, min: 0 },
        },
      },
    });
  }

  makeFanChart('cSimEnergy', SIM.energy,  v => Math.round(v));
  makeFanChart('cSimCtrl',   SIM.ctrlPct, v => v + '%');

  // ── Build order comparison (horizontal grouped bar) ─────────────────────
  const boColors = ['#58a6ff', '#4caf50', '#ff9800'];
  new Chart(document.getElementById('cBuildOrders'), {
    type: 'bar',
    data: {
      labels: SIM.buildOrders.map(b => b.label),
      datasets: [
        { label: 'Ctrl % at t+2000',    data: SIM.buildOrders.map(b => b.ctrlPctAt2000),               backgroundColor: boColors[0] + 'bb' },
        { label: 'Energy Stability %',  data: SIM.buildOrders.map(b => Math.round(b.stabilityScore * 100)), backgroundColor: boColors[1] + 'bb' },
        { label: 'P(RCL3 in 2000t) %', data: SIM.buildOrders.map(b => Math.round(b.rcl3Prob * 100)),   backgroundColor: boColors[2] + 'bb' },
      ],
    },
    options: {
      indexAxis: 'y',
      animation: false,
      responsive: true,
      plugins: {
        legend: { labels: { color: '#8b949e', font: { size: 11 }, boxWidth: 12 } },
        tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + ctx.parsed.x + '%' } },
      },
      scales: {
        x: { ticks: { color: '#8b949e', callback: v => v + '%' }, grid: { color: '#21262d' }, min: 0, max: 100 },
        y: { ticks: { color: '#c9d1d9' }, grid: { color: '#21262d' } },
      },
    },
  });

  // Build order description cards
  document.getElementById('boDescriptions').innerHTML = SIM.buildOrders.map((b, i) => {
    const rank = ['🥇','🥈','🥉',''][i] ?? '';
    return '<div class="bo-desc"><strong>' + rank + ' ' + b.label + '</strong><span>' + b.description + '</span></div>';
  }).join('');
}
</script>
</body>
</html>`;
}
