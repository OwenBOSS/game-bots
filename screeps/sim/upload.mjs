// Push simulation output into Screeps Memory.simOutput so the live bot can read recommendations.
//
// The Screeps POST /api/user/memory endpoint writes arbitrary JSON to a Memory path.
// We keep the payload compact — the bot only needs recommendations and projections, not
// the full percentile bands (those are for the local dashboard only).

import { gzipSync } from 'zlib';

/**
 * Upload sim results to Memory.simOutput on the specified shard.
 *
 * @param {object} simData   - Output from runMonteCarlo()
 * @param {object} opts
 * @param {string}  opts.token    - Screeps API token (SCREEPS_TOKEN)
 * @param {string}  opts.shard    - Target shard (default: 'shard3')
 * @param {boolean} opts.silent   - Suppress console output
 * @returns {Promise<boolean>}    - true on success
 */
export async function uploadSimOutput(simData, { token, shard = 'shard3', silent = false } = {}) {
  if (!token)   { if (!silent) console.warn('SCREEPS_TOKEN not set — skipping Memory upload'); return false; }
  if (!simData) { if (!silent) console.warn('No sim data — skipping Memory upload'); return false; }

  // Compact payload — only what's useful to the bot in-game.
  // Keep it small to avoid saturating the Memory write budget.
  const payload = {
    updatedAt:        simData.baseTick,
    rcl3Prob:         simData.milestones.rcl3.probWithin2000t,
    energyCrisisRate: simData.milestones.energyCrisisRate,
    buildOrderWinner: simData.buildOrders[0]?.key ?? null,
    projections: {
      at500:  extractProjection(simData, 500),
      at2000: extractProjection(simData, 2000),
    },
    // At most 5 recommendations — HIGH first, then MEDIUM
    recommendations: simData.recommendations
      .slice()
      .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
      .slice(0, 5)
      .map(r => ({ priority: r.priority, action: r.action ?? r.role ?? r.type, reason: r.reason })),
  };

  // Compress if the JSON is large enough to warrant it (Memory writes have a ~10 KB cap)
  const json = JSON.stringify(payload);
  const value = json.length > 800
    ? 'gz:' + gzipSync(Buffer.from(json, 'utf-8')).toString('base64')
    : payload;

  try {
    const res = await fetch('https://screeps.com/api/user/memory', {
      method:  'POST',
      headers: { 'X-Token': token, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ path: 'simOutput', value, shard }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
    const body = await res.json();
    if (!body.ok) throw new Error(JSON.stringify(body));

    if (!silent) {
      console.log(`Uploaded Memory.simOutput (${json.length} bytes → shard ${shard})`);
      if (payload.recommendations.length) {
        console.log(`  Top rec: [${payload.recommendations[0].priority}] ${payload.recommendations[0].action}`);
      }
    }
    return true;
  } catch (e) {
    if (!silent) console.warn(`Memory upload failed: ${e.message}`);
    return false;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractProjection(simData, relativeTick) {
  const idx = simData.checkpoints.indexOf(relativeTick);
  if (idx < 0) return null;
  return {
    energyP10:  simData.energy.p10[idx],
    energyP50:  simData.energy.p50[idx],
    energyP90:  simData.energy.p90[idx],
    ctrlPctP50: simData.ctrlPct.p50[idx],
  };
}

const PRIORITY_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2, INFO: 3 };
function priorityRank(p) { return PRIORITY_ORDER[p] ?? 9; }
