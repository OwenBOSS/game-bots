import { vi } from 'vitest';
import { manageLinkTransfers } from '../managers/linkManager';
import { makeRoom, makeSource, makeLink } from './helpers';

function makeRoomWithLinks(opts: {
    sourceLinks?: any[];
    controllerLinks?: any[];
    sources?: any[];
    rcl?: number;
}): any {
    const sources         = opts.sources ?? [makeSource({ id: 's1', x: 25, y: 25 })];
    const sourceLinks     = opts.sourceLinks     ?? [];
    const controllerLinks = opts.controllerLinks ?? [];
    const allLinks        = [...sourceLinks, ...controllerLinks];

    const room = makeRoom({ rcl: opts.rcl ?? 5, sources });

    // Override find to return links from FIND_MY_STRUCTURES
    room.find = vi.fn((type: number, findOpts?: { filter?: (o: any) => boolean }) => {
        if (type === (global as any).FIND_MY_STRUCTURES) {
            const base = allLinks;
            return findOpts?.filter ? base.filter(findOpts.filter) : base;
        }
        if (type === (global as any).FIND_SOURCES) return sources;
        return [];
    });

    // Source links report range ≤ 2 to a source; controller links report range ≤ 3 to controller.
    for (const l of sourceLinks) {
        l.pos.getRangeTo = vi.fn((t: any) => {
            if (t === room.controller) return 20;
            return 2;  // close to source
        });
    }
    for (const l of controllerLinks) {
        l.pos.getRangeTo = vi.fn((t: any) => {
            if (t === room.controller) return 2;
            return 20; // far from source
        });
    }

    // Source objects must report their range from links
    for (const s of sources) {
        s.pos.getRangeTo = vi.fn((l: any) => (sourceLinks.includes(l) ? 2 : 20));
    }

    return room;
}

describe('linkManager', () => {
    it('linkManager_identifiesSourceLink — source link has energy → transferEnergy called', () => {
        const srcLink  = makeLink({ id: 'src', energy: 800, freeCap: 0, cooldown: 0 });
        const ctrlLink = makeLink({ id: 'ctrl', energy: 0, freeCap: 800, cooldown: 0 });

        const room = makeRoomWithLinks({
            sourceLinks: [srcLink],
            controllerLinks: [ctrlLink],
        });

        manageLinkTransfers(room as any);

        expect(srcLink.transferEnergy).toHaveBeenCalledWith(ctrlLink);
    });

    it('linkManager_identifiesControllerLink — does NOT transfer to another source link', () => {
        const srcLink1 = makeLink({ id: 'src1', energy: 800, freeCap: 0, cooldown: 0 });
        const srcLink2 = makeLink({ id: 'src2', energy: 0, freeCap: 800, cooldown: 0 });

        // Both are source links (no controller link)
        const room = makeRoomWithLinks({
            sourceLinks: [srcLink1, srcLink2],
            controllerLinks: [],
        });

        manageLinkTransfers(room as any);

        // No controller link — nothing should transfer
        expect(srcLink1.transferEnergy).not.toHaveBeenCalled();
    });

    it('linkManager_doesNotTransferWhenControllerLinkFull — freeCap=0 on controller link', () => {
        const srcLink  = makeLink({ id: 'src',  energy: 800, freeCap: 0, cooldown: 0 });
        const ctrlLink = makeLink({ id: 'ctrl', energy: 800, freeCap: 0, cooldown: 0 });

        const room = makeRoomWithLinks({
            sourceLinks: [srcLink],
            controllerLinks: [ctrlLink],
        });

        manageLinkTransfers(room as any);

        expect(srcLink.transferEnergy).not.toHaveBeenCalled();
    });

    it('linkManager_doesNotTransferOnCooldown — source link cooldown > 0', () => {
        const srcLink  = makeLink({ id: 'src',  energy: 800, freeCap: 0, cooldown: 5 });
        const ctrlLink = makeLink({ id: 'ctrl', energy: 0,   freeCap: 800, cooldown: 0 });

        const room = makeRoomWithLinks({
            sourceLinks: [srcLink],
            controllerLinks: [ctrlLink],
        });

        manageLinkTransfers(room as any);

        expect(srcLink.transferEnergy).not.toHaveBeenCalled();
    });

    it('linkManager_doesNotTransferWhenSourceLinkEmpty — energy=0 on source link', () => {
        const srcLink  = makeLink({ id: 'src',  energy: 0,   freeCap: 800, cooldown: 0 });
        const ctrlLink = makeLink({ id: 'ctrl', energy: 0,   freeCap: 800, cooldown: 0 });

        const room = makeRoomWithLinks({
            sourceLinks: [srcLink],
            controllerLinks: [ctrlLink],
        });

        manageLinkTransfers(room as any);

        expect(srcLink.transferEnergy).not.toHaveBeenCalled();
    });

    it('linkManager_skipsWhenFewerThanTwoLinks — no transfer with only 1 link total', () => {
        const singleLink = makeLink({ id: 'only', energy: 800, freeCap: 0, cooldown: 0 });
        const room = makeRoom({ rcl: 5 });
        room.find = vi.fn((type: number, opts?: any) => {
            if (type === (global as any).FIND_MY_STRUCTURES) return [singleLink];
            if (type === (global as any).FIND_SOURCES) return [];
            return [];
        });

        manageLinkTransfers(room as any);

        expect(singleLink.transferEnergy).not.toHaveBeenCalled();
    });
});
