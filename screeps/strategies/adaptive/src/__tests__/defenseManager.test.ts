import { describe, it, expect, beforeEach, vi } from 'vitest';
import { manageDefense } from '../managers/defenseManager';

const FIND_HOSTILE_CREEPS_CONST = 103;
const THREAT_CLEAR_TICKS        = 50;
const WARNING_MAX_AGE           = 100;

beforeEach(() => {
    (global as any).Game = {
        time:   1000,
        rooms:  {},
        creeps: {},
        map: { describeExits: vi.fn(() => ({})) },
    };
    (global as any).Memory = { roomIntel: {}, roomThreats: {} };

    (global as any).FIND_HOSTILE_CREEPS = FIND_HOSTILE_CREEPS_CONST;
    (global as any).ATTACK              = 'attack';
    (global as any).RANGED_ATTACK       = 'ranged_attack';
    (global as any).WORK                = 'work';
    (global as any).CARRY               = 'carry';
    (global as any).HEAL                = 'heal';
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRoom(opts: { name?: string; hostiles?: any[] } = {}): any {
    const hostiles = opts.hostiles ?? [];
    return {
        name:   opts.name ?? 'W1N1',
        memory: {},
        find: vi.fn((type: number, findOpts?: { filter?: (c: any) => boolean }) => {
            if (type === FIND_HOSTILE_CREEPS_CONST) {
                return findOpts?.filter ? hostiles.filter(findOpts.filter) : hostiles;
            }
            return [];
        }),
    };
}

function makeHostile(bodyTypes: string[]): any {
    return { body: bodyTypes.map(t => ({ type: t, hits: 1 })) };
}

function makeDefender(opts: {
    name: string;
    role: 'warrior' | 'ranger' | 'healer';
    homeRoom: string;
    currentRoom?: string;
    defendingRoom?: string;
}): any {
    return {
        name: opts.name,
        room: { name: opts.currentRoom ?? opts.homeRoom },
        memory: {
            role:           opts.role,
            homeRoom:       opts.homeRoom,
            defendingRoom:  opts.defendingRoom,
            targetRoomName: undefined,
        },
    };
}

// ─── detectActiveThreats ──────────────────────────────────────────────────────

describe('detectActiveThreats via manageDefense', () => {
    it('sets severity ACTIVE when an ATTACK creep enters the room', () => {
        manageDefense(makeRoom({ hostiles: [makeHostile(['attack', 'move'])] }));
        expect((global as any).Memory.roomThreats!['W1N1'].severity).toBe('ACTIVE');
    });

    it('sets severity ACTIVE when a RANGED_ATTACK creep enters the room', () => {
        manageDefense(makeRoom({ hostiles: [makeHostile(['ranged_attack', 'move'])] }));
        expect((global as any).Memory.roomThreats!['W1N1'].severity).toBe('ACTIVE');
    });

    it('sets severity ACTIVE when a WORK creep enters (dismantler threat)', () => {
        manageDefense(makeRoom({ hostiles: [makeHostile(['work', 'move'])] }));
        expect((global as any).Memory.roomThreats!['W1N1'].severity).toBe('ACTIVE');
    });

    it('does NOT set ACTIVE for CARRY/HEAL-only creeps (non-threatening)', () => {
        manageDefense(makeRoom({ hostiles: [makeHostile(['carry', 'heal', 'move'])] }));
        expect((global as any).Memory.roomThreats!['W1N1']).toBeUndefined();
    });

    it('records correct hostileCount and cumulative strength', () => {
        // ATTACK = score 3, RANGED_ATTACK = score 2 → total strength = 5
        manageDefense(makeRoom({
            hostiles: [makeHostile(['attack']), makeHostile(['ranged_attack'])],
        }));
        const threat = (global as any).Memory.roomThreats!['W1N1'];
        expect(threat.hostileCount).toBe(2);
        expect(threat.strength).toBe(5);
    });

    it('records detectedAt as the tick of first sighting', () => {
        (global as any).Game.time = 1000;
        manageDefense(makeRoom({ hostiles: [makeHostile(['attack'])] }));
        expect((global as any).Memory.roomThreats!['W1N1'].detectedAt).toBe(1000);
    });

    it('preserves original detectedAt on repeat sightings, updates lastSeenAt', () => {
        (global as any).Game.time = 1000;
        const room = makeRoom({ hostiles: [makeHostile(['attack'])] });
        manageDefense(room);                             // first sighting

        (global as any).Game.time = 1010;
        manageDefense(room);                             // second sighting

        const threat = (global as any).Memory.roomThreats!['W1N1'];
        expect(threat.detectedAt).toBe(1000);
        expect(threat.lastSeenAt).toBe(1010);
    });

    it('clears ACTIVE threat after THREAT_CLEAR_TICKS ticks with no hostile sighting', () => {
        (global as any).Game.time = 1000;
        manageDefense(makeRoom({ hostiles: [makeHostile(['attack'])] }));

        (global as any).Game.time = 1000 + THREAT_CLEAR_TICKS + 1;
        manageDefense(makeRoom({ name: 'W1N1', hostiles: [] }));

        expect((global as any).Memory.roomThreats!['W1N1']).toBeUndefined();
    });

    it('does NOT clear ACTIVE threat before THREAT_CLEAR_TICKS have elapsed', () => {
        (global as any).Game.time = 1000;
        manageDefense(makeRoom({ hostiles: [makeHostile(['attack'])] }));

        (global as any).Game.time = 1000 + THREAT_CLEAR_TICKS - 1;
        manageDefense(makeRoom({ name: 'W1N1', hostiles: [] }));

        expect((global as any).Memory.roomThreats!['W1N1']).toBeDefined();
    });
});

// ─── checkEarlyWarnings ───────────────────────────────────────────────────────

describe('checkEarlyWarnings via manageDefense', () => {
    it('sets severity WARNING when a neighbor has fresh intel with enemy creeps', () => {
        (global as any).Game.map.describeExits = vi.fn(() => ({ '1': 'W2N1' }));
        (global as any).Memory.roomIntel['W2N1'] = {
            enemyCreeps: 3, strength: 9, scannedAt: (global as any).Game.time - 10,
        };
        manageDefense(makeRoom({ hostiles: [] }));
        expect((global as any).Memory.roomThreats!['W1N1'].severity).toBe('WARNING');
        expect((global as any).Memory.roomThreats!['W1N1'].fromRoom).toBe('W2N1');
    });

    it('does NOT set WARNING when neighbor intel is stale (> WARNING_MAX_AGE ticks)', () => {
        (global as any).Game.map.describeExits = vi.fn(() => ({ '1': 'W2N1' }));
        (global as any).Memory.roomIntel['W2N1'] = {
            enemyCreeps: 5, strength: 15,
            scannedAt: (global as any).Game.time - WARNING_MAX_AGE - 1,
        };
        manageDefense(makeRoom({ hostiles: [] }));
        expect((global as any).Memory.roomThreats!['W1N1']).toBeUndefined();
    });

    it('does NOT set WARNING when neighbor intel shows 0 enemy creeps', () => {
        (global as any).Game.map.describeExits = vi.fn(() => ({ '1': 'W2N1' }));
        (global as any).Memory.roomIntel['W2N1'] = {
            enemyCreeps: 0, strength: 0, scannedAt: (global as any).Game.time - 5,
        };
        manageDefense(makeRoom({ hostiles: [] }));
        expect((global as any).Memory.roomThreats!['W1N1']).toBeUndefined();
    });

    it('does NOT downgrade an ACTIVE threat to WARNING', () => {
        // Pre-seed ACTIVE from a previous tick
        (global as any).Memory.roomThreats!['W1N1'] = {
            severity: 'ACTIVE', detectedAt: 990, lastSeenAt: 999, hostileCount: 2, strength: 6,
        };
        (global as any).Game.map.describeExits = vi.fn(() => ({ '1': 'W2N1' }));
        (global as any).Memory.roomIntel['W2N1'] = {
            enemyCreeps: 1, strength: 3, scannedAt: 999,
        };
        // Room still has the attacker present
        manageDefense(makeRoom({ hostiles: [makeHostile(['attack'])] }));
        expect((global as any).Memory.roomThreats!['W1N1'].severity).toBe('ACTIVE');
    });

    it('picks the highest-strength neighbor when multiple neighbors have intel', () => {
        (global as any).Game.map.describeExits = vi.fn(() => ({ '1': 'W2N1', '3': 'W1N2' }));
        (global as any).Memory.roomIntel['W2N1'] = {
            enemyCreeps: 1, strength: 4,  scannedAt: (global as any).Game.time - 5,
        };
        (global as any).Memory.roomIntel['W1N2'] = {
            enemyCreeps: 3, strength: 12, scannedAt: (global as any).Game.time - 5,
        };
        manageDefense(makeRoom({ hostiles: [] }));
        const threat = (global as any).Memory.roomThreats!['W1N1'];
        expect(threat.fromRoom).toBe('W1N2');
        expect(threat.strength).toBe(12);
    });

    it('clears a WARNING after THREAT_CLEAR_TICKS ticks with no fresh neighbor intel', () => {
        (global as any).Memory.roomThreats!['W1N1'] = {
            severity: 'WARNING', detectedAt: 900, lastSeenAt: 900, hostileCount: 1, strength: 3,
        };
        (global as any).Game.time = 900 + THREAT_CLEAR_TICKS + 1;
        (global as any).Game.map.describeExits = vi.fn(() => ({}));
        manageDefense(makeRoom({ hostiles: [] }));
        expect((global as any).Memory.roomThreats!['W1N1']).toBeUndefined();
    });
});

// ─── dispatchAndRecall ────────────────────────────────────────────────────────

describe('dispatchAndRecall via manageDefense', () => {
    // Suppress early-warning side effects for dispatch tests
    beforeEach(() => {
        (global as any).Game.map.describeExits = vi.fn(() => ({}));
    });

    function setActiveThreat(roomName: string): void {
        (global as any).Memory.roomThreats![roomName] = {
            severity: 'ACTIVE', detectedAt: 999, lastSeenAt: 999, hostileCount: 2, strength: 6,
        };
    }

    it('dispatches an idle warrior to a room with an ACTIVE threat', () => {
        setActiveThreat('W2N1');
        const warrior = makeDefender({ name: 'w0', role: 'warrior', homeRoom: 'W1N1' });
        (global as any).Game.creeps['w0']    = warrior;
        (global as any).Game.rooms['W1N1']   = { memory: { combatState: 'RALLY' } };

        manageDefense(makeRoom({ name: 'W1N1', hostiles: [] }));

        expect(warrior.memory.defendingRoom).toBe('W2N1');
        expect(warrior.memory.targetRoomName).toBe('W2N1');
    });

    it('dispatches rangers and healers in addition to warriors', () => {
        setActiveThreat('W2N1');
        const ranger = makeDefender({ name: 'r0', role: 'ranger', homeRoom: 'W1N1' });
        const healer = makeDefender({ name: 'h0', role: 'healer', homeRoom: 'W1N1' });
        (global as any).Game.creeps['r0']  = ranger;
        (global as any).Game.creeps['h0']  = healer;
        (global as any).Game.rooms['W1N1'] = { memory: { combatState: 'RALLY' } };

        manageDefense(makeRoom({ name: 'W1N1', hostiles: [] }));

        expect(ranger.memory.defendingRoom).toBe('W2N1');
        expect(healer.memory.defendingRoom).toBe('W2N1');
    });

    it('does not dispatch a creep already on a mission (defendingRoom already set)', () => {
        setActiveThreat('W2N1');
        setActiveThreat('W3N1');  // keep W3N1 active so recall doesn't clear it first
        const warrior = makeDefender({ name: 'w0', role: 'warrior', homeRoom: 'W1N1', defendingRoom: 'W3N1' });
        (global as any).Game.creeps['w0']    = warrior;
        (global as any).Game.rooms['W1N1']   = { memory: { combatState: 'RALLY' } };

        manageDefense(makeRoom({ name: 'W1N1', hostiles: [] }));

        expect(warrior.memory.defendingRoom).toBe('W3N1');  // unchanged
    });

    it('does not dispatch from a room running an active offense (non-RALLY state)', () => {
        setActiveThreat('W2N1');
        const warrior = makeDefender({ name: 'w0', role: 'warrior', homeRoom: 'W1N1' });
        (global as any).Game.creeps['w0']    = warrior;
        (global as any).Game.rooms['W1N1']   = { memory: { combatState: 'MARCH' } };

        manageDefense(makeRoom({ name: 'W1N1', hostiles: [] }));

        expect(warrior.memory.defendingRoom).toBeUndefined();
    });

    it('does not dispatch a creep that is not physically in its home room', () => {
        setActiveThreat('W2N1');
        const warrior = makeDefender({ name: 'w0', role: 'warrior', homeRoom: 'W1N1', currentRoom: 'W3N3' });
        (global as any).Game.creeps['w0']    = warrior;
        (global as any).Game.rooms['W1N1']   = { memory: { combatState: 'RALLY' } };

        manageDefense(makeRoom({ name: 'W1N1', hostiles: [] }));

        expect(warrior.memory.defendingRoom).toBeUndefined();
    });

    it('does not dispatch from a home room that is itself under ACTIVE threat', () => {
        setActiveThreat('W2N1');
        // W1N1 also has an attacker — detectActiveThreats sets it ACTIVE, blocking dispatch
        const warrior = makeDefender({ name: 'w0', role: 'warrior', homeRoom: 'W1N1' });
        (global as any).Game.creeps['w0']    = warrior;
        (global as any).Game.rooms['W1N1']   = { memory: { combatState: 'RALLY' } };

        manageDefense(makeRoom({ name: 'W1N1', hostiles: [makeHostile(['attack'])] }));

        expect(warrior.memory.defendingRoom).toBeUndefined();
    });

    it('recalls a defender when the threat they were assigned to clears', () => {
        // No active threats — threat has resolved
        const warrior = makeDefender({ name: 'w0', role: 'warrior', homeRoom: 'W1N1', defendingRoom: 'W2N1' });
        warrior.memory.targetRoomName = 'W2N1';
        (global as any).Game.creeps['w0'] = warrior;

        manageDefense(makeRoom({ name: 'W1N1', hostiles: [] }));

        expect(warrior.memory.defendingRoom).toBeUndefined();
        expect(warrior.memory.targetRoomName).toBe('W1N1');   // redirected home
    });

    it('does not recall a defender while their assigned threat is still ACTIVE', () => {
        setActiveThreat('W2N1');
        const warrior = makeDefender({
            name: 'w0', role: 'warrior', homeRoom: 'W1N1', currentRoom: 'W2N1', defendingRoom: 'W2N1',
        });
        (global as any).Game.creeps['w0'] = warrior;

        manageDefense(makeRoom({ name: 'W1N1', hostiles: [] }));

        expect(warrior.memory.defendingRoom).toBe('W2N1');
    });
});
