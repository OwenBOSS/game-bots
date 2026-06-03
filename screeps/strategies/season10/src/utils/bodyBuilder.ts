// Season 10 body builder — returns cheapest body that fits the budget.
// Collector bodies use MOVE+TOUGH (no CARRY — Scores are collected by stepping on tile).
// Bodies are returned in Screeps-legal order: TOUGH first, then MOVE last.

export function buildCollectorBody(energy: number): BodyPartConstant[] | null {
    // RC5+ tier: [TOUGH×10, ATTACK×2, MOVE×10] — 660e
    if (energy >= 660) {
        return [
            TOUGH, TOUGH, TOUGH, TOUGH, TOUGH,
            TOUGH, TOUGH, TOUGH, TOUGH, TOUGH,
            ATTACK, ATTACK,
            MOVE, MOVE, MOVE, MOVE, MOVE,
            MOVE, MOVE, MOVE, MOVE, MOVE,
        ];
    }
    // RC3-4 tier: [TOUGH×5, MOVE×5] — 300e
    if (energy >= 300) {
        return [TOUGH, TOUGH, TOUGH, TOUGH, TOUGH, MOVE, MOVE, MOVE, MOVE, MOVE];
    }
    // RC1-2 tier: [TOUGH, MOVE×3] — 160e
    if (energy >= 160) {
        return [TOUGH, MOVE, MOVE, MOVE];
    }
    return null;
}

export function buildScoutBody(energy: number): BodyPartConstant[] | null {
    if (energy < 50) return null;
    return [MOVE];
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

export function buildBuilderBody(energy: number): BodyPartConstant[] | null {
    // Builder needs CARRY-heavy body — withdraws from containers and makes long build trips.
    // More CARRY = fewer round-trips = more time building.
    if (energy >= 500) return [WORK, WORK, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE];
    if (energy >= 300) return [WORK, CARRY, CARRY, CARRY, MOVE];
    if (energy >= 200) return [WORK, CARRY, MOVE];
    return null;
}
