import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runHauler } from '../roles/hauler';

// ── Local helpers ──────────────────────────────────────────────────────────────

function makeContainer(energy = 500): any {
    return {
        structureType: (global as any).STRUCTURE_CONTAINER,
        store: { [(global as any).RESOURCE_ENERGY]: energy },
    };
}

function makeSourceWithContainers(containers: any[]): any {
    return {
        id: 'src1',
        pos: {
            x: 10, y: 10,
            // Apply the filter that getBestSourceContainer passes so the mock behaves like
            // the real Screeps engine (which runs the filter server-side).
            findInRange: vi.fn((_type: number, _range: number, opts?: { filter?: (s: any) => boolean }) => {
                return opts?.filter ? containers.filter(opts.filter) : containers;
            }),
        },
    };
}

function makeHaulerSpawn(): any {
    return { name: 'Spawn1', pos: { x: 25, y: 25 } };
}

function makeHaulerStorage(freeCapacity = 500000): any {
    return {
        store: { getFreeCapacity: vi.fn(() => freeCapacity) },
    };
}

function makeUrgentSpawn(freeCapacity = 300): any {
    return {
        structureType: (global as any).STRUCTURE_SPAWN,
        store: { getFreeCapacity: vi.fn(() => freeCapacity) },
    };
}

function makeHaulerRoom(opts: {
    sources?: any[];
    storage?: any;
    controller?: any;
    spawns?: any[];
} = {}): any {
    return {
        name: 'W1N1',
        storage: opts.storage ?? null,
        controller: opts.controller ?? null,
        find: vi.fn((type: number) => {
            if (type === (global as any).FIND_SOURCES)   return opts.sources ?? [];
            if (type === (global as any).FIND_MY_SPAWNS) return opts.spawns  ?? [];
            return [];
        }),
    };
}

/** Build a creep in collect mode (working=false) with given energy in store. */
function makeHauler(opts: {
    energyAmount?: number;
    energyCapacity?: number;
    working?: boolean;
    closestResult?: any;
    room?: any;
} = {}): any {
    const energy   = opts.energyAmount   ?? 0;
    const capacity = opts.energyCapacity ?? 100;
    return {
        memory: { role: 'hauler', working: opts.working ?? false },
        store: {
            [(global as any).RESOURCE_ENERGY]: energy,
            getFreeCapacity: () => capacity - energy,
        },
        pos: {
            findClosestByPath: vi.fn(() => opts.closestResult ?? null),
        },
        room: opts.room ?? makeHaulerRoom(),
        withdraw:           vi.fn(() => (global as any).OK),
        pickup:             vi.fn(() => (global as any).OK),
        transfer:           vi.fn(() => (global as any).OK),
        upgradeController:  vi.fn(() => (global as any).OK),
        moveTo:             vi.fn(() => (global as any).OK),
    };
}

beforeEach(() => {
    (global as any).Memory = {
        scoreMap: {}, scoreCache: {}, knownRooms: [],
        observerIndex: 0, observerTargets: [],
    };
    (global as any).Game = {
        time: 1000, rooms: {}, creeps: {},
        getObjectById: () => null,
        map: { getRoomLinearDistance: () => 1, describeExits: () => ({}) },
    };
});

// ── State transitions ──────────────────────────────────────────────────────────

describe('runHauler — state transitions', () => {
    it('switches working→false when store is empty while in deliver mode', () => {
        const creep = makeHauler({ energyAmount: 0, energyCapacity: 100, working: true });
        runHauler(creep);
        expect(creep.memory.working).toBe(false);
    });

    it('switches working→true when store is completely full', () => {
        // Make store appear full so getFreeCapacity()===0
        const creep = makeHauler({ energyAmount: 100, energyCapacity: 100, working: false });
        // closestResult=null → deliver falls through to controller, which needs a room.controller
        creep.room = makeHaulerRoom({ controller: { level: 2, my: true } });
        runHauler(creep);
        expect(creep.memory.working).toBe(true);
    });

    it('stays in collect mode when partially full', () => {
        const creep = makeHauler({ energyAmount: 50, energyCapacity: 100, working: false });
        const source = makeSourceWithContainers([]);
        creep.room = makeHaulerRoom({ sources: [source] });
        runHauler(creep);
        expect(creep.memory.working).toBe(false);
    });

    it('stays in deliver mode when store still has energy', () => {
        const spawn = makeUrgentSpawn(300);
        const creep = makeHauler({
            energyAmount: 50, energyCapacity: 100, working: true,
            closestResult: spawn,
        });
        runHauler(creep);
        expect(creep.memory.working).toBe(true);
    });
});

// ── Collect: source containers ─────────────────────────────────────────────────

