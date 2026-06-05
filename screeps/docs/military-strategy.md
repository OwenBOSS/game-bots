# Military Strategy

## Doctrine

**All military action serves the economy.**

Every unit deployed costs energy to build and CPU to run. A military operation only has value if it nets positive energy over time — either by capturing resources we wouldn't otherwise have, or by destroying the enemy's ability to accumulate them. Operations that don't pass this test are a drain on our economy and should be stood down.

The strategic goal is not conquest. It is **relative economic dominance**: be richer than our opponents by making ourselves richer and making them poorer, simultaneously.

---

## Strategic Objectives (in priority order)

1. **Capture enemy energy** — loot dropped resources from raided rooms
2. **Deny enemy energy** — destroy harvesters and haulers before they can bank it
3. **Protect our own economy** — defend remote mining operations from the same attacks
4. **Avoid attrition** — never lose units in fights we can't win; dead units cost energy to replace

---

## Core Philosophy: War of Attrition

We do not need to win a decisive battle. We need to be slightly more efficient than our enemy, every tick, for a long time.

- A single raiding party that kills two haulers and scoops 1,000 energy is a small win.
- Run that operation every 200 ticks for 2,000 ticks and it becomes a meaningful economic gap.
- Meanwhile, every creep the enemy has to rebuild to replace our kills is energy they aren't using to upgrade their controller or expand.

**Compound the small wins. Don't chase the big ones.**

---

## Target Selection

### Pick on the little guy

Target opponents who are weaker than us or at the same RCL. Signs of a good target:
- Low RCL (1–4) with undefended remote mining rooms
- No towers in the reserved remote room
- No military response in prior raids (passive player)
- Rooms far from their spawn (longer retreat distance for their creeps)

### Don't start fights we can't win

Abort or avoid when:
- The target room has a tower
- We encounter a military escort (ranged/tough body parts)
- Our raiding party is outnumbered or outbodied
- The target has responded with defenders and we've already taken losses

**Survival is more valuable than the loot.** A retreating party that lives to raid again is better than a wiped party that nets nothing.

---

## Core Operation: Raiding Party

The raiding party is our primary offensive tactic at all RCL levels. It exploits the most vulnerable part of any economy: the remote mining pipeline.

### Why it works

Remote mining rooms are economically critical but lightly defended. A harvester and 1–2 haulers working a source represent 3,000+ energy per source per hour. Killing them denies the enemy that energy and, if we scavenge the drop, transfers it directly to us. This is **more efficient than remote mining ourselves** because we don't bear the cost of building the source-side infrastructure.

### Unit Composition

Scale with our current RCL and the threat level of the target:

| Phase | Attacker | Escort | Scavenger |
|---|---|---|---|
| Early (RCL 3–4) | 1× [ATTACK, MOVE, MOVE] | — | 1–2× remote haulers |
| Mid (RCL 5–6) | 1–2× [ATTACK×3, MOVE×3] | 1× [RANGED_ATTACK×2, MOVE×2] | 2–3× remote haulers |
| Late (RCL 7+) | 2× boosted attackers | 1–2× ranged escort | dedicated scavenger squad |

Keep compositions cheap. The goal is a net-positive energy exchange, not a powerful army.

### Execution Phases

**1. Reconnaissance**
Before committing a party, send a scout or use memory from prior visits:
- Is the remote room reserved by the enemy?
- Is there an active harvester at the source?
- Any towers or military creeps present?
- How many haulers are running the pipeline?

Abort if the room is defended or the enemy has gone inactive.

**2. Entry**
Enter through a room edge adjacent to our nearest owned or reserved room. Keep military units leading, scavengers trailing. Do not enter if we see a tower.

**3. Strike**
Attacker targets harvesters first (stationary, highest energy value to destroy), then haulers in transit. Kill priority:
1. Harvester at the source (stops energy generation immediately)
2. Laden haulers (drops carried energy on the ground for us to loot)
3. Empty haulers (denial, cheaper kill)

**4. Scavenge**
As soon as energy hits the ground, remote haulers move to collect. Military units form a loose perimeter between the scavengers and any enemy response. Scavengers load up to full capacity and begin retreating immediately — do not wait for every last drop if we're taking fire.

**5. Retreat**
Retreat toward our nearest room the moment:
- Scavengers are full, or
- We take damage with no path to safety, or
- An enemy military response appears

Military units cover the retreat, staying between the scavengers and any pursuers. Once across the border into our territory, the operation is complete.

**6. Deposit**
Scavengers return to spawn/storage and deposit. Log the energy captured. This feeds directly into the economy as if we had mined it ourselves.

---

## Scaling with RCL

Military ambition should track our economic capacity. Overextending early wastes energy on creeps we can't afford.

| RCL | Military posture |
|---|---|
| 1–2 | No offensive ops. Build economy only. |
| 3–4 | Single attacker raids on undefended remote rooms. Opportunistic only. |
| 5–6 | Organized raiding parties. Begin sustained pressure on one target at a time. |
| 7–8 | Full raiding squads, boosted units. Can simultaneously raid and defend. Consider claim denial (harassing enemy controllers). |

Scale up when:
- Our storage is consistently above 50k energy
- We have enough spawning capacity to replace losses quickly

Scale down (stand down operations) when:
- Our storage drops below 20k
- We're losing more energy in unit replacement than we're capturing
- Our own remote mining is under attack and needs defending

---

## Halting Criterion

**If military operations are not producing net positive energy over a 500-tick rolling window, stand them down.**

Track energy captured via raids vs. energy spent building military units. If the ratio drops below 1:1, we are subsidizing the enemy's defense with our own economy. Pause, rebuild reserves, reassess the target.

---

## Defensive Posture

Our remote mining rooms face the same raids we run on others. Mirror our own doctrine:
- A tower at our owned rooms handles most threats automatically.
- Remote mining rooms should have a designated defender if they're being raided repeatedly.
- If a room is being drained faster than we can defend it, abandon it temporarily and let the enemy waste time on an empty room.

**Defending a room that costs more than it produces is not worth it.**
