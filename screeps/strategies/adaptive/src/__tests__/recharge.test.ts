import { describe, it, expect, beforeEach, vi } from 'vitest';
import { recharge } from '../utils/recharge';

// ─── Mock factory ─────────────────────────────────────────────────────────────

function makeLink(energy: number, capacity = 800): any {
    return {
        structureType: (global as any).STRUCTURE_LINK,
        store: {
            [(global as any).RESOURCE_ENERGY]: energy,
            getCapacity: () => capacity,
        },
    };
}

function makeTerminal(energy: number): any {
    return {
        structureType: (global as any).STRUCTURE_TERMINAL,
        store: {
            [(global as any).RESOURCE_ENERGY]: energy,
        },
    };
}

function makeDroppedResource(amount: number): any {
    return {
        resourceType: (global as any).RESOURCE_ENERGY,
        amount,
    };
}

function makeSource(id = 'source1'): any {
    return { id };
}

function makeContainer(energy: number, capacity = 2000): any {
    return {
        structureType: (global as any).STRUCTURE_CONTAINER,
        store: {
            [(global as any).RESOURCE_ENERGY]: energy,
            getCapacity: () => capacity,
        },
    };
}

function makeStorage(energy: number): any {
    return {
        structureType: (global as any).STRUCTURE_STORAGE,
        store: {
            [(global as any).RESOURCE_ENERGY]: energy,
        },
    };
}

/**
 * Build a minimal creep mock.
 *
 * @param energy       - current energy in store
 * @param capacity     - total carry capacity
 * @param working      - initial memory.working flag
 * @param hasWorkParts - whether getActiveBodyparts(WORK) returns > 0
 */
function makeCreep(
    energy: number,
    capacity: number,
    working: boolean,
    hasWorkParts = true,
): any {
    return {
        store: {
            [(global as any).RESOURCE_ENERGY]: energy,
            getCapacity: () => capacity,
            getFreeCapacity: () => capacity - energy,
        },
        memory: { working },
        room: {
            storage: null as any,
            terminal: null as any,
            find: vi.fn().mockReturnValue([]),
        },
        pos: {
            findClosestByRange: vi.fn().mockReturnValue(null),
            inRangeTo: vi.fn().mockReturnValue(false),
            getRangeTo: vi.fn().mockReturnValue(10),
        },
        getActiveBodyparts: vi.fn((part: string) =>
            part === (global as any).WORK && hasWorkParts ? 1 : 0,
        ),
        moveTo: vi.fn(),
        withdraw: vi.fn().mockReturnValue((global as any).OK),
        pickup: vi.fn().mockReturnValue((global as any).OK),
        harvest: vi.fn().mockReturnValue((global as any).OK),
    };
}

// ─── Hysteresis ───────────────────────────────────────────────────────────────

describe('recharge — hysteresis', () => {
    it('returns false immediately when working=true and energy > 0', () => {
        const creep = makeCreep(500, 800, true);
        expect(recharge(creep)).toBe(false);
        expect(creep.memory.working).toBe(true);
    });

    it('switches working to false when energy reaches 0', () => {
        // Creep was working but just ran empty
        const creep = makeCreep(0, 800, true);
        // Should flip to recharging and return true
        expect(recharge(creep)).toBe(true);
        expect(creep.memory.working).toBe(false);
    });

    it('stays recharging (working=false) at 74% full — has not hit threshold', () => {
        const capacity = 800;
        const energy = Math.floor(capacity * 0.74); // below 75% threshold
        const creep = makeCreep(energy, capacity, false);
        expect(recharge(creep)).toBe(true);
        expect(creep.memory.working).toBe(false);
    });

    it('switches to working=true exactly at 75% capacity', () => {
        const capacity = 800;
        const energy = Math.floor(capacity * 0.75); // exactly 75%
        const creep = makeCreep(energy, capacity, false);
        // Should flip working to true and return false
        expect(recharge(creep)).toBe(false);
        expect(creep.memory.working).toBe(true);
    });

    it('switches to working=true above 75% capacity', () => {
        const capacity = 800;
        const energy = Math.ceil(capacity * 0.9); // 90%
        const creep = makeCreep(energy, capacity, false);
        expect(recharge(creep)).toBe(false);
        expect(creep.memory.working).toBe(true);
    });

    it('a full working creep that drains to 0 restarts recharging', () => {
        const creep = makeCreep(0, 800, true);
        const result = recharge(creep);
        expect(result).toBe(true);
        expect(creep.memory.working).toBe(false);
    });
});

