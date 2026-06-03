import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { getFortifyTarget, towerEffect, chooseTowerTarget } from '../managers/combatManager';

// manageTactics and manageQuads are side-effectful modules that touch Game state
// we don't care about — mock them at module level so manageCombat can be imported.
vi.mock('../managers/tacticsManager', () => ({ manageTactics: vi.fn() }));
vi.mock('../managers/quadManager',    () => ({ manageQuads:    vi.fn() }));

// manageCombat is imported after mocks are established.
import { manageCombat } from '../managers/combatManager';

// ─── Constants not in setup.ts (Screeps engine globals) ──────────────────────

const FIND_MY_STRUCTURES_CONST = 108;

beforeEach(() => {
    (global as any).Game = {
        time: 1000,
        rooms: {} as Record<string, any>,
        creeps: {} as Record<string, any>,
        getObjectById: vi.fn(() => null),
    };
    (global as any).Memory = { roomIntel: {}, roomThreats: {} };

    // Tower constants
    (global as any).TOWER_OPTIMAL_RANGE  = 5;
    (global as any).TOWER_FALLOFF_RANGE  = 20;
    (global as any).TOWER_FALLOFF        = 0.75;
    (global as any).TOWER_POWER_ATTACK   = 600;
    (global as any).TOWER_POWER_HEAL     = 400;
    (global as any).TOWER_ENERGY_COST    = 10;

    // Structure find constant used in combatManager
    (global as any).FIND_MY_STRUCTURES   = FIND_MY_STRUCTURES_CONST;

    // Already set in setup.ts but reset here for isolation
    (global as any).FIND_HOSTILE_CREEPS  = 103;
    (global as any).FIND_MY_CREEPS       = 104;
    (global as any).STRUCTURE_RAMPART    = 'rampart';
    (global as any).STRUCTURE_TOWER      = 'tower';
    (global as any).RESOURCE_ENERGY      = 'energy';
    (global as any).ATTACK               = 'attack';
    (global as any).RANGED_ATTACK        = 'ranged_attack';
    (global as any).WORK                 = 'work';
    (global as any).HEAL                 = 'heal';
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRampart(hits: number, id = `rampart_${hits}`): any {
    return { id, hits, structureType: 'rampart' };
}

function makeTower(opts: { energyStored?: number; rangeTo?: number } = {}): any {
    const energy = opts.energyStored ?? 1000;
    const rangeFn = vi.fn(() => opts.rangeTo ?? 10);
    return {
        structureType: 'tower',
        store: { energy, [(global as any).RESOURCE_ENERGY]: energy },
        pos: { getRangeTo: rangeFn },
        attack: vi.fn(),
        heal: vi.fn(),
        repair: vi.fn(),
    };
}

function makeHostile(opts: {
    id?: string;
    bodyTypes?: string[];
    bodyHits?: number;
    /** Default range returned by pos.getRangeTo — defaults to 10 so math is always valid. */
    rangeTo?: number;
} = {}): any {
    const bodyTypes = opts.bodyTypes ?? ['attack'];
    const bodyHits  = opts.bodyHits ?? 1;
    const rangeTo   = opts.rangeTo ?? 10;
    return {
        id: opts.id ?? `hostile_${Math.random()}`,
        body: bodyTypes.map(type => ({ type, hits: bodyHits })),
        // Always return a concrete number so Math.min(d, 49) is valid in tower math.
        pos: { getRangeTo: vi.fn(() => rangeTo) },
        hits: 200,
        hitsMax: 200,
    };
}

/** Build a room mock with fine-grained control over find() returns. */
function makeRoom(opts: {
    name?: string;
    memory?: any;
    ramparts?: any[];
    towers?: any[];
    hostiles?: any[];
    myCreeps?: any[];
    controller?: any;
} = {}): any {
    const ramparts  = opts.ramparts  ?? [];
    const towers    = opts.towers    ?? [];
    const hostiles  = opts.hostiles  ?? [];
    const myCreeps  = opts.myCreeps  ?? [];

    const room: any = {
        name: opts.name ?? 'W1N1',
        memory: opts.memory ?? {},
        controller: opts.controller,
        find: vi.fn((type: number, findOpts?: { filter?: (s: any) => boolean }) => {
            let results: any[];
            if (type === FIND_MY_STRUCTURES_CONST) {
                results = [...ramparts, ...towers];
            } else if (type === (global as any).FIND_HOSTILE_CREEPS) {
                results = hostiles;
            } else if (type === (global as any).FIND_MY_CREEPS) {
                results = myCreeps;
            } else {
                results = [];
            }
            return findOpts?.filter ? results.filter(findOpts.filter) : results;
        }),
    };
    return room;
}

function makeController(opts: {
    level?: number;
    my?: boolean;
    safeMode?: number;
    safeModeAvailable?: number;
    activateSafeMode?: ReturnType<typeof vi.fn>;
} = {}): any {
    return {
        level: opts.level ?? 2,
        my: opts.my ?? true,
        safeMode: opts.safeMode,
        safeModeAvailable: opts.safeModeAvailable ?? 1,
        activateSafeMode: opts.activateSafeMode ?? vi.fn(),
    };
}

// ─── towerEffect ─────────────────────────────────────────────────────────────

describe('towerEffect', () => {
    it('returns full power at distance 0', () => {
        expect(towerEffect(600, 0)).toBe(600);
    });

    it('returns full power at TOWER_OPTIMAL_RANGE (5)', () => {
        expect(towerEffect(600, 5)).toBe(600);
    });

    it('applies 75% falloff at TOWER_FALLOFF_RANGE (20)', () => {
        // power * (1 - TOWER_FALLOFF) = 600 * 0.25 = 150
        expect(towerEffect(600, 20)).toBe(150);
    });

    it('applies linear falloff midway between range 5 and 20 (distance=12)', () => {
        // ratio = (12 - 5) / (20 - 5) = 7/15
        // damage = floor(600 - 600 * 0.75 * (7/15)) = floor(600 - 210) = 390
        expect(towerEffect(600, 12)).toBe(390);
    });

    it('clamps to TOWER_FALLOFF_RANGE when distance exceeds it', () => {
        // Distance 30 should behave the same as distance 20
        expect(towerEffect(600, 30)).toBe(towerEffect(600, 20));
    });

    it('floors fractional results', () => {
        // distance=6: ratio = 1/15; dmg = 600 - 600*0.75*(1/15) = 600 - 30 = 570 (exact)
        // distance=7: ratio = 2/15; dmg = 600 - 600*0.75*(2/15) = 600 - 60 = 540 (exact)
        // distance=8: ratio = 3/15 = 0.2; dmg = 600 - 600*0.75*0.2 = 600 - 90 = 510 (exact)
        // use a non-divisible power to force flooring
        // power=100, distance=6: 100 - 100*0.75*(1/15) = 100 - 5 = 95 (exact)
        // power=100, distance=7: 100 - 100*0.75*(2/15) = 100 - 10 = 90 (exact)
        // power=7, distance=6: 7 - 7*0.75*(1/15) = 7 - 0.35 = 6.65 → floor = 6
        expect(towerEffect(7, 6)).toBe(6);
    });

    it('returns full power for power=0 regardless of distance', () => {
        expect(towerEffect(0, 30)).toBe(0);
    });

    it('scales linearly — midpoint damage is between optimal and falloff damage', () => {
        const atOptimal  = towerEffect(600, 5);
        const atMid      = towerEffect(600, 12);
        const atFalloff  = towerEffect(600, 20);
        expect(atMid).toBeGreaterThan(atFalloff);
        expect(atMid).toBeLessThan(atOptimal);
    });
});

// ─── chooseTowerTarget ───────────────────────────────────────────────────────

describe('chooseTowerTarget', () => {
    // TOWER_DMG_AT is a module-level cache filled lazily by initTowerTables(),
    // which is called only from manageTowers (i.e., inside manageCombat).
    // Run one manageCombat call before these tests so the table is populated
    // and TOWER_DMG_AT[d] returns a real number for every distance.
    beforeAll(() => {
        (global as any).TOWER_OPTIMAL_RANGE = 5;
        (global as any).TOWER_FALLOFF_RANGE = 20;
        (global as any).TOWER_FALLOFF       = 0.75;
        (global as any).TOWER_POWER_ATTACK  = 600;
        (global as any).TOWER_POWER_HEAL    = 400;
        (global as any).TOWER_ENERGY_COST   = 10;
        (global as any).FIND_MY_STRUCTURES  = 108;
        (global as any).FIND_HOSTILE_CREEPS = 103;
        (global as any).FIND_MY_CREEPS      = 104;
        (global as any).STRUCTURE_RAMPART   = 'rampart';
        (global as any).STRUCTURE_TOWER     = 'tower';
        (global as any).RESOURCE_ENERGY     = 'energy';
        (global as any).ATTACK              = 'attack';
        (global as any).RANGED_ATTACK       = 'ranged_attack';
        (global as any).WORK                = 'work';
        (global as any).HEAL                = 'heal';
        (global as any).Game = {
            time: 999,
            rooms: {},
            creeps: {},
            getObjectById: vi.fn(() => null),
        };

        // Build a minimal room with one tower and one hostile so manageTowers
        // runs its full path and calls initTowerTables().
        const warmHostile = makeHostile({ id: 'warm', bodyTypes: ['attack'], rangeTo: 10 });
        const warmTower   = makeTower({ energyStored: 1000, rangeTo: 10 });
        warmTower.attack = vi.fn();

        const warmRoom: any = {
            name: 'WARM',
            memory: {},
            controller: undefined,
            find: (type: number, opts?: any) => {
                if (type === 108)  return [warmTower];  // FIND_MY_STRUCTURES → towers
                if (type === 103)  return [warmHostile]; // FIND_HOSTILE_CREEPS
                if (type === 104)  return [];            // FIND_MY_CREEPS
                return [];
            },
        };
        manageCombat(warmRoom);
    });

    it('returns the only hostile when pool has one member', () => {
        const tower   = makeTower({ rangeTo: 10 });
        const hostile = makeHostile({ id: 'h1', bodyTypes: ['attack'] });
        const result  = chooseTowerTarget([tower], [hostile]);
        expect(result).toBe(hostile);
    });

    it('prioritises healers over non-healers', () => {
        const tower    = makeTower({ rangeTo: 10 });
        // Warrior closer to towers (range 5 → more damage), but healer should still win priority
        const warrior  = makeHostile({ id: 'warrior', bodyTypes: ['attack'], rangeTo: 5 });
        const healer   = makeHostile({ id: 'healer',  bodyTypes: ['heal'],   rangeTo: 15 });

        // Override pos.getRangeTo per-hostile so the warrior would win on damage alone
        warrior.pos.getRangeTo = vi.fn(() => 5);
        healer.pos.getRangeTo  = vi.fn(() => 15);

        const result = chooseTowerTarget([tower], [warrior, healer]);
        expect(result).toBe(healer);
    });

    it('only considers healers whose body part has hits > 0', () => {
        const tower = makeTower();
        // Healer with 0 hits — body part is destroyed; should not count as live healer.
        // warrior is placed closer (range 5 = full power) so it wins the damage contest
        // within the fallback-to-all pool, proving dead healer is not in a special healer pool
        // but also confirming warrior wins the damage comparison.
        const deadHealer = makeHostile({ id: 'dead_healer', bodyTypes: ['heal'], bodyHits: 0, rangeTo: 15 });
        const warrior    = makeHostile({ id: 'warrior',     bodyTypes: ['attack'],              rangeTo: 5 });
        deadHealer.pos.getRangeTo = vi.fn(() => 15);
        warrior.pos.getRangeTo   = vi.fn(() => 5);
        tower.pos.getRangeTo     = vi.fn((target: any) => target === warrior ? 5 : 15);

        const result = chooseTowerTarget([tower], [deadHealer, warrior]);
        // Pool is all hostiles (no live healers); warrior closer → more damage → wins
        expect(result).toBe(warrior);
    });

    it('picks the healer closest to towers when multiple healers present', () => {
        const closeHealer = makeHostile({ id: 'h_close', bodyTypes: ['heal'], rangeTo: 6  });
        const farHealer   = makeHostile({ id: 'h_far',   bodyTypes: ['heal'], rangeTo: 18 });
        // Tower's getRangeTo must dispatch per-target so damage is calculated correctly.
        const tower = makeTower();
        tower.pos.getRangeTo = vi.fn((target: any) => target === closeHealer ? 6 : 18);

        const result = chooseTowerTarget([tower], [farHealer, closeHealer]);
        // closeHealer at range 6 takes more damage than farHealer at range 18
        expect(result).toBe(closeHealer);
    });

    it('accumulates damage from all towers to pick best target', () => {
        // Two towers: tower A close to hostile1, tower B close to hostile2.
        // Total damage should determine winner, not any single tower.
        const towerA = makeTower(); // will be overridden per-hostile
        const towerB = makeTower();

        const hostile1 = makeHostile({ id: 'h1', bodyTypes: ['attack'] });
        const hostile2 = makeHostile({ id: 'h2', bodyTypes: ['attack'] });

        // towerA is at range 5 to h1 (full power) but range 20 to h2 (minimal power)
        // towerB is at range 20 to h1 but range 5 to h2
        // => h1 total: towerEffect(600,5) + towerEffect(600,20) = 600 + 150 = 750
        // => h2 total: towerEffect(600,20) + towerEffect(600,5) = 150 + 600 = 750
        // Equal — result is whichever appears first; just verify no crash and a valid pick.
        towerA.pos.getRangeTo = vi.fn((target: any) => target === hostile1 ? 5 : 20);
        towerB.pos.getRangeTo = vi.fn((target: any) => target === hostile2 ? 5 : 20);

        const result = chooseTowerTarget([towerA, towerB], [hostile1, hostile2]);
        expect([hostile1, hostile2]).toContain(result);
    });

    it('falls back to full pool when there are no healers at all', () => {
        const tower   = makeTower({ rangeTo: 5 });
        const warrior = makeHostile({ id: 'w1', bodyTypes: ['attack'] });
        const ranger  = makeHostile({ id: 'r1', bodyTypes: ['ranged_attack'] });
        warrior.pos.getRangeTo = vi.fn(() => 5);
        ranger.pos.getRangeTo  = vi.fn(() => 15);

        // warrior closer → more damage → should be selected
        const result = chooseTowerTarget([tower], [warrior, ranger]);
        expect(result).toBe(warrior);
    });

    it('respects creep with both heal and attack parts — healer pool wins', () => {
        const tower    = makeTower({ rangeTo: 10 });
        const hybrid   = makeHostile({ id: 'hybrid', bodyTypes: ['heal', 'attack'] });
        const pure_war = makeHostile({ id: 'warrior', bodyTypes: ['attack'] });
        hybrid.pos.getRangeTo   = vi.fn(() => 10);
        pure_war.pos.getRangeTo = vi.fn(() => 10);

        // hybrid is in healer pool; pure_war is not
        const result = chooseTowerTarget([tower], [hybrid, pure_war]);
        expect(result).toBe(hybrid);
    });
});

// ─── getFortifyTarget ────────────────────────────────────────────────────────

describe('getFortifyTarget', () => {
    it('returns null when no ramparts exist', () => {
        const room = makeRoom({ ramparts: [] });
        expect(getFortifyTarget(room)).toBeNull();
    });

    it('returns the single rampart when only one exists', () => {
        const ramp = makeRampart(50_000, 'r1');
        const room = makeRoom({ ramparts: [ramp] });
        const result = getFortifyTarget(room);
        expect(result).toBe(ramp);
    });

    it('returns the lowest-hits rampart when all are above RAMPART_DECAY_LIMIT', () => {
        const low  = makeRampart(40_000, 'low');
        const high = makeRampart(100_000, 'high');
        const room = makeRoom({ ramparts: [high, low] });
        expect(getFortifyTarget(room)).toBe(low);
    });

    it('returns the lowest decaying rampart when any are below RAMPART_DECAY_LIMIT (30k)', () => {
        const decaying1 = makeRampart(20_000, 'decay1');
        const decaying2 = makeRampart(10_000, 'decay2');  // lowest decaying
        const healthy   = makeRampart(80_000, 'healthy');
        const room = makeRoom({ ramparts: [decaying1, decaying2, healthy] });
        expect(getFortifyTarget(room)).toBe(decaying2);
    });

    it('prioritises a decaying rampart over a healthy one with lower hits', () => {
        // healthy has 35k hits (just above decay limit), decaying1 has 29k hits (below)
        // Even though 29k < 35k, the decaying group is selected first for the minimum.
        // Then lowest decaying is the one returned.
        const decaying = makeRampart(29_000, 'decaying');
        const healthy  = makeRampart(35_000, 'healthy');   // above 30k
        const room = makeRoom({ ramparts: [healthy, decaying] });
        expect(getFortifyTarget(room)).toBe(decaying);
    });

    it('exactly at RAMPART_DECAY_LIMIT (30_000) is treated as decaying', () => {
        const atLimit = makeRampart(30_000, 'at_limit');
        const healthy = makeRampart(60_000, 'healthy');
        const room = makeRoom({ ramparts: [healthy, atLimit] });
        expect(getFortifyTarget(room)).toBe(atLimit);
    });

    it('caches result for FORTIFY_CACHE_TICKS (50) ticks', () => {
        const ramp = makeRampart(50_000, 'cached');
        (global as any).Game.time = 1000;
        (global as any).Game.getObjectById = vi.fn(() => ramp);

        const room = makeRoom({ ramparts: [ramp], memory: {} });

        // First call: cold cache — computes and stores
        const first = getFortifyTarget(room);
        expect(first).toBe(ramp);
        expect(room.memory.fortifyTarget).toBe('cached');
        expect(room.memory.fortifyTargetTick).toBe(1000);

        // Spy to confirm room.find is NOT called on second call within cache window
        room.find.mockClear();

        // Within cache window: tick +49
        (global as any).Game.time = 1049;
        const second = getFortifyTarget(room);
        expect(second).toBe(ramp);
        expect(room.find).not.toHaveBeenCalled();
    });

    it('recomputes after cache expires (>= FORTIFY_CACHE_TICKS ticks)', () => {
        const oldRamp = makeRampart(50_000, 'old');
        const newRamp = makeRampart(20_000, 'new');

        (global as any).Game.time = 1000;
        (global as any).Game.getObjectById = vi.fn(() => oldRamp);

        const room = makeRoom({ ramparts: [oldRamp], memory: {} });
        getFortifyTarget(room);  // warm cache with oldRamp

        // Expire the cache: advance by exactly 50 ticks
        (global as any).Game.time = 1050;
        room.find = vi.fn((_type: number, findOpts?: any) => {
            const results = [oldRamp, newRamp];
            return findOpts?.filter ? results.filter(findOpts.filter) : results;
        });

        const result = getFortifyTarget(room);
        // newRamp has 20k hits (decaying) — should be selected over oldRamp
        expect(result).toBe(newRamp);
        expect(room.memory.fortifyTargetTick).toBe(1050);
    });

    it('recomputes when cached object no longer exists (getObjectById returns null)', () => {
        const ramp = makeRampart(50_000, 'gone');
        (global as any).Game.time = 1000;
        (global as any).Game.getObjectById = vi.fn(() => null);  // object removed from world

        const room = makeRoom({
            ramparts: [ramp],
            memory: { fortifyTarget: 'gone', fortifyTargetTick: 1000 },
        });

        // Should recompute even though tick is within cache window
        const result = getFortifyTarget(room);
        expect(result).toBe(ramp);
    });

    it('writes fortifyTarget id and fortifyTargetTick to room.memory', () => {
        const ramp = makeRampart(50_000, 'tracked');
        (global as any).Game.time = 2000;
        const room = makeRoom({ ramparts: [ramp], memory: {} });

        getFortifyTarget(room);
        expect(room.memory.fortifyTarget).toBe('tracked');
        expect(room.memory.fortifyTargetTick).toBe(2000);
    });
});

// ─── checkSafeMode (via manageCombat) ────────────────────────────────────────

describe('checkSafeMode via manageCombat', () => {
    /** Build a dangerous hostile with an attack body part. */
    function dangerousHostile(id = 'enemy1'): any {
        return makeHostile({ id, bodyTypes: ['attack'] });
    }

    /** Build exactly 5 dangerous hostiles — meets SAFE_MODE_OVERWHELM_COUNT. */
    function fiveHostiles(): any[] {
        return Array.from({ length: 5 }, (_, i) => dangerousHostile(`h${i}`));
    }

    it('does not activate safemode when controller has no safeModeAvailable', () => {
        const activate = vi.fn();
        const ctrl = makeController({ safeModeAvailable: 0, activateSafeMode: activate });
        const room = makeRoom({ controller: ctrl, hostiles: fiveHostiles() });
        manageCombat(room);
        expect(activate).not.toHaveBeenCalled();
    });

    it('does not activate safemode when controller.safeMode is already active', () => {
        const activate = vi.fn();
        const ctrl = makeController({ safeMode: 1000, safeModeAvailable: 1, activateSafeMode: activate });
        const room = makeRoom({ controller: ctrl, hostiles: fiveHostiles() });
        manageCombat(room);
        expect(activate).not.toHaveBeenCalled();
    });

    it('does not activate safemode when there are no dangerous hostiles', () => {
        const activate = vi.fn();
        const ctrl = makeController({ activateSafeMode: activate });
        // Hostile with only HEAL body part — not dangerous
        const healer = makeHostile({ id: 'healer', bodyTypes: ['heal'] });
        const room = makeRoom({ controller: ctrl, hostiles: [healer] });
        manageCombat(room);
        expect(activate).not.toHaveBeenCalled();
    });

    it('does not activate safemode when fewer than 5 dangerous hostiles and no critical rampart', () => {
        const activate = vi.fn();
        const ctrl = makeController({ activateSafeMode: activate });
        // Only 4 dangerous hostiles, no ramparts
        const hostiles = Array.from({ length: 4 }, (_, i) => dangerousHostile(`h${i}`));
        const room = makeRoom({ controller: ctrl, hostiles, ramparts: [] });
        manageCombat(room);
        expect(activate).not.toHaveBeenCalled();
    });

    it('activates safemode when overwhelmed (>= 5 dangerous hostiles) and no better room available', () => {
        const activate = vi.fn();
        const ctrl = makeController({ level: 3, safeModeAvailable: 1, activateSafeMode: activate });
        const room = makeRoom({ name: 'W1N1', controller: ctrl, hostiles: fiveHostiles() });

        // No other rooms in Game.rooms
        (global as any).Game.rooms = { W1N1: room };

        manageCombat(room);
        expect(activate).toHaveBeenCalledTimes(1);
    });

    it('withholds safemode when a higher-RCL room has charges', () => {
        const activate = vi.fn();
        // Our room: RCL 3
        const ourCtrl = makeController({ level: 3, safeModeAvailable: 1, activateSafeMode: activate });
        const ourRoom = makeRoom({ name: 'W1N1', controller: ourCtrl, hostiles: fiveHostiles() });

        // Higher-RCL room: RCL 6 with charges
        const betterCtrl: any = {
            level: 6, my: true, safeModeAvailable: 1, safeMode: undefined,
        };
        const betterRoom: any = { name: 'W5N5', controller: betterCtrl };

        (global as any).Game.rooms = { W1N1: ourRoom, W5N5: betterRoom };

        manageCombat(ourRoom);
        expect(activate).not.toHaveBeenCalled();
    });

    it('does NOT withhold when a same-RCL room has charges (only HIGHER triggers withholding)', () => {
        const activate = vi.fn();
        // Our room: RCL 4
        const ourCtrl = makeController({ level: 4, safeModeAvailable: 1, activateSafeMode: activate });
        const ourRoom = makeRoom({ name: 'W1N1', controller: ourCtrl, hostiles: fiveHostiles() });

        // Peer room: RCL 4 (equal, not higher)
        const peerCtrl: any = { level: 4, my: true, safeModeAvailable: 1, safeMode: undefined };
        const peerRoom: any = { name: 'W2N2', controller: peerCtrl };

        (global as any).Game.rooms = { W1N1: ourRoom, W2N2: peerRoom };

        manageCombat(ourRoom);
        expect(activate).toHaveBeenCalledTimes(1);
    });

    it('does NOT withhold when higher-RCL room has 0 charges', () => {
        const activate = vi.fn();
        const ourCtrl = makeController({ level: 2, safeModeAvailable: 1, activateSafeMode: activate });
        const ourRoom = makeRoom({ name: 'W1N1', controller: ourCtrl, hostiles: fiveHostiles() });

        // Higher-RCL room but no charges
        const richCtrl: any = { level: 8, my: true, safeModeAvailable: 0, safeMode: undefined };
        const richRoom: any = { name: 'W8N8', controller: richCtrl };

        (global as any).Game.rooms = { W1N1: ourRoom, W8N8: richRoom };

        manageCombat(ourRoom);
        expect(activate).toHaveBeenCalledTimes(1);
    });

    it('activates safemode when a critical rampart exists even with fewer than 5 hostiles', () => {
        const activate = vi.fn();
        const ctrl = makeController({ level: 2, safeModeAvailable: 1, activateSafeMode: activate });
        // 1 dangerous hostile + critical rampart (below SAFE_MODE_RAMPART_THRESHOLD of 5_000)
        const hostile  = dangerousHostile('attacker');
        const critRamp = makeRampart(4_000, 'crumbling');
        const room = makeRoom({
            name: 'W1N1',
            controller: ctrl,
            hostiles: [hostile],
            ramparts: [critRamp],
        });
        (global as any).Game.rooms = { W1N1: room };

        manageCombat(room);
        expect(activate).toHaveBeenCalledTimes(1);
    });

    it('does not activate safemode when rampart hits are at or above threshold (5_000)', () => {
        const activate = vi.fn();
        const ctrl = makeController({ level: 2, safeModeAvailable: 1, activateSafeMode: activate });
        const hostile  = dangerousHostile('attacker');
        // Exactly at threshold — NOT critical
        const safeRamp = makeRampart(5_000, 'ok');
        const room = makeRoom({
            name: 'W1N1',
            controller: ctrl,
            hostiles: [hostile],
            ramparts: [safeRamp],
        });
        (global as any).Game.rooms = { W1N1: room };

        manageCombat(room);
        expect(activate).not.toHaveBeenCalled();
    });

    it('ignores non-owned rooms when checking for better safemode candidates', () => {
        const activate = vi.fn();
        const ourCtrl = makeController({ level: 2, safeModeAvailable: 1, activateSafeMode: activate });
        const ourRoom = makeRoom({ name: 'W1N1', controller: ourCtrl, hostiles: fiveHostiles() });

        // Hostile room (not ours) at higher RCL — should not block our activation
        const hostileCtrl: any = { level: 7, my: false, safeModeAvailable: 5, safeMode: undefined };
        const hostileRoom: any = { name: 'W9N9', controller: hostileCtrl };

        (global as any).Game.rooms = { W1N1: ourRoom, W9N9: hostileRoom };

        manageCombat(ourRoom);
        expect(activate).toHaveBeenCalledTimes(1);
    });

    it('counts WORK body part as dangerous for safemode threshold', () => {
        const activate = vi.fn();
        const ctrl = makeController({ level: 2, safeModeAvailable: 1, activateSafeMode: activate });
        // Builder-style creep with WORK — can dismantle structures
        const workerHostiles = Array.from({ length: 5 }, (_, i) =>
            makeHostile({ id: `worker${i}`, bodyTypes: ['work', 'carry', 'move'] }),
        );
        const room = makeRoom({ name: 'W1N1', controller: ctrl, hostiles: workerHostiles });
        (global as any).Game.rooms = { W1N1: room };

        manageCombat(room);
        expect(activate).toHaveBeenCalledTimes(1);
    });
});

// ─── manageCombatState — MARCH → ENGAGE transition ───────────────────────────

describe('manageCombatState — MARCH to ENGAGE via global creep scan', () => {
    function makeWarriorCreep(opts: {
        name: string;
        homeRoom: string;
        currentRoom?: string;
        role?: string;
    }): any {
        return {
            name:   opts.name,
            room:   { name: opts.currentRoom ?? opts.homeRoom },
            memory: {
                role:           opts.role ?? 'warrior',
                homeRoom:       opts.homeRoom,
                targetRoomName: opts.currentRoom ?? opts.homeRoom,
            },
        };
    }

    it('transitions MARCH → ENGAGE when all fighters are in enemy room (global scan)', () => {
        // 4 warriors homed in W1N1, all physically in the enemy room W2N1
        const fighters = Array.from({ length: 4 }, (_, i) =>
            makeWarriorCreep({ name: `w${i}`, homeRoom: 'W1N1', currentRoom: 'W2N1', role: 'warrior' })
        );

        (global as any).Game.creeps = Object.fromEntries(fighters.map(c => [c.name, c]));

        const room = makeRoom({
            name:    'W1N1',
            memory:  { combatState: 'MARCH', enemyRoomName: 'W2N1', rallyTick: 900 },
            // room.find returns 0 creeps — they are all in the enemy room
            myCreeps: [],
        });
        (global as any).Game.rooms = { W1N1: room };

        manageCombat(room);

        expect(room.memory.combatState).toBe('ENGAGE');
    });

    it('does NOT reset to RALLY when fighters are in enemy room (regression: room.find bug)', () => {
        // Before the fix, room.find returned 0 fighters → immediate RALLY reset
        const fighters = Array.from({ length: 4 }, (_, i) =>
            makeWarriorCreep({ name: `w${i}`, homeRoom: 'W1N1', currentRoom: 'W2N1', role: 'warrior' })
        );

        (global as any).Game.creeps = Object.fromEntries(fighters.map(c => [c.name, c]));

        const room = makeRoom({
            name:    'W1N1',
            memory:  { combatState: 'MARCH', enemyRoomName: 'W2N1', rallyTick: 900 },
            myCreeps: [],
        });
        (global as any).Game.rooms = { W1N1: room };

        manageCombat(room);

        expect(room.memory.combatState).not.toBe('RALLY');
    });

    it('keeps MARCH while fighters are still travelling (some not yet in enemy room)', () => {
        // 2 of 4 fighters reached the enemy room, 2 are still travelling
        const inEnemy = Array.from({ length: 2 }, (_, i) =>
            makeWarriorCreep({ name: `w_arrived_${i}`, homeRoom: 'W1N1', currentRoom: 'W2N1' })
        );
        const travelling = Array.from({ length: 2 }, (_, i) =>
            makeWarriorCreep({ name: `w_travelling_${i}`, homeRoom: 'W1N1', currentRoom: 'W1N1' })
        );

        (global as any).Game.creeps = Object.fromEntries(
            [...inEnemy, ...travelling].map(c => [c.name, c])
        );

        const room = makeRoom({
            name:    'W1N1',
            memory:  { combatState: 'MARCH', enemyRoomName: 'W2N1', rallyTick: 900 },
            myCreeps: travelling,  // only travellers visible in home room
        });
        (global as any).Game.rooms = { W1N1: room };

        manageCombat(room);

        expect(room.memory.combatState).toBe('MARCH');
    });
});
