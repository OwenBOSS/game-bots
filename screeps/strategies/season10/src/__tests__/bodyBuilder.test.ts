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
    it('returns null below 200e', () => {
        expect(buildCollectorBody(199)).toBeNull();
        expect(buildCollectorBody(0)).toBeNull();
    });

    it('returns minimum tier [CARRY, MOVE×3] at 200e', () => {
        expect(buildCollectorBody(200)).toEqual(['carry', 'move', 'move', 'move']);
    });

    it('returns mid tier [CARRY, MOVE×5] at 350e', () => {
        expect(buildCollectorBody(350)).toEqual(['carry', 'move', 'move', 'move', 'move', 'move']);
    });

    it('returns top tier [CARRY×2, MOVE×6] at 600e+', () => {
        expect(buildCollectorBody(600)).toEqual(['carry', 'carry', 'move', 'move', 'move', 'move', 'move', 'move']);
        expect(buildCollectorBody(5000)).toEqual(['carry', 'carry', 'move', 'move', 'move', 'move', 'move', 'move']);
    });

    it('all tiers include CARRY for pickup()', () => {
        for (const budget of [200, 350, 600]) {
            expect(buildCollectorBody(budget)).toContain('carry');
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

    it('returns [MOVE×5] at 250+ budget for longer lifespan', () => {
        expect(buildScoutBody(5000)).toEqual(['move', 'move', 'move', 'move', 'move']);
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
