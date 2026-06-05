import { describe, it, expect, beforeEach, vi } from 'vitest';
import { manageTactics } from '../managers/tacticsManager';

beforeEach(() => {
    (global as any).Game = {
        time: 1000,
        rooms:  {},
        creeps: {},
        map: {
            describeExits: vi.fn(() => null),
            getRoomStatus: vi.fn(() => ({ status: 'normal' })),
        },
    };
    (global as any).Memory = { roomIntel: {} };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRoom(opts: { name?: string; memory?: any } = {}): any {
    return { name: opts.name ?? 'W1N1', memory: opts.memory ?? {} };
}

function addFighter(opts: {
    name: string;
    role: 'warrior' | 'ranger';
    platoonId: string;
    homeRoom: string;
}): void {
    (global as any).Game.creeps[opts.name] = {
        name: opts.name,
        memory: { role: opts.role, platoonId: opts.platoonId, homeRoom: opts.homeRoom },
    };
}

function enableFlankRoom(exitRoom = 'W3N2'): void {
    (global as any).Game.map.describeExits = vi.fn(() => ({ '1': exitRoom }));
    (global as any).Game.map.getRoomStatus = vi.fn(() => ({ status: 'normal' }));
}

// ─── Non-MARCH states ─────────────────────────────────────────────────────────

describe('manageTactics — non-MARCH states', () => {
    it('does nothing when combatState is ENGAGE', () => {
        const room = makeRoom({ memory: { combatState: 'ENGAGE', enemyRoomName: 'W2N2' } });
        manageTactics(room);
        expect(room.memory.platoonOrders).toBeUndefined();
    });

    it('defaults to RALLY behaviour when combatState is undefined', () => {
        const room = makeRoom({ memory: {} });
        manageTactics(room);
        expect(room.memory.platoonOrders).toBeUndefined();
    });

    it('clears platoonOrders when state is RALLY', () => {
        const room = makeRoom({
            memory: { combatState: 'RALLY', platoonOrders: { p0: { tactic: 'DIRECT' } } },
        });
        manageTactics(room);
        expect(room.memory.platoonOrders).toBeUndefined();
    });

    it('clears coordinatedAttackTick when state is RALLY', () => {
        const room = makeRoom({ memory: { combatState: 'RALLY', coordinatedAttackTick: 900 } });
        manageTactics(room);
        expect(room.memory.coordinatedAttackTick).toBeUndefined();
    });
});

// ─── MARCH — missing context ───────────────────────────────────────────────────

describe('manageTactics — MARCH without valid context', () => {
    it('does nothing when enemyRoomName is not set', () => {
        const room = makeRoom({ memory: { combatState: 'MARCH' } });
        manageTactics(room);
        expect(room.memory.platoonOrders).toBeUndefined();
    });

    it('does nothing when no fighters are homed in this room', () => {
        addFighter({ name: 'w0', role: 'warrior', platoonId: 'p0', homeRoom: 'W9N9' });
        const room = makeRoom({ memory: { combatState: 'MARCH', enemyRoomName: 'W2N2' } });
        manageTactics(room);
        expect(room.memory.platoonOrders).toBeUndefined();
    });

    it('is idempotent — does not re-plan when platoonOrders already set', () => {
        const existing = { p0: { tactic: 'DIRECT' } };
        addFighter({ name: 'w0', role: 'warrior', platoonId: 'p1', homeRoom: 'W1N1' });
        const room = makeRoom({
            memory: { combatState: 'MARCH', enemyRoomName: 'W2N2', platoonOrders: existing },
        });
        manageTactics(room);
        expect(room.memory.platoonOrders).toBe(existing);
    });
});

// ─── MARCH — single platoon ────────────────────────────────────────────────────

describe('manageTactics — MARCH, single platoon', () => {
    it('assigns DIRECT when only one platoon exists', () => {
        addFighter({ name: 'w0', role: 'warrior', platoonId: 'p0', homeRoom: 'W1N1' });
        addFighter({ name: 'r0', role: 'ranger',  platoonId: 'p0', homeRoom: 'W1N1' });
        const room = makeRoom({ memory: { combatState: 'MARCH', enemyRoomName: 'W2N2' } });
        manageTactics(room);
        expect(room.memory.platoonOrders!['p0'].tactic).toBe('DIRECT');
    });

    it('assigns DIRECT when no flank room is available (describeExits returns null)', () => {
        (global as any).Game.map.describeExits = vi.fn(() => null);
        addFighter({ name: 'w0', role: 'warrior', platoonId: 'p0', homeRoom: 'W1N1' });
        addFighter({ name: 'r0', role: 'ranger',  platoonId: 'p1', homeRoom: 'W1N1' });
        const room = makeRoom({ memory: { combatState: 'MARCH', enemyRoomName: 'W2N2' } });
        manageTactics(room);
        expect(room.memory.platoonOrders!['p0'].tactic).toBe('DIRECT');
        expect(room.memory.platoonOrders!['p1'].tactic).toBe('DIRECT');
    });

    it('assigns DIRECT when all adjacent rooms are non-normal (portals, closed)', () => {
        (global as any).Game.map.describeExits = vi.fn(() => ({ '1': 'W3N2' }));
        (global as any).Game.map.getRoomStatus = vi.fn(() => ({ status: 'closed' }));
        addFighter({ name: 'w0', role: 'warrior', platoonId: 'p0', homeRoom: 'W1N1' });
        addFighter({ name: 'r0', role: 'ranger',  platoonId: 'p1', homeRoom: 'W1N1' });
        const room = makeRoom({ memory: { combatState: 'MARCH', enemyRoomName: 'W2N2' } });
        manageTactics(room);
        expect(room.memory.platoonOrders!['p0'].tactic).toBe('DIRECT');
        expect(room.memory.platoonOrders!['p1'].tactic).toBe('DIRECT');
    });
});

// ─── MARCH — two platoons, no towers → DIRECT + FLANK ─────────────────────────

describe('manageTactics — MARCH, two platoons, no towers, flank available', () => {
    beforeEach(() => {
        (global as any).Memory.roomIntel['W2N2'] = {
            enemyTowers: 0, strength: 5, scannedAt: 990, enemyCreeps: 2,
            enemySpawns: 0, hasController: true, controllerOwned: false, sourceCount: 1,
        };
        enableFlankRoom('W3N2');
    });

    it('assigns DIRECT to the first platoon and FLANK to the second (sorted by id)', () => {
        addFighter({ name: 'w0', role: 'warrior', platoonId: 'p0', homeRoom: 'W1N1' });
        addFighter({ name: 'r0', role: 'ranger',  platoonId: 'p1', homeRoom: 'W1N1' });
        const room = makeRoom({ memory: { combatState: 'MARCH', enemyRoomName: 'W2N2' } });
        manageTactics(room);
        expect(room.memory.platoonOrders!['p0'].tactic).toBe('DIRECT');
        expect(room.memory.platoonOrders!['p1'].tactic).toBe('FLANK');
    });

    it('sets waypointRoom on the FLANK platoon', () => {
        addFighter({ name: 'w0', role: 'warrior', platoonId: 'p0', homeRoom: 'W1N1' });
        addFighter({ name: 'r0', role: 'ranger',  platoonId: 'p1', homeRoom: 'W1N1' });
        const room = makeRoom({ memory: { combatState: 'MARCH', enemyRoomName: 'W2N2' } });
        manageTactics(room);
        expect(room.memory.platoonOrders!['p1'].waypointRoom).toBe('W3N2');
    });

    it('assigns DIRECT to a third platoon when no tower-based FEINT/MAIN was chosen', () => {
        addFighter({ name: 'w0', role: 'warrior', platoonId: 'p0', homeRoom: 'W1N1' });
        addFighter({ name: 'r0', role: 'ranger',  platoonId: 'p1', homeRoom: 'W1N1' });
        addFighter({ name: 'w1', role: 'warrior', platoonId: 'p2', homeRoom: 'W1N1' });
        const room = makeRoom({ memory: { combatState: 'MARCH', enemyRoomName: 'W2N2' } });
        manageTactics(room);
        expect(room.memory.platoonOrders!['p2'].tactic).toBe('DIRECT');
    });
});

// ─── MARCH — two platoons, towers present → FEINT + MAIN ──────────────────────

describe('manageTactics — MARCH, two platoons, towers present', () => {
    beforeEach(() => {
        (global as any).Memory.roomIntel['W2N2'] = {
            enemyTowers: 1, strength: 15, scannedAt: 990, enemyCreeps: 3,
            enemySpawns: 1, hasController: true, controllerOwned: true, sourceCount: 1,
        };
        enableFlankRoom('W3N2');
    });

    it('assigns FEINT to the first platoon (sorted id) and MAIN to the second', () => {
        addFighter({ name: 'w0', role: 'warrior', platoonId: 'p0', homeRoom: 'W1N1' });
        addFighter({ name: 'r0', role: 'ranger',  platoonId: 'p1', homeRoom: 'W1N1' });
        const room = makeRoom({ memory: { combatState: 'MARCH', enemyRoomName: 'W2N2' } });
        manageTactics(room);
        expect(room.memory.platoonOrders!['p0'].tactic).toBe('FEINT');
        expect(room.memory.platoonOrders!['p1'].tactic).toBe('MAIN');
    });

    it('sets feintEndTick on the FEINT platoon (after Game.time)', () => {
        addFighter({ name: 'w0', role: 'warrior', platoonId: 'p0', homeRoom: 'W1N1' });
        addFighter({ name: 'r0', role: 'ranger',  platoonId: 'p1', homeRoom: 'W1N1' });
        const room = makeRoom({ memory: { combatState: 'MARCH', enemyRoomName: 'W2N2' } });
        manageTactics(room);
        // feintEndTick = Game.time(1000) + ESTIMATED_TRAVEL(40) + FEINT_DURATION(150) = 1190
        expect(room.memory.platoonOrders!['p0'].feintEndTick).toBeGreaterThan(1000);
    });

    it('sets engageTick on the MAIN platoon (after Game.time)', () => {
        addFighter({ name: 'w0', role: 'warrior', platoonId: 'p0', homeRoom: 'W1N1' });
        addFighter({ name: 'r0', role: 'ranger',  platoonId: 'p1', homeRoom: 'W1N1' });
        const room = makeRoom({ memory: { combatState: 'MARCH', enemyRoomName: 'W2N2' } });
        manageTactics(room);
        // engageTick = Game.time(1000) + ESTIMATED_TRAVEL(40) + MAIN_DELAY(80) = 1120
        expect(room.memory.platoonOrders!['p1'].engageTick).toBeGreaterThan(1000);
    });

    it('sets waypointRoom on the MAIN platoon', () => {
        addFighter({ name: 'w0', role: 'warrior', platoonId: 'p0', homeRoom: 'W1N1' });
        addFighter({ name: 'r0', role: 'ranger',  platoonId: 'p1', homeRoom: 'W1N1' });
        const room = makeRoom({ memory: { combatState: 'MARCH', enemyRoomName: 'W2N2' } });
        manageTactics(room);
        expect(room.memory.platoonOrders!['p1'].waypointRoom).toBe('W3N2');
    });

    it('assigns DIRECT to any extra platoons beyond the first two', () => {
        addFighter({ name: 'w0', role: 'warrior', platoonId: 'p0', homeRoom: 'W1N1' });
        addFighter({ name: 'r0', role: 'ranger',  platoonId: 'p1', homeRoom: 'W1N1' });
        addFighter({ name: 'w1', role: 'warrior', platoonId: 'p2', homeRoom: 'W1N1' });
        const room = makeRoom({ memory: { combatState: 'MARCH', enemyRoomName: 'W2N2' } });
        manageTactics(room);
        expect(room.memory.platoonOrders!['p2'].tactic).toBe('DIRECT');
    });

    it('does not include our own rooms as flank candidates', () => {
        // W3N2 is one of our rooms — it should be excluded from flank candidates,
        // leaving no valid flank room → all platoons fall back to DIRECT.
        (global as any).Game.rooms['W3N2'] = { controller: { my: true } };
        addFighter({ name: 'w0', role: 'warrior', platoonId: 'p0', homeRoom: 'W1N1' });
        addFighter({ name: 'r0', role: 'ranger',  platoonId: 'p1', homeRoom: 'W1N1' });
        const room = makeRoom({ memory: { combatState: 'MARCH', enemyRoomName: 'W2N2' } });
        manageTactics(room);
        // Both platoons should get DIRECT because the only exit is our own room
        expect(room.memory.platoonOrders!['p0'].tactic).toBe('DIRECT');
        expect(room.memory.platoonOrders!['p1'].tactic).toBe('DIRECT');
    });
});
