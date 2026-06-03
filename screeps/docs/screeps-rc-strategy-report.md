# Screeps: Room Controller Level (RCL) Unlocks & Strategy Guide

> **Play Style:** Aggressive economic expansion via remote mining + reservation, rushing RC8 in the home room while feeding the controller with remote energy income. Full military integration from the start.

---

## Part 1 — RCL Unlocks Reference

All data sourced directly from the Screeps API constants (`CONTROLLER_STRUCTURES`, `CONTROLLER_LEVELS`, `CONTROLLER_DOWNGRADE`, `RAMPART_HITS_MAX`, `EXTENSION_ENERGY_CAPACITY`).

### Upgrade XP Required Per Level
| RC Level | XP to Reach Next Level |
|----------|------------------------|
| RC1      | 200                    |
| RC2      | 45,000                 |
| RC3      | 135,000                |
| RC4      | 405,000                |
| RC5      | 1,215,000              |
| RC6      | 3,645,000              |
| RC7      | 10,935,000             |
| RC8      | —  (max)               |

### Downgrade Timer (ticks before controller drops a level if not upgraded)
| RC Level | Downgrade Ticks |
|----------|-----------------|
| RC1      | 20,000          |
| RC2      | 10,000          |
| RC3      | 20,000          |
| RC4      | 40,000          |
| RC5      | 80,000          |
| RC6      | 120,000         |
| RC7      | 150,000         |
| RC8      | 200,000         |

> ⚠️ **RC2 has the shortest downgrade timer (10,000 ticks)**. It is the most vulnerable level — upgrading through it fast is critical.

---

### Structure Unlocks Per RC Level

#### RC1 — Bootstrap
| Structure | Count |
|-----------|-------|
| Spawn     | 1     |
| Container | 5     |
| Road      | 2,500 |

No extensions, no walls, no towers. You have exactly 300 energy capacity (the spawn itself). Every creep must be spawnable at 300e or less.

---

#### RC2 — First Expansion
| Structure (new/changed) | Count |
|--------------------------|-------|
| Extension (+50e each)    | 5     |
| Constructed Wall         | 2,500 |
| Rampart (max 300k hits)  | 2,500 |
| Container                | 5     |

**Energy capacity jump:** 300 (spawn) + 5×50 = **550 energy**

Extensions unlock meaningful body part upgrades. Walls and ramparts unlock basic fortification.

---

#### RC3 — First Tower
| Structure (new/changed) | Count |
|--------------------------|-------|
| Extension (+50e each)    | 10    |
| Tower (1)                | 1     |
| Rampart (max 1M hits)    | 2,500 |

**Energy capacity:** 300 + 10×50 = **800 energy**

First automated defense. Tower attacks hostile creeps, heals friendlies, repairs structures — all without a dedicated creep.

---

#### RC4 — Storage Unlocks
| Structure (new/changed) | Count |
|--------------------------|-------|
| Extension (+50e each)    | 20    |
| Storage (1M capacity)    | 1     |
| Tower                    | 1     |
| Rampart (max 3M hits)    | 2,500 |

**Energy capacity:** 300 + 20×50 = **1,300 energy**

Storage is the single most important unlock in the game. It decouples harvesting from spending — you can bank energy and spawn very large creeps on demand.

---

#### RC5 — Links + Second Tower
| Structure (new/changed) | Count |
|--------------------------|-------|
| Extension (+50e each)    | 30    |
| Link                     | 2     |
| Tower                    | 2     |
| Rampart (max 10M hits)   | 2,500 |

**Energy capacity:** 300 + 30×50 = **1,800 energy**

Links teleport energy instantly (with 3% loss, range up to room width). Two links = one source link → one controller link. This is a massive throughput upgrade for upgrading.

---

#### RC6 — Minerals + Terminal + Labs
| Structure (new/changed)  | Count |
|--------------------------|-------|
| Extension (+50e each)    | 40    |
| Link                     | 3     |
| Tower                    | 2     |
| Extractor                | 1     |
| Terminal (300k capacity) | 1     |
| Lab                      | 3     |
| Rampart (max 30M hits)   | 2,500 |

**Energy capacity:** 300 + 40×50 = **2,300 energy**

The economy fully opens up. Terminal enables inter-room and market trading. Labs enable mineral reactions and creep boosting. Extractor lets you mine your room's mineral deposit.

---

#### RC7 — Second Spawn + Factory
| Structure (new/changed)  | Count |
|--------------------------|-------|
| Spawn                    | 2     |
| Extension (+100e each)   | 50    |
| Link                     | 4     |
| Tower                    | 3     |
| Lab                      | 6     |
| Factory                  | 1     |
| Rampart (max 100M hits)  | 2,500 |

**Energy capacity:** 300×2 + 50×100 = **5,600 energy**

