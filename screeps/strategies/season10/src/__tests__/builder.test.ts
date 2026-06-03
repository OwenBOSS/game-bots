import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runBuilder } from '../roles/builder';

beforeEach(() => {
    (global as any).RESOURCE_ENERGY         = 'energy';
    (global as any).FIND_SOURCES_ACTIVE     = 112;
    (global as any).FIND_STRUCTURES         = 107;
    (global as any).FIND_MY_STRUCTURES      = 108;
    (global as any).FIND_CONSTRUCTION_SITES = 109;
    (global as any).STRUCTURE_SPAWN         = 'spawn';
    (global as any).STRUCTURE_CONTAINER     = 'container';
    (global as any).STRUCTURE_ROAD          = 'road';
    (global as any).OK                      = 0;
    (global as any).ERR_NOT_IN_RANGE        = -9;
});

function makeBuilderCreep(opts: {
    energy?: number;
    cap?: number;
    working?: boolean;
} = {}): any {
    const energy = opts.energy ?? 0;
    const cap = opts.cap ?? 100;
    return {
        name: 'builder1',
        memory: { role: 'builder', working: opts.working ?? false },
        store: {
            [(global as any).RESOURCE_ENERGY]: energy,
            getFreeCapacity: () => cap - energy,
        },
        room: { name: 'W1N1' },
        pos: {
            findClosestByPath: vi.fn(() => null),
            getRangeTo: vi.fn(() => 0),
        },
        harvest:  vi.fn(() => 0),
        build:    vi.fn(() => 0),
        transfer: vi.fn(() => 0),
        repair:   vi.fn(() => 0),
        withdraw: vi.fn(() => 0),
        moveTo:   vi.fn(() => 0),
    };
}

describe('runBuilder — state transitions', () => {
    it('switches to harvesting when energy is empty while working', () => {
        const creep = makeBuilderCreep({ energy: 0, working: true });
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

    it('repairs damaged structures when no construction sites exist', () => {
        const damaged = { structureType: 'container', hits: 50000, hitsMax: 250000 };
        const creep = makeBuilderCreep({ energy: 50, cap: 100, working: true });
        creep.pos.findClosestByPath = vi.fn((type: number) => {
            if (type === (global as any).FIND_CONSTRUCTION_SITES) return null;
            if (type === (global as any).FIND_STRUCTURES) return damaged;
            return null;
        });
        runBuilder(creep);
        expect(creep.repair).toHaveBeenCalledWith(damaged);
    });

    it('falls back to filling spawn when no sites and nothing to repair', () => {
        const spawn = { structureType: 'spawn', store: { getFreeCapacity: () => 100 }, id: 'sp1' };
        const creep = makeBuilderCreep({ energy: 50, cap: 100, working: true });
        creep.pos.findClosestByPath = vi.fn((type: number) => {
            if (type === (global as any).FIND_CONSTRUCTION_SITES) return null;
            if (type === (global as any).FIND_STRUCTURES) return null; // no damaged structures
            return spawn;
        });
        runBuilder(creep);
        expect(creep.transfer).toHaveBeenCalledWith(spawn, (global as any).RESOURCE_ENERGY);
    });
});

describe('runBuilder — collecting energy', () => {
    it('withdraws from a container when one is available', () => {
        const container = { structureType: 'container', store: { getFreeCapacity: () => 0, energy: 200 } };
        const creep = makeBuilderCreep({ energy: 0, cap: 100, working: false });
        creep.pos.findClosestByPath = vi.fn(() => container);
        runBuilder(creep);
        expect(creep.withdraw).toHaveBeenCalledWith(container, (global as any).RESOURCE_ENERGY);
        expect(creep.harvest).not.toHaveBeenCalled();
    });

    it('harvests nearest active source when no container has energy', () => {
        const source = { id: 'src1' };
        const creep = makeBuilderCreep({ energy: 0, cap: 100, working: false });
        creep.pos.findClosestByPath = vi.fn((type: number) => {
            if (type === (global as any).FIND_STRUCTURES) return null; // no container
            return source;
        });
        runBuilder(creep);
        expect(creep.harvest).toHaveBeenCalledWith(source);
    });

    it('moves to source when harvest returns ERR_NOT_IN_RANGE', () => {
        const source = { id: 'src1' };
        const creep = makeBuilderCreep({ energy: 0, cap: 100, working: false });
        creep.pos.findClosestByPath = vi.fn((type: number) => {
            if (type === (global as any).FIND_STRUCTURES) return null;
            return source;
        });
        creep.harvest = vi.fn(() => (global as any).ERR_NOT_IN_RANGE);
        runBuilder(creep);
        expect(creep.moveTo).toHaveBeenCalledWith(source, expect.objectContaining({ reusePath: 5 }));
    });
});
