# Early Economy Strategy — Fortified Source Mining

**Status:** Planning / Pre-implementation
**Goal:** Faster RC progression through source-adjacent infrastructure, stationary harvesters, and link-based logistics at RC5.

---

## Strategy Overview

### Phase 1 — Bootstrap (RC1)

Spawn startup creeps with body `[MOVE, WORK, CARRY]`. Send each one to the nearest source. These are general-purpose creeps: they mine, build, and carry.

Goals:
- Mine energy
- Build 1–2 extensions **within 1 tile of the source** (so the creep never has to move to deposit)
- Build **ramparts on the creep's own tile** and on the extensions (protecting infrastructure immediately)
- After construction, creep sits next to source, mines, and dumps directly into extensions

Key constraint: extensions must be placed close enough that the creep can deposit without moving. This keeps CPU and ticks-per-haul at near zero for these early creeps.

Rush RC2 as the primary objective.

---

### Phase 2 — Stationary Harvesters + Hauler Tow (RC2+)

Once RC2 unlocks additional spawn capacity:

**Dedicated Harvester body:** `[WORK, WORK, WORK, WORK, WORK, CARRY]` (all WORK + 1 CARRY, no MOVE)
- Zero movement cost — these creeps never walk on their own
- CARRY part exists only so the creep can be towed (a creep with no CARRY cannot receive pulled energy; confirm API behavior)

**Hauler body:** `[MOVE, MOVE, CARRY, CARRY, ...]`
- Tows the harvester from spawn to source using the `pull` / `move(harvester)` API
- Once harvester is parked at source, hauler ferries energy back to spawn/extensions/controller

Spawning order:
1. Spawn harvester
2. Spawn hauler immediately after
3. Hauler picks up harvester at spawn, pulls it to the source tile
4. Harvester parks and mines indefinitely; hauler runs the loop

Rush RC is the ongoing priority — all surplus energy goes to controller upgrades before any discretionary construction.

---

### Phase 3 — Links at RC5

At RC5, links become available. Target layout:

| Link | Position | Role |
|------|----------|------|
| Source link | Adjacent to each source | Receives mined energy |
| Controller link | Adjacent to RC | Sends energy directly to upgraders |

Haulers fill the source link. The source link transfers to the controller link each tick. Upgraders drain the controller link. This eliminates the hauler-to-controller round trip for upgrade energy, freeing haulers for construction/repair tasks.

Secondary link target: room center or storage (if available) as a distribution hub.

---

## Implementation Plan (TDD)

Each phase has a test file that must pass before the next phase is wired into the main loop.

---

### Phase 1 Tests

**File:** `screeps/test/bootstrap.test.ts`

- [ ] `bootstrapCreep_bodyIsMovWorkCarry` — assert spawned startup creep has exactly `[MOVE, WORK, CARRY]`
- [ ] `bootstrapCreep_targetsNearestSource` — given two sources at different distances, assert creep moves toward the closer one
- [ ] `bootstrapCreep_buildsExtensionWithinOneRange` — assert extension construction site is placed at range ≤ 1 from source position
- [ ] `bootstrapCreep_buildsRampartOnOwnTile` — assert rampart construction site is placed at creep's current position
- [ ] `bootstrapCreep_buildsRampartOnExtension` — assert rampart construction site is placed on each built extension
- [ ] `bootstrapCreep_depositsToNearbyExtension` — when extension is at range 1 and creep is full, assert `transfer` called with extension as target (no move)
- [ ] `bootstrapCreep_doesNotMoveWhenAdjacentToSourceAndExtension` — assert no move action when both source and extension are in range

**File:** `screeps/test/spawnManager.bootstrap.test.ts`

- [ ] `spawnManager_spawnsBootstrapUntilRC2` — while RC < 2, assert spawn queue contains bootstrap body, not harvester
- [ ] `spawnManager_prioritizesRC2Rush` — assert upgrader spawn is never blocked by builder or repairer when RC < 2

---

### Phase 2 Tests

**File:** `screeps/test/harvester.stationary.test.ts`

- [ ] `stationaryHarvester_bodyHasNoMove` — assert harvester body contains zero MOVE parts
- [ ] `stationaryHarvester_bodyHasOneCarry` — assert exactly 1 CARRY part (tow requirement)
- [ ] `stationaryHarvester_doesNotIssueMoveOrder` — assert `creep.move()` is never called in harvester role tick
- [ ] `stationaryHarvester_minesWhenAdjacentToSource` — at range 1 from source, assert `harvest` called
- [ ] `stationaryHarvester_doesNothingWhenNotAtSource` — if not at source (freshly spawned, not yet towed), assert no action taken