describe('runHauler — collect() from source containers', () => {
    it('withdraws from the container adjacent to a source', () => {
        const container = makeContainer(800);
        const source    = makeSourceWithContainers([container]);
        const room      = makeHaulerRoom({ sources: [source] });
        const creep     = makeHauler({ room });
        runHauler(creep);
        expect(creep.withdraw).toHaveBeenCalledWith(container, (global as any).RESOURCE_ENERGY);
    });

    it('picks the fullest container when multiple candidates exist', () => {
        const low  = makeContainer(200);
        const high = makeContainer(900);
        // Both containers are from the same source's adjacency range
        const source = makeSourceWithContainers([low, high]);
        const room   = makeHaulerRoom({ sources: [source] });
        const creep  = makeHauler({ room });
        runHauler(creep);
        expect(creep.withdraw).toHaveBeenCalledWith(high, (global as any).RESOURCE_ENERGY);
    });

    it('moves toward container when withdraw returns ERR_NOT_IN_RANGE', () => {
        const container = makeContainer(800);
        const source    = makeSourceWithContainers([container]);
        const room      = makeHaulerRoom({ sources: [source] });
        const creep     = makeHauler({ room });
        creep.withdraw.mockReturnValue((global as any).ERR_NOT_IN_RANGE);
        runHauler(creep);
        expect(creep.moveTo).toHaveBeenCalledWith(container, expect.objectContaining({ reusePath: 5 }));
    });

    it('skips containers with less than 50 energy (engine-side filter)', () => {
        // The filter in getBestSourceContainer requires energy >= 50.
        // makeSourceWithContainers applies the filter, so only containers >=50 survive.
        const tooEmpty = makeContainer(10);
        const source   = makeSourceWithContainers([tooEmpty]);
        const dropped  = { resourceType: (global as any).RESOURCE_ENERGY, amount: 200 };
        const room     = makeHaulerRoom({ sources: [source] });
        const creep    = makeHauler({ room });
        creep.pos.findClosestByPath.mockReturnValue(dropped);
        runHauler(creep);
        // No withdrawal from the too-empty container; falls through to picked up dropped
        expect(creep.withdraw).not.toHaveBeenCalled();
        expect(creep.pickup).toHaveBeenCalledWith(dropped);
    });

    it('aggregates containers from multiple sources and picks best overall', () => {
        const src1Container = makeContainer(300);
        const src2Container = makeContainer(700);
        const source1 = makeSourceWithContainers([src1Container]);
        const source2 = makeSourceWithContainers([src2Container]);
        const room    = makeHaulerRoom({ sources: [source1, source2] });
        const creep   = makeHauler({ room });
        runHauler(creep);
        expect(creep.withdraw).toHaveBeenCalledWith(src2Container, (global as any).RESOURCE_ENERGY);
    });
});

// ── Collect: dropped energy fallback ──────────────────────────────────────────

describe('runHauler — collect() dropped energy fallback', () => {
    it('picks up dropped energy when no containers exist', () => {
        const room    = makeHaulerRoom({ sources: [] });
        const dropped = { resourceType: (global as any).RESOURCE_ENERGY, amount: 200 };
        const creep   = makeHauler({ room });
        creep.pos.findClosestByPath.mockReturnValue(dropped);
        runHauler(creep);
        expect(creep.pickup).toHaveBeenCalledWith(dropped);
    });

    it('moves toward dropped energy when pickup returns ERR_NOT_IN_RANGE', () => {
        const room    = makeHaulerRoom({ sources: [] });
        const dropped = { resourceType: (global as any).RESOURCE_ENERGY, amount: 200 };
        const creep   = makeHauler({ room });
        creep.pos.findClosestByPath.mockReturnValue(dropped);
        creep.pickup.mockReturnValue((global as any).ERR_NOT_IN_RANGE);
        runHauler(creep);
        expect(creep.moveTo).toHaveBeenCalledWith(dropped, expect.objectContaining({ reusePath: 3 }));
    });

    it('moves to spawn to wait when no containers and no dropped energy', () => {
        const spawn = makeHaulerSpawn();
        const room  = makeHaulerRoom({ sources: [], spawns: [spawn] });
        const creep = makeHauler({ room });
        creep.pos.findClosestByPath.mockReturnValue(null);
        runHauler(creep);
        expect(creep.moveTo).toHaveBeenCalledWith(spawn, expect.objectContaining({ reusePath: 20 }));
    });

    it('does nothing when no containers, no dropped energy, and no spawn', () => {
        const room  = makeHaulerRoom({ sources: [] });
        const creep = makeHauler({ room });
        creep.pos.findClosestByPath.mockReturnValue(null);
        // Should not throw, and not move since no spawn
        expect(() => runHauler(creep)).not.toThrow();
        expect(creep.moveTo).not.toHaveBeenCalled();
    });
});

