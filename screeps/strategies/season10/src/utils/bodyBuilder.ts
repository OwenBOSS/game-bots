// Season 10 body builder — returns cheapest body that fits the budget.
// Collector bodies use MOVE+TOUGH (no CARRY — Scores are collected by stepping on tile).
// Bodies are returned in Screeps-legal order: TOUGH first, then MOVE last.

export function buildCollectorBody(energy: number): BodyPartConstant[] | null {
    // Speed + carry — CARRY is required for pickup(); MOVE-heavy for fast cross-room travel.
    // 600e: CARRY×2, MOVE×6 — full-road speed, 100 carry
    if (energy >= 600) return [CARRY, CARRY, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE];
    // 350e: CARRY×1, MOVE×5 — fast, 50 carry
    if (energy >= 350) return [CARRY, MOVE, MOVE, MOVE, MOVE, MOVE];
    // 200e: CARRY×1, MOVE×3 — minimum viable collector
    if (energy >= 200) return [CARRY, MOVE, MOVE, MOVE];
    return null;
}

export function buildScoutBody(energy: number): BodyPartConstant[] | null {
    if (energy >= 250) return [MOVE, MOVE, MOVE, MOVE, MOVE]; // 1500 tick lifespan
    if (energy >= 50)  return [MOVE];
    return null;
}

export function buildHunterBody(energy: number): BodyPartConstant[] | null {
    // [ATTACK×3, MOVE×3] — 390e, 30 DPS, fast enough to intercept collectors
    if (energy >= 390) {
        return [ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE];
    }
    return null;
}

export function buildHaulerBody(energy: number): BodyPartConstant[] | null {
    // Road-optimized: 2 CARRY per 1 MOVE (halved fatigue on roads). Each unit = 150e, 100e capacity.
    if (energy >= 600) return [CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE];
    if (energy >= 450) return [CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE];
    if (energy >= 300) return [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE];
    if (energy >= 150) return [CARRY, CARRY, MOVE];
    return null;
}

export function buildHarvesterBody(energy: number): BodyPartConstant[] | null {
    // Stationary — maximize WORK, minimal CARRY+MOVE (parks on source container).
    if (energy >= 500) return [WORK, WORK, WORK, WORK, CARRY, MOVE];
    if (energy >= 300) return [WORK, WORK, CARRY, MOVE];
    if (energy >= 200) return [WORK, CARRY, MOVE];
    return null;
}

export function buildUpgraderBody(energy: number): BodyPartConstant[] | null {
    if (energy >= 400) return [WORK, WORK, CARRY, CARRY, MOVE, MOVE];
    if (energy >= 200) return [WORK, CARRY, MOVE];
    return null;
}

export function buildDefenderBody(energy: number): BodyPartConstant[] | null {
    // Melee defender — TOUGH padding + ATTACK DPS + MOVE parity.
    // Parts ordered: TOUGH first, then ATTACK, then MOVE (Screeps requirement).
    if (energy >= 730) return [TOUGH, TOUGH, TOUGH, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE]; // 14 parts, 150 DPS
    if (energy >= 390) return [TOUGH, TOUGH, ATTACK, ATTACK, ATTACK, MOVE, MOVE, MOVE]; // 8 parts, 90 DPS
    if (energy >= 260) return [ATTACK, ATTACK, MOVE, MOVE]; // minimum viable
    return null;
}

export function buildBuilderBody(energy: number): BodyPartConstant[] | null {
    // Builder needs CARRY-heavy body — withdraws from containers and makes long build trips.
    // More CARRY = fewer round-trips = more time building.
    if (energy >= 500) return [WORK, WORK, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE];
    if (energy >= 300) return [WORK, CARRY, CARRY, CARRY, MOVE];
    if (energy >= 200) return [WORK, CARRY, MOVE];
    return null;
}
