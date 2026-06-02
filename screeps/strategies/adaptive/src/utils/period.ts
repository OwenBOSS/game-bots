const _lastRun: Record<string, number> = {};

/**
 * Returns true at most once per `interval` ticks for a given `key`.
 * Fires on the first call after a global reset regardless of tick alignment.
 * From screeps-quorum Process.period() — ported to a standalone module utility.
 */
export function period(interval: number, key: string): boolean {
    const last = _lastRun[key] ?? 0;
    if (Game.time - last >= interval) {
        _lastRun[key] = Game.time;
        return true;
    }
    return false;
}

export function resetPeriod(): void {
    for (const k in _lastRun) delete _lastRun[k];
}
