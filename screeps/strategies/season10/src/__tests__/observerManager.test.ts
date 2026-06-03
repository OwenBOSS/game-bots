import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runObserver } from '../managers/observerManager';

function makeObserver(): any {
    return { observeRoom: vi.fn(() => 0) };
}

beforeEach(() => {
    (global as any).Memory = {
        scoreMap: {}, scoreCache: {}, knownRooms: [],
        observerIndex: 0, observerTargets: [],
    };
});

describe('runObserver', () => {
    it('does nothing when observerTargets is empty', () => {
        const obs = makeObserver();
        runObserver(obs);
        expect(obs.observeRoom).not.toHaveBeenCalled();
    });

    it('calls observeRoom with first target at index 0', () => {
        (global as any).Memory.observerTargets = ['W1N1', 'W2N2', 'W3N3'];
        const obs = makeObserver();
        runObserver(obs);
        expect(obs.observeRoom).toHaveBeenCalledWith('W1N1');
    });

    it('increments observerIndex after each call', () => {
        (global as any).Memory.observerTargets = ['W1N1', 'W2N2'];
        const obs = makeObserver();
        runObserver(obs);
        expect((global as any).Memory.observerIndex).toBe(1);
    });

    it('wraps around to index 0 after last target', () => {
        (global as any).Memory.observerTargets = ['W1N1', 'W2N2'];
        (global as any).Memory.observerIndex = 1;
        const obs = makeObserver();
        runObserver(obs);
        expect(obs.observeRoom).toHaveBeenCalledWith('W2N2');
        expect((global as any).Memory.observerIndex).toBe(0);
    });

    it('cycles correctly over multiple calls', () => {
        (global as any).Memory.observerTargets = ['A', 'B', 'C'];
        const obs = makeObserver();
        runObserver(obs); // index 0 → A, next = 1
        runObserver(obs); // index 1 → B, next = 2
        runObserver(obs); // index 2 → C, next = 0
        runObserver(obs); // index 0 → A again
        const calls = obs.observeRoom.mock.calls.map((c: any[]) => c[0]);
        expect(calls).toEqual(['A', 'B', 'C', 'A']);
    });
});