// ─── Priority 1: Storage link ─────────────────────────────────────────────────

describe('recharge — storage link (priority 1)', () => {
    it('withdraws from storage link when it has >= 75% energy', () => {
        const creep = makeCreep(0, 800, false);
        const storage = makeStorage(50000);
        const link = makeLink(700, 800); // 700/800 = 87.5% ≥ 75%
        creep.room.storage = storage;
        // pos.findInRange used internally to find links near storage
        storage.pos = {
            findInRange: vi.fn().mockReturnValue([link]),
        };
        // Simulate the utility using creep.withdraw
        creep.withdraw.mockReturnValue((global as any).OK);

        const result = recharge(creep);

        expect(result).toBe(true);
        expect(creep.withdraw).toHaveBeenCalledWith(link, (global as any).RESOURCE_ENERGY);
    });

    it('skips storage link when link energy < 75% and falls through to storage', () => {
        const creep = makeCreep(0, 800, false);
        const storage = makeStorage(50000);
        const link = makeLink(300, 800); // 37.5% — below threshold
        creep.room.storage = storage;
        storage.pos = {
            findInRange: vi.fn().mockReturnValue([link]),
        };

        recharge(creep);

        // Should NOT have withdrawn from the link
        const withdrawCalls = creep.withdraw.mock.calls;
        const linkWithdraw = withdrawCalls.find((args: any[]) => args[0] === link);
        expect(linkWithdraw).toBeUndefined();
        // Should have tried storage instead
        const storageWithdraw = withdrawCalls.find((args: any[]) => args[0] === storage);
        expect(storageWithdraw).toBeDefined();
    });
});

// ─── Priority 2: room.storage ─────────────────────────────────────────────────

describe('recharge — room.storage (priority 2)', () => {
    it('withdraws from storage when it has energy', () => {
        const creep = makeCreep(0, 800, false);
        const storage = makeStorage(10000);
        creep.room.storage = storage;

        const result = recharge(creep);

        expect(result).toBe(true);
        expect(creep.withdraw).toHaveBeenCalledWith(storage, (global as any).RESOURCE_ENERGY);
    });

    it('moves toward storage when not in range', () => {
        const creep = makeCreep(0, 800, false);
        const storage = makeStorage(10000);
        creep.room.storage = storage;
        creep.withdraw.mockReturnValue((global as any).ERR_NOT_IN_RANGE);

        recharge(creep);

        expect(creep.moveTo).toHaveBeenCalledWith(storage, expect.anything());
    });

    it('skips storage when it has 0 energy', () => {
        const creep = makeCreep(0, 800, false);
        const storage = makeStorage(0);
        creep.room.storage = storage;

        recharge(creep);

        const withdrawCalls = creep.withdraw.mock.calls;
        const storageWithdraw = withdrawCalls.find((args: any[]) => args[0] === storage);
        expect(storageWithdraw).toBeUndefined();
    });
});

// ─── Priority 3: room.terminal ────────────────────────────────────────────────

