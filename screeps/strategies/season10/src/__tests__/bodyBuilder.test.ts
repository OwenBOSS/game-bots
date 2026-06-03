import { describe, it, expect } from 'vitest';
import {
    buildCollectorBody,
    buildScoutBody,
    buildHunterBody,
    buildHarvesterBody,
} from '../utils/bodyBuilder';

describe('buildCollectorBody', () => {
    it('returns null below 160e', () => {
        expect(buildCollectorBody(159)).toBeNull();
        expect(buildCollectorBody(0)).toBeNull();
    });

    it('returns RC1-2 tier [MOVE×3, TOUGH] at 160e–299e', () => {
        const body = buildCollectorBody(160);
        expect(body).toEqual(['move', 'move', 'move', 'tough']);
    });

    it('returns RC1-2 tier at 299e', () => {
        const body = buildCollectorBody(299);
        expect(body).toEqual(['move', 'move', 'move', 'tough']);
    });

    it('returns RC3-4 tier [MOVE×5, TOUGH×5] at 300e–659e', () => {
        const body = buildCollectorBody(300);
        expect(body).toEqual(['move', 'move', 'move', 'move', 'move', 'tough', 'tough', 'tough', 'tough', 'tough']);
    });

    it('returns RC3-4 tier at 659e', () => {
        const body = buildCollectorBody(659);
        expect(body).toEqual(['move', 'move', 'move', 'move', 'move', 'tough', 'tough', 'tough', 'tough', 'tough']);
    });

    it('returns RC5+ tier [MOVE×10, TOUGH×10, ATTACK×2] at 660e+', () => {
        const body = buildCollectorBody(660);
        expect(body).toEqual([
            'move', 'move', 'move', 'move', 'move',
            'move', 'move', 'move', 'move', 'move',
            'tough', 'tough', 'tough', 'tough', 'tough',
            'tough', 'tough', 'tough', 'tough', 'tough',
            'attack', 'attack',
        ]);
    });

    it('RC5+ tier at high budget', () => {
        const body = buildCollectorBody(5000);
        expect(body).not.toBeNull();
        expect(body!.filter(p => p === 'move')).toHaveLength(10);
        expect(body!.filter(p => p === 'tough')).toHaveLength(10);
        expect(body!.filter(p => p === 'attack')).toHaveLength(2);
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

    it('returns [WORK×2, CARRY, MOVE×2] at 350e', () => {
        expect(buildHarvesterBody(350)).toEqual(['work', 'work', 'carry', 'move', 'move']);
    });

    it('returns [WORK×5, MOVE] at 550e', () => {
        expect(buildHarvesterBody(550)).toEqual(['work', 'work', 'work', 'work', 'work', 'move']);
    });

    it('returns best body at high budget (capped at 550e tier)', () => {
        const body = buildHarvesterBody(5000);
        expect(body).toEqual(['work', 'work', 'work', 'work', 'work', 'move']);
    });
});
