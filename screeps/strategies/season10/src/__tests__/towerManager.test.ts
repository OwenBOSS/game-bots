import { describe, it, expect, beforeEach, vi } from 'vitest';
import { manageTowers } from '../managers/towerManager';
import { makeRoom } from './helpers';

function makeTower(energy = 700): any {
    return {
        structureType: 'tower',
        store: { [(global as any).RESOURCE_ENERGY]: energy },
        attack: vi.fn(() => 0),
        heal: vi.fn(() => 0),
        repair: vi.fn(() => 0),
    };
}

function makeCreepWithHits(hits: number, hitsMax: number, friendly = true): any {
    return {
        id: `c${Math.random()}`,
        hits,
        hitsMax,
        my: friendly,
        pos: { x: 25, y: 25 },
    };
}

function makeStructureWithHits(type: string, hits: number, hitsMax: number): any {
    return { structureType: type, hits, hitsMax, id: `s${Math.random()}` };
}

beforeEach(() => {
    (global as any).FIND_HOSTILE_CREEPS = 103;
    (global as any).FIND_MY_CREEPS = 104;
    (global as any).FIND_STRUCTURES = 107;
    (global as any).FIND_MY_STRUCTURES = 108;
    (global as any).STRUCTURE_TOWER = 'tower';
    (global as any).STRUCTURE_RAMPART = 'rampart';
    (global as any).STRUCTURE_ROAD = 'road';
    (global as any).RESOURCE_ENERGY = 'energy';
    (global as any).OK = 0;
});

describe('manageTowers — priority 1: attack hostiles', () => {
    it('attacks hostile creep when present', () => {
        const tower = makeTower();
        const hostile = makeCreepWithHits(200, 200, false);
        const room = makeRoom({ hostileCreeps: [hostile], myCreeps: [], mySpawns: [{ find: vi.fn(() => [tower]) }] });
        room.find = vi.fn((type: number) => {
            if (type === (global as any).FIND_MY_STRUCTURES) return [tower];
            if (type === (global as any).FIND_HOSTILE_CREEPS) return [hostile];
            if (type === (global as any).FIND_MY_CREEPS) return [];
            if (type === (global as any).FIND_STRUCTURES) return [];
            return [];
        });
        manageTowers(room);
        expect(tower.attack).toHaveBeenCalledWith(hostile);
        expect(tower.heal).not.toHaveBeenCalled();
    });

    it('does not heal or repair when hostiles present', () => {
        const tower = makeTower();
        const hostile = makeCreepWithHits(200, 200, false);
        const damagedAlly = makeCreepWithHits(50, 200, true);
        const room = makeRoom({});
        room.find = vi.fn((type: number) => {
            if (type === (global as any).FIND_MY_STRUCTURES) return [tower];
            if (type === (global as any).FIND_HOSTILE_CREEPS) return [hostile];
            if (type === (global as any).FIND_MY_CREEPS) return [damagedAlly];
            return [];
        });
        manageTowers(room);
        expect(tower.attack).toHaveBeenCalledWith(hostile);
        expect(tower.heal).not.toHaveBeenCalled();
        expect(tower.repair).not.toHaveBeenCalled();
    });
});

describe('manageTowers — priority 2: heal allies below 80%', () => {
    it('heals a damaged ally when no hostiles', () => {
        const tower = makeTower();
        const damagedAlly = makeCreepWithHits(100, 200, true); // 50% health
        const room = makeRoom({});
        room.find = vi.fn((type: number) => {
            if (type === (global as any).FIND_MY_STRUCTURES) return [tower];
            if (type === (global as any).FIND_HOSTILE_CREEPS) return [];
            if (type === (global as any).FIND_MY_CREEPS) return [damagedAlly];
            return [];
        });
        manageTowers(room);
        expect(tower.heal).toHaveBeenCalledWith(damagedAlly);
    });

    it('does not heal a creep at full health', () => {
        const tower = makeTower();
        const healthyAlly = makeCreepWithHits(200, 200, true);
        const room = makeRoom({});
        room.find = vi.fn((type: number) => {
            if (type === (global as any).FIND_MY_STRUCTURES) return [tower];
            if (type === (global as any).FIND_HOSTILE_CREEPS) return [];
            if (type === (global as any).FIND_MY_CREEPS) return [healthyAlly];
            return [];
        });
        manageTowers(room);
        expect(tower.heal).not.toHaveBeenCalled();
    });
});

describe('manageTowers — priority 3: repair ramparts below 10k hits', () => {
    it('repairs a low-hit rampart when no hostiles or damaged allies', () => {
        const tower = makeTower(900);
        const rampart = makeStructureWithHits('rampart', 5000, 300_000_000);
        const room = makeRoom({});
        room.find = vi.fn((type: number) => {
            if (type === (global as any).FIND_MY_STRUCTURES) return [tower];
            if (type === (global as any).FIND_HOSTILE_CREEPS) return [];
            if (type === (global as any).FIND_MY_CREEPS) return [];
            if (type === (global as any).FIND_STRUCTURES) return [rampart];
            return [];
        });
        manageTowers(room);
        expect(tower.repair).toHaveBeenCalledWith(rampart);
    });

    it('does not repair a rampart above 10k hits', () => {
        const tower = makeTower(900);
        const healthyRampart = makeStructureWithHits('rampart', 15000, 300_000_000);
        const room = makeRoom({});
        room.find = vi.fn((type: number) => {
            if (type === (global as any).FIND_MY_STRUCTURES) return [tower];
            if (type === (global as any).FIND_HOSTILE_CREEPS) return [];
            if (type === (global as any).FIND_MY_CREEPS) return [];
            if (type === (global as any).FIND_STRUCTURES) return [healthyRampart];
            return [];
        });
        manageTowers(room);
        expect(tower.repair).not.toHaveBeenCalled();
    });
});

describe('manageTowers — priority 4: repair roads below 50% when energy > 700', () => {
    it('repairs a degraded road when energy > 700', () => {
        const tower = makeTower(800);
        const road = makeStructureWithHits('road', 1000, 5000); // 20% health
        const room = makeRoom({});
        room.find = vi.fn((type: number) => {
            if (type === (global as any).FIND_MY_STRUCTURES) return [tower];
            if (type === (global as any).FIND_HOSTILE_CREEPS) return [];
            if (type === (global as any).FIND_MY_CREEPS) return [];
            if (type === (global as any).FIND_STRUCTURES) return [road];
            return [];
        });
        manageTowers(room);
        expect(tower.repair).toHaveBeenCalledWith(road);
    });

    it('does not repair roads when tower energy <= 700', () => {
        const tower = makeTower(700);
        const road = makeStructureWithHits('road', 1000, 5000);
        const room = makeRoom({});
        room.find = vi.fn((type: number) => {
            if (type === (global as any).FIND_MY_STRUCTURES) return [tower];
            if (type === (global as any).FIND_HOSTILE_CREEPS) return [];
            if (type === (global as any).FIND_MY_CREEPS) return [];
            if (type === (global as any).FIND_STRUCTURES) return [road];
            return [];
        });
        manageTowers(room);
        expect(tower.repair).not.toHaveBeenCalled();
    });
});

describe('manageTowers — no towers', () => {
    it('does nothing when room has no towers', () => {
        const room = makeRoom({});
        room.find = vi.fn(() => []);
        expect(() => manageTowers(room)).not.toThrow();
    });
});
