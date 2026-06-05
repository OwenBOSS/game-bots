# Economic Review — Screeps Adaptive Strategy
**Ticks 80558800–80644610 | June 2–5, 2026**

---

## Executive Summary

Two economic peaks occurred during this session. The first (tick 80606738) was a pure-economy high-water mark with no military overhead. The second (tick 80615049) was a brief moment of simultaneously running a full war economy and a healthy treasury. After that second peak, a compounding sequence — container attrition under enemy fire, a hauler oscillation bug, and unchecked military escalation — collapsed available energy from 4345 to under 200 within ~2400 ticks and kept it suppressed for the next 20,000+ ticks.

---

## 1. Regime in Force at Both Peaks

**Phase: DEFEND** throughout both peaks. The strategy never left DEFEND for more than brief ASSESS flickers during this entire session. The RCL stayed at 2.

| Moment | Tick | Avail | Cap | Fill % | Net Rate | Military | Bottleneck |
|--------|------|-------|-----|--------|----------|----------|------------|
| Pre-peak-1 build | 80604738 | 1831 | 4300 | 43% | −0.18 | 0 | BALANCED |
| **Peak 1** | **80606738** | **5769** | **6300** | **92%** | **0** | **0** | **BALANCED** |
| True cap-fill max | 80606938 | 6278 | 6300 | 100% | −0.23 | 0 | BALANCED |
| Upgraders added | 80607938 | 3238 | 8300 | 39% | 0.49 | 0 | BALANCED |
| Military appears | 80610138 | 4602 | 8400 | 55% | 2.09 | 4 | BALANCED |
| **Peak 2** | **80615049** | **4345** | **8550** | **51%** | **+5.0** | **7** | **BALANCED** |
| Post-peak crash floor | 80619649 | 681 | 6550 | 10% | 1.76 | 6 | HARVESTER_SHORTAGE |
| Economy nadir | 80625249 | 90 | 8550 | 1% | −0.89 | 2 | HARVESTER_SHORTAGE |

---

## 2. Peak 1 — The Pure Economy High (tick 80606738)

### What was happening

The DEFEND regime had been running since tick 80579910 with zero military. No warriors, rangers, or healers were spawned — the phase name was defensive but the force structure was purely economic: 2 harvesters, 6 haulers, 3 builders, 2 repairers, 1 scavenger, 1 scout.

Three containers were active (totalCap = 6300 = 300 spawn + 3×2000 containers). Energy filled to 92% of capacity with a net rate of 0 — perfectly in balance. Controller was at 56% of RCL2.

### Git version active

Deployment **`45eff35`** — *"Add traffic/observer managers, improve roles and sim across both strategies"* — was deployed at 2026-06-03T17:08/17:16, essentially simultaneous with this peak. The commit introduced `trafficManager`, `observerManager`, and broad role improvements to hauler, warrior, harvester, courier, ranger, and builder. This is the version that built the economy to this level.

### Why it was good

- Zero spawn budget spent on military = 100% of spawns going to economy roles
- Three containers providing 6,000 units of buffer for remote mining hauls
- `netRate=0` BALANCED — no bottleneck anywhere in the chain
- Hauler count (6) matched throughput demand

---

## 3. The Dip Between Peaks (ticks 80607938–80614849)

Two things happened simultaneously at tick 80607938 that broke the balance:

**1. A fourth container was built** — `totalCap` jumped from 6300 to 8300. This is positive infrastructure but it created an immediately under-filled ratio (39% fill on the new cap).

**2. Two upgraders were spawned** — visible in the tick-80607938 creep list (`upgrader: 2`). These are pure energy consumers with no income contribution. The timing was premature: adding 2 upgraders while the economy was transitioning to 4-container capacity caused energy to drain.

Then at tick 80610138, military appeared for the first time in this DEFEND run (4 warriors). The economy had to absorb:
- 2 upgraders drawing down stored energy
- Military creep spawn costs
- Expanding cap that wasn't yet filled

`totalCap` continued expanding (8300→8400→8450→8500) via extensions, but `totalAvail` stayed compressed (1000–4600 range) because of the competing drain.

---

## 4. Peak 2 — The War Economy Optimum (tick 80615049)

