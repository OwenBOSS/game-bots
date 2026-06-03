// Season 10 body builder — returns cheapest body that fits the budget.
// Collector bodies use MOVE+TOUGH (no CARRY — Scores are collected by stepping on tile).
// Bodies are returned in Screeps-legal order: TOUGH first, then MOVE last.

export function buildCollectorBody(energy: number): BodyPartConstant[] | null {
    // RC5+ tier: [MOVE×10, TOUGH×10, ATTACK×2] — 660e
    if (energy >= 660) {
        return [
            MOVE, MOVE, MOVE, MOVE, MOVE,
            MOVE, MOVE, MOVE, MOVE, MOVE,
            TOUGH, TOUGH, TOUGH, TOUGH, TOUGH,
            TOUGH, TOUGH, TOUGH, TOUGH, TOUGH,
            ATTACK, ATTACK,
        ];
    }
    // RC3-4 tier: [MOVE×5, TOUGH×5] — 300e
    if (energy >= 300) {
        return [MOVE, MOVE, MOVE, MOVE, MOVE, TOUGH, TOUGH, TOUGH, TOUGH, TOUGH];
    }
    // RC1-2 tier: [MOVE×3, TOUGH] — 160e
    if (energy >= 160) {
        return [MOVE, MOVE, MOVE, TOUGH];
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

export function buildHarvesterBody(energy: number): BodyPartConstant[] | null {
    // Best body first — [WORK×5, MOVE] — 550e
    if (energy >= 550) return [WORK, WORK, WORK, WORK, WORK, MOVE];
    // [WORK×2, CARRY, MOVE×2] — 350e
    if (energy >= 350) return [WORK, WORK, CARRY, MOVE, MOVE];
    // [WORK, CARRY, MOVE] — 200e
    if (energy >= 200) return [WORK, CARRY, MOVE];
    return null;
}
