# Season 10 Game Plan

Season 10 starts **June 3rd at 10:00 AM**.  
Server: Screeps World Season (separate from shard3).  
Win condition: accumulate the most **Score** points before season end.

---

## How Score Works

- **ScoreObjects** spawn in rooms throughout the season map.
- Each has a `score` value and `ticksToDecay` — they disappear if not collected.
- A collector creep collects a Score by moving to its tile (auto-collect on contact, or `pickup()`).
- Rooms with higher room traffic / fewer players nearby tend to accumulate more score.
- Score objects are visible via `FIND_SCORES (10031)` only in rooms you can see (owned or with a creep inside).

---

## Season Arc

| Phase | Ticks | Goal |
|-------|-------|------|
| Launch | 0–500 | Spawn, lock down starting room, start collecting local scores |
| Early | 500–3000 | Build 3+ collectors, scout adjacent rooms, compete for nearby scores |
| Mid | 3000–10000 | Expand intel range, send collectors to highest-yield rooms |
| Late | 10000+ | Maximize collector throughput; defense if contested rooms arise |

---

## Night Before (June 2nd)

- [ ] Deploy `season10` strategy to the Screeps Season server branch
- [ ] Confirm `npm run deploy` builds without TypeScript errors
- [ ] Verify in the Season lobby that the start is June 3rd 10am (check timezone)
- [ ] Identify 3–5 candidate starting rooms on the Season map (use Screeps map viewer)
- [ ] Review which rooms are far from spawn cluster centers — isolated rooms = less competition
- [ ] Update `Memory.knownRooms` reset logic so it starts clean on launch

---

## Day Of — Room Selection Criteria

When the season opens, **pick your starting room within the first 30 seconds**.

Score each candidate room on:

| Factor | Good | Bad |
|--------|------|-----|
| Sources | 2 sources | 1 source |
| Distance to map center | Far (less competition) | Center (high traffic) |
| Adjacent rooms | 2–4 exits (score access) | 1 exit (trapped) |
| Existing players | None visible | Cluster of spawns nearby |
| Room layout | Open center | Wall-heavy (pathing cost) |

**Preferred starting position:** 2-source room, near map edge, with 3–4 adjacent exits to scout-collect from.

---

## Day Of — Hour 1 Build Order

**Ticks 0–200: Bootstrap**
1. First spawn: 2× harvester (keep spawn full)
2. Spawn: 1× builder (build first container ASAP)
3. Build container next to first source immediately

**Ticks 200–600: Score ramp**
4. Spawn: 1st collector (CARRY×2, MOVE×6 — fast scout/collector)
5. Build 2nd container
6. Spawn: 2nd collector
7. Scout adjacent rooms with collector #1 while collector #2 works local scores

**Ticks 600–1500: Expansion**
8. Spawn: 3rd+ collectors
9. Send scouts to rooms 2 exits away — score density often peaks further out
10. Build extensions to enable larger collector bodies

---

## Collector Strategy

### Body Selection (by energy budget)

| Budget | Body | Speed | Carry |
|--------|------|-------|-------|
| 600e | CARRY×2, MOVE×6 | Full-road speed | 100e |
| 400e | CARRY×1, MOVE×5 | Fast | 50e |
| 250e | CARRY×1, MOVE×3 | Medium | 50e |

Prefer **speed over carry** early — getting to a score before it decays beats carrying 2× per trip.

### Routing Priority

1. **Local room first** — always collect any visible scores in current room
2. **Adjacent rooms with recent scoreMap entry** — score seen < 200 ticks ago
3. **Unexplored adjacent rooms** — unknown rooms may have uncollected score
4. **Return to home** — if no rooms have scores in Memory.scoreMap, idle near spawn

### Decay Awareness

Each `ScoreObject` has `ticksToDecay`. Once decay is tracked, prioritize:
- **Expiring soon** (< 200 ticks) AND **reachable** (distance < ticksToDecay × 0.7)
- Skip a score if travel time would exceed `ticksToDecay * 0.8` — it'll be gone

---

## Spawn Targets (season10/spawnManager)

| Role | Target count | Condition |
|------|-------------|-----------|
| harvester | 2 | always |
| builder | 1 | until 3 containers + extensions built |
| collector | 4–8 | ramp up as energy allows |

Reduce collector count if energy CRITICAL. Scale up if SURPLUS.

---

## Scouting Approach

- Send 1 dedicated **scout** (MOVE×5) to map adjacent rooms every 100 ticks.
- Record rooms in `Memory.knownRooms` + score presence in `Memory.scoreMap`.
- Collectors check `scoreMap` before choosing next room.
- If a room has been empty for 500+ ticks, deprioritize it until a scout confirms new scores.

---

## Mid-Season Adaptation (Week 2+)

- If a nearby room is consistently high-yield: dedicate 2 collectors to it permanently.
- If competing players appear: assess threat, decide whether to contest or pivot to less-contested rooms.
- At RCL 3: build towers for defensive fallback.
- Score objects may cluster around specific map features — track patterns in `Memory.scoreMap`.

---

## Late-Season

- Do not invest in combat unless a competitor is actively blocking your collectors.
- Maximize collector count — each additional collector is pure score upside.
- Do not build ramparts/walls in season — those resources go to collectors.
- If spawns run dry on energy, suicide the oldest/smallest collector to free spawn capacity.

---

## Key Console Commands (season10 debugging)

```js
// Current score map (rooms with active scores):
JSON.stringify(Memory.scoreMap)

// All known rooms (explored):
Memory.knownRooms

// Collector count vs harvesters:
Object.values(Game.creeps).reduce((a,c) => {
  a[c.memory.role] = (a[c.memory.role]||0)+1; return a;
}, {})

// Force reset scoreMap (if stale):
Memory.scoreMap = {}; Memory.knownRooms = [];
```

---

## Risk Register

| Risk | Mitigation |
|------|-----------|
| Spawned into contested area | Pick room on map edge; re-evaluate at tick 100 |
| Score objects decay before collector arrives | Track decay ticks; only route if reachable in time |
| Energy CRITICAL (can't spawn collectors) | Suicide oldest collector; spawning priority harvester |
| Another player attacks | Build tower at RCL 3; activate safe mode if overwhelmed |
| Score drought (no nearby scores) | Expand scout radius to 3 rooms out |
