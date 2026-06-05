import { describe, it, expect, beforeEach, vi } from 'vitest';
import { manageQuads, followQuadLeader } from '../managers/quadManager';

const FIND_MY_CREEPS_CONST          = 104;
const FIND_HOSTILE_CREEPS_CONST     = 103;
const FIND_HOSTILE_STRUCTURES_CONST = 111;

beforeEach(() => {
    (global as any).Game   = { time: 1000, rooms: {}, creeps: {} };
    (global as any).Memory = {};

    (global as any).FIND_MY_CREEPS          = FIND_MY_CREEPS_CONST;
    (global as any).FIND_HOSTILE_CREEPS     = FIND_HOSTILE_CREEPS_CONST;
    (global as any).FIND_HOSTILE_STRUCTURES = FIND_HOSTILE_STRUCTURES_CONST;
    (global as any).STRUCTURE_TOWER         = 'tower';
    (global as any).STRUCTURE_SPAWN         = 'spawn';
    (global as any).ATTACK                  = 'attack';
    (global as any).RANGED_ATTACK           = 'ranged_attack';
    (global as any).HEAL                    = 'heal';
    (global as any).WORK                    = 'work';
    (global as any).CARRY                   = 'carry';
    (global as any).CLAIM                   = 'claim';
    (global as any).RESOURCE_ENERGY         = 'energy';
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRoom(opts: {
    name?: string;
    memory?: any;
    myCreeps?: any[];
    hostiles?: any[];
    hostileStructures?: any[];
} = {}): any {
    const myCreeps          = opts.myCreeps          ?? [];
    const hostiles          = opts.hostiles          ?? [];
    const hostileStructures = opts.hostileStructures ?? [];

    return {
        name:   opts.name   ?? 'W1N1',
        memory: opts.memory ?? {},
        find: vi.fn((type: number, findOpts?: { filter?: (s: any) => boolean }) => {
            let results: any[];
            if      (type === FIND_MY_CREEPS_CONST)          results = myCreeps;
            else if (type === FIND_HOSTILE_CREEPS_CONST)     results = hostiles;
            else if (type === FIND_HOSTILE_STRUCTURES_CONST) results = hostileStructures;
            else results = [];
            return findOpts?.filter ? results.filter(findOpts.filter) : results;
        }),
    };
}

function makeCreep(opts: {
    name: string;
    role: 'warrior' | 'ranger';
    homeRoom?: string;
    quadId?: string;
    isQuadLeader?: boolean;
    currentRoom?: string;
}): any {
    return {
        name: opts.name,
        room: { name: opts.currentRoom ?? opts.homeRoom ?? 'W1N1' },
        memory: {
            role:         opts.role,
            homeRoom:     opts.homeRoom      ?? 'W1N1',
            quadId:       opts.quadId,
            isQuadLeader: opts.isQuadLeader,
            targetId:     undefined,
        },
        pos:    { getRangeTo: vi.fn(() => 5) },
        moveTo: vi.fn(),
    };
}

function makeTower(opts: { id?: string; energy?: number } = {}): any {
    return {
        structureType: 'tower',
        id:    opts.id     ?? `tower_${Math.random()}`,
        store: { [(global as any).RESOURCE_ENERGY ?? 'energy']: opts.energy ?? 800 },
    };
}

function makeHostile(opts: {
    id?: string;
    bodyTypes?: string[];
    bodyHits?: number;
} = {}): any {
    return {
        id:   opts.id ?? `hostile_${Math.random()}`,
        body: (opts.bodyTypes ?? ['attack']).map(t => ({ type: t, hits: opts.bodyHits ?? 1 })),
        pos:  { getRangeTo: vi.fn(() => 10) },  // default far away → not isEngaging
    };
}

// ─── formQuads (via manageQuads when RALLY) ───────────────────────────────────

describe('formQuads via manageQuads in RALLY state', () => {
    it('forms one quad from exactly 2 warriors and 2 rangers', () => {
        const w0 = makeCreep({ name: 'w0', role: 'warrior' });
        const w1 = makeCreep({ name: 'w1', role: 'warrior' });
        const r0 = makeCreep({ name: 'r0', role: 'ranger'  });
        const r1 = makeCreep({ name: 'r1', role: 'ranger'  });

        manageQuads(makeRoom({ memory: { combatState: 'RALLY' }, myCreeps: [w0, w1, r0, r1] }));

        const ids = [w0, w1, r0, r1].map(c => c.memory.quadId);
        expect(ids.every(id => id !== undefined)).toBe(true);
        expect(new Set(ids).size).toBe(1);   // all four share one quadId
    });

    it('assigns isQuadLeader=true to exactly one member of the quad', () => {
        const w0 = makeCreep({ name: 'w0', role: 'warrior' });
        const w1 = makeCreep({ name: 'w1', role: 'warrior' });
        const r0 = makeCreep({ name: 'r0', role: 'ranger'  });
        const r1 = makeCreep({ name: 'r1', role: 'ranger'  });

        manageQuads(makeRoom({ memory: { combatState: 'RALLY' }, myCreeps: [w0, w1, r0, r1] }));

        const leaders = [w0, w1, r0, r1].filter(c => c.memory.isQuadLeader === true);
        expect(leaders).toHaveLength(1);
    });

    it('does not form a quad when fewer than 2 warriors are available', () => {
        const w0 = makeCreep({ name: 'w0', role: 'warrior' });
        const r0 = makeCreep({ name: 'r0', role: 'ranger'  });
        const r1 = makeCreep({ name: 'r1', role: 'ranger'  });

        manageQuads(makeRoom({ memory: { combatState: 'RALLY' }, myCreeps: [w0, r0, r1] }));

        expect(w0.memory.quadId).toBeUndefined();
    });

    it('does not form a quad when fewer than 2 rangers are available', () => {
        const w0 = makeCreep({ name: 'w0', role: 'warrior' });
        const w1 = makeCreep({ name: 'w1', role: 'warrior' });
        const r0 = makeCreep({ name: 'r0', role: 'ranger'  });

        manageQuads(makeRoom({ memory: { combatState: 'RALLY' }, myCreeps: [w0, w1, r0] }));

        expect(w0.memory.quadId).toBeUndefined();
    });

    it('does not re-assign creeps that already have a quadId', () => {
        const w0 = makeCreep({ name: 'w0', role: 'warrior', quadId: 'existing' });
        const w1 = makeCreep({ name: 'w1', role: 'warrior' });
        const r0 = makeCreep({ name: 'r0', role: 'ranger'  });
        const r1 = makeCreep({ name: 'r1', role: 'ranger'  });

        manageQuads(makeRoom({ memory: { combatState: 'RALLY' }, myCreeps: [w0, w1, r0, r1] }));

        expect(w0.memory.quadId).toBe('existing');
    });

    it('forms two separate quads when 4 warriors and 4 rangers are available', () => {
        const warriors = Array.from({ length: 4 }, (_, i) => makeCreep({ name: `w${i}`, role: 'warrior' }));
        const rangers  = Array.from({ length: 4 }, (_, i) => makeCreep({ name: `r${i}`, role: 'ranger'  }));

        manageQuads(makeRoom({ memory: { combatState: 'RALLY' }, myCreeps: [...warriors, ...rangers] }));

        const quadIds = [...warriors, ...rangers].map(c => c.memory.quadId).filter(Boolean);
        expect(new Set(quadIds).size).toBe(2);
    });

    it('does not form quads when combatState is not RALLY', () => {
        const w0 = makeCreep({ name: 'w0', role: 'warrior' });
        const w1 = makeCreep({ name: 'w1', role: 'warrior' });
        const r0 = makeCreep({ name: 'r0', role: 'ranger'  });
        const r1 = makeCreep({ name: 'r1', role: 'ranger'  });

        manageQuads(makeRoom({ memory: { combatState: 'MARCH' }, myCreeps: [w0, w1, r0, r1] }));

        expect(w0.memory.quadId).toBeUndefined();
    });
});

// ─── coordinateQuadTargets (via manageQuads in non-RALLY) ─────────────────────

describe('coordinateQuadTargets via manageQuads in ENGAGE', () => {
    function setupQuad(roomName = 'W1N1'): { leader: any; follower: any } {
        const leader   = makeCreep({ name: 'leader',   role: 'warrior', homeRoom: roomName, quadId: 'q0', isQuadLeader: true,  currentRoom: roomName });
        const follower = makeCreep({ name: 'follower', role: 'ranger',  homeRoom: roomName, quadId: 'q0', isQuadLeader: false, currentRoom: roomName });
        (global as any).Game.creeps['leader']   = leader;
        (global as any).Game.creeps['follower'] = follower;
        return { leader, follower };
    }

    it('targets the tower with the lowest energy first (drain to neutralise)', () => {
        const { leader, follower } = setupQuad();
        const lowTower  = makeTower({ id: 'low',  energy: 200 });
        const highTower = makeTower({ id: 'high', energy: 900 });

        (global as any).Game.rooms['W1N1'] = makeRoom({
            name: 'W1N1', hostileStructures: [highTower, lowTower],
        });
        manageQuads(makeRoom({ name: 'W1N1', memory: { combatState: 'ENGAGE' } }));

        expect(leader.memory.targetId).toBe('low');
        expect(follower.memory.targetId).toBe('low');
    });

    it('all quad members share the same targetId', () => {
        const { leader, follower } = setupQuad();
        const hostile = makeHostile({ id: 'enemy1' });

        (global as any).Game.rooms['W1N1'] = makeRoom({ name: 'W1N1', hostiles: [hostile] });
        manageQuads(makeRoom({ name: 'W1N1', memory: { combatState: 'ENGAGE' } }));

        expect(leader.memory.targetId).toBeDefined();
        expect(leader.memory.targetId).toBe(follower.memory.targetId);
    });

    it('targets an active threat (engaging enemy) over a reserver or economy creep', () => {
        const { leader } = setupQuad();
        // Ally is close so the attacker is in melee range → isEngaging = true
        const ally     = makeCreep({ name: 'ally', role: 'warrior', currentRoom: 'W1N1' });
        const attacker = makeHostile({ id: 'attacker', bodyTypes: ['attack'] });
        const economy  = makeHostile({ id: 'economy',  bodyTypes: ['work', 'carry'] });

        // attacker is range 1 from ally → melee range → isEngaging
        attacker.pos.getRangeTo = vi.fn(() => 1);
        economy.pos.getRangeTo  = vi.fn(() => 1);

        (global as any).Game.rooms['W1N1'] = makeRoom({
            name:     'W1N1',
            myCreeps: [ally],
            hostiles: [economy, attacker],
        });
        manageQuads(makeRoom({ name: 'W1N1', memory: { combatState: 'ENGAGE' } }));

        expect(leader.memory.targetId).toBe('attacker');
    });

    it('targets a reserver (CLAIM parts) over economy creeps when no active threat', () => {
        const { leader } = setupQuad();
        const reserver = makeHostile({ id: 'reserver', bodyTypes: ['claim', 'move'] });
        const economy  = makeHostile({ id: 'economy',  bodyTypes: ['work', 'carry'] });

        // Far away so neither is engaging
        reserver.pos.getRangeTo = vi.fn(() => 20);
        economy.pos.getRangeTo  = vi.fn(() => 20);

        (global as any).Game.rooms['W1N1'] = makeRoom({
            name:     'W1N1',
            hostiles: [economy, reserver],
        });
        manageQuads(makeRoom({ name: 'W1N1', memory: { combatState: 'ENGAGE' } }));

        expect(leader.memory.targetId).toBe('reserver');
    });

    it('targets economy creeps (WORK/CARRY) before passive combat creeps', () => {
        const { leader } = setupQuad();
        const passive = makeHostile({ id: 'passive', bodyTypes: ['attack', 'move'] });
        const economy = makeHostile({ id: 'economy', bodyTypes: ['work', 'carry'] });

        // Both far — neither is engaging
        passive.pos.getRangeTo = vi.fn(() => 20);
        economy.pos.getRangeTo = vi.fn(() => 20);

        (global as any).Game.rooms['W1N1'] = makeRoom({
            name: 'W1N1', hostiles: [passive, economy],
        });
        manageQuads(makeRoom({ name: 'W1N1', memory: { combatState: 'ENGAGE' } }));

        expect(leader.memory.targetId).toBe('economy');
    });

    it('uses the leader\'s current room for targeting, not the home room', () => {
        // Leader is physically in the enemy room W2N2 during ENGAGE
        const leader   = makeCreep({ name: 'leader',   role: 'warrior', homeRoom: 'W1N1', quadId: 'q0', isQuadLeader: true,  currentRoom: 'W2N2' });
        const follower = makeCreep({ name: 'follower', role: 'ranger',  homeRoom: 'W1N1', quadId: 'q0', isQuadLeader: false, currentRoom: 'W2N2' });
        (global as any).Game.creeps['leader']   = leader;
        (global as any).Game.creeps['follower'] = follower;

        const hostile = makeHostile({ id: 'target_in_enemy_room' });
        (global as any).Game.rooms['W2N2'] = makeRoom({ name: 'W2N2', hostiles: [hostile] });

        manageQuads(makeRoom({ name: 'W1N1', memory: { combatState: 'ENGAGE' } }));

        expect(leader.memory.targetId).toBe('target_in_enemy_room');
    });
});

// ─── followQuadLeader ─────────────────────────────────────────────────────────

describe('followQuadLeader', () => {
    it('returns false when the creep has no quadId', () => {
        const creep = makeCreep({ name: 'w0', role: 'warrior' });
        expect(followQuadLeader(creep)).toBe(false);
    });

    it('returns false when the creep is the quad leader itself', () => {
        const leader = makeCreep({ name: 'leader', role: 'warrior', quadId: 'q0', isQuadLeader: true });
        (global as any).Game.creeps['leader'] = leader;
        expect(followQuadLeader(leader)).toBe(false);
    });

    it('returns false when no leader exists in Game.creeps for the quadId', () => {
        const follower = makeCreep({ name: 'follower', role: 'warrior', quadId: 'q0', isQuadLeader: false });
        // No leader registered in Game.creeps
        expect(followQuadLeader(follower)).toBe(false);
    });

    it('returns false when the leader is in a different room', () => {
        const leader   = makeCreep({ name: 'leader',   role: 'warrior', quadId: 'q0', isQuadLeader: true,  currentRoom: 'W2N2' });
        const follower = makeCreep({ name: 'follower', role: 'warrior', quadId: 'q0', isQuadLeader: false, currentRoom: 'W1N1' });
        (global as any).Game.creeps['leader'] = leader;

        expect(followQuadLeader(follower)).toBe(false);
        expect(follower.moveTo).not.toHaveBeenCalled();
    });

    it('moves toward the leader and returns true when range > FORM_UP_RANGE (2)', () => {
        const leader   = makeCreep({ name: 'leader',   role: 'warrior', quadId: 'q0', isQuadLeader: true,  currentRoom: 'W1N1' });
        const follower = makeCreep({ name: 'follower', role: 'warrior', quadId: 'q0', isQuadLeader: false, currentRoom: 'W1N1' });

        follower.pos.getRangeTo = vi.fn(() => 5);   // > FORM_UP_RANGE
        (global as any).Game.creeps['leader'] = leader;

        expect(followQuadLeader(follower)).toBe(true);
        expect(follower.moveTo).toHaveBeenCalledWith(leader, expect.objectContaining({ reusePath: 2 }));
    });

    it('does not move and returns false when exactly at FORM_UP_RANGE (2)', () => {
        const leader   = makeCreep({ name: 'leader',   role: 'warrior', quadId: 'q0', isQuadLeader: true,  currentRoom: 'W1N1' });
        const follower = makeCreep({ name: 'follower', role: 'warrior', quadId: 'q0', isQuadLeader: false, currentRoom: 'W1N1' });

        follower.pos.getRangeTo = vi.fn(() => 2);   // exactly at FORM_UP_RANGE — no move
        (global as any).Game.creeps['leader'] = leader;

        expect(followQuadLeader(follower)).toBe(false);
        expect(follower.moveTo).not.toHaveBeenCalled();
    });

    it('does not move and returns false when inside FORM_UP_RANGE (range 1)', () => {
        const leader   = makeCreep({ name: 'leader',   role: 'warrior', quadId: 'q0', isQuadLeader: true,  currentRoom: 'W1N1' });
        const follower = makeCreep({ name: 'follower', role: 'warrior', quadId: 'q0', isQuadLeader: false, currentRoom: 'W1N1' });

        follower.pos.getRangeTo = vi.fn(() => 1);
        (global as any).Game.creeps['leader'] = leader;

        expect(followQuadLeader(follower)).toBe(false);
        expect(follower.moveTo).not.toHaveBeenCalled();
    });
});