// ── Deliver: urgent structures ─────────────────────────────────────────────────

describe('runHauler — deliver() to urgent structures', () => {
    it('transfers to a spawn that has free capacity', () => {
        const spawn = makeUrgentSpawn(300);
        const creep = makeHauler({ energyAmount: 100, energyCapacity: 100, working: true, closestResult: spawn });
        runHauler(creep);
        expect(creep.transfer).toHaveBeenCalledWith(spawn, (global as any).RESOURCE_ENERGY);
    });

    it('moves toward urgent structure when transfer returns ERR_NOT_IN_RANGE', () => {
        const spawn = makeUrgentSpawn(300);
        const creep = makeHauler({ energyAmount: 100, energyCapacity: 100, working: true, closestResult: spawn });
        creep.transfer.mockReturnValue((global as any).ERR_NOT_IN_RANGE);
        runHauler(creep);
        expect(creep.moveTo).toHaveBeenCalledWith(spawn, expect.objectContaining({ reusePath: 5 }));
    });
});

// ── Deliver: storage fallback ──────────────────────────────────────────────────

describe('runHauler — deliver() to storage', () => {
    it('transfers to storage when no urgent structures have capacity', () => {
        const storage = makeHaulerStorage(500000);
        const room    = makeHaulerRoom({ storage });
        const creep   = makeHauler({ energyAmount: 100, energyCapacity: 100, working: true, room });
        creep.pos.findClosestByPath.mockReturnValue(null); // no urgent target
        runHauler(creep);
        expect(creep.transfer).toHaveBeenCalledWith(storage, (global as any).RESOURCE_ENERGY);
    });

    it('moves to storage when transfer returns ERR_NOT_IN_RANGE', () => {
        const storage = makeHaulerStorage(500000);
        const room    = makeHaulerRoom({ storage });
        const creep   = makeHauler({ energyAmount: 100, energyCapacity: 100, working: true, room });
        creep.pos.findClosestByPath.mockReturnValue(null);
        creep.transfer.mockReturnValue((global as any).ERR_NOT_IN_RANGE);
        runHauler(creep);
        expect(creep.moveTo).toHaveBeenCalledWith(storage, expect.objectContaining({ reusePath: 5 }));
    });

    it('skips full storage (getFreeCapacity returns 0)', () => {
        const storage    = makeHaulerStorage(0); // no free capacity
        const controller = { level: 3, my: true };
        const room       = makeHaulerRoom({ storage, controller });
        const creep      = makeHauler({ energyAmount: 100, energyCapacity: 100, working: true, room });
        creep.pos.findClosestByPath.mockReturnValue(null);
        runHauler(creep);
        // Should fall through to upgrading controller
        expect(creep.upgradeController).toHaveBeenCalledWith(controller);
    });
});

// ── Deliver: controller upgrade fallback ───────────────────────────────────────

describe('runHauler — deliver() controller upgrade fallback', () => {
    it('upgrades controller when no urgent targets and no storage', () => {
        const controller = { level: 2, my: true };
        const room       = makeHaulerRoom({ controller, storage: null });
        const creep      = makeHauler({ energyAmount: 100, energyCapacity: 100, working: true, room });
        creep.pos.findClosestByPath.mockReturnValue(null);
        runHauler(creep);
        expect(creep.upgradeController).toHaveBeenCalledWith(controller);
    });

    it('moves toward controller when upgradeController returns ERR_NOT_IN_RANGE', () => {
        const controller = { level: 2, my: true };
        const room       = makeHaulerRoom({ controller, storage: null });
        const creep      = makeHauler({ energyAmount: 100, energyCapacity: 100, working: true, room });
        creep.pos.findClosestByPath.mockReturnValue(null);
        creep.upgradeController.mockReturnValue((global as any).ERR_NOT_IN_RANGE);
        runHauler(creep);
        expect(creep.moveTo).toHaveBeenCalledWith(controller, expect.objectContaining({ reusePath: 5 }));
    });

    it('does nothing when no urgent targets, no storage, and no controller', () => {
        const room  = makeHaulerRoom({ storage: null, controller: null });
        const creep = makeHauler({ energyAmount: 100, energyCapacity: 100, working: true, room });
        creep.pos.findClosestByPath.mockReturnValue(null);
        expect(() => runHauler(creep)).not.toThrow();
        expect(creep.transfer).not.toHaveBeenCalled();
        expect(creep.upgradeController).not.toHaveBeenCalled();
    });
});
