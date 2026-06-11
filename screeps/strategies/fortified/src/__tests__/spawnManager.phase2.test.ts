import { manageSpawns } from '../managers/spawnManager';
import { makeRoom, makeSpawnStruct, makeSource } from './helpers';

describe('spawnManager — Phase 2 (RC ≥ 2)', () => {
    beforeEach(() => {
        (global as any).Game.creeps = {};
        (global as any).Game.time   = 1000;
    });

    it('spawnManager_spawnsHarvesterBeforeHauler — with 1 bootstrap alive, spawns harvester next', () => {
        const spawn  = makeSpawnStruct();
        const source = makeSource({ id: 's1' });
        const room   = makeRoom({ rcl: 2, energyAvailable: 600, sources: [source], mySpawns: [spawn] });
        spawn.room   = room;

        (global as any).Game.creeps = {
            bootstrap_1: { name: 'bootstrap_1', memory: { role: 'bootstrap', homeRoom: 'W1N1' } },
        };

        manageSpawns(room as any);

        expect(spawn.spawnCreep).toHaveBeenCalledWith(
            expect.any(Array),
            expect.stringContaining('harvester'),
            expect.objectContaining({ memory: expect.objectContaining({ role: 'harvester' }) }),
        );
    });

    it('spawnManager_pairsHaulerToHarvester — spawned hauler memory contains towTarget = harvester name', () => {
        const spawn      = makeSpawnStruct();
        const source     = makeSource({ id: 's1' });
        const room       = makeRoom({ rcl: 2, energyAvailable: 400, sources: [source], mySpawns: [spawn] });
        spawn.room       = room;

        (global as any).Game.creeps = {
            bootstrap_1:  { name: 'bootstrap_1',  memory: { role: 'bootstrap',  homeRoom: 'W1N1' } },
            harvester_1:  { name: 'harvester_1',  memory: { role: 'harvester',  homeRoom: 'W1N1', sourceId: 's1' } },
        };

        manageSpawns(room as any);

        const call = (spawn.spawnCreep as any).mock.calls[0];
        expect(call?.[2]?.memory?.role).toBe('hauler');
        expect(call?.[2]?.memory?.towTarget).toBe('harvester_1');
    });

    it('spawnManager_respectsRCRushPriority — spawns upgrader when harvesters and haulers are covered', () => {
        const spawn      = makeSpawnStruct();
        const source     = makeSource({ id: 's1' });
        const room       = makeRoom({ rcl: 2, energyAvailable: 400, sources: [source], mySpawns: [spawn] });
        spawn.room       = room;

        (global as any).Game.creeps = {
            bootstrap_1:  { name: 'bootstrap_1',  memory: { role: 'bootstrap',  homeRoom: 'W1N1' } },
            harvester_1:  { name: 'harvester_1',  memory: { role: 'harvester',  homeRoom: 'W1N1', sourceId: 's1' } },
            hauler_1:     { name: 'hauler_1',     memory: { role: 'hauler',     homeRoom: 'W1N1', towTarget: 'harvester_1' } },
        };

        manageSpawns(room as any);

        const call = (spawn.spawnCreep as any).mock.calls[0];
        expect(call?.[2]?.memory?.role).toBe('upgrader');
    });

    it('spawnManager_spawnsBootstrapFirst — if no bootstrap alive at RC2, spawns bootstrap', () => {
        const spawn  = makeSpawnStruct();
        const room   = makeRoom({ rcl: 2, energyAvailable: 300, mySpawns: [spawn] });
        spawn.room   = room;
        // No creeps at all
        (global as any).Game.creeps = {};

        manageSpawns(room as any);

        const call = (spawn.spawnCreep as any).mock.calls[0];
        expect(call?.[2]?.memory?.role).toBe('bootstrap');
    });
});
