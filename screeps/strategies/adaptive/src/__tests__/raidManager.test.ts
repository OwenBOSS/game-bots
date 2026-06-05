// TDD — raidManager.ts does not exist yet.
// These tests define the contract and will be RED until the implementation is written.
//
// Expected exports from ../managers/raidManager:
//   getOperationalPosture(rcl)                              → 'NONE' | 'OPPORTUNISTIC' | 'ORGANIZED' | 'FULL'
//   selectRaidTarget(room)                                  → string | null
//   isRaidViable(targetRoomName)                            → boolean
//   getRaidComposition(rcl)                                 → { attackers, rangers, haulers }
//   pickStrikeTarget(room)                                  → Creep | null
//   shouldRetreat(opts)                                     → boolean
//   trackRaidNetEnergy(roomName, capturedEnergy, spentEnergy) → void
//   shouldHaltRaids(roomName)                               → boolean

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    getOperationalPosture,
    selectRaidTarget,
    isRaidViable,
    getRaidComposition,
    pickStrikeTarget,
    shouldRetreat,
    trackRaidNetEnergy,
    shouldHaltRaids,
} from '../managers/raidManager';

const FIND_HOSTILE_CREEPS_CONST     = 103;
const FIND_HOSTILE_STRUCTURES_CONST = 111;
const RAID_STRENGTH_MAX             = 15;
const RAID_INTEL_MAX_AGE            = 500;

