// RC8 observer rotation — cycles through known rooms one room per tick.
// Score rooms come first so we keep fresh intel on high-value targets.

export function runObserver(observer: StructureObserver): void {
    const targets = buildTargetList();
    if (targets.length === 0) return;

    const idx = Memory.observerIndex ?? 0;
    observer.observeRoom(targets[idx % targets.length]);
    Memory.observerIndex = (idx + 1) % targets.length;
}

function buildTargetList(): string[] {
    // Score rooms first (need fresh intel to route collectors), then all other known rooms
    const scoreRooms = Object.keys(Memory.scoreMap ?? {});
    const staticTargets = Memory.observerTargets ?? [];
    const knownNonScore = (Memory.knownRooms ?? []).filter(r => !scoreRooms.includes(r));
    const all = [...new Set([...scoreRooms, ...staticTargets, ...knownNonScore])];
    // Exclude rooms that are currently visible — no need to observe what we can already see
    return all.filter(r => !(r in Game.rooms));
}
