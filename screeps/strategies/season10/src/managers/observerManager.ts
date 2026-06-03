// RC8 observer rotation — cycles through Memory.observerTargets one room per tick.
// Calling observeRoom() makes that room's contents visible for one tick.

export function runObserver(observer: StructureObserver): void {
    const targets = Memory.observerTargets;
    if (!targets || targets.length === 0) return;

    const idx = Memory.observerIndex ?? 0;
    observer.observeRoom(targets[idx % targets.length]);
    Memory.observerIndex = (idx + 1) % targets.length;
}
