import { describe, it, expect } from 'vitest';
import { computePID, DEFAULT_PID_CONFIG } from '../utils/pidController';
import type { PIDState } from '../utils/pidController';

const zeroPIDState = (): PIDState => ({ integral: 0, lastError: 0, lastTick: 0 });

describe('computePID', () => {
    describe('proportional term only (ki=kd=0)', () => {
        it('positive error (energy above setpoint) produces positive output', () => {
            const config = { ...DEFAULT_PID_CONFIG, kp: 2.0, ki: 0, kd: 0 };
            // energy=240, cap=300, setpoint=0.60 → sp=180, error=(240-180)/300=+0.2
            const { output } = computePID(240, 300, zeroPIDState(), config, 5);
            expect(output).toBeGreaterThan(0);
        });

        it('negative error (energy below setpoint) produces lower/negative output', () => {
            const config = { ...DEFAULT_PID_CONFIG, kp: 2.0, ki: 0, kd: 0 };
            // energy=60, cap=300, setpoint=0.60 → sp=180, error=(60-180)/300=-0.4
            const { output } = computePID(60, 300, zeroPIDState(), config, 5);
            expect(output).toBeLessThan(1); // reduced upgrader demand
        });

        it('zero error produces baseline output equal to outputMid', () => {
            const config = { ...DEFAULT_PID_CONFIG, kp: 2.0, ki: 0, kd: 0, outputMid: 1 };
            // energy exactly at setpoint
            const sp = Math.round(0.60 * 300); // 180
            const { output } = computePID(sp, 300, zeroPIDState(), config, 5);
            expect(output).toBeCloseTo(1, 5); // outputMid when error=0
        });

        it('P-component scales linearly with error magnitude', () => {
            const config = { ...DEFAULT_PID_CONFIG, kp: 3.0, ki: 0, kd: 0, outputMin: -10, outputMax: 10 };
            const { output: out1 } = computePID(240, 300, zeroPIDState(), config, 5); // error=+0.2
            const { output: out2 } = computePID(300, 300, zeroPIDState(), config, 5); // error=+0.4
            // P-component (output minus baseline) doubles when error doubles
            const mid = config.outputMid;
            expect(out2 - mid).toBeCloseTo((out1 - mid) * 2, 1);
        });
    });

    describe('integral term', () => {
        it('integral accumulates across successive calls', () => {
            const config = { ...DEFAULT_PID_CONFIG, kp: 0, ki: 1.0, kd: 0, outputMin: -100, outputMax: 100 };
            let state = zeroPIDState();
            // energy=240 each tick → persistent positive error
            let result = computePID(240, 300, state, config, 5);
            state = result.nextState;
            const firstOutput = result.output;

            result = computePID(240, 300, state, config, 10);
            state = result.nextState;
            const secondOutput = result.output;

            result = computePID(240, 300, state, config, 15);
            const thirdOutput = result.output;

            // Each call adds to integral → output grows
            expect(secondOutput).toBeGreaterThan(firstOutput);
            expect(thirdOutput).toBeGreaterThan(secondOutput);
        });

        it('integral is clamped by integralMax (anti-windup)', () => {
            const config = { ...DEFAULT_PID_CONFIG, kp: 0, ki: 1.0, kd: 0, integralMax: 2.0, outputMin: -100, outputMax: 100 };
            let state = zeroPIDState();
            // Run many iterations with large persistent error
            for (let t = 5; t <= 500; t += 5) {
                const result = computePID(300, 300, state, config, t); // max positive error
                state = result.nextState;
            }
            // Integral must be clamped
            expect(state.integral).toBeLessThanOrEqual(2.0 + 0.001);
            expect(state.integral).toBeGreaterThanOrEqual(-2.0 - 0.001);
        });

        it('integral decreases when error reverses', () => {
            const config = { ...DEFAULT_PID_CONFIG, kp: 0, ki: 0.5, kd: 0, outputMin: -100, outputMax: 100 };
            let state = zeroPIDState();
            // First build up positive integral
            for (let t = 5; t <= 50; t += 5) {
                const r = computePID(270, 300, state, config, t);
                state = r.nextState;
            }
            const intAfterPositive = state.integral;

            // Then apply negative error
            for (let t = 55; t <= 100; t += 5) {
                const r = computePID(60, 300, state, config, t);
                state = r.nextState;
            }
            expect(state.integral).toBeLessThan(intAfterPositive);
        });
    });

    describe('derivative term', () => {
        it('zero derivative on first call (no prior error)', () => {
            const config = { ...DEFAULT_PID_CONFIG, kp: 0, ki: 0, kd: 5.0, outputMin: -100, outputMax: 100 };
            // lastError = 0 in zeroPIDState, but first call sets initial error only
            const s = zeroPIDState();
            // With lastError=0 and current error=0, derivative should be 0
            const sp = Math.round(0.60 * 300);
            const { output } = computePID(sp, 300, s, config, 5);
            expect(output).toBeCloseTo(1, 5); // only outputMid (no P, no I, no D)
        });

        it('positive derivative (error growing) increases output', () => {
            const config = { ...DEFAULT_PID_CONFIG, kp: 0, ki: 0, kd: 3.0, outputMin: -10, outputMax: 10, outputMid: 0 };
            // Error grows from +0.1 to +0.3 (energy rising fast)
            const prevState: PIDState = { integral: 0, lastError: 0.1, lastTick: 0 };
            const { output } = computePID(289, 300, prevState, config, 5); // error ≈ +0.36
            expect(output).toBeGreaterThan(0); // derivative contribution is positive
        });

        it('negative derivative (error shrinking) reduces output toward zero', () => {
            const config = { ...DEFAULT_PID_CONFIG, kp: 0, ki: 0, kd: 3.0, outputMin: -10, outputMax: 10, outputMid: 0 };
            // Error was +0.4, now only +0.1 → falling fast
            const prevState: PIDState = { integral: 0, lastError: 0.4, lastTick: 0 };
            const { output: out } = computePID(210, 300, prevState, config, 5); // error ≈ +0.1
            // D contribution is negative (error fell), pulling output down from P alone
            const configNoD = { ...config, kd: 0 };
            const { output: outNoD } = computePID(210, 300, prevState, configNoD, 5);
            expect(out).toBeLessThan(outNoD);
        });
    });

    describe('output clamping', () => {
        it('output never exceeds outputMax', () => {
            const config = { ...DEFAULT_PID_CONFIG, kp: 100, ki: 0, kd: 0, outputMin: 0, outputMax: 4 };
            const { output } = computePID(300, 300, zeroPIDState(), config, 5); // huge error
            expect(output).toBeLessThanOrEqual(4);
        });

        it('output never goes below outputMin', () => {
            const config = { ...DEFAULT_PID_CONFIG, kp: 100, ki: 0, kd: 0, outputMin: 0, outputMax: 4 };
            const { output } = computePID(0, 300, zeroPIDState(), config, 5); // huge negative error
            expect(output).toBeGreaterThanOrEqual(0);
        });
    });

    describe('nextState', () => {
        it('nextState.lastError matches normalized error of this call', () => {
            const config = { ...DEFAULT_PID_CONFIG };
            const { nextState } = computePID(240, 300, zeroPIDState(), config, 5);
            // error = (240 - 0.60*300) / 300 = (240-180)/300 = 0.2
            expect(nextState.lastError).toBeCloseTo(0.2, 5);
        });

        it('nextState.lastTick matches the tick passed in', () => {
            const { nextState } = computePID(200, 300, zeroPIDState(), DEFAULT_PID_CONFIG, 42);
            expect(nextState.lastTick).toBe(42);
        });
    });
});
