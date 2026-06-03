import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runHarvester } from '../roles/harvester';

function makeUpgradeTarget(): any {
    return { id: 'ctrl', pos: { x: 30, y: 30 } };
}

function makeHarvesterCreep(opts: {
    energy?: number;
    energyCap?: number;
    rcLevel?: number;
    working?: boolean;
} = {}): any {
    const energy = opts.energy ?? 0;
    const cap = opts.energyCap ?? 50;
    return {
        memory: { role: 'harvester', working: opts.working ?? false },
        store: {
            [(global as any).RESOURCE_ENERGY]: energy,
            getFreeCapacity: () => cap - energy,
        },
        room: {
            controller: { level: opts.rcLevel ?? 2, upgradeController: vi.fn() },
            find: vi.fn(() => [{ id: 'src1' }]),
        },
        harvest: vi.fn(() => 0),
        upgradeController: vi.fn(() => 0),
        transfer: vi.fn(() => 0),
        moveTo: vi.fn(() => 0),
        pos: { findClosestByPath: vi.fn(() => ({ id: 'spawn1' })) },
    };
}

beforeEach(() => {
    (global as any).RESOURCE_ENERGY = 'energy';
    (global as any).FIND_SOURCES_ACTIVE = 112;
    (global as any).FIND_MY_STRUCTURES = 108;
    (global as any).STRUCTURE_SPAWN = 'spawn';
    (global as any).STRUCTURE_EXTENSION = 'extension';
    (global as any).OK = 0;
    (global as any).ERR_NOT_IN_RANGE = -9;
});

describe('runHarvester — RC1: upgrade controller only', () => {
    it('upgrades controller (not fills spawn) when RC1 and has energy', () => {
        const creep = makeHarvesterCreep({ energy: 50, energyCap: 50, rcLevel: 1, working: true });
        runHarvester(creep);
        expect(creep.upgradeController).toHaveBeenCalledWith(creep.room.controller);
        expect(creep.transfer).not.toHaveBeenCalled();
    });

    it('harvests source when empty at RC1', () => {
        const creep = makeHarvesterCreep({ energy: 0, energyCap: 50, rcLevel: 1, working: false });
        const source = { id: 'src1' };
        creep.pos.findClosestByPath = vi.fn(() => source);
        creep.room.find = vi.fn(() => [source]);
        runHarvester(creep);
        expect(creep.harvest).toHaveBeenCalledWith(source);
    });
});

describe('runHarvester — RC2+: fill spawn/extensions', () => {
    it('transfers energy to spawn at RC2', () => {
        const creep = makeHarvesterCreep({ energy: 50, energyCap: 50, rcLevel: 2, working: true });
        const spawnTarget = { id: 'spawn1', store: { getFreeCapacity: () => 100 } };
        creep.pos.findClosestByPath = vi.fn(() => spawnTarget);
        runHarvester(creep);
        expect(creep.transfer).toHaveBeenCalledWith(spawnTarget, (global as any).RESOURCE_ENERGY);
        expect(creep.upgradeController).not.toHaveBeenCalled();
    });

    it('moves toward spawn when out of range at RC2', () => {
        const creep = makeHarvesterCreep({ energy: 50, energyCap: 50, rcLevel: 2, working: true });
        const spawnTarget = { id: 'spawn1', store: { getFreeCapacity: () => 100 } };
        creep.pos.findClosestByPath = vi.fn(() => spawnTarget);
        creep.transfer = vi.fn(() => (global as any).ERR_NOT_IN_RANGE);
        runHarvester(creep);
        expect(creep.moveTo).toHaveBeenCalledWith(spawnTarget, expect.objectContaining({ reusePath: 5 }));
    });
});

describe('runHarvester — state transitions', () => {
    it('switches to harvesting when energy is empty', () => {
        const creep = makeHarvesterCreep({ energy: 0, energyCap: 50, rcLevel: 2, working: true });
        runHarvester(creep);
        expect(creep.memory.working).toBe(false);
    });

    it('switches to delivering when energy is full', () => {
        const creep = makeHarvesterCreep({ energy: 50, energyCap: 50, rcLevel: 2, working: false });
        runHarvester(creep);
        expect(creep.memory.working).toBe(true);
    });
});
