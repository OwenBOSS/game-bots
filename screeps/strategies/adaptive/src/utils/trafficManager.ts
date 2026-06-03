// Screeps direction offset tables — indices 1–8 match the direction constants
// TOP=1, TOP_RIGHT=2, RIGHT=3, BOTTOM_RIGHT=4, BOTTOM=5, BOTTOM_LEFT=6, LEFT=7, TOP_LEFT=8
const DIR_DX = [0,  0,  1,  1,  1,  0, -1, -1, -1];
const DIR_DY = [0, -1, -1,  0,  1,  1,  1,  0, -1];

// ─── Per-tick moved tracking ─────────────────────────────────────────────────
// Used by shoveBlocker to decide whether a creep already has a move committed.
let _movedTick = -1;
const _movedSet = new Set<string>();

function markMoved(name: string): void {
    if (Game.time !== _movedTick) {
        _movedTick = Game.time;
        _movedSet.clear();
    }
    _movedSet.add(name);
}

function hasMoved(name: string): boolean {
    return Game.time === _movedTick && _movedSet.has(name);
}

// ─── Per-tick occupancy cache ─────────────────────────────────────────────────
// Built once per room per tick; re-used by every moveTo call in that room.
let _occupancyTick = -1;
const _occupancy: Record<string, Array<[number, number]>> = {};

function getOccupied(room: Room): Array<[number, number]> {
    if (Game.time !== _occupancyTick) {
        _occupancyTick = Game.time;
        for (const k in _occupancy) delete _occupancy[k];
    }
    if (!_occupancy[room.name]) {
        _occupancy[room.name] = room.find(FIND_MY_CREEPS).map(c => [c.pos.x, c.pos.y] as [number, number]);
    }
    return _occupancy[room.name];
}

/**
 * Drop-in replacement for creep.moveTo() with traffic management.
 *
 * Two improvements over vanilla moveTo:
 *
 *  1. Soft cost matrix — occupied tiles get +3 cost added to the default terrain
 *     cost. The pathfinder prefers routes around other creeps when alternatives
 *     exist, but still routes through them in tight corridors (cost 3 is not
 *     impassable). This spreads creeps naturally without wild routing, unlike
 *     ignoreCreeps:true (which ignores others entirely and causes convergence
 *     jams) or ignoreCreeps:false default (which treats occupied tiles as hard
 *     blocks and produces bizarre detours).
 *
 *  2. Cascade shove — if a truly idle friendly creep is blocking the direct path,
 *     shove it (and its blocker, one level deep) in the same direction so it
 *     yields before the engine resolves movement. "Truly idle" means it hasn't
 *     called moveTo this tick via this wrapper.
 */
export function moveTo(
    creep: Creep,
    target: RoomPosition | { pos: RoomPosition },
    opts: MoveToOpts = {}
): ScreepsReturnCode {
    markMoved(creep.name);

    const result = creep.moveTo(target, {
        reusePath: 2,
        costCallback: (roomName: string, matrix: CostMatrix) => {
            const room = Game.rooms[roomName];
            if (!room) return matrix;
            for (const [x, y] of getOccupied(room)) {
                const cur = matrix.get(x, y);
                if (cur < 255) matrix.set(x, y, Math.min(254, cur + 3));
            }
            return matrix;
        },
        ...opts,
    });

    const targetPos: RoomPosition = 'pos' in target
        ? (target as { pos: RoomPosition }).pos
        : target as RoomPosition;
    const range = opts.range ?? 1;

    if (creep.room.name === targetPos.roomName && creep.pos.getRangeTo(targetPos) > range) {
        shoveBlocker(creep, targetPos);
    }

    return result;
}

function shoveBlocker(creep: Creep, targetPos: RoomPosition): void {
    const dir = creep.pos.getDirectionTo(targetPos) as DirectionConstant;
    shoveInDir(creep, dir, 2);
}

// Cascade shove up to `depth` creeps deep in direction `dir`.
// Recursing first (deepest blocker first) gives the chain a chance to clear.
function shoveInDir(from: { pos: RoomPosition; room: Room; name: string }, dir: DirectionConstant, depth: number): void {
    const nx = from.pos.x + DIR_DX[dir];
    const ny = from.pos.y + DIR_DY[dir];
    if (nx < 1 || nx > 48 || ny < 1 || ny > 48) return;

    const blocker = new RoomPosition(nx, ny, from.room.name)
        .lookFor(LOOK_CREEPS)
        .find(c => c.my && c.name !== from.name);

    if (!blocker || blocker.fatigue > 0) return;
    if (hasMoved(blocker.name)) return;

    // Clear space for the blocker before shoving it (cascade)
    if (depth > 1) shoveInDir(blocker, dir, depth - 1);

    blocker.move(dir);
}
