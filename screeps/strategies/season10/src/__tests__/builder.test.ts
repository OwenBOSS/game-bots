import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runBuilder } from '../roles/builder';

beforeEach(() => {
    (global as any).RESOURCE_ENERGY      = 'energy';
    (global as any).FIND_SOURCES_ACTIVE  = 112;
    (global as any).FIND_MY_STRUCTURES   = 108;
    (global as any).FIND_CONSTRUCTION_SITES = 109;
    (global as any).STRUCTURE_SPAWN      = 'spawn';
    (global as any).OK                   = 0;
    (global as any).ERR_NOT_IN_RANGE     = -9;
});

function makeBuilderCreep(opts: {
    energy?: number;
    cap?: number;
    working?: boolean;
} = {}): any {
    const energy = opts.energy ?? 0;
    const cap = opts.cap ?? 100;
    return {
        memory: { role: 'builder', working: opts.working ?? false },
        store: {
            [(global as any).RESOURCE_ENERGY]: energy,
            getFreeCapacity: () => cap - energy,
        },
        pos: {
            findClosestByPath: vi.fn(() => null),
        },
        harvest: vi.fn(() => 0),
        build: vi.fn(() => 0),
        transfer: vi.fn(() => 0),
        moveTo: vi.fn(() => 0),
    };
}

describe('runBuilder — state transitions', () => {
    it('switches to harvesting when energy is empty while working', () => {
        const creep = makeBuilderCreep({ energy: 0, working: true });
        creep.pos.findClosestByPath = vi.fn(() => null);
        runBuilder(creep);
        expect(creep.memory.working).toBe(false);
    });

    it('switches to building when energy is full', () => {
        const creep = makeBuilderCreep({ energy: 100, cap: 100, working: false });
        runBuilder(creep);
        expect(creep.memory.working).toBe(true);
    });
});

describe('runBuilder — building', () => {
    it('builds the closest construction site', () => {
        const site = { id: 'site1', pos: { x: 20, y: 20 } };
        const creep = makeBuilderCreep({ energy: 50, cap: 100, working: true });
        creep.pos.findClosestByPath = vi.fn(() => site);
        runBuilder(creep);
        expect(creep.build).toHaveBeenCalledWith(site);
    });

    it('moves toward site when out of range', () => {
        const site = { id: 'site1', pos: { x: 20, y: 20 } };
        const creep = makeBuilderCreep({ energy: 50, cap: 100, working: true });
        creep.pos.findClosestByPath = vi.fn(() => site);
        creep.build = vi.fn(() => (global as any).ERR_NOT_IN_RANGE);
        runBuilder(creep);
        expect(creep.moveTo).toHaveBeenCalledWith(site, expect.objectContaining({ reusePath: 5 }));
    });

    it('falls back to filling spawn when no construction sites exist', () => {
        const spawn = { structureType: 'spawn', store: { getFreeCapacity: () => 100 }, id: 'sp1' };
        const creep = makeBuilderCreep({ energy: 50, cap: 100, working: true });
        // findClosestByPath returns null for sites, spawn for structures
        creep.pos.findClosestByPath = vi.fn((type: number, opts?: any) => {
            if (type === (global as any).FIND_CONSTRUCTION_SITES) return null;
            return spawn;
        });
        runBuilder(creep);
        expect(creep.transfer).toHaveBeenCalledWith(spawn, (global as any).RESOURCE_ENERGY);
    });
});

describe('runBuilder — harvesting', () => {
    it('harvests nearest active source when not working', () => {
        const source = { id: 'src1' };
        const creep = makeBuilderCreep({ energy: 0, cap: 100, working: false });
        creep.pos.findClosestByPath = vi.fn(() => source);
        runBuilder(creep);
        expect(creep.harvest).toHaveBeenCalledWith(source);
    });

    it('moves to source when out of range', () => {
        const source = { id: 'src1' };
        const creep = makeBuilderCreep({ energy: 0, cap: 100, working: false });
        creep.pos.findClosestByPath = vi.fn(() => source);
        creep.harvest = vi.fn(() => (global as any).ERR_NOT_IN_RANGE);
        runBuilder(creep);
        expect(creep.moveTo).toHaveBeenCalledWith(source, expect.objectContaining({ reusePath: 5 }));
    });
});
