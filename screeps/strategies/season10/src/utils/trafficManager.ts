// Screeps direction offset tables — indices 1–8 match the direction constants
// TOP=1, TOP_RIGHT=2, RIGHT=3, BOTTOM_RIGHT=4, BOTTOM=5, BOTTOM_LEFT=6, LEFT=7, TOP_LEFT=8
const DIR_DX = [0,  0,  1,  1,  1,  0, -1, -1, -1];
const DIR_DY = [0, -1, -1,  0,  1,  1,  1,  0, -1];

// Track which creeps have already been issued a move command via moveTo this tick.
// shoveBlocker uses this to decide whether to shove a blocker:
//  - Not yet moved this tick → idle or will move after us → safe to shove (last move() wins)
//  - Already moved this tick → has a pending direction → skip shove; Screeps' native
//    swap mechanic handles two creeps moving into each other's tiles in the same tick.
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

/**
 * Drop-in replacement for creep.moveTo() with traffic management.
 *
 * Two improvements over vanilla moveTo:
 *  1. ignoreCreeps:true — pathfinder picks the geometrically shortest path
 *     instead of routing around creep clusters, which is the primary cause of
 *     spawn-area jams.
 *  2. Shove — if a friendly idle creep occupies the tile directly between us
 *     and our target, we push it in that same direction this tick so it yields
 *     the tile before the engine resolves movement.
 */
export function moveTo(
    creep: Creep,
    target: RoomPosition | { pos: RoomPosition },
    opts: MoveToOpts = {}
): ScreepsReturnCode {
    markMoved(creep.name);

    const result = creep.moveTo(target, {
        reusePath: 3,
        ignoreCreeps: true,
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
    const nx = creep.pos.x + DIR_DX[dir];
    const ny = creep.pos.y + DIR_DY[dir];

    if (nx < 1 || nx > 48 || ny < 1 || ny > 48) return;

    const blocker = new RoomPosition(nx, ny, creep.room.name)
        .lookFor(LOOK_CREEPS)
        .find(c => c.my && c.name !== creep.name);

    if (!blocker || blocker.fatigue > 0) return;

    // Skip creeps that have already issued a move command this tick via our moveTo wrapper.
    // Their direction is committed; shoving them would be overridden by their own move anyway,
    // and in a head-on corridor Screeps' native swap mechanic resolves it without help.
    // Creeps that haven't called moveTo yet (truly idle: just delivered, parked at container,
    // waiting at controller) haven't committed a direction and are safe to displace.
    if (hasMoved(blocker.name)) return;

    blocker.move(dir);
}
