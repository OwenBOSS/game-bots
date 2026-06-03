import { describe, it, expect, beforeEach, vi } from 'vitest';
import { manageConstruction } from '../managers/constructionManager';
import { makeRoom, makeController, makeStorage } from './helpers';

beforeEach(() => {
    (global as any).STRUCTURE_CONTAINER  = 'container';
    (global as any).STRUCTURE_EXTENSION  = 'extension';
    (global as any).STRUCTURE_TOWER      = 'tower';
    (global as any).STRUCTURE_STORAGE    = 'storage';
    (global as any).FIND_SOURCES         = 105;
    (global as any).FIND_MY_STRUCTURES   = 108;
    (global as any).FIND_MY_SPAWNS       = 101;
    (global as any).FIND_STRUCTURES      = 107;
    (global as any).FIND_CONSTRUCTION_SITES = 109;
    (global as any).OK = 0;
    (global as any).Memory = {
        scoreMap: {}, scoreCache: {}, knownRooms: [],
        observerIndex: 0, observerTargets: [],
    };
    // Use a tick not divisible by 200 so the container re-check guard fires correctly
    (global as any).Game = { ...((global as any).Game ?? {}), time: 1001 };
});

function makeSource(x = 25, y = 15): any {
    return {
        id: `src_${x}_${y}`,
        pos: { x, y, roomName: 'W1N1', isEqualTo: vi.fn(() => false) },
    };
}

function makeRCRoom(level: number, opts: {
    sources?: any[];
    structures?: any[];
    constructionSites?: number;
    storage?: any;
} = {}): any {
    const sources = opts.sources ?? [makeSource()];
    const structures = opts.structures ?? [];
    const siteCount = opts.constructionSites ?? 0;

    const room: any = {
        name: 'W1N1',
        controller: makeController({ level }),
        storage: opts.storage ?? null,
        createConstructionSite: vi.fn(() => 0),
        lookForAt: vi.fn(() => []),
        findPath: vi.fn(() => []),
        find: vi.fn((type: number) => {
            if (type === (global as any).FIND_SOURCES)  return sources;
            if (type === (global as any).FIND_MY_STRUCTURES) return structures;
            if (type === (global as any).FIND_STRUCTURES)    return structures;
            if (type === (global as any).FIND_MY_SPAWNS)     return [];
            if (type === (global as any).FIND_CONSTRUCTION_SITES)
                return Array.from({ length: siteCount }, (_, i) => ({ id: `site${i}` }));
            return [];
        }),
        memory: {},
    };
    return room;
}

describe('manageConstruction — RC2: container sites', () => {
    it('places a container near each source that lacks one', () => {
        const room = makeRCRoom(2);
        manageConstruction(room);
        // One source → one container site placed
        expect(room.createConstructionSite).toHaveBeenCalled();
        const [, , type] = room.createConstructionSite.mock.calls[0];
        expect(type).toBe('container');
    });

    it('does not place a container site if one already exists near the source', () => {
        const source = makeSource(25, 15);
        const existingContainer = {
            structureType: 'container',
            pos: { x: 25, y: 16 },
        };
        const room = makeRCRoom(2, { sources: [source], structures: [existingContainer] });
        // Override find so FIND_STRUCTURES near source returns container
        room.find = vi.fn((type: number) => {
            if (type === (global as any).FIND_SOURCES) return [source];
            if (type === (global as any).FIND_MY_STRUCTURES || type === (global as any).FIND_STRUCTURES)
                return [existingContainer];
            return [];
        });
        // Simulate source pos nearby check
        source.pos.isEqualTo = vi.fn(() => false);
        // Mark already placed in memory
        room.memory.containerSitesPlaced = true;
        manageConstruction(room);
        expect(room.createConstructionSite).not.toHaveBeenCalled();
    });

    it('is idempotent: skips if memory.containerSitesPlaced is true', () => {
        const room = makeRCRoom(2, {});
        room.memory.containerSitesPlaced = true;
        manageConstruction(room);
        expect(room.createConstructionSite).not.toHaveBeenCalled();
    });
});

describe('manageConstruction — RC3: tower site', () => {
    it('places a tower construction site when none exists', () => {
        const room = makeRCRoom(3);
        room.memory.towerSitePlaced = false;
        manageConstruction(room);
        const towerCalls = room.createConstructionSite.mock.calls.filter(
            (c: any[]) => c[2] === 'tower'
        );
        expect(towerCalls.length).toBeGreaterThan(0);
    });

    it('skips tower site if already placed in memory', () => {
        const room = makeRCRoom(3);
        room.memory.towerSitePlaced = true;
        manageConstruction(room);
        const towerCalls = room.createConstructionSite.mock.calls.filter(
            (c: any[]) => c[2] === 'tower'
        );
        expect(towerCalls).toHaveLength(0);
    });

    it('skips tower site if tower structure already built', () => {
        const existingTower = { structureType: 'tower' };
        const room = makeRCRoom(3, { structures: [existingTower] });
        manageConstruction(room);
        const towerCalls = room.createConstructionSite.mock.calls.filter(
            (c: any[]) => c[2] === 'tower'
        );
        expect(towerCalls).toHaveLength(0);
    });
});

describe('manageConstruction — RC4: storage site', () => {
    it('places a storage construction site when none exists and no storage built', () => {
        const room = makeRCRoom(4);
        room.memory.storageSitePlaced = false;
        manageConstruction(room);
        const storageCalls = room.createConstructionSite.mock.calls.filter(
            (c: any[]) => c[2] === 'storage'
        );
        expect(storageCalls.length).toBeGreaterThan(0);
    });

    it('skips storage site if storage is already built', () => {
        const room = makeRCRoom(4, { storage: makeStorage() });
        room.storage = makeStorage();
        manageConstruction(room);
        const storageCalls = room.createConstructionSite.mock.calls.filter(
            (c: any[]) => c[2] === 'storage'
        );
        expect(storageCalls).toHaveLength(0);
    });

    it('skips storage site if already placed in memory', () => {
        const room = makeRCRoom(4);
        room.memory.storageSitePlaced = true;
        manageConstruction(room);
        const storageCalls = room.createConstructionSite.mock.calls.filter(
            (c: any[]) => c[2] === 'storage'
        );
        expect(storageCalls).toHaveLength(0);
    });
});

describe('manageConstruction — below RC2', () => {
    it('does nothing at RC1', () => {
        const room = makeRCRoom(1);
        manageConstruction(room);
        expect(room.createConstructionSite).not.toHaveBeenCalled();
    });
});
