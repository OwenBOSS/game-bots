import { vi } from 'vitest';

export function makeScore(opts: {
    id?: string;
    score?: number;
    ticksToDecay?: number;
    x?: number;
    y?: number;
    roomName?: string;
} = {}): any {
    return {
        id: opts.id ?? 'score1',
        score: opts.score ?? 10,
        ticksToDecay: opts.ticksToDecay ?? 1000,
        pos: {
            x: opts.x ?? 25,
            y: opts.y ?? 25,
            roomName: opts.roomName ?? 'W1N1',
        },
        room: { name: opts.roomName ?? 'W1N1' },
    };
}

export function makeStorage(energy = 50000): any {
    return {
        structureType: (global as any).STRUCTURE_STORAGE,
        store: {
            [(global as any).RESOURCE_ENERGY]: energy,
            getCapacity: () => 1_000_000,
        },
    };
}

export function makeController(opts: {
    level?: number;
    my?: boolean;
    ticksToDowngrade?: number;
} = {}): any {
    return {
        level: opts.level ?? 1,
        my: opts.my ?? true,
        ticksToDowngrade: opts.ticksToDowngrade ?? 20000,
    };
}

export function makeSpawn(opts: { name?: string; spawning?: boolean } = {}): any {
    return {
        name: opts.name ?? 'Spawn1',
        spawning: opts.spawning ?? null,
        spawnCreep: vi.fn(() => 0),
    };
}

export function makeCreep(opts: {
    name?: string;
    role?: string;
    room?: string;
} = {}): any {
    return {
        name: opts.name ?? 'creep1',
        memory: { role: opts.role ?? 'harvester', working: false },
        room: { name: opts.room ?? 'W1N1' },
    };
}

export function makeRoom(opts: {
    name?: string;
    energyAvailable?: number;
    controller?: any;
    storage?: any;
    scores?: any[];
    myCreeps?: any[];
    mySpawns?: any[];
    hostileCreeps?: any[];
    memory?: any;
} = {}): any {
    const scores = opts.scores ?? [];
    const myCreeps = opts.myCreeps ?? [];
    const mySpawns = opts.mySpawns ?? [];
    const hostileCreeps = opts.hostileCreeps ?? [];

    const room: any = {
        name: opts.name ?? 'W1N1',
        energyAvailable: opts.energyAvailable ?? 300,
        controller: opts.controller ?? null,
        storage: opts.storage ?? null,
        memory: opts.memory ?? {},
        find: vi.fn((type: number, findOpts?: { filter?: (obj: any) => boolean }) => {
            let results: any[];
            if (type === (global as any).FIND_SCORES)           results = scores;
            else if (type === (global as any).FIND_MY_CREEPS)   results = myCreeps;
            else if (type === (global as any).FIND_MY_SPAWNS)   results = mySpawns;
            else if (type === (global as any).FIND_HOSTILE_CREEPS) results = hostileCreeps;
            else                                                 results = [];
            return findOpts?.filter ? results.filter(findOpts.filter) : results;
        }),
    };
    return room;
}
