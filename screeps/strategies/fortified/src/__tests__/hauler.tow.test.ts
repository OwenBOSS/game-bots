import { vi } from 'vitest';
import { runHauler } from '../roles/hauler';
import { makeCreep, makeSource } from './helpers';

describe('hauler tow mechanic', () => {
    beforeEach(() => {
        (global as any).Game.creeps = {};
        (global as any).Game.getObjectById = vi.fn(() => null);
    });

    it('hauler_pullsHarvesterToSource — calls pull + harvester.move when adjacent and harvester not at source', () => {
        const source    = makeSource({ id: 's1' });
        const harvester = makeCreep({
            name: 'harvester_1',
            role: 'harvester',
            memory: { role: 'harvester', sourceId: 's1', atSource: false },
        });
        harvester.pos.getRangeTo = (t: any) => (t === source ? 5 : 1);

        const hauler = makeCreep({
            name: 'hauler_1',
            role: 'hauler',
            memory: { role: 'hauler', haulerPhase: 'tow', towTarget: 'harvester_1' },
        });
        hauler.pos.getRangeTo = (t: any) => (t === harvester ? 1 : 5);

        (global as any).Game.creeps = { harvester_1: harvester };
        (global as any).Game.getObjectById = vi.fn((id: string) => id === 's1' ? source : null);

        runHauler(hauler as any);

        expect(hauler.pull).toHaveBeenCalledWith(harvester);
        expect(harvester.move).toHaveBeenCalledWith(hauler);
    });

    it('hauler_movesTowardHarvesterBeforePulling — moveTo harvester if not adjacent', () => {
        const source    = makeSource({ id: 's1' });
        const harvester = makeCreep({
            name: 'harvester_1',
            role: 'harvester',
            memory: { role: 'harvester', sourceId: 's1', atSource: false },
        });

        const hauler = makeCreep({
            name: 'hauler_1',
            role: 'hauler',
            memory: { role: 'hauler', haulerPhase: 'tow', towTarget: 'harvester_1' },
        });
        hauler.pos.getRangeTo = (_t: any) => 5;  // far from harvester

        (global as any).Game.creeps = { harvester_1: harvester };
        (global as any).Game.getObjectById = vi.fn((id: string) => id === 's1' ? source : null);

        runHauler(hauler as any);

        expect(hauler.moveTo).toHaveBeenCalledWith(harvester, expect.any(Object));
        expect(hauler.pull).not.toHaveBeenCalled();
    });

    it('hauler_stopsTowinOnceHarvesterAtSource — transitions to collect when harvester.atSource=true', () => {
        const harvester = makeCreep({
            name: 'harvester_1',
            role: 'harvester',
            memory: { role: 'harvester', sourceId: 's1', atSource: true },
        });

        const hauler = makeCreep({
            name: 'hauler_1',
            role: 'hauler',
            memory: { role: 'hauler', haulerPhase: 'tow', towTarget: 'harvester_1' },
        });

        (global as any).Game.creeps = { harvester_1: harvester };

        runHauler(hauler as any);

        expect((hauler.memory as any).haulerPhase).toBe('collect');
        expect(hauler.pull).not.toHaveBeenCalled();
    });

    it('hauler_switchesToCarryModeAfterDelivery — haulerPhase becomes collect after tow completes', () => {
        const source    = makeSource({ id: 's1' });
        const harvester = makeCreep({
            name: 'harvester_1',
            role: 'harvester',
            memory: { role: 'harvester', sourceId: 's1', atSource: false },
        });
        // Harvester is already range 1 from source (arrived this tick).
        harvester.pos.getRangeTo = (t: any) => (t === source ? 1 : 0);

        const hauler = makeCreep({
            name: 'hauler_1',
            role: 'hauler',
            memory: { role: 'hauler', haulerPhase: 'tow', towTarget: 'harvester_1' },
        });
        hauler.pos.getRangeTo = (_t: any) => 1;

        (global as any).Game.creeps = { harvester_1: harvester };
        (global as any).Game.getObjectById = vi.fn((id: string) => id === 's1' ? source : null);

        runHauler(hauler as any);

        expect((hauler.memory as any).haulerPhase).toBe('collect');
        expect(harvester.memory.atSource).toBe(true);
    });

    it('hauler_doesNotPullIfNoAssignedHarvester — no towTarget → proceeds as normal hauler', () => {
        const hauler = makeCreep({
            name: 'hauler_1',
            role: 'hauler',
            memory: { role: 'hauler', haulerPhase: 'tow' },  // no towTarget
        });

        runHauler(hauler as any);

        expect(hauler.pull).not.toHaveBeenCalled();
        expect((hauler.memory as any).haulerPhase).toBe('collect');
    });

    it('hauler_cleansUpAndSwitchesToCollectIfHarvesterDead — no creep for towTarget', () => {
        const hauler = makeCreep({
            name: 'hauler_1',
            role: 'hauler',
            memory: { role: 'hauler', haulerPhase: 'tow', towTarget: 'dead_harvester' },
        });
        (global as any).Game.creeps = {};  // harvester is gone

        runHauler(hauler as any);

        expect((hauler.memory as any).towTarget).toBeUndefined();
        expect((hauler.memory as any).haulerPhase).toBe('collect');
    });
});
