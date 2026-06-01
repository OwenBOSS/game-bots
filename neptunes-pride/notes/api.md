# Neptune's Pride API Reference

Reverse-engineered from community clients. Entirely undocumented and subject to change.

## Base URL
`https://np.ironhelmet.com`

## Authentication
Session cookie — obtained via login, persists across requests in the same session.

### Login
```
POST /arequest/login
Content-Type: application/x-www-form-urlencoded

alias=<email_or_alias>&password=<password>&type=login
```
Success: response array where `[0] == "meta:login_success"`  
Failure: `[0] == "meta:login_failure"` or HTTP error

---

## State Endpoints (all POST, session cookie required)

### Full Universe Report  ← primary bot endpoint
```
POST /trequest/order

type=order&order=full_universe_report&game_number=7769
```
Returns: `{"scanning_data": { ...see schema below... }}`

### Intel Data
```
POST /trequest/intel_data

type=intel_data&game_number=7769
```

### Unread Message Count
```
POST /trequest/fetch_unread_count

type=fetch_unread_count&game_number=7769
```

### Init Player
```
POST /mrequest/init_player

type=init_player
```

---

## Orders

All orders use `POST /trequest/order` with `type=batched_orders`.
The `order` field is a comma-separated string: `action,arg1,arg2,...`
Note: `gameId` (not `game_number`) is the game identifier for orders.

### Confirmed
```
POST /trequest/order

type=batched_orders
gameId=7769
version=
order=upgrade_economy,<star_uid>,<expected_cost>
```
`expected_cost` must match the server's current cost — it rejects stale values.
Use `star.c` from the latest `full_universe_report` as `expected_cost`.

### Confirmed
```
order=upgrade_industry,<star_uid>,<expected_cost>
```

### Unconfirmed — capture via DevTools
| Action | Order string |
|--------|-------------|
| Buy science | `upgrade_science,<star_uid>,<expected_cost>` (assumed) |
| Change research | unknown |
| Fleet waypoint | unknown |

---

## scanning_data JSON Schema

```
{
  // Game metadata
  "admin":             int,      // admin player UID (-1 = none)
  "name":              string,
  "now":               int,      // current timestamp ms
  "tick":              int,      // current game tick
  "tick_fragment":     float,    // fractional progress within current tick
  "tick_rate":         int,      // ticks per hour (usually 1)
  "paused":            bool,
  "game_over":         int,      // 0 = ongoing, 1 = ended
  "started":           bool,
  "turn_based":        bool,
  "fleet_speed":       float,    // ly per tick (0.0416... = 1 ly/24 ticks at speed 1)
  "production_rate":   int,      // ticks per production cycle (usually 24)
  "production_counter":int,      // ticks elapsed in current cycle
  "productions":       int,      // total production cycles completed
  "trade_cost":        int,      // cost per tech level to trade ($25 default)
  "trade_scanned":     bool,     // must be in scan range to trade
  "total_stars":       int,
  "stars_for_victory": int,      // stars needed to win (usually ceil(total/2))
  "war":               int,

  // Stars — only visible stars have full data
  "stars": {
    "<uid_str>": {
      "uid":  int,
      "n":    string,             // name
      "puid": int,                // owner player UID (-1 = unowned)
      "x":    float,              // galactic x coordinate
      "y":    float,              // galactic y coordinate
      "v":    "0"|"1",            // "1" = visible to us
      "e":    int,                // economy buildings
      "i":    int,                // industry buildings
      "s":    int,                // science buildings  (NOTE: unconfirmed, may be gate)
      "st":   int,                // garrison (ships stationed)
      "ga":   int,                // warp gate (0 = none, 1 = has gate)
      "nr":   float,              // natural resources (raw)
      "r":    float,              // effective resources (nr + terraforming bonus)
      "c":    float               // current upgrade cost (server-computed) — use this
    }
  },

  // Fleets (carriers)
  "fleets": {
    "<uid_str>": {
      "uid":  int,
      "puid": int,                // owner player UID
      "n":    string,             // fleet name
      "x":    float,
      "y":    float,
      "lx":   float,              // last x
      "ly":   float,              // last y
      "st":   int,                // ships aboard
      "w":    int,                // cached weapons level at last scan
      "o":    array,              // orders [[action, ships, star_uid], ...]
      "ouid": int                 // current target star UID (-1 if idle/in transit)
    }
  },

  // Players
  "players": {
    "<uid_str>": {
      "uid":    int,
      "alias":  string,
      "avatar": int,
      "ai":     int,              // 1 = computer, 0 = human
      "ready":  bool,             // turn-based: has submitted turn
      "conceded": bool,
      "huid":   int,              // home star UID
      "total_stars":    int,
      "total_economy":  int,
      "total_industry": int,
      "total_science":  int,
      "total_fleets":   int,
      "total_strength": int,      // total ship count

      // Extended fields — only visible on OUR player:
      "cash":             float,
      "researching":      string, // tech currently being researched
      "researching_next": string, // queued tech
      "war":              array,  // [int per player] war status
      "karma_to_give":    int,
      "regard":           int,

      "tech": {
        "banking":       { "level": int, "value": float, "research": int, "brr": int },
        "manufacturing": { "level": int, "value": float, "research": int, "brr": int },
        "propulsion":    { "level": int, "value": float, "research": int, "brr": int },
        "research":      { "level": int, "value": float, "research": int, "brr": int },
        "scanning":      { "level": int, "value": float, "research": int, "brr": int },
        "terraforming":  { "level": int, "value": float, "research": int, "brr": int },
        "weapons":       { "level": int, "value": float, "research": int, "brr": int }
        // Other players only show level + value, not research/brr
      }
    }
  }
}
```

---

## Known Clients (reference)
- Python: https://github.com/AsteroidOrangeJuice/neptunepy
- PHP:    https://github.com/wrenoud/phpTriton
- Java:   https://github.com/promne/triton.api
- REST proxy: https://github.com/project-neptune/neptunes-pride-api