beforeEach(() => {
    (global as any).Game   = { time: 1000, rooms: {}, creeps: {} };
    (global as any).Memory = { roomIntel: {}, raidEconomy: {} };

    (global as any).FIND_HOSTILE_CREEPS     = FIND_HOSTILE_CREEPS_CONST;
    (global as any).FIND_HOSTILE_STRUCTURES = FIND_HOSTILE_STRUCTURES_CONST;
    (global as any).STRUCTURE_TOWER         = 'tower';
    (global as any).STRUCTURE_SPAWN         = 'spawn';
    (global as any).WORK                    = 'work';
    (global as any).CARRY                   = 'carry';
    (global as any).ATTACK                  = 'attack';
    (global as any).RANGED_ATTACK           = 'ranged_attack';
    (global as any).HEAL                    = 'heal';
    (global as any).RESOURCE_ENERGY         = 'energy';
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function writeIntel(roomName: string, opts: {
    strength?: number;
    enemyCreeps?: number;
    enemyTowers?: number;
    enemySpawns?: number;
    hasController?: boolean;
    controllerOwned?: boolean;
    sourceCount?: number;
    scannedAt?: number;
} = {}): void {
    (global as any).Memory.roomIntel[roomName] = {
        strength:        opts.strength        ?? 5,
        enemyCreeps:     opts.enemyCreeps     ?? 1,
        enemyTowers:     opts.enemyTowers     ?? 0,
        enemySpawns:     opts.enemySpawns     ?? 0,
        hasController:   opts.hasController   ?? true,
        controllerOwned: opts.controllerOwned ?? false,
        sourceCount:     opts.sourceCount     ?? 1,
        scannedAt:       opts.scannedAt       ?? ((global as any).Game.time - 10),
    };
}

function makeRoom(opts: {
    name?: string;
    rcl?: number;
    memory?: any;
    hostiles?: any[];
    hostileStructures?: any[];
} = {}): any {
    const hostiles          = opts.hostiles          ?? [];
    const hostileStructures = opts.hostileStructures ?? [];
    return {
        name: opts.name ?? 'W1N1',
        controller: { level: opts.rcl ?? 4, my: true },
        memory: opts.memory ?? {},
        find: vi.fn((type: number, findOpts?: { filter?: (s: any) => boolean }) => {
            let results: any[];
            if      (type === FIND_HOSTILE_CREEPS_CONST)     results = hostiles;
            else if (type === FIND_HOSTILE_STRUCTURES_CONST) results = hostileStructures;
            else results = [];
            return findOpts?.filter ? results.filter(findOpts.filter) : results;
        }),
    };
}

function makeHarvester(opts: { id?: string } = {}): any {
    return {
        id:    opts.id ?? 'harvester1',
        body:  [{ type: 'work' }, { type: 'move' }],
        store: { energy: 0 },
    };
}

function makeHauler(opts: { id?: string; carried?: number; capacity?: number } = {}): any {
    const carried  = opts.carried  ?? 0;
    const capacity = opts.capacity ?? 50;
    return {
        id:    opts.id ?? 'hauler1',
        body:  [{ type: 'carry' }, { type: 'move' }],
        store: { energy: carried, getFreeCapacity: () => capacity - carried },
    };
}

function makeTowerStructure(): any {
    return { structureType: 'tower', store: { energy: 1000 } };
}

function makeScavenger(opts: { freeCapacity?: number } = {}): any {
    return { store: { getFreeCapacity: vi.fn(() => opts.freeCapacity ?? 50) } };
}

function makeMilitary(opts: { hits?: number; hitsMax?: number } = {}): any {
    return { hits: opts.hits ?? 200, hitsMax: opts.hitsMax ?? 200 };
}

function makeHostileCreep(bodyTypes: string[]): any {
    return { body: bodyTypes.map(type => ({ type })) };
}

// ─── getOperationalPosture ────────────────────────────────────────────────────

describe('getOperationalPosture', () => {
    it('returns NONE at RCL 1', () => expect(getOperationalPosture(1)).toBe('NONE'));
    it('returns NONE at RCL 2', () => expect(getOperationalPosture(2)).toBe('NONE'));

    it('returns OPPORTUNISTIC at RCL 3', () => expect(getOperationalPosture(3)).toBe('OPPORTUNISTIC'));
    it('returns OPPORTUNISTIC at RCL 4', () => expect(getOperationalPosture(4)).toBe('OPPORTUNISTIC'));

    it('returns ORGANIZED at RCL 5', () => expect(getOperationalPosture(5)).toBe('ORGANIZED'));
    it('returns ORGANIZED at RCL 6', () => expect(getOperationalPosture(6)).toBe('ORGANIZED'));

    it('returns FULL at RCL 7', () => expect(getOperationalPosture(7)).toBe('FULL'));
    it('returns FULL at RCL 8', () => expect(getOperationalPosture(8)).toBe('FULL'));
});

// ─── isRaidViable ─────────────────────────────────────────────────────────────

describe('isRaidViable', () => {
    it('returns false when no intel exists for the room', () => {
        expect(isRaidViable('W9N9')).toBe(false);
    });

    it('returns false when the target has a tower', () => {
        writeIntel('W2N2', { enemyTowers: 1 });
        expect(isRaidViable('W2N2')).toBe(false);
    });

    it('returns false when intel is stale (> RAID_INTEL_MAX_AGE ticks)', () => {
        writeIntel('W2N2', { scannedAt: (global as any).Game.time - RAID_INTEL_MAX_AGE - 1 });
        expect(isRaidViable('W2N2')).toBe(false);
    });

    it('returns false when enemy strength exceeds RAID_STRENGTH_MAX', () => {
        writeIntel('W2N2', { strength: RAID_STRENGTH_MAX + 1, enemyTowers: 0 });
        expect(isRaidViable('W2N2')).toBe(false);
    });

    it('returns true for an undefended room with fresh intel', () => {
        writeIntel('W2N2', { enemyTowers: 0, strength: 5, enemyCreeps: 2 });
        expect(isRaidViable('W2N2')).toBe(true);
    });

    it('returns true when strength is exactly at RAID_STRENGTH_MAX', () => {
        writeIntel('W2N2', { enemyTowers: 0, strength: RAID_STRENGTH_MAX });
        expect(isRaidViable('W2N2')).toBe(true);
    });

    it('returns true when intel is exactly at the freshness boundary', () => {
        writeIntel('W2N2', {
            enemyTowers: 0,
            strength:    5,
            scannedAt:   (global as any).Game.time - RAID_INTEL_MAX_AGE,
        });
        expect(isRaidViable('W2N2')).toBe(true);
    });
});

// ─── selectRaidTarget ─────────────────────────────────────────────────────────

describe('selectRaidTarget', () => {
    it('returns null when roomIntel is empty', () => {
        expect(selectRaidTarget(makeRoom({ rcl: 4 }))).toBeNull();
    });

    it('returns null when all known rooms have towers', () => {
        writeIntel('W2N2', { enemyTowers: 1 });
        writeIntel('W3N3', { enemyTowers: 2 });
        expect(selectRaidTarget(makeRoom({ rcl: 4 }))).toBeNull();
    });

    it('returns null when all intel is stale', () => {
        writeIntel('W2N2', { scannedAt: 0 });
        expect(selectRaidTarget(makeRoom({ rcl: 4 }))).toBeNull();
    });

    it('returns the one viable room when only one qualifies', () => {
        writeIntel('W2N2', { enemyTowers: 0, strength: 8, enemyCreeps: 2 });
        expect(selectRaidTarget(makeRoom({ rcl: 4 }))).toBe('W2N2');
    });

    it('picks the weakest (lowest strength) viable room when multiple qualify', () => {
        writeIntel('W2N2', { enemyTowers: 0, strength: 12 });
        writeIntel('W3N3', { enemyTowers: 0, strength: 4 });   // weakest — should win
        writeIntel('W4N4', { enemyTowers: 0, strength: 8 });
        expect(selectRaidTarget(makeRoom({ rcl: 4 }))).toBe('W3N3');
    });

    it('skips rooms we own (controller.my)', () => {
        writeIntel('W2N2', { enemyTowers: 0, strength: 3 });
        (global as any).Game.rooms['W2N2'] = { controller: { my: true } };
        expect(selectRaidTarget(makeRoom({ rcl: 4 }))).toBeNull();
    });

    it('skips rooms we are currently remote mining', () => {
        writeIntel('W2N2', { enemyTowers: 0, strength: 3 });
        const room = makeRoom({
            rcl:    4,
            memory: { remoteRooms: { 'W2N2': { sources: 1, miners: 1, haulers: 1, reservedUntil: 9999 } } },
        });
        expect(selectRaidTarget(room)).toBeNull();
    });

    it('skips rooms with strength 0 (already empty)', () => {
        writeIntel('W2N2', { enemyTowers: 0, strength: 0 });
        expect(selectRaidTarget(makeRoom({ rcl: 4 }))).toBeNull();
    });

    it('skips rooms whose strength exceeds RAID_STRENGTH_MAX', () => {
        writeIntel('W2N2', { enemyTowers: 0, strength: RAID_STRENGTH_MAX + 1 });
        expect(selectRaidTarget(makeRoom({ rcl: 4 }))).toBeNull();
    });
});

// ─── getRaidComposition ───────────────────────────────────────────────────────

describe('getRaidComposition', () => {
    it('returns zero composition for RCL < 3 (NONE posture)', () => {
        const comp = getRaidComposition(2);
        expect(comp.attackers).toBe(0);
        expect(comp.rangers).toBe(0);
        expect(comp.haulers).toBe(0);
    });

    it('returns 1 attacker, 0 rangers, 2 haulers at RCL 3 (OPPORTUNISTIC)', () => {
        const comp = getRaidComposition(3);
        expect(comp.attackers).toBe(1);
        expect(comp.rangers).toBe(0);
        expect(comp.haulers).toBe(2);
    });

    it('returns the same composition at RCL 4 as RCL 3', () => {
        expect(getRaidComposition(4)).toEqual(getRaidComposition(3));
    });

    it('returns 2 attackers, 1 ranger, 3 haulers at RCL 5 (ORGANIZED)', () => {
        const comp = getRaidComposition(5);
        expect(comp.attackers).toBe(2);
        expect(comp.rangers).toBe(1);
        expect(comp.haulers).toBe(3);
    });

    it('returns the same composition at RCL 6 as RCL 5', () => {
        expect(getRaidComposition(6)).toEqual(getRaidComposition(5));
    });

    it('returns 2 attackers, 2 rangers, 3 haulers at RCL 7 (FULL)', () => {
        const comp = getRaidComposition(7);
        expect(comp.attackers).toBe(2);
        expect(comp.rangers).toBe(2);
        expect(comp.haulers).toBe(3);
    });

    it('returns the same composition at RCL 8 as RCL 7', () => {
        expect(getRaidComposition(8)).toEqual(getRaidComposition(7));
    });
});

// ─── pickStrikeTarget ─────────────────────────────────────────────────────────

describe('pickStrikeTarget', () => {
    it('returns null when the room is empty', () => {
        expect(pickStrikeTarget(makeRoom())).toBeNull();
    });

    it('returns null when a tower is present — abort the strike', () => {
        const room = makeRoom({
            hostiles:          [makeHarvester()],
            hostileStructures: [makeTowerStructure()],
        });
        expect(pickStrikeTarget(room)).toBeNull();
    });

    it('prefers a harvester (WORK parts) over any hauler', () => {
        const harvester = makeHarvester({ id: 'h_work' });
        const hauler    = makeHauler({ id: 'h_carry', carried: 50 });
        const room      = makeRoom({ hostiles: [hauler, harvester] });
        expect(pickStrikeTarget(room)).toBe(harvester);
    });

    it('prefers a laden hauler over an empty hauler when no harvesters present', () => {
        const laden = makeHauler({ id: 'laden', carried: 40, capacity: 50 });
        const empty = makeHauler({ id: 'empty', carried: 0,  capacity: 50 });
        expect(pickStrikeTarget(makeRoom({ hostiles: [empty, laden] }))).toBe(laden);
    });

    it('returns an empty hauler as fallback when no harvesters or laden haulers', () => {
        const empty = makeHauler({ id: 'empty', carried: 0 });
        expect(pickStrikeTarget(makeRoom({ hostiles: [empty] }))).toBe(empty);
    });

    it('prefers the harvester even when it carries zero energy (killing = stops generation)', () => {
        const harvester = makeHarvester({ id: 'h' });
        const laden     = makeHauler({ id: 'l', carried: 50 });
        expect(pickStrikeTarget(makeRoom({ hostiles: [laden, harvester] }))).toBe(harvester);
    });
});

// ─── shouldRetreat ────────────────────────────────────────────────────────────

describe('shouldRetreat', () => {
    it('returns false when scavengers have capacity, no damage, no military threat', () => {
        expect(shouldRetreat({
            scavengers:    [makeScavenger({ freeCapacity: 50 })],
            hostiles:      [],
            militaryUnits: [makeMilitary()],
        })).toBe(false);
    });

    it('returns false when scavenger list is empty and no other trigger is met', () => {
        expect(shouldRetreat({
            scavengers:    [],
            hostiles:      [],
            militaryUnits: [makeMilitary()],
        })).toBe(false);
    });

    it('returns true when ALL scavengers are at full capacity (freeCapacity === 0)', () => {
        expect(shouldRetreat({
            scavengers:    [makeScavenger({ freeCapacity: 0 })],
            hostiles:      [],
            militaryUnits: [],
        })).toBe(true);
    });

    it('returns false when only SOME scavengers are full — keep collecting', () => {
        expect(shouldRetreat({
            scavengers:    [makeScavenger({ freeCapacity: 0 }), makeScavenger({ freeCapacity: 10 })],
            hostiles:      [],
            militaryUnits: [],
        })).toBe(false);
    });

    it('returns true when any military unit has taken damage (hits < hitsMax)', () => {
        expect(shouldRetreat({
            scavengers:    [makeScavenger({ freeCapacity: 50 })],
            hostiles:      [],
            militaryUnits: [makeMilitary({ hits: 150, hitsMax: 200 })],
        })).toBe(true);
    });

    it('returns true when a hostile with ATTACK parts appears (military response)', () => {
        expect(shouldRetreat({
            scavengers:    [makeScavenger({ freeCapacity: 50 })],
            hostiles:      [makeHostileCreep(['attack', 'move'])],
            militaryUnits: [makeMilitary()],
        })).toBe(true);
    });

    it('returns true when a hostile with RANGED_ATTACK parts appears', () => {
        expect(shouldRetreat({
            scavengers:    [makeScavenger({ freeCapacity: 50 })],
            hostiles:      [makeHostileCreep(['ranged_attack', 'move'])],
            militaryUnits: [makeMilitary()],
        })).toBe(true);
    });

    it('does not retreat for WORK/CARRY-only hostiles (economy creeps, not military)', () => {
        expect(shouldRetreat({
            scavengers:    [makeScavenger({ freeCapacity: 50 })],
            hostiles:      [makeHostileCreep(['work', 'carry', 'move'])],
            militaryUnits: [makeMilitary()],
        })).toBe(false);
    });
});

// ─── trackRaidNetEnergy + shouldHaltRaids ────────────────────────────────────

describe('trackRaidNetEnergy / shouldHaltRaids', () => {
    it('shouldHaltRaids returns false with no recorded entries', () => {
        expect(shouldHaltRaids('W1N1')).toBe(false);
    });

    it('shouldHaltRaids returns false when net energy is positive', () => {
        trackRaidNetEnergy('W1N1', 1000, 400);   // +600 net
        expect(shouldHaltRaids('W1N1')).toBe(false);
    });

    it('shouldHaltRaids returns false when net energy is exactly zero', () => {
        trackRaidNetEnergy('W1N1', 500, 500);
        expect(shouldHaltRaids('W1N1')).toBe(false);
    });

    it('shouldHaltRaids returns true when cumulative net is negative', () => {
        trackRaidNetEnergy('W1N1', 100, 800);    // -700
        trackRaidNetEnergy('W1N1', 50,  600);    // -550 → cumulative = -1250
        expect(shouldHaltRaids('W1N1')).toBe(true);
    });

    it('excludes entries outside the 500-tick window when calculating net', () => {
        // Seed an old loss from tick 0 — will be outside the 500t window at tick 600
        (global as any).Memory.raidEconomy['W1N1'] = {
            entries: [{ tick: 0, captured: 0, spent: 5000 }],
        };
        (global as any).Game.time = 600;
        trackRaidNetEnergy('W1N1', 500, 100);   // +400 within window
        expect(shouldHaltRaids('W1N1')).toBe(false);
    });

    it('tracks economy independently per home room', () => {
        trackRaidNetEnergy('W1N1', 100, 800);   // W1N1 net negative
        trackRaidNetEnergy('W2N2', 800, 100);   // W2N2 net positive
        expect(shouldHaltRaids('W1N1')).toBe(true);
        expect(shouldHaltRaids('W2N2')).toBe(false);
    });

    it('drops stale entries on subsequent calls — only window data counts', () => {
        trackRaidNetEnergy('W1N1', 0, 1000);        // tick 1000 — large loss
        (global as any).Game.time = 1600;            // advance 600 ticks past the loss
        trackRaidNetEnergy('W1N1', 2000, 0);         // tick 1600 — large gain
        // Entry at tick 1000 is now >500t old; only the gain at 1600 is in window
        expect(shouldHaltRaids('W1N1')).toBe(false);
    });
});
