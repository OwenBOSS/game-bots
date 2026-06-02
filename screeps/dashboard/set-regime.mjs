#!/usr/bin/env node
// Sets the regime name before a deploy so all subsequent snapshots are tagged.
// Called automatically by `just deploy`. Do not run manually.
//
// Usage: node dashboard/set-regime.mjs [strategy] [description]

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT        = join(__dirname, '..');
const REGIME_TS   = join(ROOT, 'strategies', 'adaptive', 'src', 'regime.ts');
const REGIMES_JSON = join(ROOT, 'regimes.json');

const strat       = process.argv[2] ?? 'adaptive';
const description = process.argv.slice(3).join(' ');

// Get git hash from the repo root (two levels up from screeps/)
const repoRoot = join(ROOT, '..');
const hash = execSync('git rev-parse --short HEAD', { cwd: repoRoot }).toString().trim();
const date = new Date().toISOString().slice(0, 10);
const regimeName = `${date}-${hash}`;

// Load existing log; skip if this exact hash is already the latest entry
let regimes = [];
if (existsSync(REGIMES_JSON)) {
  try { regimes = JSON.parse(readFileSync(REGIMES_JSON, 'utf-8')); } catch {}
}
const latest = regimes.at(-1);
if (latest?.gitHash === hash && latest?.strategy === strat) {
  console.log(`Regime unchanged: ${regimeName} (${strat})`);
} else {
  regimes.push({ name: regimeName, strategy: strat, description, deployedAt: new Date().toISOString(), gitHash: hash });
  writeFileSync(REGIMES_JSON, JSON.stringify(regimes, null, 2));
  console.log(`Regime logged: ${regimeName} (${strat})${description ? ' — ' + description : ''}`);
}

// Update regime.ts only for adaptive (other strategies don't embed it)
if (strat === 'adaptive') {
  writeFileSync(REGIME_TS,
    `// Updated automatically by \`just deploy\` — do not edit manually\nexport const REGIME = '${regimeName}';\n`
  );
  console.log(`regime.ts updated → '${regimeName}'`);
}
