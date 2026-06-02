import { vi } from 'vitest';

// ─── Source mock ──────────────────────────────────────────────────────────────

export function makeSource(opts: {
    id?: string;
    x?: number;
    y?: number;
    energy?: number;
    nearbyContainers?: ReturnType<typeof makeContainer>[];
    walkableTiles?: number;
} = {}): any {
    const containers = opts.nearbyContainers ?? [];
    const terrain = {
        get: (_x: number, _y: number) => (opts.walkableTiles !== undefined ? 0 : 0),
    };

    return {
        id: opts.id ?? 'source1',
        energy: opts.energy ?? 3000,
        pos: {
            x: opts.x ?? 25,
            y: opts.y ?? 25,
            findInRange: vi.fn((type: number, _range: number, findOpts?: any) => {
                if (type === (global as any).FIND_STRUCTURES) {
                    const all = containers;
                    return findOpts?.filter ? all.filter(findOpts.filter) : all;
                }
                return [];
            }),
        },
        room: {
            getTerrain: () => terrain,
        },
    };
}

// ─── Container mock ───────────────────────────────────────────────────────────

export function makeContainer(fillPct = 0.5): any {
    const cap = 2000;
    return {
        structureType: (global as any).STRUCTURE_CONTAINER,
        store: {
            [(global as any).RESOURCE_ENERGY]: Math.round(cap * fillPct),
            getCapacity: () => cap,
        },
    };
}

// ─── Room mock ────────────────────────────────────────────────────────────────

export function makeRoom(opts: {
    name?: string;
    energyAvailable?: number;
    energyCapacityAvailable?: number;
    memory?: any;
    sources?: any[];
    containers?: any[];
    constructionSiteCount?: number;
    storage?: any;
    controller?: any;
    myCreeps?: any[];
    hostileCreeps?: any[];
} = {}): any {
    const sources = opts.sources ?? [];
    const containers = opts.containers ?? [];
    const myCreeps = opts.myCreeps ?? [];
    const hostileCreeps = opts.hostileCreeps ?? [];
    const constructionSiteCount = opts.constructionSiteCount ?? 0;

    const allStructures = [...containers];

    const room: any = {
        name: opts.name ?? 'W1N1',
        energyAvailable: opts.energyAvailable ?? 300,
        energyCapacityAvailable: opts.energyCapacityAvailable ?? 300,
        memory: opts.memory ?? {},
        storage: opts.storage,
        controller: opts.controller,
        find: vi.fn((type: number, findOpts?: { filter?: (obj: any) => boolean }) => {
            let results: any[];
            if (type === (global as any).FIND_SOURCES)            results = sources;
            else if (type === (global as any).FIND_MY_CREEPS)     results = myCreeps;
            else if (type === (global as any).FIND_HOSTILE_CREEPS) results = hostileCreeps;
            else if (type === (global as any).FIND_STRUCTURES)    results = allStructures;
            else if (type === (global as any).FIND_CONSTRUCTION_SITES) {
                results = Array.from({ length: constructionSiteCount }, (_, i) => ({ id: `site${i}` }));
            } else {
                results = [];
            }
            return findOpts?.filter ? results.filter(findOpts.filter) : results;
        }),
    };
    return room;
}

// ─── Storage mock ─────────────────────────────────────────────────────────────

export function makeStorage(energyAmount = 50000): any {
    const cap = 1_000_000;
    return {
        structureType: (global as any).STRUCTURE_STORAGE,
        store: {
            [(global as any).RESOURCE_ENERGY]: energyAmount,
            getCapacity: (_resource?: string) => cap,
        },
    };
}

// ─── Controller mock ──────────────────────────────────────────────────────────

export function makeController(opts: {
    level?: number;
    my?: boolean;
    safeMode?: number;
    ticksToDowngrade?: number;
    nearContainer?: boolean;
} = {}): any {
    const containers = opts.nearContainer ? [makeContainer()] : [];
    return {
        level: opts.level ?? 2,
        my: opts.my ?? true,
        safeMode: opts.safeMode,
        ticksToDowngrade: opts.ticksToDowngrade ?? 10000,
        pos: {
            findInRange: vi.fn((type: number, _range: number, findOpts?: any) => {
                if (type === (global as any).FIND_STRUCTURES) {
                    return findOpts?.filter ? containers.filter(findOpts.filter) : containers;
                }
                return [];
            }),
        },
    };
}
