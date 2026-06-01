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

const ESTIMATED_TRAVEL_TICKS = 40;
const FEINT_DURATION_TICKS   = 150;
const MAIN_DELAY_TICKS       = 80;

// Called per room — plans tactics only for combat units homed in this room.
export function manageTactics(room: Room): void {
    const state = room.memory.combatState ?? 'RALLY';

    if (state !== 'MARCH') {
        if (state === 'RALLY') {
            room.memory.platoonOrders        = undefined;
            room.memory.coordinatedAttackTick = undefined;
        }
        return;
    }

    if (!room.memory.enemyRoomName) return;
    if (room.memory.platoonOrders) return; // already planned this MARCH

    const platoons = getActivePlatoonIds(room.name);
    if (platoons.length === 0) return;

    const orders = planTactics(platoons, room.memory.enemyRoomName);
    room.memory.platoonOrders = Object.fromEntries(
        Object.entries(orders).map(([id, o]) => [id, o as any])
    );

    const tactics = Object.values(orders).map(o => o.tactic).join(', ');
    console.log(`[${room.name}] Tactics assigned: [${tactics}] vs ${room.memory.enemyRoomName}`);
}

// ─── Planning ─────────────────────────────────────────────────────────────────

function planTactics(platoons: string[], enemyRoom: string): Record<string, PlatoonOrder> {
    const intel     = Memory.roomIntel?.[enemyRoom];
    const hasTowers = (intel?.enemyTowers ?? 0) > 0;
    const flankRoom = findFlankRoom(enemyRoom);

    if (platoons.length === 1 || !flankRoom) {
        return Object.fromEntries(platoons.map(id => [id, { tactic: 'DIRECT' as TacticType }]));
    }

    if (platoons.length >= 2 && hasTowers) {
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
            ...Object.fromEntries(
                platoons.slice(2).map(id => [id, { tactic: 'DIRECT' as TacticType }])
            ),
        };
    }

    return {
        [platoons[0]]: { tactic: 'DIRECT' },
        [platoons[1]]: { tactic: 'FLANK', waypointRoom: flankRoom },
        ...Object.fromEntries(
            platoons.slice(2).map(id => [id, { tactic: 'DIRECT' as TacticType }])
        ),
    };
}

function findFlankRoom(enemyRoom: string): string | null {
    const exits = Game.map.describeExits(enemyRoom);
    if (!exits) return null;

    const homeRooms = new Set(
        Object.keys(Game.rooms).filter(r => Game.rooms[r].controller?.my)
    );
    const candidates = (Object.values(exits).filter(Boolean) as string[])
        .filter(r => !homeRooms.has(r) && Game.map.getRoomStatus(r).status === 'normal');

    return candidates[0] ?? null;
}

// Only platoons whose fighters are homed in this room.
function getActivePlatoonIds(homeRoom: string): string[] {
    const ids = new Set<string>();
    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        const pid  = creep.memory.platoonId;
        const role = creep.memory.role;
        if (pid && (role === 'warrior' || role === 'ranger') && creep.memory.homeRoom === homeRoom) {
            ids.add(pid);
        }
    }
    return [...ids].sort();
}
