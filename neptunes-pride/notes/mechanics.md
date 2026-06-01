# Neptune's Pride: Triton — Game Mechanics

## Win Condition
Control `stars_for_victory` stars simultaneously (usually ceil(total_stars / 2)).
The game ends immediately when any player hits the threshold.

---

## Time System
- **Tick**: base time unit. Stars produce ships and money each tick.
- **Tick rate**: ticks per hour (`tick_rate` in scanning_data, usually 1).
- **Production cycle**: every `production_rate` ticks (default 24 = once per day).
- `production_counter`: ticks elapsed in the current cycle.
- `ticks_to_production = production_rate - production_counter`

---

## Infrastructure

| Building | Per production cycle | Notes |
|----------|---------------------|-------|
| Economy  | $10 income          | Stacks with banking tech |
| Industry | 5 ships × manufacturing value | Base value=5, scales with tech |
| Science  | 6 research points   | Stacks with research tech |

**Banking tech** multiplies economy income: value = 1 + 0.5*level (so L3 = +150% = $25/E).
**Manufacturing tech** multiplies industry output: value increases with level.
**Research tech** multiplies science output.

---

## Economy Upgrade Costs
The server sends the current upgrade cost for each star in `star.c`.
**Use `star.c` directly** — don't recalculate.

The general formula (for reference / offline simulation):
```
cost = floor(base * (level + 1) * 50 / max(1, star.r))
```
- Economy base ≈ 2.5
- Industry base ≈ 5
- Science base ≈ 20

`star.r` = effective resources (natural resources + terraforming bonus).
Higher resources = cheaper upgrades, so always prefer upgrading high-resource stars.

---

## Research & Technology
Science buildings generate research points each tick. Points accumulate toward
the next level of whichever tech is set to `researching`.

Cost to reach level N: `brr * N` research points (brr = base research requirement).

### Technology priority (baseline strategy)
1. **Weapons** — direct combat multiplier; most impactful early
2. **Terraforming** — increases effective resources on all stars → cheaper everything
3. **Propulsion** — faster fleet movement → faster expansion and response
4. **Scanning** — wider vision → better intel before attacking
5. **Manufacturing** — ship production multiplier
6. **Banking** — economy multiplier; good mid-game after economy is built up
7. **Research** — increases science output; rarely top priority

---

## Combat
Combat occurs when a fleet reaches a star owned by an enemy.

**Resolution (simultaneous rounds):**
1. Attacker fires: kills `attacker_weapons` defenders
2. Defender fires: kills `defender_weapons + 1` attackers  ← defender gets +1 bonus
3. Both casualties apply simultaneously
4. Repeat until one side reaches 0 ships
5. **Ties go to the defender** (attacker must have strictly more survival rounds)

**Math:**
```python
rounds_to_kill_defenders = ceil(defender_ships / attacker_weapons)
rounds_to_kill_attackers = ceil(attacker_ships / (defender_weapons + 1))

attacker_wins = rounds_to_kill_defenders < rounds_to_kill_attackers
```

**Ships needed to capture a star (with margin):**
```python
bare_minimum = ceil(defender_ships * (defender_weapons + 1) / attacker_weapons) + 1
send = ceil(bare_minimum * 1.5)  # 50% margin for safety
```

**Conquest spoils:**
- Attacker gains the star with surviving ships as garrison
- Economy, Industry, Science buildings transfer intact
- Attacker earns $10 per destroyed Economy building (raiding income)

---

## Fleets (Carriers)
- Carriers transport ships between stars
- Each carrier has an **orders queue**: list of (action, ships, target_star) tuples
- A carrier with no orders sits idle at its current star

**Order actions:**
| Action | Meaning |
|--------|---------|
| DoNothing | Pass through without picking up/dropping |
| CollectAll | Pick up all ships from the star |
| DropAll | Drop all carried ships at the star |
| Collect N | Pick up N ships |
| Drop N | Drop N ships |
| CollectAllBut N | Pick up all but N ships |
| DropAllBut N | Drop all but N ships |
| Garrison N | Drop ships until garrison equals N |

---

## Diplomacy
- **Trade tech**: costs `trade_cost` ($25 default) per tech level exchanged
- **Send cash**: minimum $25, no fee
- **Declare war/peace**: costs $50 to establish peace (one-way or mutual)
- Peace = shared scanning range + fleet cohabitation
- War status tracked in `player.war` array

---

## Warp Gates
- Built on a star for ~$100
- Carriers moving between two gated stars travel at ~3× speed
- High-value strategic upgrade on high-traffic routes late game

---

## Strategic Notes
- **Economy ROI**: economy upgrade at $25 on a $50-resource star pays back in 2.5 cycles
- **Attack window**: best to attack during opponent's production cycle (they have fewer ships)
- **Science is 10× the cost** of economy per unit — invest late, after economy is solid
- **Scan before attacking** — unscanned stars may have more garrison than expected
- **Never leave your frontier stars empty** — even 10 ships deters casual attacks
