#!/usr/bin/env node
// Pulls Memory.statsLog from the Screeps Season shard, appends to season10-history.json,
// and regenerates season10.html with historical charts.
//
// Requires: $env:SCREEPS_TOKEN = "your-api-token"
//   Get your token at: https://screeps.com/a/#!/account/auth-tokens
//   Or create screeps/.env with SCREEPS_TOKEN=... (loaded automatically)

import { gunzipSync } from 'zlib';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = join(__dirname, 'data');
const HISTORY   = join(DATA_DIR, 'season10-history.json');
const ROOM_LAYOUT = join(DATA_DIR, 'season10-room-layout.json');
const DASHBOARD = join(__dirname, 'season10.html');
const TOKEN        = process.env.SCREEPS_TOKEN;
const SEASON_API   = 'https://screeps.com/season/api';

if (!TOKEN) {
  console.error('SCREEPS_TOKEN is not set.');
  console.error('  Get your token: https://screeps.com/a/#!/account/auth-tokens');
  console.error('  PowerShell:     $env:SCREEPS_TOKEN = "your-token"');
  console.error('  Or add it to:   screeps/.env  (will be gitignored)');
  process.exit(1);
}

async function fetchMemoryPath(path) {
  const url = `${SEASON_API}/user/memory?path=${encodeURIComponent(path)}&shard=shardSeason`;
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

mkdirSync(DATA_DIR, { recursive: true });
let history = [];
if (existsSync(HISTORY)) {
  try { history = JSON.parse(readFileSync(HISTORY, 'utf-8')); } catch {}
}

console.log(`Fetching Memory.statsLog from season server...`);
let statsLog;
try { statsLog = await fetchMemoryPath('statsLog'); }
catch (err) { console.error('Fetch failed:', err.message); process.exit(1); }

if (!Array.isArray(statsLog)) {
  console.error('Memory.statsLog is not an array. Is the season10 bot running?', statsLog);
  process.exit(1);
}

const seen  = new Set(history.map(s => s.tick));
const fresh = statsLog.filter(s => !seen.has(s.tick));
history = [...history, ...fresh].sort((a, b) => a.tick - b.tick);
writeFileSync(HISTORY, JSON.stringify(history, null, 2));
console.log(`+${fresh.length} new snapshots — total: ${history.length}`);

console.log('Fetching Memory.roomLayout...');
let roomLayout = null;
try { roomLayout = await fetchMemoryPath('roomLayout'); }
catch (err) { console.warn('Room layout fetch skipped:', err.message); }
if (roomLayout && typeof roomLayout === 'object' && Object.keys(roomLayout).length > 0) {
  writeFileSync(ROOM_LAYOUT, JSON.stringify(roomLayout, null, 2));
  console.log(`Room layout saved: ${Object.keys(roomLayout).join(', ')}`);
} else {
  console.log('Room layout not yet in Memory — deploy bot and wait ~1000 ticks');
  if (existsSync(ROOM_LAYOUT)) {
    try { roomLayout = JSON.parse(readFileSync(ROOM_LAYOUT, 'utf-8')); } catch {}
  }
}

writeFileSync(DASHBOARD, buildDashboard(history, roomLayout));
console.log(`Dashboard written → open screeps/dashboard/season10.html`);

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard HTML generator
// ═══════════════════════════════════════════════════════════════════════════

function buildDashboard(snapshots, roomLayout = null) {
  const latest    = snapshots.at(-1) ?? {};
  const firstTick = snapshots[0]?.tick ?? 0;
  const lastTick  = snapshots.at(-1)?.tick ?? 0;

  const allRoles = [...new Set(snapshots.flatMap(s => Object.keys(s.creeps ?? {})))];

  const ROLE_COLORS = {
    harvester:  '#4caf50',
    hauler:     '#2196f3',
    upgrader:   '#9c27b0',
    builder:    '#ff9800',
    collector:  '#ffd700',
    scout:      '#00bcd4',
    defender:   '#f44336',
    repairer:   '#795548',
  };

  const totalCreeps = Object.values(latest.creeps ?? {}).reduce((a, b) => a + b, 0);
  const collCount   = latest.collectors?.count ?? (latest.creeps?.collector ?? 0);
  const collQuota   = latest.collectors?.quota ?? '?';
  const scoreRooms  = latest.scores?.activeRooms ?? 0;
  const cacheSize   = latest.scores?.cacheSize ?? 0;
  const totalVal    = latest.scores?.totalValue ?? 0;

  const kpis = [
    { val: latest.rcl ?? '?',                             lbl: 'RCL' },
    { val: (latest.energy?.avail ?? 0).toLocaleString(),  lbl: 'Energy' },
    { val: totalCreeps,                                    lbl: 'Creeps' },
    { val: `${collCount}/${collQuota}`,                    lbl: 'Collectors' },
    { val: scoreRooms,                                     lbl: 'Score Rooms' },
    { val: cacheSize,                                      lbl: 'Score Cache' },
    { val: totalVal.toLocaleString(),                      lbl: 'Total Value' },
    { val: snapshots.length,                               lbl: 'Snapshots' },
  ];

  const kpiHtml = kpis.map(k =>
    `<div class="kpi"><div class="val">${k.val}</div><div class="lbl">${k.lbl}</div></div>`
  ).join('');

  const dataJson   = JSON.stringify(snapshots);
  const roleColors = JSON.stringify(ROLE_COLORS);
  const roleList   = JSON.stringify(allRoles);
  const layoutJson = JSON.stringify(roomLayout);

  // ── Latest top score rooms table ─────────────────────────────────────────
  const topRooms = latest.scores?.topRooms ?? [];
  const topRoomsHtml = topRooms.length
    ? `<table class="rtable" style="min-width:260px">
        <thead><tr><th>Room</th><th>Score</th></tr></thead>
        <tbody>${topRooms.map((r, i) =>
          `<tr><td style="color:${i === 0 ? '#ffd700' : '#c9d1d9'}">${r.room}</td><td style="color:#58a6ff">${r.score.toLocaleString()}</td></tr>`
        ).join('')}</tbody>
      </table>`
    : '<p style="color:#8b949e;font-size:.8em">No score rooms detected yet</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Screeps Season 10 Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Courier New',monospace;background:#0d1117;color:#c9d1d9;padding:20px}
h1{color:#ffd700;font-size:1.3em;margin-bottom:3px}
.meta{color:#8b949e;font-size:.78em;margin-bottom:14px}
.kpis{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px}
.kpi{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:9px 14px;min-width:95px}
.kpi .val{font-size:1.4em;font-weight:bold;color:#ffd700}
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
@media(max-width:680px){.grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<h1>Screeps Season 10 Dashboard</h1>
<div class="meta">Shard: shardSeason &middot; Ticks ${firstTick.toLocaleString()}&ndash;${lastTick.toLocaleString()} &middot; ${snapshots.length} snapshots (every 200 ticks) &middot; last tick ${lastTick.toLocaleString()}</div>
<div class="kpis">${kpiHtml}</div>
<div class="grid">
  <div class="card"><h2>Spawn Energy Available</h2><canvas id="cEnergy"></canvas></div>
  <div class="card"><h2>Creep Roster</h2><canvas id="cCreeps"></canvas></div>
  <div class="card"><h2>Score Rooms Active</h2><canvas id="cScoreRooms"></canvas></div>
  <div class="card"><h2>Score Cache &amp; Total Value</h2><canvas id="cScoreValue"></canvas></div>
  <div class="card"><h2>Collector Count vs Quota</h2><canvas id="cCollectors"></canvas></div>
  <div class="card"><h2>Structures Built</h2><canvas id="cStructs"></canvas></div>
  <div class="card" style="grid-column:1/-1"><h2>Current Top Score Rooms</h2>${topRoomsHtml}</div>
  <div class="card" style="grid-column:1/-1"><h2>Room Layout</h2><div id="roomLayouts"></div></div>
</div>

<script>
const H = ${dataJson};
const ROLE_COLORS = ${roleColors};
const ALL_ROLES   = ${roleList};
const LAYOUT      = ${layoutJson};

// ── Room layout maps ────────────────────────────────────────────────────────
{
  const CH_COLOR = { '#':'#3a3a3a', '~':'#1a3a1a', '.':'#111', 'r':'#607d8b',
    'c':'#795548', 'e':'#2196f3', 'L':'#00bcd4', 'K':'#9c27b0',
    'T':'#f44336', 'C':'#ffd700', 'S':'#4caf50', 'O':'#58a6ff', '*':'#ff9800' };
  const CH_LABEL = { '#':'wall','~':'swamp','.':'plain','r':'road','c':'container',
    'e':'extension','L':'link','K':'storage','T':'tower','C':'controller','S':'source',
    'O':'spawn','*':'site' };
  const el = document.getElementById('roomLayouts');
  if (!LAYOUT || !Object.keys(LAYOUT).length) {
    el.innerHTML = '<p style="color:#8b949e;font-size:.8em">Not yet captured — deploy bot and wait ~1000 ticks, then run fetch-stats-season10</p>';
  } else {
    el.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start">' +
      Object.values(LAYOUT).map(room => {
        const colored = room.ascii.split('\\n').map(line =>
          line.split('').map(ch => '<span style="color:' + (CH_COLOR[ch] || '#c9d1d9') + '">' + ch + '</span>').join('')
        ).join('\\n');
        const legend = Object.entries(CH_LABEL).map(([ch, lbl]) =>
          '<span style="color:' + (CH_COLOR[ch] || '#c9d1d9') + ';margin-right:12px">' + ch + ' ' + lbl + '</span>'
        ).join('');
        const counts = [
          room.spawns.length + ' spawn',
          room.sources.length + ' sources',
          room.extensions.length + ' ext',
          room.containers.length + ' containers',
          room.towers.length + ' towers',
          room.roads.length + ' roads',
          room.sites.length + ' sites pending',
        ].join(' · ');
        return '<div>' +
          '<h3 style="color:#ffd700;font-size:.85em;margin-bottom:4px">' + room.room + ' · RCL ' + room.rcl + ' · tick ' + room.tick.toLocaleString() + '</h3>' +
          '<div style="font-size:.68em;color:#8b949e;margin-bottom:6px">' + counts + '</div>' +
          '<div style="font-size:.65em;color:#8b949e;margin-bottom:6px;flex-wrap:wrap;display:flex;gap:4px">' + legend + '</div>' +
          '<pre style="font-size:10px;line-height:1.0;letter-spacing:3.5px;font-family:monospace;background:#000;padding:8px;border-radius:4px;overflow:auto;display:inline-block">' + colored + '</pre>' +
          '</div>';
      }).join('') + '</div>';
  }
}

if (!H.length) {
  document.body.insertAdjacentHTML('beforeend','<p class="empty">No data yet — run: just fetch-stats-season10</p>');
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

// ── Spawn Energy ────────────────────────────────────────────────────────────
new Chart(document.getElementById('cEnergy'), {
  type: 'line',
  data: {
    labels: ticks,
    datasets: [
      { label: 'Available', data: H.map(s => s.energy?.avail ?? 0),
        borderColor: '#ffd700', backgroundColor: 'rgba(255,215,0,.15)',
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

// ── Creep Roster (stacked area) ─────────────────────────────────────────────
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

// ── Score Rooms Active ──────────────────────────────────────────────────────
new Chart(document.getElementById('cScoreRooms'), {
  type: 'line',
  data: {
    labels: ticks,
    datasets: [
      { label: 'Active Rooms', data: H.map(s => s.scores?.activeRooms ?? 0),
        borderColor: '#ffd700', backgroundColor: 'rgba(255,215,0,.15)',
        fill: true, pointRadius: 0, tension: .3 },
      { label: 'Known Rooms', data: H.map(s => s.observer?.knownRooms ?? null),
        borderColor: '#00bcd4', pointRadius: 0, tension: .3 },
    ]
  },
  options: { ...BASE_OPTS, scales: {
    x: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, maxTicksLimit: 8 } },
    y: { ...AXIS_DEFAULTS, min: 0, ticks: { color: '#8b949e', stepSize: 1 } },
  }},
});

// ── Score Cache Size & Total Value ──────────────────────────────────────────
new Chart(document.getElementById('cScoreValue'), {
  type: 'line',
  data: {
    labels: ticks,
    datasets: [
      { label: 'Cache Size', data: H.map(s => s.scores?.cacheSize ?? 0),
        borderColor: '#ff9800', yAxisID: 'yCache', pointRadius: 0, tension: .3 },
      { label: 'Total Value', data: H.map(s => s.scores?.totalValue ?? 0),
        borderColor: '#4caf50', backgroundColor: 'rgba(76,175,80,.15)',
        fill: true, yAxisID: 'yValue', pointRadius: 0, tension: .3 },
    ]
  },
  options: { ...BASE_OPTS, scales: {
    x: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, maxTicksLimit: 8 } },
    yCache: { ...AXIS_DEFAULTS, position: 'left', min: 0,
      ticks: { color: '#ff9800', stepSize: 1 },
      title: { display: true, text: 'Cache Entries', color: '#8b949e', font: { size: 10 } } },
    yValue: { ...AXIS_DEFAULTS, position: 'right', min: 0,
      ticks: { color: '#4caf50', callback: v => v.toLocaleString() },
      grid: { drawOnChartArea: false },
      title: { display: true, text: 'Total Value', color: '#8b949e', font: { size: 10 } } },
  }},
});

// ── Collector Count vs Quota ────────────────────────────────────────────────
new Chart(document.getElementById('cCollectors'), {
  type: 'line',
  data: {
    labels: ticks,
    datasets: [
      { label: 'Collectors',
        data: H.map(s => s.collectors?.count ?? (s.creeps?.collector ?? 0)),
        borderColor: '#ffd700', backgroundColor: 'rgba(255,215,0,.15)',
        fill: true, pointRadius: 0, tension: .3 },
      { label: 'Quota',
        data: H.map(s => s.collectors?.quota ?? null),
        borderColor: '#f44336', borderDash: [4, 4], pointRadius: 0, tension: .3 },
    ]
  },
  options: { ...BASE_OPTS, scales: {
    x: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, maxTicksLimit: 8 } },
    y: { ...AXIS_DEFAULTS, min: 0, ticks: { color: '#8b949e', stepSize: 1 } },
  }},
});

// ── Structures Built ────────────────────────────────────────────────────────
const STRUCT_COLORS = {
  extensions: '#2196f3', containers: '#4caf50', towers: '#f44336', roads: '#607d8b',
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
</script>
</body>
</html>`;
}