**File:** `screeps/test/hauler.tow.test.ts`

- [ ] `hauler_pullsHarvesterToSource` — given harvester not at source, assert `pull` and `move(harvester)` called on same tick
- [ ] `hauler_stopsTowinOnceHarvesterAtSource` — once harvester is within range 1 of source, assert no more pull calls
- [ ] `hauler_switchesToCarryModeAfterDelivery` — after releasing harvester, assert hauler enters normal collect/deliver loop
- [ ] `hauler_doesNotPullIfNoAssignedHarvester` — hauler with no `memory.towTarget` proceeds as normal hauler

**File:** `screeps/test/spawnManager.phase2.test.ts`

- [ ] `spawnManager_spawnsHarvesterBeforeHauler` — assert harvester is queued before its paired hauler
- [ ] `spawnManager_pairsHaulerToHarvester` — assert spawned hauler has `memory.towTarget` = harvester id
- [ ] `spawnManager_respectsRCRushPriority` — upgrader spawns are not blocked by harvester/hauler pair when energy allows

---

### Phase 3 Tests

**File:** `screeps/test/linkManager.test.ts`

- [ ] `linkManager_identifiesSourceLink` — link within range 2 of a source is tagged as source link
- [ ] `linkManager_identifiesControllerLink` — link within range 3 of RC is tagged as controller link
- [ ] `linkManager_transfersFromSourceToController` — when source link has energy and controller link has capacity, assert `transferEnergy` called
- [ ] `linkManager_doesNotTransferWhenControllerLinkFull` — no transfer attempted when controller link is at capacity
- [ ] `linkManager_doesNotTransferOnCooldown` — no transfer when source link cooldown > 0
- [ ] `linkManager_upgraderDrainsControllerLink` — upgrader assigned to controller link withdraws from it instead of moving to dropped energy

**File:** `screeps/test/construction.phase3.test.ts`

- [ ] `constructionManager_queuesSourceLinkAtRC5` — at RC5, assert source link construction site placed adjacent to primary source
- [ ] `constructionManager_queuesControllerLinkAtRC5` — at RC5, assert controller link construction site placed adjacent to RC
- [ ] `constructionManager_doesNotQueueLinksBeforeRC5` — no link construction sites generated when RC < 5

---

## Implementation TODOs

### Bootstrap role
- [ ] Create `roles/bootstrap.ts` — handles mine → build extensions → build ramparts → dump loop
- [ ] Add `bootstrap` to role registry in `main.ts`
- [ ] Add `BOOTSTRAP` to spawn queue logic in `spawnManager.ts` (active only when RC < 2 and startup creep count < target)

### Stationary harvester role
- [ ] Update `roles/harvester.ts` to support a `stationary: true` memory flag — skip all move logic when set
- [ ] Add tow-target pairing logic to spawn memory in `spawnManager.ts`

### Hauler tow logic
- [ ] Add `tow` state to `roles/hauler.ts` — checks `memory.towTarget`, pulls until harvester is at source
- [ ] Add transition from `tow` → `collect/deliver` loop once tow is complete

### Link manager
- [ ] Create `managers/linkManager.ts`
- [ ] Register in main loop tick, runs after hauler deposits
- [ ] Wire upgrader to prefer controller link as energy source when available

### Construction sequencing
- [ ] Add RC5 link placement to `constructionManager.ts` or equivalent
- [ ] Ensure source link is built before controller link (source link is the income side)

---

## Open Questions

- Can a creep with only `[WORK, CARRY]` (no MOVE) be towed by another creep? Confirm via Screeps API docs — towing requires both creeps to call `move` in tandem; the towed creep does not need MOVE parts but must issue `move(hauler)` each tick.
- Does a CARRY-less creep block towing? If so, the 1 CARRY part on the harvester is mandatory.
- Extension placement near sources: verify the source's exclusion zone doesn't prevent building at range 1 (Screeps typically disallows structures at range 1 from sources — may need range 2).
- Rampart-on-self: confirm ramparts can be built on a tile that already has a creep standing on it at the time of construction.

---

*Written 2026-06-09. Strategy derived from observations in the economic-review.md session and new research into stationary harvester mechanics.*
