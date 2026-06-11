import { runBootstrap } from '../roles/bootstrap';
import { makeCreep, makeRoom, makeSource, makeExtension } from './helpers';

describe('bootstrap role', () => {
    beforeEach(() => {
        (global as any).Game.creeps = {};
    });

    it('bootstrapCreep_targetsNearestSource — moves toward the closer of two sources', () => {
        const farSource  = makeSource({ id: 'far',  x: 40, y: 25 });
        const nearSource = makeSource({ id: 'near', x: 27, y: 25 });
        nearSource.pos.getRangeTo = () => 2;
        farSource.pos.getRangeTo  = () => 15;

        const creep = makeCreep({ memory: { role: 'bootstrap', bootstrapPhase: 'seek' } });
        creep.pos.findClosestByRange = () => nearSource;
        creep.pos.getRangeTo = (t: any) => (t === nearSource ? 2 : 15);

        runBootstrap(creep as any);

        expect(creep.moveTo).toHaveBeenCalledWith(nearSource, expect.any(Object));
    });

    it('bootstrapCreep_buildsExtensionWithinOneRange — places extension CS at range ≤ 1 from self', () => {
        const source = makeSource({ x: 25, y: 24 });
        source.pos.getRangeTo = (_p: any) => 2;  // ext at range 2 from source — allowed

        const room = makeRoom({ sources: [source] });
        room.getTerrain = () => ({ get: () => 0 });
        room.find = (type: number, opts?: any) => {
            if (type === (global as any).FIND_MY_STRUCTURES)      return [];
            if (type === (global as any).FIND_CONSTRUCTION_SITES) return [];
            if (type === (global as any).FIND_SOURCES)            return [source];
            return [];
        };

        const creep = makeCreep({
            memory: { role: 'bootstrap', bootstrapPhase: 'build' },
            room,
        });
        creep.pos.x = 25;
        creep.pos.y = 25;
        creep.pos.getRangeTo = (_t: any) => 1;
        creep.pos.findInRange = (_type: number, _range: number, _opts?: any) => [];
        creep.pos.findClosestByRange = (_type: number) => source;

        runBootstrap(creep as any);

        expect(room.createConstructionSite).toHaveBeenCalledWith(
            expect.any(Number),
            expect.any(Number),
            (global as any).STRUCTURE_EXTENSION,
        );
        // The placed site must be at Chebyshev distance ≤ 1 from creep (25,25).
        const call = (room.createConstructionSite as any).mock.calls.find(
            (c: any[]) => c[2] === (global as any).STRUCTURE_EXTENSION,
        );
        if (call) {
            const [cx, cy] = call;
            const chebyshev = Math.max(Math.abs(cx - 25), Math.abs(cy - 25));
            expect(chebyshev).toBeLessThanOrEqual(1);
        }
    });

    it('bootstrapCreep_buildsRampartOnOwnTile — places rampart CS at creep position', () => {
        const source = makeSource({ x: 25, y: 24 });
        const room = makeRoom({ sources: [source] });
        room.getTerrain = () => ({ get: () => 0 });
        room.find = (type: number, opts?: any) => {
            if (type === (global as any).FIND_MY_STRUCTURES)      return [];
            if (type === (global as any).FIND_CONSTRUCTION_SITES) return [];
            if (type === (global as any).FIND_SOURCES)            return [source];
            return [];
        };

        const creep = makeCreep({
            memory: { role: 'bootstrap', bootstrapPhase: 'build' },
            room,
        });
        creep.pos.x = 25;
        creep.pos.y = 25;
        creep.pos.getRangeTo = (_t: any) => 1;
        creep.pos.findInRange = () => [];
        creep.pos.findClosestByRange = () => source;

        runBootstrap(creep as any);

        expect(room.createConstructionSite).toHaveBeenCalledWith(
            25, 25, (global as any).STRUCTURE_RAMPART,
        );
    });

    it('bootstrapCreep_depositsToNearbyExtension — calls transfer, not moveTo, when extension is adjacent', () => {
        const source = makeSource({ x: 25, y: 24 });
        const ext    = makeExtension(50);

        const room = makeRoom({ sources: [source] });
        const creep = makeCreep({
            energy: 50, freeCap: 0,
            memory: { role: 'bootstrap', bootstrapPhase: 'mine' },
            room,
        });
        creep.pos.findClosestByRange = (_type: number) => source;
        creep.pos.getRangeTo = (_t: any) => 1;
        creep.pos.findInRange = (_type: number, _range: number, _opts?: any) => [ext];
        creep.store.getFreeCapacity = () => 0;

        runBootstrap(creep as any);

        expect(creep.transfer).toHaveBeenCalledWith(ext, (global as any).RESOURCE_ENERGY);
    });

    it('bootstrapCreep_doesNotMoveWhenAdjacentToSourceAndExtension — no moveTo in mine state', () => {
        const source = makeSource({ x: 25, y: 24 });
        const ext    = makeExtension(50);

        const creep = makeCreep({
            energy: 50, freeCap: 0,
            memory: { role: 'bootstrap', bootstrapPhase: 'mine' },
        });
        creep.pos.findClosestByRange = () => source;
        creep.pos.getRangeTo = () => 1;
        creep.pos.findInRange = () => [ext];
        creep.store.getFreeCapacity = () => 0;

        runBootstrap(creep as any);

        expect(creep.moveTo).not.toHaveBeenCalled();
    });
});