Extension capacity doubles (50e → 100e each). Second spawn removes spawn bottleneck for large creep armies. Factory produces commodities for inter-shard trading.

---

#### RC8 — Max Level
| Structure (new/changed)  | Count |
|--------------------------|-------|
| Spawn                    | 3     |
| Extension (+200e each)   | 60    |
| Link                     | 6     |
| Tower                    | 6     |
| Lab                      | 10    |
| Observer                 | 1     |
| Power Spawn              | 1     |
| Nuker                    | 1     |
| Rampart (max 300M hits)  | 2,500 |

**Energy capacity:** 300×3 + 60×200 = **12,900 energy**

Full military, full economy. Observer gives remote vision. Power Spawn processes power creeps. Nuker is strategic warfare.

---

## Part 2 — AI Strategy by RC Level

### Strategic Philosophy

> **Core principle:** Every tick of every creep is either building economy, pushing the RC forward, or protecting the ability to do both. Remote mining (via reserved rooms) is the multiplier — it lets you upgrade at RC3–5 speeds while your home room's sources are dedicated to infrastructure.

The AI should store `room.controller.level` and compare it each tick. When the level changes, trigger a **transition handler** that fires once, updates flags in `Memory`, and adjusts the creep quota targets. After that, the steady-state loop takes over.

```js
// Pseudo-pattern for level transitions
const currentLevel = room.controller.level;
if (Memory.rooms[room.name].rcLevel !== currentLevel) {
  Memory.rooms[room.name].rcLevel = currentLevel;
  onRCLevelUp(room, currentLevel); // fires once
}
```

---

### RC1 — Emergency Bootstrap
**Duration:** Very short (200 XP, trivially fast). **Goal:** Reach RC2 immediately.

**What to build/spawn:**
- Bootstrap harvesters: `[WORK, CARRY, MOVE]` (200e) — harvest and dump directly into the controller. No logistics, no building.
- Spawn as many as possible from the single 300e spawn.

**Special code:**
- `upgradeController` is the **only** valid action for harvesters. Skip filling spawn, skip building.
- No construction sites should be placed at RC1 — wasted effort.
- **Remove this behavior the moment RC2 is reached** via the `onRCLevelUp` handler.

**Quota target:** 3–4 pure upgrader-harvesters.

---

### RC2 — Establish the Economy
**Duration:** 45,000 XP. **Goal:** Build extensions, containers, and begin remote mining setup.

**What unlocks:** 5 extensions (550e total), walls/ramparts, containers.

**Creep roles to introduce:**
- **Harvester** (stays at source, drops energy into adjacent container): `[WORK, WORK, MOVE]`
- **Hauler** (picks up from container, fills spawn/extensions/upgrader): `[CARRY, CARRY, MOVE]`
- **Upgrader** (dedicated controller upgrader, pulls from container): `[WORK, WORK, CARRY, MOVE]`
- **Builder** (handles construction sites): `[WORK, CARRY, MOVE]`

**Special code:**
- On RC2 entry: Place container construction sites next to each source and next to the controller. This is the most important placement decision of the game.
- Transition from "dump-into-controller" harvesters to the harvester/hauler split model.
- Begin scouting adjacent rooms. Identify a **remote mining room** (unowned, preferably with 2 sources). Flag it for reservation.
- Spawn a **reserver** (2× `[CLAIM, MOVE]`, costs 1,200e) to reserve the adjacent room's controller. This is priority once extensions exist.

**Quota:** 2 harvesters, 2 haulers, 2 upgraders, 1 builder, 1 reserver (for remote room).

**Downgrade warning:** RC2 has only 10,000 ticks before downgrade. Ensure at least 1 upgrader is always alive. This is the most dangerous RC level to linger at.

---

### RC3 — First Tower + Remote Harvesting Online
**Duration:** 135,000 XP. **Goal:** Get tower built ASAP, scale up remote mining.

**What unlocks:** 10 extensions (800e total), 1 tower.

**Special code:**
- On RC3 entry: Immediately place tower construction site. The tower is a force multiplier — it removes the need for dedicated defender creeps in the early game.
- Tower logic runs every tick: attack any hostile creep in range, heal damaged friendlies, repair structures below a hits threshold (e.g., ramparts < 5,000 hits, roads < 2,500 hits).
- Remote mining room should be reserved by now. Spawn **remote harvesters** that go to the foreign room's sources and drop energy into containers there.
- Spawn **remote haulers** that pull from foreign containers back to the home spawn/extensions.
- Upgrade creep body sizes now that 800e is available.

**Creep bodies at RC3:**
- Harvester (per source): `[WORK, WORK, WORK, WORK, WORK, MOVE]` — 550e, maximizes harvest rate
- Hauler: scale CARRY parts to match harvester output and distance
- Upgrader: `[WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE]` — 700e