### What was happening

At the exact tick of Peak 2, the bot had:
- **4 containers + 5 extensions** (totalCap 8550)
- **Spawn full**: avail=550, cap=550 — 100% fill
- **Net rate +5.0** — the single highest positive netRate recorded in the dataset
- **Military**: 4 warriors + 2 rangers + 1 healer = 7 units
- **Controller**: 60% of RCL2

This was the single best combination of military readiness and economic surplus: full storage, positive income, active military force, and growing infrastructure.

### What changed immediately after

Within 400 ticks of Peak 2, the bot was in trouble:

| Tick | Event |
|------|-------|
| 80615449 | HAULER_SHORTAGE — first sign of hauler throughput deficit; warrior count +1 |
| 80615849 | 2 healers and 2 upgraders added simultaneously — total military 8, total creeps 24 |
| 80616049 | netRate = −3.43; 5 warriors + 2 rangers + 2 healers = 9 military |
| 80616249 | Rangers doubled: 4 rangers appear, military = 10 units |
| 80618049 | **First container destroyed** — cap 8550→6550 (−2000); HAULER_SHORTAGE |

The post-peak surge was driven by DEFEND phase spawning aggressively in response to an active enemy presence — warriors, healers, and rangers escalating faster than the economy could absorb.

---

## 5. The Crash — Root Causes

### Root Cause 1: Container Attrition (Primary Economic Shock)

The clearest signal is the `totalCap` transitions after peak 2:

| Tick | Cap Change | Δ | Interpretation |
|------|-----------|---|----------------|
| 80618049 | 8550→6550 | −2000 | Container destroyed |
| 80624849 | 6550→8550 | +2000 | Rebuilt |
| 80626249 | 8550→6550 | −2000 | Destroyed again |
| 80630649 | 6550→4550 | −2000 | Second container destroyed |
| 80632449 | 4550→2550 | −2000 | Third container destroyed |
| 80634721 | 2550→4550 | +2000 | Partial rebuild |

From the peak of 4 containers (8550 cap) the bot fell to **1 container** (2550 cap = 300 spawn + 2250 — likely 1 container + extensions) by tick 80632449. Each container lost:
- Removed 2000 units of energy buffer
- Removed a drop-off point for harvesters
- Triggered `HAULER_SHORTAGE` because haulers couldn't fill removed capacity fast enough to cover the gap
- Eventually cascaded into `HARVESTER_SHORTAGE` as the economic loop tightened

Repairers could not keep up with combat damage to containers while the military budget was consuming most spawn time.

### Root Cause 2: Hauler Oscillation Bug (Pre-existing, Amplified by Crisis)

Commit `1149ede` (deployed 2026-06-05T02:01) fixed two bugs in hauler behavior:

**Bug A — Remote hauler oscillation**: When a remote hauler was in transit between rooms (not yet in the remote room) and carrying energy, it had no guard to commit to delivery. It would re-evaluate on each tick and potentially switch back to collect mode the moment it entered the home room, creating a flip-flop. The fix:
```typescript
// Not in the remote room. If carrying energy, commit to delivery.
if (creep.store[RESOURCE_ENERGY] > 0) {
    creep.memory.working = true;
    deliverRemote(creep);
}
```

**Bug B — Empty-return oscillation**: When a remote hauler found nothing to collect, it would go home empty. On the return trip, if the container refilled, it would turn back — burning ticks traveling in both directions with no net throughput. The fix commits the hauler to deliver what it has and waits at source if empty instead of triggering another round trip.

These bugs were present at both peaks and throughout the crash. During the container attrition period, with fewer containers and more delivery congestion, the oscillation effect was amplified — haulers were spending proportionally more ticks in transit and less ticks actually delivering, suppressing effective energy throughput below what the creep count implied.

### Root Cause 3: Harvester Source Competition

Also fixed in `1149ede`: when haulers used "direct harvest as last resort," they would go to any active source — including ones occupied by a stationary harvester. A hauler standing on the harvester's container tile would block the harvester from its optimal mining position, degrading source throughput. The fix filters to sources with no harvester parked within range 1.

This compounded the energy shortage during the crisis: as containers were destroyed, haulers fell back to direct harvesting more frequently, and source competition further reduced effective income.

