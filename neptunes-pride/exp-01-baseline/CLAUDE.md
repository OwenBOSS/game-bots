# exp-01-baseline/

## Purpose
First strategy experiment. Economy-first with weapons research priority.
Read-only mode: prints recommendations but does not issue orders yet.
Order endpoints need to be confirmed via browser DevTools before wiring in.

## Strategy
1. **Economy**: buy cheapest economy upgrade whenever ROI ≤ 6 cycles and cash allows
2. **Research**: weapons → terraforming → propulsion → scanning (see np_lib/economy.py)
3. **Attack**: rank enemy/unowned stars by capture_score; flag top targets
4. **Defense**: flag any owned star with garrison < 10 that borders an enemy

## Files
- `strategy.py` — decision functions; returns recommendations, never side-effects
- `run.py` — poll loop: login → fetch state → call strategy → print report

## Run
```bash
cd neptunes-pride
uv run python exp-01-baseline/run.py
```

## Next experiment
Once order endpoints are confirmed, create `exp-02-orders/` that actually
issues the economy upgrades and research changes decided here.