describe('recharge — room.terminal (priority 3)', () => {
    it('withdraws from terminal when no storage exists', () => {
        const creep = makeCreep(0, 800, false);
        const terminal = makeTerminal(5000);
        creep.room.storage = null;
        creep.room.terminal = terminal;

        const result = recharge(creep);

        expect(result).toBe(true);
        expect(creep.withdraw).toHaveBeenCalledWith(terminal, (global as any).RESOURCE_ENERGY);
    });

    it('uses terminal when storage exists but has no energy', () => {
        const creep = makeCreep(0, 800, false);
        const storage = makeStorage(0);
        const terminal = makeTerminal(3000);
        creep.room.storage = storage;
        creep.room.terminal = terminal;

        recharge(creep);

        const withdrawCalls = creep.withdraw.mock.calls;
        const terminalWithdraw = withdrawCalls.find((args: any[]) => args[0] === terminal);
        expect(terminalWithdraw).toBeDefined();
    });

    it('skips terminal when it has 0 energy', () => {
        const creep = makeCreep(0, 800, false);
        const terminal = makeTerminal(0);
        creep.room.storage = null;
        creep.room.terminal = terminal;

        recharge(creep);

        const withdrawCalls = creep.withdraw.mock.calls;
        const terminalWithdraw = withdrawCalls.find((args: any[]) => args[0] === terminal);
        expect(terminalWithdraw).toBeUndefined();
    });
});

// ─── Priority 4: Dropped resources ───────────────────────────────────────────

describe('recharge — dropped resources (priority 4)', () => {
    it('picks up dropped resource with amount >= creep capacity when near storage', () => {
        const capacity = 800;
        const creep = makeCreep(0, capacity, false);
        const dropped = makeDroppedResource(capacity); // exactly at threshold
        // No storage/terminal to fall through
        creep.room.storage = null;
        creep.room.terminal = null;
        creep.room.find.mockImplementation((type: number, opts?: any) => {
            if (type === (global as any).FIND_DROPPED_RESOURCES || type === 106) {
                return opts?.filter ? [dropped].filter(opts.filter) : [dropped];
            }
            return [];
        });
        // Simulate creep being near storage (within range 2)
        creep.pos.getRangeTo = vi.fn().mockReturnValue(1);

        recharge(creep);

        // Should have called pickup on the resource
        expect(creep.pickup).toHaveBeenCalledWith(dropped);
    });

    it('ignores dropped resources with amount < creep capacity', () => {
        const capacity = 800;
        const creep = makeCreep(0, capacity, false);
        const dropped = makeDroppedResource(capacity - 1); // just below threshold
        creep.room.storage = null;
        creep.room.terminal = null;
        creep.room.find.mockImplementation((type: number, opts?: any) => {
            if (type === (global as any).FIND_DROPPED_RESOURCES || type === 106) {
                return opts?.filter ? [dropped].filter(opts.filter) : [dropped];
            }
            return [];
        });

        recharge(creep);

        expect(creep.pickup).not.toHaveBeenCalledWith(dropped);
    });
});

// ─── Priority 5: Containers ───────────────────────────────────────────────────

describe('recharge — containers (priority 5)', () => {
    it('withdraws from closest container with energy >= creep capacity', () => {
        const capacity = 800;
        const creep = makeCreep(0, capacity, false);
        const container = makeContainer(capacity, 2000); // has enough energy
        creep.room.storage = null;
        creep.room.terminal = null;
        creep.pos.findClosestByRange.mockReturnValue(container);

        const result = recharge(creep);

        expect(result).toBe(true);
        expect(creep.withdraw).toHaveBeenCalledWith(container, (global as any).RESOURCE_ENERGY);
    });

    it('moves to container when not in range', () => {
        const capacity = 800;
        const creep = makeCreep(0, capacity, false);
        const container = makeContainer(capacity, 2000);
        creep.room.storage = null;
        creep.room.terminal = null;
        creep.pos.findClosestByRange.mockReturnValue(container);
        creep.withdraw.mockReturnValue((global as any).ERR_NOT_IN_RANGE);

        recharge(creep);

        expect(creep.moveTo).toHaveBeenCalledWith(container, expect.anything());
    });

    it('skips containers with energy < creep capacity', () => {
        const capacity = 800;
        const creep = makeCreep(0, capacity, false);
        const container = makeContainer(capacity - 1, 2000); // one short
        creep.room.storage = null;
        creep.room.terminal = null;
        creep.pos.findClosestByRange.mockReturnValue(container);

        recharge(creep);

        const withdrawCalls = creep.withdraw.mock.calls;
        const containerWithdraw = withdrawCalls.find((args: any[]) => args[0] === container);
        expect(containerWithdraw).toBeUndefined();
    });

    it('storage takes priority over containers', () => {
        const capacity = 800;
        const creep = makeCreep(0, capacity, false);
        const storage = makeStorage(50000);
        const container = makeContainer(capacity, 2000);
        creep.room.storage = storage;
        creep.pos.findClosestByRange.mockReturnValue(container);

        recharge(creep);

        // Storage should be used, not container
        const withdrawCalls = creep.withdraw.mock.calls;
        const storageWithdraw = withdrawCalls.find((args: any[]) => args[0] === storage);
        expect(storageWithdraw).toBeDefined();
        const containerWithdraw = withdrawCalls.find((args: any[]) => args[0] === container);
        expect(containerWithdraw).toBeUndefined();
    });
});

