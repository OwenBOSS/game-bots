# neptunes-pride/

## Purpose
Python bot for Neptune's Pride: Triton, game **7769**. Polls game state, models
combat and economy decisions, and issues orders via the undocumented game API.

## Structure
```
neptunes-pride/
├── np_lib/           shared library: client, models, combat sim, economy math
├── notes/            research notes, API reference, experiment logs
└── exp-XX-name/      one folder per strategy experiment
    ├── strategy.py   decision logic for this experiment
    └── run.py        entry point — runs the bot loop
```

## Run
```bash
cd neptunes-pride
uv sync
cp .env.example .env   # fill in credentials
uv run python exp-01-baseline/run.py
```

## API
- Base: `https://np.ironhelmet.com`
- Auth: `POST /arequest/login` (form-encoded: alias, password, type=login) → session cookie
- State: `POST /trequest/order` (order=full_universe_report, game_number=7769) → scanning_data
- Orders: same `/trequest/order` endpoint with different `order` values — see `notes/api.md`

## Key facts
- Game number: **7769**
- Our player UID: detected at runtime (only our player has `cash` + `researching` visible)
- Defender gets **+1 weapons** bonus; ties go to defender
- Star field `r` = effective resources (nr + terraforming bonus); used for upgrade cost math
- Upgrade cost in the live JSON is in star field `c` — use that, not a formula
