import { describe, it, expect, beforeEach, vi } from 'vitest';
import { manageSpawns } from '../managers/spawnManager';
import { makeRoom, makeSource, makeContainer, makeController } from './helpers';

// ─── Minimal spawn mock ───────────────────────────────────────────────────────

function makeSpawn(name = 'Spawn1'): any {
    return {
        name,
        spawning: null,
        room: undefined as any, // set by caller
        spawnCreep: vi.fn(() => (global as any).OK),
    };
}

function makeCreep(role: string, ticksToLive = 1500, homeRoom = 'W1N1'): any {
    return { memory: { role, homeRoom }, ticksToLive };
}

beforeEach(() => {
    (global as any).Game = {
        time: 1000,
        rooms: {},
        creeps: {},
        map: { describeExits: () => ({}) },
    };
    (global as any).Memory = {
        roomIntel: {},
        roomThreats: {},
        expansionState: 'IDLE',
    };
    (global as any).PathFinder = { search: () => ({ incomplete: true, path: [] }) };
    (global as any).FIND_MY_SPAWNS = 101;
    (global as any).BODYPART_COST = {
        work: 100, move: 50, carry: 50, attack: 80, ranged_attack: 150, heal: 250, tough: 10, claim: 600,
    };
});

// ─── Spawn floor guard ────────────────────────────────────────────────────────

describe('manageSpawns spawn floor guard', () => {
    it('does NOT spawn upgrader when energyAvailable < 200 (floor)', () => {
        const ctrl    = makeController({ nearContainer: true, level: 2, ticksToDowngrade: 10000 });
        const spawn   = makeSpawn();
        const harv1   = makeCreep('harvester');
        const harv2   = makeCreep('harvester');
        const hauler1 = makeCreep('hauler');

        const room = makeRoom({
            name: 'W1N1',
            energyAvailable: 150,   // below 200 floor
            energyCapacityAvailable: 300,
            controller: ctrl,
            myCreeps: [harv1, harv2, hauler1],
            sources: [makeSource({ nearbyContainers: [makeContainer()] })],
            containers: [makeContainer()],
        });
        room.memory = {
            phase: 'ECONOMY',
            energyStatus: { level: 'DEFICIT', netRate: -0.5, trend: 0, pct: 50, bottleneck: 'BALANCED' },
            pidState: { output: 3, integral: 1, lastError: 0.3, lastTick: 990 },
        };
        spawn.room = room;

        // Register spawn in find results — makeRoom's find() doesn't handle FIND_MY_SPAWNS by default
        const origFind = room.find.getMockImplementation?.() ?? room.find;
        room.find = vi.fn((type: number, opts?: any) => {
            if (type === (global as any).FIND_MY_SPAWNS) return [spawn];
            return (origFind as any)(type, opts);
        });

        manageSpawns(room);

        // spawnCreep should not have been called with 'upgrader'
        const calls = (spawn.spawnCreep as ReturnType<typeof vi.fn>).mock.calls;
        const upgCalls = calls.filter(([_body, _name, mem]: any[]) =>
            mem?.memory?.role === 'upgrader',
        );
        expect(upgCalls).toHaveLength(0);
    });

    it('DOES spawn hauler (no floor restriction) when energyAvailable < 200', () => {
        // Hauler has no needsFloor — it is part of the essential energy logistics chain.
        // Min hauler body is 150e (CARRY+CARRY+MOVE), so it can spawn at 150e.
        const ctrl    = makeController({ nearContainer: false, level: 2, ticksToDowngrade: 10000 });
        const spawn   = makeSpawn();
        const container = makeContainer();
        const src = makeSource({ nearbyContainers: [container] });
        // manageSpawns counts creeps via Game.creeps (homeRoom match), not room.find.
        // Put harvesters there so the harvester floor guard doesn't fire.
        (global as any).Game.creeps = {
            harv1: { memory: { role: 'harvester', homeRoom: 'W1N1' }, ticksToLive: 1500 },
            harv2: { memory: { role: 'harvester', homeRoom: 'W1N1' }, ticksToLive: 1500 },
        };
        const harv1 = makeCreep('harvester');
        const harv2 = makeCreep('harvester');

        const room = makeRoom({
            name: 'W1N1',
            energyAvailable: 150,
            energyCapacityAvailable: 300,
            controller: ctrl,
            myCreeps: [harv1, harv2],
            sources: [src],
            containers: [container],
        });
        room.memory = {
            phase: 'ECONOMY',
            energyStatus: { level: 'DEFICIT', netRate: -0.5, trend: 0, pct: 50, bottleneck: 'HAULER_SHORTAGE' },
        };
        spawn.room = room;

        const origFind = room.find.getMockImplementation?.() ?? room.find;
        room.find = vi.fn((type: number, opts?: any) => {
            if (type === (global as any).FIND_MY_SPAWNS) return [spawn];
            return (origFind as any)(type, opts);
        });

        manageSpawns(room);

        const calls = (spawn.spawnCreep as ReturnType<typeof vi.fn>).mock.calls;
        const haulerCalls = calls.filter(([_body, _name, mem]: any[]) =>
            mem?.memory?.role === 'hauler',
        );
        expect(haulerCalls.length).toBeGreaterThan(0);
    });

    it('does NOT spawn scout when energyAvailable < 200', () => {
        const ctrl  = makeController({ nearContainer: false, level: 2, ticksToDowngrade: 10000 });
        const spawn = makeSpawn();
        const harv1 = makeCreep('harvester');
        const harv2 = makeCreep('harvester');
        const hauler = makeCreep('hauler');

        const room = makeRoom({
            name: 'W1N1',
            energyAvailable: 160,
            energyCapacityAvailable: 300,
            controller: ctrl,
            myCreeps: [harv1, harv2, hauler],
            sources: [makeSource()],
        });
        room.memory = {
            phase: 'ECONOMY',
            energyStatus: { level: 'DEFICIT', netRate: -0.3, trend: 0, pct: 53, bottleneck: 'BALANCED' },
        };
        spawn.room = room;

        const origFind = room.find.getMockImplementation?.() ?? room.find;
        room.find = vi.fn((type: number, opts?: any) => {
            if (type === (global as any).FIND_MY_SPAWNS) return [spawn];
            return (origFind as any)(type, opts);
        });

        manageSpawns(room);

        const calls = (spawn.spawnCreep as ReturnType<typeof vi.fn>).mock.calls;
        const scoutCalls = calls.filter(([_body, _name, mem]: any[]) =>
            mem?.memory?.role === 'scout',
        );
        expect(scoutCalls).toHaveLength(0);
    });
});