// ─── Priority 6: Harvest sources ─────────────────────────────────────────────

describe('recharge — harvest (priority 6)', () => {
    it('harvests a source as last resort when creep has WORK parts', () => {
        const creep = makeCreep(0, 800, false, true);
        const source = makeSource('src1');
        source.pos = { x: 10, y: 10 };
        creep.room.storage = null;
        creep.room.terminal = null;
        creep.room.find.mockImplementation((type: number) => {
            if (type === (global as any).FIND_SOURCES_ACTIVE) return [source];
            return [];
        });
        creep.pos.findClosestByRange.mockReturnValue(null); // no containers

        const result = recharge(creep);

        expect(result).toBe(true);
        expect(creep.harvest).toHaveBeenCalledWith(source);
    });

    it('returns true even without WORK parts (still recharging, just waiting)', () => {
        const creep = makeCreep(0, 800, false, false); // no WORK parts
        const source = makeSource('src1');
        source.pos = { x: 10, y: 10 };
        creep.room.storage = null;
        creep.room.terminal = null;
        creep.room.find.mockImplementation((type: number) => {
            if (type === (global as any).FIND_SOURCES_ACTIVE) return [source];
            return [];
        });
        creep.pos.findClosestByRange.mockReturnValue(null);

        const result = recharge(creep);

        // Returns true (still recharging) but does NOT call harvest
        expect(result).toBe(true);
        expect(creep.harvest).not.toHaveBeenCalled();
    });

    it('moves to source when not in range to harvest', () => {
        const creep = makeCreep(0, 800, false, true);
        const source = makeSource('src1');
        source.pos = { x: 10, y: 10 };
        creep.room.storage = null;
        creep.room.terminal = null;
        creep.room.find.mockImplementation((type: number) => {
            if (type === (global as any).FIND_SOURCES_ACTIVE) return [source];
            return [];
        });
        creep.pos.findClosestByRange.mockReturnValue(null);
        creep.harvest.mockReturnValue((global as any).ERR_NOT_IN_RANGE);

        recharge(creep);

        expect(creep.moveTo).toHaveBeenCalledWith(source, expect.anything());
    });
});

// ─── No energy available ──────────────────────────────────────────────────────

describe('recharge — no energy available anywhere', () => {
    it('returns true while waiting with absolutely nothing to collect', () => {
        const creep = makeCreep(0, 800, false, false); // no WORK parts either
        creep.room.storage = null;
        creep.room.terminal = null;
        // find returns nothing, findClosestByRange returns nothing
        creep.room.find.mockReturnValue([]);
        creep.pos.findClosestByRange.mockReturnValue(null);

        const result = recharge(creep);

        expect(result).toBe(true);
        expect(creep.withdraw).not.toHaveBeenCalled();
        expect(creep.pickup).not.toHaveBeenCalled();
        expect(creep.harvest).not.toHaveBeenCalled();
    });
});
