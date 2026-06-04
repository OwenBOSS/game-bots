// Per-tick memoisation of room.find() results.
// Call resetTickCache() at the top of the main loop to clear stale entries.

const cache = new Map<string, any[]>();

export function findCached<T>(room: { name: string; find: (type: number) => T[] }, constant: number): T[] {
    const key = `${room.name}-${constant}`;
    if (!cache.has(key)) {
        cache.set(key, room.find(constant));
    }
    return cache.get(key) as T[];
}

export function resetTickCache(): void {
    cache.clear();
}
