import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runHunter } from '../roles/hunter';

function makeHunterCreep(opts: {
    room?: string;
    hasTarget?: boolean;
    targetExists?: boolean;
} = {}): any {
    const targetId = opts.hasTarget ? 'enemy1' : null;
    return {
        room: { name: opts.room ?? 'W1N1' },
        pos: { getRangeTo: vi.fn(() => 0) },
        memory: { role: 'hunter', targetId, working: false },
        moveTo: vi.fn(() => 0),
        attack: vi.fn(() => 0),
    };
}

function makeHostile(id = 'enemy1'): any {
    return { id, pos: { x: 20, y: 20, roomName: 'W1N1' } };
}

beforeEach(() => {
    (global as any).Memory = {
        scoreMap: {}, scoreCache: {}, knownRooms: [],
        observerIndex: 0, observerTargets: [],
    };
    (global as any).Game = {
        time: 1000, rooms: {}, creeps: {},
        getObjectById: vi.fn(() => null),
        map: { getRoomLinearDistance: vi.fn(() => 1), describeExits: vi.fn(() => ({})) },
    };
    (global as any).ERR_NOT_IN_RANGE = -9;
    (global as any).OK = 0;
});

describe('runHunter — target acquisition', () => {
    it('clears targetId when target no longer exists', () => {
        (global as any).Game.getObjectById = vi.fn(() => null);
        const creep = makeHunterCreep({ hasTarget: true });
        const room = {
            name: 'W1N1',
            find: vi.fn(() => []),
        };
        (global as any).Game.rooms = { 'W1N1': room };
        runHunter(creep);
        expect(creep.memory.targetId).toBeNull();
    });

    it('finds nearest hostile in current room when no target', () => {
        const hostile = makeHostile('h1');
        const room = { name: 'W1N1', find: vi.fn(() => [hostile]) };
        (global as any).Game.rooms = { 'W1N1': room };
        (global as any).Game.getObjectById = vi.fn(() => null);
        const creep = makeHunterCreep({ hasTarget: false });
        creep.room = room;
        runHunter(creep);
        expect(creep.memory.targetId).toBe('h1');
    });

    it('prefers hostile in a room with a known Score (from scoreCache)', () => {
        (global as any).Memory.scoreCache = {
            's1': { pos: { x: 10, y: 10, roomName: 'W2N2' }, value: 10, expiresAt: 9999 },
        };
        const hotHostile = makeHostile('hot');
        const coldHostile = makeHostile('cold');
        const hotRoom  = { name: 'W2N2', find: vi.fn(() => [hotHostile]) };
        const coldRoom = { name: 'W1N1', find: vi.fn(() => [coldHostile]) };
        (global as any).Game.rooms = { 'W2N2': hotRoom, 'W1N1': coldRoom };
        (global as any).Game.getObjectById = vi.fn(() => null);
        const creep = makeHunterCreep({ hasTarget: false });
        creep.room = coldRoom;
        runHunter(creep);
        expect(creep.memory.targetId).toBe('hot');
    });
});

describe('runHunter — combat', () => {
    it('attacks when in range (attack returns OK)', () => {
        const hostile = makeHostile();
        (global as any).Game.getObjectById = vi.fn(() => hostile);
        const creep = makeHunterCreep({ hasTarget: true });
        creep.attack = vi.fn(() => (global as any).OK);
        runHunter(creep);
        expect(creep.attack).toHaveBeenCalledWith(hostile);
    });

    it('moves toward target when out of range', () => {
        const hostile = makeHostile();
        (global as any).Game.getObjectById = vi.fn(() => hostile);
        const creep = makeHunterCreep({ hasTarget: true });
        creep.attack = vi.fn(() => (global as any).ERR_NOT_IN_RANGE);
        runHunter(creep);
        expect(creep.moveTo).toHaveBeenCalledWith(hostile.pos, expect.objectContaining({ reusePath: 3 }));
    });

    it('idles when no target and no hostiles visible', () => {
        (global as any).Game.rooms = { 'W1N1': { name: 'W1N1', find: vi.fn(() => []) } };
        (global as any).Game.getObjectById = vi.fn(() => null);
        const creep = makeHunterCreep({ hasTarget: false });
        creep.room = (global as any).Game.rooms['W1N1'];
        runHunter(creep);
        expect(creep.memory.targetId).toBeNull();
        expect(creep.attack).not.toHaveBeenCalled();
    });
});
