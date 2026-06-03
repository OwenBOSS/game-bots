import { describe, it, expect, beforeEach } from 'vitest';
import { checkRCTransition } from '../managers/rcTransitionManager';
import { makeRoom, makeController } from './helpers';

function makeRCRoom(level: number, storedLevel?: number): any {
    const room = makeRoom({
        name: 'W1N1',
        controller: makeController({ level, my: true }),
        memory: { rcLevel: storedLevel },
    });
    return room;
}

describe('checkRCTransition — no-op when level unchanged', () => {
    beforeEach(() => {
        (global as any).Memory = {
            scoreMap: {}, scoreCache: {}, knownRooms: [],
            observerIndex: 0, observerTargets: [],
        };
        (global as any).Game = {
            time: 1000, rooms: {}, creeps: {},
            getObjectById: () => null,
            map: { getRoomLinearDistance: () => 1, describeExits: () => ({ 1: 'W1N2', 3: 'W2N1' }) },
        };
    });

    it('does not fire when rcLevel equals controller.level', () => {
        const room = makeRCRoom(2, 2);
        checkRCTransition(room);
        expect(room.memory.rcLevel).toBe(2);
        expect(room.memory.spawnScoutNext).toBeUndefined();
    });
});

describe('checkRCTransition — RC1 entry', () => {
    beforeEach(() => {
        (global as any).Memory = {
            scoreMap: {}, scoreCache: {}, knownRooms: [],
            observerIndex: 0, observerTargets: [],
        };
    });

    it('sets rcLevel to 1', () => {
        const room = makeRCRoom(1, undefined);
        checkRCTransition(room);
        expect(room.memory.rcLevel).toBe(1);
    });

    it('sets spawnScoutNext = true', () => {
        const room = makeRCRoom(1, undefined);
        checkRCTransition(room);
        expect(room.memory.spawnScoutNext).toBe(true);
    });
});

describe('checkRCTransition — RC2 entry', () => {
    beforeEach(() => {
        (global as any).Memory = {
            scoreMap: {}, scoreCache: {}, knownRooms: [],
            observerIndex: 0, observerTargets: [],
        };
    });

    it('sets rcLevel to 2', () => {
        const room = makeRCRoom(2, 1);
        checkRCTransition(room);
        expect(room.memory.rcLevel).toBe(2);
    });

    it('initializes Memory.scoreCache', () => {
        const room = makeRCRoom(2, 1);
        (global as any).Memory.scoreCache = undefined as any;
        checkRCTransition(room);
        expect((global as any).Memory.scoreCache).toBeDefined();
    });
});

describe('checkRCTransition — RC3 entry', () => {
    beforeEach(() => {
        (global as any).Memory = {
            scoreMap: {}, scoreCache: {}, knownRooms: [],
            observerIndex: 0, observerTargets: [],
        };
    });

    it('sets collectorQuota to 3', () => {
        const room = makeRCRoom(3, 2);
        checkRCTransition(room);
        expect(room.memory.collectorQuota).toBe(3);
    });

    it('sets rcLevel to 3', () => {
        const room = makeRCRoom(3, 2);
        checkRCTransition(room);
        expect(room.memory.rcLevel).toBe(3);
    });
});

describe('checkRCTransition — RC4 entry', () => {
    beforeEach(() => {
        (global as any).Memory = {
            scoreMap: {}, scoreCache: {}, knownRooms: [],
            observerIndex: 0, observerTargets: [],
        };
    });

    it('sets dynamicCollectorQuota = true', () => {
        const room = makeRCRoom(4, 3);
        checkRCTransition(room);
        expect(room.memory.dynamicCollectorQuota).toBe(true);
    });
});

describe('checkRCTransition — RC5 entry', () => {
    beforeEach(() => {
        (global as any).Memory = {
            scoreMap: {}, scoreCache: {}, knownRooms: [],
            observerIndex: 0, observerTargets: [],
        };
    });

    it('sets rcLevel to 5', () => {
        const room = makeRCRoom(5, 4);
        checkRCTransition(room);
        expect(room.memory.rcLevel).toBe(5);
    });
});

describe('checkRCTransition — RC8 entry', () => {
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
                describeExits: () => ({ 1: 'W1N2', 3: 'W2N1', 5: 'W1N0', 7: 'W0N1' }),
            },
        };
    });

    it('sets observerEnabled = true', () => {
        const room = makeRCRoom(8, 7);
        checkRCTransition(room);
        expect(room.memory.observerEnabled).toBe(true);
    });

    it('populates Memory.observerTargets from adjacent rooms', () => {
        const room = makeRCRoom(8, 7);
        checkRCTransition(room);
        const targets = (global as any).Memory.observerTargets as string[];
        expect(targets.length).toBeGreaterThan(0);
        expect(targets).toContain('W1N2');
    });
});
