import { describe, it, expect, beforeEach } from 'vitest';
import { updatePhase } from '../managers/strategyManager';
import { makeRoom, makeController } from './helpers';

const TICK = 2000;

beforeEach(() => {
    (global as any).Game = { time: TICK, rooms: {}, creeps: {} };
    (global as any).Memory = { roomIntel: {}, roomThreats: {} };
});

// Helper: mark a room as mine in Game.rooms
function addOwnedRoom(name: string) {
    (global as any).Game.rooms[name] = { name, controller: { my: true } };
}

// Helper: write room intel
function writeIntel(
    name: string,
    opts: { strength?: number; enemySpawns?: number; enemyTowers?: number; controllerOwned?: boolean; scannedAt?: number },
) {
    (global as any).Memory.roomIntel[name] = {
        strength:       opts.strength        ?? 5,
        enemySpawns:    opts.enemySpawns     ?? 1,
        enemyTowers:    opts.enemyTowers     ?? 0,
        controllerOwned: opts.controllerOwned ?? true,
        scannedAt:      opts.scannedAt       ?? TICK - 10,
        enemyCreeps:    opts.strength        ?? 5,
        hasController:  true,
        sourceCount:    2,
    };
}

// ─── ECONOMY phase ───────────────────────────────────────────────────────────

describe('updatePhase — ECONOMY', () => {
    it('stays in ECONOMY when fewer creeps than threshold', () => {
        addOwnedRoom('W1N1');
        const room = makeRoom({
            name: 'W1N1',
            memory: { phase: 'ECONOMY', phaseTick: undefined },
            myCreeps: [],
        });
        updatePhase(room);
        expect(room.memory.phase).toBe('ECONOMY');
    });

    it('transitions to ASSESS when creep count >= threshold and no weak target', () => {
        addOwnedRoom('W1N1');
        const creeps = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, memory: { role: 'hauler' } }));
        const room = makeRoom({
            name: 'W1N1',
            memory: { phase: 'ECONOMY', phaseTick: TICK - 1 },
            myCreeps: creeps,
        });
        // No intel → no opportunistic target
        updatePhase(room);
        expect(room.memory.phase).toBe('ASSESS');
    });

    it('transitions directly to RUSH on opportunistic weak target (skip ASSESS)', () => {
        addOwnedRoom('W1N1');
        writeIntel('W2N1', { strength: 5, enemySpawns: 1 }); // very weak (< 15 threshold)
        const creeps = Array.from({ length: 5 }, () => ({ memory: { role: 'hauler' } }));
        const room = makeRoom({
            name: 'W1N1',
            memory: { phase: 'ECONOMY', phaseTick: TICK - 1 },
            myCreeps: creeps,
        });
        updatePhase(room);
        expect(room.memory.phase).toBe('RUSH');
        expect(room.memory.enemyRoomName).toBe('W2N1');
        expect(room.memory.combatState).toBe('RALLY');
    });

    it('does not attack if cooldown is active', () => {
        addOwnedRoom('W1N1');
        writeIntel('W2N1', { strength: 5 });
        const creeps = Array.from({ length: 5 }, () => ({ memory: { role: 'hauler' } }));
        const room = makeRoom({
            name: 'W1N1',
            memory: { phase: 'ECONOMY', phaseTick: TICK + 50 }, // cooldown not done
            myCreeps: creeps,
        });
        updatePhase(room);
        expect(room.memory.phase).toBe('ECONOMY'); // held by cooldown
    });

    it('does not attack an owned room', () => {
        addOwnedRoom('W1N1');
        addOwnedRoom('W2N1'); // this room is ours — don't attack it
        writeIntel('W2N1', { strength: 5 });
        const creeps = Array.from({ length: 5 }, () => ({ memory: { role: 'hauler' } }));
        const room = makeRoom({
            name: 'W1N1',
            memory: { phase: 'ECONOMY', phaseTick: TICK - 1 },
            myCreeps: creeps,
        });
        updatePhase(room);
        expect(room.memory.enemyRoomName).not.toBe('W2N1');
    });
});

// ─── ASSESS phase ────────────────────────────────────────────────────────────

