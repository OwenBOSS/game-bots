import { manageSpawns } from '../managers/spawnManager';
import { makeRoom, makeSpawnStruct } from './helpers';

describe('spawnManager — Phase 1 bootstrap', () => {
    beforeEach(() => {
        (global as any).Game.creeps = {};
        (global as any).Game.time   = 1000;
    });

    it('spawnManager_spawnsBootstrapUntilRC2 — RC1 with no creeps spawns bootstrap role', () => {
        const spawn = makeSpawnStruct();
        const room  = makeRoom({ rcl: 1, energyAvailable: 300, mySpawns: [spawn] });
        spawn.room  = room;

        manageSpawns(room as any);

        expect(spawn.spawnCreep).toHaveBeenCalledWith(
            expect.arrayContaining([(global as any).MOVE]),
            expect.stringContaining('bootstrap'),
            expect.objectContaining({ memory: expect.objectContaining({ role: 'bootstrap' }) }),
        );
    });

    it('spawnManager_spawnsBootstrapUntilRC2 — body is exactly [MOVE, WORK, CARRY]', () => {
        const spawn = makeSpawnStruct();
        const room  = makeRoom({ rcl: 1, energyAvailable: 300, mySpawns: [spawn] });
        spawn.room  = room;

        manageSpawns(room as any);

        const body = (spawn.spawnCreep as any).mock.calls[0]?.[0] as string[] | undefined;
        expect(body).toEqual([
            (global as any).MOVE,
            (global as any).WORK,
            (global as any).CARRY,
        ]);
    });

    it('spawnManager_prioritizesRC2Rush — spawns upgrader when 2 bootstraps already exist', () => {
        const spawn = makeSpawnStruct();
        const room  = makeRoom({ rcl: 1, energyAvailable: 300, mySpawns: [spawn] });
        spawn.room  = room;

        (global as any).Game.creeps = {
            bootstrap_1: { name: 'bootstrap_1', memory: { role: 'bootstrap', homeRoom: 'W1N1' } },
            bootstrap_2: { name: 'bootstrap_2', memory: { role: 'bootstrap', homeRoom: 'W1N1' } },
        };

        manageSpawns(room as any);

        expect(spawn.spawnCreep).toHaveBeenCalledWith(
            expect.any(Array),
            expect.stringContaining('upgrader'),
            expect.objectContaining({ memory: expect.objectContaining({ role: 'upgrader' }) }),
        );
    });
});
