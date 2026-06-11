import { vi } from 'vitest';
import { manageConstruction } from '../managers/constructionManager';
import { makeRoom, makeSource } from './helpers';

describe('constructionManager — Phase 3 links', () => {
    it('constructionManager_doesNotQueueLinksBeforeRC5 — no link CSes at RC4', () => {
        const source = makeSource({ id: 's1' });
        const room   = makeRoom({ rcl: 4, sources: [source] });

        manageConstruction(room as any);

        const calls = (room.createConstructionSite as any).mock.calls;
        const linkCalls = calls.filter((c: any[]) => c[2] === (global as any).STRUCTURE_LINK);
        expect(linkCalls.length).toBe(0);
    });

    it('constructionManager_queuesSourceLinkAtRC5 — places link CS near source at RC5', () => {
        const source = makeSource({ id: 's1' });
        const room   = makeRoom({ rcl: 5, sources: [source] });

        // No existing links or sites
        room.find = vi.fn((type: number, opts?: any) => {
            if (type === (global as any).FIND_SOURCES) return [source];
            return [];
        });
        source.pos.findInRange = vi.fn(() => []);

        manageConstruction(room as any);

        expect(room.createConstructionSite).toHaveBeenCalledWith(
            expect.any(Number),
            expect.any(Number),
            (global as any).STRUCTURE_LINK,
        );
    });

    it('constructionManager_queuesControllerLinkAtRC5 — places link CS near controller at RC5', () => {
        const room = makeRoom({ rcl: 5 });
        room.find  = vi.fn((type: number) => type === (global as any).FIND_SOURCES ? [] : []);
        room.controller.pos.findInRange = vi.fn(() => []);
        room.getTerrain = vi.fn(() => ({ get: vi.fn(() => 0) }));

        manageConstruction(room as any);

        expect(room.createConstructionSite).toHaveBeenCalledWith(
            expect.any(Number),
            expect.any(Number),
            (global as any).STRUCTURE_LINK,
        );
    });

    it('constructionManager_doesNotQueueSourceLinkIfAlreadyExists — skips if link present near source', () => {
        const existingLink = { structureType: (global as any).STRUCTURE_LINK };
        const source       = makeSource({ id: 's1' });
        // Source already has a nearby link.
        source.pos.findInRange = vi.fn((type: number, _range: number, opts?: any) => {
            if (type === (global as any).FIND_MY_STRUCTURES) {
                const list = [existingLink];
                return opts?.filter ? list.filter(opts.filter) : list;
            }
            return [];
        });

        const room = makeRoom({ rcl: 5, sources: [source] });
        // Controller also already has a nearby link — prevents the controller CS from firing.
        room.controller.pos.findInRange = vi.fn((type: number, _range: number, opts?: any) => {
            if (type === (global as any).FIND_MY_STRUCTURES) {
                const list = [existingLink];
                return opts?.filter ? list.filter(opts.filter) : list;
            }
            return [];
        });
        room.find = vi.fn((type: number) => type === (global as any).FIND_SOURCES ? [source] : []);

        manageConstruction(room as any);

        const calls = (room.createConstructionSite as any).mock.calls;
        const linkCalls = calls.filter((c: any[]) => c[2] === (global as any).STRUCTURE_LINK);
        expect(linkCalls.length).toBe(0);
    });
});