describe('updatePhase — ASSESS', () => {
    it('stays in ASSESS while waiting for scout', () => {
        addOwnedRoom('W1N1');
        const room = makeRoom({
            name: 'W1N1',
            memory: { phase: 'ASSESS', scoutTick: undefined },
        });
        updatePhase(room);
        expect(room.memory.phase).toBe('ASSESS');
    });

    it('transitions to RUSH when scout returns a weak target', () => {
        addOwnedRoom('W1N1');
        writeIntel('W3N3', { strength: 10, enemySpawns: 1 }); // below RUSH_STRENGTH_THRESHOLD=30
        const room = makeRoom({
            name: 'W1N1',
            memory: { phase: 'ASSESS', scoutTick: TICK - 5 },
        });
        updatePhase(room);
        expect(room.memory.phase).toBe('RUSH');
        expect(room.memory.enemyRoomName).toBe('W3N3');
    });

    it('transitions to DEFEND when scout finds only strong enemies', () => {
        addOwnedRoom('W1N1');
        writeIntel('W3N3', { strength: 50, enemySpawns: 2, enemyTowers: 3 }); // above threshold
        const room = makeRoom({
            name: 'W1N1',
            memory: { phase: 'ASSESS', scoutTick: TICK - 5 },
        });
        updatePhase(room);
        expect(room.memory.phase).toBe('DEFEND');
        expect(room.memory.enemyRoomName).toBe('W3N3');
    });

    it('returns to ECONOMY with cooldown when no viable targets found', () => {
        addOwnedRoom('W1N1');
        // No intel at all
        const room = makeRoom({
            name: 'W1N1',
            memory: { phase: 'ASSESS', scoutTick: TICK - 5 },
        });
        updatePhase(room);
        expect(room.memory.phase).toBe('ECONOMY');
        expect(room.memory.phaseTick).toBeGreaterThan(TICK); // cooldown set
    });

    it('ignores stale intel (> 500 ticks old)', () => {
        addOwnedRoom('W1N1');
        writeIntel('W3N3', { strength: 5, scannedAt: TICK - 600 }); // stale
        const room = makeRoom({
            name: 'W1N1',
            memory: { phase: 'ASSESS', scoutTick: TICK - 5 },
        });
        updatePhase(room);
        // No valid target → returns to ECONOMY
        expect(room.memory.phase).toBe('ECONOMY');
    });
});

// ─── RUSH phase ──────────────────────────────────────────────────────────────

describe('updatePhase — RUSH', () => {
    it('stays in RUSH while combat units exist and target persists', () => {
        addOwnedRoom('W1N1');
        writeIntel('W2N2', { strength: 10 }); // still has strength
        const warriors = [{ memory: { role: 'warrior', homeRoom: 'W1N1' } }];
        const room = makeRoom({
            name: 'W1N1',
            memory: {
                phase: 'RUSH',
                phaseTick: TICK - 100,
                enemyRoomName: 'W2N2',
                enemyStrength: 10,
                combatState: 'MARCH',
            },
            myCreeps: warriors,
        });
        updatePhase(room);
        expect(room.memory.phase).toBe('RUSH');
    });

    it('chains attack when target is cleared', () => {
        addOwnedRoom('W1N1');
        // Target cleared: strength = 0, fresh intel
        (global as any).Memory.roomIntel['W2N2'] = {
            strength: 0, scannedAt: TICK - 5, enemyCreeps: 0,
            enemySpawns: 0, enemyTowers: 0, controllerOwned: false, hasController: true, sourceCount: 1,
        };
        const warriors = [{ memory: { role: 'warrior', homeRoom: 'W1N1' } }];
        const room = makeRoom({
            name: 'W1N1',
            memory: { phase: 'RUSH', phaseTick: TICK - 100, enemyRoomName: 'W2N2', combatState: 'ENGAGE' },
            myCreeps: warriors,
        });
        updatePhase(room);
        // Should chain → ASSESS or another RUSH
        expect(['RUSH', 'ASSESS']).toContain(room.memory.phase);
        expect(room.memory.combatState).toBe('RALLY'); // always resets combat state
    });

    it('chains after timeout (2000 ticks)', () => {
        addOwnedRoom('W1N1');
        writeIntel('W2N2', { strength: 10 });
        const warriors = [{ memory: { role: 'warrior', homeRoom: 'W1N1' } }];
        const room = makeRoom({
            name: 'W1N1',
            memory: {
                phase: 'RUSH',
                phaseTick: TICK - 2001, // timed out
                enemyRoomName: 'W2N2',
                combatState: 'ENGAGE',
            },
            myCreeps: warriors,
        });
        updatePhase(room);
        expect(['RUSH', 'ASSESS']).toContain(room.memory.phase);
    });

    it('resets to ECONOMY when all creeps are dead', () => {
        const room = makeRoom({
            name: 'W1N1',
            memory: { phase: 'RUSH', phaseTick: TICK - 100, enemyRoomName: 'W2N2' },
            myCreeps: [],
        });
        updatePhase(room);
        expect(room.memory.phase).toBe('ECONOMY');
    });

    it('chains when no combat units remain (but room still has other creeps)', () => {
        addOwnedRoom('W1N1');
        writeIntel('W2N2', { strength: 10 });
        const haulers = [{ memory: { role: 'hauler', homeRoom: 'W1N1' } }];
        const room = makeRoom({
            name: 'W1N1',
            memory: { phase: 'RUSH', phaseTick: TICK - 100, enemyRoomName: 'W2N2', combatState: 'MARCH' },
            myCreeps: haulers, // no warriors/rangers
        });
        updatePhase(room);
        expect(['RUSH', 'ASSESS']).toContain(room.memory.phase);
    });
});

