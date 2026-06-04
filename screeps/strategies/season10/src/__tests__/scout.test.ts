import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runScout, isHighway } from '../roles/scout';

// Default exits use non-highway rooms only
const DEFAULT_EXITS = { 1: 'W1N2', 3: 'W2N1', 5: 'W1N3', 7: 'W2N2' };

function makeScoutCreep(roomName = 'W1N1'): any {
    return {
        room: {
            name: roomName,
            find: vi.fn(() => []),  // FIND_HOSTILE_CREEPS and FIND_SCORES
            findExitTo: vi.fn(() => 1),
        },
        pos: {
            x: 25, y: 25, roomName,
            findClosestByRange: vi.fn(() => ({ pos: { x: 0, y: 25, roomName } })),
            getRangeTo: vi.fn(() => 0),
            getDirectionTo: vi.fn(() => 1),
        },
        pickup: vi.fn(() => (global as any).ERR_NOT_IN_RANGE),
        moveTo: vi.fn(() => 0),
    };
}

beforeEach(() => {
    (global as any).Memory = {
        scoreMap: {}, scoreCache: {}, knownRooms: [], roomIntel: {},
        observerIndex: 0, observerTargets: [],
    };
    (global as any).Game = {
        time: 1000, rooms: {}, creeps: {},
        getObjectById: () => null,
        map: {
            getRoomLinearDistance: () => 1,
            describeExits: vi.fn(() => DEFAULT_EXITS),
        },
    };
    (global as any).FIND_HOSTILE_CREEPS = 'FIND_HOSTILE_CREEPS';
    (global as any).FIND_SCORES = 10031;
});

// ── isHighway ─────────────────────────────────────────────────────────────────

describe('isHighway', () => {
    it('identifies x=0 rooms as highway', () => {
        expect(isHighway('W0N5')).toBe(true);
        expect(isHighway('E0N5')).toBe(true);
    });

    it('identifies y=0 rooms as highway', () => {
        expect(isHighway('W5N0')).toBe(true);
        expect(isHighway('W5S0')).toBe(true);
    });

    it('identifies multiples of 10 as highway', () => {
        expect(isHighway('W10N5')).toBe(true);
        expect(isHighway('W5N10')).toBe(true);
        expect(isHighway('W10N10')).toBe(true);
    });

    it('returns false for normal rooms', () => {
        expect(isHighway('W1N1')).toBe(false);
        expect(isHighway('W5N5')).toBe(false);
        expect(isHighway('E3N7')).toBe(false);
    });
});

// ── room registration ─────────────────────────────────────────────────────────

describe('runScout — room registration', () => {
    it('adds current room to knownRooms if not present', () => {
        const creep = makeScoutCreep('W1N1');
        runScout(creep);
        expect((global as any).Memory.knownRooms).toContain('W1N1');
    });

    it('does not duplicate knownRooms entry', () => {
        (global as any).Memory.knownRooms = ['W1N1'];
        const creep = makeScoutCreep('W1N1');
        runScout(creep);
        expect((global as any).Memory.knownRooms.filter((r: string) => r === 'W1N1')).toHaveLength(1);
    });
});

// ── roomIntel recording ───────────────────────────────────────────────────────

describe('runScout — roomIntel', () => {
    it('records no hostiles when room is empty', () => {
        const creep = makeScoutCreep('W1N1');
        creep.room.find = vi.fn(() => []);
        runScout(creep);
        expect((global as any).Memory.roomIntel['W1N1'].hasHostiles).toBe(false);
    });

    it('records hasHostiles=true when hostile creeps present', () => {
        const creep = makeScoutCreep('W1N1');
        creep.room.find = vi.fn((type: string) =>
            type === (global as any).FIND_HOSTILE_CREEPS ? [{ id: 'enemy1' }] : []
        );
        runScout(creep);
        expect((global as any).Memory.roomIntel['W1N1'].hasHostiles).toBe(true);
    });

    it('records scoreCount from visible scores', () => {
        const creep = makeScoutCreep('W1N1');
        const fakeScore = { id: 's1', pos: {}, score: 10, ticksToDecay: 2000 };
        creep.room.find = vi.fn((type: any) =>
            type === (global as any).FIND_SCORES ? [fakeScore, fakeScore] : []
        );
        runScout(creep);
        expect((global as any).Memory.roomIntel['W1N1'].scoreCount).toBe(2);
    });
});

// ── score pickup ──────────────────────────────────────────────────────────────

