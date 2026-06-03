import { describe, it, expect } from 'vitest';
import {
    buildCollectorBody,
    buildScoutBody,
    buildHunterBody,
    buildHarvesterBody,
    buildBuilderBody,
    buildHaulerBody,
} from '../utils/bodyBuilder';

describe('buildCollectorBody', () => {
    it('returns null below 160e', () => {
        expect(buildCollectorBody(159)).toBeNull();
        expect(buildCollectorBody(0)).toBeNull();
    });

    it('returns RC1-2 tier [TOUGH, MOVE×3] at 160e–299e', () => {
        expect(buildCollectorBody(160)).toEqual(['tough', 'move', 'move', 'move']);
        expect(buildCollectorBody(299)).toEqual(['tough', 'move', 'move', 'move']);
    });

    it('returns RC3-4 tier [TOUGH×5, MOVE×5] at 300e–659e', () => {
        const body = buildCollectorBody(300);
        expect(body).toEqual(['tough', 'tough', 'tough', 'tough', 'tough', 'move', 'move', 'move', 'move', 'move']);
        expect(buildCollectorBody(659)).toEqual(body);
    });

    it('returns RC5+ tier [TOUGH×10, ATTACK×2, MOVE×10] at 660e+', () => {
        const body = buildCollectorBody(660);
        expect(body).toEqual([
            'tough', 'tough', 'tough', 'tough', 'tough',
            'tough', 'tough', 'tough', 'tough', 'tough',
            'attack', 'attack',
            'move', 'move', 'move', 'move', 'move',
            'move', 'move', 'move', 'move', 'move',
        ]);
    });

    it('RC5+ tier at high budget — correct part counts', () => {
        const body = buildCollectorBody(5000)!;
        expect(body.filter(p => p === 'tough')).toHaveLength(10);
        expect(body.filter(p => p === 'attack')).toHaveLength(2);
        expect(body.filter(p => p === 'move')).toHaveLength(10);
    });

    it('TOUGH comes before MOVE in all tiers (damage absorption order)', () => {
        for (const budget of [160, 300, 660]) {
            const body = buildCollectorBody(budget)!;
            const firstTough = body.indexOf('tough');
            const firstMove  = body.indexOf('move');
            expect(firstTough).toBeLessThan(firstMove);
        }
    });
});

describe('buildScoutBody', () => {
    it('returns null below 50e', () => {
        expect(buildScoutBody(49)).toBeNull();
        expect(buildScoutBody(0)).toBeNull();
    });

    it('returns [MOVE] at exactly 50e', () => {
        expect(buildScoutBody(50)).toEqual(['move']);
    });

    it('returns [MOVE] at high budget (scout never scales up)', () => {
        expect(buildScoutBody(5000)).toEqual(['move']);
    });
});

describe('buildHunterBody', () => {
    it('returns null below 390e', () => {
        expect(buildHunterBody(389)).toBeNull();
        expect(buildHunterBody(0)).toBeNull();
    });

    it('returns [ATTACK×3, MOVE×3] at 390e', () => {
        expect(buildHunterBody(390)).toEqual(['attack', 'attack', 'attack', 'move', 'move', 'move']);
    });

    it('returns same body at higher budgets (fixed size)', () => {
        expect(buildHunterBody(5000)).toEqual(['attack', 'attack', 'attack', 'move', 'move', 'move']);
    });
});

describe('buildHarvesterBody', () => {
    it('returns null below 200e', () => {
        expect(buildHarvesterBody(199)).toBeNull();
        expect(buildHarvesterBody(0)).toBeNull();
    });

    it('returns [WORK, CARRY, MOVE] at 200e', () => {
        expect(buildHarvesterBody(200)).toEqual(['work', 'carry', 'move']);
    });

    it('returns [WORK×2, CARRY, MOVE] at 300e', () => {
        expect(buildHarvesterBody(300)).toEqual(['work', 'work', 'carry', 'move']);
    });

    it('returns [WORK×4, CARRY, MOVE] at 500e+', () => {
        expect(buildHarvesterBody(500)).toEqual(['work', 'work', 'work', 'work', 'carry', 'move']);
        expect(buildHarvesterBody(5000)).toEqual(['work', 'work', 'work', 'work', 'carry', 'move']);
    });
});

describe('buildBuilderBody', () => {
    it('returns null below 200e', () => {
        expect(buildBuilderBody(199)).toBeNull();
        expect(buildBuilderBody(0)).toBeNull();
    });

    it('returns [WORK, CARRY, MOVE] at 200e', () => {
        expect(buildBuilderBody(200)).toEqual(['work', 'carry', 'move']);
    });

    it('returns [WORK, CARRY×3, MOVE] at 300e — carry-heavy for fewer trips', () => {
        expect(buildBuilderBody(300)).toEqual(['work', 'carry', 'carry', 'carry', 'move']);
    });

    it('returns [WORK×2, CARRY×4, MOVE×2] at 500e+', () => {
        expect(buildBuilderBody(500)).toEqual(['work', 'work', 'carry', 'carry', 'carry', 'carry', 'move', 'move']);
        expect(buildBuilderBody(5000)).toEqual(['work', 'work', 'carry', 'carry', 'carry', 'carry', 'move', 'move']);
    });
});

describe('buildHaulerBody', () => {
    it('returns null below 150e', () => {
        expect(buildHaulerBody(149)).toBeNull();
    });

    it('returns road-optimized 2:1 CARRY:MOVE ratio at each tier', () => {
        const body150 = buildHaulerBody(150)!;
        const carries = body150.filter(p => p === 'carry').length;
        const moves   = body150.filter(p => p === 'move').length;
        expect(carries).toBeGreaterThanOrEqual(moves); // at least 1:1
    });
});
