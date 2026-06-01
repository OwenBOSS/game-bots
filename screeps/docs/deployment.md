# Deployment Guide

## Local Deploy (recommended workflow)

The Screeps desktop client reads scripts from:
```
C:\Users\owenb\AppData\Local\Screeps\scripts\screeps.com\default\
```

Build and copy in one step:

```bash
cd strategies/<strategy-name>
npm install
npm run deploy
# Builds dist/main.js and copies it to the local Screeps scripts folder
```

The game will pick up `main.js` the next time it runs.  
**The scripts folder is managed by the Screeps client — only run `npm run deploy` yourself, don't let automation write there.**

---

## Option 1: Manual Upload (web UI)

1. Open [screeps.com](https://screeps.com) and log in
2. Go to **My Profile > Script** or click the code editor
3. Create a new branch or use `default`
4. Copy the contents of `dist/main.js` and paste into the editor's `main` file
5. Save and activate the branch

## Option 2: CLI Deploy with `.screeps.yaml`

Install the official CLI tool and create a config file at `strategies/<name>/.screeps.yaml`:

```yaml
email: your@email.com
password: yourpassword
branch: default
ptr: false
```

Add to `package.json` scripts:
```json
"deploy": "rollup -c && screeps-api push -c .screeps.yaml"
```

Then: `npm run deploy`

## Option 3: Use the Simulation

Before paying/uploading to the live server, test in the **in-browser simulation**:
- No account needed for simulation
- Go to screeps.com, open Simulation mode
- Paste your `dist/main.js` directly

## Watching Console Output

In the Screeps game interface, open the **Console** tab.  
Use `console.log(...)` in your bot code to debug:

```typescript
console.log(`Tick ${Game.time}: ${myCreeps.length} creeps`);
```

## Branching Strategy

Use the Screeps branch system to test safely:

| Branch | Purpose |
|--------|---------|
| `default` | Production / live bot |
| `economy-test` | Testing economy-first |
| `rush-test` | Testing rush strategy |
| `adaptive-test` | Testing adaptive bot |

Create new branches in the Screeps script editor before deploying experiments.