**Quota:** 2 home harvesters, 3+ haulers, 3 upgraders, 1 builder, 1 reserver per remote room, 1–2 remote harvesters per source, 1–2 remote haulers.

---

### RC4 — Storage Changes Everything
**Duration:** 405,000 XP. **Goal:** Build storage immediately, transition all logistics to storage-centric.

**What unlocks:** 20 extensions (1,300e total), storage (1M capacity), second tower slot (same count, still 1).

**Special code:**
- On RC4 entry: Place storage construction site immediately (costs 30,000e to build). This is the biggest priority of the level.
- Once storage exists: all haulers deliver to storage, not directly to spawn/extensions. A dedicated **filler** role pulls from storage to keep spawn and extensions topped up.
- Upgraders pull from storage — they no longer need to chase containers.
- The storage acts as a buffer: if `storage.store[RESOURCE_ENERGY] > 100,000`, spawn an extra upgrader. If `< 20,000`, reduce upgrader count and prioritize harvesters.
- Begin planning room layout for RC5+ structures (links, more extensions). Bunker/stamp planning pays off now.

**Roles to add:**
- **Filler** (storage → spawn + extensions): `[CARRY, CARRY, CARRY, CARRY, MOVE, MOVE]`
- **Repairer** (covers what the tower misses): optional if tower is active

**Quota strategy:** Storage energy level drives dynamic quota. Build a simple threshold table in Memory.

---

### RC5 — Links + Second Tower = Throughput Explosion
**Duration:** 1,215,000 XP. **Goal:** Install links to eliminate hauler trips for upgrading. Expand to second remote room.

**What unlocks:** 30 extensions (1,800e total), 2 links, 2 towers.

**Special code:**
- On RC5 entry: Build second tower immediately. Two towers cover the room much more effectively.
- Place links: one adjacent to a source (source link), one adjacent to the controller (controller link).
- **Link logic:** Each tick, if source link has energy and controller link is not full, call `sourceLink.transferEnergy(controllerLink)`. This removes the need for haulers to run energy to upgraders — a massive CPU and time savings.
- Upgraders now pull from the controller-side link (or storage as fallback).
- Expand remote mining to a second room if not already done.
- Consider your first **scout/claimer** infrastructure: identify rooms suitable for future claiming (RC6+ GCL requirement).

**Roles to add/modify:**
- **Link manager** (fires once per tick in room loop, not a creep): pure code logic
- Upgrader can now be larger: `[WORK×8, CARRY, MOVE]` — spends its whole life next to controller

---

### RC6 — Economy Fully Online
**Duration:** 3,645,000 XP. **Goal:** Build terminal and labs, begin mineral pipeline, claim a second room.

**What unlocks:** 40 extensions (2,300e total), terminal, extractor, 3 labs, 3rd link.

**Special code:**
- On RC6 entry: Build terminal (100,000e to construct) and extractor. Begin harvesting the room's mineral.
- **Mineral pipeline:** A dedicated mineral harvester harvests from the extractor, deposits to storage. Labs consume minerals for reactions.
- Lab reaction logic: pick a target compound (based on what boosts you need), fill two source labs, run `lab.runReaction()` each tick. Output to storage.
- **Claim a second room now.** GCL should be at least 2 by RC6 from all the upgrade XP. Send a claimer (`[CLAIM, MOVE×5]`) to a pre-scouted room. The second room starts its own bootstrap sequence.
- Terminal: keep 20,000–30,000 energy in reserve for market trading / inter-room transfers.

**Roles to add:**
- **Mineral harvester** (home room extractor)
- **Lab manager** (code-only, runs reactions)
- **Claimer** (one-shot creep to claim new rooms)
- Second room gets its own `RC1→RC2` bootstrap sequence

---

### RC7 — Second Spawn, Scale Up
**Duration:** 10,935,000 XP. **Goal:** Eliminate spawn bottleneck. Maximize upgrade throughput.

**What unlocks:** 2nd spawn (300e capacity), 50 extensions (100e each → 5,000e from extensions), 4th link, 3rd tower, 6 labs, factory.

**Energy capacity: 5,600e** — enables very large creep bodies.

**Special code:**
- On RC7 entry: Build second spawn immediately. This is critical for recovery after attacks and for sustaining large creep populations.
- Upgrade creep bodies significantly. Upgraders can now be `[WORK×15, CARRY×4, MOVE×4]` — 2,500e each.
- Spawn queue priority: if both spawns are idle, one always prioritizes upgraders, one prioritizes economy/military roles.
- Factory: assign a factory manager (code-only). Produce basic commodities (battery from energy) for market sale.
- 4th link: place near storage, creating a triangle of source → storage → controller energy routing.
- Begin aggressive military expansion: dedicated `[ATTACK, MOVE]` or `[RANGED_ATTACK, MOVE, HEAL]` squads for room harassment if needed.

