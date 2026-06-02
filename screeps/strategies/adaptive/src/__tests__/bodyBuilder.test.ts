import { describe, it, expect } from 'vitest';
import { buildBody } from '../utils/bodyBuilder';

// Shorthand aliases matching the Screeps global values set in setup.ts
const W  = 'work'          as BodyPartConstant;
const M  = 'move'          as BodyPartConstant;
const C  = 'carry'         as BodyPartConstant;
const A  = 'attack'        as BodyPartConstant;
const RA = 'ranged_attack' as BodyPartConstant;
const H  = 'heal'          as BodyPartConstant;
const T  = 'tough'         as BodyPartConstant;
const CL = 'claim'         as BodyPartConstant;

describe('buildBody', () => {
    describe('unknown role', () => {
        it('returns null', () => {
            expect(buildBody('unknown' as any, 9999)).toBeNull();
        });
    });

    // ─── harvester ──────────────────────────────────────────────────────────────

    describe('harvester', () => {
        it('returns null below 200e', () => {
            expect(buildBody('harvester', 199)).toBeNull();
        });

        it('returns 1 WORK + CARRY + MOVE at 200e', () => {
            expect(buildBody('harvester', 200)).toEqual([W, C, M]);
        });

        it('returns 2 WORK + CARRY + MOVE at 300e', () => {
            expect(buildBody('harvester', 300)).toEqual([W, W, C, M]);
        });

        it('caps at 6 WORK parts regardless of budget', () => {
            const body = buildBody('harvester', 10_000)!;
            expect(body.filter(p => p === W)).toHaveLength(6);
        });

        it('ends with CARRY then MOVE', () => {
            const body = buildBody('harvester', 500)!;
            expect(body.at(-2)).toBe(C);
            expect(body.at(-1)).toBe(M);
        });
    });

    // ─── hauler ─────────────────────────────────────────────────────────────────

    describe('hauler', () => {
        it('returns null below 150e', () => {
            expect(buildBody('hauler', 149)).toBeNull();
        });

        it('returns 2 CARRY + 1 MOVE at 150e', () => {
            expect(buildBody('hauler', 150)).toEqual([C, C, M]);
        });

        it('scales to 2 units at 300e', () => {
            const body = buildBody('hauler', 300)!;
            expect(body.filter(p => p === C)).toHaveLength(4);
            expect(body.filter(p => p === M)).toHaveLength(2);
        });

        it('caps at 10 units (20 CARRY, 10 MOVE) regardless of budget', () => {
            const body = buildBody('hauler', 10_000)!;
            expect(body.filter(p => p === C)).toHaveLength(20);
            expect(body.filter(p => p === M)).toHaveLength(10);
        });

        it('has 2:1 CARRY:MOVE ratio', () => {
            const body = buildBody('hauler', 900)!;
            const carry = body.filter(p => p === C).length;
            const move  = body.filter(p => p === M).length;
            expect(carry).toBe(move * 2);
        });
    });

    // ─── upgrader ───────────────────────────────────────────────────────────────

    describe('upgrader', () => {
        it('returns null below 200e', () => {
            expect(buildBody('upgrader', 199)).toBeNull();
        });

        it('returns minimal [W, C, M] at 200–349e', () => {
            expect(buildBody('upgrader', 250)).toEqual([W, C, M]);
        });

        it('uses 2×WORK per unit at 350e+', () => {
            const body = buildBody('upgrader', 350)!;
            expect(body.filter(p => p === W)).toHaveLength(2);
            expect(body.filter(p => p === C)).toHaveLength(1);
            expect(body.filter(p => p === M)).toHaveLength(1);
        });

        it('caps at 10 units', () => {
            const body = buildBody('upgrader', 10_000)!;
            expect(body.filter(p => p === W)).toHaveLength(20);
        });
    });

    // ─── builder / repairer ─────────────────────────────────────────────────────

    describe('builder', () => {
        it('returns null below 200e', () => {
            expect(buildBody('builder', 199)).toBeNull();
        });

        it('returns [W, C, M] at 200e', () => {
            expect(buildBody('builder', 200)).toEqual([W, C, M]);
        });

        it('scales correctly at 400e', () => {
            const body = buildBody('builder', 400)!;
            expect(body.filter(p => p === W)).toHaveLength(2);
            expect(body.filter(p => p === C)).toHaveLength(2);
            expect(body.filter(p => p === M)).toHaveLength(2);
        });

        it('caps at 8 units', () => {
            const body = buildBody('builder', 10_000)!;
            expect(body.filter(p => p === W)).toHaveLength(8);
        });
    });

    describe('repairer', () => {
        it('shares body formula with builder', () => {
            expect(buildBody('repairer', 400)).toEqual(buildBody('builder', 400));
        });
    });

    // ─── scout ──────────────────────────────────────────────────────────────────

    describe('scout', () => {
        it('returns null below 50e', () => {
            expect(buildBody('scout', 49)).toBeNull();
        });

        it('returns 1 MOVE at 50e', () => {
            expect(buildBody('scout', 50)).toEqual([M]);
        });

        it('always returns exactly 1 MOVE regardless of budget', () => {
            // Pure-MOVE body has zero fatigue → 1 MOVE is already full speed.
            // Extra MOVE parts waste energy with no mechanical benefit.
            const body = buildBody('scout', 10_000)!;
            expect(body).toEqual([M]);
        });
    });

    // ─── claimer ────────────────────────────────────────────────────────────────

    describe('claimer', () => {
        it('returns null below 650e', () => {
            expect(buildBody('claimer', 649)).toBeNull();
        });

        it('returns [CLAIM, MOVE, MOVE] at 650e (extraMoves=1 because (650-600)/50=1)', () => {
            expect(buildBody('claimer', 650)).toEqual([CL, M, M]);
        });

        it('adds up to 4 extra MOVE parts', () => {
            const body = buildBody('claimer', 850)!;
            expect(body[0]).toBe(CL);
            expect(body.filter(p => p === M)).toHaveLength(5);
        });

        it('caps extra MOVE at 4', () => {
            const body = buildBody('claimer', 10_000)!;
            expect(body.filter(p => p === M)).toHaveLength(5);
        });
    });

    // ─── reserver ───────────────────────────────────────────────────────────────

    describe('reserver', () => {
        it('returns null below 650e', () => {
            expect(buildBody('reserver', 649)).toBeNull();
        });

        it('returns [CLAIM, MOVE] at 650e', () => {
            expect(buildBody('reserver', 650)).toEqual([CL, M]);
        });

        it('adds extra MOVE with budget headroom', () => {
            const body = buildBody('reserver', 750)!;
            expect(body.filter(p => p === M).length).toBeGreaterThan(1);
        });
    });

    // ─── scavenger ──────────────────────────────────────────────────────────────

    describe('scavenger', () => {
        it('returns null below 180e', () => {
            expect(buildBody('scavenger', 179)).toBeNull();
        });

        it('has TOUGH first at 180e', () => {
            const body = buildBody('scavenger', 180)!;
            expect(body[0]).toBe(T);
        });

        it('ends with MOVE', () => {
            const body = buildBody('scavenger', 360)!;
            expect(body.at(-1)).toBe(M);
        });

        it('caps at 8 units', () => {
            const body = buildBody('scavenger', 10_000)!;
            expect(body.filter(p => p === T)).toHaveLength(8);
        });
    });

    // ─── courier ────────────────────────────────────────────────────────────────

    describe('courier', () => {
        it('returns null below 100e', () => {
            expect(buildBody('courier', 99)).toBeNull();
        });

        it('returns [CARRY, MOVE] at 100e', () => {
            expect(buildBody('courier', 100)).toEqual([C, M]);
        });

        it('has 1:1 CARRY:MOVE ratio', () => {
            const body = buildBody('courier', 500)!;
            expect(body.filter(p => p === C).length).toBe(body.filter(p => p === M).length);
        });

        it('caps at 16 units', () => {
            const body = buildBody('courier', 10_000)!;
            expect(body.filter(p => p === C)).toHaveLength(16);
        });
    });

    // ─── warrior ────────────────────────────────────────────────────────────────

    describe('warrior', () => {
        it('returns null below 130e', () => {
            expect(buildBody('warrior', 129)).toBeNull();
        });

        it('returns [ATTACK, MOVE] at 130–259e', () => {
            expect(buildBody('warrior', 130)).toEqual([A, M]);
        });

        it('returns [ATTACK, ATTACK, MOVE, MOVE] at 260–439e', () => {
            expect(buildBody('warrior', 260)).toEqual([A, A, M, M]);
        });

        it('starts with TOUGH at 440e+', () => {
            const body = buildBody('warrior', 440)!;
            expect(body[0]).toBe(T);
        });

        it('includes HEAL parts at 440e+', () => {
            const body = buildBody('warrior', 440)!;
            expect(body.filter(p => p === H).length).toBeGreaterThan(0);
        });

        it('MOVE count = TOUGH + ATTACK + HEAL (2× MOVE per unit)', () => {
            const body = buildBody('warrior', 440)!;
            const units = body.filter(p => p === T).length;
            expect(body.filter(p => p === M)).toHaveLength(units * 2);
        });

        it('caps at 8 units', () => {
            const body = buildBody('warrior', 10_000)!;
            expect(body.filter(p => p === T)).toHaveLength(8);
        });

        it('ordering: TOUGH first, MOVE last', () => {
            const body = buildBody('warrior', 880)!;
            expect(body[0]).toBe(T);
            expect(body.at(-1)).toBe(M);
        });
    });

    // ─── ranger ─────────────────────────────────────────────────────────────────

    describe('ranger', () => {
        it('returns null below 200e', () => {
            expect(buildBody('ranger', 199)).toBeNull();
        });

        it('returns [RANGED_ATTACK, MOVE, MOVE] at 200–399e', () => {
            expect(buildBody('ranger', 200)).toEqual([RA, M, M]);
        });

        it('returns body with HEAL at 400–509e', () => {
            const body = buildBody('ranger', 400)!;
            expect(body.includes(H)).toBe(true);
        });

        it('starts with TOUGH at 510e+', () => {
            expect(buildBody('ranger', 510)![0]).toBe(T);
        });

        it('caps at 6 units', () => {
            const body = buildBody('ranger', 10_000)!;
            expect(body.filter(p => p === T)).toHaveLength(6);
        });
    });

    // ─── healer ─────────────────────────────────────────────────────────────────

    describe('healer', () => {
        it('returns null below 300e', () => {
            expect(buildBody('healer', 299)).toBeNull();
        });

        it('returns [HEAL, MOVE] at 300–359e', () => {
            expect(buildBody('healer', 300)).toEqual([H, M]);
        });

        it('starts with TOUGH at 360e+', () => {
            expect(buildBody('healer', 360)![0]).toBe(T);
        });

        it('has no ATTACK or RANGED_ATTACK parts', () => {
            const body = buildBody('healer', 1000)!;
            expect(body.includes(A)).toBe(false);
            expect(body.includes(RA)).toBe(false);
        });

        it('MOVE count = 2× unit count at 360e+', () => {
            const body = buildBody('healer', 720)!;
            const units = body.filter(p => p === T).length;
            expect(body.filter(p => p === M)).toHaveLength(units * 2);
        });

        it('caps at 8 units', () => {
            const body = buildBody('healer', 10_000)!;
            expect(body.filter(p => p === T)).toHaveLength(8);
        });
    });
});
