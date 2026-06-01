# experiments/

## Purpose
Log files for each strategy test run — what was tried, what happened, what to try next.

## Conventions
One file per experiment: `YYYY-MM-DD-description.md`

## Key Fields to Log
- Starting tick and ending tick
- Phase reached (ECONOMY/RUSH/DEFEND)
- RCL at end
- Enemy rooms encountered and outcomes
- Controller progress rate (XP/tick)
- Energy efficiency (avail% over time from statsLog)

## Linking Stats
Dump `Memory.statsLog` from Screeps console and attach to the experiment file for analysis:
```js
// In Screeps console:
JSON.stringify(Memory.statsLog)
```
Then paste into the experiment file or feed to `scripts/review_strategy.py`.