describe('runScout — score pickup', () => {
    it('moves toward a score in the current room instead of scouting', () => {
        const fakeScore = { id: 's1', pos: { x: 5, y: 5, roomName: 'W1N1' }, score: 10, ticksToDecay: 2000 };
        const creep = makeScoutCreep('W1N1');
        creep.room.find = vi.fn((type: any) =>
            type === (global as any).FIND_SCORES ? [fakeScore] : []
        );
        creep.pos.findClosestByRange = vi.fn(() => fakeScore);
        (global as any).Memory.knownRooms = ['W1N1'];

        runScout(creep);

        // Should moveTo the score, not toward an exit
        expect(creep.room.findExitTo).not.toHaveBeenCalled();
        expect(creep.moveTo).toHaveBeenCalledWith(fakeScore.pos, expect.objectContaining({ reusePath: 5 }));
    });

    it('continues scouting when no scores in current room', () => {
        const creep = makeScoutCreep('W1N1');
        creep.room.find = vi.fn(() => []);
        (global as any).Memory.knownRooms = ['W1N1'];

        runScout(creep);

        expect(creep.room.findExitTo).toHaveBeenCalled();
    });
});

// ── target selection ──────────────────────────────────────────────────────────

describe('runScout — target selection', () => {
    it('moves toward an unexplored adjacent room', () => {
        (global as any).Memory.knownRooms = ['W1N1'];
        const creep = makeScoutCreep('W1N1');
        runScout(creep);
        expect(creep.room.findExitTo).toHaveBeenCalled();
        expect(creep.moveTo).toHaveBeenCalled();
    });

    it('picks an unexplored room over known rooms', () => {
        (global as any).Memory.knownRooms = ['W1N1', 'W1N2', 'W2N1']; // 2 of 4 known
        const creep = makeScoutCreep('W1N1');
        runScout(creep);
        const target = creep.room.findExitTo.mock.calls[0][0];
        expect(['W1N3', 'W2N2']).toContain(target);
    });

    it('filters highway rooms from candidates', () => {
        // Only highway exits — should not crash, just not move
        (global as any).Game.map.describeExits = vi.fn(() => ({
            1: 'W0N1', 3: 'W1N0', 5: 'W10N1', 7: 'W1N10',
        }));
        (global as any).Memory.knownRooms = ['W1N1'];
        const creep = makeScoutCreep('W1N1');
        runScout(creep);
        expect(creep.moveTo).not.toHaveBeenCalled();
    });

    it('when all adjacent rooms known and none have scores, picks stalest', () => {
        (global as any).Memory.knownRooms = ['W1N1', 'W1N2', 'W2N1', 'W1N3', 'W2N2'];
        (global as any).Memory.scoreMap = {
            'W1N2': { score: 0, tick: 500 }, // stalest
            'W2N1': { score: 0, tick: 900 },
            'W1N3': { score: 0, tick: 800 },
            'W2N2': { score: 0, tick: 600 },
        };
        const creep = makeScoutCreep('W1N1');
        runScout(creep);
        expect(creep.room.findExitTo).toHaveBeenCalledWith('W1N2');
    });

    it('prefers score rooms over stalest non-score rooms', () => {
        (global as any).Memory.knownRooms = ['W1N1', 'W1N2', 'W2N1', 'W1N3', 'W2N2'];
        (global as any).Memory.scoreMap = {
            'W1N2': { score: 0, tick: 100 },  // stale but no scores
            'W2N1': { score: 50, tick: 900 }, // recent but has scores → should win
            'W1N3': { score: 0, tick: 200 },
            'W2N2': { score: 0, tick: 300 },
        };
        const creep = makeScoutCreep('W1N1');
        runScout(creep);
        expect(creep.room.findExitTo).toHaveBeenCalledWith('W2N1');
    });

    it('among score rooms picks the highest score value', () => {
        (global as any).Memory.knownRooms = ['W1N1', 'W1N2', 'W2N1', 'W1N3', 'W2N2'];
        (global as any).Memory.scoreMap = {
            'W1N2': { score: 10, tick: 900 },
            'W2N1': { score: 80, tick: 900 }, // highest → should win
            'W1N3': { score: 30, tick: 900 },
            'W2N2': { score: 5, tick: 900 },
        };
        const creep = makeScoutCreep('W1N1');
        runScout(creep);
        expect(creep.room.findExitTo).toHaveBeenCalledWith('W2N1');
    });

    it('uses reusePath: 50 for CPU efficiency', () => {
        (global as any).Memory.knownRooms = ['W1N1'];
        const creep = makeScoutCreep('W1N1');
        runScout(creep);
        const moveArgs = creep.moveTo.mock.calls[0];
        expect(moveArgs[1]).toMatchObject({ reusePath: 50 });
    });
});
