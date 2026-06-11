import { vi } from 'vitest';

// ─── Source ───────────────────────────────────────────────────────────────────

export function makeSource(opts: {
    id?: string;
    x?: number;
    y?: number;
    energy?: number;
} = {}): any {
    const x = opts.x ?? 25;
    const y = opts.y ?? 25;
    return {
        id: opts.id ?? 'source1',
        energy: opts.energy ?? 3000,
        pos: {
            x, y,
            getRangeTo: vi.fn((_t: any) => 5),
            findInRange: vi.fn(() => []),
        },
    };
}

// ─── Structures ───────────────────────────────────────────────────────────────

export function makeExtension(freeCap = 50): any {
    return {
        id: `ext_${Math.random()}`,
        structureType: (global as any).STRUCTURE_EXTENSION,
        pos: { x: 26, y: 26, getRangeTo: vi.fn(() => 1) },
        store: {
            [(global as any).RESOURCE_ENERGY]: 50 - freeCap,
            getFreeCapacity: vi.fn(() => freeCap),
        },
    };
}

export function makeSpawnStruct(freeCap = 300): any {
    return {
        id: 'spawn1',
        structureType: (global as any).STRUCTURE_SPAWN,
        name: 'Spawn1',
        room: null as any,
        spawning: null,
        pos: { x: 20, y: 20, getRangeTo: vi.fn(() => 10) },
        store: {
            [(global as any).RESOURCE_ENERGY]: 300 - freeCap,
            getFreeCapacity: vi.fn(() => freeCap),
        },
        spawnCreep: vi.fn(() => (global as any).OK),
    };
}

export function makeLink(opts: {
    id?: string;
    energy?: number;
    freeCap?: number;
    cooldown?: number;
    x?: number;
    y?: number;
} = {}): any {
    const energy = opts.energy ?? 800;
    const freeCap = opts.freeCap ?? 0;
    return {
        id: opts.id ?? `link_${Math.random()}`,
        structureType: (global as any).STRUCTURE_LINK,
        cooldown: opts.cooldown ?? 0,
        pos: {
            x: opts.x ?? 25,
            y: opts.y ?? 26,
            getRangeTo: vi.fn((_t: any) => 2),
        },
        store: {
            [(global as any).RESOURCE_ENERGY]: energy,
            getFreeCapacity: vi.fn(() => freeCap),
        },
        transferEnergy: vi.fn(() => (global as any).OK),
    };
}

// ─── Creep ────────────────────────────────────────────────────────────────────

export function makeCreep(opts: {
    name?: string;
    role?: string;
    energy?: number;
    freeCap?: number;
    memory?: Record<string, any>;
    rangeTo?: number;
    room?: any;
} = {}): any {
    const energy = opts.energy ?? 0;
    const freeCap = opts.freeCap ?? 50;
    const room = opts.room ?? makeRoom();
    return {
        name: opts.name ?? 'creep1',
        id: `id_${opts.name ?? 'creep1'}`,
        pos: {
            x: 25, y: 26,
            getRangeTo: vi.fn(() => opts.rangeTo ?? 5),
            findClosestByRange: vi.fn(() => null),
            findClosestByPath: vi.fn(() => null),
            findInRange: vi.fn(() => []),
        },
        store: {
            [(global as any).RESOURCE_ENERGY]: energy,
            getFreeCapacity: vi.fn(() => freeCap),
        },
        memory: { role: opts.role ?? 'hauler', ...(opts.memory ?? {}) },
        room,
        moveTo:           vi.fn(() => (global as any).OK),
        move:             vi.fn(() => (global as any).OK),
        pull:             vi.fn(() => (global as any).OK),
        harvest:          vi.fn(() => (global as any).OK),
        transfer:         vi.fn(() => (global as any).OK),
        withdraw:         vi.fn(() => (global as any).OK),
        pickup:           vi.fn(() => (global as any).OK),
        build:            vi.fn(() => (global as any).OK),
        upgradeController: vi.fn(() => (global as any).OK),
    };
}

// ─── Room ─────────────────────────────────────────────────────────────────────

export function makeRoom(opts: {
    name?: string;
    rcl?: number;
    energyAvailable?: number;
    sources?: any[];
    structures?: any[];
    constructionSites?: any[];
    myCreeps?: any[];
    mySpawns?: any[];
} = {}): any {
    const sources     = opts.sources     ?? [];
    const structures  = opts.structures  ?? [];
    const sites       = opts.constructionSites ?? [];
    const myCreeps    = opts.myCreeps    ?? [];
    const mySpawns    = opts.mySpawns    ?? [];
    const rcl         = opts.rcl ?? 1;

    const room: any = {
        name: opts.name ?? 'W1N1',
        energyAvailable: opts.energyAvailable ?? 300,
        controller: {
            level: rcl,
            my: true,
            pos: {
                x: 15, y: 15,
                getRangeTo: vi.fn(() => 10),
                findInRange: vi.fn(() => []),
            },
        },
        getTerrain: vi.fn(() => ({ get: vi.fn(() => 0) })),  // 0 = walkable
        createConstructionSite: vi.fn(() => (global as any).OK),
        find: vi.fn((type: number, findOpts?: { filter?: (o: any) => boolean }) => {
            let base: any[];
            if      (type === (global as any).FIND_SOURCES)            base = sources;
            else if (type === (global as any).FIND_MY_STRUCTURES)      base = structures;
            else if (type === (global as any).FIND_STRUCTURES)         base = structures;
            else if (type === (global as any).FIND_CONSTRUCTION_SITES) base = sites;
            else if (type === (global as any).FIND_MY_CREEPS)          base = myCreeps;
            else if (type === (global as any).FIND_MY_SPAWNS)          base = mySpawns;
            else base = [];
            return findOpts?.filter ? base.filter(findOpts.filter) : base;
        }),
    };
    return room;
}

// ─── Controller ───────────────────────────────────────────────────────────────

export function makeController(opts: {
    level?: number;
    nearLinks?: any[];
} = {}): any {
    const nearLinks = opts.nearLinks ?? [];
    return {
        level: opts.level ?? 1,
        my: true,
        pos: {
            x: 15, y: 15,
            getRangeTo: vi.fn(() => 10),
            findInRange: vi.fn((type: number, _range: number, findOpts?: any) => {
                if (type === (global as any).FIND_MY_STRUCTURES) {
                    return findOpts?.filter ? nearLinks.filter(findOpts.filter) : nearLinks;
                }
                return [];
            }),
        },
    };
}
