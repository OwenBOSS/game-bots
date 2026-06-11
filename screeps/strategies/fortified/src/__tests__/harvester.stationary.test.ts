import { vi } from 'vitest';
import { runHarvester }    from '../roles/harvester';
import { HARVESTER_BODIES } from '../managers/spawnManager';
import { makeCreep, makeSource, makeExtension } from './helpers';

describe('stationary harvester — body constraints', () => {
    it('stationaryHarvester_bodyHasNoMove — no MOVE parts in any harvester body tier', () => {
        for (const body of HARVESTER_BODIES) {
            expect(body.filter(p => p === (global as any).MOVE).length).toBe(0);
        }
    });

    it('stationaryHarvester_bodyHasOneCarry — exactly 1 CARRY part in every harvester body tier', () => {
        for (const body of HARVESTER_BODIES) {
            expect(body.filter(p => p === (global as any).CARRY).length).toBe(1);
        }
    });
});

describe('stationary harvester — role behavior', () => {
    beforeEach(() => {
        (global as any).Game.getObjectById = vi.fn(() => null);
    });

    it('stationaryHarvester_doesNothingWhenNotAtSource — no actions if atSource is false', () => {
        const creep = makeCreep({
            role: 'harvester',
            memory: { role: 'harvester', atSource: false, sourceId: 'source1' },
        });

        runHarvester(creep as any);

        expect(creep.harvest).not.toHaveBeenCalled();
        expect(creep.moveTo).not.toHaveBeenCalled();
        expect(creep.transfer).not.toHaveBeenCalled();
    });

    it('stationaryHarvester_doesNothingWhenNotAtSource — also works when atSource is absent', () => {
        const creep = makeCreep({
            role: 'harvester',
            memory: { role: 'harvester', sourceId: 'source1' },
        });

        runHarvester(creep as any);

        expect(creep.harvest).not.toHaveBeenCalled();
    });

    it('stationaryHarvester_minesWhenAdjacentToSource — harvest called when atSource=true and range 1', () => {
        const source = makeSource({ id: 'source1' });
        (global as any).Game.getObjectById = vi.fn(() => source);

        const creep = makeCreep({
            role: 'harvester',
            freeCap: 50,
            memory: { role: 'harvester', atSource: true, sourceId: 'source1' },
        });
        creep.pos.getRangeTo = () => 1;
        creep.pos.findInRange = () => [];

        runHarvester(creep as any);

        expect(creep.harvest).toHaveBeenCalledWith(source);
    });

    it('stationaryHarvester_doesNotIssueMoveOrder — move never called regardless of state', () => {
        const source = makeSource({ id: 'source1' });
        (global as any).Game.getObjectById = vi.fn(() => source);

        const creep = makeCreep({
            role: 'harvester',
            freeCap: 50,
            memory: { role: 'harvester', atSource: true, sourceId: 'source1' },
        });
        creep.pos.getRangeTo = () => 1;
        creep.pos.findInRange = () => [];

        runHarvester(creep as any);

        expect(creep.moveTo).not.toHaveBeenCalled();
        expect(creep.move).not.toHaveBeenCalled();
    });

    it('stationaryHarvester_transfersToAdjacentExtensionWhenFull — no moveTo, calls transfer', () => {
        const source = makeSource({ id: 'source1' });
        const ext    = makeExtension(50);
        (global as any).Game.getObjectById = vi.fn(() => source);

        const creep = makeCreep({
            role: 'harvester',
            energy: 50, freeCap: 0,
            memory: { role: 'harvester', atSource: true, sourceId: 'source1' },
        });
        creep.pos.getRangeTo = () => 1;
        creep.store.getFreeCapacity = () => 0;
        creep.pos.findInRange = () => [ext];

        runHarvester(creep as any);

        expect(creep.transfer).toHaveBeenCalledWith(ext, (global as any).RESOURCE_ENERGY);
        expect(creep.moveTo).not.toHaveBeenCalled();
    });
});
