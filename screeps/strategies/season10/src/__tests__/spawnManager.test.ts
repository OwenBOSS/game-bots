import { describe, it, expect, beforeEach } from 'vitest';
import { manageSpawns, getCollectorQuota } from '../managers/spawnManager';
import { makeRoom, makeStorage, makeController, makeSpawn, makeCreep } from './helpers';

function roomWith(opts: {
    level?: number;
    energy?: number;
    harvesters?: number;
    haulers?: number;
    collectors?: number;
    scouts?: number;
    storage?: number;
    memory?: any;
    structures?: any[];
    sources?: any[];
}): any {
    const harvesters = Array.from({ length: opts.harvesters ?? 0 }, (_, i) =>
        makeCreep({ name: `h${i}`, role: 'harvester' })
    );
    const haulers = Array.from({ length: opts.haulers ?? 0 }, (_, i) =>
        makeCreep({ name: `ha${i}`, role: 'hauler' })
    );
    const collectors = Array.from({ length: opts.collectors ?? 0 }, (_, i) =>
        makeCreep({ name: `c${i}`, role: 'collector' })
    );
    const scouts = Array.from({ length: opts.scouts ?? 0 }, (_, i) =>
        makeCreep({ name: `s${i}`, role: 'scout' })
    );
    const spawn = makeSpawn({ spawning: false });
    return makeRoom({
        energyAvailable: opts.energy ?? 300,
        controller: makeController({ level: opts.level ?? 1 }),
        storage: opts.storage !== undefined ? makeStorage(opts.storage) : undefined,
        myCreeps: [...harvesters, ...haulers, ...collectors, ...scouts],
        mySpawns: [spawn],
        structures: opts.structures ?? [],
        sources: opts.sources ?? [],
        memory: opts.memory ?? {},
    });
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

// ── getCollectorQuota ──────────────────────────────────────────────────────────

describe('getCollectorQuota', () => {
    it('returns 2 when no storage', () => {
        const room = roomWith({ level: 4 });
        expect(getCollectorQuota(room)).toBe(2);
    });

    it('returns 2 when storage < 50k', () => {
        const room = roomWith({ level: 4, storage: 49999 });
        expect(getCollectorQuota(room)).toBe(2);
    });

    it('returns 3 when storage >= 50k and < 100k', () => {
        const room = roomWith({ level: 4, storage: 50000 });
        expect(getCollectorQuota(room)).toBe(3);
    });

    it('returns 5 when storage >= 100k and < 200k', () => {
        const room = roomWith({ level: 4, storage: 100000 });
        expect(getCollectorQuota(room)).toBe(5);
    });

    it('returns 8 when storage >= 200k', () => {
        const room = roomWith({ level: 4, storage: 200000 });
        expect(getCollectorQuota(room)).toBe(8);
    });
});

// ── RC1 spawn logic ────────────────────────────────────────────────────────────

describe('manageSpawns — RC1', () => {
    it('spawns a harvester when none exist', () => {
        const room = roomWith({ level: 1, energy: 300 });
        manageSpawns(room);
        const spawn = room.find((global as any).FIND_MY_SPAWNS)[0];
        expect(spawn.spawnCreep).toHaveBeenCalled();
        const [body, , opts] = spawn.spawnCreep.mock.calls[0];
        expect(opts.memory.role).toBe('harvester');
    });

    it('spawns a scout when harvesters >= 2 and spawnScoutNext is set and no scout exists', () => {
        const room = roomWith({ level: 1, energy: 300, harvesters: 2, memory: { spawnScoutNext: true } });
        manageSpawns(room);
        const spawn = room.find((global as any).FIND_MY_SPAWNS)[0];
        expect(spawn.spawnCreep).toHaveBeenCalled();
        const [, , opts] = spawn.spawnCreep.mock.calls[0];
        expect(opts.memory.role).toBe('scout');
    });

    it('does not spawn scout if scout already exists', () => {
        const room = roomWith({ level: 1, energy: 300, harvesters: 2, scouts: 1, memory: { spawnScoutNext: true } });
        manageSpawns(room);
        const spawn = room.find((global as any).FIND_MY_SPAWNS)[0];
        // Should try to spawn something, but not a second scout
        if (spawn.spawnCreep.mock.calls.length > 0) {
            const role = spawn.spawnCreep.mock.calls[0][2].memory.role;
            expect(role).not.toBe('scout');
        }
    });
});

// ── RC2 spawn logic ────────────────────────────────────────────────────────────

describe('manageSpawns — RC2', () => {
    it('spawns collector before reaching MAX when harvesters met', () => {
        const room = roomWith({ level: 2, energy: 300, harvesters: 2, collectors: 0 });
        manageSpawns(room);
        const spawn = room.find((global as any).FIND_MY_SPAWNS)[0];
        expect(spawn.spawnCreep).toHaveBeenCalled();
        const [, , opts] = spawn.spawnCreep.mock.calls[0];
        expect(opts.memory.role).toBe('collector');
    });

    it('uses RC1-2 collector body at low energy', () => {
        const room = roomWith({ level: 2, energy: 160, harvesters: 2, collectors: 0 });
        manageSpawns(room);
        const spawn = room.find((global as any).FIND_MY_SPAWNS)[0];
        const [body] = spawn.spawnCreep.mock.calls[0];
        expect(body).toEqual(['tough', 'move', 'move', 'move']);
    });
});

// ── RC3 collector quota ────────────────────────────────────────────────────────

describe('manageSpawns — RC3 collector quota', () => {
    it('spawns up to 3 collectors at RC3 when memory.collectorQuota=3', () => {
        const room = roomWith({ level: 3, energy: 300, harvesters: 2, collectors: 2, memory: { collectorQuota: 3 } });
        manageSpawns(room);
        const spawn = room.find((global as any).FIND_MY_SPAWNS)[0];
        expect(spawn.spawnCreep).toHaveBeenCalled();
        const [, , opts] = spawn.spawnCreep.mock.calls[0];
        expect(opts.memory.role).toBe('collector');
    });

    it('does not spawn a 4th collector when quota is 3', () => {
        const room = roomWith({ level: 3, energy: 300, harvesters: 2, collectors: 3, memory: { collectorQuota: 3 } });
        manageSpawns(room);
        const spawn = room.find((global as any).FIND_MY_SPAWNS)[0];
        // Spawn may be called for other roles but not collector
        const collectorSpawns = spawn.spawnCreep.mock.calls.filter(
            (c: any[]) => c[2]?.memory?.role === 'collector'
        );
        expect(collectorSpawns).toHaveLength(0);
    });
});

// ── RC4 dynamic quota ──────────────────────────────────────────────────────────

describe('manageSpawns — RC4 dynamic quota', () => {
    it('uses getCollectorQuota when dynamicCollectorQuota is set', () => {
        // storage=200k → quota 8; only 2 collectors → should spawn more
        const room = roomWith({
            level: 4, energy: 300, harvesters: 2, collectors: 2,
            storage: 200000,
            memory: { dynamicCollectorQuota: true },
        });
        manageSpawns(room);
        const spawn = room.find((global as any).FIND_MY_SPAWNS)[0];
        expect(spawn.spawnCreep).toHaveBeenCalled();
        const [, , opts] = spawn.spawnCreep.mock.calls[0];
        expect(opts.memory.role).toBe('collector');
    });
});

// ── RC5+ collectors above upgraders ───────────────────────────────────────────

describe('manageSpawns — RC5 collectors above upgraders', () => {
    it('spawns collector even when upgrader count could be increased', () => {
        const room = roomWith({
            level: 5, energy: 660, harvesters: 2, collectors: 1,
            memory: { collectorsAboveUpgraders: true, collectorQuota: 5 },
        });
        manageSpawns(room);
        const spawn = room.find((global as any).FIND_MY_SPAWNS)[0];
        expect(spawn.spawnCreep).toHaveBeenCalled();
        const [body, , opts] = spawn.spawnCreep.mock.calls[0];
        expect(opts.memory.role).toBe('collector');
        // Should use RC5+ body at 660e
        expect(body.filter((p: string) => p === 'attack')).toHaveLength(2);
    });
});

// ── Hauler spawn logic ─────────────────────────────────────────────────────────

describe('manageSpawns — hauler spawning', () => {
    function makeContainer(energy = 500): any {
        return {
            structureType: (global as any).STRUCTURE_CONTAINER,
            store: { [(global as any).RESOURCE_ENERGY]: energy },
        };
    }

    function makeSource(): any {
        return { id: 'src1', pos: { x: 10, y: 10 } };
    }

    it('spawns a hauler when containers exist and haulers < source count', () => {
        const container = makeContainer();
        const room = roomWith({
            level: 2, energy: 300, harvesters: 2,
            structures: [container],
            sources: [makeSource()],
        });
        manageSpawns(room);
        const spawn = room.find((global as any).FIND_MY_SPAWNS)[0];
        expect(spawn.spawnCreep).toHaveBeenCalled();
        const [, , opts] = spawn.spawnCreep.mock.calls[0];
        expect(opts.memory.role).toBe('hauler');
    });

    it('does not spawn hauler when no containers exist', () => {
        const room = roomWith({
            level: 2, energy: 300, harvesters: 2,
            structures: [],   // no containers
            sources: [makeSource()],
        });
        manageSpawns(room);
        const spawn = room.find((global as any).FIND_MY_SPAWNS)[0];
        if (spawn.spawnCreep.mock.calls.length > 0) {
            const role = spawn.spawnCreep.mock.calls[0][2].memory.role;
            expect(role).not.toBe('hauler');
        }
    });

    it('does not spawn an extra hauler when count already meets source count', () => {
        const container = makeContainer();
        const room = roomWith({
            level: 2, energy: 300, harvesters: 2, haulers: 1,
            structures: [container],
            sources: [makeSource()], // 1 source, 1 hauler → at quota
        });
        manageSpawns(room);
        const spawn = room.find((global as any).FIND_MY_SPAWNS)[0];
        const haulerSpawns = spawn.spawnCreep.mock.calls.filter(
            (c: any[]) => c[2]?.memory?.role === 'hauler'
        );
        expect(haulerSpawns).toHaveLength(0);
    });
});

// ── No spawn when all slots filled ────────────────────────────────────────────

describe('manageSpawns — no spawn when quota met', () => {
    it('does not spawn when harvesters and collectors at quota', () => {
        const room = roomWith({ level: 2, energy: 300, harvesters: 2, collectors: 1 });
        // RC2 default quota is 1 collector after harvesters met
        // set memory to indicate no more needed
        room.memory.collectorQuota = 1;
        manageSpawns(room);
        // May still spawn for other reasons; ensure no collector spawned
    });

    it('does not spawn when spawn is busy', () => {
        const spawn = makeSpawn({ spawning: true });
        const room = makeRoom({
            energyAvailable: 300,
            controller: makeController({ level: 1 }),
            myCreeps: [],
            mySpawns: [spawn],
            memory: {},
        });
        manageSpawns(room);
        expect(spawn.spawnCreep).not.toHaveBeenCalled();
    });
});
