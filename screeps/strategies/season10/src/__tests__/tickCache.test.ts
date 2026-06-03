import { describe, it, expect, beforeEach } from 'vitest';
import { findCached, resetTickCache } from '../utils/tickCache';
import { makeRoom } from './helpers';

describe('tickCache', () => {
    beforeEach(() => {
        resetTickCache();
    });

    it('calls room.find once and returns cached result on repeat calls', () => {
        const room = makeRoom({ name: 'W1N1' });
        findCached(room, (global as any).FIND_MY_CREEPS);
        findCached(room, (global as any).FIND_MY_CREEPS);
        findCached(room, (global as any).FIND_MY_CREEPS);
        expect(room.find).toHaveBeenCalledTimes(1);
    });

    it('differentiates by room name', () => {
        const roomA = makeRoom({ name: 'W1N1' });
        const roomB = makeRoom({ name: 'W2N2' });
        findCached(roomA, (global as any).FIND_MY_CREEPS);
        findCached(roomB, (global as any).FIND_MY_CREEPS);
        expect(roomA.find).toHaveBeenCalledTimes(1);
        expect(roomB.find).toHaveBeenCalledTimes(1);
    });

    it('differentiates by find constant within the same room', () => {
        const room = makeRoom({ name: 'W1N1' });
        findCached(room, (global as any).FIND_MY_CREEPS);
        findCached(room, (global as any).FIND_MY_SPAWNS);
        expect(room.find).toHaveBeenCalledTimes(2);
    });

    it('resetTickCache clears all entries so next call re-invokes find', () => {
        const room = makeRoom({ name: 'W1N1' });
        findCached(room, (global as any).FIND_MY_CREEPS);
        resetTickCache();
        findCached(room, (global as any).FIND_MY_CREEPS);
        expect(room.find).toHaveBeenCalledTimes(2);
    });

    it('returns the same array reference from cache', () => {
        const room = makeRoom({ name: 'W1N1' });
        const first = findCached(room, (global as any).FIND_MY_CREEPS);
        const second = findCached(room, (global as any).FIND_MY_CREEPS);
        expect(first).toBe(second);
    });
});
