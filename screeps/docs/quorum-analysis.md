# Screeps Quorum — Analysis & Counter-Strategy

Quorum runs 77+ rooms on shard0. This document captures what we borrowed, and
how to exploit their weaknesses if we ever go head-to-head.

## What We Borrowed

| Change | File | Why |
|--------|------|-----|
| `moveToRoom` via `RoomPosition(25,25)` + `reusePath:20` | hauler.ts, harvester.ts | Native pathfinder caches cross-room routes; old `findExitTo` recalculated every tick |
| Focus-fire towers on same target | combatManager.ts | Kills happen 2–3× faster when all towers concentrate vs. splitting fire |
| Healer-first tower priority | combatManager.ts | Neutralizing regen multiplies effective DPS; previously we targeted highest threat score |
| Remote threat gate | spawnManager.ts | Skip spawning miners/haulers when hostiles spotted in remote room < 300t ago |
| `PRE_SPAWN_TICKS` 60 → 100 | spawnManager.ts | Large bodies (33+ parts) take ~100t to spawn; 60 left coverage gaps |
| CPU bucket gate | main.ts | Skip market (<2000 bucket), skip transfers+remote (<1000) to protect essential ops |

---

## Their Known Weaknesses

### Expansion

**8-tile proximity constraint.** Quorum only expands to rooms within 8 linear
tiles of an existing owned room. If we can claim corridor rooms between their
clusters at distance 4–5, we cut their expansion routes entirely. They have no
fallback logic to route around blocked corridors — the expansion FSM simply
picks the next candidate, which may be unreachable.

**Sequential claiming.** They run one expansion campaign at a time. If we race
to claim adjacent rooms faster (multiple claimers from multiple owned rooms
simultaneously), we outpace their GCL growth.

**Bootstrap window.** Once claimed, the new room is defenseless for several
hundred ticks while bootstrap workers build. Raiding during this window destroys
the spawn before it completes and resets their expansion progress.

---

### Remote Mining

**RESERVE_THRESHOLD = 500.** They resend a reserver when `ticksToEnd < 500`.
The reserver takes 200–400 ticks to travel to the remote room. If we kill the
reserver during this transit window, the reservation lapses — then we can claim
or reserve the room ourselves. Time the attack at `ticksToEnd ≈ 400` so the
room goes neutral before their replacement arrives.

**Remote spawning disabled under attack.** When intel shows hostiles in a remote
room, their spawn manager skips re-queuing miners/haulers. Sustained pressure on
a remote room therefore stalls their income from it indefinitely without us
needing to commit heavy forces.

---

### Combat / Defense

**CPU throttling.** At bucket < 2000 Quorum throttles to 30% CPU; non-essential
processes (market, intel, empire expansion) pause. If we launch simultaneous
attacks on 3+ rooms, each room runs full defense logic and they hit the throttle
fast. Their expansion stalls, their market restocking halts, and their intel
goes stale — all without us winning any individual fight.

**Defense dispatch requires RALLY state.** Their cross-room defender dispatch
only fires when the home room is in RALLY. If we bait a room into starting a
MARCH/ENGAGE campaign (e.g., a decoy weak-looking neighbor), their defenders
are locked on offense and cannot be recalled to help their home room.

**20-tick intel write coalescing.** Their Dossier class batches intel writes
every 20 ticks. Fast unit movements during that blind window go untracked. Move
strike forces through border rooms during the stale window before their intel
updates.

**Spook role (MOVE-only harassment).** They send single MOVE creeps into enemy
rooms to destroy construction sites and sign controllers. A single rampart on
any construction site stops this. Watch for controller signatures changing as an
early-warning indicator.

**Fixed platoon size (3 warriors).** Their WARRIORS_PER_PLATOON = 3 is fixed.
A partially-filled platoon (1–2 warriors) marches at the same time as a full
one. Intercept them during MARCH before they reach ENGAGE — a partial platoon
with no healer is trivial to repel.

---

### Economy / Market

**Terminal-dependent inter-room energy.** Their rooms balance energy via
terminals. Attacking a central terminal room (one that feeds multiple
peripheral rooms) can create cascading deficits — peripheral rooms run out
of energy, stop spawning, and the cascade compounds.

**5,000-unit minimum per resource type locked in terminals.** This is tied-up
capital. They cannot sell or use it until they manually override. We can run
leaner and outspend them in an energy race because we don't hoard minerals.

**Market manipulation filter (drops <20-tick-old orders).** Their pricing
algorithm skips very recent orders and drops 10% outliers. Their buy orders
will always lag true market price by a few ticks. In a resource-scarce period,
we can reliably undercut their restocking speed on ghodium.

---

## Head-to-Head Strategy (if we share a border)

1. **Scout their expansion corridor first.** Identify which neutral rooms sit
   at distance 3–5 between their rooms. Claim or reserve these preemptively.

2. **Hit reservers in transit.** Station a ranger in our border room; attack
   any MOVE-heavy creep crossing toward their remote rooms at the right timing
   window (see above).

3. **Decoy + multi-front.** Send a small probe at a lightly-defended room to
   bait their MARCH. While they're in ENGAGE, send the real raid at the room
   we actually want to contest. Their home-room defenders can't be recalled.

4. **CPU flood.** If we have multiple rooms adjacent to theirs, coordinate
   simultaneous small attacks. Each room's defense logic runs — their CPU
   throttle kicks in fast, pausing their empire management.

5. **Target the bootstrap.** When you see a claimer move into a room, watch
   for the bootstrap spawn construction. Raid with a scavenger + warrior pair
   during the first 300 ticks before the spawn completes.
