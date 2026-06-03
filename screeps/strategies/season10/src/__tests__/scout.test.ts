import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runScout } from '../roles/scout';

function makeScoutCreep(roomName = 'W1N1'): any {
    return {
        room: {
            name: roomName,
            findExitTo: vi.fn(() => 1),
        },
        pos: {
            findClosestByRange: vi.fn(() => ({ x: 0, y: 25 })),
        },
        moveTo: vi.fn(() => 0),
    };
}

beforeEach(() => {
    (global as any).Memory = {
        scoreMap: {}, scoreCache: {}, knownRooms: [],
        observerIndex: 0, observerTargets: [],
    };
    (global as any).Game = {
        time: 1000, rooms: {}, creeps: {},
        getObjectById: () => null,
        map: {
            getRoomLinearDistance: () => 1,
            describeExits: vi.fn(() => ({ 1: 'W1N2', 3: 'W2N1', 5: 'W1N0', 7: 'W0N1' })),
        },
    };
});

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

describe('runScout — target selection', () => {
    it('moves toward an unexplored adjacent room', () => {
        (global as any).Memory.knownRooms = ['W1N1']; // only home known
        const creep = makeScoutCreep('W1N1');
        runScout(creep);
        expect(creep.room.findExitTo).toHaveBeenCalled();
        expect(creep.moveTo).toHaveBeenCalled();
    });

    it('picks the first unexplored adjacent room', () => {
        (global as any).Memory.knownRooms = ['W1N1', 'W1N2', 'W2N1']; // 2 of 4 known
        (global as any).Game.map.describeExits.mockReturnValue({
            1: 'W1N2', 3: 'W2N1', 5: 'W1N0', 7: 'W0N1',
        });
        const creep = makeScoutCreep('W1N1');
        runScout(creep);
        // Should target W1N0 or W0N1 (unexplored)
        const targetRoom = creep.room.findExitTo.mock.calls[0][0];
        expect(['W1N0', 'W0N1']).toContain(targetRoom);
    });

    it('when all adjacent rooms known, moves toward room with oldest scoreMap entry', () => {
        (global as any).Memory.knownRooms = ['W1N1', 'W1N2', 'W2N1', 'W1N0', 'W0N1'];
        (global as any).Memory.scoreMap = {
            'W1N2': { score: 5, tick: 500 }, // oldest
            'W2N1': { score: 5, tick: 900 },
        };
        (global as any).Game.map.describeExits.mockReturnValue({
            1: 'W1N2', 3: 'W2N1', 5: 'W1N0', 7: 'W0N1',
        });
        const creep = makeScoutCreep('W1N1');
        runScout(creep);
        expect(creep.room.findExitTo).toHaveBeenCalledWith('W1N2');
    });

    it('uses reusePath: 50 for CPU efficiency', () => {
        (global as any).Memory.knownRooms = ['W1N1'];
        const creep = makeScoutCreep('W1N1');
        runScout(creep);
        const moveArgs = creep.moveTo.mock.calls[0];
        expect(moveArgs[1]).toMatchObject({ reusePath: 50 });
    });
});
