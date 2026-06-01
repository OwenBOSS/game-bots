// Plans multi-platoon approach tactics when combat transitions to MARCH.
// Called once per MARCH phase to assign each platoon a PlatoonOrder.
//
// PINCER  — platoon_0 direct, platoon_1 routes through a flank room.
//           Both engage simultaneously. Towers must split fire.
//
// FEINT+MAIN — platoon_0 rushes in to draw tower fire then retreats.
//              platoon_1 enters from a flank room 100 ticks later.
//              Best against heavily defended rooms.
//
// DIRECT  — all platoons take the shortest path. Used when only one platoon
//           is available or no viable flank room exists.

import { PlatoonOrder, TacticType } from '../types';

const ESTIMATED_TRAVEL_TICKS = 40;  // ticks to reach adjacent enemy room
const FEINT_DURATION_TICKS   = 150; // how long the feint platoon attacks before retreating
const MAIN_DELAY_TICKS       = 80;  // main platoon waits this many ticks into the feint

export function manageTactics(): void {
    if (Memory.combatState !== 'MARCH') {
        // Clear orders when not marching so they don't linger into the next RUSH
        if (Memory.combatState === 'RALLY') {
            Memory.platoonOrders        = undefined;
            Memory.coordinatedAttackTick = undefined;
        }
        return;
    }

    if (!Memory.enemyRoomName) return;
    if (Memory.platoonOrders) return; // already planned this MARCH

    const platoons = getActivePlatoonIds();
    if (platoons.length === 0) return;

    const orders = planTactics(platoons, Memory.enemyRoomName);
    Memory.platoonOrders = Object.fromEntries(
        Object.entries(orders).map(([id, o]) => [id, o as any])
    );

    const tactics = Object.values(orders).map(o => o.tactic).join(', ');
    console.log(`[adaptive] Tactics assigned: [${tactics}] vs ${Memory.enemyRoomName}`);
}

// ─── Planning ─────────────────────────────────────────────────────────────────

function planTactics(platoons: string[], enemyRoom: string): Record<string, PlatoonOrder> {
    const intel    = Memory.roomIntel?.[enemyRoom];
    const hasTowers = (intel?.enemyTowers ?? 0) > 0;

    const flankRoom = findFlankRoom(enemyRoom);

    if (platoons.length === 1 || !flankRoom) {
        // Single platoon or no flank available — everyone direct
        return Object.fromEntries(platoons.map(id => [id, { tactic: 'DIRECT' as TacticType }]));
    }

    if (platoons.length >= 2 && hasTowers) {
        // FEINT + MAIN: towers are a serious threat — use misdirection
        const feintId = platoons[0];
        const mainId  = platoons[1];
        return {
            [feintId]: {
                tactic:       'FEINT',
                feintEndTick: Game.time + ESTIMATED_TRAVEL_TICKS + FEINT_DURATION_TICKS,
            },
            [mainId]: {
                tactic:       'MAIN',
                waypointRoom: flankRoom,
                engageTick:   Game.time + ESTIMATED_TRAVEL_TICKS + MAIN_DELAY_TICKS,
            },
            // Any additional platoons also go direct
            ...Object.fromEntries(
                platoons.slice(2).map(id => [id, { tactic: 'DIRECT' as TacticType }])
            ),
        };
    }

    // PINCER: multiple platoons, no towers — enter from different sides
    return {
        [platoons[0]]: { tactic: 'DIRECT' },
        [platoons[1]]: { tactic: 'FLANK', waypointRoom: flankRoom },
        ...Object.fromEntries(
            platoons.slice(2).map(id => [id, { tactic: 'DIRECT' as TacticType }])
        ),
    };
}

// Find a room adjacent to the enemy that we can use as a flanking approach.
// Exclude our own home room (that's the direct route).
function findFlankRoom(enemyRoom: string): string | null {
    const exits = Game.map.describeExits(enemyRoom);
    if (!exits) return null;

    const homeRoom = Object.keys(Game.rooms).find(r => Game.rooms[r].controller?.my) ?? '';
    const candidates = (Object.values(exits).filter(Boolean) as string[])
        .filter(r => r !== homeRoom && Game.map.getRoomStatus(r).status === 'normal');

    return candidates[0] ?? null;
}

function getActivePlatoonIds(): string[] {
    const ids = new Set<string>();
    for (const name in Game.creeps) {
        const pid = Game.creeps[name].memory.platoonId;
        const role = Game.creeps[name].memory.role;
        if (pid && (role === 'warrior' || role === 'ranger')) {
            ids.add(pid);
        }
    }
    return [...ids].sort(); // deterministic order
}
