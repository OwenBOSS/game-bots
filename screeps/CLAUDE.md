# Screeps Bots

## Purpose
TypeScript bots for Screeps World (shard3) and Season 10 free event. One deployable strategy per subfolder; each compiles to a single `dist/main.js` bundled by rollup.

## Active Strategy
`strategies/adaptive/` — the production bot. ECONOMY→ASSESS→RUSH/DEFEND phase machine with 9 creep roles and dynamic body scaling.

## Deploy Workflow
```bash
cd strategies/<name>
npm install
npm run deploy   # builds TypeScript → copies dist/main.js to AppData Screeps branch
```
Scripts land at: `C:\Users\owenb\AppData\Local\Screeps\scripts\screeps.com\<strategy-name>\`

## Strategy Branches
| Folder | Screeps Branch | Purpose |
|--------|---------------|---------|
| `adaptive` | adaptive | Production bot |
| `economy-first` | economy-first | Economy baseline |
| `rush` | rush | Aggressive early attack |
| `season10` | season10 | Score-collection (Season events) |

## Key Design Decisions
- **Stationary harvesters** park on source containers; **haulers** do energy delivery
- **bodyBuilder.ts** scales all creep bodies to available energy budget dynamically
- **9 roles** cover all Screeps body part types; see `strategies/adaptive/src/roles/`
- **Expansion** auto-triggers at RCL 4 + available GCL slot
- **Tower management** built into combatManager (attack enemies → repair structures)

## Analytics
In-game: `JSON.stringify(Memory.statsLog)` dumps rolling stats history (last ~500 snapshots).
For deeper review: see `AGENTS.md` and `scripts/review_strategy.py`.

## References
- `docs/getting-started.md` — Screeps concepts and API patterns
- `docs/screeps-world-api.md` — key API patterns and gotchas
- `experiments/` — logged test runs
- `AGENTS.md` — strategy review agent spec
