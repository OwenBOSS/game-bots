import { describe, it, expect, beforeEach } from 'vitest';
import { period, resetPeriod } from '../utils/period';

beforeEach(() => {
    (global as any).Game = { time: 1000 };
    resetPeriod();
});

describe('period', () => {
    it('fires on first call for a new key', () => {
        expect(period(10, 'test')).toBe(true);
    });

    it('does not fire again before interval elapses', () => {
        period(10, 'test');
        (global as any).Game.time = 1009;
        expect(period(10, 'test')).toBe(false);
    });

    it('fires again once interval elapses', () => {
        period(10, 'test');
        (global as any).Game.time = 1010;
        expect(period(10, 'test')).toBe(true);
    });

    it('keys are independent', () => {
        period(10, 'a');
        (global as any).Game.time = 1005;
        expect(period(10, 'a')).toBe(false);
        expect(period(10, 'b')).toBe(true);
    });

    it('fires on first call after resetPeriod even within interval', () => {
        period(100, 'test');
        (global as any).Game.time = 1001;
        resetPeriod();
        expect(period(100, 'test')).toBe(true);
    });

    it('interval=1 fires every tick', () => {
        expect(period(1, 'tick')).toBe(true);
        (global as any).Game.time = 1001;
        expect(period(1, 'tick')).toBe(true);
        (global as any).Game.time = 1002;
        expect(period(1, 'tick')).toBe(true);
    });
});