---

### RC8 — Max Level, Full Empire Mode
**Goal:** Sustain RC8 (200,000 tick downgrade timer). Maximize economy, expand empire, enable nuker and power creeps.

**What unlocks:** 3rd spawn, 60 extensions (200e each → 12,000e from extensions), 6 towers, 6th link, 10 labs, observer, power spawn, nuker.

**Energy capacity: 12,900e** — maximum. Creep bodies can approach the 50-part limit.

**Special code:**
- Observer logic: each tick, call `observer.observeRoom(targetRoom)` rotating through a list of scouted rooms. Cache visibility data in Memory for remote mining decisions and threat detection.
- Power spawn: if `powerSpawn.store[RESOURCE_POWER] > 0`, call `powerSpawn.processPower()` every tick. Power comes from power bank raids (requires RC5+ squads).
- Nuker: fill it slowly (300,000e + 5,000 ghodium). Fire only at high-value targets with strategic intent.
- **No longer upgrading controller** — at RC8 there is no next level. Redirect all upgrader CPU/energy to the economy: more remote mining, more labs, more market activity.
- Maintain downgrade: a minimal "controller toucher" creep (`[WORK, MOVE]`) upgrades controller once every ~50,000 ticks to reset the downgrade timer. No need for massive upgrade investment.
- 6 towers provide near-impenetrable defense against non-boosted attackers.

---

## Part 3 — Transition Handler Summary

This is the core of the level-aware AI. Implement `onRCLevelUp(room, level)` as a single function called exactly once per level-up:

| RC Level | Actions to Trigger on Entry |
|----------|-----------------------------|
| RC1      | Spawn bootstrap upgrader-harvesters only. Lock role table to `upgrader`. |
| RC2      | Unlock hauler/harvester split. Place source containers + controller container. Scout remote rooms. Spawn first reserver. |
| RC3      | Place tower site. Unlock remote harvester/hauler roles. Scale up creep bodies. |
| RC4      | Place storage site. On storage built: switch to storage-centric logistics. Add dynamic upgrader quota based on storage level. |
| RC5      | Build 2nd tower. Place 2 links. Enable link transfer logic. Unlock large upgrader body. Scout claim targets. |
| RC6      | Build terminal + extractor. Start lab reactions. Send claimer. Enable mineral harvester. |
| RC7      | Build 2nd spawn. Upgrade all body templates. Enable factory. Add military squads. |
| RC8      | Disable heavy upgrading. Enable observer rotation. Enable power spawn processing. Switch to empire maintenance mode. |

---

## Part 4 — Remote Mining Priority Order

Remote rooms should be evaluated and prioritized as follows:

1. **Adjacent rooms (1 room away)** — lowest hauler travel cost, highest ROI
2. **Two sources preferred** — doubles the yield per reserver investment
3. **No source keeper lair** — keeper rooms (center of sectors) require RC5+ combat creeps to harvest
4. **Not owned or claimed by another player** — check `room.controller.owner`

A reserved room's controller halts at 0 ticks remaining — your reserver must be maintained continuously. If the reservation lapses, invaders spawn and can destroy your containers.

**Reservation math:** A `[CLAIM, MOVE]` creep reserves at +1 tick/tick (offset by -1 decay = net 0 to hold). To build up reserve, use `[CLAIM, CLAIM, MOVE, MOVE]` to gain net +1/tick.

---

## Part 5 — Military Integration Notes

**Tower logic (runs every tick):**
```
Priority 1: Attack any hostile creep in room
Priority 2: Heal any allied creep below 80% hits
Priority 3: Repair any rampart below 10,000 hits
Priority 4: Repair roads below 50% hits (only if energy > 700)
```

**Defender creeps (spawn if hostile detected AND tower not enough):**
- RC3–4: `[ATTACK×3, MOVE×3]` — 480e, handles lone scouts
- RC5–6: `[ATTACK×5, TOUGH×5, MOVE×5]` — responder for small raids
- RC7–8: `[RANGED_ATTACK×6, HEAL×4, MOVE×10]` — kite-and-heal quad

**Hostile detection:** Each tick, check `room.find(FIND_HOSTILE_CREEPS)`. If non-empty and not safeMode, trigger alert state. In alert state: all non-essential creeps retreat to ramparts, towers prioritize attack, military creeps spawn.

**Safe mode:** Keep at least 1 `safeModeAvailable` for genuine emergencies. Never burn safe mode on a lone scout. Fire it when multiple hostile attackers breach the perimeter with the storage or spawn at risk.

---

*All constants verified against the Screeps API documentation. Extension capacities: 50e (RC2–6), 100e (RC7), 200e (RC8). Rampart max hits scale: 300k → 1M → 3M → 10M → 30M → 100M → 300M across RC2–8.*
