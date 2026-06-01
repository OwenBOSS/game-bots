# Screeps World Bots

TypeScript bots for [Screeps World](https://screeps.com) — the persistent MMO programming game.

## Structure

```
screeps/
├── docs/                          # Game mechanics, API notes, deployment guide
├── experiments/                   # Experiment logs and results
├── strategies/
│   ├── economy-first/             # Maximize energy economy before fighting
│   ├── rush/                      # Fast aggression, minimal economy
│   └── adaptive/                  # Scout-based strategy selection
└── tsconfig.base.json             # Shared TypeScript config
```

## Quick Start

Each strategy is an independent package. To build one:

```bash
cd strategies/economy-first
npm install
npm run build
# dist/main.js is ready to upload
```

## Deploying

1. Build the strategy you want to use (`npm run build`)
2. In the Screeps World UI, open the Script editor
3. Upload `dist/main.js` as `main` — or use `npm run deploy` if you set up `.screeps.yaml`

See [docs/deployment.md](docs/deployment.md) for the full deploy workflow including the CLI.

## Strategies

| Strategy | Goal | Strength | Weakness |
|----------|------|----------|----------|
| `economy-first` | Build creep economy, then dominate | Scales well, hard to stop late | Slow start |
| `rush` | Attack fast before enemy is established | Wins early against unprepared players | Loses if enemy is ready |
| `adaptive` | Scout enemy, pick the right mode | Flexible, hard to counter | More complex, slower decisions |

## Adding a New Strategy

1. Copy an existing strategy folder
2. Update `package.json` name
3. Modify `src/main.ts` and role files
4. Log results in `experiments/`
