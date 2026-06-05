import { readFileSync } from 'fs';

const token = process.env.SCREEPS_TOKEN;
if (!token) {
  console.error('Error: SCREEPS_TOKEN environment variable is not set.');
  console.error('Get your token at: https://screeps.com/a/#!/account/auth-tokens');
  process.exit(1);
}

// Branch can be overridden by env var or CLI arg
const branch = process.env.SCREEPS_BRANCH ?? process.argv[2] ?? 'adaptive';

const code = readFileSync('dist/main.js', 'utf-8');

console.log(`Deploying to branch: ${branch}`);

const res = await fetch('https://screeps.com/api/user/code', {
  method: 'POST',
  headers: {
    'X-Token': token,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    branch,
    modules: { main: code },
  }),
});

const body = await res.json();

if (!res.ok || body.error) {
  console.error(`Deploy failed (HTTP ${res.status}):`, body.error ?? body);
  process.exit(1);
}

console.log(`Deployed successfully to branch: ${branch}`);
