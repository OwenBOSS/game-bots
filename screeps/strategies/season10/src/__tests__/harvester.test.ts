import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runHarvester } from '../roles/harvester';

// Globals set in setup.ts; re-declare here for clarity on what this suite needs.
beforeEach(() => {
    (global as any).RESOURCE_ENERGY    = 'energy';
    (global as any).FIND_SOURCES       = 105;
    (global as any).FIND_MY_CREEPS     = 104;
    (global as any).FIND_MY_STRUCTURES = 108;
    (global as any).FIND_STRUCTURES    = 107;
    (global as any).STRUCTURE_SPAWN       = 'spawn';
    (global as any).STRUCTURE_EXTENSION   = 'extension';
    (global as any).STRUCTURE_CONTAINER   = 'container';
    (global as any).OK               = 0;
    (global as any).ERR_NOT_IN_RANGE = -9;
    (global as any).Game = {
        time: 1001,
        getObjectById: vi.fn(() => null),
        rooms: {},
        creeps: {},
        map: { getRoomLinearDistance: () => 1, describeExits: () => ({}) },
    };
});

function makeSource(containerNearby: any = null): any {
    return {
        id: 'src1',
        pos: {
            x: 25, y: 15,
            findInRange: vi.fn(() => containerNearby ? [containerNearby] : []),
        },
    };
}

function makeContainer(): any {
    return {
        id: 'cont1',
        structureType: 'container',
        pos: { x: 25, y: 14 },
        store: {
            [(global as any).RESOURCE_ENERGY]: 100,
            getFreeCapacity: () => 100,
        },
    };
}

function makeHarvesterCreep(opts: {
    energy?: number;
    cap?: number;
    working?: boolean;
    atContainerPos?: boolean;
} = {}): any {
    const energy = opts.energy ?? 0;
    const cap    = opts.cap    ?? 200;
    const source = makeSource();
    return {
        memory: { role: 'harvester', working: opts.working ?? false, sourceId: 'src1' },
        store: {
            [(global as any).RESOURCE_ENERGY]: energy,
            getFreeCapacity: () => cap - energy,
        },
        room: {
            find: vi.fn((type: number) => {
                if (type === (global as any).FIND_SOURCES) return [source];
                if (type === (global as any).FIND_MY_CREEPS) return [];
                return [];
            }),
            controller: { level: 2 },
        },
        pos: {
            isEqualTo: vi.fn(() => opts.atContainerPos ?? false),
            findClosestByPath: vi.fn(() => null),
        },
        harvest:           vi.fn(() => 0),
        transfer:          vi.fn(() => 0),
        moveTo:            vi.fn(() => 0),
        upgradeController: vi.fn(() => 0),
    };
}

beforeEach(() => {
    (global as any).Game.getObjectById = vi.fn((id: string) => {
        if (id === 'src1') return makeSource();
        return null;
    });
});

describe('runHarvester — stationary (container present)', () => {
    it('moves to container position when not already there', () => {
        const container = makeContainer();
        const source = makeSource(container);
        (global as any).Game.getObjectById = vi.fn(() => source);

        const creep = makeHarvesterCreep({ atContainerPos: false });
        runHarvester(creep);
        expect(creep.moveTo).toHaveBeenCalledWith(container.pos, expect.objectContaining({ reusePath: 10 }));
        expect(creep.harvest).not.toHaveBeenCalled();
    });

    it('harvests when standing on container', () => {
        const container = makeContainer();
        const source = makeSource(container);
        (global as any).Game.getObjectById = vi.fn(() => source);

        const creep = makeHarvesterCreep({ energy: 50, cap: 200, atContainerPos: true });
        runHarvester(creep);
        expect(creep.harvest).toHaveBeenCalledWith(source);
    });

    it('transfers to container when full and standing on it', () => {
        const container = makeContainer();
        const source = makeSource(container);
        (global as any).Game.getObjectById = vi.fn(() => source);

        const creep = makeHarvesterCreep({ energy: 200, cap: 200, atContainerPos: true });
        runHarvester(creep);
        expect(creep.transfer).toHaveBeenCalledWith(container, (global as any).RESOURCE_ENERGY);
    });
});

describe('runHarvester — mobile (no container)', () => {
    it('harvests from source when not working', () => {
        const source = makeSource(); // no container
        (global as any).Game.getObjectById = vi.fn(() => source);

        const creep = makeHarvesterCreep({ energy: 0, working: false });
        runHarvester(creep);
        expect(creep.harvest).toHaveBeenCalledWith(source);
    });

    it('delivers to spawn/extensions when full', () => {
        const source = makeSource();
        (global as any).Game.getObjectById = vi.fn(() => source);
        const spawn = { id: 'sp1', structureType: 'spawn', store: { getFreeCapacity: () => 100 } };

        const creep = makeHarvesterCreep({ energy: 200, cap: 200, working: true });
        creep.pos.findClosestByPath = vi.fn(() => spawn);
        runHarvester(creep);
        expect(creep.transfer).toHaveBeenCalledWith(spawn, (global as any).RESOURCE_ENERGY);
    });

    it('upgrades controller as overflow when spawn is full', () => {
        const source = makeSource();
        (global as any).Game.getObjectById = vi.fn(() => source);

        const creep = makeHarvesterCreep({ energy: 200, cap: 200, working: true });
        creep.pos.findClosestByPath = vi.fn(() => null); // no spawn with capacity
        runHarvester(creep);
        expect(creep.upgradeController).toHaveBeenCalled();
    });

    it('switches to delivering when energy is full', () => {
        const source = makeSource();
        (global as any).Game.getObjectById = vi.fn(() => source);
        const creep = makeHarvesterCreep({ energy: 200, cap: 200, working: false });
        runHarvester(creep);
        expect(creep.memory.working).toBe(true);
    });

    it('switches to harvesting when energy is empty', () => {
        const source = makeSource();
        (global as any).Game.getObjectById = vi.fn(() => source);
        const creep = makeHarvesterCreep({ energy: 0, working: true });
        runHarvester(creep);
        expect(creep.memory.working).toBe(false);
    });
});
