import { describe, it, expect, beforeEach } from 'vitest';
import { trackScores } from '../managers/scoreTracker';
import { makeRoom, makeScore } from './helpers';

beforeEach(() => {
    (global as any).Memory = {
        scoreMap: {}, scoreCache: {}, knownRooms: [],
        observerIndex: 0, observerTargets: [],
    };
    (global as any).Game = { time: 1000, rooms: {}, creeps: {}, getObjectById: () => null, map: {} };
});

describe('trackScores — tick throttle', () => {
    it('skips scan when Game.time % 10 !== 0', () => {
        (global as any).Game.time = 1001; // not divisible by 10
        const room = makeRoom({ name: 'W1N1', scores: [makeScore()] });
        trackScores(room);
        expect((global as any).Memory.scoreCache).toEqual({});
    });

    it('runs scan when Game.time % 10 === 0', () => {
        (global as any).Game.time = 1000;
        const score = makeScore({ id: 'abc', score: 10, ticksToDecay: 500 });
        const room = makeRoom({ name: 'W1N1', scores: [score] });
        trackScores(room);
        expect((global as any).Memory.scoreCache['abc']).toBeDefined();
    });
});

describe('trackScores — score cache population', () => {
    beforeEach(() => { (global as any).Game.time = 1000; });

    it('stores expiresAt = Game.time + ticksToDecay', () => {
        const score = makeScore({ id: 's1', ticksToDecay: 200 });
        const room = makeRoom({ name: 'W1N1', scores: [score] });
        trackScores(room);
        expect((global as any).Memory.scoreCache['s1'].expiresAt).toBe(1200);
    });

    it('stores pos and value', () => {
        const score = makeScore({ id: 's2', score: 42, x: 10, y: 15, roomName: 'W1N1' });
        const room = makeRoom({ name: 'W1N1', scores: [score] });
        trackScores(room);
        const entry = (global as any).Memory.scoreCache['s2'];
        expect(entry.value).toBe(42);
        expect(entry.pos).toEqual({ x: 10, y: 15, roomName: 'W1N1' });
    });

    it('stores multiple scores from one scan', () => {
        const s1 = makeScore({ id: 's1' });
        const s2 = makeScore({ id: 's2' });
        const room = makeRoom({ name: 'W1N1', scores: [s1, s2] });
        trackScores(room);
        expect(Object.keys((global as any).Memory.scoreCache)).toHaveLength(2);
    });
});

describe('trackScores — cache expiry purge', () => {
    beforeEach(() => { (global as any).Game.time = 1000; });

    it('removes entries where expiresAt <= Game.time', () => {
        (global as any).Memory.scoreCache = {
            old1: { pos: {}, value: 5, expiresAt: 999 },
            old2: { pos: {}, value: 5, expiresAt: 1000 },
        };
        const room = makeRoom({ name: 'W1N1', scores: [] });
        trackScores(room);
        expect((global as any).Memory.scoreCache['old1']).toBeUndefined();
        expect((global as any).Memory.scoreCache['old2']).toBeUndefined();
    });

    it('keeps entries that have not yet expired', () => {
        (global as any).Memory.scoreCache = {
            fresh: { pos: {}, value: 5, expiresAt: 1001 },
        };
        const room = makeRoom({ name: 'W1N1', scores: [] });
        trackScores(room);
        expect((global as any).Memory.scoreCache['fresh']).toBeDefined();
    });
});

describe('trackScores — knownRooms and scoreMap', () => {
    beforeEach(() => { (global as any).Game.time = 1000; });

    it('adds room to knownRooms if not already present', () => {
        const room = makeRoom({ name: 'W5N5', scores: [] });
        trackScores(room);
        expect((global as any).Memory.knownRooms).toContain('W5N5');
    });

    it('does not duplicate knownRooms entry', () => {
        (global as any).Memory.knownRooms = ['W5N5'];
        const room = makeRoom({ name: 'W5N5', scores: [] });
        trackScores(room);
        expect((global as any).Memory.knownRooms.filter((r: string) => r === 'W5N5')).toHaveLength(1);
    });

    it('updates scoreMap aggregate when scores present', () => {
        const s = makeScore({ score: 20 });
        const room = makeRoom({ name: 'W1N1', scores: [s] });
        trackScores(room);
        expect((global as any).Memory.scoreMap['W1N1'].score).toBe(20);
    });

    it('removes room from scoreMap when empty', () => {
        (global as any).Memory.scoreMap = { 'W1N1': { score: 10, tick: 900 } };
        const room = makeRoom({ name: 'W1N1', scores: [] });
        trackScores(room);
        expect((global as any).Memory.scoreMap['W1N1']).toBeUndefined();
    });
});
