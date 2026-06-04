// Scout role — [MOVE] only. Expands visibility and records room intel (scores, hostiles).
// Priority: unexplored non-highway rooms → known score rooms → stalest known room.

import { moveTo } from '../utils/trafficManager';

export function runScout(creep: Creep): void {
    if (!Memory.knownRooms) Memory.knownRooms = [];
    if (!Memory.roomIntel)  Memory.roomIntel  = {};

    if (!Memory.knownRooms.includes(creep.room.name)) {
        Memory.knownRooms.push(creep.room.name);
    }
    recordRoomIntel(creep);

    // Collect scores in current room — try pickup() first, move onto tile if out of range
    if (typeof FIND_SCORES !== 'undefined') {
        const scores = (creep.room.find as Function)(FIND_SCORES) as Score[];
        if (scores.length > 0) {
            const closest = creep.pos.findClosestByRange(scores);
            if (closest) {
                const result = (creep as any).pickup(closest);
                if (result === ERR_NOT_IN_RANGE) {
                    moveTo(creep, closest.pos, { reusePath: 5, range: 0 });
                }
                return;
            }
        }
    }

    const target = pickTarget(creep);
    if (!target) return;

    const exitDir = creep.room.findExitTo(target);
    if (exitDir === ERR_NO_PATH || exitDir === ERR_INVALID_ARGS) return;

    const exit = creep.pos.findClosestByRange(exitDir as ExitConstant);
    if (exit) moveTo(creep, exit, { reusePath: 50 });
}

function recordRoomIntel(creep: Creep): void {
    const hostiles   = creep.room.find(FIND_HOSTILE_CREEPS);
    const scoreCount = typeof FIND_SCORES !== 'undefined'
        ? (creep.room.find as Function)(FIND_SCORES).length
        : 0;
    Memory.roomIntel[creep.room.name] = {
        tick: Game.time,
        hasHostiles: hostiles.length > 0,
        scoreCount,
    };
}

export function isHighway(roomName: string): boolean {
    const m = roomName.match(/[EW](\d+)[NS](\d+)/);
    if (!m) return false;
    return parseInt(m[1]) % 10 === 0 || parseInt(m[2]) % 10 === 0;
}

function pickTarget(creep: Creep): string | null {
    const exits = Game.map.describeExits(creep.room.name);
    if (!exits) return null;

    const candidates = Object.values(exits)
        .filter((r): r is string => !!r)
        .filter(r => !isHighway(r));

    if (candidates.length === 0) return null;

    const known    = Memory.knownRooms ?? [];
    const scoreMap = Memory.scoreMap   ?? {};

    // Priority 1: unexplored non-highway rooms (discover new score sources)
    const unexplored = candidates.filter(r => !known.includes(r));
    if (unexplored.length > 0) return unexplored[0];

    // Priority 2: known rooms with active scores (keep them visible for collectors)
    const scoreRooms = candidates.filter(r => (scoreMap[r]?.score ?? 0) > 0);
    if (scoreRooms.length > 0) {
        return scoreRooms.sort((a, b) => (scoreMap[b]?.score ?? 0) - (scoreMap[a]?.score ?? 0))[0];
    }

    // Priority 3: stalest known room (maintain map freshness)
    return candidates.sort((a, b) =>
        (scoreMap[a]?.tick ?? 0) - (scoreMap[b]?.tick ?? 0)
    )[0] ?? null;
}