// ─── DEFEND phase ────────────────────────────────────────────────────────────

describe('updatePhase — DEFEND', () => {
    it('stays in DEFEND while hostiles present', () => {
        addOwnedRoom('W1N1');
        writeIntel('W2N2', { strength: 50 });
        const hostile = [{ id: 'e1', body: [{ type: 'attack' }] }];
        const room = makeRoom({
            name: 'W1N1',
            memory: { phase: 'DEFEND', enemyRoomName: 'W2N2' },
            myCreeps: [{ memory: { role: 'warrior' } }],
            hostileCreeps: hostile,
        });
        updatePhase(room);
        expect(room.memory.phase).toBe('DEFEND');
    });

    it('chains after enemies clear', () => {
        addOwnedRoom('W1N1');
        (global as any).Memory.roomIntel['W2N2'] = {
            strength: 0, scannedAt: TICK - 5, enemyCreeps: 0,
            enemySpawns: 0, enemyTowers: 0, controllerOwned: false, hasController: true, sourceCount: 1,
        };
        const room = makeRoom({
            name: 'W1N1',
            memory: { phase: 'DEFEND', enemyRoomName: 'W2N2' },
            myCreeps: [{ memory: { role: 'warrior' } }],
            hostileCreeps: [],
        });
        updatePhase(room);
        expect(['RUSH', 'ASSESS']).toContain(room.memory.phase);
    });

    it('resets to ECONOMY when all creeps are dead', () => {
        const room = makeRoom({
            name: 'W1N1',
            memory: { phase: 'DEFEND', enemyRoomName: 'W2N2' },
            myCreeps: [],
            hostileCreeps: [],
        });
        updatePhase(room);
        expect(room.memory.phase).toBe('ECONOMY');
    });
});

// ─── Safe mode override ───────────────────────────────────────────────────────

describe('updatePhase — safe mode', () => {
    it('forces ECONOMY when safe mode is active and currently in another phase', () => {
        const ctrl = makeController({ safeMode: 5000 });
        const room = makeRoom({
            name: 'W1N1',
            controller: ctrl,
            memory: { phase: 'RUSH', enemyRoomName: 'W2N2' },
        });
        updatePhase(room);
        expect(room.memory.phase).toBe('ECONOMY');
    });

    it('stays in ECONOMY (and does not double-transition) while safe mode is active', () => {
        const ctrl = makeController({ safeMode: 5000 });
        const room = makeRoom({
            name: 'W1N1',
            controller: ctrl,
            memory: { phase: 'ECONOMY' },
        });
        updatePhase(room);
        expect(room.memory.phase).toBe('ECONOMY');
    });
});