### Root Cause 4: Military Escalation Without Economy Guard

The DEFEND phase spawned military reactively to enemy presence, without a gate that checked whether the economy could sustain the additional spawn cost. From peak 2 to 1200 ticks later:

- Military grew: 7 → 8 → 9 → 10 units
- Total creeps peaked at 24 (from 21 at peak 2)
- All additional spawn slots went to military, not repairers
- Repairers were too few to protect containers from combat damage

A guard like "don't spawn additional military if netRate < 0 or totalAvail < 1000" would have kept military at 7 and allowed repairers to defend containers.

---

## 6. Controller Progress Rate — Economic Efficiency

Controller upgrade rate (% per 1000 ticks) shows the efficiency of economic energy delivery:

| Period | Ticks | Rate (%/1k) | Military | Notes |
|--------|-------|-------------|----------|-------|
| DEFEND no-military | 80580–80607 | 1–4% | 0 | Steady ramp, no overhead |
| Military appears + upgraders | 80610–80615 | 1% | 4 | Economy absorbing new load |
| **Peak 2 moment** | 80614–80617 | **3–7.5%** | **8** | Best efficiency, war economy |
| Post-crash | 80617–80622 | 1–2% | 5→2 | Containers dying |
| Sustained crisis | 80622–80635 | 1% | 2–8 | Oscillating, below capacity |
| Late recovery | 80635–80644 | 1% | 0–4 | Partially rebuilt infrastructure |

The 7.5%/1k rate at tick 80616849–80617649 (8 military units!) is the highest in the entire dataset — the war economy was briefly working extremely well. But it was unsustainable for 48 hours due to the container attrition starting at 80618049.

By comparison, the late recovery phase (post 80635000) operated at 1%/1k with the same DEFEND phase — the infrastructure damage from container attrition kept efficiency permanently suppressed for the rest of the recorded session.

---

## 7. Timeline of Deployed Versions

| Deployed | GitHash | Description | Ticks Active (approx) |
|----------|---------|-------------|----------------------|
| 2026-06-03T17:16 | `45eff35` | Traffic/observer managers, role improvements | 80606000–80635000 |
| 2026-06-04T15:30 | `4a2d67a` | Dashboard update only | 80635000–80642000 |
| 2026-06-04T22:34 | `5ba8501` | Merge main | 80642000–80647000 |
| 2026-06-05T02:01 | `1149ede` | **Hauler oscillation fix, harvester competition fix, raidManager** | 80647000+ |

Both peaks occurred under `45eff35`. The crash occurred entirely within `45eff35` before any economic fix was deployed. The hauler oscillation fix in `1149ede` arrived approximately 30,000 ticks after Peak 2 — during which the economy had been running at degraded throughput.

---

## 8. Recommendations

**Immediate (already deployed in `1149ede`):**
- ✅ Hauler oscillation fix — commit to delivery when carrying
- ✅ Harvester source competition filter
- ✅ raidManager with 500-tick rolling economy window

**Not yet addressed:**
1. **Container repair priority under DEFEND**: Add a repairer count guard in the spawn manager — if a container drops below 50% HP while military is active, spawn a repairer before the next military unit.
2. **Military escalation gate**: In combatManager / spawnManager, block additional military spawns if `netRate < 0 AND totalAvail < threshold` (suggest threshold = 20% of totalCap). This would have kept military at 7 at Peak 2 instead of growing to 10.
3. **Upgrader timing gate**: Don't add upgraders until `totalAvail > 60% of totalCap` for 3 consecutive samples. Premature upgrader spawn at tick 80607938 consumed the Peak 1 surplus before the economy could absorb the 4th container.
4. **Container-loss HAULER_SHORTAGE sensitivity**: When totalCap drops by 2000+ in one tick, immediately trigger a hauler count re-evaluation rather than waiting for the bottleneck detector to catch up. The 80618049 loss caused HAULER_SHORTAGE within the same tick, but the spawner may take additional ticks to respond.

---

*Data sourced from `screeps/dashboard/index.html` (ticks 80558800–80644610). Git diffs: `45eff35`, `fbb91cd`, `1149ede`.*
