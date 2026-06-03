import { describe, it, expect, beforeEach, vi } from 'vitest';
import { findBestScore } from '../roles/collector';
import { makeScore } from './helpers';

beforeEach(() => {
    (global as any).Memory = {
        scoreMap: {}, scoreCache: {}, knownRooms: [],
        observerIndex: 0, observerTargets: [],
    };
    (global as any).Game = {
        time: 1000,
        rooms: {},
        creeps: {},
        getObjectById: vi.fn(() => null),
        map: {
            getRoomLinearDistance: vi.fn((a: string, b: string) => a === b ? 0 : 1),
            describeExits: vi.fn(() => ({})),
        },
    };
});

describe('findBestScore', () => {
    it('returns null when no rooms have scores', () => {
        (global as any).Game.rooms = {};
        const creep = { room: { name: 'W1N1' } } as any;
        expect(findBestScore(creep)).toBeNull();
    });

    it('returns the id of the only visible score', () => {
        const score = makeScore({ id: 'abc', score: 10, ticksToDecay: 1000 });
        (global as any).Game.rooms = {
            'W1N1': { find: vi.fn(() => [score]) },
        };
        const creep = { room: { name: 'W1N1' } } as any;
        expect(findBestScore(creep)).toBe('abc');
    });

    it('prefers higher-value score when equidistant', () => {
        const low  = makeScore({ id: 'low',  score: 5,  ticksToDecay: 1000, roomName: 'W1N1' });
        const high = makeScore({ id: 'high', score: 50, ticksToDecay: 1000, roomName: 'W1N1' });
        (global as any).Game.rooms = {
            'W1N1': { find: vi.fn(() => [low, high]) },
        };
        (global as any).Game.map.getRoomLinearDistance.mockReturnValue(0);
        const creep = { room: { name: 'W1N1' } } as any;
        expect(findBestScore(creep)).toBe('high');
    });

    it('applies urgency multiplier ×2 when ticksToDecay < 500', () => {
        // urgent score has lower absolute value but high urgency
        const normal = makeScore({ id: 'normal', score: 20, ticksToDecay: 1000, roomName: 'W1N1' });
        const urgent = makeScore({ id: 'urgent', score: 15, ticksToDecay: 200,  roomName: 'W1N1' });
        // Both in same room (dist=0): urgent value = 15*2/(0+1) = 30 vs normal = 20*1/(0+1) = 20
        (global as any).Game.rooms = {
            'W1N1': { find: vi.fn(() => [normal, urgent]) },
        };
        (global as any).Game.map.getRoomLinearDistance.mockReturnValue(0);
        const creep = { room: { name: 'W1N1' } } as any;
        expect(findBestScore(creep)).toBe('urgent');
    });

    it('skips score where estimated travel exceeds decay window', () => {
        // dist=10 rooms away, ticksToDecay=10 → travel (10*2=20) > 10*0.8=8 → skip
        const farDecaying = makeScore({ id: 'skip', score: 100, ticksToDecay: 10 });
        const nearFresh   = makeScore({ id: 'keep', score: 5, ticksToDecay: 1000 });
        (global as any).Game.rooms = {
            'W1N1': { find: vi.fn(() => [nearFresh]) },
            'W5N5': { find: vi.fn(() => [farDecaying]) },
        };
        (global as any).Game.map.getRoomLinearDistance
            .mockImplementation((a: string, b: string) => b === 'W5N5' ? 10 : 0);
        const creep = { room: { name: 'W1N1' } } as any;
        expect(findBestScore(creep)).toBe('keep');
    });

    it('prefers closer score over distant same-value score', () => {
        const near = makeScore({ id: 'near', score: 10, ticksToDecay: 1000, roomName: 'W1N1' });
        const far  = makeScore({ id: 'far',  score: 10, ticksToDecay: 1000, roomName: 'W5N5' });
        (global as any).Game.rooms = {
            'W1N1': { find: vi.fn(() => [near]) },
            'W5N5': { find: vi.fn(() => [far]) },
        };
        (global as any).Game.map.getRoomLinearDistance
            .mockImplementation((_a: string, b: string) => b === 'W5N5' ? 5 : 0);
        const creep = { room: { name: 'W1N1' } } as any;
        expect(findBestScore(creep)).toBe('near');
    });
});
